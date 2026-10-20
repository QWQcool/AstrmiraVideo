import { describe, expect, it } from 'vitest';
import { createCanvasNode, createEmptyCanvasDoc, type CanvasDoc, type CanvasDocNode } from '@astrmira/shared';
import { removeCanvasNodes } from './canvasDocOps';
import { addCanvasLineageEdge, planCanvasLineage, removeCanvasLineageEdge } from './canvasLineage';

function makeNode(id: string, type: 'image' | 'video' | 'audio' | 'text'): CanvasDocNode {
  const node = createCanvasNode({ id, type, x: 0, y: 0, title: id, now: 1 });
  // 默认都是"已经出过片"的节点；单个用例再按需去掉产物
  const kind = type === 'image' ? 'image' : type === 'video' ? 'video' : 'audio';
  node.data.batches = [
    {
      id: `${id}-b1`,
      taskId: `${id}-t1`,
      createdAt: 1,
      status: 'succeeded',
      outputs: [{ assetId: `task:${id}-t1`, kind, url: `/media/${id}-t1` }],
    },
  ];
  return node;
}

function makeDoc(...nodes: CanvasDocNode[]): CanvasDoc {
  const doc = createEmptyCanvasDoc('p1', '画布', 1);
  doc.nodes = nodes;
  return doc;
}

describe('来源边：连接规则（B4）', () => {
  it('图片 → 视频：先首帧、再尾帧；第三张拒绝（角色已占）', () => {
    const a = makeNode('a', 'image');
    const b = makeNode('b', 'video');
    const c = makeNode('c', 'image');
    const d = makeNode('d', 'image');
    const doc = makeDoc(a, b, c, d);

    expect(planCanvasLineage(doc, 'a', 'b')).toEqual({
      ok: true,
      role: 'first-frame',
      assetId: 'task:a-t1',
      order: 0,
    });

    const first = addCanvasLineageEdge(doc, 'a', 'b', 'e1', 10);
    expect(first.problem).toBeNull();
    expect(first.doc.edges).toHaveLength(1);
    expect(first.doc.edges[0]).toMatchObject({ id: 'e1', from: 'a', to: 'b', kind: 'lineage', role: 'first-frame' });
    expect(first.doc.nodes[1]!.data.draft.references).toEqual([
      { assetId: 'task:a-t1', role: 'first-frame', order: 0 },
    ]);

    const second = addCanvasLineageEdge(first.doc, 'c', 'b', 'e2', 11);
    expect(second.problem).toBeNull();
    expect(second.doc.nodes[1]!.data.draft.references.map((ref) => ref.role)).toEqual([
      'first-frame',
      'last-frame',
    ]);

    expect(planCanvasLineage(second.doc, 'd', 'b')).toEqual({ ok: false, problem: 'role-taken' });
  });

  it('视频 → 视频：reference-video；第二条拒绝', () => {
    const a = makeNode('a', 'video');
    const b = makeNode('b', 'video');
    const c = makeNode('c', 'video');
    const doc = makeDoc(a, b, c);
    expect(planCanvasLineage(doc, 'a', 'b')).toMatchObject({
      ok: true,
      role: 'reference-video',
      assetId: 'task:a-t1',
    });
    const added = addCanvasLineageEdge(doc, 'a', 'b', 'e1');
    expect(planCanvasLineage(added.doc, 'c', 'b')).toEqual({ ok: false, problem: 'role-taken' });
  });

  it('拒绝：无产物 / 音频上游 / 非视频下游 / 自环 / 重复 / 成环', () => {
    const image = makeNode('i', 'image');
    const video = makeNode('v', 'video');
    const audio = makeNode('a', 'audio');
    const text = makeNode('t', 'text');
    const empty = createCanvasNode({ id: 'empty', type: 'image', x: 0, y: 0, now: 1 });
    const doc = makeDoc(image, video, audio, text, empty);

    expect(planCanvasLineage(doc, 'empty', 'v')).toEqual({ ok: false, problem: 'source-no-output' });
    expect(planCanvasLineage(doc, 'a', 'v')).toEqual({ ok: false, problem: 'source-audio' });
    expect(planCanvasLineage(doc, 'i', 't')).toEqual({ ok: false, problem: 'target-not-video' });
    expect(planCanvasLineage(doc, 'i', 'i')).toEqual({ ok: false, problem: 'self' });
    expect(planCanvasLineage(doc, 'missing', 'v')).toEqual({ ok: false, problem: 'node-missing' });

    const ab = addCanvasLineageEdge(doc, 'i', 'v', 'e1').doc;
    expect(planCanvasLineage(ab, 'i', 'v')).toEqual({ ok: false, problem: 'duplicate' });

    // 视频 → 视频 的环：v1 → v2 之后，v2 → v1 会被拦下
    const v2 = makeNode('v2', 'video');
    const videos = makeDoc(makeNode('v1', 'video'), v2);
    const forward = addCanvasLineageEdge(videos, 'v1', 'v2', 'e2').doc;
    expect(planCanvasLineage(forward, 'v2', 'v1')).toEqual({ ok: false, problem: 'cycle' });
  });

  it('同一个产物不能既当首帧又当尾帧（即使已经手工塞进参考）', () => {
    const image = makeNode('i', 'image');
    const video = makeNode('v', 'video');
    const doc = makeDoc(image, video);
    doc.nodes[1]!.data.draft.references = [{ assetId: 'task:i-t1', role: 'last-frame', order: 0 }];
    expect(planCanvasLineage(doc, 'i', 'v')).toEqual({ ok: false, problem: 'duplicate' });
  });
});

