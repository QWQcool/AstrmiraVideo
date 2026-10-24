import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  CreationRunInputSchema,
  CreationRunListResponseSchema,
  CreationRunResponseSchema,
  ErrorResponseSchema,
  providerBaseType,
  validateCreationRunInput,
  type CreationRun,
  type CreationRunInput,
} from '@astrmira/shared';
import { createErrorResponse } from '../errors.js';
import type { RunStore } from '../runs/runStore.js';

/**
 * 创作会话 REST 路由（CONTRACT §29 / V2.63；S8-B3）。
 *
 * 路由只做三件事：校验、状态迁移、触发 tick。执行语义全部在
 * `runs/creationRunEngine.ts`（纯函数）与注入的 `tick`（薄驱动）里。
 *
 * 409 约定（§29）：非法状态迁移用 409 + `INVALID_REQUEST` + 人话消息，
 * 不静默接受也不假装成功。
 */
export interface RunRoutesDeps {
  runs: RunStore;
  /** start/confirm/retry 后立即推进一次（实现方与定时器共用同一个 CreationRunService） */
  tick(runId: string): Promise<unknown>;
  /** 引擎可用性（创建时拦截未启用引擎；与 /api/generate 同一来源） */
  resolveProvider(provider: string): unknown;
  projects?: { get(id: string): unknown | null };
}

const ACTIVE_STATES = new Set(['planned', 'running', 'awaiting-confirmation', 'assembling']);

/** v1 会话只允许本地轨引擎（D74）：云轨凭据出不了浏览器，明确拒绝而不是假装能跑 */
function localTrackProblem(provider: string): string | null {
  const base = providerBaseType(provider);
  if (base === 'cloud-volcano-seedance' || base === 'http-service') {
    return `创作会话 v1 只支持本地轨引擎（host-comfyui / fixture-local；D74）：${provider} 是云轨，云端凭据不能进服务端会话`;
  }
  return null;
}

function toRun(input: CreationRunInput, now: number): CreationRun {
  return {
    version: 1,
    id: randomUUID(),
    title: input.title,
    projectId: input.projectId?.trim() || 'default',
    mode: input.mode,
    provider: input.provider,
    steps: input.steps.map((step) => ({
      ...step,
      referenceAssetIds: step.referenceAssetIds ?? [],
      dependsOn: step.dependsOn ?? [],
      status: 'pending',
      attempt: 0,
    })),
    state: 'planned',
    createdAt: now,
    updatedAt: now,
  };
}

