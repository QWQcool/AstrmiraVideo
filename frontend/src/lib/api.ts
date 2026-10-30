import {
  AgentPlanResponseSchema,
  AssetListResponseSchema,
  CanvasAgentResponseSchema,
  CanvasNodeProposalResponseSchema,
  CanvasTextNodeUpdateResponseSchema,
  HistoryImportResponseSchema,
  StoryboardExpandResponseSchema,
  StoryboardResponseSchema,
  CreationRunListResponseSchema,
  CreationRunResponseSchema,
  CanvasDocSaveResponseSchema,
  CanvasDocSchema,
  CanvasProjectIndexSchema,
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
  SelfCheckResponseSchema,
  StatsSummaryResponseSchema,
  TaskProgressSchema,
  UploadResponseSchema,
} from '@astrmira/shared';
import type {
  AgentPlanRequest,
  AgentPlanResponse,
  AudioGenerateRequest,
  AssetListResponse,
  CanvasAgentRequest,
  CanvasAgentResponse,
  CanvasDoc,
  CanvasNodeProposalRequest,
  CanvasNodeProposalResponse,
  CanvasTextNodeUpdateRequest,
  CanvasTextNodeUpdateResponse,
  HistoryImportRequest,
  HistoryImportResponse,
  StoryboardExpandRequest,
  StoryboardExpandResponse,
  StoryboardRequest,
  StoryboardResponse,
  CreationRunInput,
  CreationRunListResponse,
  CreationRunResponse,
  CanvasDocSaveResponse,
  CanvasProjectIndex,
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
  SelfCheckResponse,
  StatsSummaryResponse,
  TaskProgress,
  UploadResponse,
  VideoGenerateRequest,
} from '@astrmira/shared';
import type { z } from 'zod';
import { getLanguage, translate } from './i18n';

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
  // V2.42：画布文档保存走 PUT（整份覆盖，不做字段级 PATCH）
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** 仅用于请求头；`undefined` 表示不带（服务端回落到 env 兜底 Key） */
  providerKey?: string;
  /** 文本轨 Key（仅扩写用）；`undefined` → 服务端返回 501 `LLM_NOT_CONFIGURED` */
  llmKey?: string;
  idempotencyKey?: string;
  /** V2.26（A5 片 A）：编排运行 id —— 同一次「运行」内的连续提交共享一个冷却窗口 */
  planRunId?: string;
  signal?: AbortSignal;
  /** 页面卸载时的 best-effort 保存（S4-R1a）：keepalive 让浏览器在卸载中继续发请求 */
  keepalive?: boolean;
  /** V2.48：画布并发修订号（保存时原样带回读取时的值） */
  canvasRevision?: number;
  timeoutMs?: number;
}

