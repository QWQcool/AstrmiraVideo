import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ErrorResponseSchema,
  StoryboardRequestSchema,
  StoryboardResponseSchema,
} from '@astrmira/shared';
import type { CanvasAgentContext, ErrorCode, LlmConfig } from '@astrmira/shared';
import { createErrorResponse, dispositionOf, ProviderFailureError } from '../errors.js';
import {
  generateStoryboardPlan,
  type StoryboardPlanResult,
} from '../providers/storyboardPlan.js';
import { resolveLlmKey } from '../security/credential.js';

/** `POST /api/agent/storyboard`（P5）——只生成分镜表，不写画布/不生成媒体。 */
export interface StoryboardRoutesDeps {
  generate?: (options: {
    apiKey: string;
    instruction: string;
    canvas?: CanvasAgentContext;
    llm?: LlmConfig;
  }) => Promise<StoryboardPlanResult>;
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
  };
