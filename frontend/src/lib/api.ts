import {
  ErrorResponseSchema,
  GenerateResponseSchema,
  HealthResponseSchema,
  HistoryResponseSchema,
  OperationResultSchema,
  PromptEnhanceResponseSchema,
  ProviderStatusSchema,
  TaskProgressSchema,
  UploadResponseSchema,
} from '@astrmira/shared';
import type {
  ErrorCode,
  ErrorDisposition,
  GenerateResponse,
  HealthResponse,
  HistoryResponse,
  OperationResult,
  PromptEnhanceResponse,
  ProviderStatus,
  TaskProgress,
  UploadResponse,
  VideoGenerateRequest,
} from '@astrmira/shared';
import type { z } from 'zod';

/**
 * 前端唯一网络入口（PLAN §6-D4：不引入 axios / react-query）。
 *
 * 两个设计要点：
 * 1. **响应一律过 shared 的 zod schema**：契约漂移时当场报错，
 *    而不是把 `undefined` 当数据渲染（那会变成"页面看着正常、值是空的"，最难查）。
 * 2. **`X-Provider-Key` 只走请求头**，绝不进 URL 或 body（CONTRACT §5）。
 */

const DEFAULT_TIMEOUT_MS = 30_000;
const POLL_TIMEOUT_MS = 10_000;
const PROVIDER_KEY_HEADER = 'x-provider-key';

export interface ApiFailure {
  /** `contract` = 服务端按 CONTRACT §6 返回了错误码；`network` = 连契约响应都没拿到 */
  kind: 'contract' | 'network';
  status: number;
  code?: ErrorCode;
  disposition?: ErrorDisposition;
  message: string;
}

export class ApiError extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(failure.message);
    this.name = 'ApiError';
    this.failure = failure;
  }

  /** UNCERTAIN_RESULT：界面必须走"人工核对"分支，禁止任何重跑入口（AC7） */
  get isUncertain(): boolean {
    return this.failure.disposition === 'uncertain';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  /** 仅用于请求头；`undefined` 表示不带（服务端回落到 env 兜底 Key） */
  providerKey?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function buildHeaders(options: RequestOptions): Record<string, string> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.providerKey !== undefined) headers[PROVIDER_KEY_HEADER] = options.providerKey;
  if (options.idempotencyKey !== undefined) headers['idempotency-key'] = options.idempotencyKey;
  return headers;
}

async function parsePayload(response: Response, path: string): Promise<unknown> {
  const text = await response.text();
  if (text === '') return null;

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError({
      kind: 'network',
      status: response.status,
      message: `响应不是合法 JSON（${path}，HTTP ${response.status}）`,
    });
  }
}

function toContractError(response: Response, payload: unknown, path: string): ApiError {
  const parsed = ErrorResponseSchema.safeParse(payload);

  if (parsed.success) {
    return new ApiError({
      kind: 'contract',
      status: response.status,
      code: parsed.data.code,
      disposition: parsed.data.disposition,
      message: parsed.data.message,
    });
  }

  return new ApiError({
    kind: 'network',
    status: response.status,
    message: `HTTP ${response.status}（${path}）`,
  });
}

async function request<S extends z.ZodType>(
  path: string,
  schema: S,
  options: RequestOptions = {},
): Promise<z.infer<S>> {
  let response: Response;

  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers: buildHeaders(options),
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ApiError({
      kind: 'network',
      status: 0,
      message: `网络请求失败（${path}）：${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const payload = await parsePayload(response, path);

  if (!response.ok) throw toContractError(response, payload, path);

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('；');

    throw new ApiError({
      kind: 'contract',
      status: response.status,
      message: `响应不符合契约（${path}）：${detail}`,
    });
  }

  return parsed.data;
}

export function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return request('/api/health', HealthResponseSchema, { signal });
}

export function fetchProviderStatus(signal?: AbortSignal): Promise<ProviderStatus> {
  return request('/api/providers/status', ProviderStatusSchema, { signal });
}

/**
 * 提交生成任务。
 * `idempotencyKey` 由调用方持稳（重试必须复用同一个键），服务端按它去重（CONTRACT §5）。
 */
export function submitGenerate(
  body: VideoGenerateRequest,
  options: { idempotencyKey: string; providerKey?: string },
): Promise<GenerateResponse> {
  return request('/api/generate', GenerateResponseSchema, {
    method: 'POST',
    body,
    idempotencyKey: options.idempotencyKey,
    ...(options.providerKey === undefined ? {} : { providerKey: options.providerKey }),
  });
}

export function fetchTask(taskId: string, signal?: AbortSignal): Promise<TaskProgress> {
  return request(`/api/tasks/${encodeURIComponent(taskId)}`, TaskProgressSchema, {
    signal,
    timeoutMs: POLL_TIMEOUT_MS,
  });
}

export function cancelTask(taskId: string): Promise<OperationResult> {
  return request(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, OperationResultSchema, {
    method: 'POST',
  });
}

/**
 * 扩写：demo 版服务端恒返回 `501 LLM_NOT_CONFIGURED`（诚实未实现）。
 * 这里**不吞错、不兜底**——调用方据 `ApiError.failure.code` 把 ✨ 置灰并写明原因；
 * 若日后台账 B3 落地，本函数无需改动即可直接用。
 */
export function enhancePrompt(originalPrompt: string): Promise<PromptEnhanceResponse> {
  return request('/api/prompt/enhance', PromptEnhanceResponseSchema, {
    method: 'POST',
    body: { originalPrompt },
  });
}

export function fetchHistory(): Promise<HistoryResponse> {
  return request('/api/history', HistoryResponseSchema);
}

export function deleteHistory(taskId: string): Promise<OperationResult> {
  return request(`/api/history/${encodeURIComponent(taskId)}`, OperationResultSchema, {
    method: 'DELETE',
  });
}

/** 上传：multipart 由浏览器自动决定 boundary，**不要**手写 content-type */
export async function uploadAssets(files: File[]): Promise<UploadResponse> {
  const form = new FormData();
  for (const file of files) form.append('files', file);

  let response: Response;
  try {
    response = await fetch('/api/upload', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ApiError({
      kind: 'network',
      status: 0,
      message: `上传失败：${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const payload = await parsePayload(response, '/api/upload');
  if (!response.ok) throw toContractError(response, payload, '/api/upload');

  const parsed = UploadResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError({
      kind: 'contract',
      status: response.status,
      message: '上传响应不符合契约',
    });
  }

  return parsed.data;
}

/**
 * 成片直链：**只接受**同源相对路径 `/media/...`。
 * 拒绝绝对 URL 与含 `..` 的路径——服务端返回什么都不能直接塞进 `<video src>`
 * （否则一个被污染的响应就能让浏览器去加载外部地址）。
 */
export function resolveMediaUrl(outputVideoUrl: string | undefined): string | null {
  if (outputVideoUrl === undefined) return null;
  if (!outputVideoUrl.startsWith('/media/')) return null;
  if (outputVideoUrl.includes('..')) return null;
  return outputVideoUrl;
}
