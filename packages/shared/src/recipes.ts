import { z } from 'zod';
import { AspectRatioSchema, GenerationModeSchema } from './request.js';

/**
 * 提示词配方库（CONTRACT §11-1；V9 · B8）。
 *
 * 三个设计决定：
 * 1. **配方是数据，不是路由**：随前端 bundle 下发（前后端共用这一份），不设 `/api/recipes`；
 * 2. **双入口，同一份数据**：「插入骨架」把 `skeleton` 原样落到提示词框（用户看得见）；
 *    「✨ 扩写」把 `recipeId` 发给服务端，由服务端把 `skeleton + pitfalls` 注入 system prompt。
 *    只做前者则骨架对小白不够用，只做后者则配方变黑盒（违背"不静默"）—— 两个入口一并给；
 * 3. **诚实标记**：配方是"经验骨架"，UI 上**不得**承诺"用了就出大片"；`pitfalls` 为空就不写，
 *    不编造"已知坑"来凑数。
 *
 * 卡片结构的借鉴与出处：`docs/UPSTREAM.md` 已登记 video-shotcraft（Apache-2.0）——
 * 我们只借鉴"卡片有哪些字段（用途 / 时长 / 参数 / 已知坑）"这一**结构**，
 * **文本全部自写**（它是 Remotion 参数导向，我们是生成提示词导向，本就不通用）。
 */

export const RecipeCategorySchema = z.enum(['camera', 'lighting', 'mood', 'rhythm']);
export type RecipeCategory = z.infer<typeof RecipeCategorySchema>;

export const RECIPE_CATEGORY_LABELS: Record<RecipeCategory, string> = {
  camera: '运镜',
  lighting: '光线',
  mood: '氛围',
  rhythm: '节奏',
};

export const RecipeCardSchema = z.object({
  /** 稳定 id（`camera-push-in-slow` 之类）；**不复用旧 id**（改名即换 id，避免历史引用漂移） */
  id: z.string(),
  /** 展示名（中文） */
  title: z.string(),
  category: RecipeCategorySchema,
  /** 适用模式（如 ['t2v','i2v']） */
  modes: z.array(GenerationModeSchema),
  /** 建议时长文案（如 '5s 以内'）——只是建议，不强制改表单 */
  durationHint: z.string().optional(),
  /** 「插入骨架」落到提示词框的文本（**逐字**，单测钉住） */
  skeleton: z.string(),
  /** 参数建议（只是建议，不强制改表单） */
  paramsHint: z
    .object({
      aspectRatio: AspectRatioSchema.optional(),
      resolutionTier: z.enum(['480p', '720p', '1080p']).optional(),
    })
    .optional(),
  /** 已知坑（如实写；没有就不写） */
  pitfalls: z.array(z.string()).optional(),
});

export type RecipeCard = z.infer<typeof RecipeCardSchema>;

