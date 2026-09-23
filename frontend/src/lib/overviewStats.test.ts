import { describe, expect, it } from 'vitest';
import type { EventLogEntry, StorageUsage, TaskProgress } from '@astrmira/shared';
import {
  buildActivityFeed,
  computeOverviewStats,
  formatBytes,
  formatRelativeTime,
  recentShots,
  startOfToday,
} from './overviewStats';

/**
 * 总览聚合的口径测试（V9 · B3 / Step 6-AC2）。
 *
 * 这几条是"四卡数字必须能对账"的底座：分母、边界、除零、排序都要能被钉住，
 * 否则总览页会变成"数字看着挺像"的一页。
 */

const EMPTY_STORAGE: StorageUsage = {
  totalBytes: 0,
  videoBytes: 0,
  videoCount: 0,
  thumbBytes: 0,
  assetBytes: 0,
  assetCount: 0,
};

function task(overrides: Partial<TaskProgress> & { taskId: string }): TaskProgress {
  return {
    status: 'succeeded',
    progressPercent: 100,
    requestSnapshot: { prompt: 'x', mode: 't2v', aspectRatio: '16:9', provider: 'fixture-local' },
    createdAt: 0,
    ...overrides,
  };
}

function log(overrides: Partial<EventLogEntry> & { id: number; ts: number }): EventLogEntry {
  return {
    method: 'POST',
    path: '/api/generate',
    ...overrides,
  };
}

/** 固定"现在"：2026-09-23 15:00 本地时间 */
const NOW = new Date(2026, 8, 23, 15, 0, 0).getTime();
const HOUR = 3_600_000;

describe('startOfToday · 本地时区的日界', () => {
  it('返回当天 0:00 的时间戳（本地时区）', () => {
    const start = new Date(startOfToday(NOW));
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(startOfToday(NOW)).toBeLessThanOrEqual(NOW);
  });
});

describe('computeOverviewStats · 四卡口径', () => {
  it('空列表：今日 0、成功率为 null（不是 0——"还没有数据"与"全失败"是两回事）', () => {
    const stats = computeOverviewStats([], EMPTY_STORAGE, NOW);
    expect(stats.todayCount).toBe(0);
    expect(stats.successRate).toBeNull();
    expect(stats.settledCount).toBe(0);
    expect(stats.inFlight).toBe(0);
  });

  it('全失败：成功率 0（分母是终态任务数）', () => {
    const stats = computeOverviewStats(
      [
        task({ taskId: 'a', status: 'failed', createdAt: NOW - HOUR }),
        task({ taskId: 'b', status: 'failed', createdAt: NOW - HOUR }),
      ],
      EMPTY_STORAGE,
      NOW,
    );
    expect(stats.successRate).toBe(0);
    expect(stats.settledCount).toBe(2);
  });

  it('混合：成功率 = 成功 / 终态；进行中的任务**不进分母**', () => {
    const stats = computeOverviewStats(
      [
        task({ taskId: 'ok1', createdAt: NOW - HOUR }),
        task({ taskId: 'ok2', createdAt: NOW - 2 * HOUR }),
        task({ taskId: 'bad', status: 'failed', createdAt: NOW - HOUR }),
        task({ taskId: 'run', status: 'running', progressPercent: 40, createdAt: NOW }),
        task({ taskId: 'queued', status: 'queued', progressPercent: 0, createdAt: NOW }),
      ],
      EMPTY_STORAGE,
      NOW,
    );
    expect(stats.settledCount).toBe(3);
    expect(stats.successRate).toBeCloseTo(2 / 3, 5);
    expect(stats.inFlight).toBe(2);
  });

  it('今日计数按本地日界：昨天 23:59 不算、今天 00:00 算', () => {
    const dayStart = startOfToday(NOW);
    const stats = computeOverviewStats(
      [
        task({ taskId: 'yesterday', createdAt: dayStart - 1 }),
        task({ taskId: 'midnight', createdAt: dayStart }),
        task({ taskId: 'noon', createdAt: NOW }),
      ],
      EMPTY_STORAGE,
      NOW,
    );
    expect(stats.todayCount).toBe(2);
  });

  it('存储占用原样透传目录聚合（不在这里做换算/取整）', () => {
    const storage: StorageUsage = {
      totalBytes: 3_000,
      videoBytes: 2_000,
      videoCount: 2,
      thumbBytes: 400,
      assetBytes: 600,
      assetCount: 3,
    };
    const stats = computeOverviewStats([], storage, NOW);
    expect(stats.storage).toEqual(storage);
  });
});

