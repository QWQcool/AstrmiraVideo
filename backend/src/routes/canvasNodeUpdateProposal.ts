import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  CanvasTextNodeUpdateRequestSchema,
  CanvasTextNodeUpdateResponseSchema,
  ErrorResponseSchema,
} from '@astrmira/shared';
import type { CanvasAgentContext, ErrorCode, LlmConfig } from '@astrmira/shared';
import { createErrorResponse, dispositionOf, ProviderFailureError } from '../errors.js';
import {
  proposeCanvasTextNodeUpdate,
  type CanvasNodeUpdateProposalResult,
} from '../providers/canvasNodeUpdateProposal.js';
import { resolveLlmKey } from '../security/credential.js';

/**
 * `POST /api/agent/canvas/node-update-plan`（S7-D5 / CONTRACT §26）
 *
 * 只生成选中文本节点的待确认更新方案；服务端不写 CanvasDoc。
 */
export interface CanvasNodeUpdateProposalRoutesDeps {
  propose?: (options: {
    apiKey: string;
    instruction: string;
    canvas: CanvasAgentContext;
    targetNodeId: string;
    llm?: LlmConfig;
  }) => Promise<CanvasNodeUpdateProposalResult>;
}

type UpdateErrorStatus = 400 | 401 | 501 | 502;

const ERROR_STATUS: Partial<Record<ErrorCode, UpdateErrorStatus>> = {
  LLM_NOT_CONFIGURED: 501,
  INVALID_REQUEST: 400,
  KEY_INVALID: 401,
  UPSTREAM_ERROR: 502,
};

const FALLBACK_STATUS: UpdateErrorStatus = 502;

export const createCanvasNodeUpdateProposalRoutes =
  (deps: CanvasNodeUpdateProposalRoutesDeps = {}): FastifyPluginAsyncZod =>
  async (app) => {
    app.post(
      '/api/agent/canvas/node-update-plan',
      {
        schema: {
          body: CanvasTextNodeUpdateRequestSchema,
          response: {
            200: CanvasTextNodeUpdateResponseSchema,
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            501: ErrorResponseSchema,
            502: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const body = request.body;
        const target = body.canvas.nodes.find((node) => node.id === body.targetNodeId);
        if (target === undefined || target.type !== 'text') {
          return reply
            .code(400)
            .send(
              createErrorResponse(
                'INVALID_REQUEST',
                '只能更新当前画布中已选中的文本节点',
              ),
            );
        }

        const apiKey = resolveLlmKey(request);
        if (apiKey === null) {
          return reply
            .code(501)
            .send(
              createErrorResponse(
                'LLM_NOT_CONFIGURED',
                '未配置画布节点更新文本模型：请在设置里填入 LLM Key（本服务不提供文本侧兜底 Key）',
              ),
            );
        }

        try {
          const result = await (deps.propose ?? proposeCanvasTextNodeUpdate)({
            apiKey,
            instruction: body.instruction.trim(),
            canvas: body.canvas,
            targetNodeId: body.targetNodeId,
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
                  `画布节点更新方案失败：${err instanceof Error ? err.message : String(err)}`,
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
