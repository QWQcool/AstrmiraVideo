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
 *
 * V2.30（台账 A1 片 B / 决策 D53）：新增 **`host-comfyui`** —— 用户**自备的 ComfyUI**
 * （回环 / 内网地址，见 CONTRACT §19）。它与 `local-minimax-h3` 同属本地轨
 * （`executedBy: 'host-local'`），区别是**引擎由用户自己装、模型由用户自己放**。
 */
export const ProviderTypeSchema = z.enum([
  'cloud-volcano-seedance',
  'local-minimax-h3',
  'host-comfyui',
  'stock-local',
  'fixture-local',
]);

/** 成片时长上限 10s（公网部署防线，PLAN §7-3） */
export const DurationSecSchema = z.number().int().positive().max(10);

/**
 * V2.6（台账 B37）：`assets.referenceVideo` 引用一条已出片任务的前缀 ——
 * 值为 `task:<taskId>` 时表示"用该任务（含剪辑产物）的成片当 V2V 参考"。
 * 服务端解析为 `/media/*` 公网地址；前缀是契约的一部分（CONTRACT §1），前后端共用此常量。
 */
export const TASK_REF_PREFIX = 'task:';

/** 解析 `task:<taskId>` 引用；非该形态返回 null */
export function parseTaskRef(value: string): string | null {
  if (!value.startsWith(TASK_REF_PREFIX)) return null;
  const taskId = value.slice(TASK_REF_PREFIX.length);
  return taskId === '' ? null : taskId;
}

/** 参考资产：服务端分配的资产 ID（生命周期见 CONTRACT §7）；V2.6 起 referenceVideo 也可为 `task:<taskId>` */
export const GenerationAssetsSchema = z.object({
  firstFrameImage: z.string().optional(), // i2v 和 fl2v 必需
  lastFrameImage: z.string().optional(), // fl2v 专用尾帧
  referenceVideo: z.string().optional(), // v2v 风格/动作迁移参考（资产 ID 或 `task:<taskId>`，V2.6）
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
  /**
   * **我们的元数据，不透传给上游**（V2.11 / 台账 B47）：任务归属的项目。
   *
   * 为什么放在请求体而不是请求头：它与请求是**同一个决策的组成部分**（在哪个项目里出片），
   * 且要让幂等指纹把它算进去 —— 否则"同一个提示词在两个项目各提交一次"会被幂等去重成
   * 同一条任务（用户会在项目 B 里看不到自己刚提交的东西）。
   *
   * 缺省 = 默认项目（`DEFAULT_PROJECT_ID`），因此老客户端行为不变。
   */
  projectId: z.string().optional(),
});

export type GenerationMode = z.infer<typeof GenerationModeSchema>;
export type AspectRatio = z.infer<typeof AspectRatioSchema>;
export type ProviderType = z.infer<typeof ProviderTypeSchema>;
export type GenerationAssets = z.infer<typeof GenerationAssetsSchema>;
export type GenerationParams = z.infer<typeof GenerationParamsSchema>;
export type VideoGenerateRequest = z.infer<typeof VideoGenerateRequestSchema>;