describe('recentShots · 最近成片', () => {
  it('只要 succeeded 且有成片地址；按时间降序；上限生效', () => {
    const items = [
      task({ taskId: 'old', createdAt: 100, outputVideoUrl: '/media/old.mp4' }),
      task({ taskId: 'new', createdAt: 300, outputVideoUrl: '/media/new.mp4' }),
      task({ taskId: 'mid', createdAt: 200, outputVideoUrl: '/media/mid.mp4' }),
      task({ taskId: 'failed', status: 'failed', createdAt: 400 }),
      task({ taskId: 'no-url', createdAt: 500 }),
    ];
    const shots = recentShots(items, 2);
    expect(shots.map((shot) => shot.taskId)).toEqual(['new', 'mid']);
  });

  it('时长文案来自请求快照的 durationSec；没有就省略（不编造）', () => {
    const shots = recentShots([
      task({
        taskId: 'with-duration',
        createdAt: 1,
        outputVideoUrl: '/media/a.mp4',
        requestSnapshot: {
          prompt: 'x',
          mode: 'i2v',
          aspectRatio: '16:9',
          provider: 'fixture-local',
          params: { durationSec: 8 },
        },
      }),
      task({ taskId: 'plain', createdAt: 2, outputVideoUrl: '/media/b.mp4' }),
    ]);
    expect(shots.find((shot) => shot.taskId === 'with-duration')?.durationLabel).toBe('8s');
    expect(shots.find((shot) => shot.taskId === 'plain')?.durationLabel).toBeUndefined();
  });
});

describe('buildActivityFeed · 最近操作', () => {
  const label = (action: string | undefined): string => action ?? '未知';

  it('按时间降序、取前 N 条', () => {
    const feed = buildActivityFeed(
      [
        log({ id: 1, ts: 100, action: 'a' }),
        log({ id: 2, ts: 300, action: 'b' }),
        log({ id: 3, ts: 200, action: 'c' }),
      ],
      label,
      2,
    );
    expect(feed.map((entry) => entry.id)).toEqual([2, 3]);
    expect(feed[0]?.label).toBe('b');
  });

  it('色点口径：5xx=bad、4xx=warn、2xx=ok、有错误码时按状态码归类', () => {
    const feed = buildActivityFeed(
      [
        log({ id: 1, ts: 1, statusCode: 200 }),
        log({ id: 2, ts: 2, statusCode: 429 }),
        log({ id: 3, ts: 3, statusCode: 500 }),
        log({ id: 4, ts: 4, statusCode: 429, errorCode: 'RATE_LIMITED' }),
        log({ id: 5, ts: 5, errorCode: 'UPSTREAM_ERROR' }),
      ],
      label,
    );
    const toneOf = (id: number): string | undefined => feed.find((entry) => entry.id === id)?.tone;
    expect(toneOf(1)).toBe('ok');
    expect(toneOf(2)).toBe('warn');
    expect(toneOf(3)).toBe('bad');
    expect(toneOf(4)).toBe('warn');
    // 没有状态码但有错误码：按"最坏"处理（这是失败请求）
    expect(toneOf(5)).toBe('bad');
  });
});

describe('formatBytes / formatRelativeTime', () => {
  it('字节 → 人类可读（MB 以下不给小数）', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(512 * 1024 * 1024)).toBe('512 MB');
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB');
  });

  it('相对时间：刚刚 / 分钟 / 小时 / 具体日期', () => {
    expect(formatRelativeTime(NOW - 10_000, NOW)).toBe('刚刚');
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe('5 分钟前');
    expect(formatRelativeTime(NOW - 3 * HOUR, NOW)).toBe('3 小时前');
    expect(formatRelativeTime(NOW - 30 * HOUR, NOW)).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});
