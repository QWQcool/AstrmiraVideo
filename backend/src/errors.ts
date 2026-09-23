import { ErrorCodeSchema, ErrorDispositionSchema } from '@astrmira/shared';
import type { ErrorCode, ErrorDisposition, ErrorResponse, TaskError } from '@astrmira/shared';
import { MediaProbeError } from './lib/ffmpeg.js';

/**
 * 三态错误码的**唯一映射表**（CONTRACT §6）。
 *
 * 设计要求（S3 / AC7）：
 * 1. **穷举**：`ERROR_DISPOSITION` 用 `satisfies Record<ErrorCode, ErrorDisposition>` 钉死，
 *    shared 里新增第 13 个码而此处漏填 → **编译期直接报错**（不是运行期才发现）；
 * 2. **不猜**：任何错误分支都必须能落到这三态之一，不允许"视情况而定"；
 * 3. **防线 7 的护栏在 resolveTaskError 里**：只有**已提交上游**的失败才允许 `uncertain`
 *    ——未提交上游的失败重试无副作用，属于 `retryable`（否则会把"安全可重试"误标成"需人工核对"）。
 */

export const ERROR_DISPOSITION = {
  PROVIDER_UNAVAILABLE: 'terminal',
  GPU_BUSY: 'retryable',
  RATE_LIMITED: 'retryable',
  INVALID_ASSET: 'terminal',
  PROMPT_REJECTED: 'terminal',
  UPSTREAM_ERROR: 'retryable',
  UNCERTAIN_RESULT: 'uncertain',
  TASK_NOT_FOUND: 'terminal',
  DISK_FULL: 'terminal',
  LLM_NOT_CONFIGURED: 'terminal',
  KEY_INVALID: 'terminal',
  KEY_MISSING: 'terminal',
  // V2.3（V9 · B9）：请求形状合法但值/组合不合法 —— 重试无意义，必须改参数
  INVALID_REQUEST: 'terminal',
} satisfies Record<ErrorCode, ErrorDisposition>;

/** 全部错误码（供契约层穷举断言使用，避免测试里手写第二份清单） */
export function listErrorCodes(): readonly ErrorCode[] {
  return ErrorCodeSchema.options;
}

export function dispositionOf(code: ErrorCode): ErrorDisposition {
  return ERROR_DISPOSITION[code];
}

/** 构造任务错误（disposition 一律取自映射表，调用方不得自造） */
export function createTaskError(code: ErrorCode, message?: string): TaskError {
  return {
    code,
    message: message ?? defaultMessageOf(code),
    disposition: dispositionOf(code),
  };
}

/** 构造统一错误响应体（CONTRACT §5 / §6） */
export function createErrorResponse(code: ErrorCode, message?: string): ErrorResponse {
  const error = createTaskError(code, message);
  return { code: error.code, message: error.message, disposition: error.disposition };
}

/**
 * provider / 上游抛出的**可归类失败**。
 * provider 实现用它表达「我知道这是什么错」；未归类的异常由 `resolveTaskError` 兜底。
 */
export class ProviderFailureError extends Error {
  constructor(
    readonly code: ErrorCode,
    message?: string,
    /** 显式覆盖（默认取映射表）；仅在映射表语义不足时使用 */
    readonly dispositionOverride?: ErrorDisposition,
  ) {
    super(message ?? defaultMessageOf(code));
    this.name = 'ProviderFailureError';
  }
}

export interface FailureContext {
  /**
   * 是否**已进入提交阶段**（对应 CONTRACT §5 的 `submitting` 标记：它在真正向上游提交**之前**落库）。
   *
   * 判据必须用"是否进入提交阶段"，而不是"是否拿到 upstreamTaskId"：
   * 提交动作已发出但响应丢失时，我们拿不到 `upstreamTaskId`，却**无法排除**上游已经受理
   * ——这正是 `UNCERTAIN_RESULT` 存在的理由。只有确知从未进入提交阶段的失败才能安全重试。
   */
  submissionAttempted: boolean;
}

/**
 * 未知异常 → 三态归类的**唯一入口**（dispatcher 只调用它，不再自己判 code）。
 *
 * 归属规则（CONTRACT §6 硬规则 2，适用范围＝有持久副作用的任务型上游）：
 * - `ProviderFailureError`：按它声明的 code 归类（provider 明确知道发生了什么）；
 * - 媒体探测失败（`MediaProbeError`）：`INVALID_ASSET`（terminal）；
 * - 其余未知异常：**已进入提交阶段** → `UNCERTAIN_RESULT`（禁止自动重提）；
 *   **未进入提交阶段** → `UPSTREAM_ERROR`（retryable，重试无副作用）。
 */
export function resolveTaskError(err: unknown, ctx: FailureContext): TaskError {
  if (err instanceof ProviderFailureError) {
    const requested = err.dispositionOverride ?? dispositionOf(err.code);

    // 护栏：未进入提交阶段时不存在"结果不确定"——把误标的 uncertain 降级为可安全重试
    if (requested === 'uncertain' && !ctx.submissionAttempted) {
      return createTaskError(
        'UPSTREAM_ERROR',
        `${err.message}（尚未进入提交阶段，可安全重试）`,
      );
    }
    return { code: err.code, message: err.message, disposition: requested };
  }

  if (err instanceof MediaProbeError) {
    return createTaskError('INVALID_ASSET', err.message);
  }

  const detail = err instanceof Error ? err.message : String(err);
  return ctx.submissionAttempted
    ? createTaskError('UNCERTAIN_RESULT', `执行中断且无法确认上游结果：${detail}`)
    : createTaskError('UPSTREAM_ERROR', detail);
}

/** 兜底文案（可被调用方覆盖） */
function defaultMessageOf(code: ErrorCode): string {
  switch (code) {
    case 'PROVIDER_UNAVAILABLE':
      return '所选引擎不可用';
    case 'GPU_BUSY':
      return '本地队列已有任务在执行';
    case 'RATE_LIMITED':
      return '提交过于频繁，请等待冷却窗口结束';
    case 'INVALID_ASSET':
      return '素材无法处理（格式或尺寸不合规）';
    case 'PROMPT_REJECTED':
      return '提示词不合规';
    case 'INVALID_REQUEST':
      return '请求参数不合法（形状没问题，但取值或组合不被接受）';
    case 'UPSTREAM_ERROR':
      return '上游返回错误';
    case 'UNCERTAIN_RESULT':
      return '结果不明：已提交上游但无法确认执行结果，请勿自动重试';
    case 'TASK_NOT_FOUND':
      return '任务不存在或已清理';
    case 'DISK_FULL':
      return '输出目录磁盘空间不足';
    case 'LLM_NOT_CONFIGURED':
      return '未配置扩写模型（纯 BYOK：请在设置里填入 LLM Key）';
    case 'KEY_INVALID':
      return '凭据被上游拒绝';
    case 'KEY_MISSING':
      return '缺少凭据：既未随请求提供，服务端也未配置兜底 Key';
    default: {
      const exhaustive: never = code;
      return String(exhaustive);
    }
  }
}

/** 运行时自检：映射表必须覆盖契约里的每一个码（防手写漂移） */
export function assertErrorMappingComplete(): void {
  const missing = listErrorCodes().filter((code) => ERROR_DISPOSITION[code] === undefined);
  if (missing.length > 0) {
    throw new Error(`错误码映射表缺失：${missing.join(', ')}`);
  }
}

export { ErrorDispositionSchema };
