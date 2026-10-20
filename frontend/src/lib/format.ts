import type { AspectRatio, ExecutedBy } from '@astrmira/shared';
import { getLanguage, translate, type MessageKey } from './i18n';

/**
 * 展示层格式化（纯函数，可单测）。
 * 目标尺寸必须落在 **32 的整数倍**上（CONTRACT §1「自动对齐为 32 的整数倍」）。
 */

/** 3 位索引号（AC6）：分区标题与卡片统一用它 */
export function formatIndex(index: number): string {
  const safe = Math.max(0, Math.floor(index));
  return String(safe).padStart(3, '0').slice(-3);
}

export interface TargetSize {
  width: number;
  height: number;
}

/**
 * 清晰度档（对齐上游 `--resolution` 的取值集合：480p / 720p / 1080p）。
 * 后端 `seedanceProtocol.resolutionToTier` 按**短边**归档：< 640 → 480p，640~999 → 720p，≥ 1000 → 1080p。
 * 下表每一格的短边都落在对应档位区间内，因此"界面显示的目标尺寸"与"发给上游的档位"不会互相打架。
 */
export type ResolutionTier = '480p' | '720p' | '1080p';

export const RESOLUTION_TIERS = ['480p', '720p', '1080p'] as const;

export const DEFAULT_RESOLUTION_TIER: ResolutionTier = '480p';

/** 可选时长（秒）：`DurationSecSchema` 是 `positive().max(10)`，所以这里最大只能到 10 */
export const DURATION_OPTIONS = [3, 5, 8, 10] as const;

export const DEFAULT_DURATION_SEC = 5;

/** 时长被夹进契约允许的区间（1~10 的整数） */
export function clampDurationSec(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DURATION_SEC;
  return Math.min(10, Math.max(1, Math.round(value)));
}

/** 每一格都必须落在 32 的倍数上（AC/契约要求；单测逐格断言） */
const TARGET_SIZES: Record<ResolutionTier, Record<AspectRatio, TargetSize>> = {
  '480p': {
    '16:9': { width: 832, height: 480 },
    '9:16': { width: 480, height: 832 },
    '1:1': { width: 480, height: 480 },
  },
  '720p': {
    '16:9': { width: 1280, height: 704 },
    '9:16': { width: 704, height: 1280 },
    '1:1': { width: 704, height: 704 },
  },
  '1080p': {
    '16:9': { width: 1920, height: 1056 },
    '9:16': { width: 1056, height: 1920 },
    '1:1': { width: 1056, height: 1056 },
  },
};

/**
 * 由像素尺寸反推档位（用于"参数一键回填"：快照里存的是 `resolution` 像素，不是档位名）。
 * 归档口径与后端 `seedanceProtocol.resolutionToTier` 一致：按**短边**。
 */
export function tierForSize(width: number, height: number): ResolutionTier {
  const shortSide = Math.min(width, height);
  if (shortSide >= 1000) return '1080p';
  if (shortSide >= 640) return '720p';
  return '480p';
}

/** 目标渲染尺寸 = 画幅 × 清晰度档（默认 480p，与历史行为一致） */
export function resolveTargetSize(
  ratio: AspectRatio,
  tier: ResolutionTier = DEFAULT_RESOLUTION_TIER,
): TargetSize {
  return TARGET_SIZES[tier][ratio];
}

export function isMultipleOf32(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value % 32 === 0;
}

/** CSS 的 `aspect-ratio` 用值：`16:9` → `16 / 9` */
export function toCssAspectRatio(ratio: AspectRatio): string {
  return ratio.replace(':', ' / ');
}

/**
 * 提示词里的台词长度（中文引号与英文引号都算）。
 * 用于"台词建议 ≤ 20 字"的即时提示 —— 只提示，不阻断（阻断由服务端 PROMPT_REJECTED 决定）。
 */
