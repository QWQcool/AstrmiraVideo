import { describe, expect, it } from 'vitest';
import type { CostSummaryResponse } from '@astrmira/shared';
import {
  costRangeWindow,
  describeBudget,
  describeCostBucket,
  describeCostHeadline,
} from './costView';

/**
 * 成本视图的纯函数层（V2.12 / 台账 B48 片 B）。
 *
 * 这一层要守住的是**"数字要成组出现"**这条契约要求：
 * 金额旁边必须有已结算 / 未结算 / 不确定的条数，否则一个孤零零的金额会被读成"就这么多了"。
 */

function summary(over: Partial<CostSummaryResponse> = {}): CostSummaryResponse {
  return {
    range: { from: null, to: null },
    projectId: 'default',
    totalYuan: 2.4844,
    taskCount: 1,
    pricedTaskCount: 1,
    unsettledCount: 0,
    uncertainCount: 0,
    byProject: [],
    byDay: [],
    byModel: [],
    truncated: false,
    budget: null,
    disclaimer: '预估金额……以火山方舟控制台账单为准。',
    ...over,
  };
}

describe('区间档位 → 时间区间', () => {
  it('今日 = 今天 0:00 起（本地时区，与总览"今日生成"同口径）', () => {
    const now = new Date(2026, 9, 10, 15, 30, 0).getTime();
    const window = costRangeWindow('today', now);
    expect(window.from).toBe(new Date(2026, 9, 10, 0, 0, 0, 0).getTime());
  });

  it('近 7 天**含今天**（往前推 6 天，不是 7 天）', () => {
    const now = new Date(2026, 9, 10, 9, 0, 0).getTime();
    const window = costRangeWindow('7d', now);
    expect(window.from).toBe(new Date(2026, 9, 4, 0, 0, 0, 0).getTime());
  });

  it('近 30 天含今天（往前推 29 天）', () => {
    const now = new Date(2026, 9, 30, 9, 0, 0).getTime();
    const window = costRangeWindow('30d', now);
    expect(window.from).toBe(new Date(2026, 9, 1, 0, 0, 0, 0).getTime());
  });

  it('全部 → 不给区间（服务端据此不过滤）', () => {
    expect(costRangeWindow('all')).toEqual({});
  });

  it('一律**不设上限**（避免刚生成的任务被时钟毫秒差挤出区间）', () => {
    const now = Date.now();
    expect('to' in costRangeWindow('today', now)).toBe(false);
  });
});

describe('头部文案：金额与条数必须成组出现', () => {
  it('全都有成本记录 → 只报已结算条数', () => {
    const headline = describeCostHeadline(summary({ pricedTaskCount: 3 }));
    // `formatYuan` 的口径：≥1 元保留 2 位（¥2.48）；小额才保留到 4 位
    expect(headline.total).toBe('¥2.48');
    expect(headline.detail).toBe('已结算 3 条');
    expect(headline.unsettledNote).toBeNull();
    expect(headline.uncertainNote).toBeNull();
  });

  it('有未结算 → 明细里出现，且单独给一句说明（金额**没有**把它们算进去）', () => {
    const headline = describeCostHeadline(summary({ pricedTaskCount: 2, unsettledCount: 5 }));
    expect(headline.detail).toBe('已结算 2 条 · 未结算 5 条');
    expect(headline.unsettledNote).toContain('5 条成功任务没有成本记录');
    expect(headline.unsettledNote).toContain('未计入上方金额');
  });

  it('有不确定 → 用**最显眼**的说法（可能已经花了钱，但不在金额里）', () => {
    const headline = describeCostHeadline(summary({ uncertainCount: 2 }));
    expect(headline.uncertainNote).toContain('2 条任务结果不明');
    expect(headline.uncertainNote).toContain('可能已经产生费用');
    expect(headline.uncertainNote).toContain('不在上方金额里');
  });

  it('被截断 → 明细里压过其它说明（金额只是部分之和）', () => {
    const headline = describeCostHeadline(summary({ truncated: true, pricedTaskCount: 7 }));
    expect(headline.detail).toContain('已截断');
    expect(headline.detail).toContain('部分之和');
  });
});

describe('桶与预算文案', () => {
  it('桶：金额 + 条数（+ 未结算）', () => {
    expect(describeCostBucket({ yuan: 0.35, taskCount: 2, unsettledCount: 0 })).toBe('¥0.350 · 2 条');
    expect(describeCostBucket({ yuan: 0, taskCount: 1, unsettledCount: 1 })).toBe(
      '¥0 · 1 条 · 含 1 条未结算',
    );
  });

  it('预算：未配置就是 null（不编默认预算）', () => {
    expect(describeBudget(null)).toBeNull();
  });

  it('预算：给出已用 / 预算 / 百分比，超支时 over=true 且比例封顶 1', () => {
    const budget = describeBudget({
      monthlyYuan: 2,
      monthToDateYuan: 2.4844,
      ratio: 1.2422,
      over: true,
    });
    expect(budget?.over).toBe(true);
    expect(budget?.ratio).toBe(1);
    expect(budget?.text).toContain('本月已用 ¥2.48');
    expect(budget?.text).toContain('预算 ¥2.00');
    expect(budget?.text).toContain('124%');
  });
});
