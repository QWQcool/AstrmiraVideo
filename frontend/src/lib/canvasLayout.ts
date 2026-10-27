import type { CanvasDoc } from '@astrmira/shared';

/**
 * V2.84（D-5）：**自动排版**（整理画布）。
 *
 * 规则只有一条：**按依赖层级分列**。上游在第 0 列，下游往右排；
 * 同层按当前 y 排序（保序，视觉上不会每次整理都大幅跳动）。
 *
 * 为什么不做力导（force-directed）：那种布局每次结果都不一样，用户"整理完"找不到刚才那张图；
 * 有向无环图的层级布局是确定的 —— 同一份文档整理两次得到同一个结果。
 */

/** 列间距（横向） */
export const LAYOUT_GAP_X = 90;
/** 行间距（纵向） */
export const LAYOUT_GAP_Y = 48;

export interface CanvasLayoutMove {
  id: string;
  x: number;
  y: number;
}

/**
 * 计算整理后的位置（纯函数，不返回新文档：调用方用 `moveCanvasNodes` 落盘）。
 *
 * 环不会被"修好"：成环的那些节点按剩余入度不足处理，落到最后一层 —— 排版不对数据做任何承诺。
 */
export function layoutCanvasNodes(doc: CanvasDoc): CanvasLayoutMove[] {
  const nodes = doc.nodes;
  if (nodes.length === 0) return [];

  const ids = new Set(nodes.map((node) => node.id));
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const node of nodes) {
    outgoing.set(node.id, []);
    indegree.set(node.id, 0);
  }
  for (const edge of doc.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) continue;
    const from = outgoing.get(edge.from);
    if (from === undefined || from.includes(edge.to)) continue;
    from.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  /** 层级：Kahn 分层（同一批入度归零的同时出队 = 同一层） */
  const level = new Map<string, number>();
  let frontier = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  for (const id of frontier) level.set(id, 0);
  let depth = 0;
  while (frontier.length > 0 && depth < nodes.length) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const child of outgoing.get(id) ?? []) {
        const remaining = (indegree.get(child) ?? 0) - 1;
        indegree.set(child, remaining);
        if (remaining === 0) {
          level.set(child, depth + 1);
          next.push(child);
        }
      }
    }
    frontier = next;
    depth += 1;
  }
  // 环里的节点没被分层：统一放到最右一列，至少不会叠在一起
  for (const node of nodes) {
    if (!level.has(node.id)) level.set(node.id, depth);
  }

  const columns = new Map<number, typeof nodes>();
  for (const node of nodes) {
    const column = level.get(node.id) ?? 0;
    const list = columns.get(column) ?? [];
    list.push(node);
    columns.set(column, list);
  }

  const moves: CanvasLayoutMove[] = [];
  const sortedColumns = [...columns.entries()].sort((left, right) => left[0] - right[0]);
  for (const [column, list] of sortedColumns) {
    // 同层按现有 y 保序：整理只动"层"，不打乱用户自己的上下关系
    const ordered = [...list].sort((left, right) => left.layout.y - right.layout.y);
    const columnWidth = Math.max(...ordered.map((node) => node.layout.width), 320);
    const x = column * (columnWidth + LAYOUT_GAP_X);
    let y = 0;
    for (const node of ordered) {
      moves.push({ id: node.id, x, y });
      y += node.layout.height + LAYOUT_GAP_Y;
    }
  }
  return moves;
}
