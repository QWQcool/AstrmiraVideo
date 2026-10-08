import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { fileTypeFromBuffer } from 'file-type';
import { ErrorResponseSchema, UploadResponseSchema } from '@astrmira/shared';
import type { UploadedAsset } from '@astrmira/shared';
import { createErrorResponse } from '../errors.js';
import {
  ImageSanitizeError,
  sanitizeImage,
  type SanitizedImage,
} from '../pipeline/imageSanitize.js';
import { resolveOutputsDir } from '../server/staticOutputs.js';

/**
 * `POST /api/upload`（CONTRACT §5 + PLAN §7-6 上传加固 + 防线 4）。
 *
 * 五条（缺一即公网裸奔 / 上游被喂脏数据）：
 * 1. 体积 ≤ 100MB（V2.6 起，原 20MB；台账 B36）× 数量 ≤ 4（超限**显式拒绝**，不静默截断）；
 * 2. **魔数嗅探**（`file-type`）决定类型 —— **不信任** `Content-Type`；
 * 3. 类型白名单：jpg / png / webp / heic / mp4 / mov；
 * 4. **图像走防线 4 清洗网关**（`pipeline/imageSanitize.ts`：EXIF 方向矫正、CMYK→sRGB、
 *    超大图下采样、32 倍数规整、剥离元数据）。因此响应的 `mime` / `size` 是**清洗后的产物事实**
 *    （HEIC / WebP 会变成 JPEG）；视频原样落盘。清洗失败 → 415 `INVALID_ASSET` + 可读原因；
 * 5. 产物路径**只含服务端生成的随机 ID**（用户提供的文件名一律不参与路径构造）。
 */

// V2.6（台账 B36）：20MB → 100MB。与 MAX_RENDER_BYTES、反代 `request_body.max_size` 同口径，
// 三处必须同改（PLAN §7-9）；再大就该走分片上传，不在本常量上继续加。
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_FILES = 4;

/**
 * V2.9（台账 B43）：用户原始文件名的 sanitize —— **只取 basename**（路径不参与）、
 * 去掉控制字符、截断 120 字符；清洗后为空则视为"没有名字"。
 *
 * 为什么要有这一层：原始文件名是**用户输入**，会被存进 sidecar 并回显到 `@` 弹层；
 * 它不参与任何路径构造（路径仍只用随机 assetId，防线 5 的老纪律不变）。
 */
export function sanitizeOriginalName(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const base = raw.split(/[\\/]/).pop() ?? '';
  // 剥掉控制字符（C0 + DEL）：文件名会回显到 `@` 弹层，控制字符只会带来显示与注入问题。
  // 用**码点过滤**而不是正则——`no-control-regex` 会拦（规则是对的，所以这里不留例外）。
  const cleaned = [...base]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .trim();
  if (cleaned === '') return undefined;
  return cleaned.length > 120 ? cleaned.slice(0, 120) : cleaned;
}

/**
 * 写资产元数据 sidecar `<assetId>.json`（V2.9 / B43）。
 *
 * 三条纪律：① **只落本地** —— 不进上游请求、不进操作日志、不进任务快照；
 * ② **失败不阻断上传**（元数据是增强，不是事实源；上传的主体是媒体文件本身）；
 * ③ 生命周期跟着资产走 —— 删除按既有的 `<assetId>.` 前缀规则自动覆盖，不新增清理路径。
 */
async function writeAssetMeta(
  assetsDir: string,
  assetId: string,
  originalName: string | undefined,
): Promise<void> {
  if (originalName === undefined) return;
  try {
    await writeFile(
      path.join(assetsDir, `${assetId}.json`),
      JSON.stringify({ name: originalName, uploadedAt: Date.now() }),
      'utf8',
    );
  } catch {
    /* 见 ② */
  }
}

/** 魔数嗅探后的白名单 */
export const ALLOWED_MIME: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
]);

export interface UploadRoutesOptions {
  outputsDir?: string;
}