describe('来源边：与参考的同步（B4）', () => {
  it('删边只删它写进去的那条参考（另一个来源的参考保留）', () => {
    const i1 = makeNode('i1', 'image');
    const i2 = makeNode('i2', 'image');
    const video = makeNode('v', 'video');
    const doc = makeDoc(i1, i2, video);

    const withFirst = addCanvasLineageEdge(doc, 'i1', 'v', 'e1', 5).doc;
    const withBoth = addCanvasLineageEdge(withFirst, 'i2', 'v', 'e2', 6).doc;
    expect(withBoth.nodes[2]!.data.draft.references).toHaveLength(2);

    const removed = removeCanvasLineageEdge(withBoth, 'e1', 7);
    expect(removed.edges.map((edge) => edge.id)).toEqual(['e2']);
    expect(removed.nodes[2]!.data.draft.references).toEqual([
      { assetId: 'task:i2-t1', role: 'last-frame', order: 0 },
    ]);
    expect(removed.updatedAt).toBe(7);
  });

  it('上游之后又出了新产物：删边仍能找到连接时的旧参考（按该上游全部产物匹配）', () => {
    const image = makeNode('i', 'image');
    const video = makeNode('v', 'video');
    const doc = addCanvasLineageEdge(makeDoc(image, video), 'i', 'v', 'e1').doc;

    // 上游第二次出片（新 taskId）；下游参考仍指向第一次的产物
    doc.nodes[0]!.data.batches.push({
      id: 'i-b2',
      taskId: 'i-t2',
      createdAt: 2,
      status: 'succeeded',
      outputs: [{ assetId: 'task:i-t2', kind: 'image', url: '/media/i-t2' }],
    });

    const removed = removeCanvasLineageEdge(doc, 'e1');
    expect(removed.nodes[1]!.data.draft.references).toEqual([]);
  });

  it('删除上游节点：边没了，但下游参考还在（参考指向产物，不指向节点）', () => {
    const image = makeNode('i', 'image');
    const video = makeNode('v', 'video');
    const doc = addCanvasLineageEdge(makeDoc(image, video), 'i', 'v', 'e1').doc;
    const removed = removeCanvasNodes(doc, ['i'], 9);
    expect(removed.nodes.map((node) => node.id)).toEqual(['v']);
    expect(removed.edges).toEqual([]);
    expect(removed.nodes[0]!.data.draft.references).toHaveLength(1);
  });

  it('删不存在的边 / 连到不存在的节点：原样返回', () => {
    const doc = makeDoc(makeNode('i', 'image'), makeNode('v', 'video'));
    expect(removeCanvasLineageEdge(doc, 'ghost')).toBe(doc);
    expect(addCanvasLineageEdge(doc, 'ghost', 'v', 'e1').doc).toBe(doc);
  });
});

describe('S5-B3b：来源边固定可见版本', () => {
  function withTwoVersions(): { doc: CanvasDoc; source: CanvasDocNode; target: CanvasDocNode } {
    const source = makeNode('src', 'image');
    source.data.batches = [
      {
        id: 'b1',
        taskId: 't1',
        createdAt: 1,
        status: 'succeeded',
        outputs: [{ assetId: 'task:old', kind: 'image', url: '/media/old.png' }],
      },
      {
        id: 'b2',
        taskId: 't2',
        createdAt: 2,
        status: 'succeeded',
        outputs: [{ assetId: 'task:new', kind: 'image', url: '/media/new.png' }],
      },
    ];
    source.data.selectedBatchId = 'b1';
    const target = makeNode('dst', 'video');
    target.data.draft.references = [];
    return { doc: makeDoc(source, target), source, target };
  }

  it('连接使用选中版本而不是最新成功；边记住 assetId', () => {
    const { doc } = withTwoVersions();
    expect(planCanvasLineage(doc, 'src', 'dst')).toMatchObject({
      ok: true,
      assetId: 'task:old',
      role: 'first-frame',
    });
    const added = addCanvasLineageEdge(doc, 'src', 'dst', 'e1');
    expect(added.doc.edges[0]).toMatchObject({ assetId: 'task:old', role: 'first-frame' });
  });

  it('选中版本失效时拒绝连边，提示独立问题码', () => {
    const { doc, source } = withTwoVersions();
    source.data.selectedBatchId = 'missing';
    expect(planCanvasLineage(doc, 'src', 'dst')).toEqual({
      ok: false,
      problem: 'source-version-invalid',
    });
  });

  it('删边按 edge.assetId 精确删参考，不误删另一条', () => {
    const { doc } = withTwoVersions();
    const first = addCanvasLineageEdge(doc, 'src', 'dst', 'e1').doc;
    const sourceAfterFirst = first.nodes.find((node) => node.id === 'src');
    expect(sourceAfterFirst).toBeDefined();
    sourceAfterFirst!.data.selectedBatchId = 'b2';
    expect(planCanvasLineage(first, 'src', 'dst')).toEqual({
      ok: true,
      assetId: 'task:new',
      role: 'last-frame',
      order: 0,
    });
    const second = addCanvasLineageEdge(first, 'src', 'dst', 'e2').doc;
    expect(second.nodes[1]!.data.draft.references.map((ref) => ref.assetId)).toEqual([
      'task:old',
      'task:new',
    ]);
    const removed = removeCanvasLineageEdge(second, 'e1');
    expect(removed.nodes[1]!.data.draft.references.map((ref) => ref.assetId)).toEqual([
      'task:new',
    ]);
  });
});
