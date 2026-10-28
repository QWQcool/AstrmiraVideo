import { z } from 'zod';
import { ResolutionTierSchema } from './resolution.js';
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
    /**
     * 提交时按画幅映射为请求的 resolution（请求无 tier 字段）。
     * 表在 esolution.ts（V2.93 / B98：档位 → 尺寸只能有一份）。
     */
    resolutionTier: ResolutionTierSchema.optional(),
    /** 仅 video 步骤有意义；缺省引擎默认 */
    durationSec: DurationSecSchema.optional(),
    /** 用户已有资产 id；v1 只接受一张（无依赖视频作 first-frame / 图片作 ReferenceLatent） */
    referenceAssetIds: z.array(z.string().min(1)).max(4).default([]),
    /**
     * 上游 step id。结构兼容上限 ≤4（旧文档/未来扩展可存）；
     * 当前执行只支持 1 个 image 依赖（首帧/定妆锚点），>1 在 B93 明确拒绝。
     * 不要把结构上限当成当前消费能力，也不要把第二个依赖塞进未接线的 last-frame。
     */
    dependsOn: z.array(z.string().min(1)).max(4).default([]),
    /**
     * V2.66（S9）：本镜头与**下一镜头**接缝处的转场文案（来自分镜表 transition 原文）。
     * 服务端做白名单映射（叠化→fade / 左移→wipeleft / 右移→slideright），未映射 = 硬切。
     * 只在自动拼接时消费；不是生成请求字段。
     */
    transition: z.string().trim().max(160).optional(),
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
    /**
     * B99：拼接尝试代数（0 起）。
     *
     * **只在显式「重试拼接」时 +1**（换幂等键 = 真新任务）；服务端绝不自动加。
     * 与步骤的 `attempt` 同一条纪律：同一 attempt 的恢复/重复点击必须命中同一个拼接任务，
     * 否则一次网络抖动就会多切一遍片。
     */
    assemblyAttempt: z.number().int().min(0).default(0),
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

/**
 * B93 / F3：会话 v1 的参考消费边界（N9 未拍板，不新增主体锚点/多参考融合）。
 *
 * 当前真正接线的位置只有：
 * - 无依赖视频/图片步骤的**一张**用户参考（视频作 first-frame，图片作 ReferenceLatent）；
 * - 图片步骤的**一个**上游图片依赖（定妆锚点）。
 *
 * last-frame、多参考、用户参考与图片依赖混用都没有完整消费链；
 * 返回人话错误，不做静默截断/丢弃。
 */
export function creationRunReferenceProblem(step: {
  id: string;
  kind: 'image' | 'video';
  referenceAssetIds?: string[];
  dependsOn?: string[];
}): string | null {
  const references = step.referenceAssetIds ?? [];
  const dependencies = step.dependsOn ?? [];
  if (references.length > 1) {
    return (
      `步骤 ${step.id} 带 ${references.length} 张用户参考图；` +
      '当前只支持一张参考图（尾帧/多参考尚未接线），请移除多余参考或等待 N9 决策'
    );
  }
  if (dependencies.length > 1) {
    return (
      `步骤 ${step.id} 依赖 ${dependencies.length} 个图片步骤；` +
      '当前只支持一个首帧依赖（尾帧/多依赖尚未接线），请移除非首依赖'
    );
  }
  if (dependencies.length > 0 && references.length > 0) {
    return step.kind === 'image'
      ? `图片步骤 ${step.id} 已有首帧依赖，用户参考图没有可消费位置；当前不支持把上游首帧和用户参考混用`
      : `视频步骤 ${step.id} 已有生成首帧，用户参考图会被挤到尾帧位置而当前不消费；请移除参考图或改用单参考图 i2v`;
  }
  return null;
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
    const referenceProblem = creationRunReferenceProblem(step);
    if (referenceProblem !== null) return referenceProblem;
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
    /** V2.69 修正：全部步骤数（图片+视频）——列表进度的分母（此前只数视频步，"6/3"口径错位） */
    totalStepCount: z.number().int().min(0),
    succeededCount: z.number().int().min(0),
    failedCount: z.number().int().min(0),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();
export type CreationRunSummary = z.infer<typeof CreationRunSummarySchema>;

/** 路由响应（§29 / S8-B3） */
export const CreationRunResponseSchema = z
  .object({ run: CreationRunSchema })
  .strict();
export type CreationRunResponse = z.infer<typeof CreationRunResponseSchema>;

export const CreationRunListResponseSchema = z
  .object({ runs: z.array(CreationRunSummarySchema) })
  .strict();
export type CreationRunListResponse = z.infer<typeof CreationRunListResponseSchema>;

/** 归一化 projectId（与 /api/generate 同口径：空/缺省 → 默认项目 id） */
export function normalizeCreationRunProject(projectId: string | undefined): string {
  return normalizeProjectId(projectId);
}
