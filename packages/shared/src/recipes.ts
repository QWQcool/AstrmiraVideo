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

export const RecipeCategorySchema = z.enum([
  'camera',
  'lighting',
  'mood',
  'rhythm',
  'angle',
  'focus',
]);
export type RecipeCategory = z.infer<typeof RecipeCategorySchema>;

/**
 * 分类名 —— **这是"提示词用词"，不是界面文案**（语言迁移第十六批 · 跨包决策的核心样本）。
 *
 * 原先它叫 `RECIPE_CATEGORY_LABELS`，同时被两处用：① 界面的分类 chips 与卡上标签；
 * ② **后端把它拼进中文提示词**（`backend/src/providers/llm.ts`：`用户选用了配方「…」（运镜）…`）。
 * 改名是为了让**名字说出用途** —— "labels" 听着像界面文案，于是有人会顺手把它翻译了，
 * 而提示词语言是**另一条轴**（后端提示词整段都是中文；改它要重测模型效果，不是 i18n 的事）。
 *
 * 所以现在**刻意有两份**：
 * - 这一份 = **给模型看的用词**（后端拼提示词用）；
 * - 前端字典的 `recipes.category.*` = **给人看的界面用词**。
 *
 * 两份在**中文下必须逐字一致**（否则同一个分类在两处叫不同名字），由前端
 * `lib/recipes.test.ts` 里一条**对拍断言**钉住；但允许将来各自演化
 * （比如英文界面下界面词变英文、提示词仍中文）。
 */
