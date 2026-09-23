import { Eyebrow } from '../components/Eyebrow';

/**
 * 占位视图（V9 · B2）：某个一级视图的内容在后续切片里才填（B3 总览 / B4 视频库 / B8 配方库 / B9 剪辑台）。
 *
 * 为什么要有它而不是留白或"敬请期待"：占位也要**诚实**——写清楚"这个视图在哪一片上线、
 * 到时候会看到什么"，让用户（与 B2 的破坏性验证）知道这是**刻意留位**，不是忘了做。
 */
export interface PlaceholderViewProps {
  title: string;
  eyebrow: string;
  /** 什么时候填、填什么 */
  until: string;
}

export function PlaceholderView({ title, eyebrow, until }: PlaceholderViewProps) {
  return (
    <section className="wb-page">
      <div className="wb-page-head">
        <h1 className="wb-page-title">{title}</h1>
        <Eyebrow tone="gold">{eyebrow}</Eyebrow>
      </div>
      <div className="wb-placeholder">
        <Eyebrow>Coming in a later slice</Eyebrow>
        <p className="wb-note">{until}</p>
      </div>
    </section>
  );
}
