import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  AgentPlanRequestSchema,
  AgentPlanResponseSchema,
  BUILTIN_SKILLS,
  ErrorResponseSchema,
} from '@astrmira/shared';
import type { AgentPlan, ErrorCode, LlmConfig, SkillManifest } from '@astrmira/shared';
import { createErrorResponse, dispositionOf, ProviderFailureError } from '../errors.js';
import { planWithLlm } from '../providers/agent.js';
import { resolveLlmKey } from '../security/credential.js';

/**
 * `POST /api/agent/plan`（S6-B1 / CONTRACT §23）
 *
 * 纯规划：只返回结构化计划，**不创建任务、不调用生成**。
 * 文本 Key 仍走 `X-LLM-Key`，服务端不设兜底 Key。
 *
 * 错误口径：
 * - 无 Key → 501 `LLM_NOT_CONFIGURED`
 * - 计划结构/能力校验失败 → 400 `INVALID_REQUEST`
 * - 上游拒绝 Key → 401 `KEY_INVALID`
 * - 上游不可达/非 JSON → 502 `UPSTREAM_ERROR`
 *
 * 不新增错误码；`INVALID_REQUEST` 的语义正是“形状合法但组合不可执行”。
 */

export interface AgentRoutesDeps {
  /** 测试注入；缺省走真实 OpenAI 兼容实现 */
  plan?: (options: {
    apiKey: string;
    intent: string;
    skills: readonly SkillManifest[];
    llm?: LlmConfig;
  }) => Promise<{ plan: AgentPlan; model: string; usage?: { promptTokens: number; completionTokens: number } }>;
}

type AgentErrorStatus = 400 | 401 | 501 | 502;

const AGENT_ERROR_STATUS: Partial<Record<ErrorCode, AgentErrorStatus>> = {
  LLM_NOT_CONFIGURED: 501,
  INVALID_REQUEST: 400,
  KEY_INVALID: 401,
  UPSTREAM_ERROR: 502,
};

const FALLBACK_STATUS: AgentErrorStatus = 502;

function buildCatalog(extra: readonly SkillManifest[]): SkillManifest[] | string {
  const catalog = [...BUILTIN_SKILLS];
  const ids = new Set(catalog.map((skill) => skill.id));
  for (const skill of extra) {
    if (ids.has(skill.id)) {
      return `技能 id 冲突：${skill.id}（不能覆盖内置或重复的自建技能）`;
    }
    ids.add(skill.id);
    catalog.push(skill);
  }
  return catalog;
}

export const createAgentRoutes =
  (deps: AgentRoutesDeps = {}): FastifyPluginAsyncZod =>
  async (app) => {
    app.post(
      '/api/agent/plan',
      {
        schema: {
          body: AgentPlanRequestSchema,
          response: {
            200: AgentPlanResponseSchema,
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            501: ErrorResponseSchema,
            502: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const body = request.body;
        const intent = body.intent.trim();
        if (intent === '') {
          return reply
            .code(400)
            .send(createErrorResponse('INVALID_REQUEST', 'Agent 意图不能为空'));
        }

        const catalog = buildCatalog(body.skills);
        if (typeof catalog === 'string') {
          return reply.code(400).send(createErrorResponse('INVALID_REQUEST', catalog));
        }

        const apiKey = resolveLlmKey(request);
        if (apiKey === null) {
          return reply
            .code(501)
            .send(
              createErrorResponse(
                'LLM_NOT_CONFIGURED',
                '未配置 Agent 文本模型：请在设置里填入 LLM Key（本服务不提供文本侧兜底 Key）',
              ),
            );
        }

        try {
          const result = await (deps.plan ?? planWithLlm)({
            apiKey,
            intent,
            skills: catalog,
            ...(body.llm === undefined ? {} : { llm: body.llm }),
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
                  `Agent 规划失败：${err instanceof Error ? err.message : String(err)}`,
                );
          const errorResponse = createErrorResponse(error.code, error.message);
          return reply.code(AGENT_ERROR_STATUS[error.code] ?? FALLBACK_STATUS).send({
            ...errorResponse,
            disposition: error.dispositionOverride ?? dispositionOf(error.code),
          });
        }
      },
    );
  };
