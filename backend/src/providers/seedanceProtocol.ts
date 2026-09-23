import type { ErrorCode, TaskError, TaskProgress, VideoGenerateRequest } from '@astrmira/shared';
import { createTaskError } from '../errors.js';

/**
 * 火山方舟 Seedance 的**协议适配层**（纯函数，无 IO —— 便于单测与桩验证）。
 *
 * ## ✅ 证据等级（2026-09-23 真实出片后更新，逐项见下）
 * 本文件里的上游细节原先分【已确认】/【待验证】两级。**2026-09-23 用一把可用 Key
 * 真机出片一次（`scripts/smoke-seedance-paid.mjs`，720p / 5s / mini）**，四个待验证项全部落地：
 * | 待验证项 | 实测结论 | 证据 |
 * |---|---|---|
 * | 请求体字段名 + `content` 数组结构 | **一致** | 上游受理并产出任务（HTTP 200 + 可轮询） |
 * | `--` 尾缀参数（duration/ratio/resolution/watermark） | **一致** | 请求 5s/16:9/720p → 成片 5.09s / 1280×720；`--watermark false` 下画面无水印 |
 * | 响应 `status` 枚举 | **queued/running/succeeded 一致**；`failed`/`cancelled` 仍未实测 | 轮询依次读到 queued → running → succeeded |
 * | `content.video_url` 位置 | **一致** | 成片被成功下载（2.23MB）并落盘到 `outputs/` |
 *
 * 仍未实测的一项（**不得**当作已验证）：`failed` / `cancelled` / `canceled` / `expired`
 * 四个分支要一次真实的失败或取消样本。有出入**只改这里**（PLAN §8 风险 R2）。
 *
 * ## 追加证据（同日第三/四次：FL2V 与 V2V）
 * - **FL2V（首尾帧）【已验证】**：两个资产（首帧 + 尾帧，均经清洗网关上传达 71KB JPEG）→
 *   上游受理并出片成功，提交→终态 **100.4s**、5.09s / 1280×720 / h264+AAC；逐帧核对：
 *   **0.1s 起于首帧场景、4.9s 与给定尾帧几乎一致** —— `last_frame` 角色语义成立。
 * - **V2V（视频参考）【形态已验证，实现曾写错】**：把视频塞进 `image_url` / `reference_image`
 *   （**当时的实现**）被上游 400：`content[1].image_url is not valid`。
 *   三次参数级探测把正确形态问了出来（原文即证据）：
 *   ① `video_url` + 角色 `reference_image` → `reference media mode requires video role
 *      to be reference_video`（**角色名必须恰好是 `reference_video`**）；
 *   ② `video_url` + 角色 `reference_video` + **data URL** → `reference_video must be
 *      provided as a web url`（**只接受公网 URL**）；
 *   ③ 于是正确形态 = `{type:'video_url', video_url:{url}, role:'reference_video'}`，
 *      且 URL 必须是上游能抓的公网地址 → 未配 `PUBLIC_BASE_URL` 时必须**提前失败**。
 *
 * ## 追加证据（同日第二次冒烟：I2V）
 * `image_url` + `role: 'first_frame'` **已实测可用**：把上一条成片的首帧 JPEG（1280×720）经
 * `/api/upload`（过防线 4 清洗网关）上传为资产，再走 I2V 出片成功 —— 提交→终态 **124.7s**，
 * 成片 5.09s / 1280×720 / h264 + AAC 音轨，且**灯型与首帧保持一致**（这正是"锁形"的用处）。
 * 同时确认：`image_url.url` 接受 **base64 data URL**（本机 `PUBLIC_BASE_URL` 为空时的回落路径）。
 * `last_frame` / `reference_image`（含视频）**仍未实测**。
 *
 * ## 设计要点
 * 把"可能出错的上游细节"全部收进本文件，`VolcanoSeedanceProvider` 只负责流程与错误归类。
 * 这样上游改字段时，改动面就是这一个文件，且它的单测会立刻告诉你哪些假设被打破。
 */

/** 【已确认】方舟 v3 基址（可用 `options.baseUrl` 覆盖，便于自建代理 / 兼容端点） */
export const SEEDANCE_DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

