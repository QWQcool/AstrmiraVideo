import { z } from 'zod';
import { AspectRatioSchema, DurationSecSchema } from './request.js';
import { normalizeProjectId } from './projects.js';

/**
 * S8-B（CONTRACT §29 / D72）：创作会话（CreationRun）。
 *
 * 一个会话 = 一次"剧本 → 成片"的**服务端确定性执行**：LLM 不参与执行，
 * 步骤图在创建时冻结；执行只做四件事——拓扑提交、等待引用的上游、
 * 失败即停（绝不自动重提）、断点续跑（确定性幂等键）。
 *
 * v1 边界（D74）：只允许本地轨引擎（`host-comfyui:*` / `fixture-local`）；
 * 云轨凭据出不了浏览器，不进会话。
 */

export const CREATION_RUN_VERSION = 1;

/** D75：视频步骤上限（无人值守/确认档同限）。 */
export const CREATION_RUN_MAX_VIDEO_STEPS = 16;
/** 结构上限：图片步骤（首帧）最多与视频步骤同数。 */
export const CREATION_RUN_MAX_STEPS = 32;

export const CreationRunModeSchema = z.enum(['unattended', 'first-frame-confirm']);
export type CreationRunMode = z.infer<typeof CreationRunModeSchema>;

export const CreationRunStateSchema = z.enum([
  'planned', // 已创建未开始
  'running', // 执行中（或等待可提交步骤）
  'awaiting-confirmation', // 首帧确认档：全部图片步骤终态后暂停，等用户点「继续」
  'assembling', // S8-C：全视频步骤成功后的自动拼接（收尾态前的一瞬）
  'succeeded', // 全部成功（含拼接产物）
  'failed', // 失败即停：failure 记录第一个失败步骤
  'cancelled', // 用户取消；已在途的任务让其跑完但结果不被消费
]);
export type CreationRunState = z.infer<typeof CreationRunStateSchema>;

export const CreationRunStepKindSchema = z.enum(['image', 'video']);
export const CreationRunStepStatusSchema = z.enum([
  'pending',
  'submitting',
  'running',
  'succeeded',
  'failed',
]);

export const CreationRunStepSchema = z
  .object({
    /** run 内唯一且稳定（幂等键的一部分）；建议 `img-<index>` / `shot-<index>` */
    id: z.string().trim().min(1).max(64),
    kind: CreationRunStepKindSchema,
    prompt: z.string().trim().min(1).max(2000),
    aspectRatio: AspectRatioSchema,
    /** 提交时按画幅映射为请求的 resolution（请求无 tier 字段） */
    resolutionTier: z.enum(['480p', '720p', '1080p']).optional(),
    /** 仅 video 步骤有意义；缺省引擎默认 */
    durationSec: DurationSecSchema.optional(),
    /** 用户已有资产 id（≤4）；第一张接 first-frame、第二张 last-frame（与画布落地同规则） */
    referenceAssetIds: z.array(z.string().min(1)).max(4).default([]),
    /** 上游 step id（≤4）。执行语义：其**产物**作本步骤的 first-frame（按依赖序首个），其余进 last-frame */
    dependsOn: z.array(z.string().min(1)).max(4).default([]),
    status: CreationRunStepStatusSchema.default('pending'),
    taskId: z.string().min(1).optional(),
    /** 成功产物（`task:<taskId>` 形态，可被下游引用） */
    outputAssetId: z.string().min(1).optional(),
    error: z.string().max(600).optional(),
    /** 第几次执行意图：0 起。显式重试 +1 → 换幂等键（真新任务）；服务端绝不自动加 */
    attempt: z.number().int().min(0).default(0),
  })
  .strict();
export type CreationRunStep = z.infer<typeof CreationRunStepSchema>;

/** 创建输入：只给意图；status/taskId/output/error/attempt 全由服务端管理 */
export const CreationRunInputStepSchema = CreationRunStepSchema.omit({
  status: true,
  taskId: true,
  outputAssetId: true,
  error: true,
  attempt: true,
});
export type CreationRunInputStep = z.infer<typeof CreationRunInputStepSchema>;

export const CreationRunInputSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    projectId: z.string().trim().min(1).optional(), // 缺省默认项目（与 /api/generate 同口径）
    mode: CreationRunModeSchema,
    /** v1 只允许本地轨引擎（D74）；create 时校验并拒绝云轨 */
    provider: z.string().trim().min(1).max(120),
    steps: z.array(CreationRunInputStepSchema).min(1).max(CREATION_RUN_MAX_STEPS),
  })
  .strict();
export type CreationRunInput = z.infer<typeof CreationRunInputSchema>;

