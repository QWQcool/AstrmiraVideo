import type { CanvasPlan, VideoGenerateRequest } from '@astrmira/shared';
import {
  planExecutionOrder,
  planIdempotencyKey,
  planIncomingEdges,
  planNodeBlockReason,
  toGenerateRequest,
} from './canvasPlan';

/**
 * 编排执行器（CONTRACT §11-6 的五条执行语义；台账 A5 片 A）。
 *
 * ## 为什么是"注入 submit 的纯驱动"
 * 执行的全部正确性都在**顺序、阻断、幂等键**三件事上；网络只是最后一步。
 * 把 submit 注入进来，这三件事就能在单测里完整覆盖（本仓前端没有 jsdom，
 * 网络层靠冒烟的真浏览器覆盖 —— 两层各管一半，不重叠）。
 *
 * ## 与契约逐条对应
 * - 拓扑序提交、**不等终态**（下游引用的是上游的 `taskId`，提交成功那一刻就已存在）；
 * - 幂等键确定性（`plan:<planId>:<nodeId>`）—— 重跑必须显式换键（B69，片 B）；
 * - **不猜上游**：不能跑的节点进 `skipped` 并带原因（不带着错误输入去跑）；
 * - 环 → `cycle` 非空且**一个都不提交**；
 * - 结果只是界面状态，不落库（真相在 `tasks` 表）。
 */

export type PlanNodeRunState = 'submitted' | 'failed' | 'skipped';

export interface PlanNodeRunResult {
  nodeId: string;
  state: PlanNodeRunState;
  /** `submitted` 时必有（可在视频库 / 事实图里找到它） */
  taskId?: string;
  /** `failed` / `skipped` 时的原因（给人看的） */
  message?: string;
}

export interface PlanRunOutcome {
  /** 实际提交顺序（拓扑序；有环时为空数组） */
  order: string[];
  /** 有环时 = 环上的节点（**整体拒绝执行**的依据） */
  cycle: string[];
  results: PlanNodeRunResult[];
}

/** 等上游出片：默认 2s 一问、上限 6 分钟（云端一次出片 60~120s；本地轨远不止，所以超时是**如实失败**而不是死等） */
export const PLAN_POLL_INTERVAL_MS = 2_000;
export const PLAN_WAIT_TIMEOUT_MS = 6 * 60 * 1000;

export interface PlanRunnerDeps {
  /**
   * 提交一次生成（生产传 `submitGenerate` 的包一层；单测注入假实现）。
   *
   * `planRunId` = **本次运行的 id**（整轮运行共用同一个）—— 它是 `x-plan-run` 头的值：
   * 服务端据此把"一串节点"当成**一次有意动作**，只吃一次 60s 冷却（见 backend/security/rateLimit.ts
   * 的 `PlanRunRegistry`）。没有它，第 2 个节点起会被防线 5 挡成 429。
   */
  submit: (
    body: VideoGenerateRequest,
    idempotencyKey: string,
    planRunId: string,
  ) => Promise<{ taskId: string }>;
  /**
   * 查一条任务的状态（**等上游出片**用）。
   *
   * 为什么必须等：`task:<id>` 引用在服务端提交那一刻就会被核验 ——
   * 要求那条任务**已有可用成片**（`succeeded` + `outputVideoUrl`）。
   * 上游刚提交时还在 `queued`，直接引用会被 404 挡回（实测踩到）。
   */
  queryTask?: (taskId: string) => Promise<{ status: string; outputVideoUrl?: string | null }>;
  /** 运行 id 的时钟（可注入以便测试；默认 `Date.now`） */
  now?: () => number;
  /** 轮询间隔与等待上限（测试注入小值） */
  pollIntervalMs?: number;
  waitTimeoutMs?: number;
  /** 睡眠（测试注入立即 resolve） */
  sleep?: (ms: number) => Promise<void>;
}

