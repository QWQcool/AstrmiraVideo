import type { AspectRatio } from '@astrmira/shared';

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

/** 任务状态 → 中文标签（避免散落在组件里拼字符串） */
export function statusLabel(status: string): string {
  switch (status) {
    case 'queued':
      return '排队中';
    case 'running':
      return '生成中';
    case 'succeeded':
      return '已完成';
    case 'failed':
      return '未完成';
    case 'cancelled':
      return '已取消';
    default:
      return status;
  }
}
