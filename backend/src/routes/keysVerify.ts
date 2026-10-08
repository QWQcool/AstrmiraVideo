import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ErrorResponseSchema,
  KeyVerifyRequestSchema,
  KeyVerifyResponseSchema,
} from '@astrmira/shared';
import type { ErrorCode, KeyVerifyResponse } from '@astrmira/shared';
import { createErrorResponse } from '../errors.js';
import { resolveLlmEndpoint } from '../providers/llm.js';
import {
  SEEDANCE_DEFAULT_BASE_URL,
  SEEDANCE_MODELS_PATH,
  SEEDANCE_TASKS_PATH,
} from '../providers/seedanceProtocol.js';
import { LLM_KEY_HEADER, PROVIDER_KEY_HEADER, resolveLlmKey, resolveProviderKey } from '../security/credential.js';
import { rateLimitKey, resolveClientIp, type BurstLimiter } from '../security/rateLimit.js';
import { redactSecrets } from '../security/redact.js';

/**
 * `POST /api/providers/keys/verify` —— 凭据与模型校验（CONTRACT §9 V2.1，落地 PLAN §9 台账 B2）。
 *
 * ## 为什么这个接口是"必须做"
 * 2026-09-23 的线上故障里，用户是**花了一次真实提交**才拿到 `模型不存在` 的报错，
 * 而"模型 id 对不对"本可以在提交之前零成本回答。
 *
 * ## 零费用的两条探测（细节见 packages/shared/src/verify.ts 的注释）
 * - 视频轨：`GET {baseUrl}/models` 找 id + `POST {tasks}` 带**空 content**
 *   （存在且开通 → 400 参数错；不存在/未开通 → 404；**不会建任务**）。
 *   万一意外返回任务 id（协议未来变化），**立刻 DELETE 取消**并把这件事写进 message。
 * - 文本轨：`POST /chat/completions` `max_tokens: 1`（200 = 可用）。
 *
 * ## 凭据与红线
 * 与两条轨的实际调用完全一致：视频用 `X-Provider-Key`、文本用 `X-LLM-Key`；
 * Key 不进日志、不进响应（本文件所有对外文本都过 `redactSecrets`）。
 */
export interface KeyVerifyDeps {
  /** 注入 fetch（测试用桩；缺省 = 全局 fetch） */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /**
   * V2.8（台账 B25）：**独立限流桶**（`verify`，10s 内最多 5 次/IP，见 `security/rateLimit.ts`）。
   * 为什么必须有：本端点会向上游发真实探测请求，被刷等于拿部署者的服务器当免费探针；
   * 与生成任务的 60s 冷却**各自计桶**（同一 IP 在校验被限不影响提交生成，反之亦然）。
   */
  limiter?: BurstLimiter;
}

type VerifyStatus = 200 | 400 | 401 | 429 | 501 | 502;

/** 错误码 → HTTP 状态（刻意局部定义，与 enhance.ts 同一理由：每个路由的场景语义不同） */
const VERIFY_ERROR_STATUS: Partial<Record<ErrorCode, VerifyStatus>> = {
  KEY_MISSING: 501,
  KEY_INVALID: 401,
  PROMPT_REJECTED: 400,
  UPSTREAM_ERROR: 502,
};

interface ProbeOutcome {
  keyValid: boolean;
  /** `null` = 该端点不提供/不可得 */
  modelIds: string[] | null;
  modelAvailable: boolean | null;
  notes: string[];
}

function extractModelIds(payload: unknown): string[] | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  const ids = data
    .map((item) =>
      typeof item === 'object' && item !== null ? (item as { id?: unknown }).id : undefined,
    )
    .filter((id): id is string => typeof id === 'string' && id.trim() !== '');
  return ids.length === 0 ? null : ids;
}

function readUpstreamCode(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return '';
  const error = (payload as { error?: { code?: unknown } }).error;
  return typeof error?.code === 'string' ? error.code : '';
}

