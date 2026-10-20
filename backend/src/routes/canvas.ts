import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  CanvasDocSaveResponseSchema,
  CanvasDocSchema,
  CanvasProjectIndexSchema,
  DeleteProjectResponseSchema,
  ErrorResponseSchema,
  ProjectIdSchema,
} from '@astrmira/shared';
import { createErrorResponse } from '../errors.js';
import {
  CanvasDocConflictError,
  CanvasDocStore,
  resolveCanvasDir,
} from '../store/canvasDocs.js';

/**
 * 创作画布文档路由（CONTRACT §21-8 / V2.42；Step 11-S3 片 A）。
 *
 * 三条口径：
 * 1. **整份读写**：画布是编辑器文档（`nodes/edges/layout`），不做字段级 PATCH ——
 *    局部更新会让"撤销栈 + 服务端副本"两套状态互相覆盖；
 * 2. **不存在就是 404**：不静默返回空文档，否则"新建项目"和"打错 id"在界面上长得一样；
 * 3. **单用户**（D60）：没有 owner 校验，路径里的 `projectId` 只做文件名转义。
 */

const CanvasParamsSchema = z.object({ projectId: ProjectIdSchema });

/** V2.48：并发修订号。Fastify 把 header 名转小写。 */
const CanvasRevisionHeadersSchema = z.object({
  'x-canvas-revision': z
    .string()
    .regex(/^\d+$/, 'X-Canvas-Revision 必须是正整数')
    .optional(),
});

export interface CanvasRoutesDeps {
  /** 测试注入临时目录；生产用 `DATA_DIR/canvas` */
  dir?: string;
  store?: CanvasDocStore;
}

export const createCanvasRoutes =
  (deps: CanvasRoutesDeps = {}): FastifyPluginAsyncZod =>
  async (app) => {
    const store = deps.store ?? new CanvasDocStore(deps.dir ?? resolveCanvasDir());

    app.get(
      '/api/canvas/projects',
      { schema: { response: { 200: CanvasProjectIndexSchema } } },
      async () => store.readIndex(),
    );

    app.get(
      '/api/canvas/docs/:projectId',
      {
        schema: {
          params: CanvasParamsSchema,
          response: { 200: CanvasDocSchema, 404: ErrorResponseSchema },
        },
      },
      async (request, reply) => {
        const doc = store.readDoc(request.params.projectId);
        if (doc === null) {
          return reply
            .code(404)
            .send(createErrorResponse('PROJECT_NOT_FOUND', '这个画布还没有保存过（或已被删除）'));
        }
        return doc;
      },
    );

    app.delete(
      '/api/canvas/docs/:projectId',
      {
        schema: {
          params: CanvasParamsSchema,
          response: { 200: DeleteProjectResponseSchema, 404: ErrorResponseSchema },
        },
      },
      async (request, reply) => {
        const removed = store.deleteDoc(request.params.projectId);
        if (!removed) {
          return reply
            .code(404)
            .send(createErrorResponse('PROJECT_NOT_FOUND', '这个画布不存在（或已经被删除）'));
        }
        return { deleted: true, projectId: request.params.projectId };
      },
    );

    app.put(
      '/api/canvas/docs/:projectId',
      {
        schema: {
          params: CanvasParamsSchema,
          headers: CanvasRevisionHeadersSchema,
          body: CanvasDocSchema,
          response: {
            200: CanvasDocSaveResponseSchema,
            400: ErrorResponseSchema,
            409: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        if (request.body.projectId !== request.params.projectId) {
          // 体里的 projectId 与路径不一致 = 调用方拼错了请求；写进去会覆盖另一个画布
          return reply
            .code(400)
            .send(createErrorResponse('INVALID_REQUEST', '文档里的 projectId 与路径不一致'));
        }
        const raw = request.headers['x-canvas-revision'];
        const expected =
          typeof raw === 'string' && raw !== '' ? Number.parseInt(raw, 10) : undefined;
        try {
          const saved = store.saveDoc(request.body, expected);
          return { ok: true, summary: saved.summary, revision: saved.revision };
        } catch (caught) {
          if (caught instanceof CanvasDocConflictError) {
            return reply.code(409).send(createErrorResponse('DOC_CONFLICT', caught.message));
          }
          throw caught;
        }
      },
    );
  };
