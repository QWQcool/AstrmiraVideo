import {
  STATS_DURATION_NOTE,
  STATS_TERMINAL_STATUSES,
  percentile,
  type FailureCodeCount,
  type ProviderStats,
  type StatsSummaryResponse,
} from '@astrmira/shared';
import type { StatRow } from '../store/taskStore.js';

/**
 * 运行观测的聚合（CONTRACT §16 附 / V2.90 / D-8）。
 *
 * ## 为什么是纯函数
 * 百分位、失败码分布、provider 分组都是**判定规则**：写错了不会报错，只会给出一个
 * 看不出问题的数字（例如把在飞任务算进耗时 → p50 变小，成功率变高）。
 * 抽成纯函数就能在单测里逐项钉住，路由只负责取数与拼装。
 */

export interface SummarizeInput {
  rows: readonly StatRow[];
  /** 触到扫描上界（此时数字只是部分样本） */
  truncated: boolean;
  range: { from?: number | undefined; to?: number | undefined };
  /** ComfyUI 进度通道（由路由注入；纯函数不碰网络/单例） */
  comfyLinks: StatsSummaryResponse['comfyLinks'];
}

const TERMINAL = new Set<string>(STATS_TERMINAL_STATUSES);
const FAILED = new Set<string>(['failed', 'cancelled']);

/** 耗时定义：终态写入时间 - 创建时间（负值夹成 0：时钟回拨不该产生负耗时） */
function durationOf(row: StatRow): number {
  return Math.max(0, row.updatedAt - row.createdAt);
}

export function summarizeTaskStats(input: SummarizeInput): StatsSummaryResponse {
  const byProvider = new Map<string, { rows: StatRow[] }>();
  const failureCodes = new Map<string, number>();

  for (const row of input.rows) {
    const bucket = byProvider.get(row.provider) ?? { rows: [] };
    bucket.rows.push(row);
    byProvider.set(row.provider, bucket);

    if (FAILED.has(row.status) && row.errorCode !== null) {
      failureCodes.set(row.errorCode, (failureCodes.get(row.errorCode) ?? 0) + 1);
    }
  }

  const providers: ProviderStats[] = [...byProvider.entries()]
    .map(([provider, bucket]) => {
      const durations = bucket.rows
        .filter((row) => TERMINAL.has(row.status))
        .map(durationOf)
        .sort((left, right) => left - right);
      return {
        provider,
        count: bucket.rows.length,
        succeeded: bucket.rows.filter((row) => row.status === 'succeeded').length,
        failed: bucket.rows.filter((row) => FAILED.has(row.status)).length,
        unfinished: bucket.rows.filter((row) => !TERMINAL.has(row.status)).length,
        p50Ms: percentile(durations, 50),
        p95Ms: percentile(durations, 95),
      };
    })
    // 任务多的排前面；同数量按 provider id（确定性 —— 断言与截图都不该随机）
    .sort((left, right) => right.count - left.count || left.provider.localeCompare(right.provider));

  const codes: FailureCodeCount[] = [...failureCodes.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));

  return {
    range: { from: input.range.from ?? null, to: input.range.to ?? null },
    total: input.rows.length,
    byProvider: providers,
    failureCodes: codes,
    comfyLinks: input.comfyLinks,
    truncated: input.truncated,
    durationNote: STATS_DURATION_NOTE,
  };
}
