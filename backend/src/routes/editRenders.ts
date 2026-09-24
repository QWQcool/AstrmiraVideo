import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { fileTypeFromBuffer } from 'file-type';
import { EditProjectSchema, ErrorResponseSchema, GenerateResponseSchema } from '@astrmira/shared';
import { createErrorResponse } from '../errors.js';
import { createTaskThumbnail } from '../pipeline/thumbnail.js';
import { resolveOutputsDir } from '../server/staticOutputs.js';
import type { TaskStore } from '../store/taskStore.js';

/**
 * `POST /api/edits/renders`（CONTRACT §11-2；B34 · P4）——**浏览器端渲染产物入库**。
 *
 * 与 `POST /api/edits`（§11-3，服务端 ffmpeg 执行）的本质区别：**服务端不渲染**。
 * 渲染在用户浏览器完成（`@remotion/web-renderer`，WebCodecs 硬件编码，服务器零 CPU），
 * 本路由只做「校验 + 归档」—— 因此它是**同步**的：上传成功即终态，没有队列、没有轮询等待。
 *
 * 四道校验（缺一即脏数据入库）：
 * 1. **形状**：`project` 字段必须能过 `EditProjectSchema`（shared 里与 CONTRACT §11-2 同源的 schema）；
 * 2. **引用完整性**：`sourceTaskId` 必须存在且成功出片（剪辑历史按它归档，"本片剪辑历史"用它查）；
 * 3. **类型**：`file` 必须**按魔数嗅探**为 `video/mp4`（不信任 Content-Type，与 /api/upload 同规矩）；
 * 4. **体积**：≤ `MAX_RENDER_BYTES`（与反代请求体上限 20MB 同口径 —— 超出会被反代**先**拦，
 *    所以这里也必须挡，否则本地直连与线上行为不一致）。
 *
 * 入库形态：一条 `status:'succeeded'` 的普通任务（复用 §4 轮询/画廊/删除路径），
 * `origin = { kind:'edit', sourceTaskId, project }`，`requestSnapshot` 复用源片快照（画廊回填用）。
 * 封面（`thumbnailUrl`）在这里同步抽 —— 失败不影响入库（与生成链路同一口径：封面是尽力而为）。
 */

export const MAX_RENDER_BYTES = 20 * 1024 * 1024;

export interface EditRenderRoutesDeps {
  store: TaskStore;
  outputsDir?: string;
}

export const createEditRenderRoutes =
  (deps: EditRenderRoutesDeps): FastifyPluginAsyncZod =>
  async (app) => {
    const outputsDir = deps.outputsDir ?? resolveOutputsDir();

    app.post(
      '/api/edits/renders',
      {
        schema: {
          response: {
            200: GenerateResponseSchema,
            400: ErrorResponseSchema,
            404: ErrorResponseSchema,
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

        let fileBuffer: Buffer | null = null;
        let sourceTaskId: string | null = null;
        let projectRaw: string | null = null;

        try {
          for await (const part of request.parts({ limits: { fileSize: MAX_RENDER_BYTES } })) {
            if (part.type === 'file') {
              if (part.fieldname !== 'file') {
                // 只认 `file` 这一个文件字段（形状是契约的一部分，不接受"任意字段名"
                await part.toBuffer();
                continue;
              }
              fileBuffer = await part.toBuffer();
              if (part.file.truncated) {
                return reply
                  .code(413)
                  .send(
                    createErrorResponse(
                      'INVALID_ASSET',
                      `渲染产物不得超过 ${MAX_RENDER_BYTES / 1024 / 1024}MB（反代请求体上限同口径）`,
                    ),
                  );
              }
              continue;
            }
            const value = part.value;
            if (typeof value !== 'string') continue;
            if (part.fieldname === 'sourceTaskId') sourceTaskId = value;
            if (part.fieldname === 'project') projectRaw = value;
          }
        } catch (err) {
          const code = (err as { code?: string }).code;
          if (code === 'FST_REQ_FILE_TOO_LARGE') {
            return reply
              .code(413)
              .send(
                createErrorResponse(
                  'INVALID_ASSET',
                  `渲染产物不得超过 ${MAX_RENDER_BYTES / 1024 / 1024}MB`,
                ),
              );
          }
          throw err;
        }

        if (fileBuffer === null || sourceTaskId === null || projectRaw === null) {
          return reply
            .code(400)
            .send(
              createErrorResponse(
                'INVALID_REQUEST',
                '缺少字段：需要 file（渲染的 MP4）、sourceTaskId（源片）与 project（工程 JSON）',
              ),
            );
        }

        // ① 工程 JSON：形状由 shared 的 schema 收口（与 CONTRACT §11-2 同源）
        let project: unknown;
        try {
          project = JSON.parse(projectRaw);
        } catch {
          return reply
            .code(400)
            .send(createErrorResponse('INVALID_REQUEST', 'project 不是合法 JSON'));
        }
        const parsed = EditProjectSchema.safeParse(project);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          return reply
            .code(400)
            .send(
              createErrorResponse(
                'INVALID_REQUEST',
                `工程结构不合法：${first === undefined ? '未知错误' : `${first.path.join('.') || '(root)'} ${first.message}`}`,
              ),
            );
        }

        // ② 源片必须存在且成功出片
        const source = deps.store.get(sourceTaskId);
        if (source === null) {
          return reply
            .code(404)
            .send(createErrorResponse('TASK_NOT_FOUND', `源任务不存在：${sourceTaskId}`));
        }
        if (source.status !== 'succeeded' || source.outputVideoUrl === undefined) {
          return reply
            .code(404)
            .send(
              createErrorResponse(
                'TASK_NOT_FOUND',
                `源任务没有可用成片：${sourceTaskId}（当前状态 ${source.status}）`,
              ),
            );
        }

        // ③ 魔数嗅探：必须是 MP4（浏览器端 web-renderer 的默认容器）
        const sniffed = await fileTypeFromBuffer(fileBuffer);
        if (sniffed === undefined || sniffed.mime !== 'video/mp4') {
          return reply
            .code(415)
            .send(
              createErrorResponse(
                'INVALID_ASSET',
                `渲染产物必须是 MP4（按魔数嗅探判定为 ${sniffed?.mime ?? '未知'}）`,
              ),
            );
        }

        // ④ 归档：产物落盘 + 任务记录（同步终态）
        const taskId = randomUUID();
        await mkdir(outputsDir, { recursive: true });
        const outputVideoUrl = `/media/${taskId}.mp4`;
        await writeFile(path.join(outputsDir, `${taskId}.mp4`), fileBuffer);

        let thumbnailUrl: string | undefined;
        try {
          thumbnailUrl = await createTaskThumbnail({ outputsDir, videoUrl: outputVideoUrl, taskId });
        } catch {
          // 封面是尽力而为：抽帧失败不影响入库（与生成链路同一口径）
          thumbnailUrl = undefined;
        }

        const now = Date.now();
        deps.store.insert({
          taskId,
          // 与 legacy 剪辑一致：走 local 轨（它不是上游产物；track 只影响调度口径，不影响展示）
          track: 'local',
          provider: 'browser-remotion',
          status: 'succeeded',
          progressPercent: 100,
          // 复用源片快照：渲染产物没有新的生成参数，画廊回填要用一份完整请求
          requestSnapshot: source.requestSnapshot,
          outputVideoUrl,
          ...(thumbnailUrl === undefined ? {} : { thumbnailUrl }),
          warnings: [],
          submitting: false,
          message: '浏览器端渲染产物已入库',
          editOrigin: { sourceTaskId, project: parsed.data },
          createdAt: now,
        });

        return { taskId };
      },
    );
  };
