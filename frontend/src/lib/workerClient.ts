import {
  WORKER_DEFAULT_PORT,
  WORKER_PROTOCOL_VERSION,
  WorkerCancelResultSchema,
  WorkerHealthSchema,
  WorkerJobCreatedSchema,
  WorkerJobStatusSchema,
  checkWorkerLink,
  parseTaskRef,
  type ErrorCode,
  type WorkerHealth,
  type WorkerJobRequest,
  type WorkerJobStatus,
} from '@astrmira/shared';
import { getLanguage, translate } from './i18n';
import { ApiError } from './api';

/**
 * 本地 worker 客户端（台账 A1 片 A；协议 = CONTRACT §18 / `packages/shared/src/workerProtocol.ts`）。
 *
 * ## 它在做什么
 * 浏览器**直连用户本机的 worker**（默认 `http://127.0.0.1:8765`）：探测 → 提交 → 轮询 → 取产物。
 * 服务端**不参与**（这也是它与云端轨最大的结构差异）—— 因此这里没有凭据、没有服务端请求。
 *
 * ## 两条纪律
 * 1. **错误必须映射成契约错误码**（12 码之一）：上层（界面 / 将来的任务流）只认契约码，
 *    不允许冒出一个"只有这个模块认识"的错误类型；
 * 2. **失败要给可执行的话**：worker 没启动 / 版本不匹配 / 忙碌 —— 三种情形的处置完全不同，
 *    混成一句"连接失败"等于把排错成本转嫁给用户。
 */

export interface WorkerClientOptions {
  /** worker 地址（默认 `http://127.0.0.1:8765`） */
  baseUrl?: string;
  /** 可注入的 fetch（测试用） */
  fetchImpl?: typeof fetch;
  /** 单次请求超时（默认 15s；轮询间隔由调用方决定） */
  timeoutMs?: number;
}

export interface WorkerClient {
  readonly baseUrl: string;
  health(): Promise<WorkerHealth>;
  submit(request: WorkerJobRequest): Promise<{ jobId: string }>;
  status(jobId: string): Promise<WorkerJobStatus>;
  cancel(jobId: string): Promise<boolean>;
  /** 产物直链（预览 / 下载用；**不含**任何凭据） */
  resultUrl(jobId: string): string;
}

/** worker 交互失败（带**契约错误码** —— 上层只认它） */
export class WorkerError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'WorkerError';
  }

  /** 给界面用的一句话（码 + 原因 + 可执行动作） */
  toText(): string {
    return this.hint === undefined ? `【${this.code}】${this.message}` : `【${this.code}】${this.message}（${this.hint}）`;
  }
}

/**
 * 连不上 worker 时给的那句可执行提示（语言迁移第十五批）。
 *
 * 从**常量改成函数**：常量在模块加载那一刻就把语言定死了，而这句要跟着界面语言走。
 * （此前它是导出的；全仓只有本文件自己用，所以改成函数不影响任何调用点。）
 */
export function workerUnavailableHint(): string {
  return translate(getLanguage(), 'common.worker.unreachableHint');
}

function defaultBaseUrl(): string {
  return `http://127.0.0.1:${WORKER_DEFAULT_PORT}`;
}