/** 视频轨探测：`/models` 清单 + 空 content 提交探针 */
async function probeVideo(
  baseUrl: string,
  apiKey: string,
  model: string | undefined,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<ProbeOutcome> {
  const notes: string[] = [];
  let modelIds: string[] | null = null;

  const listResponse = await fetchImpl(`${baseUrl}${SEEDANCE_MODELS_PATH}`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => null);

  if (listResponse === null) {
    throw new Error('连接上游失败（/models 不可达）');
  }
  if (listResponse.status === 401 || listResponse.status === 403) {
    return { keyValid: false, modelIds: null, modelAvailable: null, notes: ['凭据被上游拒绝'] };
  }
  if (listResponse.ok) {
    modelIds = extractModelIds(await listResponse.json().catch(() => null));
  }

  if (model === undefined) {
    notes.push(
      modelIds === null
        ? '未提供模型，且上游未返回模型清单：仅验证了凭据'
        : `未提供模型：凭据有效，上游共 ${modelIds.length} 个模型可选`,
    );
    return { keyValid: true, modelIds, modelAvailable: null, notes };
  }

  // 空 content：这是"探测"而不是"生成"——上游会先在参数校验处失败。
  const probeResponse = await fetchImpl(`${baseUrl}${SEEDANCE_TASKS_PATH}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, content: [] }),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => null);

  if (probeResponse === null) {
    throw new Error('连接上游失败（提交探针不可达）');
  }

  const payload = await probeResponse.json().catch(() => null);

  if (probeResponse.ok) {
    // 安全网：协议若变化到"空 content 也能建任务"，必须立刻取消并如实告知（绝不悄悄留下一个计费任务）
    const taskId = (payload as { id?: unknown } | null)?.id;
    if (typeof taskId === 'string') {
      await fetchImpl(`${baseUrl}${SEEDANCE_TASKS_PATH}/${encodeURIComponent(taskId)}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
      }).catch(() => null);
      notes.push(`意外创建了任务 ${taskId}，已立刻取消；请到方舟控制台确认无残留计费`);
    }
    return { keyValid: true, modelIds, modelAvailable: true, notes };
  }

  if (probeResponse.status === 404) {
    notes.push('模型或接入点不存在 / 未开通该模型服务');
    return { keyValid: true, modelIds, modelAvailable: false, notes };
  }

  if (probeResponse.status === 401 || probeResponse.status === 403) {
    return { keyValid: false, modelIds, modelAvailable: null, notes: ['凭据被上游拒绝'] };
  }

  // 400 参数错 = 模型被接受（这正是我们要的结论）；其它 4xx 同理按"模型存在"处理并附原码
  notes.push(
    `上游返回 HTTP ${probeResponse.status}${
      readUpstreamCode(payload) === '' ? '' : `（${readUpstreamCode(payload)}）`
    }：模型被接受（参数校验先失败是预期行为）`,
  );
  return { keyValid: true, modelIds, modelAvailable: true, notes };
}

/** 文本轨探测：`max_tokens: 1` 的对话请求（200 = 可用） */
async function probeText(
  baseUrl: string,
  apiKey: string,
  model: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<ProbeOutcome> {
  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => null);

  if (response === null) throw new Error('连接上游失败');

  if (response.status === 401 || response.status === 403) {
    return { keyValid: false, modelIds: null, modelAvailable: null, notes: ['凭据被上游拒绝'] };
  }
  if (response.ok) {
    return {
      keyValid: true,
      modelIds: null,
      modelAvailable: true,
      notes: ['已用 1 token 的最小请求验证（费用近乎 0）'],
    };
  }
  if (response.status === 404) {
    return {
      keyValid: true,
      modelIds: null,
      modelAvailable: false,
      notes: ['模型不存在或未开通（方舟文本模型需在控制台「开通管理」里开通）'],
    };
  }

  const payload = await response.json().catch(() => null);
  return {
    keyValid: true,
    modelIds: null,
    modelAvailable: null,
    notes: [`上游返回 HTTP ${response.status}${readUpstreamCode(payload) === '' ? '' : `（${readUpstreamCode(payload)}）`}`],
  };
}

