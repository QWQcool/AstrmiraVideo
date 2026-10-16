import type { RecipeCategory } from '@astrmira/shared';
import type { MessageKey } from './i18n';

/**
 * 配方分类的**键表**（语言迁移第十六批 · 跨包决策）。
 *
 * 这些名字原先来自共享包的 `RECIPE_CATEGORY_LABELS`，而那张表被**两种用途**共用：
 * ① 界面的分类 chips 与卡上标签；② **后端把它拼进中文提示词**
 * （现在叫 `RECIPE_CATEGORY_PROMPT_WORDS`）。
 *
 * 两种用途的**语言策略不同**，所以刻意分成两份：
 * - **这一份 = 给人看的界面用词**（跟界面语言走）；
 * - 共享包那份 = **给模型看的提示词用词**（不跟界面语言走；提示词语言是独立轴）。
 *
 * ⚠️ 两份的**中文必须逐字一致**（否则同一个分类在两处叫不同名字）——
 * 由 `lib/recipes.test.ts` 里一条**对拍断言**钉住；但允许将来各自演化
 * （英文界面下界面词变英文、提示词仍中文）。
 */
export const RECIPE_CATEGORY_KEYS: Record<RecipeCategory, MessageKey> = {
  camera: 'recipes.category.camera',
  lighting: 'recipes.category.lighting',
  mood: 'recipes.category.mood',
  rhythm: 'recipes.category.rhythm',
  angle: 'recipes.category.angle',
  focus: 'recipes.category.focus',
};
