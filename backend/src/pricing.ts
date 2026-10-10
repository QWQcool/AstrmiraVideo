import {
  COST_DEFAULT_USD_TO_CNY,
  estimateCostFromRequest,
  type CostRecord,
  type VideoGenerateRequest,
} from '@astrmira/shared';
import type { TrackId } from './store/taskStore.js';

/**
 * 成本结算的**服务端落点**（V2.12 / 台账 B48）。
 *
 * 分工（刻意分两处，别合并）：
 * - **算式与单价表**在 `packages/shared/src/cost.ts`（前端要在提交前预估，两侧必须同源）；
 * - **部署参数**（汇率 / 月度预算）在这里读 env —— 它们属于这一台部署，不属于产品知识。
 *
 * 三条纪律：
 * 1. **不编数字**：`estimateVideoCost` 拿不到分辨率或时长就返回 `null`，这里如实透传
 *    （任务照常成功，只是没有成本记录 —— "不知道花了多少"是必须允许存在的状态）；
 * 2. **本地轨记 0 元**（`local-free`）：不是"没有成本"，而是"没有 API 费用"；
 * 3. 结算发生在**终态成功**那一刻（`SqliteJobQueue.complete`），失败任务不结算 ——
 *    上游在参数校验阶段拒绝时不产生费用（PLAN §8 实测），而已提交后失败的任务
 *    由 `UNCERTAIN_RESULT` 计数在汇总里单独暴露（**可能产生费用**）。
 */

/** 汇率（`COST_USD_TO_CNY`）；脏值回落到默认值，不抛 —— 一个坏 env 不该让任务结算失败 */
export function readCostUsdToCny(): number {
  const raw = process.env['COST_USD_TO_CNY'];
  if (typeof raw !== 'string' || raw.trim() === '') return COST_DEFAULT_USD_TO_CNY;
  const parsed = Number.parseFloat(raw.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : COST_DEFAULT_USD_TO_CNY;
}

/**
 * 月度预算（`MONTHLY_BUDGET_YUAN`，可选）。
 * **未配置返回 null** —— 不编一个默认预算（"预算"是客户的经营参数，不是我们的默认值）。
 */
export function readMonthlyBudgetYuan(): number | null {
  const raw = process.env['MONTHLY_BUDGET_YUAN'];
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const parsed = Number.parseFloat(raw.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** 结算一条任务的成本（`track` 决定"云端估算"还是"本地 0 元"） */
export function settleTaskCost(
  request: VideoGenerateRequest,
  track: TrackId,
): CostRecord | null {
  return estimateCostFromRequest(request, {
    track: track === 'local' ? 'local' : 'cloud',
    usdToCny: readCostUsdToCny(),
  });
}
