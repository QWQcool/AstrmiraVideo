import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EventLogStore, NewEventLogEntry } from '../store/eventLog.js';
import { collectRequestSecrets, redactSecrets } from '../security/redact.js';

/**
 * 请求级操作日志钩子（CONTRACT §10，V2.1）。
 *
 * ## 噪声纪律（这一节决定了日志能不能用）
 * 日志页本身每 2s 轮询一次、任务进度也是 2s 一次 —— 如果把它们全记下来，
 * 真正的"操作"会被埋在几千条 `GET /api/tasks/:id` 里，功能等于白做。
 * 因此**只记**：
 * - 所有**写**操作（POST / PUT / PATCH / DELETE）—— 用户的动作都在这；
 * - 任何**失败**的请求（`status >= 400`，包括读操作的失败：404 TASK_NOT_FOUND 之类要能看到）；
 * - `/api/*` 之外的路径不记（前端产物 `/`、`/assets/*` 由 SPA 提供，记了没意义）；
 * 明确**不记**：`/media/*`（一次播放几十条 Range 请求）、`/api/health`（探活会被监控刷爆）、
 * `/api/logs*`（日志页自己轮询 —— 不排除就会自我增殖）、`OPTIONS` 预检。
 *
 * ## 凭据纪律
 * 请求体入库前过 `redactSecrets`；请求头从不入库（只取 IP / UA）。
 * Key 的"唯一载体是请求头"这条（CONTRACT §5）在这里也是硬约束：
 * 即便有人在 body 里塞了 Key（不合规用法），擦除规则也会把它抹掉。
 */

/** 请求体入库上限：超过就截断（multipart 另有处理，绝不记二进制） */
const MAX_BODY_CHARS = 4096;
/** detail 里单个字符串的上限（上游报文可能很长） */
const MAX_DETAIL_CHARS = 300;

interface LogState {
  startedAt: number;
  responsePayload?: string;
}

const STATE_KEY = Symbol('astrmiraRequestLog');

type RequestWithState = FastifyRequest & { [STATE_KEY]?: LogState };

/** 方法 + 路径 → 语义动作（id 清单见 `packages/shared/src/logs.ts` 的 `LOG_ACTIONS`） */
export function describeAction(method: string, path: string): string | undefined {
  const clean = path.split('?')[0] ?? path;

  if (method === 'POST') {
    if (clean === '/api/generate') return 'generate.submit';
    if (clean === '/api/edits') return 'edit.submit';
    // V2.5（B34 · P4）：浏览器端渲染产物入库（写操作；显式登记动作 id 便于日志页筛选）
    if (clean === '/api/edits/renders') return 'edit.render';
    if (clean === '/api/upload') return 'upload';
    if (clean === '/api/history/import') return 'history.import';
    if (clean === '/api/prompt/enhance') return 'enhance';
  if (clean === '/api/agent/plan') return 'agent';
  if (clean === '/api/agent/canvas') return 'agent-canvas';
  if (clean === '/api/agent/canvas/node-plan') return 'agent-canvas-node-plan';
  if (clean === '/api/agent/canvas/node-update-plan') return 'agent-canvas-node-update-plan';
    if (clean === '/api/providers/keys/verify') return 'keys.verify';
    if (/^\/api\/tasks\/[^/]+\/cancel$/.test(clean)) return 'task.cancel';
  }
  if (method === 'DELETE') {
    if (clean === '/api/logs') return 'logs.clear';
    if (/^\/api\/logs\/\d+$/.test(clean)) return 'logs.delete';
    if (/^\/api\/history\/[^/]+$/.test(clean)) return 'history.delete';
  }
  return undefined;
}

/** 是否写日志（规则见文件头"噪声纪律"） */
export function shouldLogRequest(method: string, path: string, statusCode: number): boolean {
  const clean = path.split('?')[0] ?? path;

  if (method === 'OPTIONS') return false;
  if (!clean.startsWith('/api/')) return false;
  if (clean.startsWith('/media')) return false;
  if (clean === '/api/health') return false;
  if (clean === '/api/logs' || clean.startsWith('/api/logs/')) return false;

  // 读操作只记失败（404 / 500 之类要能看到，成功轮询不记）
  if (method === 'GET' && statusCode < 400) return false;

  return true;
}

/** 从路径里取 taskId（`/api/tasks/:id`、`/api/tasks/:id/cancel`、`/api/history/:id`） */
function taskIdFromPath(path: string): string | undefined {
  const match = /^\/api\/(?:tasks|history)\/([^/?]+)/.exec(path.split('?')[0] ?? path);
  return match?.[1];
}

