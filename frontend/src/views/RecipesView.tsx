import { useMemo, useState } from 'react';
import { RECIPE_CARDS, RECIPE_CATEGORY_LABELS, type RecipeCategory } from '@astrmira/shared';
import { Eyebrow } from '../components/Eyebrow';
import { staggerStyle } from '../lib/motion';
import { navigate } from '../lib/router';

/**
 * 提示词配方库（V9 · B8）。
 *
 * 形态由 B1 闸门拍板：**第 5 个一级视图**（不做工作台内的小面板）——
 * 20+ 张卡需要横向空间，塞进 320px 的右栏既看不全也读不清。
 *
 * 每张卡两个动作，对应 CONTRACT §11-1 的两个入口：
 * 1. **「插入骨架到提示词」**（主）：跳到工作台并把 `skeleton` **逐字追加**到提示词框 ——
 *    用户看得见文本框里多了什么，随时可以改；
 * 2. **「仅作扩写上下文」**（次）：同样跳工作台，但**不动**提示词，只在 ✨ 扩写时把
 *    `recipeId` 发给服务端（由服务端把骨架与已知坑注入 system prompt）。
 *
 * 两个动作都走 hash 参数（`#/workbench?recipe=<id>`），因此跨视图零共享状态。
 */

type CategoryFilter = RecipeCategory | 'all';

function filterCards(category: CategoryFilter, query: string): readonly (typeof RECIPE_CARDS)[number][] {
  const needle = query.trim().toLowerCase();
  return RECIPE_CARDS.filter((card) => {
    if (category !== 'all' && card.category !== category) return false;
    if (needle === '') return true;
    return (
      card.title.toLowerCase().includes(needle) || card.skeleton.toLowerCase().includes(needle)
    );
  });
}

export function RecipesView() {
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [query, setQuery] = useState('');

  const cards = useMemo(() => filterCards(category, query), [category, query]);

  return (
    <section className="wb-page">
      <div className="wb-page-head wb-page-head-row">
        <div>
          <h1 className="wb-page-title">提示词配方库</h1>
          <Eyebrow tone="gold">Recipe Library</Eyebrow>
        </div>
        <span className="wb-note">配方是经验骨架，不承诺效果；插入后可自由编辑。</span>
      </div>

      <div className="lib-toolbar">
        <label className="wb-field lib-search">
          <input
            className="wb-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索配方…"
            aria-label="搜索配方"
          />
        </label>

        <div className="chips" role="group" aria-label="按分类筛选">
          <button
            type="button"
            className="lib-chip"
            aria-pressed={category === 'all'}
            onClick={() => setCategory('all')}
          >
            全部
          </button>
          {(Object.keys(RECIPE_CATEGORY_LABELS) as RecipeCategory[]).map((key) => (
            <button
              key={key}
              type="button"
              className="lib-chip"
              aria-pressed={category === key}
              onClick={() => setCategory(key)}
            >
              {RECIPE_CATEGORY_LABELS[key]}
            </button>
          ))}
        </div>

        <span className="wb-note" style={{ marginLeft: 'auto' }}>
          {cards.length} / {RECIPE_CARDS.length} 张
        </span>
      </div>

      {cards.length === 0 ? (
        <p className="wb-note">
          没有匹配的配方：换个关键词，或把分类切回「全部」。
        </p>
      ) : (
        <div className="recipe-grid">
          {cards.map((card, index) => (
            <article className="recipe-card" key={card.id} style={staggerStyle(index)}>
              <div className="recipe-card-top">
                <span className="recipe-card-title">{card.title}</span>
                <span className="recipe-tag recipe-tag--gold">
                  {RECIPE_CATEGORY_LABELS[card.category]}
                </span>
                <span className="recipe-tag">{card.modes.join(' · ')}</span>
              </div>

              <p className="recipe-card-skeleton">{card.skeleton}</p>

              {card.pitfalls === undefined ? null : (
                <ul className="recipe-card-pitfalls">
                  {card.pitfalls.map((pitfall) => (
                    <li key={pitfall}>{pitfall}</li>
                  ))}
                </ul>
              )}

              <div className="recipe-card-foot">
                {card.durationHint === undefined ? null : (
                  <span className="recipe-tag">建议 {card.durationHint}</span>
                )}
                <span className="recipe-card-actions">
                  <button
                    type="button"
                    className="wb-btn"
                    title="不改提示词，只在 ✨ 扩写时把这张配方作为风格上下文"
                    onClick={() => navigate(`#/workbench?recipe=${encodeURIComponent(card.id)}&insert=no`)}
                  >
                    仅作扩写上下文
                  </button>
                  <button
                    type="button"
                    className="wb-btn wb-btn-gold"
                    onClick={() => navigate(`#/workbench?recipe=${encodeURIComponent(card.id)}`)}
                  >
                    插入骨架到提示词
                  </button>
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
