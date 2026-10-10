import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  CreateProjectRequestSchema,
  DEFAULT_PROJECT_ID,
  DeleteProjectResponseSchema,
  ErrorResponseSchema,
  ProjectIdSchema,
  ProjectListResponseSchema,
  ProjectResponseSchema,
  UpdateProjectRequestSchema,
} from '@astrmira/shared';
import type { ProjectEntry } from '@astrmira/shared';
import { createErrorResponse } from '../errors.js';
import { resolveOutputsDir } from '../server/staticOutputs.js';
import { normalizeProjectName, type ProjectStore } from '../store/projects.js';
import { countAssetsByProject } from './assets.js';

/**
 * 项目维度（V2.11 / 台账 B47，CONTRACT §12）。
 *
 * ## 四条口径
 * 1. **默认项目永远在列表里、排最前、不可删** —— 它是老数据与"未指定项目"的落点；
 * 2. **只有空项目可删**：删一个还有任务/资产的项目等于把数据变成孤儿（本项目没有
 *    "级联删除"这种危险动作）→ `INVALID_REQUEST` + 说清"先清空"；
 * 3. **重名直接拒**：切换器里两个同名项目根本认不出来（可用性问题，不是洁癖）→ `INVALID_REQUEST`；
 * 4. **用量如实报**：`taskCount` 走 SQL，`assetCount` 读资产 sidecar 的项目归属
 *    （没有 sidecar 的老资产算默认项目 —— 与 `GET /api/assets` 同一口径）。
 */

const ProjectIdParamsSchema = z.object({ projectId: ProjectIdSchema });

export interface ProjectRoutesDeps {
  projects: ProjectStore;
  /** outputs 根目录（默认 `OUTPUT_DIR` / `outputs`）；测试注入临时目录用 */
  outputsDir?: string;
  /** 测试注入：资产计数（默认扫 sidecar） */
  countAssets?: (outputsDir: string) => Promise<Map<string, number>>;
}

export const createProjectRoutes =
  (deps: ProjectRoutesDeps): FastifyPluginAsyncZod =>
  async (app) => {
    const countAssets = deps.countAssets ?? countAssetsByProject;

    /** 项目记录 + 用量 → 契约条目 */
    const toEntry = (projectId: string, assetCounts: Map<string, number>): ProjectEntry | null => {
      const record = deps.projects.get(projectId);
      if (record === null) return null;
      return {
        projectId: record.projectId,
        name: record.name,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        isDefault: projectId === DEFAULT_PROJECT_ID,
        taskCount: deps.projects.countTasks(projectId),
        assetCount: assetCounts.get(projectId) ?? 0,
      };
    };

    app.get(
      '/api/projects',
      { schema: { response: { 200: ProjectListResponseSchema } } },
      async () => {
        const outputsDir = deps.outputsDir ?? resolveOutputsDir();
        const assetCounts = await countAssets(outputsDir);
        const projects = deps.projects
          .list()
          .map((record) => toEntry(record.projectId, assetCounts))
          .filter((entry): entry is ProjectEntry => entry !== null);
        return { projects };
      },
    );

    app.post(
      '/api/projects',
      {
        schema: {
          body: CreateProjectRequestSchema,
          response: { 200: ProjectResponseSchema, 400: ErrorResponseSchema },
        },
      },
      async (request, reply) => {
        const name = normalizeProjectName(request.body.name);
        if (name === '') {
          return reply.code(400).send(createErrorResponse('INVALID_REQUEST', '项目名不能为空'));
        }
        if (deps.projects.nameTaken(name)) {
          return reply
            .code(400)
            .send(createErrorResponse('INVALID_REQUEST', `项目名已存在：${name}`));
        }

        const created = deps.projects.create(name);
        const outputsDir = deps.outputsDir ?? resolveOutputsDir();
        const assetCounts = await countAssets(outputsDir);
        const entry = toEntry(created.projectId, assetCounts);
        if (entry === null) {
          // 只在"创建后立刻被别的请求删掉"这种竞态下才可能发生（如实报，不编一个 id）
          return reply
            .code(400)
            .send(createErrorResponse('INVALID_REQUEST', '项目创建后立即消失（并发删除？）'));
        }
        return { project: entry };
      },
    );

    app.patch(
      '/api/projects/:projectId',
      {
        schema: {
          params: ProjectIdParamsSchema,
          body: UpdateProjectRequestSchema,
          response: {
            200: ProjectResponseSchema,
            400: ErrorResponseSchema,
            404: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const { projectId } = request.params;
        if (deps.projects.get(projectId) === null) {
          return reply
            .code(404)
            .send(createErrorResponse('PROJECT_NOT_FOUND', `项目不存在：${projectId}`));
        }

        const name = normalizeProjectName(request.body.name);
        if (name === '') {
          return reply.code(400).send(createErrorResponse('INVALID_REQUEST', '项目名不能为空'));
        }
        if (deps.projects.nameTaken(name, projectId)) {
          return reply
            .code(400)
            .send(createErrorResponse('INVALID_REQUEST', `项目名已存在：${name}`));
        }

        deps.projects.rename(projectId, name);
        const outputsDir = deps.outputsDir ?? resolveOutputsDir();
        const entry = toEntry(projectId, await countAssets(outputsDir));
        if (entry === null) {
          return reply
            .code(404)
            .send(createErrorResponse('PROJECT_NOT_FOUND', `项目不存在：${projectId}`));
        }
        return { project: entry };
      },
    );

    app.delete(
      '/api/projects/:projectId',
      {
        schema: {
          params: ProjectIdParamsSchema,
          response: {
            200: DeleteProjectResponseSchema,
            400: ErrorResponseSchema,
            404: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const { projectId } = request.params;
        if (deps.projects.get(projectId) === null) {
          return reply
            .code(404)
            .send(createErrorResponse('PROJECT_NOT_FOUND', `项目不存在：${projectId}`));
        }
        if (projectId === DEFAULT_PROJECT_ID) {
          return reply
            .code(400)
            .send(
              createErrorResponse(
                'INVALID_REQUEST',
                '默认项目不可删除（老数据与未指定项目的落点）',
              ),
            );
        }

        const taskCount = deps.projects.countTasks(projectId);
        const outputsDir = deps.outputsDir ?? resolveOutputsDir();
        const assetCount = (await countAssets(outputsDir)).get(projectId) ?? 0;
        if (taskCount > 0 || assetCount > 0) {
          return reply
            .code(400)
            .send(
              createErrorResponse(
                'INVALID_REQUEST',
                `项目非空：${taskCount} 条任务 / ${assetCount} 个资产（请先在项目内清理后再删除）`,
              ),
            );
        }

        deps.projects.remove(projectId);
        return { deleted: true, projectId };
      },
    );
  };
