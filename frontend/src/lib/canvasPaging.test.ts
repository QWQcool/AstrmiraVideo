import { describe, expect, it } from 'vitest';
import type { TaskProgress, VideoGenerateRequest } from '@astrmira/shared';
import { combineHasMore, mergeCanvasTasks, oldestCreatedAt } from './canvasPaging';

/**
 * 画布分页纯函数单测（V2.25 / 台账 B44）。
 *
 * 分页的正确性全在**边界**上：重复（同一任务出现在两页）、跳漏（游标算错）、
 * `hasMore` 说谎（多骗用户点一次空的 / 提前置灰）。三件都在这里钉住。
 */

const SNAPSHOT: VideoGenerateRequest = {
  prompt: '雨夜街头',
  mode: 't2v',
  aspectRatio: '16:9',
  provider: 'cloud-volcano-seedance',
};

function task(taskId: string, createdAt: number): TaskProgress {
  return { taskId, createdAt, status: 'succeeded', progressPercent: 100, requestSnapshot: SNAPSHOT };
}

describe('mergeCanvasTasks · 合并去重与排序', () => {
  it('按 createdAt 倒序（与后端 ORDER BY created_at DESC 对齐）', () => {
    const merged = mergeCanvasTasks([task('a', 100)], [task('c', 300), task('b', 200)]);
    expect(merged.map((item) => item.taskId)).toEqual(['c', 'b', 'a']);
  });

  it('同一 taskId 只保留一份（**已有优先** —— 加载更早的批次里的重复不覆盖已加载的快照）', () => {
    const first = { ...task('dup', 200), progressPercent: 100 };
    const shadowed = { ...task('dup', 200), progressPercent: 1 };
    const merged = mergeCanvasTasks([first], [shadowed, task('older', 100)]);
    expect(merged).toHaveLength(2);
    expect(merged.find((item) => item.taskId === 'dup')?.progressPercent).toBe(100);
  });

  it('同毫秒时用 taskId 作次键 → 顺序确定（两次渲染不换位）', () => {
    const merged = mergeCanvasTasks([], [task('b', 500), task('a', 500)]);
    expect(merged.map((item) => item.taskId)).toEqual(['a', 'b']);
    const again = mergeCanvasTasks(merged, []);
    expect(again.map((item) => item.taskId)).toEqual(['a', 'b']);
  });

  it('空批次是恒等操作（既有项一个不少）', () => {
    const prev = [task('a', 100), task('b', 200)];
    expect(mergeCanvasTasks(prev, [])).toEqual(mergeCanvasTasks(prev, []));
    expect(mergeCanvasTasks(prev, [])).toHaveLength(2);
  });
});

describe('oldestCreatedAt · 游标', () => {
  it('取最旧一条的 createdAt（= 下一页的 before）', () => {
    expect(oldestCreatedAt([task('a', 300), task('b', 100), task('c', 200)])).toBe(100);
  });

  it('空数组 → null（没有下一页，按钮置灰的依据）', () => {
    expect(oldestCreatedAt([])).toBeNull();
  });

  it('游标语义自洽：用游标再取一批时，边界那条**不会**重复出现（created_at < before）', () => {
    const page1 = [task('a', 300), task('b', 200)];
    const cursor = oldestCreatedAt(page1);
    expect(cursor).toBe(200);
    // 后端语义是 `created_at < 200` → 严格更早的才出现（b 自己不在下一页）
    const page2 = [task('c', 199)];
    expect(page2.every((item) => item.createdAt < cursor!)).toBe(true);
  });
});

describe('combineHasMore · 两类来源取或', () => {
  it('只要还有一类能翻就能继续翻', () => {
    expect(combineHasMore(true, false)).toBe(true);
    expect(combineHasMore(false, true)).toBe(true);
  });

  it('两类都翻完才置灰', () => {
    expect(combineHasMore(false, false)).toBe(false);
  });
});
