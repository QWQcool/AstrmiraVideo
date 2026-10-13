import { z } from 'zod';
import { AspectRatioSchema, DurationSecSchema, GenerationModeSchema, ProviderTypeSchema } from './request.js';

/**
 * 画布编排 `astrmira.canvas-plan`（CONTRACT §11-6 / V2.26；台账 A5 片 A，D50 定格 (b) 编排即可执行）。
 *
 * ## 它是什么
 * 血缘画布原先只回答"这片子怎么来的"（只读事实图）。编排模式（`#/canvas?mode=plan`）让用户
 * 自己摆节点、连线、写参数，按一次「▶ 运行编排」把它们**按依赖顺序提交**为真实生成任务。
 *
 * ## 三条口径（都是"会花真钱"逼出来的）
 * 1. **编排是本地产物、执行走既有通道**：不设 `/api/plans`，提交用 `POST /api/generate` ——
 *    服务端不需要知道"编排"这个概念，它只认识任务；
 * 2. **幂等键确定性**（`plan:<planId>:<nodeId>`）：连点两次「运行」不重复计费；
 *    也正因此"重跑"必须显式换键（= B69，片 B）；
 * 3. **不猜上游**：只有 v2v 有"上游产物 → 下游输入"通道（`task:` 引用）；
 *    其它模式带入边、或 v2v 多入边 → 运行时**如实拒绝**该节点（错误输入烧钱比拒跑更贵）。
 */

/** 编排格式版本（进契约：将来加导入时按它做"旧文件能打开"） */
export const CANVAS_PLAN_VERSION = 1;

/**
 * 幂等键前缀（**确定性键**的组成部分）。
 *
 * ⚠️ 不要用 `newIdempotencyKey()`（随机）来跑编排：随机键 = 每次点「运行」都是一次新提交，
 * 而编排节点是"同一件事的重复表达" —— 那正是最贵的误操作形态。
 */
export const PLAN_IDEMPOTENCY_PREFIX = 'plan:';

/**
 * 节点级重试的上限（V2.29 / B74）。
 *
 * 为什么封顶 3：这是"提交那一刻的失败"（429 冷却 / 5xx / 网络抖动）的兜底，
 * 不是排队系统 —— 加得更长只是让用户更久看不到失败。
 */
export const PLAN_RETRY_MAX_ATTEMPTS = 3;
/** 默认退避（毫秒）—— 60s 冷却那种失败本来就不该靠重试硬撞（界面会如实告诉用户等多久） */
export const PLAN_RETRY_DEFAULT_BACKOFF_MS = 2_000;

export const CanvasPlanRetrySchema = z.object({
  /** 总共试几次（1 = 不重试）。上限 `PLAN_RETRY_MAX_ATTEMPTS` */
  maxAttempts: z.number().int().min(1).max(PLAN_RETRY_MAX_ATTEMPTS),
  /** 两次之间的退避（毫秒） */
  backoffMs: z.number().int().min(0).max(60_000),
});

export const CanvasPlanNodeSchema = z.object({
  id: z.string().min(1),
  /** 空提示词在**执行时**被拒（编辑期允许空 —— 边写边存，不能因为还没写完就不让存） */
  prompt: z.string(),
  mode: GenerationModeSchema,
  aspectRatio: AspectRatioSchema,
  provider: ProviderTypeSchema,
  durationSec: DurationSecSchema.optional(),
  resolution: z
    .object({ width: z.number().int().positive(), height: z.number().int().positive() })
    .optional(),
  seed: z.number().int().optional(),
  /** 画布坐标：编排模式下**持久化**（与事实图节点相反 —— 那里位置是会话级的） */
  position: z.object({ x: z.number(), y: z.number() }),
  /**
   * V2.29（B68 / B69）：**本轮（`runSeq`）里这个节点提交得到的任务 id**，由运行时写回。
   *
   * 它是"部分重跑"能成立的**唯一来源**：范围外的节点不重新提交，
   * 但下游要引用它的成片 —— 那份引用只能来自上一轮记在这里的 taskId。
   */
  lastTaskId: z.string().min(1).optional(),
  /**
   * V2.29（B68）：**用户显式固定**的产物 —— 运行中**永不重提交**（连"重跑全部"也不动它），
   * 下游一律引用它。用来钉住"很贵 / 已经满意"的那一段，只重跑下游。
   */
  pinnedTaskId: z.string().min(1).optional(),
  /** V2.29（B74）：节点级重试。省略 = 不重试（maxAttempts 1） */
  retry: CanvasPlanRetrySchema.optional(),
});

export const CanvasPlanEdgeSchema = z.object({
  id: z.string().min(1),
  /** 上游节点 id（数据流方向：`from` 的产物喂给 `to`） */
  from: z.string().min(1),
  to: z.string().min(1),
});

export const CanvasPlanSchema = z.object({
  version: z.literal(CANVAS_PLAN_VERSION),
  /** 幂等键的组成部分（见 `PLAN_IDEMPOTENCY_PREFIX`） */
  id: z.string().min(1),
  name: z.string(),
  nodes: z.array(CanvasPlanNodeSchema),
  edges: z.array(CanvasPlanEdgeSchema),
  updatedAt: z.number(),
  /**
   * V2.29（B69）：**运行代数** —— 默认读作 1（老编排没有这个字段）。
   *
   * 幂等键只由它决定：`runSeq` 不变 → 「运行」永远命中同一批任务（**不重复计费**）；
   * **显式重跑**才 +1 → 换键 → 真的产生新任务（**真的花钱**，界面必须写清）。
   * 用"代数"而不是"随机盐"：同一张图跑第二遍必须能得到**同一批键**（否则连点两次重跑
   * 会各自新建一套任务，那是双倍计费）。
   */
  runSeq: z.number().int().min(1).max(1_000_000).optional(),
});

export type CanvasPlanNode = z.infer<typeof CanvasPlanNodeSchema>;
export type CanvasPlanEdge = z.infer<typeof CanvasPlanEdgeSchema>;
export type CanvasPlan = z.infer<typeof CanvasPlanSchema>;
