import { describe, expect, it } from 'vitest';
import { createCanvasNode, createEmptyCanvasDoc, type CanvasDoc } from '@astrmira/shared';
import { collectLayoutSelection } from './canvasLayoutSelection';

/**
 * 「按布局出图」的选区规则（V2.113）。
 *
 * 这组断言的价值：规则错了不会有异常，只会**生成一条语义错误的提示词** ——
 * 比如把第一个框的提示词当成整图描述，出来的图既不像框也不像整图。
 */

function docWith(
  nodes: { id: string; type: 'text' | 'image' | 'video' | 'audio'; prompt: string }[],
): CanvasDoc {
  const doc = createEmptyCanvasDoc('p1', '画布', 1);
  doc.nodes = nodes.map((entry, index) => {
    const node = createCanvasNode({
      id: entry.id,
      type: entry.type,
      x: index * 200,
      y: 0,
      title: entry.id,
      now: 1,
    });
    node.data.draft = { ...node.data.draft, prompt: entry.prompt };
    return node;
  });
  return doc;
}

describe('按布局出图的选区（V2.113）', () => {
  it('一个文本当整图描述 + 两个有提示词的节点当框 → 成立', () => {
    const doc = docWith([
      { id: 'brief', type: 'text', prompt: '白底产品图，柔光' },
      { id: 'left', type: 'image', prompt: '左边：红球' },
      { id: 'right', type: 'image', prompt: '右边：蓝方块' },
    ]);
    const result = collectLayoutSelection(doc, ['brief', 'left', 'right']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selection.summary).toBe('白底产品图，柔光');
    expect(result.selection.frames.map((frame) => frame.caption)).toEqual(['左边：红球', '右边：蓝方块']);
    // 框带各自的位置（后面要靠它算坐标）；尺寸由画布决定，这里只钉住"确实是这个节点的框"
    expect(result.selection.frames[0]?.layout.x).toBe(200);
    expect(result.selection.frames[0]?.layout.y).toBe(0);
    expect(result.selection.frames[0]?.layout.width).toBeGreaterThan(0);
  });

  it('文本节点**不**进框（否则"整图是什么"会被当成一个框画出来）', () => {
    const doc = docWith([
      { id: 'brief', type: 'text', prompt: '整图描述' },
      { id: 'a', type: 'image', prompt: 'A' },
      { id: 'b', type: 'image', prompt: 'B' },
    ]);
    const result = collectLayoutSelection(doc, ['brief', 'a', 'b']);
    expect(result.ok && result.selection.frames.map((frame) => frame.id)).toEqual(['a', 'b']);
  });

  it('框不够两个 → 明说差几个（一个框等于没有约束）', () => {
    const doc = docWith([
      { id: 'brief', type: 'text', prompt: '整图' },
      { id: 'a', type: 'image', prompt: 'A' },
      { id: 'empty', type: 'image', prompt: '   ' },
    ]);
    const result = collectLayoutSelection(doc, ['brief', 'a', 'empty']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue).toBe('needTwoFrames');
    expect(result.frameCount).toBe(1);
  });

  it('没有文本节点 → 要求先写整图描述（不让第一个框兼任）', () => {
    const doc = docWith([
      { id: 'a', type: 'image', prompt: 'A' },
      { id: 'b', type: 'image', prompt: 'B' },
    ]);
    const result = collectLayoutSelection(doc, ['a', 'b']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue).toBe('needSummary');
  });

  it('两个文本节点 → 拒绝（不知道哪句是整图）', () => {
    const doc = docWith([
      { id: 't1', type: 'text', prompt: '整图一' },
      { id: 't2', type: 'text', prompt: '整图二' },
      { id: 'a', type: 'image', prompt: 'A' },
      { id: 'b', type: 'image', prompt: 'B' },
    ]);
    const result = collectLayoutSelection(doc, ['t1', 't2', 'a', 'b']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue).toBe('tooManySummaries');
  });

  it('只由选中的节点决定（没选中的有提示词也不算）', () => {
    const doc = docWith([
      { id: 'brief', type: 'text', prompt: '整图' },
      { id: 'a', type: 'image', prompt: 'A' },
      { id: 'b', type: 'image', prompt: 'B' },
      { id: 'c', type: 'image', prompt: 'C（没选中）' },
    ]);
    const result = collectLayoutSelection(doc, ['brief', 'a', 'b']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selection.frames).toHaveLength(2);
  });

  it('视频/音频节点也能当框（它们同样是"这块画面里有什么"）', () => {
    const doc = docWith([
      { id: 'brief', type: 'text', prompt: '整图' },
      { id: 'v', type: 'video', prompt: '一段移动的镜头' },
      { id: 'au', type: 'audio', prompt: '声音' },
    ]);
    const result = collectLayoutSelection(doc, ['brief', 'v', 'au']);
    expect(result.ok && result.selection.frames.map((frame) => frame.id)).toEqual(['v', 'au']);
  });
});
