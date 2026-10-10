import { formatYuan, type CostSummaryResponse } from '@astrmira/shared';

/**
 * 成本视图的**纯函数层**（V2.12 / 台账 B48 片 B）。
 *
 * 这一层只做两件事：把"区间档位"翻译成 `from`/`to`，以及把汇总响应翻译成界面要显示的文案。
 * 放在纯函数里而不是组件里，是为了让"金额文案 / 缺失说明"这类**容易写错又难测**的东西有断言。
 */

/** 区间档位（界面上的 chips） */
export type CostRangeKey = 'today' | '7d' | '30d' | 'all';

export interface CostRangeOption {
  key: CostRangeKey;
  label: string;
}

export const COST_RANGE_OPTIONS: readonly CostRangeOption[] = [
  { key: 'today', label: '今日' },
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' },
  { key: 'all', label: '全部' },
] as const;

/**
 * 档位 → 时间区间（epoch ms）。
 *
 * **刻意用本地时区**（"今日"= 用户看到的今天，与总览的"今日生成"同口径）；
 * `to` 一律省略（= 不限上限），避免"刚生成的任务因为时钟毫秒差被排除在外"。
 * `all` → 两个都不给（服务端据此不做区间过滤）。
 */
export function costRangeWindow(key: CostRangeKey, now: number = Date.now()): { from?: number } {
  if (key === 'all') return {};
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (key === 'today') return { from: start.getTime() };
  const days = key === '7d' ? 7 : 30;
  // "近 7 天"含今天 → 往前推 6 天（不是 7 天），否则看起来像多了一天
  start.setDate(start.getDate() - (days - 1));
  return { from: start.getTime() };
}

export interface CostHeadline {
  /** 主数字（已格式化：¥0.35 / ¥1,234） */
  total: string;
  /** 主数字下面那行：已结算 + 未结算 + 不确定 **一起说**（只给金额会被读成全量） */
  detail: string;
  /** 有未结算时的提示（无则为 null） */
  unsettledNote: string | null;
  /** 有不确定任务时的警告（无则为 null） */
  uncertainNote: string | null;
}

/**
 * 汇总 → 头部文案。
 *
 * 三条口径写在文案里（而不是靠用户猜）：
 * ① 金额旁边必须站着"已结算 N 条"与"未结算 N 条"；
 * ② `UNCERTAIN_RESULT` **可能已经花了钱**，只要不为 0 就必须显眼地说出来；
 * ③ 被截断（`truncated`）时金额只是**部分之和** —— 这一条必须压过其它说明。
 */
export function describeCostHeadline(summary: CostSummaryResponse): CostHeadline {
  const detailParts = [`已结算 ${summary.pricedTaskCount} 条`];
  if (summary.unsettledCount > 0) detailParts.push(`未结算 ${summary.unsettledCount} 条`);

  return {
    total: formatYuan(summary.totalYuan),
    detail: summary.truncated
      ? `${detailParts.join(' · ')} · ⚠️ 已截断（仅部分之和）`
      : detailParts.join(' · '),
    unsettledNote:
      summary.unsettledCount === 0
        ? null
        : `另有 ${summary.unsettledCount} 条成功任务没有成本记录（V2.12 之前的老任务），未计入上方金额。`,
    uncertainNote:
      summary.uncertainCount === 0
        ? null
        : `⚠️ ${summary.uncertainCount} 条任务结果不明（已提交未确认）——**可能已经产生费用**，但它不在上方金额里。`,
  };
}

/** 桶的显示文案：金额 + 条数（+ 未结算）——三个数字一个都不能少 */
export function describeCostBucket(bucket: {
  yuan: number;
  taskCount: number;
  unsettledCount: number;
}): string {
  const parts = [`${formatYuan(bucket.yuan)} · ${bucket.taskCount} 条`];
  if (bucket.unsettledCount > 0) parts.push(`含 ${bucket.unsettledCount} 条未结算`);
  return parts.join(' · ');
}

/** 预算文案（无预算时返回 null —— 不编默认预算） */
export function describeBudget(
  budget: CostSummaryResponse['budget'],
): { text: string; ratio: number; over: boolean } | null {
  if (budget === null) return null;
  const percent = Math.round(budget.ratio * 100);
  return {
    text: `本月已用 ${formatYuan(budget.monthToDateYuan)} / 预算 ${formatYuan(budget.monthlyYuan)}（${percent}%）`,
    ratio: Math.min(1, Math.max(0, budget.ratio)),
    over: budget.over,
  };
}
