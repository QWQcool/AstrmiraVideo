/**
 * 焦点陷阱的纯计算部分（S5-B4d）。
 *
 * 单独拆出来是为了能单测边界：当前焦点不在列表里（-1）、首尾环绕、Shift+Tab 反向。
 * DOM 查询/聚焦留在 `dialogFocus.ts` 的 hook 里。
 */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

/**
 * @param current 当前焦点在可聚焦列表里的下标（-1 = 不在列表里）
 * @param length  可聚焦元素数量
 * @param shift   true = Shift+Tab
 * @returns 下一个下标；列表为空时返回 -1
 */
export function nextTabIndex(current: number, length: number, shift: boolean): number {
  if (length <= 0) return -1;
  if (current < 0 || current >= length) return shift ? length - 1 : 0;
  return shift ? (current - 1 + length) % length : (current + 1) % length;
}