function buildHeaders(options: RequestOptions): Record<string, string> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.providerKey !== undefined) headers[PROVIDER_KEY_HEADER] = options.providerKey;
  if (options.llmKey !== undefined) headers[LLM_KEY_HEADER] = options.llmKey;
  if (options.idempotencyKey !== undefined) headers['idempotency-key'] = options.idempotencyKey;
  // V2.26：编排运行的头（见 CONTRACT §11-6 与 PlanRunRegistry）
  if (options.planRunId !== undefined) headers['x-plan-run'] = options.planRunId;
  // V2.48：画布保存的并发修订号
  if (options.canvasRevision !== undefined) {
    headers['x-canvas-revision'] = String(options.canvasRevision);
  }
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
      message: translate(getLanguage(), 'common.api.notJson', {
        path,
        status: response.status,
      }),
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
      ...(options.keepalive === true ? { keepalive: true } : {}),
      signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ApiError({
      kind: 'network',
      status: 0,
      message: translate(getLanguage(), 'common.api.networkFailed', {
        path,
        reason: err instanceof Error ? err.message : String(err),
      }),
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
      message: translate(getLanguage(), 'common.api.contractViolation', { path, detail }),
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
 * 本地引擎**运行时自检**（CONTRACT §20 / 台账 B4）。
 *
 * ⚠️ 与 `fetchProviderStatus` 的区别是**它会真的去连一次**用户的 ComfyUI（慢几秒）——
 * 所以只允许在用户显式点击时调用，**不要**放进渲染路径或轮询里。
 */
export function fetchSelfCheck(signal?: AbortSignal): Promise<SelfCheckResponse> {
  return request('/api/providers/selfcheck', SelfCheckResponseSchema, { signal });
}

/**
 * 提交生成任务。
 * `idempotencyKey` 由调用方持稳（重试必须复用同一个键），服务端按它去重（CONTRACT §5）。
 */
export function submitGenerate(
  body: VideoGenerateRequest,
  options: {
    idempotencyKey: string;
    providerKey?: string;
    /**
     * V2.26（台账 A5 片 A）：编排运行 id。
     *
     * 编排一次「运行」会提交一串节点，而 60s 冷却的粒度是"一次提交" ——
     * 带上它之后，**同一次运行的后续节点不再重复吃冷却**（同一次点击 = 一次有意动作）。
     * 手动提交不带它（保持原有防抖）。
     */
    planRunId?: string;
  },
): Promise<GenerateResponse> {
  return request('/api/generate', GenerateResponseSchema, {
    method: 'POST',
    body,
    idempotencyKey: options.idempotencyKey,
    ...(options.providerKey === undefined ? {} : { providerKey: options.providerKey }),
    ...(options.planRunId === undefined ? {} : { planRunId: options.planRunId }),
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

/**
 * 提交音频任务（V2.103 / CONTRACT §30）。
 *
 * 与生成的差别只有两处：路径不同、**不需要凭据**（音频 Key 在服务端 env，
 * 不是 BYOK —— 见 `AUDIO_ENGINES`）。任务的轮询完全复用 `fetchTask`。
 */
export function submitAudio(body: AudioGenerateRequest): Promise<GenerateResponse> {
  return request('/api/audio', GenerateResponseSchema, { method: 'POST', body });
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
 * Agent 规划（CONTRACT §23 / S6-B1）：只返回计划，不提交生成。
 * Key 仍只走 `X-LLM-Key`；调用方必须把 `LLM_NOT_CONFIGURED` 与 `KEY_INVALID` 分开讲。
 */
export function planAgent(
  body: AgentPlanRequest,
  options: { llmKey?: string } = {},
): Promise<AgentPlanResponse> {
  return request('/api/agent/plan', AgentPlanResponseSchema, {
    method: 'POST',
    body,
    ...(options.llmKey === undefined ? {} : { llmKey: options.llmKey }),
  });
}

/**
 * 只读画布助手（CONTRACT §24 / S7-D1）：请求是快照，响应是文本。
 * 这个端点没有写画布的能力；UI 也不在请求后调用任何 CanvasDoc 变更。
 */
export function askCanvasAgent(
  body: CanvasAgentRequest,
  options: { llmKey?: string } = {},
): Promise<CanvasAgentResponse> {
  return request('/api/agent/canvas', CanvasAgentResponseSchema, {
    method: 'POST',
    body,
    ...(options.llmKey === undefined ? {} : { llmKey: options.llmKey }),
  });
}

/**
 * 只生成一张待确认的文本节点方案（CONTRACT §25 / S7-D2）。
 * 服务端不写 canvas；用户确认后由画布页落节点。
 */
export function proposeCanvasTextNode(
  body: CanvasNodeProposalRequest,
  options: { llmKey?: string } = {},
): Promise<CanvasNodeProposalResponse> {
  return request('/api/agent/canvas/node-plan', CanvasNodeProposalResponseSchema, {
    method: 'POST',
    body,
    ...(options.llmKey === undefined ? {} : { llmKey: options.llmKey }),
  });
}

/** 只生成选中文本节点的待确认更新方案（CONTRACT §26 / S7-D5）。 */
export function proposeCanvasTextNodeUpdate(
  body: CanvasTextNodeUpdateRequest,
  options: { llmKey?: string } = {},
): Promise<CanvasTextNodeUpdateResponse> {
  return request('/api/agent/canvas/node-update-plan', CanvasTextNodeUpdateResponseSchema, {
    method: 'POST',
    body,
    ...(options.llmKey === undefined ? {} : { llmKey: options.llmKey }),
  });
}

/** P3/P4：把资产库中的外部作品登记为 imported 历史（不是生成任务）。 */
export function importAssetsToHistory(
  body: HistoryImportRequest,
): Promise<HistoryImportResponse> {
  return request('/api/history/import', HistoryImportResponseSchema, {
    method: 'POST',
    body,
  });
}

/** P5：生成一份独立的分镜计划；不写画布、不提交生成。 */
export function createStoryboard(
  body: StoryboardRequest,
  options: { llmKey?: string } = {},
): Promise<StoryboardResponse> {
  return request('/api/agent/storyboard', StoryboardResponseSchema, {
    method: 'POST',
    body,
    ...(options.llmKey === undefined ? {} : { llmKey: options.llmKey }),
  });
}

/** S8-A2：把确认过的分镜表展开成每镜生成参数（第二次规划）；落地由前端显式执行。 */
export function expandStoryboard(
  body: StoryboardExpandRequest,
  options: { llmKey?: string } = {},
): Promise<StoryboardExpandResponse> {
  return request('/api/agent/storyboard/expand', StoryboardExpandResponseSchema, {
    method: 'POST',
    body,
    ...(options.llmKey === undefined ? {} : { llmKey: options.llmKey }),
  });
}

/** S8-D：创作会话 REST 客户端（CONTRACT §29）。 */

export function createCreationRun(body: CreationRunInput): Promise<CreationRunResponse> {
  return request('/api/agent/runs', CreationRunResponseSchema, { method: 'POST', body });
}

export function fetchCreationRuns(project?: string): Promise<CreationRunListResponse> {
  const query = project === undefined || project === '' ? '' : `?project=${encodeURIComponent(project)}`;
  return request(`/api/agent/runs${query}`, CreationRunListResponseSchema, {});
}

export function fetchCreationRun(id: string): Promise<CreationRunResponse> {
  return request(`/api/agent/runs/${encodeURIComponent(id)}`, CreationRunResponseSchema, {});
}

export function startCreationRun(id: string): Promise<CreationRunResponse> {
  return request(`/api/agent/runs/${encodeURIComponent(id)}/start`, CreationRunResponseSchema, {
    method: 'POST',
  });
}

export function confirmCreationRun(id: string): Promise<CreationRunResponse> {
  return request(`/api/agent/runs/${encodeURIComponent(id)}/confirm`, CreationRunResponseSchema, {
    method: 'POST',
  });
}

export function cancelCreationRun(id: string): Promise<CreationRunResponse> {
  return request(`/api/agent/runs/${encodeURIComponent(id)}/cancel`, CreationRunResponseSchema, {
    method: 'POST',
  });
}

export function retryCreationRunStep(id: string, stepId: string): Promise<CreationRunResponse> {
  return request(
    `/api/agent/runs/${encodeURIComponent(id)}/steps/${encodeURIComponent(stepId)}/retry`,
    CreationRunResponseSchema,
    { method: 'POST' },
  );
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
  /**
   * S5-A：来源过滤。服务端默认排除画布产物；画布资产页显式传 `canvas`。
   * 不传 = 现有“首页生成历史”行为。
   */
  origin?: 'create' | 'canvas';
  /** V2.25（台账 B44）：1~200；省略 = 服务端默认 50（与 V2.25 之前一致） */
  limit?: number;
  /** V2.25：游标 —— 只返回 `created_at < before` 的任务（"加载更早"） */
  before?: number;
}): Promise<HistoryResponse> {
  // V9 修复：剪辑产物默认不进历史成片；剪辑台用 `?kind=edit&source=<id>` 查某源片的剪辑历史。
  // V2.6（B37）：`kind:'edit'` 不带 source → 全部剪辑产物（时间轴素材候选合并用）。
  // V2.11（B47）：`project` 省略 = 默认项目。
  // V2.25（B44）：`limit` / `before` 驱动画布的分页（响应里的 `hasMore` 决定还能不能继续往前翻）。
  const params = new URLSearchParams();
  if (filter?.kind === 'edit') params.set('kind', 'edit');
  if (filter?.source !== undefined) params.set('source', filter.source);
  if (filter?.project !== undefined) params.set('project', filter.project);
  if (filter?.origin !== undefined) params.set('origin', filter.origin);
  if (filter?.limit !== undefined) params.set('limit', String(filter.limit));
  if (filter?.before !== undefined) params.set('before', String(filter.before));
  const suffix = params.size === 0 ? '' : `?${params.toString()}`;
  return request(`/api/history${suffix}`, HistoryResponseSchema);
}

/**
 * 运行观测汇总（V2.90 / D-8，CONTRACT §16 附）。
 *
 * 回答"跑得多快、失败在哪些码上"（金额不在这里：提交前的估价在本地算，不查库）。
 * 耗时**只是近似**（`durationNote` 由服务端下发，界面不要自己再写一版）。
 */
export function fetchStatsSummary(
  query: { from?: number; to?: number } = {},
): Promise<StatsSummaryResponse> {
  const params = new URLSearchParams();
  if (query.from !== undefined) params.set('from', String(query.from));
  if (query.to !== undefined) params.set('to', String(query.to));
  const suffix = params.size === 0 ? '' : `?${params.toString()}`;
  return request(`/api/stats/summary${suffix}`, StatsSummaryResponseSchema);
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

/**
 * 画布项目索引（CONTRACT §21-8 / V2.42）。
 *
 * 只读摘要：`{ version, projects[], activeProjectId? }`。不返回文档本体 ——
 * 列表页不应该为了显示"节点数"去读 20 份完整文档。
 */
export function fetchCanvasIndex(): Promise<CanvasProjectIndex> {
  return request('/api/canvas/projects', CanvasProjectIndexSchema);
}

/** 整份画布文档；未保存过 → 404（调用方应视为"新画布"，不当作错误弹窗） */
export function fetchCanvasDoc(projectId: string): Promise<CanvasDoc> {
  return request(`/api/canvas/docs/${encodeURIComponent(projectId)}`, CanvasDocSchema);
}

/** 整份覆盖保存（不做字段级 PATCH）；返回保存后的摘要 + 新修订号（V2.48） */
export function saveCanvasDoc(
  doc: CanvasDoc,
  options: { keepalive?: boolean; revision?: number } = {},
): Promise<CanvasDocSaveResponse> {
  return request(`/api/canvas/docs/${encodeURIComponent(doc.projectId)}`, CanvasDocSaveResponseSchema, {
    method: 'PUT',
    body: doc,
    ...(options.keepalive === true ? { keepalive: true } : {}),
    ...(options.revision === undefined ? {} : { canvasRevision: options.revision }),
  });
}

/** 删除一个画布（文档 + 索引条目） */
export function deleteCanvasDoc(projectId: string): Promise<DeleteProjectResponse> {
  return request(
    `/api/canvas/docs/${encodeURIComponent(projectId)}`,
    DeleteProjectResponseSchema,
    { method: 'DELETE' },
  );
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
      message: translate(getLanguage(), 'common.api.uploadFailed', {
      reason: err instanceof Error ? err.message : String(err),
    }),
    });
  }

  const payload = await parsePayload(response, '/api/upload');
  if (!response.ok) throw toContractError(response, payload, '/api/upload');

  const parsed = UploadResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError({
      kind: 'contract',
      status: response.status,
      message: translate(getLanguage(), 'common.api.uploadContract'),
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
      message: translate(getLanguage(), 'common.api.ingestFailed', {
      reason: err instanceof Error ? err.message : String(err),
    }),
    });
  }

  const payload = await parsePayload(response, '/api/edits/renders');
  if (!response.ok) throw toContractError(response, payload, '/api/edits/renders');

  const parsed = GenerateResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError({
      kind: 'contract',
      status: response.status,
      message: translate(getLanguage(), 'common.api.ingestContract'),
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
