import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ErrorResponseSchema,
  STORYBOARD_SESSION_MAX_SHOTS,
  StoryboardExpandRequestSchema,
  StoryboardExpandResponseSchema,
  StoryboardRequestSchema,
  StoryboardResponseSchema,
} from '@astrmira/shared';
import type {
  CanvasAgentContext,
  ErrorCode,
  LlmConfig,
  StoryboardPlan,
  StoryboardReference,
} from '@astrmira/shared';
import { createErrorResponse, dispositionOf, ProviderFailureError } from '../errors.js';
import {
  generateStoryboardPlan,
  type StoryboardPlanResult,
} from '../providers/storyboardPlan.js';
import {
  generateStoryboardExpansion,
  type StoryboardExpandResult,
} from '../providers/storyboardExpand.js';
import { resolveLlmKey } from '../security/credential.js';

/** `POST /api/agent/storyboard`（P5）——只生成分镜表，不写画布/不生成媒体。 */
export interface StoryboardRoutesDeps {
  generate?: (options: {
    apiKey: string;
    instruction: string;
    canvas?: CanvasAgentContext;
    llm?: LlmConfig;
  }) => Promise<StoryboardPlanResult>;
  /** S8-A2：`POST /api/agent/storyboard/expand` 的注入点（测试用） */
  expand?: (options: {
    apiKey: string;
    plan: StoryboardPlan;
    references: readonly StoryboardReference[];
    llm?: LlmConfig;
  }) => Promise<StoryboardExpandResult>;
}

type StoryboardErrorStatus = 400 | 401 | 501 | 502;

const ERROR_STATUS: Partial<Record<ErrorCode, StoryboardErrorStatus>> = {
  LLM_NOT_CONFIGURED: 501,
  INVALID_REQUEST: 400,
  KEY_INVALID: 401,
  UPSTREAM_ERROR: 502,
};

export const createStoryboardRoutes =
  (deps: StoryboardRoutesDeps = {}): FastifyPluginAsyncZod =>
  async (app) => {
    app.post(
      '/api/agent/storyboard',
      {
        schema: {
          body: StoryboardRequestSchema,
          response: {
            200: StoryboardResponseSchema,
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            501: ErrorResponseSchema,
            502: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const apiKey = resolveLlmKey(request);
        if (apiKey === null) {
          return reply
            .code(501)
            .send(
              createErrorResponse(
                'LLM_NOT_CONFIGURED',
                '未配置分镜计划文本模型：请在设置里填入 LLM Key（本服务不提供文本侧兜底 Key）',
              ),
            );
        }
        try {
          const result = await (deps.generate ?? generateStoryboardPlan)({
            apiKey,
            instruction: request.body.instruction.trim(),
            ...(request.body.canvas === undefined ? {} : { canvas: request.body.canvas }),
            ...(request.body.llm === undefined ? {} : { llm: request.body.llm }),
          });
          return {
            plan: result.plan,
            engine: 'llm' as const,
            model: result.model,
            ...(result.usage === undefined ? {} : { usage: result.usage }),
          };
        } catch (err) {
          const error =
            err instanceof ProviderFailureError
              ? err
                  : new ProviderFailureError(
                      'UPSTREAM_ERROR',
                      `分镜计划失败：${err instanceof Error ? err.message : String(err)}`,
                    );
          const errorResponse = createErrorResponse(error.code, error.message);
          return reply.code(ERROR_STATUS[error.code] ?? 502).send({
            ...errorResponse,
            disposition: error.dispositionOverride ?? dispositionOf(error.code),
          });
        }
      },
    );

    // S8-A2（V2.62 / §28-2）：确认过的分镜表 → 每镜生成参数（第二次规划）。
    // 只做参数展开：不建节点、不写画布、不提交生成；落地由前端显式执行。
    app.post(
      '/api/agent/storyboard/expand',
      {
        schema: {
          body: StoryboardExpandRequestSchema,
          response: {
            200: StoryboardExpandResponseSchema,
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            501: ErrorResponseSchema,
            502: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const apiKey = resolveLlmKey(request);
        if (apiKey === null) {
          return reply
            .code(501)
            .send(
              createErrorResponse(
                'LLM_NOT_CONFIGURED',
                '未配置分镜展开文本模型：请在设置里填入 LLM Key（本服务不提供文本侧兜底 Key）',
              ),
            );
        }
        // D75：进会话的镜头上限 16（分镜表本身 ≤20）；超限在花第二次规划的钱之前拒绝。
        if (request.body.plan.shots.length > STORYBOARD_SESSION_MAX_SHOTS) {
          return reply
            .code(400)
            .send(
              createErrorResponse(
                'INVALID_REQUEST',
                `分镜有 ${request.body.plan.shots.length} 镜，超过单次创作会话上限 ${STORYBOARD_SESSION_MAX_SHOTS} 镜（D75）：请把剧本拆成多个会话分别生成`,
              ),
            );
        }
        try {
          const result = await (deps.expand ?? generateStoryboardExpansion)({
            apiKey,
            plan: request.body.plan,
            references: request.body.references,
            ...(request.body.llm === undefined ? {} : { llm: request.body.llm }),
          });
          return {
            plan: result.plan,
            engine: 'llm' as const,
            model: result.model,
            ...(result.usage === undefined ? {} : { usage: result.usage }),
          };
        } catch (err) {
          const error =
            err instanceof ProviderFailureError
              ? err
              : new ProviderFailureError(
                  'UPSTREAM_ERROR',
                  `分镜展开失败：${err instanceof Error ? err.message : String(err)}`,
                );
          const errorResponse = createErrorResponse(error.code, error.message);
          return reply.code(ERROR_STATUS[error.code] ?? 502).send({
            ...errorResponse,
            disposition: error.dispositionOverride ?? dispositionOf(error.code),
          });
        }
      },
    );
  };
