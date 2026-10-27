import { describe, expect, it } from 'vitest';
import { createCanvasNode, createEmptyCanvasDoc, type CanvasDoc } from '@astrmira/shared';
import {
  canvasGroupBounds,
  createCanvasGroup,
  groupForNode,
  GROUP_HEADER,
  GROUP_PADDING,
  pruneCanvasGroups,
  removeCanvasGroup,
  renameCanvasGroup,
  setCanvasGroupMembers,
} from './canvasGroups';

/**
 * V2.81 分组（P3）：组只存"谁属于它 + 标题"，框由成员包围盒算。
 * 这几条单测钉的就是这个设计的两个后果：**框会自己跟着变**、**删节点不会留下空框**。
 */

function node(id: string, x: number, y: number, width = 360, height = 200) {
  const created = createCanvasNode({ id, type: 'image', x, y, now: 1 });
  created.layout = { x, y, width, height };
  return created;
}

function doc(nodes: CanvasDoc['nodes']): CanvasDoc {
  const base = createEmptyCanvasDoc('p1', '测试', 1);
  return { ...base, nodes };
}

const withGroup = (nodes: CanvasDoc['nodes'], nodeIds: string[]): CanvasDoc =>
  createCanvasGroup(doc(nodes), { id: 'g1', title: '第一场', nodeIds }, 5);

describe('分组框几何', () => {
  it('两个节点 → 包围盒 + 内边距 + 标题条高度', () => {
    const d = withGroup([node('a', 0, 0), node('b', 500, 300)], ['a', 'b']);
    const bounds = canvasGroupBounds(d.groups![0]!, d.nodes);
    expect(bounds).toEqual({
      x: -GROUP_PADDING,
      y: -GROUP_PADDING - GROUP_HEADER,
      width: 500 + 360 + GROUP_PADDING * 2,
      height: 300 + 200 + GROUP_PADDING * 2 + GROUP_HEADER,
    });
  });

  it('成员被移走后框自动缩小（框不存坐标，所以不存在"框和节点分家"）', () => {
    const d = withGroup([node('a', 0, 0), node('b', 500, 300)], ['a', 'b']);
    const shrunk = setCanvasGroupMembers(d, 'g1', ['a'], 9);
    const bounds = canvasGroupBounds(shrunk.groups![0]!, shrunk.nodes);
    expect(bounds).toEqual({
      x: -GROUP_PADDING,
      y: -GROUP_PADDING - GROUP_HEADER,
      width: 360 + GROUP_PADDING * 2,
      height: 200 + GROUP_PADDING * 2 + GROUP_HEADER,
    });
  });

  it('成员全不存在 → null（界面据此不画框，而不是画一个 0 尺寸的东西）', () => {
    const d = withGroup([node('a', 0, 0)], ['a']);
    const orphan = { ...d, nodes: [] };
    expect(canvasGroupBounds(orphan.groups![0]!, orphan.nodes)).toBeNull();
  });
});

describe('分组的增删改', () => {
  it('编组后能反查"这个节点属于哪个组"', () => {
    const d = withGroup([node('a', 0, 0), node('b', 400, 0)], ['a', 'b']);
    expect(groupForNode(d, 'b')?.title).toBe('第一场');
    expect(groupForNode(d, 'zzz')).toBeUndefined();
  });

  it('重命名：空标题被忽略，同标题返回同一个 doc 引用', () => {
    const d = withGroup([node('a', 0, 0)], ['a']);
    expect(renameCanvasGroup(d, 'g1', '   ')).toBe(d);
    expect(renameCanvasGroup(d, 'g1', '第一场')).toBe(d);
    expect(renameCanvasGroup(d, 'g1', '开场').groups![0]!.title).toBe('开场');
  });

  it('解散分组只删组、节点一个不少', () => {
    const d = withGroup([node('a', 0, 0), node('b', 400, 0)], ['a', 'b']);
    const after = removeCanvasGroup(d, 'g1', 9);
    expect(after.groups).toEqual([]);
    expect(after.nodes.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('一个节点只属于一个组：加进新组会从旧组摘掉', () => {
    const d = withGroup([node('a', 0, 0), node('b', 400, 0)], ['a', 'b']);
    const two = createCanvasGroup(d, { id: 'g2', title: '第二场', nodeIds: ['b'] }, 6);
    const moved = setCanvasGroupMembers(two, 'g1', ['b', 'a'], 7);
    expect(moved.groups!.find((g) => g.id === 'g2')!.nodeIds).toEqual([]);
    expect(moved.groups!.find((g) => g.id === 'g1')!.nodeIds).toEqual(['b', 'a']);
  });
});

describe('删除节点后的收拾', () => {
  it('删掉一个成员：组里只留下还活着的 id', () => {
    const d = withGroup([node('a', 0, 0), node('b', 400, 0)], ['a', 'b']);
    const pruned = pruneCanvasGroups({ ...d, nodes: [node('a', 0, 0)] }, 9);
    expect(pruned.groups![0]!.nodeIds).toEqual(['a']);
  });

  it('成员全被删：整个组消失（不留空框）', () => {
    const d = withGroup([node('a', 0, 0)], ['a']);
    const pruned = pruneCanvasGroups({ ...d, nodes: [] }, 9);
    expect(pruned.groups).toEqual([]);
  });

  it('没有失效成员时返回同一个 doc 引用（不触发无意义保存）', () => {
    const d = withGroup([node('a', 0, 0)], ['a']);
    expect(pruneCanvasGroups(d, 9)).toBe(d);
  });
});
