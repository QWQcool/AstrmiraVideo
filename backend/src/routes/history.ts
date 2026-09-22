import { rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ErrorResponseSchema, HistoryResponseSchema, OperationResultSchema } from '@astrmira/shared';
import { resolveOutputsDir } from '../server/staticOutputs.js';
import { toTaskProgress, type TaskStore } from '../store/taskStore.js';

/**
 * 历史画廊（CONTRACT §5 + §7）：
 * - `GET /api/history` 返回最近任务（含完整参数快照，供一键回填）；
 * - `DELETE /api/history/:taskId` 删除单条并**释放磁盘**（成片物理删除）。
 */

const TaskIdParamsSchema = z.object({ taskId: z.string() });

export interface HistoryRoutesDeps {
  store: TaskStore;
  /** 删除成片时的 outputs 根目录（默认 `OUTPUT_DIR` / `outputs`） */
  outputsDir?: string;
}

export const createHistoryRoutes =
  (deps: HistoryRoutesDeps): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/api/history',
      {
        schema: { response: { 200: HistoryResponseSchema } },
      },
      async () => ({
        items: deps.store.listRecent(50).map(toTaskProgress),
      }),
    );

    app.delete(
      '/api/history/:taskId',
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

        deps.store.delete(record.taskId);

        // 释放磁盘：成片文件按 basename 删除（路径只含服务端随机 ID，不含用户输入）
        if (record.outputVideoUrl !== undefined && record.outputVideoUrl !== '') {
          const file = path.join(deps.outputsDir ?? resolveOutputsDir(), path.basename(record.outputVideoUrl));
          await rm(file, { force: true }).catch(() => undefined);
        }

        return { ok: true, taskId: record.taskId };
      },
    );
  };
