import { describe, expect, it } from 'vitest';
import { createCanvasNode, createEmptyCanvasDoc, type CanvasDoc, type CanvasDocNode } from '@astrmira/shared';
import { removeCanvasNodes } from './canvasDocOps';
import {
  addCanvasDependencyEdge,
  addCanvasLineageEdge,
  planCanvasDependency,
  planCanvasLineage,
  referenceLimit,
  removeCanvasLineageEdge,
} from './canvasLineage';

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

describe('计划依赖边（V2.61 / D73）', () => {
  function makeDraftNode(id: string, type: 'image' | 'video' | 'audio' | 'text'): CanvasDocNode {
    const node = makeNode(id, type);
    node.data.batches = [];
    return node;
  }

  it('草稿之间可建计划边：不要求产物、不写参考、无 role/assetId', () => {
    const doc = makeDoc(makeDraftNode('a', 'image'), makeDraftNode('b', 'video'));
    expect(planCanvasDependency(doc, 'a', 'b')).toEqual({ ok: true });
    const added = addCanvasDependencyEdge(doc, 'a', 'b', 'd1', 10);
    expect(added.problem).toBeNull();
    expect(added.doc.edges).toEqual([{ id: 'd1', from: 'a', to: 'b', kind: 'dependency' }]);
    expect(added.doc.nodes[1]!.data.draft.references).toEqual([]);
  });

  it('音频上游 / 文本上游 / 非视频下游 / 自环：拒绝并给对应理由', () => {
    const doc = makeDoc(
      makeDraftNode('a', 'audio'),
      makeDraftNode('t', 'text'),
      makeDraftNode('img', 'image'),
      makeDraftNode('v', 'video'),
    );
    expect(planCanvasDependency(doc, 'a', 'v')).toEqual({ ok: false, problem: 'source-audio' });
    expect(planCanvasDependency(doc, 't', 'v')).toEqual({ ok: false, problem: 'source-not-media' });
    expect(planCanvasDependency(doc, 'img', 't')).toEqual({ ok: false, problem: 'target-not-video' });
    expect(planCanvasDependency(doc, 'img', 'img')).toEqual({ ok: false, problem: 'self' });
  });

  it('同向边已存在（任一 kind）拒绝：事实边与计划边不并存', () => {
    const doc = makeDoc(makeNode('a', 'image'), makeNode('b', 'video'));
    const linked = addCanvasLineageEdge(doc, 'a', 'b', 'e1', 10);
    expect(planCanvasDependency(linked.doc, 'a', 'b')).toEqual({ ok: false, problem: 'duplicate' });

    // 反方向同理：已有计划边时，来源边的重复判定也把计划边算进去（assetId 缺省匹配）
    const draftDoc = makeDoc(makeNode('a', 'image'), makeNode('b', 'video'));
    const withDep = addCanvasDependencyEdge(draftDoc, 'a', 'b', 'd1', 10).doc;
    expect(planCanvasLineage(withDep, 'a', 'b')).toEqual({ ok: false, problem: 'duplicate' });
  });

  it('环检测覆盖两类边：跨 kind 成环也拒绝', () => {
    const doc0 = makeDoc(makeNode('a', 'video'), makeNode('b', 'video'));
    const linked = addCanvasLineageEdge(doc0, 'b', 'a', 'e1', 10);
    expect(linked.problem).toBeNull();
    expect(planCanvasDependency(linked.doc, 'a', 'b')).toEqual({ ok: false, problem: 'cycle' });

    const draftDoc = makeDoc(makeDraftNode('a', 'video'), makeDraftNode('b', 'video'));
    const withDep = addCanvasDependencyEdge(draftDoc, 'b', 'a', 'd1', 10).doc;
    expect(planCanvasDependency(withDep, 'a', 'b')).toEqual({ ok: false, problem: 'cycle' });
  });

  it('删计划边只删边，不动下游任何参考（kind 分流）', () => {
    const doc0 = makeDoc(makeNode('a', 'image'), makeNode('b', 'video'));
    const withDep = addCanvasDependencyEdge(doc0, 'a', 'b', 'd1', 10).doc;
    // 模拟资产库入口写入的参考（不经边）：删计划边不得波及它
    const withRef: CanvasDoc = {
      ...withDep,
      nodes: withDep.nodes.map((node) =>
        node.id === 'b'
          ? {
              ...node,
              data: {
                ...node.data,
                draft: {
                  ...node.data.draft,
                  references: [{ assetId: 'task:a-t1', role: 'first-frame', order: 0 }],
                },
              },
            }
          : node,
      ),
    };
    const after = removeCanvasLineageEdge(withRef, 'd1', 20);
    expect(after.edges.find((edge) => edge.id === 'd1')).toBeUndefined();
    const target = after.nodes.find((node) => node.id === 'b');
    expect(target!.data.draft.references).toEqual([
      { assetId: 'task:a-t1', role: 'first-frame', order: 0 },
    ]);
  });
});

