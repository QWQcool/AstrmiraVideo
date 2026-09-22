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

const TARGET_SIZES: Record<AspectRatio, TargetSize> = {
  '16:9': { width: 832, height: 480 },
  '9:16': { width: 480, height: 832 },
  '1:1': { width: 640, height: 640 },
};

export function resolveTargetSize(ratio: AspectRatio): TargetSize {
  return TARGET_SIZES[ratio];
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
