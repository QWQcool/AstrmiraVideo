/**
 * **配方库域**的文案（语言迁移第十四批：`views/RecipesView.tsx`）。
 *
 * ## 卡片本身是"内容"，不是文案（本域只覆盖**页面骨架**）
 * `RECIPE_CARDS` 的 `title` / `skeleton` / `pitfalls` / `durationHint` 与
 * `RECIPE_CATEGORY_LABELS` 的**分类名**都来自 `@astrmira/shared` ——
 * 前四个是**内容**（写出来的素材，双语要逐条写英文，另立项），
 * 分类名则属"共享包里的域词汇"（与剪辑操作名、日志动作名同一类），
 * **该不该给共享包加一套键是跨包决策**，留给剪辑台批次一并定（见 `dict/library.ts` 文件头）。
 *
 * 所以本域只有页面自己的那几句：标题 / 说明 / 搜索 / 计数 / 空态 / 两个动作。
 */

export const RECIPES_ZH = {
  'recipes.title': '提示词配方库',
  'recipes.intro': '配方是经验骨架，不承诺效果；插入后可自由编辑。',
  'recipes.search.placeholder': '搜索配方…',
  'recipes.search.aria': '搜索配方',
  'recipes.categoryFilter.aria': '按分类筛选',
  /**
   * 分类名（**界面用词**）。
   *
   * ⚠️ 共享包里还有一份 `RECIPE_CATEGORY_PROMPT_WORDS` —— 那是**给模型看的提示词用词**
   * （后端拼提示词用），与这一份**中文必须逐字一致**，由 `lib/recipes.test.ts` 的对拍断言钉住。
   * 两份不能合并：提示词语言是独立轴（改它要重测模型效果），界面语言跟着本机偏好走。
   */
  'recipes.category.camera': '运镜',
  'recipes.category.lighting': '光线',
  'recipes.category.mood': '氛围',
  'recipes.category.rhythm': '节奏',
  'recipes.category.angle': '角度',
  'recipes.category.focus': '焦点',
  'recipes.categoryFilter.all': '全部',
  'recipes.count': '{shown} / {total} 张',
  'recipes.empty': '没有匹配的配方：换个关键词，或把分类切回「全部」。',
  'recipes.card.durationHint': '建议 {hint}',
  'recipes.card.contextTitle': '不改提示词，只在 ✨ 扩写时把这张配方作为风格上下文',
  'recipes.card.contextAction': '仅作扩写上下文',
  'recipes.card.insertAction': '插入骨架到提示词',
};

export const RECIPES_EN = {
  'recipes.title': 'Prompt recipe library',
  'recipes.intro': 'Recipes are experience skeletons, not a promise of results; edit freely after inserting.',
  'recipes.search.placeholder': 'Search recipes…',
  'recipes.search.aria': 'Search recipes',
  'recipes.categoryFilter.aria': 'Filter by category',
  'recipes.category.camera': 'Camera',
  'recipes.category.lighting': 'Lighting',
  'recipes.category.mood': 'Mood',
  'recipes.category.rhythm': 'Pacing',
  'recipes.category.angle': 'Angle',
  'recipes.category.focus': 'Focus',
  'recipes.categoryFilter.all': 'All',
  'recipes.count': '{shown} / {total} cards',
  'recipes.empty': 'No matching recipes: try another keyword, or switch the category back to 「All」.',
  'recipes.card.durationHint': 'Suggested {hint}',
  'recipes.card.contextTitle':
    'Leaves the prompt untouched; only uses this recipe as style context when ✨ expanding',
  'recipes.card.contextAction': 'Context for expansion only',
  'recipes.card.insertAction': 'Insert the skeleton into the prompt',
};
