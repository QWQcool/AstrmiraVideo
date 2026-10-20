import { taskOutput, type TaskProgress } from '@astrmira/shared';
import type { MessageKey } from './i18n';

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
/** S5-A：媒体类型筛选；音频目前只可能来自上传资产，不在生成历史里造空行 */
export type LibraryKindFilter = 'all' | 'image' | 'video' | 'audio';

export interface LibraryFilterOptions {
  query: string;
  status: LibraryStatusFilter;
  sort: LibrarySort;
  /** 缺省 = all（老调用方/测试行为不变） */
  kind?: LibraryKindFilter;
}

/**
 * 排序 / 筛选取值的**键表**（语言迁移第十二批）。
 *
 * 为什么不在这里写文案：这里是模块级常量，**在模块加载那一刻就把语言定死**；
 * 而这两个下拉/ chips 要在渲染那一刻取文案。所以只留"取值 → 键"的映射，
 * 显示名由视图用 `t(LIBRARY_SORT_LABEL_KEYS[key])` 取（与 `lib/format.ts` 的
 * `STATUS_LABEL_KEYS` 同一手法）。
 *
 * ⚠️ 键的**顺序**就是界面上的顺序（`Object.keys` 直接用来渲染）—— 别随意重排。
 */
export const LIBRARY_SORT_LABEL_KEYS: Record<LibrarySort, MessageKey> = {
  'time-desc': 'library.sort.timeDesc',
  'time-asc': 'library.sort.timeAsc',
  'size-desc': 'library.sort.sizeDesc',
};

export const LIBRARY_STATUS_LABEL_KEYS: Record<LibraryStatusFilter, MessageKey> = {
  all: 'library.statusFilter.all',
  succeeded: 'library.statusFilter.succeeded',
  failed: 'library.statusFilter.failed',
  active: 'library.statusFilter.active',
};

function matchesKind(task: TaskProgress, kind: LibraryKindFilter): boolean {
  if (kind === 'all') return true;
  const output = taskOutput(task);
  return output.kind === kind;
}

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
    if (!matchesKind(task, options.kind ?? 'all')) return false;
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
  return (
    options.query.trim() !== '' ||
    options.status !== 'all' ||
    (options.kind ?? 'all') !== 'all'
  );
}
