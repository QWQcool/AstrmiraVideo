import { z } from 'zod';

/**
 * 运行观测 `GET /api/stats/summary`（CONTRACT §16 附 / V2.90 / D-8）。
 *
 * ## 三条口径
 * 1. **数据只来自已有任务记录**（`tasks` 表）：不新建埋点表、不改上报通道 ——
 *    观测不该反过来给主链路增加失败面；
 * 2. **耗时是近似的**：`耗时 = 任务记录最后更新时间 - 创建时间`（终态写入那一刻）。
 *    它包含排队时间与上游轮询间隔，**不是模型推理耗时**，界面上必须这么说；
 * 3. **没有样本就是 null**（`p50Ms` / `p95Ms`），不写 0 —— "0 毫秒"是假数据。
 */

/** 一个 provider 的聚合（provider id 原样，显示名由前端按能力目录翻） */
export const ProviderStatsSchema = z.object({
  provider: z.string().min(1),
  /** 该 provider 的任务总数（含在飞） */
  count: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /** 仍在排队/运行/提交中的条数（口径写清楚，别和 failed 相加对不上总数） */
  unfinished: z.number().int().nonnegative(),
  /** 终态任务的耗时中位数（毫秒）；没有终态样本 → null */
  p50Ms: z.number().nonnegative().nullable(),
  p95Ms: z.number().nonnegative().nullable(),
});

export const FailureCodeCountSchema = z.object({
  code: z.string().min(1),
  count: z.number().int().positive(),
});

/** ComfyUI WebSocket 的连接事实（V2.82 的进度通道，D-8 才开始上报它的健康度） */
export const ComfyLinkStatsSchema = z.object({
  baseUrl: z.string().min(1),
  state: z.enum(['connecting', 'connected', 'closed']),
  /** 成功建立连接的次数（进程启动以来） */
  opens: z.number().int().nonnegative(),
  /** 断线后重新连接的次数 */
  reconnects: z.number().int().nonnegative(),
});

export const StatsSummaryResponseSchema = z.object({
  range: z.object({ from: z.number().nullable(), to: z.number().nullable() }),
  /** 参与统计的任务条数（未截断时 = 库里的总数） */
  total: z.number().int().nonnegative(),
  byProvider: z.array(ProviderStatsSchema),
  failureCodes: z.array(FailureCodeCountSchema),
  /** 本地 ComfyUI 的进度通道；没有实例（或没连过）→ 空数组，不造一条假连接 */
  comfyLinks: z.array(ComfyLinkStatsSchema),
  /** 扫描上界（触界时界面要说"只是部分样本"） */
  truncated: z.boolean(),
  /** 耗时口径的一句话（服务端下发，界面不要自己再写一版） */
  durationNote: z.string().min(1),
});

export type ProviderStats = z.infer<typeof ProviderStatsSchema>;
export type FailureCodeCount = z.infer<typeof FailureCodeCountSchema>;
export type ComfyLinkStats = z.infer<typeof ComfyLinkStatsSchema>;
export type StatsSummaryResponse = z.infer<typeof StatsSummaryResponseSchema>;

/** 耗时口径（服务端与文档同一句；改它要一起改 CONTRACT §16 附） */
export const STATS_DURATION_NOTE =
  '耗时 = 任务记录最后更新时间 - 创建时间，含排队与轮询间隔，不是模型推理耗时';

/** 终态判定（与任务状态机一致） */
export const STATS_TERMINAL_STATUSES = ['succeeded', 'failed', 'cancelled'] as const;

/** 最近的百分位（nearest-rank）：小样本下比插值更不容易给出"看起来精确"的假值 */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] as number;
}
