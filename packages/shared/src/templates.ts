import { AspectRatioSchema, GenerationModeSchema } from './request.js';
import { z } from 'zod';

/**
 * 行业模板（V2.23 / 台账 B71；设计参考 n8n 的模板库，独立实现）。
 *
 * ## 它解决什么
 * 客户第一次打开系统时，面对的是一个空输入框 —— "你能做什么"这个问题**不该由客户自己想**。
 * 行业模板 = **一个行业的起手式**：一句写好的提示词骨架 + 推荐画幅 / 时长 / 清晰度，
 * 点一下就落进输入框，客户再改。它是**销售材料**，也是**上手脚手架**。
 *
 * ## 三条口径
 * 1. **数据不是路由**：模板随前端 bundle 下发（与 [recipes](./recipes.ts) 同一条纪律），
 *    **不设 `/api/templates`** —— 要筛选用本地过滤；
 * 2. **不假装"一键出片"**：模板只填**起手式**，模式仍由素材与提示词推断（`recommendedMode` 只是**建议**，
 *    界面上要说清"推荐"而不是"已切换"）；
 * 3. **出处如实**：每个模板写清依据（哪次调研 / 哪条行业通例），**不留"看起来很专业"的无源之谈**。
 *
 * ⚠️ 与配方卡（`RecipeCard`）的分工：配方卡是**一个镜头技法**（运镜/光线/氛围/节奏），
 * 行业模板是**一支片子的起点**（含行业语境与整支片的结构建议）。两者在界面上是两排 chips。
 */

export const IndustryTemplateSchema = z.object({
  id: z.string(),
  /** 行业名（chips 上先看到它） */
  industry: z.string(),
  title: z.string(),
  /** 一句话说明（给客户看：这支片子大概长什么样） */
  summary: z.string(),
  /** 提示词骨架（**逐字**落到输入框；单测钉住，避免被顺手改坏） */
  skeleton: z.string(),
  aspectRatio: AspectRatioSchema,
  durationSec: z.number().positive(),
  resolutionTier: z.enum(['480p', '720p', '1080p']),
  /** 是否需要先拖一张产品/场景图（true = 起手式里含"用这张图"，缺图会被上游拒） */
  requiresImage: z.boolean(),
  /** **建议**模式（真实模式由素材与提示词推断，界面上按"推荐"措辞） */
  recommendedMode: GenerationModeSchema,
  /** 使用要点（中文与 logo 后置、避免真人首帧等纪律写在这里） */
  notes: z.array(z.string()),
  /** 依据（哪次调研 / 哪条行业通例）——**不留无源之谈** */
  source: z.string(),
});
export type IndustryTemplate = z.infer<typeof IndustryTemplateSchema>;

export const INDUSTRY_TEMPLATES: readonly IndustryTemplate[] = [
  {
    id: 'lighting-midcentury',
    industry: '灯具',
    title: '中古风灯具 · 色温与氛围',
    summary: '黄昏客厅里的中古风吊灯：缓慢推近 + 墙面光斑，演示三色变光的暖感。',
    skeleton:
      '中古风（Mid-century）吊灯特写：圆润灯罩、木质与金属材质，暖白光透过灯罩在墙面形成柔和光斑；'
      + '场景为黄昏客厅一角，浅色墙面与织物沙发；镜头缓慢推近并轻微环绕，画面稳定；'
      + '电影感胶片质感、浅景深、暖色调；不要出现真人，画面内不要出现任何文字或 logo。',
    aspectRatio: '9:16',
    durationSec: 5,
    resolutionTier: '1080p',
    requiresImage: false,
    recommendedMode: 't2v',
    notes: [
      '竖屏 9:16：抖音/小红书投放通例',
      '中文与 logo 一律**后置**（提示词里明写"不要文字"）',
      '不用真人首帧：产品演示镜头不需要人',
      '单段 ≤10s：15~30s 的成片要 2~4 段拼接',
    ],
    source: '内部示例：抖音竖屏广告通例 + 灯具行业调研（PLAN §9-B56 的官网事实采集）',
  },
  {
    id: 'food-closeup',
    industry: '餐饮',
    title: '出锅特写 · 热气与油光',
    summary: '把"好吃"拍成看得见的细节：热气、油光、手部入画（不露脸）。',
    skeleton:
      '食物特写镜头：刚出锅的菜品在陶碗中，热气缓缓上升，酱汁表面有油光反射；'
      + '一只手用竹筷夹起食材（**只出手部，不露脸**），背景是模糊的木质餐桌；'
      + '镜头固定微距、浅景深、暖色灯光，画面稳定；不要出现任何文字或 logo。',
    aspectRatio: '9:16',
    durationSec: 4,
    resolutionTier: '1080p',
    requiresImage: false,
    recommendedMode: 't2v',
    notes: [
      '"好吃"靠细节：热气 / 油光 / 拉丝，比全景更有效',
      '手部入画增加真实感，但**不露脸**（避免肖像与真实性问题）',
      '成片建议 3~4 段快切（不同菜各一段）',
    ],
    source: '内部示例：餐饮短视频通例（细节特写优先于全景）',
  },
  {
    id: 'apparel-lookbook',
    industry: '服装',
    title: '上新 lookbook · 面料与走位',
    summary: '不靠正脸模特：靠面料垂坠、走位与光影讲清版型。',
    skeleton:
      '服装展示镜头：模特穿着当季长款外套在空旷的室内空间缓步走过，'
      + '镜头跟随并**只取背影与侧身剪影**（不出现正脸），衣料随步伐自然摆动，垂坠感清晰；'
      + '背景为极简米色墙面与水泥地面，侧向自然光；画面稳定、浅景深、色调克制；'
      + '不要出现任何文字或 logo。',
    aspectRatio: '9:16',
    durationSec: 5,
    resolutionTier: '1080p',
    requiresImage: false,
    recommendedMode: 't2v',
    notes: [
      '**不出现正脸**：规避肖像问题，也让画面更像品牌片',
      '重点描述面料与垂坠（客户最在意的其实是版型）',
      '如需精确还原款式，先拖一张服装图走图生视频（I2V）',
    ],
    source: '内部示例：服装类短视频通例（版型/面料优先，人物次之）',
  },
  {
    id: 'home-interior',
    industry: '家居',
    title: '空间整体 · 光线流动',
    summary: '横屏空间镜头：光线缓慢移动，把一个房间讲成一个"家"。',
    skeleton:
      '家居空间镜头：现代简约客厅全景，浅木色地板、米白布艺沙发与绿植；'
      + '午后阳光从落地窗斜射进来，光斑在地板与墙面缓慢移动；'
      + '镜头极缓地横移（或固定），画面稳定；自然光、低饱和、真实质感；'
      + '不出现真人，画面内不要出现任何文字或 logo。',
    aspectRatio: '16:9',
    durationSec: 5,
    resolutionTier: '1080p',
    requiresImage: false,
    recommendedMode: 't2v',
    notes: [
      '横屏 16:9：官网/展厅/大屏用；投短视频要另做竖版',
      '光线的"移动"是这类镜头唯一的动感来源，提示词里要明写',
      '若要还原自家户型/家具，先拖一张实拍图走 I2V',
    ],
    source: '内部示例：家居行业空间镜头通例',
  },
];

export function findIndustryTemplate(id: string): IndustryTemplate | null {
  return INDUSTRY_TEMPLATES.find((template) => template.id === id) ?? null;
}
