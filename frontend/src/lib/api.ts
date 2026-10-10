import {
  AssetListResponseSchema,
  CostSummaryResponseSchema,
  DeleteProjectResponseSchema,
  ErrorResponseSchema,
  GenerateResponseSchema,
  HealthResponseSchema,
  MetricsResponseSchema,
  HistoryResponseSchema,
  KeyVerifyResponseSchema,
  LogDeleteResponseSchema,
  LogListResponseSchema,
  OperationResultSchema,
  ProjectListResponseSchema,
  ProjectResponseSchema,
  PromptEnhanceResponseSchema,
  ProviderStatusSchema,
  TaskProgressSchema,
  UploadResponseSchema,
} from '@astrmira/shared';
import type {
  AssetListResponse,
  CostSummaryResponse,
  DeleteProjectResponse,
  EditProject,
  EditScript,
  ErrorCode,
  ErrorDisposition,
  GenerateResponse,
  HealthResponse,
  HistoryResponse,
  KeyVerifyRequest,
  KeyVerifyResponse,
  LogDeleteResponse,
  LogListResponse,
  LogQuery,
  MetricsResponse,
  OperationResult,
  ProjectListResponse,
  ProjectResponse,
  PromptEnhanceRequest,
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
/** 文本轨凭据头（V2.0 扩写）：与视频轨分开，见 CONTRACT §5「凭据传递约定」 */
const LLM_KEY_HEADER = 'x-llm-key';

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
  // V2.11（B47）：项目改名走 PATCH（`/api/projects/:projectId`）
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** 仅用于请求头；`undefined` 表示不带（服务端回落到 env 兜底 Key） */
  providerKey?: string;
  /** 文本轨 Key（仅扩写用）；`undefined` → 服务端返回 501 `LLM_NOT_CONFIGURED` */
  llmKey?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function buildHeaders(options: RequestOptions): Record<string, string> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.providerKey !== undefined) headers[PROVIDER_KEY_HEADER] = options.providerKey;
  if (options.llmKey !== undefined) headers[LLM_KEY_HEADER] = options.llmKey;
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

/**
 * 提交剪辑任务（V9 · B9；CONTRACT §11-2）。
 *
 * 与生成任务的两处不同：
 * - **不需要凭据**（本地 ffmpeg，零上游调用）；
 * - **不需要幂等键**（每次提交都是一条新任务 —— 剪辑不像生成那样会被网络重试打重）。
 *
 * 返回的 `taskId` 复用 `GET /api/tasks/:taskId` 轮询（与生成任务同一条链路）。
 */
export function submitEdit(script: EditScript): Promise<GenerateResponse> {
  return request('/api/edits', GenerateResponseSchema, { method: 'POST', body: script });
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
 * 扩写（CONTRACT §3 V2.0，纯 BYOK）：Key 只走 `X-LLM-Key`。
 *
 * 这里**不吞错、不兜底**——调用方据 `ApiError.failure.code` 决定文案：
 * `LLM_NOT_CONFIGURED`（没填 Key）与 `KEY_INVALID`（Key 被拒）是两件不同的事，必须分开讲。
 */
export function enhancePrompt(
  body: PromptEnhanceRequest,
  options: { llmKey?: string } = {},
): Promise<PromptEnhanceResponse> {
  return request('/api/prompt/enhance', PromptEnhanceResponseSchema, {
    method: 'POST',
    body,
    ...(options.llmKey === undefined ? {} : { llmKey: options.llmKey }),
  });
}

/**
 * 凭据与模型校验（CONTRACT §9 V2.1）：提交**之前**零费用地回答
 * "Key 行不行 / 模型在不在 / 有没有开通"，避免再花一次真实生成换一条报错。
 */
export function verifyTrackKey(
  body: KeyVerifyRequest,
  options: { providerKey?: string; llmKey?: string } = {},
): Promise<KeyVerifyResponse> {
  return request('/api/providers/keys/verify', KeyVerifyResponseSchema, {
    method: 'POST',
    body,
    ...(options.providerKey === undefined ? {} : { providerKey: options.providerKey }),
    ...(options.llmKey === undefined ? {} : { llmKey: options.llmKey }),
  });
}

/** 操作日志：查询（CONTRACT §10） */
export function fetchLogs(query: LogQuery = {}): Promise<LogListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const suffix = params.toString() === '' ? '' : `?${params.toString()}`;
  return request(`/api/logs${suffix}`, LogListResponseSchema);
}

/** 操作日志：删单条（幂等；删不存在的条目返回 `deleted: 0`） */
export function deleteLog(id: number): Promise<LogDeleteResponse> {
  return request(`/api/logs/${id}`, LogDeleteResponseSchema, { method: 'DELETE' });
}

/** 操作日志：按当前筛选清空（不带筛选即全清） */
export function clearLogs(query: LogQuery = {}): Promise<LogDeleteResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const suffix = params.toString() === '' ? '' : `?${params.toString()}`;
  return request(`/api/logs${suffix}`, LogDeleteResponseSchema, { method: 'DELETE' });
}

/**
 * 资产库清单（V2.7 / 台账 B41；CONTRACT §5）。
 * 只读枚举，含抽帧产物（同目录同规则）；空目录返回空数组（不是 404）。
 */
export function fetchAssets(projectId?: string): Promise<AssetListResponse> {
  // V2.11（B47）：`?project=` 省略 = 默认项目（不是"全部项目"，见 CONTRACT §12）
  const suffix = projectId === undefined ? '' : `?project=${encodeURIComponent(projectId)}`;
  return request(`/api/assets${suffix}`, AssetListResponseSchema);
}

