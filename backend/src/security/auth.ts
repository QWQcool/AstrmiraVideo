import type { FastifyReply, FastifyRequest } from 'fastify';
import { createErrorResponse } from '../errors.js';
import { resolveClientIp } from './rateLimit.js';

/**
 * 公网最小鉴权（PLAN §7-4 / 决策 D21 + D25）：单 Bearer Token + 回环免鉴权。
 *
 * **免鉴权名单（两层，口径唯一）**：
 * ① **回环来源**（127.0.0.1 / ::1 / ::ffff:127.0.0.1）的**全部**请求 —— 单机开发零摩擦；
 * ② **任何来源**的 `/api/health` —— 存活探针。
 * 除这两层外一律要求 `Authorization: Bearer <PUBLIC_API_TOKEN>`。
 *
 * 生产护栏：`NODE_ENV=production` 且未配置 Token → **启动即拒绝**（不允许匿名刷付费接口）。
 */

/**
 * 免鉴权名单（**任何来源**均可访问）。
 *
 * V2.16（台账 B53）新增 `/api/health/live`：**存活探针必须能被编排器无凭据访问**
 * （K8s 的 livenessProbe 不会带 Bearer）。`/api/health/ready` 与 `/api/metrics`
 * **刻意不在名单里** —— 它们会暴露部署内部细节（磁盘、数据库体积、积压），
 * 探针自己带上 `Authorization: Bearer <PUBLIC_API_TOKEN>` 即可（写在 GUIDE §十一）。
 */
export const ALWAYS_PUBLIC_PATHS: readonly string[] = ['/api/health', '/api/health/live'];

export function isLoopbackIp(ip: string): boolean {
  return (
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip === '127.0.0.1' ||
    ip.startsWith('127.')
  );
}

export function resolveAuthToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.PUBLIC_API_TOKEN;
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined;
}

/** 启动期校验：生产环境必须配置 Token */
export function assertAuthConfiguredForProduction(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production' && resolveAuthToken(env) === undefined) {
    throw new Error(
      '生产环境必须配置 PUBLIC_API_TOKEN（PLAN §7-4「公网最小鉴权」）：否则任何匿名请求都能触发付费生成',
    );
  }
}

function isAlwaysPublic(path: string): boolean {
  return ALWAYS_PUBLIC_PATHS.includes(path);
}

/**
 * onRequest 钩子：不通过则直接 401。
 *
 * 说明：访问令牌缺失复用 `KEY_MISSING`（contract 的 12 个码里没有更贴切的）
 * —— 见本次片尾证据的偏差报备。
 */
export function createAuthHook(token: string | undefined) {
  return async function authHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const path = request.url.split('?')[0] ?? '';

    if (isAlwaysPublic(path)) return; // ② 任何来源均可
    if (isLoopbackIp(resolveClientIp(request))) return; // ① 回环来源

    if (token === undefined) return; // 未配置（非生产）：放行，由启动日志警示

    const header = request.headers.authorization;
    const value = Array.isArray(header) ? header[0] : header;

    if (value !== `Bearer ${token}`) {
      await reply
        .code(401)
        .send(createErrorResponse('KEY_MISSING', '缺少访问令牌（Authorization: Bearer <token>）'));
    }
  };
}
