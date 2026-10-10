import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  COST_DISCLAIMER,
  CostSummaryResponseSchema,
  ErrorResponseSchema,
  findVideoModelPreset,
  normalizeProjectId,
  type CostBucket,
} from '@astrmira/shared';
import { readMonthlyBudgetYuan } from '../pricing.js';
import type { ProjectStore } from '../store/projects.js';
import type { CostRow, TaskStore } from '../store/taskStore.js';

/**
 * 成本台账汇总（V2.12 / 台账 B48，CONTRACT §5 / §12）。
 *
 * ## 三条口径
 * 1. **只统计成功任务**（成本在终态结算）；**未结算**（V2.12 之前的老任务）单独计数 ——
 *    金额旁边必须站着"还有 N 条没算出来"，否则这个金额会被读成"全部花费"；
 * 2. **`?project=` 省略 = 默认项目**（与 history / assets 同一口径）；
 *    `?project=all` = **跨项目汇总**（成本视图的"全部项目"档 —— 这是唯一刻意允许跨项目的地方，
 *    因为"这台机器一共花了多少钱"是部署方的问题，与"我在哪个项目里"不冲突）；
 * 3. **`truncated` 如实上报**：扫描行数触到上界时，金额只是**部分之和**。
 *
 * ## 为什么不在这里算"每条任务的成本"
 * 单条成本在**结算时**就算好了（`queue/SqliteJobQueue.complete` + `pricing.settleTaskCost`），
 * 这里只做**聚合**。两处各算一套 = 早晚对不上（B48 的实现要点就是"结算一次、聚合多次"）。
 */

/** 扫描上界：超过就截断并如实标注（不把十万行拉进内存） */
const COST_SCAN_LIMIT = 20_000;

const CostSummaryQuerySchema = z.object({
  /** 项目 id；缺省 = 默认项目；字面量 `all` = 跨项目汇总 */
  project: z.string().optional(),
  /** 统计区间（epoch ms，含端点） */
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
});

/** `KEY` 桶累加（yuan 求和、条数各自计数） */
function addToBucket(buckets: Map<string, CostBucket>, key: string, label: string, row: CostRow): void {
  const existing = buckets.get(key) ?? { key, label, yuan: 0, taskCount: 0, unsettledCount: 0 };
  existing.taskCount += 1;
  if (row.costYuan === null) {
    existing.unsettledCount += 1;
  } else {
    existing.yuan += row.costYuan;
  }
  buckets.set(key, existing);
}

/** 时间戳 → 本地日期键（`YYYY-MM-DD`）与显示标签（同一天同一桶） */
function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** 金额求和后**统一收敛到 4 位小数**（与单条记录的精度一致，避免浮点噪声写进响应） */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function sortBuckets(buckets: Map<string, CostBucket>, order: 'keys-desc' | 'yuan-desc'): CostBucket[] {
  const list = [...buckets.values()].map((bucket) => ({ ...bucket, yuan: round4(bucket.yuan) }));
  if (order === 'keys-desc') list.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  else list.sort((a, b) => b.yuan - a.yuan || b.taskCount - a.taskCount);
  return list;
}

export function createCostRoutes(deps: {
  store: TaskStore;
  /** 只为把项目名补进桶的 label（成本数字本身不依赖项目表） */
  projects: ProjectStore;
}): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/api/costs/summary',
      {
        schema: {
          querystring: CostSummaryQuerySchema,
          response: { 200: CostSummaryResponseSchema, 400: ErrorResponseSchema },
        },
      },
      async (request) => {
        const query = request.query;
        // `all` = 跨项目；其余（含缺省）收敛成具体项目 id
        const scoped = query.project?.trim() === 'all';
        const projectId = scoped ? undefined : normalizeProjectId(query.project);
        const { from, to } = query;

        const rows = deps.store.listCostRows({
          ...(projectId === undefined ? {} : { projectId }),
          ...(from === undefined ? {} : { from }),
          ...(to === undefined ? {} : { to }),
          limit: COST_SCAN_LIMIT,
        });

        const byProject = new Map<string, CostBucket>();
        const byDay = new Map<string, CostBucket>();
        const byModel = new Map<string, CostBucket>();
        let totalYuan = 0;
        let pricedTaskCount = 0;
        let unsettledCount = 0;

        for (const row of rows) {
          if (row.costYuan === null) unsettledCount += 1;
          else {
            totalYuan += row.costYuan;
            pricedTaskCount += 1;
          }

          addToBucket(byProject, row.projectId, row.projectId, row);
          const day = dayKey(row.createdAt);
          addToBucket(byDay, day, day, row);
          const modelId = row.modelId ?? '';
          addToBucket(
            byModel,
            modelId === '' ? 'default' : modelId,
            modelId === '' ? '默认档（未指定模型）' : (findVideoModelPreset(modelId)?.label ?? modelId),
            row,
          );
        }

        // 项目名从项目表补齐；桶的 label 先用 id 兜底 —— **项目被删了那笔钱也要能看见**
        // （成本是历史事实，不该因为项目被删就从报表里消失）
        const projectNames = new Map(
          deps.projects.list().map((entry) => [entry.projectId, entry.name]),
        );
        for (const bucket of byProject.values()) {
          bucket.label = projectNames.get(bucket.key) ?? bucket.key;
        }

        const uncertainCount = deps.store.countUncertain({
          ...(projectId === undefined ? {} : { projectId }),
          ...(from === undefined ? {} : { from }),
          ...(to === undefined ? {} : { to }),
        });

        // 月度预算只在**跨项目**档给出：预算是部署级参数，"某个项目的本月花费 vs 全局预算"
        // 是两个口径的数字放一起，只会误导。
        const monthlyYuan = scoped ? readMonthlyBudgetYuan() : null;
        const budget =
          monthlyYuan === null
            ? null
            : (() => {
                const monthStart = new Date();
                monthStart.setDate(1);
                monthStart.setHours(0, 0, 0, 0);
                const monthToDateYuan = round4(
                  deps.store
                    .listCostRows({ from: monthStart.getTime(), limit: COST_SCAN_LIMIT })
                    .reduce((sum, row) => sum + (row.costYuan ?? 0), 0),
                );
                return {
                  monthlyYuan,
                  monthToDateYuan,
                  ratio: round4(monthToDateYuan / monthlyYuan),
                  over: monthToDateYuan > monthlyYuan,
                };
              })();

        return {
          range: { from: from ?? null, to: to ?? null },
          projectId: projectId ?? null,
          totalYuan: round4(totalYuan),
          taskCount: rows.length,
          pricedTaskCount,
          unsettledCount,
          uncertainCount,
          byProject: sortBuckets(byProject, 'yuan-desc'),
          byDay: sortBuckets(byDay, 'keys-desc'),
          byModel: sortBuckets(byModel, 'yuan-desc'),
          truncated: rows.length >= COST_SCAN_LIMIT,
          budget,
          disclaimer: COST_DISCLAIMER,
        };
      },
    );
  };
}