/** 首批配方卡（≥20；运镜 / 光线 / 氛围 / 节奏 各 5） */
export const RECIPE_CARDS: readonly RecipeCard[] = [
  // ── 运镜（camera）──────────────────────────────
  {
    id: 'camera-push-in-slow',
    title: '缓慢推近',
    category: 'camera',
    modes: ['t2v', 'i2v'],
    durationHint: '5s 以内',
    skeleton:
      '镜头缓慢推近主体，景别由中景过渡到近景，背景虚化逐渐加强，运动平稳不抖动。',
    paramsHint: { aspectRatio: '16:9', resolutionTier: '720p' },
    pitfalls: ['推近动作在 5s 内容易走不完，建议 ≤5s', '起幅就贴太近会让"推近"看不出来'],
  },
  {
    id: 'camera-pull-out-reveal',
    title: '缓慢拉远揭示',
    category: 'camera',
    modes: ['t2v', 'i2v'],
    durationHint: '5s',
    skeleton:
      '镜头从主体特写缓慢拉远，逐步揭示周围环境，最后停在中景，运动匀速。',
    pitfalls: ['拉远过快会像"镜头后退"而不是"揭示"'],
  },
  {
    id: 'camera-orbit-low',
    title: '低角度环绕',
    category: 'camera',
    modes: ['t2v'],
    durationHint: '5s',
    skeleton:
      '低角度缓慢环绕主体半圈，掠过主体的材质细节，画面焦点始终锁定主体中心。',
    pitfalls: ['环绕过快会产生拖影', '半圈已经接近 5s 的极限，不要写"环绕一圈"'],
  },
  {
    id: 'camera-pan-follow',
    title: '横向跟拍',
    category: 'camera',
    modes: ['t2v', 'v2v'],
    durationHint: '5s',
    skeleton:
      '镜头与主体保持相对静止、随主体横向平移，背景向反方向匀速掠过。',
    pitfalls: ['主体走出画面是常见失败：提示词里要写明"主体始终在画面中央偏左"'],
  },
  {
    id: 'camera-tilt-up-reveal',
    title: '上摇揭示',
    category: 'camera',
    modes: ['t2v', 'i2v'],
    durationHint: '5s',
    skeleton:
      '镜头从主体局部细节起幅，缓慢上摇至完整主体，运动平滑、起止有轻微缓动。',
    pitfalls: ['起幅的"局部"要挑有信息量的部位（纹理 / 光影）'],
  },

  // ── 光线（lighting）────────────────────────────
  {
    id: 'lighting-tyndall-beam',
    title: '丁达尔光束',
    category: 'lighting',
    modes: ['t2v', 'i2v'],
    durationHint: '5s',
    skeleton:
      '强烈逆光穿过空气中的微尘，形成清晰可见的丁达尔光束，主体边缘被勾出明亮轮廓。',
    pitfalls: ['过曝会丢失主体细节：提示词里加"保留暗部层次"'],
  },
  {
    id: 'lighting-warm-cool-contrast',
    title: '暖冷对比',
    category: 'lighting',
    modes: ['t2v'],
    durationHint: '5s',
    skeleton:
      '主体被 2700K 暖光包裹，环境为冷蓝余光，两者形成明确冷暖对比，浅景深。',
    pitfalls: ['冷暖界线不清楚时整体会发灰'],
  },
  {
    id: 'lighting-rim-light',
    title: '逆光轮廓',
    category: 'lighting',
    modes: ['t2v', 'i2v'],
    durationHint: '5s',
    skeleton:
      '光源位于主体后方，主体正面处于暗部，仅边缘被高光勾勒出清晰轮廓线。',
    pitfalls: ['正面全黑会看不清主体：提示词里补"正面保留微弱补光"'],
  },
  {
    id: 'lighting-soft-diffuse',
    title: '柔光漫射',
    category: 'lighting',
    modes: ['t2v'],
    durationHint: '任意',
    skeleton:
      '大面积柔光漫射，光比很低、阴影边缘模糊，画面整体明亮均匀无硬阴影。',
    pitfalls: ['柔光容易拍平：靠材质与色彩对比撑起层次'],
  },
  {
    id: 'lighting-neon-night',
    title: '霓虹夜色光',
    category: 'lighting',
    modes: ['t2v', 'i2v'],
    durationHint: '5s',
    skeleton:
      '主体被多色霓虹照亮，脸上与物体表面有青、品红双色光斑，背景大面积暗部。',
    pitfalls: ['多种颜色同框容易脏，建议限定 2 种主色'],
  },

  // ── 氛围（mood）────────────────────────────────
  {
    id: 'mood-rainy-night',
    title: '雨夜',
    category: 'mood',
    modes: ['t2v', 'i2v'],
    durationHint: '5s',
    skeleton:
      '雨夜街道，霓虹倒映在湿滑地面，空气中有细雨与蒸汽，暗部保留层次不发灰。',
    pitfalls: ['暗部太暗会糊成一团'],
  },
  {
    id: 'mood-morning-fog',
    title: '清晨薄雾',
    category: 'mood',
    modes: ['t2v'],
    durationHint: '5s',
    skeleton:
      '清晨薄雾中，远景化为浅灰色剪影，光线柔和偏冷，空气中可见缓慢流动的雾。',
    pitfalls: ['雾量过大会把主体也吃掉'],
  },
  {
    id: 'mood-cozy-interior',
    title: '温暖室内',
    category: 'mood',
    modes: ['t2v', 'i2v'],
    durationHint: '5s',
    skeleton:
      '温暖室内场景，木质桌面与织物纹理清晰，窗外是冷色环境，室内暖光形成包裹感。',
  },
  {
    id: 'mood-desolate-wide',
    title: '空旷寂寥',
    category: 'mood',
    modes: ['t2v'],
    durationHint: '5s',
    skeleton:
      '大远景，主体在画面中占比很小，环境占比极大，色调统一偏冷，画面安静无运动。',
  },
  {
    id: 'mood-festive-warm',
    title: '节日暖调',
    category: 'mood',
    modes: ['t2v'],
    durationHint: '5s',
    skeleton:
      '节日氛围，暖黄点光源密集分布并形成背景光斑，画面饱和度高、情绪热烈。',
    pitfalls: ['光斑过多会显得碎，注意保留一片暗部作为呼吸'],
  },

  // ── 节奏（rhythm）──────────────────────────────
  {
    id: 'rhythm-slow-burn',
    title: '慢起渐入',
    category: 'rhythm',
    modes: ['t2v', 'i2v'],
    durationHint: '5s',
    skeleton:
      '前 3 秒动作幅度极小、以氛围与光影变化为主，最后 2 秒动作逐渐展开。',
    pitfalls: ['全片都慢会显得没有信息量，结尾要给一个明确变化'],
  },
  {
    id: 'rhythm-beat-drop',
    title: '卡点转折',
    category: 'rhythm',
    modes: ['t2v'],
    durationHint: '5s',
    skeleton:
      '前 2 秒缓慢铺陈，第 3 秒出现明确动作转折，最后 1 秒保持新状态，节拍与动作对齐。',
    pitfalls: ['转折过早会显得仓促'],
  },
  {
    id: 'rhythm-final-freeze',
    title: '结尾定格',
    category: 'rhythm',
    modes: ['t2v', 'i2v'],
    durationHint: '5s',
    skeleton:
      '动作进行到 4 秒后逐渐减速，最后一秒保持静止定格，画面稳定无抖动。',
    pitfalls: ['定格前要"减速"过渡，直接停会显得像卡帧'],
  },
  {
    id: 'rhythm-quick-cuts',
    title: '快切碎片',
    category: 'rhythm',
    modes: ['t2v'],
    durationHint: '5s',
    skeleton:
      '画面由三个快速切换的短片段构成，每段约 1.5 秒，切换处有明确的方向或色彩跳变。',
    pitfalls: ['单条生成里"快切"依赖模型自己实现，效果不稳定，重要场合建议用剪辑台拼接'],
  },
  {
    id: 'rhythm-loop-seamless',
    title: '首尾呼应',
    category: 'rhythm',
    modes: ['t2v', 'i2v'],
    durationHint: '5s',
    skeleton:
      '画面从某一构图开始，中途发生一次完整变化，结尾回到与开头几乎一致的构图。',
    pitfalls: ['要循环播放时务必让首尾构图足够接近，否则接缝会跳'],
  },
];

/** 按 id 查配方卡（未知 id 返回 undefined —— 调用方必须显式处理，不静默回退） */
export function findRecipe(id: string | undefined): RecipeCard | undefined {
  if (id === undefined) return undefined;
  return RECIPE_CARDS.find((card) => card.id === id);
}
