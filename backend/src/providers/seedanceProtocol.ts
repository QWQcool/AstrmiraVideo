import type { ErrorCode, TaskError, TaskProgress, VideoGenerateRequest } from '@astrmira/shared';
import { createTaskError } from '../errors.js';

/**
 * 火山方舟 Seedance 的**协议适配层**（纯函数，无 IO —— 便于单测与桩验证）。
 *
 * ## ⚠️ 证据等级声明（不要在别处复制这段话又改口气）
 * 本文件里的上游细节分两级，混淆它们就等于伪造验证：
 * - **【已确认】**：端点是官方公开信息（官方文档 snippet 直接给出
 *   `POST/GET/DELETE https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks[/{id}]`）；
 * - **【待验证】**：请求体字段名、`content` 数组结构、`--` 尾缀参数、响应 `status` 枚举与
 *   `content.video_url` 位置 —— 多来源一致，但**官方文档页是 SPA 抓不到正文、且本仓库尚无可用 Key**，
 *   因此**尚未实测**。首次真实冒烟（AC2）时逐项核对本文件；有出入**只改这里**（PLAN §8 风险 R2）。
 *
 * ## 设计要点
 * 把"可能出错的上游细节"全部收进本文件，`VolcanoSeedanceProvider` 只负责流程与错误归类。
 * 这样上游改字段时，改动面就是这一个文件，且它的单测会立刻告诉你哪些假设被打破。
 */

/** 【已确认】方舟 v3 基址（可用 `options.baseUrl` 覆盖，便于自建代理 / 兼容端点） */
export const SEEDANCE_DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

/** 【已确认】任务集合路径 */
export const SEEDANCE_TASKS_PATH = '/contents/generations/tasks';

/** 【待验证】方舟模型 id 的默认值；实际以用户 BYOK 抽屉里填的为准 */
export const SEEDANCE_DEFAULT_MODEL = 'doubao-seedance-1-0-pro-250528';

export type SeedanceImageRole = 'first_frame' | 'last_frame' | 'reference_image';

export type SeedanceContent =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string }; role: SeedanceImageRole };

export interface SeedanceSubmitBody {
  model: string;
  content: SeedanceContent[];
  [key: string]: unknown;
}

/**
 * 【待验证】分辨率档位：方舟按 `480p / 720p / 1080p` 这类档位表达，而不是像素尺寸。
 * 这里按**短边**归档（480p≈短边 480），仅作默认；用户可用 `options.seedanceResolution` 覆盖。
 */
export function resolutionToTier(width: number, height: number): '480p' | '720p' | '1080p' {
  const shortSide = Math.min(width, height);
  if (shortSide >= 1000) return '1080p';
  if (shortSide >= 640) return '720p';
  return '480p';
}

/**
 * 【已确认】契约的 `aspectRatio` 与方舟 `--ratio` 同形（`16:9` / `9:16` / `1:1` 都在其取值集合内）。
 * 此处仍显式映射一次：将来契约新增比例（如 `4:3`）时，这里会**报错而不是静默传错值**。
 */
export function aspectRatioToUpstream(ratio: VideoGenerateRequest['aspectRatio']): string {
  switch (ratio) {
    case '16:9':
    case '9:16':
    case '1:1':
      return ratio;
    default: {
      const exhaustive: never = ratio;
      throw new Error(`未映射的画面比例：${String(exhaustive)}`);
    }
  }
}

export interface BuildSubmitOptions {
  /** 上游模型 id（来自 BYOK 或 env 兜底） */
  model: string;
  /** 【待验证】`image_url` 需要的可访问地址：优先公网 URL，否则 data URL */
  imageUrls?: Partial<Record<SeedanceImageRole, string>>;
  /** 覆盖分辨率档位（不传则按 resolution 或画幅推导） */
  resolutionOverride?: string;
  /** 是否让上游加水印（默认 false：我们自己不做水印，也不希望上游加） */
  watermark?: boolean;
}

/**
 * 契约请求 → 上游请求体。
 *
 * 【待验证】的两个约定都体现在这里：
 * 1. `duration / ratio / resolution / seed / watermark` **不是独立字段**，而是拼在 `text` 末尾的 `--` 参数；
 * 2. 图片走 `content` 里的 `image_url` 元素，`role` 区分首/尾/参考帧。
 */
export function buildSeedanceSubmitBody(
  request: VideoGenerateRequest,
  options: BuildSubmitOptions,
): SeedanceSubmitBody {
  const directives: string[] = [];

  const durationSec = request.params?.durationSec;
  if (durationSec !== undefined) directives.push(`--duration ${durationSec}`);

  directives.push(`--ratio ${aspectRatioToUpstream(request.aspectRatio)}`);

  const resolution =
    options.resolutionOverride ??
    (request.resolution === undefined
      ? undefined
      : resolutionToTier(request.resolution.width, request.resolution.height));
  if (resolution !== undefined) directives.push(`--resolution ${resolution}`);

  const seed = request.params?.seed;
  if (seed !== undefined) directives.push(`--seed ${seed}`);

  directives.push(`--watermark ${options.watermark === true ? 'true' : 'false'}`);

  const text = `${request.prompt} ${directives.join(' ')}`.trim();

  const content: SeedanceContent[] = [{ type: 'text', text }];

  const roles: SeedanceImageRole[] = ['first_frame', 'last_frame', 'reference_image'];
  for (const role of roles) {
    const url = options.imageUrls?.[role];
    if (url !== undefined && url !== '') content.push({ type: 'image_url', image_url: { url }, role });
  }

  return { model: options.model, content };
}

