import type { ReactNode } from 'react';
import { formatIndex } from '../lib/format';

/**
 * eyebrow 标签（AC6）：全大写 + 极小字 + 大字母间距 + **3 位索引号**。
 *
 * 字号与字距一律来自 `tokens.css`（`--fs-eyebrow` / `--track-caps`），
 * 组件层不允许出现字面量（F6 有静态检查）。
 * 分区标题、面板标题、卡片标题统一走本组件，不各自造样式。
 */
export interface EyebrowProps {
  children: ReactNode;
  /** 序号（从 1 开始）；渲染为 3 位索引号 */
  index?: number;
  tone?: 'default' | 'gold';
  as?: 'span' | 'h2' | 'h3';
}

export function Eyebrow({ children, index, tone = 'default', as = 'span' }: EyebrowProps) {
  const Tag = as;
  const className = tone === 'gold' ? 'wb-eyebrow wb-eyebrow-gold' : 'wb-eyebrow';

  return (
    <Tag className={className}>
      {index === undefined ? null : (
        <span className="wb-eyebrow-index">{formatIndex(index)}</span>
      )}
      <span>{children}</span>
    </Tag>
  );
}