export function createWorkerClient(options: WorkerClientOptions = {}): WorkerClient {
  const baseUrl = (options.baseUrl ?? defaultBaseUrl()).replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? 15_000;

  async function call(path: string, init?: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, { ...init, signal: controller.signal });
    } catch (caught) {
      // 网络层失败（含超时 / 被混合内容或 PNA 拦掉）—— 三种原因的处置不同，文案要分开
      const timedOut = caught instanceof Error && caught.name === 'AbortError';
      throw new WorkerError(
        'PROVIDER_UNAVAILABLE',
        timedOut
          ? translate(getLanguage(), 'common.worker.timeout', { ms: timeoutMs })
          : translate(getLanguage(), 'common.worker.unreachable', { baseUrl }),
        workerUnavailableHint(),
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 404) {
      throw new WorkerError(
        'TASK_NOT_FOUND',
        translate(getLanguage(), 'common.worker.taskNotFound', { path }),
      );
    }
    if (response.status === 409) {
      throw new WorkerError(
        'GPU_BUSY',
        translate(getLanguage(), 'common.worker.gpuBusy'),
        translate(getLanguage(), 'common.worker.gpuBusyHint'),
      );
    }
    if (!response.ok) {
      throw new WorkerError(
        'UPSTREAM_ERROR',
        translate(getLanguage(), 'common.worker.httpError', { status: response.status }),
        translate(getLanguage(), 'common.worker.httpErrorHint'),
      );
    }

    try {
      return (await response.json()) as unknown;
    } catch {
      throw new WorkerError(
        'UPSTREAM_ERROR',
        translate(getLanguage(), 'common.worker.badJson'),
        translate(getLanguage(), 'common.worker.badJsonHint'),
      );
    }
  }

  return {
    baseUrl,

    async health(): Promise<WorkerHealth> {
      const parsed = WorkerHealthSchema.safeParse(await call('/v1/health'));
      if (!parsed.success) {
        throw new WorkerError(
          'PROVIDER_UNAVAILABLE',
          translate(getLanguage(), 'common.worker.protocolMismatch', {
            version: WORKER_PROTOCOL_VERSION,
          }),
          translate(getLanguage(), 'common.worker.protocolMismatchHint'),
        );
      }
      return parsed.data;
    },

    async submit(request: WorkerJobRequest): Promise<{ jobId: string }> {
      const parsed = WorkerJobCreatedSchema.safeParse(
        await call('/v1/jobs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
        }),
      );
      if (!parsed.success) {
        throw new WorkerError(
          'UPSTREAM_ERROR',
          translate(getLanguage(), 'common.worker.noJobId'),
        );
      }
      return parsed.data;
    },

    async status(jobId: string): Promise<WorkerJobStatus> {
      const parsed = WorkerJobStatusSchema.safeParse(
        await call(`/v1/jobs/${encodeURIComponent(jobId)}`),
      );
      if (!parsed.success) {
        throw new WorkerError(
          'UPSTREAM_ERROR',
          translate(getLanguage(), 'common.worker.badJobStatus', { jobId }),
        );
      }
      return parsed.data;
    },

    async cancel(jobId: string): Promise<boolean> {
      const parsed = WorkerCancelResultSchema.safeParse(
        await call(`/v1/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' }),
      );
      return parsed.success && parsed.data.cancelled;
    },

    resultUrl(jobId: string): string {
      return `${baseUrl}/v1/jobs/${encodeURIComponent(jobId)}/result`;
    },
  };
}

/**
 * 连接前的静态检查（页面 ↔ worker 地址）：**不联网**，只回答"这条路会不会一出发就被浏览器拦"。
 * 直接用 shared 的纯函数（文案与判定在同一处，前后端不漂移）。
 */
/**
 * 链接自检 → **给用户看的文案**（语言迁移第十八批）。
 *
 * 共享包的 `checkWorkerLink` 现在只回答"发生了什么"（一个 code），句子在**这里**拼 ——
 * 返回形状与迁移前**完全一致**（`{ blocked, notice }`），所以调用点与单测零改动。
 * 这是本仓处理"跨包文案"的第三条路（前两条：搬进前端字典 / 保留中文 + 对拍断言）：
 * **回 code，不回句子** —— 适合"共享包要判断、界面要措辞"的情形。
 */
export function workerLinkCheck(
  pageProtocol: string,
  workerUrl: string,
): { blocked: string | null; notice: string | null } {
  const result = checkWorkerLink({ pageProtocol, workerUrl });
  const lang = getLanguage();
  switch (result.kind) {
    case 'ok':
      return { blocked: null, notice: null };
    case 'badUrl':
      return {
        blocked: translate(lang, 'common.worker.link.badUrl', { url: result.url }),
        notice: null,
      };
    case 'mixedContent':
      return {
        blocked: translate(lang, 'common.worker.link.mixedContent', { origin: result.origin }),
        notice: null,
      };
    case 'pnaHint':
      return { blocked: null, notice: translate(lang, 'common.worker.link.pna') };
  }
}

/** ApiError 与 WorkerError 的统一展示（界面层只需要一句话） */
export function describeWorkerFailure(caught: unknown): string {
  if (caught instanceof WorkerError) return caught.toText();
  if (caught instanceof ApiError) return caught.message;
  return caught instanceof Error ? caught.message : String(caught);
}

/** 把 worker 产物路径拼成可下载的直链（worker 只回相对路径，见协议） */
export function resolveWorkerResultUrl(client: WorkerClient, status: WorkerJobStatus): string | null {
  if (status.status !== 'succeeded' || status.resultPath === undefined) return null;
  // 防御：worker 回的必须是它自己域下的相对路径（防"被诱导去别的地址取值"）
  if (!status.resultPath.startsWith('/')) return null;
  return `${client.baseUrl}${status.resultPath}`;
}

/** 复用的解析（供调用方判断 `task:` 引用是否指向本地 worker 产物 —— 片 A 暂不用，留给片 B/C） */
export { parseTaskRef };