export const CreationRunSchema = z
  .object({
    version: z.literal(CREATION_RUN_VERSION),
    id: z.string().min(1),
    title: z.string().trim().min(1).max(120),
    projectId: z.string().min(1),
    mode: CreationRunModeSchema,
    provider: z.string().min(1),
    steps: z.array(CreationRunStepSchema).min(1).max(CREATION_RUN_MAX_STEPS),
    state: CreationRunStateSchema,
    createdAt: z.number(),
    updatedAt: z.number(),
    /** 首帧确认档的用户确认时刻（V2.64；NULL = 未确认 / unattended 不适用）。执行器据此放行视频步骤。 */
    confirmedAt: z.number().optional(),
    startedAt: z.number().optional(),
    finishedAt: z.number().optional(),
    /** 失败即停时第一个失败步骤 */
    failure: z
      .object({ stepId: z.string().min(1), message: z.string().max(600) })
      .optional(),
    /** S8-C：自动拼接产物（一条普通 edit 任务） */
    assembledTaskId: z.string().min(1).optional(),
  })
  .strict();
export type CreationRun = z.infer<typeof CreationRunSchema>;

/** 会话的确定性幂等键：同一执行意图重复提交命中既有任务；显式重试换 attempt 段 */
export function creationRunStepKey(runId: string, stepId: string, attempt: number): string {
  return `run:${runId}:${stepId}:a${attempt}`;
}

/** 视频步骤数（D75 校验用；服务端 create 时拒绝 >16） */
export function creationRunVideoStepCount(steps: readonly CreationRunInputStep[]): number {
  return steps.filter((step) => step.kind === 'video').length;
}

/** create 时的结构校验（schema 管不了的跨字段事实）；返回人话错误或 null */
export function validateCreationRunInput(input: CreationRunInput): string | null {
  const videoCount = creationRunVideoStepCount(input.steps);
  if (videoCount === 0) return '会话至少需要一个视频步骤（没有成片目标）';
  if (videoCount > CREATION_RUN_MAX_VIDEO_STEPS) {
    return `视频步骤 ${videoCount} 个，超过会话上限 ${CREATION_RUN_MAX_VIDEO_STEPS}（D75）：请拆分为多个会话`;
  }
  const ids = new Set<string>();
  for (const step of input.steps) {
    if (ids.has(step.id)) return `步骤 id 重复：${step.id}`;
    ids.add(step.id);
    if (step.kind === 'image' && step.durationSec !== undefined) {
      return `图片步骤 ${step.id} 不应带 durationSec`;
    }
  }
  for (const step of input.steps) {
    // 裸输入可能没过 zod default（dependsOn/referenceAssetIds 缺省）：这里按空数组处理
    const dependsOn = step.dependsOn ?? [];
    for (const dep of dependsOn) {
      if (!ids.has(dep)) return `步骤 ${step.id} 依赖了不存在的步骤：${dep}`;
      if (dep === step.id) return `步骤 ${step.id} 不能依赖自己`;
      const upstream = input.steps.find((item) => item.id === dep);
      if (upstream === undefined) return `步骤 ${step.id} 的依赖 ${dep} 不存在`;
      if (upstream.kind !== 'image') {
        return `步骤 ${step.id} 只能依赖图片步骤（首帧语义）：${dep} 是 ${upstream.kind}`;
      }
    }
  }
  // 环检测（依赖边）
  const adjacency = new Map<string, string[]>();
  for (const step of input.steps) adjacency.set(step.id, [...(step.dependsOn ?? [])]);
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string, path: string[]): string | null => {
    if (done.has(id)) return null;
    if (visiting.has(id)) return `依赖成环：${[...path, id].join(' → ')}`;
    visiting.add(id);
    for (const dep of adjacency.get(id) ?? []) {
      const problem = visit(dep, [...path, id]);
      if (problem !== null) return problem;
    }
    visiting.delete(id);
    done.add(id);
    return null;
  };
  for (const step of input.steps) {
    const problem = visit(step.id, []);
    if (problem !== null) return problem;
  }
  return null;
}

/** 列表条目（轻量；不携带 steps 全文） */
export const CreationRunSummarySchema = z
  .object({
    id: z.string().min(1),
    title: z.string().trim().min(1),
    projectId: z.string().min(1),
    mode: CreationRunModeSchema,
    provider: z.string().min(1),
    state: CreationRunStateSchema,
    videoStepCount: z.number().int().min(0),
    succeededCount: z.number().int().min(0),
    failedCount: z.number().int().min(0),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();
export type CreationRunSummary = z.infer<typeof CreationRunSummarySchema>;

/** 归一化 projectId（与 /api/generate 同口径：空/缺省 → 默认项目 id） */
export function normalizeCreationRunProject(projectId: string | undefined): string {
  return normalizeProjectId(projectId);
}
