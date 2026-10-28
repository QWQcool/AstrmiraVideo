import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ErrorResponseSchema, OperationResultSchema, TaskProgressSchema } from '@astrmira/shared';
import { resolveOutputsDir } from '../server/staticOutputs.js';
import { findComfyPreview } from '../providers/comfyui/comfyuiProgress.js';
import { withOutputFileFacts } from '../server/storageUsage.js';
import { toTaskProgress, type TaskStore } from '../store/taskStore.js';

/**
 * `GET /api/tasks/:taskId` 与 `POST /api/tasks/:taskId/cancel`（CONTRACT §5）。
 * 轮询间隔建议 2s（CONTRACT §5「通信方式」）。
 */

const TaskIdParamsSchema = z.object({ taskId: z.string() });

export interface TaskRoutesDeps {
  store: TaskStore;
  /**
   * V2.95（B104）：按 ComfyUI 的 promptId 取最新预览帧。
   * 缺省用进程级实例表（findComfyPreview）；**留给测试注入**，否则这条路只能靠真机 ComfyUI 验。
   */
  findPreview?: (promptId: string) => { bytes: Uint8Array; mime: string; seq: number } | null;
  /** 成片体积（V2.3）需要输出目录；默认 `OUTPUT_DIR` / `outputs` */
  outputsDir?: string;
}

export const createTaskRoutes =
  (deps: TaskRoutesDeps): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/api/tasks/:taskId',
      {
        schema: {
          params: TaskIdParamsSchema,
          response: { 200: TaskProgressSchema, 404: ErrorResponseSchema },
        },
      },
      async (request, reply) => {
        const record = deps.store.get(request.params.taskId);
        if (record === null) {
          return reply.code(404).send({
            code: 'TASK_NOT_FOUND',
            message: `任务不存在或已清理：${request.params.taskId}`,
            disposition: 'terminal',
          });
        }
        // V2.3：成功任务带上成片体积（详情抽屉的"文件大小"要用；文件已清理时省略该字段）
        // V2.8：文件不存在时**省略直链**（容量淘汰后轮询不该拿到必然 404 的 URL）
        return withOutputFileFacts(toTaskProgress(record), deps.outputsDir ?? resolveOutputsDir());
      },
    );

    /**
     * V2.95（B104）：采样预览帧（**二进制**，不是 JSON）。
     *
     * 为什么单独一条路由而不是塞进任务 JSON：预览图每次轮询都带 base64 会让响应体积翻十几倍，
     * 而前端只需要"序号变了才重下"。所以任务 JSON 只给 `previewSeq`，图走这里。
     *
     * 三条边界：
     * ① 只对**正在跑**的任务有意义 —— 终态后 ComfyUI 的预览已被丢弃，这里返回 404；
     * ② 只有 ComfyUI 会推预览，其它引擎一律 404（不返回占位图，界面就不显示预览）；
     * ③ `no-store`：这是瞬时帧，缓存它只会让人看到过期的模糊图。
     */
    app.get(
      '/api/tasks/:taskId/preview',
      { schema: { params: TaskIdParamsSchema } },
      async (request, reply) => {
        const record = deps.store.get(request.params.taskId);
        const promptId = record?.upstreamTaskId;
        const findPreview = deps.findPreview ?? findComfyPreview;
        const preview = promptId === undefined ? null : findPreview(promptId);
        if (preview === null) {
          return reply.code(404).send({
            code: 'PREVIEW_UNAVAILABLE',
            message:
              '这一帧预览取不到：任务可能已结束（成片请看成片）、引擎不是 ComfyUI，或还没开始采样',
            disposition: 'terminal',
          });
        }
        return reply
          .header('content-type', preview.mime)
          .header('cache-control', 'no-store')
          .header('x-preview-seq', String(preview.seq))
          .send(Buffer.from(preview.bytes));
      },
    );

    app.post(
      '/api/tasks/:taskId/cancel',
      {
        schema: {
          params: TaskIdParamsSchema,
          response: { 200: OperationResultSchema, 404: ErrorResponseSchema },
        },
      },
      async (request, reply) => {
        const record = deps.store.get(request.params.taskId);
        if (record === null) {
          return reply.code(404).send({
            code: 'TASK_NOT_FOUND',
            message: `任务不存在或已清理：${request.params.taskId}`,
            disposition: 'terminal',
          });
        }

        // 仅 queued / running 可取消（CONTRACT §5）
        if (record.status !== 'queued' && record.status !== 'running') {
          return { ok: false, taskId: record.taskId };
        }

        deps.store.update(record.taskId, { status: 'cancelled', submitting: false });
        return { ok: true, taskId: record.taskId };
      },
    );
  };