export function dialogueLength(prompt: string): number {
  const matches = prompt.match(/[“"]([^”"]*)[”"]/g) ?? [];
  return matches.reduce((sum, matched) => sum + matched.slice(1, -1).length, 0);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 毫秒 → `mm:ss` */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * 操作日志的**动作名**（原 `@astrmira/shared` 的 `LOG_ACTION_LABELS` / `logActionLabel`；
 * 语言迁移第十六批搬来这里）。
 *
 * 三处共用：日志页的行内与下拉、画布节点检查器的"这条任务发生了什么"、总览的活动流。
 * 搬家的判据见 `dict/edit.ts` 文件头：**后端只存 id、从不存中文** → 中文表只有前端在用，
 * 而中文表没法双语。
 */
export const LOG_ACTION_KEYS: Record<string, MessageKey> = {
  'generate.submit': 'edit.logAction.generateSubmit',
  'edit.submit': 'edit.logAction.editSubmit',
  'edit.render': 'edit.logAction.editRender',
  'task.cancel': 'edit.logAction.taskCancel',
  'task.complete': 'edit.logAction.taskComplete',
  'task.fail': 'edit.logAction.taskFail',
  'task.uncertain': 'edit.logAction.taskUncertain',
  'history.delete': 'edit.logAction.historyDelete',
  upload: 'edit.logAction.upload',
  enhance: 'edit.logAction.enhance',
  'keys.verify': 'edit.logAction.keysVerify',
  'logs.delete': 'edit.logAction.logsDelete',
  'logs.clear': 'edit.logAction.logsClear',
  'storage.evict': 'edit.logAction.storageEvict',
  'auth.failed': 'edit.logAction.authFailed',
  'request.error': 'edit.logAction.requestError',
};

/**
 * 动作 id → 显示名（**未知动作原样返回 id**）。
 *
 * 这条"宁可显示 id 也不显示空白"的口径是**原来就有的好设计**，搬过来时一字未改：
 * 空白最容易被当成"没这回事"，而 id 至少能搜、能对日志。
 * 它同时是 `buildActivityFeed`（总览）与两处视图的入参，所以保持函数形态、按当前语言取。
 */
export function logActionLabel(action: string | undefined): string {
  if (action === undefined) return '—';
  const key = LOG_ACTION_KEYS[action];
  return key === undefined ? action : translate(getLanguage(), key);
}

/**
 * 任务状态 → 文案键（**"徽章口径"**：失败就说"失败"）。
 *
 * ⚠️ 与下面 `STATUS_LABEL_KEYS`（"中央视窗口径"：失败说"**未完成**"）**不是同一套**，
 * 这是**刻意保留的两套**（见 `dict/common.ts` 的说明）：徽章是一个判定，
 * 而视窗那条连成片都没有、说"失败"过重。语言迁移第十二批把视频库原来的
 * `STATUS_TEXT` 表换成这份键表 —— 它当年抄的就是"徽章口径"，所以换成**同一处定义**即可
 * （文案一字未改）。别再新写第三份。
 */
export const TASK_STATUS_KEYS: Record<string, MessageKey> = {
  queued: 'common.status.queued',
  running: 'common.status.running',
  succeeded: 'common.status.succeeded',
  failed: 'common.status.failed',
  cancelled: 'common.status.cancelled',
};

const STATUS_LABEL_KEYS: Record<string, MessageKey> = {
  queued: 'common.statusLabel.queued',
  running: 'common.statusLabel.running',
  succeeded: 'common.statusLabel.succeeded',
  failed: 'common.statusLabel.failed',
  cancelled: 'common.statusLabel.cancelled',
};

/**
 * 执行位置（`executedBy`）的**键表**（V2.27 / 台账 B11；语言迁移第十二批收敛）。
 *
 * 为什么从 `@astrmira/shared` 的 `EXECUTED_BY_LABELS` / `EXECUTED_BY_TITLES` 收敛过来：
 * 那两个常量是**中文**，而三处前端（画布节点卡 / 工作台画廊卡 / 视频库）都在显示它们 ——
 * 英文界面下它们只能显示中文。收敛后前端走字典，共享包那两个常量**保留**（后端将来可用），
 * 由 `format.test.ts` 里**逐字比对**的断言钉住"两份中文不许悄悄漂移"。
 *
 * 组件直接用 `t(EXECUTED_BY_LABEL_KEYS[id])` 取（这样语言一变就会重渲染）；
 * 只有非 React 上下文才需要 `executedByLabel()` 那种现取函数。
 */
export const EXECUTED_BY_LABEL_KEYS: Record<ExecutedBy, MessageKey> = {
  cloud: 'common.executedBy.cloud',
  'host-local': 'common.executedBy.hostLocal',
  remote: 'common.executedBy.remote',
  'client-worker': 'common.executedBy.clientWorker',
};

/**
 * 完整说法（悬停用）的键表。
 *
 * 它比短标签重要：三个位置对"**数据去了哪**"的含义完全不同，用户有权一眼看到 ——
 * 所以中英语气必须同样明确，不能弱化成 "probably local"。
 */
export const EXECUTED_BY_TITLE_KEYS: Record<ExecutedBy, MessageKey> = {
  cloud: 'common.executedBy.title.cloud',
  'host-local': 'common.executedBy.title.hostLocal',
  remote: 'common.executedBy.title.remote',
  'client-worker': 'common.executedBy.title.clientWorker',
};

/**
 * 任务状态 → 标签（避免散落在组件里拼字符串）。
 *
 * ⚠️ V2.41（语言迁移）：**这里是"非 React 上下文取文案"的第一处** ——
 * 它被中央视窗 / 画廊卡 / 右栏调用（`GalleryCard` / `RightPanel`），改造成 hook 不划算，
 * 所以直接按**当前语言**取（`getLanguage()`），而**调用它的组件都订阅了语言**
 * （`useTranslate()` / `useLanguage()`）—— 语言一变它们会重渲染，这里的结果跟着变。
 *
 * 未知状态**原样返回**（不猜、不显示空白）：服务端将来加了新状态，界面显示原始值而不是空白。
 */
export function statusLabel(status: string): string {
  const key = STATUS_LABEL_KEYS[status];
  return key === undefined ? status : translate(getLanguage(), key);
}
