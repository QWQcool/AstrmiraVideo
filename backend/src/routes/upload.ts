import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { fileTypeFromBuffer } from 'file-type';
import { ErrorResponseSchema, UploadResponseSchema } from '@astrmira/shared';
import type { UploadedAsset } from '@astrmira/shared';
import { createErrorResponse } from '../errors.js';
import { resolveOutputsDir } from '../server/staticOutputs.js';

/**
 * `POST /api/upload`（CONTRACT §5 + PLAN §7-6 上传加固）。
 *
 * 四条加固（缺一即公网裸奔）：
 * 1. 体积 ≤ 20MB × 数量 ≤ 4（超限**显式拒绝**，不静默截断）；
 * 2. **魔数嗅探**（`file-type`）决定类型 —— **不信任** `Content-Type`；
 * 3. 类型白名单：jpg / png / webp / heic / mp4 / mov；
 * 4. 产物路径**只含服务端生成的随机 ID**（用户提供的文件名一律不参与路径构造）。
 */

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_FILES = 4;

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

            // 路径只含服务端随机 ID + 嗅探出的扩展名；用户文件名不参与构造
            const assetId = randomUUID();
            await writeFile(path.join(assetsDir, `${assetId}.${sniffed.ext}`), buffer);

            assets.push({
              assetId,
              kind: sniffed.mime.startsWith('video/') ? 'video' : 'image',
              mime: sniffed.mime,
              size: buffer.length,
            });
          }
        } catch (err) {
          // 用 @fastify/error 生成的稳定 code 判定（不依赖实例标识，插件封装下更可靠）
          const code = (err as { code?: string }).code;
          if (code === 'FST_REQ_FILE_TOO_LARGE') {
            return reply
              .code(413)
              .send(createErrorResponse('INVALID_ASSET', '文件超过 20MB 体积上限'));
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
