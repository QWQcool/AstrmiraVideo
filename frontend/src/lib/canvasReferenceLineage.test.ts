import { describe, expect, it } from 'vitest';
import { createCanvasNode, createEmptyCanvasDoc, type CanvasDoc, type CanvasDocNode } from '@astrmira/shared';
import {
  AUTO_REFERENCE_EDGE_PREFIX,
  autoReferenceEdgeId,
  reconcileReferenceLineage,
} from './canvasReferenceLineage';

/** 造一个"已经出过一批产物"的节点；产物 assetId 固定为 `task:<id>-t1` */
function makeNode(id: string, type: 'image' | 'video' = 'image'): CanvasDocNode {
  const node = createCanvasNode({ id, type, x: 0, y: 0, title: id, now: 1 });
  node.data.batches = [
    {
      id: `${id}-b1`,
      taskId: `${id}-t1`,
      createdAt: 1,
      status: 'succeeded',
      outputs: [{ assetId: `task:${id}-t1`, kind: type, url: `/media/${id}-t1` }],
    },
  ];
  return node;
}

function makeDoc(...nodes: CanvasDocNode[]): CanvasDoc {
  const doc = createEmptyCanvasDoc('p1', '画布', 1);
  doc.nodes = nodes;
  return doc;
}

/** 给视频节点挂一条参考（模拟"从资产库选中了一个节点的产物"） */
function withReference(
  node: CanvasDocNode,
  assetId: string,
  role: 'first-frame' | 'last-frame' | 'reference-video',
  order = 0,
): CanvasDocNode {
  node.data.draft.references = [{ assetId, role, order }];
  return node;
}

describe('引用即连线：把参考对齐成来源边', () => {
  it('引用别的节点的产物 → 补一条 lineage 边，id 与角色都确定', () => {
    const a = makeNode('a', 'image');
    const b = withReference(makeNode('b', 'video'), 'task:a-t1', 'first-frame');
    const doc = makeDoc(a, b);

    const result = reconcileReferenceLineage(doc, 'b', 222);

    expect(result.added).toBe(1);
    expect(result.removed).toBe(0);
    expect(result.doc.edges).toEqual([
      {
        id: autoReferenceEdgeId('a', 'b', 'task:a-t1'),
        from: 'a',
        to: 'b',
        kind: 'lineage',
        role: 'first-frame',
        assetId: 'task:a-t1',
      },
    ]);
    expect(result.doc.updatedAt).toBe(222);
  });

  it('边 id 带固定前缀，便于和手动边区分', () => {
    expect(autoReferenceEdgeId('a', 'b', 'task:x')).toBe(`${AUTO_REFERENCE_EDGE_PREFIX}a>b:task:x`);
  });

  it('重复对齐是幂等的：没有变化时原样返回同一个 doc 引用', () => {
    const a = makeNode('a', 'image');
    const b = withReference(makeNode('b', 'video'), 'task:a-t1', 'first-frame');
    const once = reconcileReferenceLineage(makeDoc(a, b), 'b', 1).doc;

    const twice = reconcileReferenceLineage(once, 'b', 2);

    expect(twice.added).toBe(0);
    expect(twice.removed).toBe(0);
    expect(twice.retargeted).toBe(0);
    expect(twice.doc).toBe(once); // 同一个引用 → 不触发保存
  });

  it('引用被删掉 → 对应的自动边一起消失', () => {
    const a = makeNode('a', 'image');
    const b = withReference(makeNode('b', 'video'), 'task:a-t1', 'first-frame');
    const linked = reconcileReferenceLineage(makeDoc(a, b), 'b', 1).doc;

    const b2 = linked.nodes.find((node) => node.id === 'b');
    if (b2 === undefined) throw new Error('节点丢了');
    b2.data.draft.references = [];
    const result = reconcileReferenceLineage(linked, 'b', 3);

    expect(result.removed).toBe(1);
    expect(result.doc.edges).toHaveLength(0);
  });

  it('首尾帧互换 → 边上的 role 跟着改，边本身不重建', () => {
    const a = makeNode('a', 'image');
    const c = makeNode('c', 'image');
    const b = makeNode('b', 'video');
    b.data.draft.references = [
      { assetId: 'task:a-t1', role: 'first-frame', order: 0 },
      { assetId: 'task:c-t1', role: 'last-frame', order: 1 },
    ];
    const linked = reconcileReferenceLineage(makeDoc(a, c, b), 'b', 1).doc;
    const idsBefore = linked.edges.map((edge) => edge.id).sort();

    const b2 = linked.nodes.find((node) => node.id === 'b');
    if (b2 === undefined) throw new Error('节点丢了');
    b2.data.draft.references = [
      { assetId: 'task:a-t1', role: 'last-frame', order: 0 },
      { assetId: 'task:c-t1', role: 'first-frame', order: 1 },
    ];
    const result = reconcileReferenceLineage(linked, 'b', 4);

    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.retargeted).toBe(2);
    expect(result.doc.edges.map((edge) => edge.id).sort()).toEqual(idsBefore);
    expect(result.doc.edges.find((edge) => edge.assetId === 'task:a-t1')?.role).toBe('last-frame');
    expect(result.doc.edges.find((edge) => edge.assetId === 'task:c-t1')?.role).toBe('first-frame');
  });

  it('上传素材（没有来源节点）不画边', () => {
    const b = withReference(makeNode('b', 'video'), 'uploaded-asset-1', 'first-frame');
    const result = reconcileReferenceLineage(makeDoc(b), 'b', 1);

    expect(result.added).toBe(0);
    expect(result.doc.edges).toHaveLength(0);
  });

  it('引用自己批次的产物不算来源关系', () => {
    const b = withReference(makeNode('b', 'video'), 'task:b-t1', 'first-frame');
    const result = reconcileReferenceLineage(makeDoc(b), 'b', 1);

    expect(result.added).toBe(0);
    expect(result.doc.edges).toHaveLength(0);
  });

  it('手动拖出来的边不受影响（只认 edge-ref- 前缀）', () => {
    const a = makeNode('a', 'image');
    const b = makeNode('b', 'video');
    const doc = makeDoc(a, b);
    doc.edges = [
      { id: 'edge-manual', from: 'a', to: 'b', kind: 'lineage', role: 'first-frame', assetId: 'task:a-t1' },
    ];

    const result = reconcileReferenceLineage(doc, 'b', 1);

    expect(result.removed).toBe(0);
    expect(result.doc.edges.map((edge) => edge.id)).toEqual(['edge-manual']);
  });

  it('两个节点互相引用时只保留一条边，不造环', () => {
    const a = withReference(makeNode('a', 'video'), 'task:b-t1', 'first-frame');
    const b = withReference(makeNode('b', 'video'), 'task:a-t1', 'first-frame');

    // 先对齐 b（a → b），再对齐 a（b → a 会成环 → 跳过）
    const first = reconcileReferenceLineage(makeDoc(a, b), 'b', 1).doc;
    const second = reconcileReferenceLineage(first, 'a', 2);

    expect(second.added).toBe(0);
    expect(second.doc.edges).toHaveLength(1);
    expect(second.doc.edges[0]?.from).toBe('a');
    expect(second.doc.edges[0]?.to).toBe('b');
  });
});