export const createUploadRoutes =
  (options: UploadRoutesOptions = {}): FastifyPluginAsyncZod =>
  async (app) => {
    const assetsDir = path.join(options.outputsDir ?? resolveOutputsDir(), 'assets');

    app.post(
      '/api/upload',
      {
        schema: {
          response: {
            200: UploadResponseSchema,
            400: ErrorResponseSchema,
            413: ErrorResponseSchema,
            415: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        if (!request.isMultipart()) {
          return reply
            .code(415)
            .send(createErrorResponse('INVALID_ASSET', '请求必须是 multipart/form-data'));
        }

        await mkdir(assetsDir, { recursive: true });
        const assets: UploadedAsset[] = [];
        let fileCount = 0;

        try {
          // 文件**数量**上限由本函数自己计数控制，**不交给** multipart 的 `limits.files`：
          // 超限时 multipart 会直接中止请求流并抛 `ERR_STREAM_PREMATURE_CLOSE`（500），
          // 给不出干净的 413。体积（fileSize）仍交给 multipart 做流式保护。
          for await (const part of request.parts({ limits: { fileSize: MAX_FILE_BYTES } })) {
            if (part.type !== 'file') continue;

            fileCount += 1;
            if (fileCount > MAX_FILES) {
              return reply
                .code(413)
                .send(createErrorResponse('INVALID_ASSET', `最多上传 ${MAX_FILES} 个文件`));
            }

            const buffer = await part.toBuffer();

            // 双保险：@fastify/multipart 默认在超限时抛错，这里再确认截断标志
            if (part.file.truncated) {
              return reply
                .code(413)
                .send(
                  createErrorResponse(
                    'INVALID_ASSET',
                    `单个文件不得超过 ${MAX_FILE_BYTES / 1024 / 1024}MB`,
                  ),
                );
            }

            const sniffed = await fileTypeFromBuffer(buffer);
            if (sniffed === undefined || !ALLOWED_MIME.has(sniffed.mime)) {
              return reply
                .code(415)
                .send(
                  createErrorResponse(
                    'INVALID_ASSET',
                    `不支持的文件类型（按魔数嗅探判定为 ${sniffed?.mime ?? '未知'}）`,
                  ),
                );
            }

            // 路径只含服务端随机 ID；用户文件名不参与构造
            const assetId = randomUUID();

            if (sniffed.mime.startsWith('image/')) {
              // 防线 4（S6）：图像必须过清洗网关。清洗后**类型 / 体积 / 扩展名都以产物为准**
              // （HEIC / WebP 会变成 JPEG），响应的 `mime` 与 `size` 因此是"清洗后的事实"。
              let sanitized: SanitizedImage;

              try {
                sanitized = await sanitizeImage(buffer);
              } catch (error) {
                const message =
                  error instanceof ImageSanitizeError ? error.message : '图像清洗失败';
                return reply.code(415).send(createErrorResponse('INVALID_ASSET', message));
              }

              await writeFile(path.join(assetsDir, `${assetId}.${sanitized.ext}`), sanitized.buffer);
              await writeAssetMeta(assetsDir, assetId, sanitizeOriginalName(part.filename));
              assets.push({
                assetId,
                kind: 'image',
                mime: sanitized.mime,
                size: sanitized.buffer.length,
              });

              continue;
            }

            // 视频：原样落盘（时长与尺寸的对齐发生在生成阶段）
            await writeFile(path.join(assetsDir, `${assetId}.${sniffed.ext}`), buffer);
            await writeAssetMeta(assetsDir, assetId, sanitizeOriginalName(part.filename));
            assets.push({ assetId, kind: 'video', mime: sniffed.mime, size: buffer.length });
          }
        } catch (err) {
          // 用 @fastify/error 生成的稳定 code 判定（不依赖实例标识，插件封装下更可靠）
          const code = (err as { code?: string }).code;
          if (code === 'FST_REQ_FILE_TOO_LARGE') {
            return reply
              .code(413)
              .send(createErrorResponse('INVALID_ASSET', `文件超过 ${MAX_FILE_BYTES / 1024 / 1024}MB 体积上限`));
          }
          if (code === 'FST_FILES_LIMIT' || code === 'FST_PARTS_LIMIT') {
            return reply
              .code(413)
              .send(createErrorResponse('INVALID_ASSET', `最多上传 ${MAX_FILES} 个文件`));
          }
          throw err;
        }

        if (assets.length === 0) {
          return reply.code(400).send(createErrorResponse('INVALID_ASSET', '没有收到任何文件'));
        }

        return { assets };
      },
    );
  };