export const createRunRoutes =
  (deps: RunRoutesDeps): FastifyPluginAsyncZod =>
  async (app) => {
    app.post(
      '/api/agent/runs',
      {
        schema: {
          body: CreationRunInputSchema,
          response: {
            201: CreationRunResponseSchema,
            400: ErrorResponseSchema,
            404: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const input = request.body;
        const structureProblem = validateCreationRunInput(input);
        if (structureProblem !== null) {
          return reply.code(400).send(createErrorResponse('INVALID_REQUEST', structureProblem));
        }
        const trackProblem = localTrackProblem(input.provider);
        if (trackProblem !== null) {
          return reply.code(400).send(createErrorResponse('INVALID_REQUEST', trackProblem));
        }
        if (deps.resolveProvider(input.provider) === null) {
          return reply.code(400).send(
            createErrorResponse(
              'PROVIDER_UNAVAILABLE',
              `provider 未实现或未启用：${input.provider}（见 CONTRACT §4）`,
            ),
          );
        }
        const projectId = input.projectId?.trim() || 'default';
        if (deps.projects !== undefined && deps.projects.get(projectId) === null) {
          return reply
            .code(404)
            .send(createErrorResponse('PROJECT_NOT_FOUND', `项目不存在：${projectId}`));
        }
        const run = toRun(input, Date.now());
        deps.runs.create(run);
        return reply.code(201).send({ run });
      },
    );

    app.get(
      '/api/agent/runs',
      { schema: { response: { 200: CreationRunListResponseSchema } } },
      async (request) => {
        const query = request.query as { project?: string };
        const projectId = query.project?.trim() || 'default';
        return { runs: deps.runs.listByProject(projectId) };
      },
    );

    app.get(
      '/api/agent/runs/:id',
      { schema: { response: { 200: CreationRunResponseSchema, 404: ErrorResponseSchema } } },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const run = deps.runs.get(id);
        if (run === null) {
          return reply.code(404).send(createErrorResponse('INVALID_REQUEST', `会话不存在：${id}`));
        }
        return { run };
      },
    );

    app.post(
      '/api/agent/runs/:id/start',
      {
        schema: {
          response: { 200: CreationRunResponseSchema, 404: ErrorResponseSchema, 409: ErrorResponseSchema },
        },
      },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const run = deps.runs.get(id);
        if (run === null) {
          return reply.code(404).send(createErrorResponse('INVALID_REQUEST', `会话不存在：${id}`));
        }
        if (run.state !== 'planned') {
          return reply.code(409).send(
            createErrorResponse('INVALID_REQUEST', `只有 planned 会话能开始（当前 ${run.state}）`),
          );
        }
        const now = Date.now();
        const started: CreationRun = { ...run, state: 'running', startedAt: now, updatedAt: now };
        deps.runs.update(started);
        await deps.tick(id);
        return { run: started };
      },
    );

    app.post(
      '/api/agent/runs/:id/confirm',
      {
        schema: {
          response: { 200: CreationRunResponseSchema, 404: ErrorResponseSchema, 409: ErrorResponseSchema },
        },
      },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const run = deps.runs.get(id);
        if (run === null) {
          return reply.code(404).send(createErrorResponse('INVALID_REQUEST', `会话不存在：${id}`));
        }
        if (run.state !== 'awaiting-confirmation') {
          return reply.code(409).send(
            createErrorResponse(
              'INVALID_REQUEST',
              `只有首帧确认档暂停中的会话能继续（当前 ${run.state}）`,
            ),
          );
        }
        const now = Date.now();
        const confirmed: CreationRun = {
          ...run,
          state: 'running',
          confirmedAt: now,
          updatedAt: now,
        };
        deps.runs.update(confirmed);
        await deps.tick(id);
        return { run: confirmed };
      },
    );

    app.post(
      '/api/agent/runs/:id/cancel',
      {
        schema: {
          response: { 200: CreationRunResponseSchema, 404: ErrorResponseSchema, 409: ErrorResponseSchema },
        },
      },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const run = deps.runs.get(id);
        if (run === null) {
          return reply.code(404).send(createErrorResponse('INVALID_REQUEST', `会话不存在：${id}`));
        }
        if (!ACTIVE_STATES.has(run.state)) {
          return reply.code(409).send(
            createErrorResponse('INVALID_REQUEST', `会话已是终态（${run.state}），不能取消`),
          );
        }
        const now = Date.now();
        const cancelled: CreationRun = { ...run, state: 'cancelled', finishedAt: now, updatedAt: now };
        deps.runs.update(cancelled);
        return { run: cancelled };
      },
    );

    app.post(
      '/api/agent/runs/:id/steps/:stepId/retry',
      {
        schema: {
          response: { 200: CreationRunResponseSchema, 404: ErrorResponseSchema, 409: ErrorResponseSchema },
        },
      },
      async (request, reply) => {
        const { id, stepId } = request.params as { id: string; stepId: string };
        const run = deps.runs.get(id);
        if (run === null) {
          return reply.code(404).send(createErrorResponse('INVALID_REQUEST', `会话不存在：${id}`));
        }

        /**
         * 两种合法重试（S9-D / V2.67）：
         * ① failed 会话的失败步（原口径，S8-B3）；
         * ② **首帧确认档**暂停中（awaiting-confirmation）对已成功 image 步的重出——
         *    用户对某张首帧不满意时不必取消整场会话：attempt+1 换幂等键 = 真新任务，
         *    会话回 running；视频步因确认门未开保持 pending，全部图步再次成功后
         *    引擎自然回到 awaiting-confirmation（deriveTransition 既有逻辑，零新状态）。
         *    无人值守档**不开放**（没有人盯着，重出只是浪费算力）。
         */
        const isConfirmPhase =
          run.state === 'awaiting-confirmation' &&
          run.mode === 'first-frame-confirm';
        if (run.state !== 'failed' && !isConfirmPhase) {
          return reply.code(409).send(
            createErrorResponse(
              'INVALID_REQUEST',
              `只有失败的会话或首帧确认档暂停中的会话能重试步骤（当前 ${run.state}）`,
            ),
          );
        }
        if (run.state === 'failed') {
          const step = run.steps.find((item) => item.id === stepId);
          if (step === undefined || step.status !== 'failed') {
            return reply.code(409).send(
              createErrorResponse('INVALID_REQUEST', `步骤 ${stepId} 不存在或不是失败状态`),
            );
          }
        } else if (isConfirmPhase) {
          const step = run.steps.find((item) => item.id === stepId);
          if (step === undefined || step.kind !== 'image' || step.status !== 'succeeded') {
            return reply.code(409).send(
              createErrorResponse(
                'INVALID_REQUEST',
                `首帧确认档只能重出已成功的首帧图步骤（${stepId} 不满足）`,
              ),
            );
          }
        }
        const now = Date.now();
        const { failure: _failure, finishedAt: _finishedAt, ...rest } = run;
        const retried: CreationRun = {
          ...rest,
          steps: run.steps.map((step) =>
            step.id === stepId
              ? {
                  ...step,
                  status: 'pending',
                  attempt: step.attempt + 1,
                  taskId: undefined,
                  outputAssetId: undefined,
                  error: undefined,
                }
              : step,
          ),
          state: 'running',
          updatedAt: now,
        };
        deps.runs.update(retried);
        // tick 可能立刻重新提交该步骤（taskId 回填）——响应给 tick 后的实时状态，不给快照
        const latest = deps.runs.get(id);
        await deps.tick(id);
        return { run: deps.runs.get(id) ?? latest ?? retried };
      },
    );
  };