describe('图片派生编辑（S9-A3 / V2.69）', () => {
  it('图片 → 图片：reference-image 角色（单参考），不写首尾帧语义', () => {
    const doc = makeDoc(makeNode('a', 'image'), makeNode('b', 'image'));
    expect(planCanvasLineage(doc, 'a', 'b')).toEqual({
      ok: true,
      role: 'reference-image',
      assetId: 'task:a-t1',
      order: 0,
    });
    const added = addCanvasLineageEdge(doc, 'a', 'b', 'e9', 10);
    expect(added.doc.edges[0]).toMatchObject({ from: 'a', to: 'b', kind: 'lineage', role: 'reference-image' });
    expect(added.doc.nodes[1]!.data.draft.references).toEqual([
      { assetId: 'task:a-t1', role: 'reference-image', order: 0 },
    ]);
  });

  it('已有 reference-image → 再连拒绝（单参考纪律）；视频产物作图片参考拒绝', () => {
    const doc0 = makeDoc(makeNode('a', 'image'), makeNode('b', 'image'), makeNode('c', 'image'), makeNode('v', 'video'));
    const linked = addCanvasLineageEdge(doc0, 'a', 'b', 'e1', 10);
    expect(planCanvasLineage(linked.doc, 'c', 'b')).toEqual({ ok: false, problem: 'role-taken' });
    expect(planCanvasLineage(doc0, 'v', 'b')).toEqual({ ok: false, problem: 'source-not-media' });
  });
});

describe('B 路线：全能参考（omni-reference）允许多图', () => {
  it('图片节点声明 omni-reference 后：第二、第三条都能连，order 递增', () => {
    const b = makeNode('b', 'image');
    b.data.draft.settings.referenceMode = 'omni-reference';
    const doc = makeDoc(makeNode('a', 'image'), b, makeNode('c', 'image'), makeNode('d', 'image'));

    expect(planCanvasLineage(doc, 'a', 'b')).toEqual({
      ok: true,
      role: 'reference-image',
      assetId: 'task:a-t1',
      order: 0,
    });
    const first = addCanvasLineageEdge(doc, 'a', 'b', 'e1', 10);
    expect(first.problem).toBeNull();

    const second = addCanvasLineageEdge(first.doc, 'c', 'b', 'e2', 11);
    expect(second.problem).toBeNull();
    const third = addCanvasLineageEdge(second.doc, 'd', 'b', 'e3', 12);
    expect(third.problem).toBeNull();
    expect(third.doc.nodes[1]!.data.draft.references.map((ref) => ref.order)).toEqual([0, 1, 2]);
  });

  it('同一张素材重复连接 → duplicate（不是默默多一条）', () => {
    const b = makeNode('b', 'image');
    b.data.draft.settings.referenceMode = 'omni-reference';
    const doc = makeDoc(makeNode('a', 'image'), b);
    const linked = addCanvasLineageEdge(doc, 'a', 'b', 'e1', 10);
    // 上游重跑后产物变化仍算同一张（同边）→ 由 duplicate 分支挡住
    expect(planCanvasLineage(linked.doc, 'a', 'b')).toEqual({ ok: false, problem: 'duplicate' });
  });

  it('槽位连满 12 张后拒绝（references-full）', () => {
    const b = makeNode('b', 'image');
    b.data.draft.settings.referenceMode = 'omni-reference';
    b.data.draft.references = Array.from({ length: 12 }, (_, index) => ({
      assetId: `task:x${index}-t1`,
      role: 'reference-image' as const,
      order: index,
    }));
    const doc = makeDoc(makeNode('a', 'image'), b);
    expect(planCanvasLineage(doc, 'a', 'b')).toEqual({ ok: false, problem: 'references-full' });
  });

  it('实例能力把上限收窄：声明 4 张后连第 5 张即 references-full', () => {
    const b = makeNode('b', 'image');
    b.data.draft.settings.referenceMode = 'omni-reference';
    b.data.draft.references = Array.from({ length: 4 }, (_, index) => ({
      assetId: `task:x${index}-t1`,
      role: 'reference-image' as const,
      order: index,
    }));
    const doc = makeDoc(makeNode('a', 'image'), b);
    // 没有能力声明 → 仍按产品上限 12，能连
    expect(planCanvasLineage(doc, 'a', 'b')).toMatchObject({ ok: true });
    // 实例只声明 4 张 → 拒绝
    expect(planCanvasLineage(doc, 'a', 'b', { maxReferences: 4 })).toEqual({
      ok: false,
      problem: 'references-full',
    });
  });

  it('能力值非法/超过产品上限时按 12 算（不让 env 写 999 就放开）', () => {
    expect(referenceLimit({ maxReferences: 999 })).toBe(12);
    expect(referenceLimit({ maxReferences: 0 })).toBe(12);
    expect(referenceLimit({})).toBe(12);
    expect(referenceLimit({ maxReferences: 4 })).toBe(4);
  });

  it('视频节点 omni-reference：图源进 reference-image 槽位，不和首尾帧混', () => {
    const v = makeNode('v', 'video');
    v.data.draft.settings.referenceMode = 'omni-reference';
    const doc = makeDoc(makeNode('a', 'image'), v);
    expect(planCanvasLineage(doc, 'a', 'v')).toEqual({
      ok: true,
      role: 'reference-image',
      assetId: 'task:a-t1',
      order: 0,
    });

    const withFirst = makeNode('v2', 'video');
    withFirst.data.draft.settings.referenceMode = 'omni-reference';
    withFirst.data.draft.references = [{ assetId: 'task:z-t1', role: 'first-frame', order: 0 }];
    const doc2 = makeDoc(makeNode('a', 'image'), withFirst);
    expect(planCanvasLineage(doc2, 'a', 'v2')).toEqual({ ok: false, problem: 'role-taken' });
  });
});
