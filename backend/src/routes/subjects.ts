import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  DeleteSubjectResponseSchema,
  ErrorResponseSchema,
  SubjectCreateSchema,
  SubjectListResponseSchema,
  SubjectPatchSchema,
  SubjectResponseSchema,
} from '@astrmira/shared';
import { createErrorResponse } from '../errors.js';
import { SubjectLimitError, SubjectStore, resolveSubjectsFile } from '../store/subjects.js';

/**
 * 主体库路由（CONTRACT §21-18 / V2.86 / D-3）。
 *
 * 三条口径：
 * 1. **主体不属于画布**：没有 `canvasProjectId`，也不按项目过滤 —— 它的价值就是跨画布复用；
 * 2. **不存在就是 404**（`PROJECT_NOT_FOUND`）：不静默建、不返回空对象，
 *    否则"删过了"和"打错 id"在界面上长得一样；
 * 3. **单用户部署**（D60）：没有 owner 校验，id 是 uuid。
 */

const SubjectParamsSchema = z.object({ subjectId: z.string().min(1) });

export interface SubjectRoutesDeps {
  /** 测试注入临时文件；生产用 `DATA_DIR/subjects.json` */
  file?: string;
  store?: SubjectStore;
}

export const createSubjectRoutes =
  (deps: SubjectRoutesDeps = {}): FastifyPluginAsyncZod =>
  async (app) => {
    const store = deps.store ?? new SubjectStore(deps.file ?? resolveSubjectsFile());

    app.get(
      '/api/subjects',
      { schema: { response: { 200: SubjectListResponseSchema } } },
      async () => ({ subjects: store.list() }),
    );

    app.post(
      '/api/subjects',
      {
        schema: {
          body: SubjectCreateSchema,
          response: { 200: SubjectResponseSchema, 400: ErrorResponseSchema },
        },
      },
      async (request, reply) => {
        try {
          return { subject: store.create(request.body) };
        } catch (caught) {
          if (caught instanceof SubjectLimitError) {
            return reply.code(400).send(createErrorResponse('INVALID_REQUEST', caught.message));
          }
          throw caught;
        }
      },
    );

    app.patch(
      '/api/subjects/:subjectId',
      {
        schema: {
          params: SubjectParamsSchema,
          body: SubjectPatchSchema,
          response: {
            200: SubjectResponseSchema,
            400: ErrorResponseSchema,
            404: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const subject = store.update(request.params.subjectId, request.body);
        if (subject === null) {
          return reply
            .code(404)
            .send(createErrorResponse('PROJECT_NOT_FOUND', '这个主体不存在（或已经被删除）'));
        }
        return { subject };
      },
    );

    app.delete(
      '/api/subjects/:subjectId',
      {
        schema: {
          params: SubjectParamsSchema,
          response: { 200: DeleteSubjectResponseSchema, 404: ErrorResponseSchema },
        },
      },
      async (request, reply) => {
        const removed = store.remove(request.params.subjectId);
        if (!removed) {
          return reply
            .code(404)
            .send(createErrorResponse('PROJECT_NOT_FOUND', '这个主体不存在（或已经被删除）'));
        }
        return { deleted: true, subjectId: request.params.subjectId };
      },
    );
  };