/** 【已确认】任务集合路径 */
export const SEEDANCE_TASKS_PATH = '/contents/generations/tasks';

/**
 * 【已验证】OpenAI 兼容的模型列表端点（2026-09-23 实测 `GET /api/v3/models` 返回 135 项）。
 * 它是"测试连接"能**零费用**判断凭据与模型存在性的依据（CONTRACT §9）。
 */
export const SEEDANCE_MODELS_PATH = '/models';

/**
 * 兜底模型 id：**仅在"用户/请求都没给模型"时**使用（请求 > env > 本常量）。
 *
 * 2026-09-23 实测：`doubao-seedance-2-0-mini-260615` 在用户账号**已开通可用**，
 * 且是 2.0 代最便宜的档位（用户明确要求"尽量用最省钱的模型"）。
 * ⚠️ 可用性是**按账号**的：别的部署者账号若未开通该模型，会在提交时收到 404 ——
 * 界面上的「测试连接」会直接给出这个结论，不必花一次生成的钱去试。
 */
export const SEEDANCE_DEFAULT_MODEL = 'doubao-seedance-2-0-mini-260615';

export type SeedanceImageRole = 'first_frame' | 'last_frame' | 'reference_image';

/**
 * 【已验证 2026-09-23】视频参考的角色名。
 *
 * 这一项是**试出来的**，两次 400 把话说得很清楚（原文见下方证据表）：
 * ① 视频塞进 `image_url` / `reference_image` → `content[1].image_url is not valid`；
 * ② `video_url` 但角色写成 `reference_image` → `reference media mode requires video role
 *    to be reference_video`（**角色名必须恰好是 `reference_video`**）；
 * ③ 角色对了但给的是 data URL → `reference_video must be provided as a web url`
 *    （**视频只能给上游可抓的公网 URL**，图片则可以给 data URL）。
 */
export type SeedanceVideoRole = 'reference_video';

export type SeedanceContent =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string }; role: SeedanceImageRole }
  | { type: 'video_url'; video_url: { url: string }; role: SeedanceVideoRole };

export interface SeedanceSubmitBody {
  model: string;
  content: SeedanceContent[];
  [key: string]: unknown;
}

/**
 * 【已验证】分辨率档位：方舟按 `480p / 720p / 1080p` 这类档位表达，而不是像素尺寸
 * （2026-09-23 实测：传 `--resolution 720p` 得到 1280×720 成片）。
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
  /** 【已验证】`image_url` 需要的可访问地址：优先公网 URL，否则 data URL（图片两者都接受） */
  imageUrls?: Partial<Record<SeedanceImageRole, string>>;
  /**
   * 【已验证】参考视频地址（V2V）。**必须是上游可抓的公网 URL** ——
   * 给 data URL 会被上游直接拒绝（原文：`reference_video must be provided as a web url`）。
   * 因此调用方要在"没有 `PUBLIC_BASE_URL`"时**提前失败**，而不是发一个注定 400 的请求。
   */
  videoUrl?: string;
  /** 覆盖分辨率档位（不传则按 resolution 或画幅推导） */
  resolutionOverride?: string;
  /** 是否让上游加水印（默认 false：我们自己不做水印，也不希望上游加） */
  watermark?: boolean;
}

/**
 * 契约请求 → 上游请求体。
 *
 * 【已验证 2026-09-23】的两个约定都体现在这里（真机出片一次：请求 5s / 16:9 / 720p →
 * 成片 5.09s / 1280×720 / h264 + AAC 音轨；`--watermark false` 下画面无水印）：
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

  // V2V：视频参考是**另一种元素**（`video_url` + 角色 `reference_video`），不能塞进 image_url
  if (options.videoUrl !== undefined && options.videoUrl !== '') {
    content.push({ type: 'video_url', video_url: { url: options.videoUrl }, role: 'reference_video' });
  }

  return { model: options.model, content };
}

/**
 * 上游状态枚举 → 契约状态。未知值一律当 `running`（**绝不能把未知当成功**）。
 *
 * 【部分已验证 2026-09-23】实测依次读到 `queued` → `running` → `succeeded`；
 * `failed` / `cancelled` / `canceled` / `expired` 四个分支**仍未实测**（要一次真实失败或取消）。
 */
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
 * 响应形状的**容错读取**（`content.video_url` 的位置【已验证 2026-09-23】：成片被成功下载；
 * 其余别名键仍属"见过但未逐一对过"的保险）。
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

