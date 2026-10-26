import { describe, expect, it } from 'vitest';
import type { CanvasDocEdge, CanvasDocNode } from '@astrmira/shared';
import { canvasEdgeSummary, edgeShortId } from './canvasEdgeSummary';

function node(overrides: Partial<CanvasDocNode> = {}): CanvasDocNode {
  return {
    id: 'n1',
    type: 'image',
    layout: { x: 0, y: 0, width: 320, height: 320 },
    data: {
      title: '雨夜橘猫',
      source: 'uploaded',
      draft: { kind: 'image', prompt: '', settings: {}, references: [] },
      batches: [],
      tags: [],
    },
    ...overrides,
  } as CanvasDocNode;
}

function edge(overrides: Partial<CanvasDocEdge> = {}): CanvasDocEdge {
  return { id: 'e1', from: 'n1', to: 'n2', kind: 'lineage', ...overrides };
}

describe('canvasEdgeSummary · 引用线的按需说明（B109）', () => {
  it('来源/目标用节点标题；有 assetId 时显示"连接那一刻的版本"', () => {
    const summary = canvasEdgeSummary(
      edge({ role: 'first-frame', assetId: 'task:t-1234567890123456789012' }),
      [
        node({ id: 'n1' }),
        node({
          id: 'n2',
          type: 'video',
          data: {
            title: undefined,
            source: 'model_generated',
            draft: { kind: 'video', prompt: '猫抬头看雨', settings: {}, references: [] },
            batches: [],
            tags: [],
          },
        } as Partial<CanvasDocNode>),
      ],
    );
    expect(summary).toEqual({
      source: { id: 'n1', type: 'image', label: '雨夜橘猫', missing: false },
      target: { id: 'n2', type: 'video', label: '猫抬头看雨', missing: false },
      kind: 'lineage',
      role: 'first-frame',
      version: 'task:t-1234567890123456789012',
      versionRecorded: true,
    });
  });

  it('旧边没有 assetId → versionRecorded=false（界面必须写"版本未记录"，不能编）', () => {
    const summary = canvasEdgeSummary(edge(), [node({ id: 'n1' }), node({ id: 'n2' })]);
    expect(summary?.version).toBeUndefined();
    expect(summary?.versionRecorded).toBe(false);
  });

  it('计划依赖边即使带了 assetId 也不算"已记录版本"（它是意图，不是事实）', () => {
    const summary = canvasEdgeSummary(
      edge({ kind: 'dependency', assetId: 'task:t-1' }),
      [node({ id: 'n1' }), node({ id: 'n2' })],
    );
    expect(summary?.version).toBeUndefined();
    expect(summary?.versionRecorded).toBe(false);
    expect(summary?.role).toBeUndefined();
  });

  it('节点已不在画布上 → missing（悬空边如实说，不伪造标题）', () => {
    const summary = canvasEdgeSummary(edge({ from: 'ghost', to: 'n2' }), [node({ id: 'n2' })]);
    expect(summary?.source).toEqual({ id: 'ghost', missing: true });
    expect(summary?.target.label).toBe('雨夜橘猫');
  });

  it('既无标题也无提示词 → 不给 label（界面用类型 + 短码兜底）', () => {
    const bare = node({
      id: 'abcdef123456',
      data: {
        title: undefined,
        source: 'uploaded',
        draft: { kind: 'image', prompt: '  ', settings: {}, references: [] },
        batches: [],
        tags: [],
      },
    } as Partial<CanvasDocNode>);
    const summary = canvasEdgeSummary(edge({ from: 'abcdef123456', to: 'n2' }), [bare, node({ id: 'n2' })]);
    expect(summary?.source.label).toBeUndefined();
    expect(summary?.source.type).toBe('image');
    expect(edgeShortId('abcdef123456')).toBe('abcdef12');
  });

  it('空 from/to → null（无效输入不产出一条假说明）', () => {
    expect(canvasEdgeSummary(edge({ from: '' }), [node()])).toBeNull();
  });

  it('超长提示词截断（说明不该把画布撑爆）', () => {
    const long = node({
      id: 'n1',
      data: {
        title: undefined,
        source: 'uploaded',
        draft: {
          kind: 'image',
          prompt: '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十',
          settings: {},
          references: [],
        },
        batches: [],
        tags: [],
      },
    } as Partial<CanvasDocNode>);
    const summary = canvasEdgeSummary(edge(), [long, node({ id: 'n2' })]);
    expect(summary?.source.label?.endsWith('…')).toBe(true);
    expect(summary?.source.label?.length).toBe(21);
  });
});