export function fetchHistory(filter?: {
  kind?: 'edit';
  source?: string;
  project?: string;
}): Promise<HistoryResponse> {
  // V9 修复：剪辑产物默认不进历史成片；剪辑台用 `?kind=edit&source=<id>` 查某源片的剪辑历史。
  // V2.6（B37）：`kind:'edit'` 不带 source → 全部剪辑产物（时间轴素材候选合并用）。
  // V2.11（B47）：`project` 省略 = 默认项目。
  const params = new URLSearchParams();
  if (filter?.kind === 'edit') params.set('kind', 'edit');
  if (filter?.source !== undefined) params.set('source', filter.source);
  if (filter?.project !== undefined) params.set('project', filter.project);
  const suffix = params.size === 0 ? '' : `?${params.toString()}`;
  return request(`/api/history${suffix}`, HistoryResponseSchema);
}

/**
 * 成本台账汇总（V2.12 / B48，CONTRACT §13）。
 *
 * `project` 省略 = **默认项目**；字面量 `'all'` = **跨项目汇总**（唯一刻意跨项目的读端点）。
 * 金额是**预估**：`disclaimer` 由服务端下发，界面直接显示它、不要自己写一版。
 */
export function fetchCostSummary(query: {
  project?: string;
  from?: number;
  to?: number;
} = {}): Promise<CostSummaryResponse> {
  const params = new URLSearchParams();
  if (query.project !== undefined) params.set('project', query.project);
  if (query.from !== undefined) params.set('from', String(query.from));
  if (query.to !== undefined) params.set('to', String(query.to));
  const suffix = params.size === 0 ? '' : `?${params.toString()}`;
  return request(`/api/costs/summary${suffix}`, CostSummaryResponseSchema);
}

/**
 * 运维快照（V2.16 / 台账 B53，CONTRACT §16）。
 *
 * 画布只用它的一小块（`queue`）—— 把"前面还有几条、最久等了多久"如实讲出来。
 * 本地轨并发为 1（防线 1）是硬约束，"让你干等"与"告诉你为什么等"是两种体验。
 */
export function fetchMetrics(): Promise<MetricsResponse> {
  return request('/api/metrics', MetricsResponseSchema);
}

/** 项目清单（V2.11 / B47，CONTRACT §12）：含用量（任务条数 / 资产个数） */
export function fetchProjects(): Promise<ProjectListResponse> {
  return request('/api/projects', ProjectListResponseSchema);
}

export function createProject(name: string): Promise<ProjectResponse> {
  return request('/api/projects', ProjectResponseSchema, { method: 'POST', body: { name } });
}

export function renameProject(projectId: string, name: string): Promise<ProjectResponse> {
  return request(`/api/projects/${encodeURIComponent(projectId)}`, ProjectResponseSchema, {
    method: 'PATCH',
    body: { name },
  });
}

export function deleteProject(projectId: string): Promise<DeleteProjectResponse> {
  return request(`/api/projects/${encodeURIComponent(projectId)}`, DeleteProjectResponseSchema, {
    method: 'DELETE',
  });
}

export function deleteHistory(taskId: string): Promise<OperationResult> {
  return request(`/api/history/${encodeURIComponent(taskId)}`, OperationResultSchema, {
    method: 'DELETE',
  });
}

/** 上传：multipart 由浏览器自动决定 boundary，**不要**手写 content-type */
export async function uploadAssets(files: File[], projectId?: string): Promise<UploadResponse> {
  const form = new FormData();
  // V2.11（B47）：项目字段**放在文件之前** —— 服务端虽然"攒完字段再写 sidecar"（顺序无关），
  // 但先发字段能让失败的请求更早发现"项目不存在"，少传几个 MB。
  if (projectId !== undefined) form.append('projectId', projectId);
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
 * 浏览器端渲染产物**入库**（CONTRACT §11-2，V2.5 / B34 · P4）。
 *
 * 与 `uploadAssets` 同一个 multipart 套路（boundary 交给浏览器），但走**专用路由**：
 * 服务端不做渲染，只校验（工程 JSON 过 `EditProjectSchema`、源片可引用、魔数必须是 MP4、≤100MB）并归档。
 * 超时给 120s：成片可能几 MB ~ 几十 MB，普通上传的 30s 在慢网络下会误伤。
 */
export async function submitEditRender(input: {
  file: Blob;
  sourceTaskId: string;
  project: EditProject;
  /** V2.11（B47）：剪辑产物归属的项目（缺省 = 默认项目） */
  projectId?: string;
}): Promise<GenerateResponse> {
  const form = new FormData();
  if (input.projectId !== undefined) form.append('projectId', input.projectId);
  form.append('file', input.file, 'render.mp4');
  form.append('sourceTaskId', input.sourceTaskId);
  form.append('project', JSON.stringify(input.project));

  let response: Response;
  try {
    response = await fetch('/api/edits/renders', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    throw new ApiError({
      kind: 'network',
      status: 0,
      message: `入库失败：${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const payload = await parsePayload(response, '/api/edits/renders');
  if (!response.ok) throw toContractError(response, payload, '/api/edits/renders');

  const parsed = GenerateResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError({
      kind: 'contract',
      status: response.status,
      message: '入库响应不符合契约',
    });
  }
  return parsed.data;
}

/**
 * 成片直链：**只接受**同源相对路径 `/media/...`。
 * 拒绝绝对 URL 与含 `..` 的路径——服务端返回什么都不能直接塞进 `<video src>`
 * （否则一个被污染的响应就能让浏览器加载外部地址）。
 */
export function resolveMediaUrl(outputVideoUrl: string | undefined): string | null {
  if (outputVideoUrl === undefined) return null;
  if (!outputVideoUrl.startsWith('/media/')) return null;
  if (outputVideoUrl.includes('..')) return null;
  return outputVideoUrl;
}
