import type { CSSProperties } from 'react';

/**
 * 卡片级联入场的序号注入（V9 · B6）。
 *
 * CSS 侧统一用 `animation-delay: calc(var(--stagger, 0) * 40ms)` 计算延迟，
 * 这里只负责把"这是第几张卡"变成一个合法的 CSS 自定义属性。
 *
 * 为什么序号由组件给、而不是用 `:nth-child` 写死：
 * 列表长度是变的（视频库可能有 50 张、总览只有 9 张），而**延迟不该无限增长** ——
 * 由视图决定给前几张注入序号，比在 CSS 里堆 12 条 `:nth-child` 规则更好维护。
 */
export function staggerStyle(index: number): CSSProperties {
  return { '--stagger': index } as CSSProperties;
}
