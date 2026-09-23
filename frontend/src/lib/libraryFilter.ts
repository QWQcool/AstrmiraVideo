import type { TaskProgress } from '@astrmira/shared';

/**
 * 视频库的筛选与排序（V9 · B4，纯函数 + 单测）。
 *
 * 三条口径：
 * 1. **搜索是"提示词模糊"**：对 `requestSnapshot.prompt` 做不区分大小写的子串匹配，
 *    并在两端 trim（用户复制粘贴常带空格，那不应该是"搜不到"的原因）；
 * 2. **"失败"包含 `cancelled`**：对用户而言"没出片"就是失败（与"成功"互斥且穷尽）；
 *    "进行中" = `queued` + `running`；
 * 3. **体积排序把"没有体积"排最后**：文件已被清理的任务没有 `outputSizeBytes`，
 *    它们既不是"最大的"也不是"最小的"——放到末尾且不参与大小比较，如实呈现。
 */

export type LibrarySort = 'time-desc' | 'time-asc' | 'size-desc';
export type LibraryStatusFilter = 'all' | 'succeeded' | 'failed' | 'active';

export interface LibraryFilterOptions {
  query: string;
  status: LibraryStatusFilter;
  sort: LibrarySort;
}

export const LIBRARY_SORT_LABELS: Record<LibrarySort, string> = {
  'time-desc': '按时间（新→旧）',
  'time-asc': '按时间（旧→新）',
  'size-desc': '按文件大小（大→小）',
};

export const LIBRARY_STATUS_LABELS: Record<LibraryStatusFilter, string> = {
  all: '全部',
  succeeded: '成功',
  failed: '失败',
  active: '进行中',
};

function matchesStatus(task: TaskProgress, status: LibraryStatusFilter): boolean {
  switch (status) {
    case 'all':
      return true;
    case 'succeeded':
      return task.status === 'succeeded';
    case 'failed':
      // 对用户而言"取消"与"失败"是同一类：都没有成片
      return task.status === 'failed' || task.status === 'cancelled';
    case 'active':
      return task.status === 'queued' || task.status === 'running';
  }
}

export function filterLibrary(
  items: readonly TaskProgress[],
  options: LibraryFilterOptions,
): TaskProgress[] {
  const needle = options.query.trim().toLowerCase();

  const filtered = items.filter((task) => {
    if (!matchesStatus(task, options.status)) return false;
    if (needle === '') return true;
    return task.requestSnapshot.prompt.toLowerCase().includes(needle);
  });

  const sorted = filtered.slice();
  sorted.sort((a, b) => {
    switch (options.sort) {
      case 'time-desc':
        return b.createdAt - a.createdAt;
      case 'time-asc':
        return a.createdAt - b.createdAt;
      case 'size-desc': {
        const left = a.outputSizeBytes;
        const right = b.outputSizeBytes;
        // 没有体积的排最后（两者都没有时保持时间倒序，避免顺序随机）
        if (left === undefined && right === undefined) return b.createdAt - a.createdAt;
        if (left === undefined) return 1;
        if (right === undefined) return -1;
        return right - left;
      }
    }
  });

  return sorted;
}

/** 是否有任何筛选条件生效（"空态文案"要说清是筛出来的空还是真的没有） */
export function hasActiveFilters(options: LibraryFilterOptions): boolean {
  return options.query.trim() !== '' || options.status !== 'all';
}
