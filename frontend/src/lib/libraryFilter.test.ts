import { describe, expect, it } from 'vitest';
import type { TaskProgress } from '@astrmira/shared';
import { filterLibrary, hasActiveFilters } from './libraryFilter';

/**
 * 视频库筛选/排序的口径测试（V9 · B4 / Step 6-AC4）。
 *
 * 破坏性验证的落点也在这里：搜索一个不存在的词必须得到**空数组**（界面据此显示空态），
 * 而不是"原样返回全部"——后者是最容易写出来的那种 bug（忘记 return filter 的结果）。
 */

function task(overrides: Partial<TaskProgress> & { taskId: string }): TaskProgress {
  return {
    status: 'succeeded',
    progressPercent: 100,
    requestSnapshot: { prompt: '默认提示词', mode: 't2v', aspectRatio: '16:9', provider: 'fixture-local' },
    createdAt: 0,
    ...overrides,
  };
}

const OPTIONS = { query: '', status: 'all', sort: 'time-desc' } as const;

describe('filterLibrary · 搜索（提示词模糊）', () => {
  it('空列表 → 空结果', () => {
    expect(filterLibrary([], OPTIONS)).toEqual([]);
  });

  it('子串匹配且不区分大小写、两端空白被忽略', () => {
    const items = [
      task({ taskId: 'a', requestSnapshot: { prompt: '雨夜街头的霓虹', mode: 't2v', aspectRatio: '16:9', provider: 'fixture-local' } }),
      task({ taskId: 'b', requestSnapshot: { prompt: 'Warm LAMP on a desk', mode: 't2v', aspectRatio: '16:9', provider: 'fixture-local' } }),
    ];
    expect(filterLibrary(items, { ...OPTIONS, query: '霓虹' }).map((t) => t.taskId)).toEqual(['a']);
    expect(filterLibrary(items, { ...OPTIONS, query: '  lamp  ' }).map((t) => t.taskId)).toEqual(['b']);
  });

  it('搜不存在的词 → 空结果（界面据此显示空态，而不是"全部卡片"）', () => {
    const items = [task({ taskId: 'a' }), task({ taskId: 'b' })];
    expect(filterLibrary(items, { ...OPTIONS, query: '这个词不存在' })).toEqual([]);
  });
});

describe('filterLibrary · 状态筛选', () => {
  const items = [
    task({ taskId: 'ok', status: 'succeeded' }),
    task({ taskId: 'bad', status: 'failed' }),
    task({ taskId: 'cancel', status: 'cancelled' }),
    task({ taskId: 'run', status: 'running' }),
    task({ taskId: 'queued', status: 'queued' }),
  ];

  it('"失败"包含 cancelled（对用户而言都是"没出片"）', () => {
    expect(
      filterLibrary(items, { ...OPTIONS, status: 'failed' }).map((t) => t.taskId).sort(),
    ).toEqual(['bad', 'cancel']);
  });

  it('"进行中" = queued + running', () => {
    expect(
      filterLibrary(items, { ...OPTIONS, status: 'active' }).map((t) => t.taskId).sort(),
    ).toEqual(['queued', 'run']);
  });

  it('"全部"不淘汰任何一条', () => {
    expect(filterLibrary(items, OPTIONS).length).toBe(5);
  });
});

describe('filterLibrary · 排序', () => {
  it('时间倒序 / 正序', () => {
    const items = [
      task({ taskId: 'mid', createdAt: 200 }),
      task({ taskId: 'old', createdAt: 100 }),
      task({ taskId: 'new', createdAt: 300 }),
    ];
    expect(filterLibrary(items, { ...OPTIONS, sort: 'time-desc' }).map((t) => t.taskId)).toEqual([
      'new',
      'mid',
      'old',
    ]);
    expect(filterLibrary(items, { ...OPTIONS, sort: 'time-asc' }).map((t) => t.taskId)).toEqual([
      'old',
      'mid',
      'new',
    ]);
  });

  it('体积倒序：缺失体积的排最后（不是当 0 参与比较）', () => {
    const items = [
      task({ taskId: 'small', createdAt: 1, outputSizeBytes: 100 }),
      task({ taskId: 'none', createdAt: 999 }), // 没有体积（文件已删 / 旧记录）
      task({ taskId: 'big', createdAt: 2, outputSizeBytes: 9_000 }),
      task({ taskId: 'mid', createdAt: 3, outputSizeBytes: 500 }),
    ];
    expect(filterLibrary(items, { ...OPTIONS, sort: 'size-desc' }).map((t) => t.taskId)).toEqual([
      'big',
      'mid',
      'small',
      'none',
    ]);
  });

  it('体积倒序下"两者都没有体积"时保持时间倒序（顺序稳定，不随机）', () => {
    const items = [
      task({ taskId: 'no1', createdAt: 100 }),
      task({ taskId: 'no2', createdAt: 300 }),
      task({ taskId: 'has', createdAt: 1, outputSizeBytes: 10 }),
    ];
    expect(filterLibrary(items, { ...OPTIONS, sort: 'size-desc' }).map((t) => t.taskId)).toEqual([
      'has',
      'no2',
      'no1',
    ]);
  });
});

describe('hasActiveFilters · 空态文案要靠它区分"筛出来的空"与"真的没有"', () => {
  it('无筛选 → false；有任何一项 → true', () => {
    expect(hasActiveFilters(OPTIONS)).toBe(false);
    expect(hasActiveFilters({ ...OPTIONS, query: 'x' })).toBe(true);
    expect(hasActiveFilters({ ...OPTIONS, query: '   ' })).toBe(false);
    expect(hasActiveFilters({ ...OPTIONS, status: 'failed' })).toBe(true);
    // 排序不算"筛选"：它不会把结果集变空
    expect(hasActiveFilters({ ...OPTIONS, sort: 'size-desc' })).toBe(false);
  });
});
