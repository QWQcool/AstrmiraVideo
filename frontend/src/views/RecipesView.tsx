import { PlaceholderView } from './PlaceholderView';

/** 配方库（V9 · B8 填）：≥20 张提示词配方卡 + 「插入骨架」与「扩写带 recipeId」双入口 */
export function RecipesView() {
  return (
    <PlaceholderView
      title="提示词配方库"
      eyebrow="Recipe Library"
      until="此视图在 B8 上线：按分类（运镜/光线/氛围/节奏）浏览 ≥20 张配方卡，每张卡可「插入骨架到提示词」，也可作为 ✨ 扩写的风格上下文。配方是经验骨架，不承诺效果。"
    />
  );
}