/** 【待验证】上游状态枚举 → 契约状态。未知值一律当 `running`（**绝不能把未知当成功**） */
export function mapUpstreamStatus(raw: unknown): TaskProgress['status'] {
  switch (raw) {
    case 'queued':
      return 'queued';
    case 'running':
      return 'running';
    case 'succeeded':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'cancelled':
    case 'canceled':
    case 'expired':
      return 'cancelled';
    default:
      return 'running';
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/**
 * 【待验证】响应形状的**容错读取**。
 * 刻意写得宽松（`id`/`task_id`、`content.video_url`/`video_url` 都认），因为上游字段名
 * 在文档版本间有差异；但**严谨处不放松**：读不到就返回 `undefined`，由上层报错，
 * 绝不编一个地址出来。
 */
export function readUpstreamTaskId(payload: unknown): string | undefined {
  const record = asRecord(payload);
  if (record === undefined) return undefined;

  for (const key of ['id', 'task_id', 'taskId']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return undefined;
}

export function readUpstreamVideoUrl(payload: unknown): string | undefined {
  const record = asRecord(payload);
  if (record === undefined) return undefined;

  const content = asRecord(record['content']);
  const candidates = [content?.['video_url'], content?.['videoUrl'], record['video_url'], record['videoUrl']];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim();
  }
  return undefined;
}

/** 【待验证】上游错误结构（`error.code` / `error.message`） */
export function readUpstreamError(payload: unknown): { code: string; message: string } | undefined {
  const record = asRecord(payload);
  const error = asRecord(record?.['error']);
  if (error === undefined) return undefined;

  const code = typeof error['code'] === 'string' ? error['code'] : 'UpstreamError';
  const message = typeof error['message'] === 'string' ? error['message'] : '上游未提供错误描述';
  return { code, message };
}

/** 上游任务对象 → 我们的进度片段（不含 requestSnapshot，由调用方补） */
export interface ParsedTaskState {
  status: TaskProgress['status'];
  progressPercent: number;
  videoUrl?: string;
  message?: string;
  error?: TaskError;
}

export function parseSeedanceTask(payload: unknown): ParsedTaskState {
  const record = asRecord(payload);
  if (record === undefined) {
    throw new Error('上游返回了无法解析的任务对象（非 JSON 对象）');
  }

  const status = mapUpstreamStatus(record['status']);

  if (status === 'succeeded') {
    const videoUrl = readUpstreamVideoUrl(payload);
    if (videoUrl === undefined) {
      // 成功但拿不到地址 = 异常，必须显式暴露（不能静默返回"成功但无成片"）
      return {
        status: 'failed',
        progressPercent: 100,
        error: createTaskError(
          'UPSTREAM_ERROR',
          '上游报告成功但响应中没有视频地址（content.video_url 缺失；协议字段可能已变更）',
        ),
      };
    }
    return { status: 'succeeded', progressPercent: 100, videoUrl, message: '上游生成完成' };
  }

  if (status === 'failed') {
    const upstream = readUpstreamError(payload);
    return {
      status: 'failed',
      progressPercent: 100,
      error: createTaskError(
        'UPSTREAM_ERROR',
        upstream === undefined
          ? '上游报告失败但未提供错误详情'
          : `上游失败【${upstream.code}】：${upstream.message}`,
      ),
    };
  }

  if (status === 'cancelled') {
    return { status: 'cancelled', progressPercent: 0, message: '上游任务已取消或已过期' };
  }

  // queued / running：上游不提供百分比，这里给一个"看起来在动"的区间值，
  // 但**永不越过 100**（终态才算 100），避免界面提前显示完成。
  const progressPercent = status === 'queued' ? 5 : 45;
  return { status, progressPercent, message: status === 'queued' ? '上游排队中' : '上游生成中' };
}

/**
 * HTTP 失败 → 错误码归类（**这是"明确返回"与"结果不明"的分界线**）。
 *
 * 归属原则（CONTRACT §6）：
 * - 401 / 403：凭据被拒 → `KEY_INVALID`（terminal，重试无意义）；
 * - 429：上游限流 → `UPSTREAM_ERROR`（retryable，明确被告知"稍后再来"）；
 * - 5xx：上游明确报错（响应体可读）→ `UPSTREAM_ERROR`（retryable）；
 * - 其余 4xx：**多半是请求本身有问题**（参数/内容），显式覆盖为 `terminal`
 *   —— 语义仍属"上游明确返回"，但不该鼓励用户原样重试（那只会重复失败）。
 *
 * 反面情形（**不属于本函数**）：网络中断、超时、响应不可解析 —— 那些由调用方抛出异常，
 * 交给 `resolveTaskError` 在"已提交上游"的前提下归 `UNCERTAIN_RESULT`。
 */
export function classifyHttpFailure(
  httpStatus: number,
  payload: unknown,
): { code: ErrorCode; message: string; dispositionOverride?: 'terminal' } {
  const upstream = readUpstreamError(payload);
  const detail =
    upstream === undefined
      ? `HTTP ${httpStatus}`
      : `HTTP ${httpStatus}【${upstream.code}】：${upstream.message}`;

  if (httpStatus === 401 || httpStatus === 403) {
    return { code: 'KEY_INVALID', message: `凭据被上游拒绝（${detail}）` };
  }

  if (httpStatus === 429 || httpStatus >= 500) {
    return { code: 'UPSTREAM_ERROR', message: detail };
  }

  return { code: 'UPSTREAM_ERROR', message: detail, dispositionOverride: 'terminal' };
}