function describeThrown(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

const SETTLED_FAILURE = new Set(['failed', 'cancelled']);

/**
 * 等一条任务走到"有可用成片"（`succeeded` + `outputVideoUrl`）。
 *
 * 三态如实：成功 / 失败（终态但没有成片）/ 超时 —— 后两者都返回 `ok: false` + **给人看的原因**，
 * 调用方据此把下游标成 `skipped`（而不是带着一条不存在的成片去提交）。
 */
async function waitForTaskReady(
  taskId: string,
  deps: PlanRunnerDeps,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (deps.queryTask === undefined) return { ok: true }; // 未注入 = 不做等待（老调用方的零改动路径）

  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const interval = deps.pollIntervalMs ?? PLAN_POLL_INTERVAL_MS;
  const deadline = now() + (deps.waitTimeoutMs ?? PLAN_WAIT_TIMEOUT_MS);
  const short = taskId.slice(0, 8);

  for (;;) {
    const task = await deps.queryTask(taskId);
    if (task.status === 'succeeded') {
      if (typeof task.outputVideoUrl === 'string' && task.outputVideoUrl !== '') return { ok: true };
      return { ok: false, message: `上游 ${short} 成功了但没有成片文件（可能已被容量淘汰清理）` };
    }
    if (SETTLED_FAILURE.has(task.status)) {
      return { ok: false, message: `上游 ${short} 以 ${task.status} 结束（没有可用成片）` };
    }
    if (now() >= deadline) {
      return {
        ok: false,
        message: `等待上游 ${short} 出片超时（本地轨可能要很久：可在视频库看进度，出片后再点一次运行）`,
      };
    }
    await sleep(interval);
  }
}

export async function runCanvasPlan(plan: CanvasPlan, deps: PlanRunnerDeps): Promise<PlanRunOutcome> {
  const { order, cycle } = planExecutionOrder(plan);
  if (cycle.length > 0) return { order: [], cycle, results: [] };

  // 本轮运行的 id（**整轮共用一个**）：服务端按它豁免"同一次动作内"的重复冷却
  const planRunId = `${plan.id}-${(deps.now ?? Date.now)()}`;
  const results: PlanNodeRunResult[] = [];
  const taskIdByNode = new Map<string, string>();

  for (const nodeId of order) {
    const node = plan.nodes.find((item) => item.id === nodeId);
    if (node === undefined) continue; // 防御：order 来自同一份 plan，理论上不会缺

    const blocked = planNodeBlockReason(plan, nodeId);
    if (blocked !== null) {
      results.push({ nodeId, state: 'skipped', message: blocked });
      continue;
    }

    // `planNodeBlockReason` 已保证入边 ≤ 1 条；这里取那一条（v2v 的数据流来源）
    const upstreamId = planIncomingEdges(plan, nodeId)[0]?.from;
    let upstreamTaskId: string | undefined;
    if (upstreamId !== undefined) {
      const submitted = taskIdByNode.get(upstreamId);
      if (submitted === undefined) {
        results.push({
          nodeId,
          state: 'skipped',
          message: '上游没有提交成功 —— 本节点不带着错误输入去跑（上游那条的原因见它自己）',
        });
        continue;
      }
      // 等上游出片：`task:` 引用在服务端要求"已有可用成片"（否则下游提交必然 404）
      const ready = await waitForTaskReady(submitted, deps);
      if (!ready.ok) {
        results.push({ nodeId, state: 'skipped', message: ready.message });
        continue;
      }
      upstreamTaskId = submitted;
    }

    try {
      const { taskId } = await deps.submit(
        toGenerateRequest(node, upstreamTaskId),
        planIdempotencyKey(plan.id, nodeId),
        planRunId,
      );
      taskIdByNode.set(nodeId, taskId);
      results.push({ nodeId, state: 'submitted', taskId });
    } catch (caught) {
      results.push({ nodeId, state: 'failed', message: describeThrown(caught) });
    }
  }

  return { order, cycle: [], results };
}
