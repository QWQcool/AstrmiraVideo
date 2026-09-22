import { z } from 'zod';

/**
 * 契约投影来源：docs/CONTRACT.md §1 任务请求契约 `VideoGenerateRequest`
 * 本文件是类型与运行时校验的**唯一事实源**（PLAN §6-D18）；CONTRACT 中的 TS 代码块为文档投影。
 */

/** 生成模式：文生视频 | 首帧图生 | 首尾帧 | 视频参考 */
export const GenerationModeSchema = z.enum(['t2v', 'i2v', 'fl2v', 'v2v']);

/** 画面比例。1:1 仅云端可选，本地 H3 支持度【待验证】 */
export const AspectRatioSchema = z.enum(['16:9', '9:16', '1:1']);

/**
 * 执行引擎（CONTRACT §1 V1.5 修订）。
 * 'stock-local' / 'fixture-local' 为开发期校验专用 provider（PLAN §4「Step 2 补充」），
 * 默认关闭、不出现在产品线能力位；前端不得为它们硬编码任何分支。
 */
export const ProviderTypeSchema = z.enum([
  'cloud-volcano-seedance',
  'local-minimax-h3',
  'stock-local',
  'fixture-local',
]);

/** 成片时长上限 10s（公网部署防线，PLAN §7-3） */
export const DurationSecSchema = z.number().int().positive().max(10);

/** 参考资产：服务端分配的资产 ID（生命周期见 CONTRACT §7） */
export const GenerationAssetsSchema = z.object({
  firstFrameImage: z.string().optional(), // i2v 和 fl2v 必需
  lastFrameImage: z.string().optional(), // fl2v 专用尾帧
  referenceVideo: z.string().optional(), // v2v 风格/动作迁移参考
});

/** 推理参数 */
export const GenerationParamsSchema = z.object({
  durationSec: DurationSecSchema.optional(), // 默认 5s
  frames: z.number().int().positive().optional(), // 本地 H3 默认 124 帧
  steps: z.number().int().positive().optional(), // 采样步数（默认 50）
  seed: z.number().int().optional(), // -1 表示随机
  seedLocked: z.boolean().optional(),
});

export const VideoGenerateRequestSchema = z.object({
  prompt: z.string(),
  mode: GenerationModeSchema,
  assets: GenerationAssetsSchema.optional(),
  // 画面规格（自动对齐为 32 的整数倍）
  aspectRatio: AspectRatioSchema,
  resolution: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
  params: GenerationParamsSchema.optional(),
  provider: ProviderTypeSchema,
  // provider 私有参数：仅对声明支持该字段的 provider 生效；
  // 未识别的键必须被忽略而非报错（默认引擎不得因该字段而改变行为）。
  options: z.record(z.string(), z.unknown()).optional(),
});

export type GenerationMode = z.infer<typeof GenerationModeSchema>;
export type AspectRatio = z.infer<typeof AspectRatioSchema>;
export type ProviderType = z.infer<typeof ProviderTypeSchema>;
export type GenerationAssets = z.infer<typeof GenerationAssetsSchema>;
export type GenerationParams = z.infer<typeof GenerationParamsSchema>;
export type VideoGenerateRequest = z.infer<typeof VideoGenerateRequestSchema>;