export const createKeyVerifyRoutes =
  (deps: KeyVerifyDeps = {}): FastifyPluginAsyncZod =>
  async (app) => {
    app.post(
      '/api/providers/keys/verify',
      {
        schema: {
          body: KeyVerifyRequestSchema,
          response: {
            200: KeyVerifyResponseSchema,
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            429: ErrorResponseSchema,
            501: ErrorResponseSchema,
            502: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const fetchImpl = deps.fetchImpl ?? fetch;
        const timeoutMs = deps.timeoutMs ?? 20_000;

        // V2.8（B25）：独立限流桶 —— `take()` 一次完成"判定 + 记账"，且**在探测之前**记账
        // （失败也占配额，否则"故意让它失败"就成了绕过限流的办法）。与生成冷却互不影响。
        if (deps.limiter !== undefined) {
          const decision = deps.limiter.take(rateLimitKey({ ip: resolveClientIp(request) }));
          if (!decision.allowed) {
            const retryAfterSec = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
            return reply
              .code(429)
              .header('retry-after', String(retryAfterSec))
              .send(
                createErrorResponse(
                  'RATE_LIMITED',
                  `校验请求过于频繁：本端点限 10 秒 5 次（不影响生成任务的冷却），请 ${retryAfterSec} 秒后重试`,
                ),
              );
          }
        }

        const body = request.body;
        const isVideo = body.track === 'video';
        const apiKey = isVideo ? resolveProviderKey(request) : resolveLlmKey(request);
        const headerName = isVideo ? PROVIDER_KEY_HEADER : LLM_KEY_HEADER;

        if (apiKey === null) {
          return reply
            .code(501)
            .send(
              createErrorResponse(
                'KEY_MISSING',
                `${isVideo ? '视频' : '文本'}轨未提供凭据：请在「凭据设置（BYOK）」里填写对应 Key（请求头 ${headerName}）`,
              ),
            );
        }

        let baseUrl: string;
        let model: string | undefined;
        try {
          if (isVideo) {
            const envBaseUrl = process.env.VOLCANO_BASE_URL?.trim();
            baseUrl =
              body.baseUrl ?? (envBaseUrl === undefined || envBaseUrl === '' ? SEEDANCE_DEFAULT_BASE_URL : envBaseUrl);
            model = body.model ?? process.env.VOLCANO_MODEL_NAME?.trim() ?? undefined;
          } else {
            const endpoint = resolveLlmEndpoint({
              ...(body.preset === undefined ? {} : { preset: body.preset }),
              ...(body.baseUrl === undefined ? {} : { baseUrl: body.baseUrl }),
              ...(body.model === undefined ? {} : { model: body.model }),
            });
            baseUrl = endpoint.baseUrl;
            model = endpoint.model;
          }
        } catch (err) {
          return reply
            .code(501)
            .send(
              createErrorResponse(
                'LLM_NOT_CONFIGURED',
                `端点未配置完整：${err instanceof Error ? err.message : String(err)}`,
              ),
            );
        }

        try {
          const outcome = isVideo
            ? await probeVideo(baseUrl.replace(/\/+$/, ''), apiKey, model, fetchImpl, timeoutMs)
            : await probeText(baseUrl, apiKey, model ?? '', fetchImpl, timeoutMs);

          const modelListed =
            model === undefined || outcome.modelIds === null ? null : outcome.modelIds.includes(model);
          if (model !== undefined && modelListed === false) {
            outcome.notes.push('该模型 id 不在上游返回的清单里（可能是拼写问题或接入点 id）');
          }

          const summary = outcome.keyValid
            ? model === undefined
              ? `凭据有效。${outcome.notes.join('；')}`
              : outcome.modelAvailable === true
                ? `凭据有效，模型 \`${model}\` 可用。${outcome.notes.join('；')}`
                : `凭据有效，但模型 \`${model}\` 不可用。${outcome.notes.join('；')}`
            : `凭据无效：${outcome.notes.join('；')}`;

          const payload: KeyVerifyResponse = {
            keyValid: outcome.keyValid,
            totalModels: outcome.modelIds === null ? null : outcome.modelIds.length,
            modelListed,
            modelAvailable: outcome.modelAvailable,
            message: redactSecrets(summary, apiKey),
          };

          // 凭据本身无效 → 用 401 明确表达（前端据此把"Key 填错了"与"模型没开通"分开讲）
          return outcome.keyValid ? payload : reply.code(401).send(createErrorResponse(
            'KEY_INVALID',
            redactSecrets(`上游拒绝该凭据：${outcome.notes.join('；')}`, apiKey),
          ));
        } catch (err) {
          return reply
            .code(VERIFY_ERROR_STATUS.UPSTREAM_ERROR ?? 502)
            .send(
              createErrorResponse(
                'UPSTREAM_ERROR',
                redactSecrets(
                  `校验失败：${err instanceof Error ? err.message : String(err)}`,
                  apiKey,
                ),
              ),
            );
        }
      },
    );
  };