/** 模型/接入点相关的上下文（用于把"模型名不对"翻译成可执行指引） */
export interface ModelContext {
  /** 本次**实际**发出去的模型 */
  effectiveModel?: string;
  /** 它的来源：请求体 / 服务端 env / 协议层默认 */
  modelSource?: 'request' | 'env' | 'default';
  /** 用户/请求**想用**的模型（与 effectiveModel 不同即为"被覆盖"） */
  requestedModel?: string;
}

/** 上游"模型或接入点不存在/无权限"的判定（方舟两种 code 与通用文案都覆盖） */
function looksLikeModelNotFound(upstreamCode: string | undefined, message: string | undefined): boolean {
  const haystack = `${upstreamCode ?? ''} ${message ?? ''}`.toLowerCase();
  return (
    haystack.includes('invalidendpointormodel') ||
    haystack.includes('modelnotfound') ||
    haystack.includes('does not exist or you do not have access')
  );
}

/**
 * 把"模型不存在/未开通"翻译成**可直接照做**的诊断句。
 *
 * 2026-09-23 的线上故障里，用户拿到的原始报文只有
 * `The model or endpoint doubao-seedance-video does not exist`，
 * 而界面上他填的是另一个模型 —— 这中间发生了什么，**原报文一个字都没说**。
 * 这正是本函数存在的理由：把"实际用了什么、来源在哪、下一步做什么"讲清楚。
 */
function buildModelNotFoundHint(context: ModelContext | undefined): string {
  if (context?.effectiveModel === undefined) {
    return '请确认模型/接入点 id 与它在方舟控制台里的开通状态（可用「测试连接」零费用核对）。';
  }

  const sourceLabel =
    context.modelSource === 'request'
      ? '请求里填的（BYOK 抽屉 / options.model）'
      : context.modelSource === 'env'
        ? '服务端环境变量 VOLCANO_MODEL_NAME'
        : '服务端内置默认值';

  const overridden =
    context.requestedModel !== undefined && context.requestedModel !== context.effectiveModel
      ? `；你在界面上填的是 \`${context.requestedModel}\`，**被 ${sourceLabel} 覆盖了**（请让部署者清掉该环境变量）`
      : '';

  return (
    `本次实际请求的模型是 \`${context.effectiveModel}\`（来源：${sourceLabel}）${overridden}。` +
    '请在方舟控制台确认该模型 id 是否正确、是否已开通（模型广场 → 开通管理），' +
    '或改用「凭据设置（BYOK）」里已实测可用的档位；界面上的「测试连接」可零费用核对。'
  );
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
 *
 * `context` 是可选参数（不传时行为与 V1.9 完全一致），只在"模型不存在"这一类里加诊断句。
 */
export function classifyHttpFailure(
  httpStatus: number,
  payload: unknown,
  context?: ModelContext,
): { code: ErrorCode; message: string; dispositionOverride?: 'terminal' } {
  const upstream = readUpstreamError(payload);
  const detail =
    upstream === undefined
      ? `HTTP ${httpStatus}`
      : `HTTP ${httpStatus}【${upstream.code}】：${upstream.message}`;

  if (httpStatus === 401 || httpStatus === 403) {
    return { code: 'KEY_INVALID', message: `凭据被上游拒绝（${detail}）` };
  }

  // 模型/接入点不存在：这不是"等一下再试"的事，而是"去改配置"的事
  if (looksLikeModelNotFound(upstream?.code, upstream?.message)) {
    return {
      code: 'UPSTREAM_ERROR',
      message: `${detail}｜诊断：${buildModelNotFoundHint(context)}`,
      dispositionOverride: 'terminal',
    };
  }

  if (httpStatus === 429 || httpStatus >= 500) {
    return { code: 'UPSTREAM_ERROR', message: detail };
  }

  return { code: 'UPSTREAM_ERROR', message: detail, dispositionOverride: 'terminal' };
}