export const RECIPE_CATEGORY_PROMPT_WORDS: Record<RecipeCategory, string> = {
  camera: '运镜',
  lighting: '光线',
  mood: '氛围',
  rhythm: '节奏',
  angle: '角度',
  focus: '焦点',
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

  // ── 运镜（camera）扩充（词库结构参考 seedance-prompt-skill，MIT）──────────
  {
    id: 'camera-handheld-follow',
    title: '手持跟拍',
    category: 'camera',
    modes: ['t2v', 'i2v'],
    durationHint: '5s',
    skeleton:
      '手持镜头跟随主体移动，画面带轻微自然的呼吸感晃动，主体始终在画面中景，背景随之流动。',
    pitfalls: ['晃动幅度要写"轻微"，否则会变成抖动废片'],
  },
  {
    id: 'camera-aerial-rise',
    title: '航拍拉升',
    category: 'camera',
    modes: ['t2v'],
    durationHint: '5s',
    skeleton:
      '航拍视角从贴近主体的高度垂直拉升，主体逐渐变小，环境全貌在升高中展开，运动平稳上升。',
    pitfalls: ['5s 只够拉升一小段，别写"升到万米高空"'],
  },
  {
    id: 'camera-dolly-zoom',
    title: '希区柯克变焦',
    category: 'camera',
    modes: ['t2v'],
    durationHint: '3~5s',
    skeleton:
      '主体保持画面大小不变，背景向远处压缩拉伸，空间产生眩晕般的透视变化（推拉变焦）。',
    pitfalls: ['这个效果对模型较难，提示词里要同时写"主体大小不变"和"背景透视变化"'],
  },
  {
    id: 'camera-truck-reveal',
    title: '横移展示',
    category: 'camera',
    modes: ['t2v', 'i2v'],
    durationHint: '5s',
    skeleton:
      '镜头沿水平方向匀速平移，逐一展示并排的多个主体或场景细节，像展柜一样掠过。',
    pitfalls: ['主体间距要均匀，否则平移节奏会忽快忽慢'],
  },
  {
    id: 'camera-whip-pan',
    title: '甩镜转场',
    category: 'camera',
    modes: ['t2v'],
    durationHint: '3s 以内',
    skeleton:
      '镜头快速向一个方向甩动，画面产生动态模糊，甩动结束后稳定在 new 场景上。',
    pitfalls: ['单条生成里"甩镜"效果不稳定，重要场合建议用剪辑台做转场'],
  },

  // ── 光线（lighting）扩充 ────────────────────────────
  {
    id: 'lighting-golden-hour',
    title: '黄金时段',
    category: 'lighting',
    modes: ['t2v', 'i2v'],
    durationHint: '5s',
    skeleton:
      '日落前的低角度阳光，暖金色斜射在主体上，拉出长长的影子，空气中有一层暖雾。',
    pitfalls: ['色温别写太暖（过橙会假），补一句"保留自然肤色"'],
  },
  {
    id: 'lighting-moonlight',
    title: '月光冷调',
    category: 'lighting',
    modes: ['t2v', 'i2v'],
    durationHint: '5s',
    skeleton:
      '夜晚月光从一侧照亮主体，冷蓝白色调，暗部深邃但保留层次，远处有点点暖光对比。',
    pitfalls: ['纯冷调容易显得阴森，留一点暖光平衡情绪'],
  },
  {
    id: 'lighting-volumetric',
    title: '体积光',
    category: 'lighting',
    modes: ['t2v', 'i2v'],
    durationHint: '5s',
    skeleton:
      '光线穿过窗户或缝隙形成可见的光柱，空气中有微尘在光柱里缓慢浮动，主体位于光柱边缘。',
    pitfalls: ['需要空气介质（尘/雾）才能看见光柱，提示词里要点明'],
  },
  {
    id: 'lighting-side-rim',
    title: '侧逆光勾边',
    category: 'lighting',
    modes: ['t2v', 'i2v'],
    durationHint: '5s',
    skeleton:
      '光源在主体侧后方，主体的发丝与轮廓被一圈亮边勾勒，正面处于柔和的暗部，立体感强。',
    pitfalls: ['正面要补一点反光，否则主体会变成剪影'],
  },
  {
    id: 'lighting-product-softbox',
    title: '产品柔光',
    category: 'lighting',
    modes: ['t2v', 'i2v'],
    durationHint: '任意',
    skeleton:
      '产品摄影式的大面积柔光，主体受光均匀无硬阴影，背景纯净，材质细节与反光清晰。',
    pitfalls: ['柔光容易拍平，靠产品自身反光与背景渐变撑层次'],
  },

  // ── 氛围（mood）扩充 ──────────────────────────────
  {
    id: 'mood-cyberpunk-neon',
    title: '赛博朋克',
    category: 'mood',
    modes: ['t2v'],
    durationHint: '5s',
    skeleton:
      '赛博朋克城市夜景，高饱和的青与品红霓虹交错，湿漉漉的地面反射灯光，空气中有薄雾与蒸汽。',
    pitfalls: ['颜色别超过两种主色，多了会脏'],
  },
  {
    id: 'mood-ink-wash',
    title: '中国水墨',
    category: 'mood',
    modes: ['t2v', 'i2v'],
    durationHint: '5s',
    skeleton:
      '中国水墨画风格，黑白灰为主，大面积留白，主体以写意笔触呈现，边缘有墨色晕染。',
    pitfalls: ['水墨风格对模型较难，提示词里要写"水墨画风格"而不是"黑白照片"'],
  },
  {
    id: 'mood-film-vintage',
    title: '复古胶片',
    category: 'mood',
    modes: ['t2v', 'i2v'],
    durationHint: '5s',
    skeleton:
      '复古胶片质感，画面有细微颗粒，色彩偏暖偏褪色，对比度柔和，像 90 年代的家庭录像。',
    pitfalls: ['颗粒别太重，否则会显得画质差而不是"胶片感"'],
  },
  {
    id: 'mood-morandi',
    title: '莫兰迪灰调',
    category: 'mood',
    modes: ['t2v'],
    durationHint: '任意',
    skeleton:
      '莫兰迪色系，低饱和度的灰调色彩，画面安静柔和，色彩之间过渡细腻，整体氛围克制内敛。',
    pitfalls: ['低饱和不等于灰扑扑，要保留色彩的微妙差异'],
  },
  {
    id: 'mood-vaporwave',
    title: '蒸汽波',
    category: 'mood',
    modes: ['t2v'],
    durationHint: '5s',
    skeleton:
      '蒸汽波美学，粉紫与青蓝的渐变天空，复古网格地面，80 年代的未来主义怀旧感。',
    pitfalls: ['风格强烈，主体别太复杂，否则画面会很乱'],
  },

  // ── 节奏（rhythm）扩充 ─────────────────────────────
  {
    id: 'rhythm-slow-motion',
    title: '慢动作',
    category: 'rhythm',
    modes: ['t2v', 'i2v'],
    durationHint: '5s',
    skeleton:
      '慢动作（升格拍摄），主体的动作被放慢数倍，细节（发丝 / 水滴 / 布料）在空中缓缓展开。',
    pitfalls: ['慢动作需要有"快速动作"做对比才有张力'],
  },
  {
    id: 'rhythm-timelapse',
    title: '延时摄影',
    category: 'rhythm',
    modes: ['t2v'],
    durationHint: '5s',
    skeleton:
      '延时摄影，时间被压缩加速，云影快速流动、光影在墙面移动、人来车往拉成虚影。',
    pitfalls: ['延时摄影里主体要固定（建筑/桌面），否则画面会糊'],
  },
  {
    id: 'rhythm-one-take',
    title: '一镜到底',
    category: 'rhythm',
    modes: ['t2v', 'i2v'],
    durationHint: '5s',
    skeleton:
      '一镜到底，镜头连续不切换，跟随主体穿过多个场景，画面始终保持连贯的运动。',
    pitfalls: ['一镜到底对模型较难，场景转换要明确写"镜头跟随进入"'],
  },
  {
    id: 'rhythm-hard-cut',
    title: '硬切',
    category: 'rhythm',
    modes: ['t2v'],
    durationHint: '5s',
    skeleton:
      '两个场景之间直接硬切，没有过渡，画面在瞬间从 A 跳到 B，形成明确的节奏断点。',
    pitfalls: ['硬切前后要有视觉关联（同主体/同色调），否则会显得是事故'],
  },
  {
    id: 'rhythm-action-beat',
    title: '动作节拍',
    category: 'rhythm',
    modes: ['t2v', 'v2v'],
    durationHint: '5s',
    skeleton:
      '动作与节拍对齐，每一个动作转折都卡在节奏点上，画面有明确的律动感和张力。',
    pitfalls: ['节拍点要靠动作设计，不是靠后期剪辑'],
  },

  // ── 角度（angle）新增类别 ───────────────────────────
  {
    id: 'angle-top-down',
    title: '垂直俯拍',
    category: 'angle',
    modes: ['t2v', 'i2v'],
    durationHint: '5s',
    skeleton:
      '正上方垂直俯拍，主体平铺在画面中，构图呈平面化的几何感，像地图或摆拍。',
    pitfalls: ['俯拍会弱化立体感，靠光影与色彩撑层次'],
  },
  {
    id: 'angle-low-up',
    title: '低角度仰拍',
    category: 'angle',
    modes: ['t2v', 'i2v'],
    durationHint: '5s',
    skeleton:
      '低角度仰拍，镜头贴近地面向上，主体显得高大有力量感，背景多为天空或天花板。',
    pitfalls: ['仰拍容易让主体变形（头大脚小），提示词里写"保持自然比例"'],
  },
  {
    id: 'angle-birds-eye',
    title: '鸟瞰视角',
    category: 'angle',
    modes: ['t2v'],
    durationHint: '5s',
    skeleton:
      '高空鸟瞰视角，地面景观尽收眼底，建筑与道路呈几何图案，主体在广阔环境中显得渺小。',
    pitfalls: ['鸟瞰里主体太小会看不清，要点明"主体位于画面中心"'],
  },
  {
    id: 'angle-fisheye',
    title: '鱼眼畸变',
    category: 'angle',
    modes: ['t2v'],
    durationHint: '3~5s',
    skeleton:
      '鱼眼镜头视角，画面边缘呈弧形畸变，中心主体夸张放大，有强烈的视觉冲击力。',
    pitfalls: ['鱼眼畸变对模型较难，写实场景慎用'],
  },
  {
    id: 'angle-pov-first',
    title: '第一人称',
    category: 'angle',
    modes: ['t2v', 'i2v'],
    durationHint: '5s',
    skeleton:
      '第一人称主观视角，镜头就是"我"的眼睛，能看到自己的手部动作，画面随手部自然晃动。',
    pitfalls: ['第一人称要看到"自己的手"才有代入感，提示词里点明'],
  },

  // ── 焦点（focus）新增类别 ───────────────────────────
  {
    id: 'focus-shallow-dof',
    title: '浅景深',
    category: 'focus',
    modes: ['t2v', 'i2v'],
    durationHint: '任意',
    skeleton:
      '浅景深，主体清晰锐利，背景大幅虚化成柔和的色块，画面有明显的虚实层次。',
    pitfalls: ['浅景深里主体要够大，否则虚化会吃掉主体'],
  },
  {
    id: 'focus-deep-dof',
    title: '深景深',
    category: 'focus',
    modes: ['t2v'],
    durationHint: '任意',
    skeleton:
      '深景深，前景到背景全部清晰，画面信息量大，每个层次的细节都可辨认。',
    pitfalls: ['深景深容易显得"平"，靠构图与光影引导视线'],
  },
  {
    id: 'focus-rack',
    title: '焦点转移',
    category: 'focus',
    modes: ['t2v', 'i2v'],
    durationHint: '5s',
    skeleton:
      '焦点从前景主体平滑转移到背景主体，前景逐渐虚化、背景逐渐清晰，视线被引导到新的焦点上。',
    pitfalls: ['两个主体要有明确的前后关系，否则焦点转移看不出方向'],
  },
  {
    id: 'focus-bokeh',
    title: '光斑虚化',
    category: 'focus',
    modes: ['t2v', 'i2v'],
    durationHint: '5s',
    skeleton:
      '背景的点光源虚化成圆形光斑，主体清晰，光斑在背景里闪烁浮动，画面梦幻。',
    pitfalls: ['光斑需要背景里有点光源（灯/烛光），否则虚化不出光斑'],
  },
  {
    id: 'focus-selective',
    title: '选择性对焦',
    category: 'focus',
    modes: ['t2v', 'i2v'],
    durationHint: '任意',
    skeleton:
      '只有画面中的某一局部清晰，其余部分全部虚化，观众的视线被强制聚焦到清晰的那一点。',
    pitfalls: ['清晰区域要小且明确（如"只有眼睛清晰"），否则会显得是失焦'],
  },
];

/** 按 id 查配方卡（未知 id 返回 undefined —— 调用方必须显式处理，不静默回退） */
export function findRecipe(id: string | undefined): RecipeCard | undefined {
  if (id === undefined) return undefined;
  return RECIPE_CARDS.find((card) => card.id === id);
}