function parseJson(text: string | undefined): Record<string, unknown> | null {
  if (text === undefined || text.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…（已截断，原长 ${value.length}）`;
}

/** 从上游报文里抠出 `Request id: xxx`（排错时最有用的一个字段） */
function upstreamRequestId(message: string): string | undefined {
  const match = /Request id[:：]\s*([A-Za-z0-9]+)/.exec(message);
  return match?.[1];
}

function stringField(source: Record<string, unknown> | null, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export interface RequestLogOptions {
  store: EventLogStore;
  /** 诊断钩子（写库失败时用；不给就静默 —— 日志系统本身绝不能拖垮请求） */
  onError?: (err: unknown) => void;
  now?: () => number;
}

export function registerRequestLog(app: FastifyInstance, options: RequestLogOptions): void {
  const now = options.now ?? (() => Date.now());

  app.addHook('onRequest', async (request) => {
    (request as RequestWithState)[STATE_KEY] = { startedAt: now() };
  });

  // 响应头带上请求 id：用户报错时截图里就有它，开发者可直接搜（`x-request-id`）
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);

    if (typeof payload === 'string' && payload.length <= 8_192) {
      const state = (request as RequestWithState)[STATE_KEY];
      if (state !== undefined) state.responsePayload = payload;
    }
    return payload;
  });

  app.addHook('onResponse', async (request, reply) => {
    try {
      const state = (request as RequestWithState)[STATE_KEY];
      const statusCode = reply.statusCode;
      if (!shouldLogRequest(request.method, request.url, statusCode)) return;

      const path = request.url.split('?')[0] ?? request.url;
      const action = describeAction(request.method, path) ?? (statusCode >= 400 ? 'request.error' : undefined);
      const secrets = collectRequestSecrets(request);

      // 请求体：JSON 记原文（截断）；multipart 只记摘要（绝不记二进制）
      const contentType = String(request.headers['content-type'] ?? '');
      let body: string | undefined;
      if (contentType.includes('application/json')) {
        const parsed = request.body;
        if (parsed !== undefined && parsed !== null) {
          body = truncate(redactSecrets(JSON.stringify(parsed), ...secrets), MAX_BODY_CHARS);
        }
      } else if (contentType.startsWith('multipart/form-data')) {
        body = `(multipart/form-data：不记二进制内容；bytes≈${request.headers['content-length'] ?? '未知'})`;
      }

      // 响应体（仅在钩子里缓存过的小响应）：取错误码、taskId、provider 与上游 request id
      const response = parseJson(state?.responsePayload);
      const errorMessage = stringField(response, 'message') ?? '';
      const requestBody = parseJson(
        typeof request.body === 'object' && request.body !== null ? JSON.stringify(request.body) : undefined,
      );
      const requestOptions = (requestBody?.['options'] ?? null) as Record<string, unknown> | null;

      const detail: Record<string, unknown> = {};
      const model = stringField(requestOptions, 'model');
      if (model !== undefined) detail['model'] = model;
      const upstreamId = upstreamRequestId(errorMessage);
      if (upstreamId !== undefined) detail['upstreamRequestId'] = upstreamId;
      if (errorMessage !== '') detail['errorMessage'] = truncate(redactSecrets(errorMessage, ...secrets), MAX_DETAIL_CHARS);
      if (contentType.startsWith('multipart/form-data')) {
        detail['note'] = 'multipart 请求体不记内容，仅记大小与类型（见 body 字段）';
      }

      const entry: NewEventLogEntry = {
        ts: now(),
        requestId: String(request.id),
        ip: request.ip,
        method: request.method,
        path,
        ...(action === undefined ? {} : { action }),
        statusCode,
        durationMs: state === undefined ? undefined : Math.max(0, now() - state.startedAt),
        ...(stringField(response, 'taskId') ?? taskIdFromPath(path)) === undefined
          ? {}
          : { taskId: stringField(response, 'taskId') ?? taskIdFromPath(path) },
        ...(stringField(requestBody, 'provider') === undefined
          ? {}
          : { provider: stringField(requestBody, 'provider') }),
        ...(stringField(response, 'code') === undefined ? {} : { errorCode: stringField(response, 'code') }),
        ...(stringField(response, 'disposition') === undefined
          ? {}
          : { disposition: stringField(response, 'disposition') }),
        ...(typeof request.headers['user-agent'] === 'string'
          ? { userAgent: truncate(request.headers['user-agent'], 200) }
          : {}),
        ...(body === undefined ? {} : { body }),
        ...(Object.keys(detail).length === 0 ? {} : { detail }),
      };

      options.store.append(entry);
    } catch (err) {
      // 日志系统失败**不得**影响请求（它只是观测手段，不是业务链路）
      options.onError?.(err);
    }
  });
}
