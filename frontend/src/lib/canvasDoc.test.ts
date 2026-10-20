import { describe, expect, it } from 'vitest';
import {
  CANVAS_DOC_VERSION,
  CanvasDocSchema,
  canvasDocDanglingEdges,
  canvasDocSummary,
  createCanvasNode,
  createEmptyCanvasDoc,
  createEmptyCanvasProjectIndex,
  type CanvasDoc,
} from '@astrmira/shared';

function makeDoc(): CanvasDoc {
  const doc = createEmptyCanvasDoc('proj-1', '客厅灯光广告', 1_700_000_000_000);
  const image = createCanvasNode({ id: 'n-image', type: 'image', x: 0, y: 0, now: 1_700_000_000_000 });
  image.data.source = 'model_generated';
  image.data.draft = {
    kind: 'image',
    prompt: '一只橘猫坐在窗台上，午后阳光',
    settings: { modelId: 'seedream-lite', aspectRatio: '1:1', count: 1 },
    references: [],
  };
  image.data.batches = [
    {
      id: 'b-1',
      taskId: 'task-1',
      createdAt: 1_700_000_000_000,
      status: 'succeeded',
      outputs: [{ assetId: 'asset-1', kind: 'image', width: 2048, height: 2048 }],
    },
  ];

  const video = createCanvasNode({ id: 'n-video', type: 'video', x: 400, y: 0 });
  video.data.draft = {
    kind: 'video',
    prompt: '镜头缓缓推进',
    settings: {
      modelId: 'seedance-mini',
      mode: 'i2v',
      referenceMode: 'first-last-frame',
      aspectRatio: '16:9',
      resolution: { width: 1280, height: 720 },
      durationSec: 5,
      count: 1,
    },
    references: [
      { assetId: 'asset-1', role: 'first-frame', order: 0 },
      { assetId: 'asset-2', role: 'last-frame', order: 0 },
    ],
  };

  doc.nodes = [image, video];
  doc.edges = [
    { id: 'e-1', from: 'n-image', to: 'n-video', kind: 'lineage', role: 'first-frame' },
    { id: 'e-2', from: 'n-image', to: 'n-video', kind: 'dependency', role: 'first-frame' },
  ];
  return doc;
}

describe('CanvasDoc v1', () => {
  it('空文档没有归属字段，视口与数组都是显式的', () => {
    const doc = createEmptyCanvasDoc('proj-1', '未命名画布', 123);
    expect(doc.version).toBe(CANVAS_DOC_VERSION);
    expect(doc.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(doc.nodes).toEqual([]);
    expect(doc.edges).toEqual([]);
    // D60：单用户部署，文档里不应出现任何归属/租户字段
    expect(Object.keys(doc)).not.toContain('ownerId');
    expect(Object.keys(doc)).not.toContain('tenantId');
  });

  it('节点工厂补齐 batches/tags，新建节点本身就能通过校验', () => {
    const node = createCanvasNode({ id: 'n1', type: 'audio', x: 10, y: 20 });
    expect(node.data.batches).toEqual([]);
    expect(node.data.tags).toEqual([]);
    expect(node.data.draft).toEqual({ kind: 'audio', prompt: '', settings: {}, references: [] });
    expect(node.layout.width).toBeGreaterThan(0);
    expect(() => CanvasDocSchema.parse({
      ...createEmptyCanvasDoc('p', 'n'),
      nodes: [node],
    })).not.toThrow();
  });

  it('完整文档可以往返序列化：草稿、参数、参考、批次、两类边都不丢', () => {
    const doc = makeDoc();
    const parsed = CanvasDocSchema.parse(JSON.parse(JSON.stringify(doc)));
    expect(parsed).toEqual(doc);
    expect(parsed.nodes[1].data.draft.references.map((r) => r.role)).toEqual([
      'first-frame',
      'last-frame',
    ]);
    expect(parsed.edges.map((e) => e.kind)).toEqual(['lineage', 'dependency']);
    expect(parsed.nodes[0].data.batches[0].outputs[0].assetId).toBe('asset-1');
  });

  it('拒绝未知版本（版本只用于本契约自身演进，不做跨格式兼容）', () => {
    expect(() => CanvasDocSchema.parse({ ...makeDoc(), version: 2 })).toThrow();
  });

  it('拒绝未登记的节点类型（时间线/主体/导演台不在首发）', () => {
    const doc = makeDoc();
    const broken = { ...doc, nodes: [{ ...doc.nodes[0], type: 'timeline' }] };
    expect(() => CanvasDocSchema.parse(broken)).toThrow();
  });

  it('悬空边能被单独找出来，而不是让整份文档解析失败', () => {
    const doc = makeDoc();
    doc.edges.push({ id: 'e-ghost', from: 'n-image', to: 'n-missing', kind: 'lineage' });
    expect(() => CanvasDocSchema.parse(doc)).not.toThrow();
    expect(canvasDocDanglingEdges(doc)).toEqual(['e-ghost']);
  });

  it('摘要用第一张图片产物当封面，并统计节点数', () => {
    const ref = canvasDocSummary(makeDoc());
    expect(ref).toMatchObject({
      projectId: 'proj-1',
      name: '客厅灯光广告',
      nodeCount: 2,
      coverAssetId: 'asset-1',
    });
  });

  it('项目索引空态是显式的空数组（多画布列表用）', () => {
    const index = createEmptyCanvasProjectIndex();
    expect(index).toEqual({ version: CANVAS_DOC_VERSION, projects: [] });
  });

  it('V2.49：批次可带原始 request；旧批次/旧文档仍能读（revision 缺省 1）', () => {
    const doc = makeDoc();
    const legacy = { ...doc, revision: undefined };
    const parsedLegacy = CanvasDocSchema.parse(legacy);
    expect(parsedLegacy.revision).toBe(1);

    const batch = {
      id: 'b-recover',
      createdAt: 1,
      status: 'queued' as const,
      outputs: [],
      request: {
        prompt: '一只猫',
        mode: 't2i' as const,
        aspectRatio: '1:1' as const,
        provider: 'host-comfyui',
        origin: 'canvas' as const,
        canvasProjectId: 'proj-1',
      },
    };
    const parsed = CanvasDocSchema.parse({
      ...doc,
      nodes: [{ ...doc.nodes[0], data: { ...doc.nodes[0].data, batches: [batch] } }],
    });
    expect(parsed.nodes[0]?.data.batches[0]?.request?.prompt).toBe('一只猫');
  });

  it('V2.52：selectedBatchId 可选；旧文档缺字段仍能读', () => {
    const doc = makeDoc();
    const legacy = CanvasDocSchema.parse(doc);
    expect(legacy.nodes[0]?.data.selectedBatchId).toBeUndefined();

    const selected = CanvasDocSchema.parse({
      ...doc,
      nodes: [
        {
          ...doc.nodes[0],
          data: { ...doc.nodes[0].data, selectedBatchId: 'b1' },
        },
      ],
    });
    expect(selected.nodes[0]?.data.selectedBatchId).toBe('b1');
  });
});
