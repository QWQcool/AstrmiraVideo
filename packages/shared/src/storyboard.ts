import { z } from 'zod';
import { CanvasAgentContextSchema } from './agentCanvas.js';
import { LlmConfigSchema } from './enhance.js';
import { AspectRatioSchema } from './request.js';
import { AgentPlanUsageSchema } from './agent.js';

/**
 * P5：分镜计划（StoryboardPlan）是**独立于画布节点方案**的规划对象。
 *
 * 它不包含节点 id / 工具调用 / 删除/连线操作；只描述镜头、时长、转场与待确认点。
 * 任何“把分镜落到画布”的动作都必须由前端显式转换，不能由本响应自动执行。
 */
export const StoryboardShotSchema = z
  .object({
    index: z.number().int().positive(),
    time: z.string().trim().min(1).max(40),
    shotSize: z.string().trim().min(1).max(40),
    camera: z.string().trim().min(1).max(120),
    visual: z.string().trim().min(1).max(1200),
    transition: z.string().trim().max(160).optional(),
    audio: z.string().trim().max(300).optional(),
  })
  .strict();
export type StoryboardShot = z.infer<typeof StoryboardShotSchema>;

export const StoryboardPlanSchema = z
  .object({
    version: z.literal(1),
    title: z.string().trim().min(1).max(120),
    aspectRatio: AspectRatioSchema,
    durationSec: z.number().int().positive().max(600),
    shots: z.array(StoryboardShotSchema).min(1).max(20),
    openQuestions: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
    warnings: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
  })
  .strict();
export type StoryboardPlan = z.infer<typeof StoryboardPlanSchema>;

export const StoryboardRequestSchema = z
  .object({
    instruction: z.string().trim().min(1).max(2000),
    canvas: CanvasAgentContextSchema.optional(),
    llm: LlmConfigSchema.optional(),
  })
  .strict();
export type StoryboardRequest = z.infer<typeof StoryboardRequestSchema>;

export const StoryboardResponseSchema = z
  .object({
    plan: StoryboardPlanSchema,
    engine: z.literal('llm'),
    model: z.string().trim().min(1),
    usage: AgentPlanUsageSchema.optional(),
  })
  .strict();
export type StoryboardResponse = z.infer<typeof StoryboardResponseSchema>;

/**
 * S8-A2（D75）：分镜展开为「每镜生成参数」的会话镜头上限。
 * 分镜表本身允许 20 镜；**进创作会话/批量落地**最多 16 镜，超出明确拒绝并提示拆分。
 */
export const STORYBOARD_SESSION_MAX_SHOTS = 16;

/** 每镜的生成参数（V2.62 / §28-2）。`index` 必须与分镜表的 shot.index 一一对应。 */
export const StoryboardShotPlanSchema = z
  .object({
    index: z.number().int().positive(),
    /** 画布节点标题（如「镜头 1 · 雨夜街头」） */
    title: z.string().trim().min(1).max(60),
    /** 有则先建 t2i 图片草稿节点出首帧；没有则用参考图或纯文生视频 */
    imagePrompt: z.string().trim().min(1).max(1200).optional(),
    videoPrompt: z.string().trim().min(1).max(2000),
    aspectRatio: AspectRatioSchema,
    /** 输出档位；落地时由前端按画幅映射为分辨率尺寸（节点 settings.resolution） */
    resolutionTier: z.enum(['480p', '720p', '1080p']),
    durationSec: z.number().int().min(1).max(10),
    /** 只允许引用请求里给出的参考素材 id（服务端再校验子集，防编造） */
    referenceAssetIds: z.array(z.string().min(1)).max(4).default([]),
    warnings: z.array(z.string().trim().min(1).max(300)).max(4).default([]),
  })
  .strict();
export type StoryboardShotPlan = z.infer<typeof StoryboardShotPlanSchema>;

export const StoryboardExpansionSchema = z
  .object({
    version: z.literal(1),
    /** 与分镜表同序、同数量、同 index（服务端校验一一对应） */
    shots: z.array(StoryboardShotPlanSchema).min(1).max(STORYBOARD_SESSION_MAX_SHOTS),
  })
  .strict();
export type StoryboardExpansion = z.infer<typeof StoryboardExpansionSchema>;

/** 参考素材条目：前端从项目资产里选出并允许模型引用的清单 */
export const StoryboardReferenceSchema = z
  .object({
    assetId: z.string().min(1),
    kind: z.enum(['image', 'video']),
    label: z.string().trim().min(1).max(80).optional(),
  })
  .strict();
export type StoryboardReference = z.infer<typeof StoryboardReferenceSchema>;

export const StoryboardExpandRequestSchema = z
  .object({
    /** 必须是已经展示给用户确认过的分镜表 */
    plan: StoryboardPlanSchema,
    references: z.array(StoryboardReferenceSchema).max(20).default([]),
    llm: LlmConfigSchema.optional(),
  })
  .strict();
export type StoryboardExpandRequest = z.infer<typeof StoryboardExpandRequestSchema>;

export const StoryboardExpandResponseSchema = z
  .object({
    plan: StoryboardExpansionSchema,
    engine: z.literal('llm'),
    model: z.string().trim().min(1),
    usage: AgentPlanUsageSchema.optional(),
  })
  .strict();
export type StoryboardExpandResponse = z.infer<typeof StoryboardExpandResponseSchema>;
