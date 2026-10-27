import { describe, expect, it } from 'vitest';
import { createCanvasNode, createEmptyCanvasDoc, type CanvasDoc } from '@astrmira/shared';
import {
  addCanvasNode,
  canvasDocCounts,
  canvasNodeTitle,
  moveCanvasNode,
  moveCanvasNodes,
  nextCanvasNodePosition,
  removeCanvasNode,
  renameCanvasDoc,
} from './canvasDocOps';

const LABELS = { text: '文本', image: '图片', video: '视频', audio: '音频' } as const;

function docWithTwo(): CanvasDoc {
  const doc = createEmptyCanvasDoc('p1', '客厅广告', 100);
  doc.nodes = [
    createCanvasNode({ id: 'n1', type: 'image', x: 0, y: 0, title: '图片 1' }),
    createCanvasNode({ id: 'n2', type: 'video', x: 400, y: 0, title: '视频 1' }),
  ];
  doc.edges = [
    { id: 'e1', from: 'n1', to: 'n2', kind: 'lineage' },
    { id: 'e2', from: 'n2', to: 'n-other', kind: 'dependency' },
  ];
  return doc;
}

describe('canvasDocOps', () => {
  it('加节点：追加、给标题、更新时间，且不改原文档', () => {
    const doc = createEmptyCanvasDoc('p1', 'x', 1);
    const { doc: next, node } = addCanvasNode(doc, {
      id: 'n1',
      type: 'image',
      x: 10,
      y: 20,
      title: '图片 1',
      now: 50,
    });
    expect(doc.nodes).toHaveLength(0);
    expect(next.nodes).toHaveLength(1);
    expect(next.updatedAt).toBe(50);
    expect(node.layout).toMatchObject({ x: 10, y: 20 });
    expect(node.data.batches).toEqual([]);
  });

  it('标题按类型递增，不被已有节点占位', () => {
    const doc = docWithTwo();
    expect(canvasNodeTitle(doc, 'image', LABELS)).toBe('图片 2');
    expect(canvasNodeTitle(doc, 'video', LABELS)).toBe('视频 2');
    expect(canvasNodeTitle(doc, 'audio', LABELS)).toBe('音频 1');
  });

  it('拖动只改 layout；位置没变时返回原对象（避免无谓的脏标记）', () => {
    const doc = docWithTwo();
    const moved = moveCanvasNode(doc, 'n1', { x: 123, y: 456 }, 200);
    expect(moved.nodes[0].layout).toMatchObject({ x: 123, y: 456 });
    expect(moved.edges).toEqual(doc.edges);
    expect(moveCanvasNode(doc, 'n1', { x: 0, y: 0 })).toBe(doc);
  });

  it('删节点：连带删掉与它相连的边，保留无关的边', () => {
    const doc = docWithTwo();
    const next = removeCanvasNode(doc, 'n2', 300);
    expect(next.nodes.map((n) => n.id)).toEqual(['n1']);
    // e1 与 n2 相连、e2 从 n2 出发 → 都该消失
    expect(next.edges).toEqual([]);
    expect(next.updatedAt).toBe(300);
  });

  it('删不存在的节点：原样返回', () => {
    const doc = docWithTwo();
    expect(removeCanvasNode(doc, 'ghost')).toBe(doc);
  });

  it('重命名：去空白；空名或同名不改', () => {
    const doc = docWithTwo();
    expect(renameCanvasDoc(doc, '  新名字 ', 400).name).toBe('新名字');
    expect(renameCanvasDoc(doc, '   ')).toBe(doc);
    expect(renameCanvasDoc(doc, '客厅广告')).toBe(doc);
  });

  it('计数与落点：空文档从原点开始；有节点时向右错开', () => {
    expect(canvasDocCounts(docWithTwo())).toEqual({ nodes: 2, edges: 2 });
    expect(nextCanvasNodePosition(createEmptyCanvasDoc('p', 'x'))).toEqual({ x: 0, y: 0 });
    const pos = nextCanvasNodePosition(docWithTwo());
    expect(pos.x).toBeGreaterThan(400);
  });
});

/** V2.83（D-4）：拖分组框 = 一次移动多个节点（撤销栈里一步，不是 N 步） */
describe('moveCanvasNodes（批量平移）', () => {
  const withNodes = (): CanvasDoc => {
    const doc = createEmptyCanvasDoc('p1', '分组演示', 100);
    doc.nodes = [
      createCanvasNode({ id: 'a', type: 'image', x: 0, y: 0 }),
      createCanvasNode({ id: 'b', type: 'image', x: 400, y: 50 }),
      createCanvasNode({ id: 'c', type: 'image', x: 900, y: 0 }),
    ];
    return doc;
  };

  it('按 delta 平移选中的节点，未列出的节点原地不动', () => {
    const moved = moveCanvasNodes(withNodes(), [
      { id: 'a', x: 10, y: 20 },
      { id: 'b', x: 410, y: 70 },
    ]);
    expect(moved.nodes.map((node) => [node.id, node.layout.x, node.layout.y])).toEqual([
      ['a', 10, 20],
      ['b', 410, 70],
      ['c', 900, 0],
    ]);
  });

  it('没有实际位移 → 返回同一个 doc 引用（不写一次空的保存）', () => {
    const doc = withNodes();
    expect(moveCanvasNodes(doc, [{ id: 'a', x: 0, y: 0 }])).toBe(doc);
    expect(moveCanvasNodes(doc, [])).toBe(doc);
  });

  it('只动自己列的 id：不存在的 id 被忽略，不会造出节点', () => {
    const moved = moveCanvasNodes(withNodes(), [{ id: 'ghost', x: 1, y: 1 }]);
    expect(moved.nodes).toHaveLength(3);
    expect(moved.nodes.map((node) => node.id)).toEqual(['a', 'b', 'c']);
  });
});
