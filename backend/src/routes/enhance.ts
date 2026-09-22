import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ErrorResponseSchema,
  PromptEnhanceRequestSchema,
  PromptEnhanceResponseSchema,
} from '@astrmira/shared';
import type { ErrorCode, GenerationMode, LlmConfig, PromptEnhanceStyle } from '@astrmira/shared';
import { createErrorResponse, dispositionOf, ProviderFailureError } from '../errors.js';
import { enhancePromptWithLlm, type EnhancePromptResult } from '../providers/llm.js';
import { resolveLlmKey } from '../security/credential.js';
import { MAX_PROMPT_CHARS } from './generate.js';

/**
 * `POST /api/prompt/enhance` —— 提示词扩写（CONTRACT §3 V2.0，落地 PLAN §9 台账 B3）。
 *
 * ## 纯 BYOK（用户拍板）
 * 服务端**不设**文本侧兜底 Key。因此本路由有两条互斥分支：
 * - 请求头没有 `X-LLM-Key` → **501 `LLM_NOT_CONFIGURED`**（"没配"的诚实回答，不假装能用）；
 * - 有 Key → 真调上游；上游拒绝凭据 → **401 `KEY_INVALID`**；其余上游故障 → **502 `UPSTREAM_ERROR`**。
 *
 * ## 为什么返回体必须带 `engine`
 * `engine`（`'llm' | 'rules'`，必填）是"是否静默降级"唯一可证伪的标记：
 * 本实现**只可能**返回 `'llm'`，任何"用规则引擎拼一段像扩写的文案"都会在类型层与测试层露馅
 * （PLAN §3 铁律 4 / §6-D24）。
 *
 * ## 超时归 `UPSTREAM_ERROR` 而不是 `UNCERTAIN_RESULT`
 * 硬规则 2 的适用范围是**有持久副作用的任务型上游**（视频生成、素材下载）；
 * 文本扩写没有副作用，重试不会重复计费，因此按 D28 收窄，超时/无响应 = 可重试的上游错误。
 */
export interface EnhanceRoutesDeps {
  /** 注入执行者（测试用桩）；缺省 = 真实的 OpenAI 兼容实现 */
  enhance?: (options: {
    apiKey: string;
    originalPrompt: string;
    style?: PromptEnhanceStyle;
    mode?: GenerationMode;
    llm?: LlmConfig;
  }) => Promise<EnhancePromptResult>;
}

/**
 * 本路由可能产生的错误码 → HTTP 状态。
 * 刻意**局部**定义：其它路由对同一个码的用法不同（如 `PROVIDER_UNAVAILABLE` 在 `/api/generate` 是 503），
 * 一张全局表会把"每个路由的场景语义"压成一个数字，反而更容易改错。
 */
/** 只能是本路由注册过的响应码（`reply.code()` 的字面量约束，顺带防"写了状态码却没挂 schema"） */
type EnhanceErrorStatus = 400 | 401 | 501 | 502;

const ENHANCE_ERROR_STATUS: Partial<Record<ErrorCode, EnhanceErrorStatus>> = {
  LLM_NOT_CONFIGURED: 501,
  PROMPT_REJECTED: 400,
  KEY_INVALID: 401,
  UPSTREAM_ERROR: 502,
};

const FALLBACK_STATUS: EnhanceErrorStatus = 502;

export const createEnhanceRoutes =
  (deps: EnhanceRoutesDeps = {}): FastifyPluginAsyncZod =>
  async (app) => {
    app.post(
      '/api/prompt/enhance',
      {
        schema: {
          body: PromptEnhanceRequestSchema,
          response: {
            200: PromptEnhanceResponseSchema,
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            501: ErrorResponseSchema,
            502: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const body = request.body;

        // 与 `/api/generate` 同一套提示词纪律（空 / 超长 → PROMPT_REJECTED），
        // 上限共用 `MAX_PROMPT_CHARS`，避免两条路由各写一个数字
        const originalPrompt = body.originalPrompt.trim();
        if (originalPrompt === '') {
          return reply.code(400).send(createErrorResponse('PROMPT_REJECTED', '待扩写的提示词不能为空'));
        }
        if (originalPrompt.length > MAX_PROMPT_CHARS) {
          return reply.code(400).send(
            createErrorResponse(
              'PROMPT_REJECTED',
              `提示词过长：上限 ${MAX_PROMPT_CHARS} 字符，当前 ${originalPrompt.length} 字符`,
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
                '未配置扩写模型：请在设置里填入 LLM Key（本服务不提供文本侧兜底 Key，纯 BYOK）',
              ),
            );
        }

        try {
          const result = await (deps.enhance ?? enhancePromptWithLlm)({
            apiKey,
            originalPrompt,
            ...(body.style === undefined ? {} : { style: body.style }),
            ...(body.mode === undefined ? {} : { mode: body.mode }),
            ...(body.llm === undefined ? {} : { llm: body.llm }),
          });

          // `engine: 'llm'` 是硬编码的字面量，不是从上游推断出来的：
          // 走到这一行就意味着"确实调了模型"，这才使该字段具备证明力。
          return { ...result, engine: 'llm' as const };
        } catch (err) {
          const error =
            err instanceof ProviderFailureError
              ? err
              : new ProviderFailureError(
                  'UPSTREAM_ERROR',
                  `扩写失败：${err instanceof Error ? err.message : String(err)}`,
                );

          const errorResponse = createErrorResponse(error.code, error.message);
          return reply.code(ENHANCE_ERROR_STATUS[error.code] ?? FALLBACK_STATUS).send({
            ...errorResponse,
            // 显式覆盖只在 provider 声明了它时生效（与 `resolveTaskError` 同一口径）
            disposition: error.dispositionOverride ?? dispositionOf(error.code),
          });
        }
      },
    );
  };
