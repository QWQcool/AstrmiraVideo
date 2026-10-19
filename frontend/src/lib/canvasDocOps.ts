import {
  createCanvasNode,
  type CanvasDoc,
  type CanvasDocNode,
  type CanvasNodeType,
} from '@astrmira/shared';

/**
 * 画布文档的纯编辑操作（Step 11-S3 片 B2）。
 *
 * 全部返回**新文档**、不改入参：撤销栈/自动保存都靠"前后两份快照"，原地改会让两者指向同一对象。
 *
 * 三条口径：
 * 1. **删节点不删资产**：这里只动文档，产物仍在存储里（与设计基准 §4-D 一致）；
 * 2. **删节点连带删边**：留下悬空边，画布会画出"指向空气"的线；
 * 3. **标题按类型递增**（图片 1、图片 2…）—— 与实测产品一致，且不依赖节点 id。
 */

export function canvasNodeTitle(
  doc: CanvasDoc,
  type: CanvasNodeType,
  labelOf: Record<CanvasNodeType, string>,
): string {
  const prefix = labelOf[type];
  const used = new Set(doc.nodes.map((n) => n.data.title).filter((t): t is string => !!t));
  let i = 1;
  while (used.has(`${prefix} ${i}`)) i += 1;
  return `${prefix} ${i}`;
}

export function addCanvasNode(
  doc: CanvasDoc,
  input: {
    id: string;
    type: CanvasNodeType;
    x: number;
    y: number;
    title: string;
    now?: number;
  },
): { doc: CanvasDoc; node: CanvasDocNode } {
  const node = createCanvasNode({
    id: input.id,
    type: input.type,
    x: input.x,
    y: input.y,
    title: input.title,
    createdFrom: 'menu',
    now: input.now,
  });
  return { doc: { ...doc, nodes: [...doc.nodes, node], updatedAt: input.now ?? Date.now() }, node };
}

/** 拖动只改 layout（执行依赖在 edges 里，不受位置影响） */
export function moveCanvasNode(
  doc: CanvasDoc,
  nodeId: string,
  position: { x: number; y: number },
  now: number = Date.now(),
): CanvasDoc {
  let changed = false;
  const nodes = doc.nodes.map((node) => {
    if (node.id !== nodeId) return node;
    if (node.layout.x === position.x && node.layout.y === position.y) return node;
    changed = true;
    return { ...node, layout: { ...node.layout, x: position.x, y: position.y } };
  });
  return changed ? { ...doc, nodes, updatedAt: now } : doc;
}

/** 删节点：连带清掉悬空边（否则画布会画出指向空气的线） */
export function removeCanvasNode(
  doc: CanvasDoc,
  nodeId: string,
  now: number = Date.now(),
): CanvasDoc {
  const nodes = doc.nodes.filter((n) => n.id !== nodeId);
  if (nodes.length === doc.nodes.length) return doc;
  const edges = doc.edges.filter((e) => e.from !== nodeId && e.to !== nodeId);
  return { ...doc, nodes, edges, updatedAt: now };
}

export function renameCanvasDoc(doc: CanvasDoc, name: string, now: number = Date.now()): CanvasDoc {
  const trimmed = name.trim();
  if (trimmed === '' || trimmed === doc.name) return doc;
  return { ...doc, name: trimmed, updatedAt: now };
}

export function canvasDocCounts(doc: CanvasDoc): { nodes: number; edges: number } {
  return { nodes: doc.nodes.length, edges: doc.edges.length };
}

/** 新建节点的落点：已有节点右下方错开一格，避免叠在同一处 */
export function nextCanvasNodePosition(doc: CanvasDoc): { x: number; y: number } {
  if (doc.nodes.length === 0) return { x: 0, y: 0 };
  const maxX = Math.max(...doc.nodes.map((n) => n.layout.x));
  const maxY = Math.max(...doc.nodes.map((n) => n.layout.y));
  const row = doc.nodes.length % 3;
  return { x: maxX + 360, y: maxY - row * 40 };
}
