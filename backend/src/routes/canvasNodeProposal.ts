import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  CanvasNodeProposalRequestSchema,
  CanvasNodeProposalResponseSchema,
  ErrorResponseSchema,
} from '@astrmira/shared';
import type { CanvasAgentContext, ErrorCode, LlmConfig } from '@astrmira/shared';
import { createErrorResponse, dispositionOf, ProviderFailureError } from '../errors.js';
import {
  proposeCanvasTextNode,
  type CanvasNodeProposalResult,
} from '../providers/canvasNodeProposal.js';
import { resolveLlmKey } from '../security/credential.js';

/**
 * `POST /api/agent/canvas/node-plan`（S7-D2 / CONTRACT §25）
 *
 * 只生成一张"待确认"的文本节点方案；**不写 CanvasDoc**。
 * 确认与落节点由前端完成，服务端没有画布写入权限。
 */
export interface CanvasNodeProposalRoutesDeps {
  propose?: (options: {
    apiKey: string;
    instruction: string;
    canvas: CanvasAgentContext;
    llm?: LlmConfig;
  }) => Promise<CanvasNodeProposalResult>;
}

type ProposalErrorStatus = 400 | 401 | 501 | 502;

const ERROR_STATUS: Partial<Record<ErrorCode, ProposalErrorStatus>> = {
  LLM_NOT_CONFIGURED: 501,
  INVALID_REQUEST: 400,
  KEY_INVALID: 401,
  UPSTREAM_ERROR: 502,
};

const FALLBACK_STATUS: ProposalErrorStatus = 502;

export const createCanvasNodeProposalRoutes =
  (deps: CanvasNodeProposalRoutesDeps = {}): FastifyPluginAsyncZod =>
  async (app) => {
    app.post(
      '/api/agent/canvas/node-plan',
      {
        schema: {
          body: CanvasNodeProposalRequestSchema,
          response: {
            200: CanvasNodeProposalResponseSchema,
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            501: ErrorResponseSchema,
            502: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const body = request.body;
        const instruction = body.instruction.trim();
        if (instruction === '') {
          return reply
            .code(400)
            .send(createErrorResponse('INVALID_REQUEST', '创建节点的要求不能为空'));
        }

        const apiKey = resolveLlmKey(request);
        if (apiKey === null) {
          return reply
            .code(501)
            .send(
              createErrorResponse(
                'LLM_NOT_CONFIGURED',
                '未配置画布节点方案文本模型：请在设置里填入 LLM Key（本服务不提供文本侧兜底 Key）',
              ),
            );
        }

        try {
          const result = await (deps.propose ?? proposeCanvasTextNode)({
            apiKey,
            instruction,
            canvas: body.canvas,
            ...(body.llm === undefined ? {} : { llm: body.llm }),
          });
          return {
            proposal: result.proposal,
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
                  `画布节点方案失败：${err instanceof Error ? err.message : String(err)}`,
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
