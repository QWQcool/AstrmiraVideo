import { createHash, randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ErrorResponseSchema,
  GenerateResponseSchema,
  VideoGenerateRequestSchema,
} from '@astrmira/shared';
import type { ProviderType, VideoGenerateRequest, VideoProvider } from '@astrmira/shared';
import { createErrorResponse } from '../errors.js';
import type { JobQueue } from '../queue/JobQueue.js';
import type { CooldownStore } from '../security/rateLimit.js';
import { rateLimitKey, resolveClientIp } from '../security/rateLimit.js';
import type { TaskStore, TrackId } from '../store/taskStore.js';

/**
 * `POST /api/generate`（CONTRACT §5）。
 *
 * 幂等键语义（CONTRACT §5）：
 * - 请求头 `Idempotency-Key` 优先；缺省时按「provider + 请求指纹」生成；
 * - **同一幂等键重复提交返回同一 `taskId`，不产生第二次上游调用**。
 *
 * 防线 5（60s 防抖）属 S4；此处只做"提交"这一件事。
 */

export interface GenerateRoutesDeps {
  store: TaskStore;
  queue: JobQueue;
  resolveProvider: (id: ProviderType) => VideoProvider | null;
  /** 防线 5 冷却；缺省则不启用限流（测试可省略，生产必须传入） */
  cooldown?: CooldownStore;
}

/** 请求指纹（provider + 规范化请求体） */
export function fingerprintRequest(request: VideoGenerateRequest): string {
  const normalized = JSON.stringify({
    prompt: request.prompt,
    mode: request.mode,
    aspectRatio: request.aspectRatio,
    assets: request.assets ?? null,
    params: request.params ?? null,
    provider: request.provider,
  });
  return `fp-${createHash('sha256').update(normalized).digest('hex').slice(0, 32)}`;
}

export function resolveIdempotencyKey(
  request: FastifyRequest,
  body: VideoGenerateRequest,
): string {
  const raw = request.headers['idempotency-key'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header === 'string' && header.trim() !== '') {
    return header.trim();
  }
  return fingerprintRequest(body);
}

/** 调度轨判定：云端并发轨 vs 本地单卡互斥轨（PLAN §1 / §6-D26） */
export function trackFor(provider: ProviderType): TrackId {
  return provider === 'cloud-volcano-seedance' ? 'cloud' : 'local';
}

export const createGenerateRoutes =
  (deps: GenerateRoutesDeps): FastifyPluginAsyncZod =>
  async (app) => {
    app.post(
      '/api/generate',
      {
        schema: {
          body: VideoGenerateRequestSchema,
          response: {
            200: GenerateResponseSchema,
            429: ErrorResponseSchema,
            503: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const body = request.body;

        const provider = deps.resolveProvider(body.provider);
        if (provider === null) {
          // 不静默降级：未实现 / 未启用的引擎必须显式报错（PLAN §3 铁律 4）
          return reply.code(503).send({
            code: 'PROVIDER_UNAVAILABLE',
            message: `provider 未实现或未启用：${body.provider}（见 CONTRACT §4 与 PLAN §9 台账）`,
            disposition: 'terminal',
          });
        }

        const idempotencyKey = resolveIdempotencyKey(request, body);

        // 幂等重放优先：返回既有任务**不消耗**冷却窗口（否则客户端重试会被 429 挡住）
        const existing = deps.store.findTaskIdByIdempotencyKey(idempotencyKey);
        if (existing !== null) {
          return { taskId: existing };
        }

        // 防线 5：60s 防抖（Step 2 按来源 IP 单键；复合键 IP + Key 指纹见 PLAN §7-5 的 Step 5 时点）
        const cooldownKey = rateLimitKey({ ip: resolveClientIp(request) });
        const decision = deps.cooldown?.check(cooldownKey);
        if (decision !== undefined && !decision.allowed) {
          return reply.code(429).send(
            createErrorResponse(
              'RATE_LIMITED',
              `提交过于频繁：请在 ${Math.ceil(decision.retryAfterMs / 1000)}s 后重试`,
            ),
          );
        }

        const taskId = randomUUID();
        await deps.queue.submit({
          taskId,
          track: trackFor(body.provider),
          request: body,
          idempotencyKey,
          // 「即将提交」标记：在真正触达上游之前先落库（CONTRACT §5，防线 7 前提）
          submitting: true,
        });

        // 入队成功才进冷却（入队失败不该罚用户等 60s）
        deps.cooldown?.record(cooldownKey);

        return { taskId };
      },
    );
  };
