import type { TaskProgress } from '@astrmira/shared';

/**
 * 画布分页（V2.25 / 台账 B44 画布规模与性能；契约 = CONTRACT §5 的 `?limit=` / `?before=` / `hasMore`）。
 *
 * ## 为什么需要它
 * 血缘画布原先一次性拿"最近 50 条"（服务端写死），而 **L3 可编排（A5）意味着节点数不再受这个
 * 上限约束** —— 分页把"能看多少"变成用户可主动推进的能力（「加载更早」按钮）。
 *
 * ## 为什么抽成纯函数
 * 分页的正确性全在"边界与游标"上（重复 / 跳漏 / `hasMore` 说谎），而这三点都能在纯函数里
 * 完整测出来；组件只留 state 与按钮（本仓前端没有 jsdom，这是唯一廉价的覆盖方式）。
 *
 * ## 三条口径
 * 1. **游标 = 本批最旧的 `createdAt`**，与后端排序键（`created_at DESC`）同源 —— 翻页边界
 *    是 `created_at < before`，既不重复也不跳漏；
 * 2. **合并按 `taskId` 去重且"已有优先"**：加载更早的数据里若出现已经拿到的任务
 *    （翻页期间任务被更新 / 边界同毫秒），保留**第一次拿到的快照** —— 它来自更早的请求，
 *    但任务数据本身是"终态即不变"的（进度类字段由轮询负责），不存在"旧覆盖新"的问题；
 * 3. **`hasMore` 取"或"**：画布的数据来自两类查询（生成产物 + 剪辑产物），只要还有一类能翻，
 *    就还能继续往前翻（各自翻完才会置灰）。
 */

/**
 * 合并两批任务：按 `taskId` 去重（**已有优先**）+ 按 `createdAt` 倒序。
 *
 * 倒序与后端 `ORDER BY created_at DESC` 对齐；同毫秒时用 `taskId` 作次键，
 * 让顺序**确定**（否则"同一毫秒的两条"在两次渲染间可能换位）。
 */
export function mergeCanvasTasks(prev: TaskProgress[], next: TaskProgress[]): TaskProgress[] {
  const byId = new Map<string, TaskProgress>();
  for (const task of prev) byId.set(task.taskId, task);
  for (const task of next) {
    if (!byId.has(task.taskId)) byId.set(task.taskId, task);
  }
  return [...byId.values()].sort(
    (a, b) => b.createdAt - a.createdAt || a.taskId.localeCompare(b.taskId),
  );
}

/** 本批最旧的 `createdAt` = 下一页的游标（`before`）；空数组 → `null`（没有下一页） */
export function oldestCreatedAt(tasks: TaskProgress[]): number | null {
  if (tasks.length === 0) return null;
  return tasks.reduce((min, task) => (task.createdAt < min ? task.createdAt : min), tasks[0]!.createdAt);
}

/** 两类来源（生成 / 剪辑）各自的 `hasMore` → 只要还有一类能翻就还能继续翻 */
export function combineHasMore(...flags: boolean[]): boolean {
  return flags.some(Boolean);
}
