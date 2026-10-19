import { z } from 'zod';
import { AspectRatioSchema, DurationSecSchema, GenerationModeSchema, ProviderTypeSchema } from './request.js';
import {
  CanvasReferenceModeSchema,
  type CanvasReferenceMode,
  type CanvasReferenceRole,
} from './canvasDoc.js';

/**
 * 模型能力目录（CONTRACT §21-9 / Step 11-S1 / 台账 B76）。
 *
 * ## 为什么单独一份
 * `videoModels.ts` 解决"模型 id 别手打错"；这份解决**"这个模型能干什么"**——
 * 参考模式、参考数量、可用时长/比例/数量、以及**价格口径**。
 * 界面按它决定"参数能不能选、按钮能不能点、禁用时给什么理由"。
 *
 * ## 三条口径
 * 1. **没有声明就不开放**：能力位缺省视为不支持，不能靠"按钮看着像能点"推断。
 * 2. **本节只判结构，不判业务文案**：返回的是错误码（见 `CapabilityIssue`），
 *    中文理由由前端映射（共享包不持有界面文案）。
 * 3. **价格只用于估算**（D59）：`amountCny` 是"每单位约多少钱"的估算输入，
 *    **不是扣费依据**；`source: 'unknown'` 时界面必须显示"待核算"。
 */

export const CostUnitSchema = z.enum(['per-second', 'per-image', 'per-run', 'unknown']);

export const ModelCostSchema = z.object({
  /** `local` = 本机算力（金额 0，但要显示耗时）；`unknown` = 没报价 */
  source: z.enum(['provider', 'local', 'unknown']),
  unit: CostUnitSchema,
  /** 人民币估算单价；`source: 'unknown'` 时省略 */
  amountCny: z.number().nonnegative().optional(),
});

export const ModelCapabilitySchema = z.object({
  /** 与任务请求里的 `options.model` 对齐 */
  modelId: z.string().min(1),
  label: z.string().min(1),
  provider: ProviderTypeSchema,
  /** 至少一种；首发 t2v / i2v / fl2v / t2i */
  modes: z.array(GenerationModeSchema).min(1),
  referenceModes: z.array(CanvasReferenceModeSchema).min(1),
  maxReferences: z.number().int().min(0).max(64),
  referenceKinds: z.array(z.enum(['image', 'video', 'audio'])),
  aspectRatios: z.array(AspectRatioSchema),
  resolutions: z.array(
    z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      label: z.string().optional(),
    }),
  ),
  durations: z.array(DurationSecSchema),
  maxCount: z.number().int().min(1).max(8),
  cost: ModelCostSchema,
  /**
   * 有值 = 当前不可用（未配置 / 离线 / 缺 Key / 缺能力）。
   * 界面必须**禁用并原样显示这句话**，不允许降级成"点了再说"。
   */
  unavailableReason: z.string().optional(),
});

export type CostUnit = z.infer<typeof CostUnitSchema>;
export type ModelCost = z.infer<typeof ModelCostSchema>;
export type ModelCapability = z.infer<typeof ModelCapabilitySchema>;

/** 结构化问题码：前端映射成中文理由，不在这里写文案 */
export const CAPABILITY_ISSUES = [
  'model-unavailable',
  'mode-unsupported',
  'reference-mode-unsupported',
  'too-many-references',
  'reference-kind-unsupported',
  'aspect-unsupported',
  'resolution-unsupported',
  'duration-unsupported',
  'count-exceeded',
] as const;

export type CapabilityIssue = (typeof CAPABILITY_ISSUES)[number];

export interface CapabilityCheckInput {
  mode?: string;
  referenceMode?: string;
  references?: ReadonlyArray<{ role: CanvasReferenceRole }>;
  aspectRatio?: string;
  resolution?: { width: number; height: number };
  durationSec?: number;
  count?: number;
}

/** 参考用途 → 素材类型（用于"这个模型收不收视频参考"这类判断） */
const ROLE_KIND: Record<CanvasReferenceRole, 'image' | 'video' | 'audio'> = {
  'first-frame': 'image',
  'last-frame': 'image',
  'reference-image': 'image',
  'reference-video': 'video',
  'reference-audio': 'audio',
};

/**
 * 按能力目录判定一次请求是否成立。
 *
 * 只返回**第一个**问题：界面一次给一条可执行的建议，比一次列八条更好用；
 * 需要全量问题时可循环调用（刻意不做 `issues[]`，避免调用方"反正都列出来"）。
 */
export function checkCapability(
  capability: ModelCapability,
  input: CapabilityCheckInput,
): CapabilityIssue | null {
  if (capability.unavailableReason) return 'model-unavailable';

  if (input.mode && !capability.modes.includes(input.mode as ModelCapability['modes'][number])) {
    return 'mode-unsupported';
  }

  if (
    input.referenceMode &&
    !capability.referenceModes.includes(input.referenceMode as CanvasReferenceMode)
  ) {
    return 'reference-mode-unsupported';
  }

  const references = input.references ?? [];
  if (references.length > capability.maxReferences) return 'too-many-references';
  if (references.some((r) => !capability.referenceKinds.includes(ROLE_KIND[r.role]))) {
    return 'reference-kind-unsupported';
  }

  if (
    input.aspectRatio &&
    !capability.aspectRatios.includes(input.aspectRatio as ModelCapability['aspectRatios'][number])
  ) {
    return 'aspect-unsupported';
  }

  if (
    input.resolution &&
    !capability.resolutions.some(
      (r) => r.width === input.resolution?.width && r.height === input.resolution?.height,
    )
  ) {
    return 'resolution-unsupported';
  }

  if (
    input.durationSec !== undefined &&
    !capability.durations.includes(input.durationSec as ModelCapability['durations'][number])
  ) {
    return 'duration-unsupported';
  }

  if (input.count !== undefined && input.count > capability.maxCount) return 'count-exceeded';

  return null;
}

/** 估算金额（人民币）；`null` = 无法估算，界面要显示"待核算"而不是 0 */
export function estimateCostCny(capability: ModelCapability, units: number): number | null {
  const { cost } = capability;
  if (cost.source === 'local') return 0;
  if (cost.source === 'unknown' || cost.amountCny === undefined) return null;
  if (cost.unit === 'per-run') return cost.amountCny;
  if (units <= 0) return null;
  return Number((cost.amountCny * units).toFixed(2));
}
