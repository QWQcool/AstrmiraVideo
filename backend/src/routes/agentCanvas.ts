import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  CanvasAgentRequestSchema,
  CanvasAgentResponseSchema,
  ErrorResponseSchema,
} from '@astrmira/shared';
import type { CanvasAgentContext, ErrorCode, LlmConfig } from '@astrmira/shared';
import { createErrorResponse, dispositionOf, ProviderFailureError } from '../errors.js';
import { askCanvasWithLlm, type CanvasAgentResult } from '../providers/agentCanvas.js';
import { resolveLlmKey } from '../security/credential.js';

/**
 * `POST /api/agent/canvas`（S7-D1 / CONTRACT §24）
 *
 * 只读问答：请求是快照，响应是文本；**没有任何画布写操作字段**。
 * Key 仍只走 `X-LLM-Key`，服务端不设兜底 Key。
 */
export interface AgentCanvasRoutesDeps {
  ask?: (options: {
    apiKey: string;
    question: string;
    canvas: CanvasAgentContext;
    llm?: LlmConfig;
  }) => Promise<CanvasAgentResult>;
}

type AgentCanvasErrorStatus = 400 | 401 | 501 | 502;

const ERROR_STATUS: Partial<Record<ErrorCode, AgentCanvasErrorStatus>> = {
  LLM_NOT_CONFIGURED: 501,
  INVALID_REQUEST: 400,
  KEY_INVALID: 401,
  UPSTREAM_ERROR: 502,
};

const FALLBACK_STATUS: AgentCanvasErrorStatus = 502;

export const createAgentCanvasRoutes =
  (deps: AgentCanvasRoutesDeps = {}): FastifyPluginAsyncZod =>
  async (app) => {
    app.post(
      '/api/agent/canvas',
      {
        schema: {
          body: CanvasAgentRequestSchema,
          response: {
            200: CanvasAgentResponseSchema,
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            501: ErrorResponseSchema,
            502: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const body = request.body;
        const question = body.question.trim();
        if (question === '') {
          return reply
            .code(400)
            .send(createErrorResponse('INVALID_REQUEST', '画布助手问题不能为空'));
        }
        if (body.canvas.truncated && body.canvas.nodes.length === 0) {
          return reply
            .code(400)
            .send(createErrorResponse('INVALID_REQUEST', '画布快照为空，无法回答'));
        }

        const apiKey = resolveLlmKey(request);
        if (apiKey === null) {
          return reply
            .code(501)
            .send(
              createErrorResponse(
                'LLM_NOT_CONFIGURED',
                '未配置画布助手文本模型：请在设置里填入 LLM Key（本服务不提供文本侧兜底 Key）',
              ),
            );
        }

        try {
          const result = await (deps.ask ?? askCanvasWithLlm)({
            apiKey,
            question,
            canvas: body.canvas,
            ...(body.llm === undefined ? {} : { llm: body.llm }),
          });
          return {
            answer: result.answer,
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
                  `画布助手失败：${err instanceof Error ? err.message : String(err)}`,
                );
          const errorResponse = createErrorResponse(error.code, error.message);
          return reply.code(ERROR_STATUS[error.code] ?? FALLBACK_STATUS).send({
            ...errorResponse,
            disposition: error.dispositionOverride ?? dispositionOf(error.code),
          });
        }
      },
    );
  };
