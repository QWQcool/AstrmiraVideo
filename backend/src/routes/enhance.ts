import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ErrorResponseSchema, PromptEnhanceRequestSchema } from '@astrmira/shared';
import { createErrorResponse } from '../errors.js';

/**
 * `POST /api/prompt/enhance` —— demo 版**诚实未实现**（CONTRACT §3 / §5，决策 D24）。
 *
 * 为什么不是"规则引擎兜底"：那会让用户以为在用 LLM，属**最恶劣的静默降级**
 * （PLAN §3 铁律 4）。所以这里返回 `501` + `LLM_NOT_CONFIGURED`，前端把 ✨ 按钮置灰。
 * 完整实现（OpenAI 兼容客户端 + `LLM_PRESETS` + `X-LLM-Key`）见 PLAN §9 台账 B3。
 */
export const createEnhanceRoutes = (): FastifyPluginAsyncZod => async (app) => {
  app.post(
    '/api/prompt/enhance',
    {
      schema: {
        body: PromptEnhanceRequestSchema,
        response: { 501: ErrorResponseSchema },
      },
    },
    async (_request, reply) =>
      reply
        .code(501)
        .send(
          createErrorResponse(
            'LLM_NOT_CONFIGURED',
            '未配置扩写模型：本版本未实现 LLM 扩写（见 PLAN §9 台账 B3）',
          ),
        ),
  );
};
