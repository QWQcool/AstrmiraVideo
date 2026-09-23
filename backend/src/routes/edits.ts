import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { EditScriptSchema, ErrorResponseSchema, GenerateResponseSchema } from '@astrmira/shared';
import { createErrorResponse } from '../errors.js';
import type { JobQueue } from '../queue/JobQueue.js';
import type { TaskStore } from '../store/taskStore.js';

/**
 * `POST /api/edits`（CONTRACT §5 / §11-2；V9 · B9）。
 *
 * 职责边界很清楚：**它只做"能立刻判定"的校验**，真正的执行交给队列 + `pipeline/editExecutor.ts`。
 *
 * 三类校验（都在这里完成，不入队）：
 * 1. **形状**：由 zod schema 直接拒（`EditScriptSchema` 是判别联合，"给 trim 传 gain"根本进不来）；
 * 2. **引用完整性**：源成片必须存在且成功；`concat` 的每个素材同样要有成片（否则等执行时才报，
 *    错误会晚到好几秒，且用户不知道是哪一段的问题）；
 * 3. **值之间的关系**：`endSec > startSec`（zod 管不了跨字段关系）——
 *    这类输入必须 **400 `INVALID_REQUEST`**，而不是让 ffmpeg 报一个看不懂的错。
 *
 * 入队后与生成任务**共用同一条轮询**（`GET /api/tasks/:taskId`）与画廊 —— 剪辑产物就是一条普通任务，
 * 只是 `origin.kind === 'edit'`。它走 `local` 轨（本地互斥 1），**不走防线 5 的 60s 冷却**
 * （那条防线防的是付费上游，本地 CPU 不在其列）。
 */
export interface EditRoutesDeps {
  store: TaskStore;
  queue: JobQueue;
}

export const createEditRoutes =
  (deps: EditRoutesDeps): FastifyPluginAsyncZod =>
  async (app) => {
    app.post(
      '/api/edits',
      {
        schema: {
          body: EditScriptSchema,
          response: {
            200: GenerateResponseSchema,
            400: ErrorResponseSchema,
            404: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const script = request.body;

        // ① 源成片
        const source = deps.store.get(script.sourceTaskId);
        if (source === null) {
          return reply
            .code(404)
            .send(createErrorResponse('TASK_NOT_FOUND', `源任务不存在：${script.sourceTaskId}`));
        }
        if (source.status !== 'succeeded' || source.outputVideoUrl === undefined) {
          return reply
            .code(404)
            .send(
              createErrorResponse(
                'TASK_NOT_FOUND',
                `源任务没有可用成片：${script.sourceTaskId}（当前状态 ${source.status}）`,
              ),
            );
        }

        // ② 逐项校验（引用完整性 + 值关系）
        for (const operation of script.operations) {
          if (operation.type === 'trim' && operation.endSec <= operation.startSec) {
            return reply
              .code(400)
              .send(
                createErrorResponse(
                  'INVALID_REQUEST',
                  `裁剪区间非法：endSec（${operation.endSec}）必须大于 startSec（${operation.startSec}）`,
                ),
              );
          }

          if (operation.type === 'concat') {
            for (const taskId of operation.taskIds) {
              const part = deps.store.get(taskId);
              if (part === null || part.status !== 'succeeded' || part.outputVideoUrl === undefined) {
                return reply
                  .code(404)
                  .send(
                    createErrorResponse('TASK_NOT_FOUND', `拼接素材不可用：${taskId}`),
                  );
              }
            }
          }

          if (operation.type === 'extractFrame' && operation.atSec < 0) {
            return reply
              .code(400)
              .send(createErrorResponse('INVALID_REQUEST', '抽帧时间点不能为负'));
          }
        }

        const taskId = randomUUID();
        await deps.queue.submit({
          taskId,
          // local 轨 = 本地互斥 1（与本地推理同一把锁）；剪辑是 CPU 密集且要写同一批文件
          track: 'local',
          // 剪辑"复用源片的参数快照"：任务记录里必须有 requestSnapshot（画廊回填要用），
          // 而剪辑本身不产生新的生成参数 —— 用源片快照是最诚实的选择
          request: source.requestSnapshot,
          // 剪辑任务不需要跨请求幂等（每次提交都是新任务），用自身 id 兜底即可
          idempotencyKey: `edit:${taskId}`,
          // 不进"即将提交"状态：本地操作没有"提交到上游"这一步（防线 7 与它无关）
          submitting: false,
          kind: 'edit',
          editScript: script,
        });

        return { taskId };
      },
    );
  };
