import { describe, expect, it } from 'vitest';
import {
  CanvasAgentRequestSchema,
  createCanvasNode,
  createEmptyCanvasDoc,
} from '@astrmira/shared';
import {
  CANVAS_AGENT_NODE_LIMIT,
  buildCanvasAgentContext,
  canvasAgentContextSummary,
} from './canvasAgentContext';

function docWithNodes(): ReturnType<typeof createEmptyCanvasDoc> {
  const doc = createEmptyCanvasDoc('p1', '画布', 1);
  const n1 = createCanvasNode({ id: 'n1', type: 'image', x: 0, y: 0, title: '首帧', now: 1 });
  n1.data.draft.prompt = '雨夜霓虹街道';
  n1.data.batches.push({
    id: 'b1',
    createdAt: 1,
    status: 'succeeded',
    outputs: [{ assetId: 'task:t1', kind: 'image' }],
  });
  const n2 = createCanvasNode({ id: 'n2', type: 'video', x: 400, y: 0, now: 2 });
  n2.data.draft.prompt = '慢推镜头';
  n2.data.batches.push({
    id: 'b2',
    createdAt: 2,
    status: 'failed',
    outputs: [],
  });
  return {
    ...doc,
    nodes: [n1, n2],
    edges: [{ id: 'e1', from: 'n1', to: 'n2', kind: 'lineage' }],
  };
}

describe('S7-D1 canvas agent context', () => {
  it('只派生快照，包含标题/提示词/产物/引用与边，不改原文档', () => {
    const doc = docWithNodes();
    const context = buildCanvasAgentContext(doc, 'n1');
    expect(context.projectId).toBe('p1');
    expect(context.nodes).toHaveLength(2);
    expect(context.nodes[0]).toMatchObject({
      id: 'n1',
      type: 'image',
      title: '首帧',
      prompt: '雨夜霓虹街道',
      batchCount: 1,
      outputKinds: ['image'],
    });
    expect(context.nodes[1]?.outputKinds).toEqual([]);
    expect(context.edges).toEqual([{ from: 'n1', to: 'n2', kind: 'lineage' }]);
    expect(context.selectedNodeId).toBe('n1');
    expect(context.truncated).toBe(false);
    expect(doc.nodes).toHaveLength(2);
    expect(doc.nodes[0]?.data.draft.prompt).toBe('雨夜霓虹街道');
  });

  it('超上限截断并标 truncated，模型不能假装看过全部', () => {
    const doc = createEmptyCanvasDoc('p1', '大画布', 1);
    doc.nodes = Array.from({ length: CANVAS_AGENT_NODE_LIMIT + 1 }, (_, index) =>
      createCanvasNode({ id: `n${index}`, type: 'text', x: index, y: 0, now: 1 }),
    );
    const context = buildCanvasAgentContext(doc);
    expect(context.nodes).toHaveLength(CANVAS_AGENT_NODE_LIMIT);
    expect(context.truncated).toBe(true);
  });

  it('请求 schema 可被服务端严格解析，且没有画布写操作字段', () => {
    const context = buildCanvasAgentContext(docWithNodes(), 'n2');
    const parsed = CanvasAgentRequestSchema.safeParse({
      question: '总结画布',
      canvas: context,
    });
    expect(parsed.success).toBe(true);
    expect(() =>
      CanvasAgentRequestSchema.parse({
        question: '删除节点',
        canvas: context,
        operation: 'delete',
      }),
    ).toThrow();
  });

  it('摘要统计节点/边/有产物的节点', () => {
    const summary = canvasAgentContextSummary(buildCanvasAgentContext(docWithNodes()));
    expect(summary).toEqual({ nodes: 2, edges: 1, outputs: 1, selected: null, truncated: false });
  });
});
