import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { StatsSummaryResponseSchema, type ComfyLinkStats } from '@astrmira/shared';
import { summarizeTaskStats } from '../observability/stats.js';
import type { TaskStore } from '../store/taskStore.js';

/**
 * 运行观测汇总（CONTRACT §16 附 / V2.90 / D-8）。
 *
 * ## 为什么不做成"每次请求都全表扫描"
 * 上界 20000 行（与成本汇总同口径）：触界时 `truncated: true`，界面必须说"只是部分样本"。
 * 观测接口自己变成慢查询，是这类端点最常见的失败形态。
 *
 * ## 为什么不新增埋点表
 * 已有 `tasks` 表就够回答三件事：哪个 provider 跑得多、多快（近似）、失败在哪些码上。
 * 埋点表会引入第二条写入路径 —— 主链路挂掉时观测也一起失真，而且没人会去核对两侧。
 */

const STATS_SCAN_LIMIT = 20_000;

const StatsQuerySchema = z.object({
  /** 创建时间区间（epoch ms，含端点） */
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
});

export interface StatsRoutesDeps {
  store: TaskStore;
  /** 测试注入；生产传 `comfyProgressStats`（进程级 WS 跟踪器） */
  comfyLinks?: () => ComfyLinkStats[];
}

export const createStatsRoutes =
  (deps: StatsRoutesDeps): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/api/stats/summary',
      {
        schema: {
          querystring: StatsQuerySchema,
          response: { 200: StatsSummaryResponseSchema },
        },
      },
      async (request) => {
        const { from, to } = request.query;
        const rows = deps.store.listStatRows({
          limit: STATS_SCAN_LIMIT,
          ...(from === undefined ? {} : { from }),
          ...(to === undefined ? {} : { to }),
        });

        return summarizeTaskStats({
          rows,
          truncated: rows.length >= STATS_SCAN_LIMIT,
          range: { from, to },
          comfyLinks: deps.comfyLinks?.() ?? [],
        });
      },
    );
  };
