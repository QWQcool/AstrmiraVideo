import { describe, expect, it } from 'vitest';
import { STATS_DURATION_NOTE, percentile, type StatsSummaryResponse } from '@astrmira/shared';
import { summarizeTaskStats } from './stats.js';
import type { StatRow } from '../store/taskStore.js';

/**
 * 运行观测聚合（CONTRACT §16 附 / V2.90 / D-8）。
 *
 * 钉四件事：**百分位是 nearest-rank**、**在飞任务不算耗时**、**失败码只数失败**、
 * **没有样本就是 null（不写 0）**。
 */

function row(
  provider: string,
  status: string,
  durationMs: number,
  errorCode: string | null = null,
): StatRow {
  return { provider, status, createdAt: 1_000, updatedAt: 1_000 + durationMs, errorCode };
}

const base = {
  truncated: false,
  range: {} as { from?: number; to?: number },
  comfyLinks: [] as StatsSummaryResponse['comfyLinks'],
};

describe('运行观测聚合', () => {
  it('按 provider 分组：count / succeeded / failed / unfinished 各算各的', () => {
    const summary = summarizeTaskStats({
      ...base,
      rows: [
        row('host-comfyui', 'succeeded', 100),
        row('host-comfyui', 'failed', 200, 'UPSTREAM_ERROR'),
        row('host-comfyui', 'running', 300),
        row('cloud-volcano-seedance', 'succeeded', 400),
      ],
    });

    expect(summary.total).toBe(4);
    expect(summary.byProvider.map((item) => item.provider)).toEqual([
      'host-comfyui',
      'cloud-volcano-seedance',
    ]);
    expect(summary.byProvider[0]).toMatchObject({
      count: 3,
      succeeded: 1,
      failed: 1,
      unfinished: 1,
    });
  });

  it('耗时用 nearest-rank：4 个样本时 p50 = 第 2 个、p95 = 第 4 个', () => {
    const summary = summarizeTaskStats({
      ...base,
      rows: [
        row('p', 'succeeded', 100),
        row('p', 'succeeded', 200),
        row('p', 'succeeded', 300),
        row('p', 'succeeded', 400),
      ],
    });
    expect(summary.byProvider[0]?.p50Ms).toBe(200);
    expect(summary.byProvider[0]?.p95Ms).toBe(400);
  });

  it('在飞任务不进耗时（否则 p50 会被一条刚开始的任务拉低）', () => {
    const summary = summarizeTaskStats({
      ...base,
      rows: [row('p', 'succeeded', 1_000), row('p', 'queued', 5)],
    });
    expect(summary.byProvider[0]?.p50Ms).toBe(1_000);
    expect(summary.byProvider[0]?.unfinished).toBe(1);
  });

  it('没有终态样本 → p50/p95 都是 null（不是 0）', () => {
    const summary = summarizeTaskStats({ ...base, rows: [row('p', 'running', 10)] });
    expect(summary.byProvider[0]?.p50Ms).toBeNull();
    expect(summary.byProvider[0]?.p95Ms).toBeNull();
  });

  it('失败码分布只数失败/取消，且按次数降序', () => {
    const summary = summarizeTaskStats({
      ...base,
      rows: [
        row('p', 'failed', 1, 'UPSTREAM_ERROR'),
        row('p', 'failed', 1, 'UPSTREAM_ERROR'),
        row('p', 'cancelled', 1, 'CANCELLED_BY_USER'),
        // 成功任务即使带着 code 也不算失败
        row('p', 'succeeded', 1, 'UPSTREAM_ERROR'),
      ],
    });
    expect(summary.failureCodes).toEqual([
      { code: 'UPSTREAM_ERROR', count: 2 },
      { code: 'CANCELLED_BY_USER', count: 1 },
    ]);
  });

  it('空库：total 0、空数组、口径句仍下发（界面不必自己写一版）', () => {
    const summary = summarizeTaskStats({ ...base, rows: [] });
    expect(summary.total).toBe(0);
    expect(summary.byProvider).toEqual([]);
    expect(summary.failureCodes).toEqual([]);
    expect(summary.durationNote).toBe(STATS_DURATION_NOTE);
  });

  it('时钟回拨（updatedAt < createdAt）夹成 0，不产生负耗时', () => {
    const summary = summarizeTaskStats({
      ...base,
      rows: [{ provider: 'p', status: 'succeeded', createdAt: 2_000, updatedAt: 1_000, errorCode: null }],
    });
    expect(summary.byProvider[0]?.p50Ms).toBe(0);
  });
});

describe('percentile（nearest-rank）', () => {
  it('空数组 null；单样本任意分位都是它自己', () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([7], 50)).toBe(7);
    expect(percentile([7], 95)).toBe(7);
  });

  it('10 个样本：p50 = 第 5 个、p95 = 第 10 个', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 50)).toBe(5);
    expect(percentile(sorted, 95)).toBe(10);
  });
});
