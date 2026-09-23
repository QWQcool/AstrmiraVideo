import { describe, expect, it } from 'vitest';
import {
  RECIPE_CARDS,
  RECIPE_CATEGORY_LABELS,
  RecipeCardSchema,
  findRecipe,
} from '@astrmira/shared';
import { appendSkeleton } from './recipeInsert';

/**
 * 配方库的数据完整性与插入行为（V9 · B8 / Step 6-AC5）。
 *
 * AC5 的两句话在这里逐条落地：
 * - "配方库 ≥20 张" → 数量与分类分布；
 * - "每张「插入骨架」的文本与数据**逐字一致**" → 插入函数 + `findRecipe` 返回同一份数据。
 */

describe('配方库数据完整性（AC5）', () => {
  it('首批 ≥20 张，且四个分类各 ≥5', () => {
    expect(RECIPE_CARDS.length).toBeGreaterThanOrEqual(20);

    for (const category of Object.keys(RECIPE_CATEGORY_LABELS) as Array<
      keyof typeof RECIPE_CATEGORY_LABELS
    >) {
      const count = RECIPE_CARDS.filter((card) => card.category === category).length;
      expect(count, `${category} 至少 5 张`).toBeGreaterThanOrEqual(5);
    }
  });

  it('id 唯一且格式稳定（小写 + 连字符）', () => {
    const ids = RECIPE_CARDS.map((card) => card.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)+$/);
  });

  it('每张都通过 schema 校验，骨架非空、至少一个适用模式', () => {
    for (const card of RECIPE_CARDS) {
      expect(() => RecipeCardSchema.parse(card)).not.toThrow();
      expect(card.skeleton.trim().length, `${card.id} 的骨架不能为空`).toBeGreaterThan(0);
      expect(card.modes.length, `${card.id} 至少要有一个适用模式`).toBeGreaterThan(0);
      // `pitfalls` 要么不写，要么每条都有内容 —— 不允许空串占位
      for (const pitfall of card.pitfalls ?? []) {
        expect(pitfall.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('findRecipe：命中返回同一份数据（逐字），未知 id / undefined 返回 undefined', () => {
    const first = RECIPE_CARDS[0];
    expect(first).toBeDefined();
    expect(findRecipe(first?.id)?.skeleton).toBe(first?.skeleton);
    expect(findRecipe('no-such-recipe')).toBeUndefined();
    expect(findRecipe(undefined)).toBeUndefined();
  });
});

describe('插入骨架的行为（appendSkeleton）', () => {
  const skeleton = RECIPE_CARDS[0]?.skeleton ?? '';

  it('空框（含纯空白）→ 直接写入骨架，不留空行', () => {
    expect(appendSkeleton('', skeleton)).toBe(skeleton);
    expect(appendSkeleton('   \n  ', skeleton)).toBe(skeleton);
  });

  it('非空 → 追加到末尾，**不覆盖**用户已写的内容', () => {
    const result = appendSkeleton('一只猫在窗台上', skeleton);
    expect(result.startsWith('一只猫在窗台上')).toBe(true);
    expect(result.endsWith(skeleton)).toBe(true);
    // 插入的骨架部分与数据逐字一致（去掉我们自己的分隔换行）
    expect(result.slice(result.indexOf(skeleton))).toBe(skeleton);
  });

  it('反复插入同一张卡 = 逐字重复（幂等到"文本层面"，不做去重魔法）', () => {
    const once = appendSkeleton('', skeleton);
    const twice = appendSkeleton(once, skeleton);
    expect(twice).toBe(`${skeleton}\n\n${skeleton}`);
  });
});
