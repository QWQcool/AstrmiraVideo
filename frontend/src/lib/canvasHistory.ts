import type { CanvasDoc, CanvasDocNode } from '@astrmira/shared';

/**
 * 画布撤销栈（Step 11-S3 片 B3；CONTRACT §21-10）。
 *
 * ## 三条口径
 * 1. **只记编辑动作**：新建/删除/复制/粘贴/拖动/草稿。批次与任务状态是**服务端事实**，
 *    由轮询写回，不参与撤销 —— 撤销不会取消一个已经提交的任务。
 * 2. **恢复快照时，幸存节点的批次以当前文档为准**：否则撤销一次"改提示词"会把 2 秒前
 *    刚写回的产物状态一起回滚（用户看到进度倒退）。
 * 3. **内存栈、刷新即清**：与服务端文档为准一致（不做 localStorage，避免两份"当前状态"）。
 *
 * 栈深默认 50：再多也不会有人一路 Ctrl+Z 回 50 步以前，而每份快照都是整份文档。
 */

export const CANVAS_HISTORY_LIMIT = 50;

/** 同一合并键（如同一节点的提示词输入）在这个窗口内的连续修改算一步 */
export const CANVAS_HISTORY_COALESCE_MS = 1000;

export interface CanvasHistory {
  past: CanvasDoc[];
  future: CanvasDoc[];
  /** 上一次记录的合并键（打字时用来把连续击键并成一步） */
  lastKey?: string;
  lastAt: number;
}

export function createCanvasHistory(): CanvasHistory {
  return { past: [], future: [], lastAt: 0 };
}

export interface RecordCanvasHistoryOptions {
  /** 同一 key 在 `CANVAS_HISTORY_COALESCE_MS` 内的连续修改不各自入栈 */
  coalesceKey?: string;
  now?: number;
  limit?: number;
}

/**
 * 在**改动发生前**记下旧文档。返回新的栈（不修改入参）。
 *
 * 任何新编辑都会清空 `future`（重做分支失效）—— 与所有编辑器一致。
 */
export function recordCanvasHistory(
  history: CanvasHistory,
  before: CanvasDoc,
  options: RecordCanvasHistoryOptions = {},
): CanvasHistory {
  const now = options.now ?? Date.now();
  const limit = options.limit ?? CANVAS_HISTORY_LIMIT;
  const key = options.coalesceKey;

  const merge =
    key !== undefined && history.lastKey === key && now - history.lastAt <= CANVAS_HISTORY_COALESCE_MS;

  if (merge) {
    return history.future.length === 0 ? { ...history, lastAt: now } : { ...history, future: [], lastAt: now };
  }

  const past = [...history.past, before];
  return {
    past: past.length > limit ? past.slice(past.length - limit) : past,
    future: [],
    ...(key === undefined ? {} : { lastKey: key }),
    lastAt: now,
  };
}

export function canUndoCanvas(history: CanvasHistory): boolean {
  return history.past.length > 0;
}

export function canRedoCanvas(history: CanvasHistory): boolean {
  return history.future.length > 0;
}

/**
 * 把快照恢复成当前文档：**幸存节点的批次取当前值**（见文件头第 2 条）。
 *
 * 被撤销掉的节点（快照里没有、当前有）自然消失；被恢复的节点用它自己在快照里的批次
 * （这是唯一能拿到的数据 —— 那个节点当前已经不存在了）。
 */
export function restoreCanvasHistoryDoc(
  target: CanvasDoc,
  current: CanvasDoc,
  now: number = Date.now(),
): CanvasDoc {
  const currentById = new Map(current.nodes.map((node) => [node.id, node]));
  const nodes = target.nodes.map((node) => {
    const live = currentById.get(node.id);
    if (live === undefined) return node;
    if (live.data.batches === node.data.batches) return node;
    return { ...node, data: { ...node.data, batches: live.data.batches } };
  });
  return { ...target, nodes, updatedAt: now };
}

export function undoCanvasHistory(
  history: CanvasHistory,
  current: CanvasDoc,
  now: number = Date.now(),
): { doc: CanvasDoc; history: CanvasHistory } | null {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return null;
  const future = [current, ...history.future].slice(0, CANVAS_HISTORY_LIMIT);
  return {
    doc: restoreCanvasHistoryDoc(previous, current, now),
    history: { past: history.past.slice(0, -1), future, lastAt: 0 },
  };
}

export function redoCanvasHistory(
  history: CanvasHistory,
  current: CanvasDoc,
  now: number = Date.now(),
): { doc: CanvasDoc; history: CanvasHistory } | null {
  const next = history.future[0];
  if (next === undefined) return null;
  const past = [...history.past, current].slice(-CANVAS_HISTORY_LIMIT);
  return {
    doc: restoreCanvasHistoryDoc(next, current, now),
    history: { past, future: history.future.slice(1), lastAt: 0 },
  };
}

/** 剪贴板里的节点（只存内存；深拷贝在 `cloneCanvasNode` 里做） */
export type CanvasClipboard = readonly CanvasDocNode[];
