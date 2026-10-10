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
});

export type CanvasPlanNode = z.infer<typeof CanvasPlanNodeSchema>;
export type CanvasPlanEdge = z.infer<typeof CanvasPlanEdgeSchema>;
export type CanvasPlan = z.infer<typeof CanvasPlanSchema>;
