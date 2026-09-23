import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ErrorResponseSchema, OperationResultSchema, TaskProgressSchema } from '@astrmira/shared';
import { resolveOutputsDir } from '../server/staticOutputs.js';
import { withOutputSize } from '../server/storageUsage.js';
import { toTaskProgress, type TaskStore } from '../store/taskStore.js';

/**
 * `GET /api/tasks/:taskId` 与 `POST /api/tasks/:taskId/cancel`（CONTRACT §5）。
 * 轮询间隔建议 2s（CONTRACT §5「通信方式」）。
 */

const TaskIdParamsSchema = z.object({ taskId: z.string() });

export interface TaskRoutesDeps {
  store: TaskStore;
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
        return withOutputSize(toTaskProgress(record), deps.outputsDir ?? resolveOutputsDir());
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
