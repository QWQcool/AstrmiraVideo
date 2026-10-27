import type { CanvasDoc, CanvasDocNode, CanvasGroup } from '@astrmira/shared';

/**
 * V2.81：画布分组（P3）。
 *
 * 设计只有一句：**组 = 一组节点 id + 一个标题**，矩形由成员包围盒算。
 * 这样拖动/改尺寸/撤销重做都不需要动组，也不会出现"框和节点分家"。
 *
 * 所有函数都是纯函数，且**没有变化时原样返回同一个 doc 引用**（避免触发无意义的保存）。
 */

/** 组框与成员之间的留白（像素） */
export const GROUP_PADDING = 24;
/** 组框顶部留给标题条的高度（画在包围盒之上） */
export const GROUP_HEADER = 28;

export interface CanvasGroupBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 成员节点的包围盒（含标题条与内边距）；没有成员时返回 null（界面据此不画框） */
export function canvasGroupBounds(
  group: CanvasGroup,
  nodes: readonly CanvasDocNode[],
): CanvasGroupBounds | null {
  const members = new Set(group.nodeIds);
  const picked = nodes.filter((node) => members.has(node.id));
  if (picked.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of picked) {
    minX = Math.min(minX, node.layout.x);
    minY = Math.min(minY, node.layout.y);
    maxX = Math.max(maxX, node.layout.x + node.layout.width);
    maxY = Math.max(maxY, node.layout.y + node.layout.height);
  }

  return {
    x: minX - GROUP_PADDING,
    y: minY - GROUP_PADDING - GROUP_HEADER,
    width: maxX - minX + GROUP_PADDING * 2,
    height: maxY - minY + GROUP_PADDING * 2 + GROUP_HEADER,
  };
}

/** 某个节点属于哪个组（一个节点只属于一个组：多归属会让"删除组"变成有歧义的操作） */
export function groupForNode(doc: CanvasDoc, nodeId: string): CanvasGroup | undefined {
  return (doc.groups ?? []).find((group) => group.nodeIds.includes(nodeId));
}

export function createCanvasGroup(
  doc: CanvasDoc,
  input: { id: string; title: string; nodeIds: readonly string[]; color?: string },
  now: number = Date.now(),
): CanvasDoc {
  const ids = [...new Set(input.nodeIds)];
  if (ids.length === 0) return doc;
  const existing = doc.groups ?? [];
  const group: CanvasGroup = {
    id: input.id,
    title: input.title,
    nodeIds: ids,
    createdAt: now,
    ...(input.color === undefined ? {} : { color: input.color }),
  };
  return { ...doc, groups: [...existing, group], updatedAt: now };
}

export function renameCanvasGroup(
  doc: CanvasDoc,
  groupId: string,
  title: string,
  now: number = Date.now(),
): CanvasDoc {
  const trimmed = title.trim();
  if (trimmed === '') return doc;
  let changed = false;
  const groups = (doc.groups ?? []).map((group) => {
    if (group.id !== groupId || group.title === trimmed) return group;
    changed = true;
    return { ...group, title: trimmed };
  });
  return changed ? { ...doc, groups, updatedAt: now } : doc;
}

/** 解散分组：**只删组，不删节点**（这正是分组与"合并"的区别） */
export function removeCanvasGroup(
  doc: CanvasDoc,
  groupId: string,
  now: number = Date.now(),
): CanvasDoc {
  const existing = doc.groups ?? [];
  const groups = existing.filter((group) => group.id !== groupId);
  if (groups.length === existing.length) return doc;
  return { ...doc, groups, updatedAt: now };
}

/** 往组里增删成员（同一节点会先从别的组里摘掉，保证"一个节点只属于一个组"） */
export function setCanvasGroupMembers(
  doc: CanvasDoc,
  groupId: string,
  nodeIds: readonly string[],
  now: number = Date.now(),
): CanvasDoc {
  const wanted = new Set(nodeIds);
  const groups = (doc.groups ?? []).map((group) => {
    if (group.id === groupId) {
      return { ...group, nodeIds: [...wanted] };
    }
    const kept = group.nodeIds.filter((id) => !wanted.has(id));
    return kept.length === group.nodeIds.length ? group : { ...group, nodeIds: kept };
  });
  return { ...doc, groups, updatedAt: now };
}

/**
 * 收拾"成员已不存在"的组：删掉失效成员，成员清空的组整个移除。
 *
 * 什么时候需要：删除节点 / 外部导入 / 撤销后文档回退 —— 组不会自己知道成员没了。
 * 没有变化时返回同一个 doc。
 */
export function pruneCanvasGroups(doc: CanvasDoc, now: number = Date.now()): CanvasDoc {
  const existing = doc.groups ?? [];
  if (existing.length === 0) return doc;
  const alive = new Set(doc.nodes.map((node) => node.id));
  let changed = false;
  const groups: CanvasGroup[] = [];
  for (const group of existing) {
    const kept = group.nodeIds.filter((id) => alive.has(id));
    if (kept.length === group.nodeIds.length) {
      groups.push(group);
      continue;
    }
    changed = true;
    if (kept.length > 0) groups.push({ ...group, nodeIds: kept });
  }
  return changed ? { ...doc, groups, updatedAt: now } : doc;
}
