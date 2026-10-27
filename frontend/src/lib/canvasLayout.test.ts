import { describe, expect, it } from 'vitest';
import { createCanvasNode, createEmptyCanvasDoc, type CanvasDoc } from '@astrmira/shared';
import { LAYOUT_GAP_X, LAYOUT_GAP_Y, layoutCanvasNodes } from './canvasLayout';

/**
 * V2.84（D-5）自动排版：**按依赖分列**，且结果确定（同一份文档整理两次结果一样）。
 * 这是它敢叫"整理"的前提 —— 每次都不一样的东西，用户不敢点。
 */

function node(id: string, x = 0, y = 0, width = 320, height = 200) {
  const created = createCanvasNode({ id, type: 'image', x, y, now: 1 });
  created.layout = { x, y, width, height };
  return created;
}

function doc(nodes: CanvasDoc['nodes'], edges: CanvasDoc['edges'] = []): CanvasDoc {
  const base = createEmptyCanvasDoc('p1', '排版', 1);
  return { ...base, nodes, edges };
}

const byId = (moves: ReturnType<typeof layoutCanvasNodes>) =>
  new Map(moves.map((move) => [move.id, move]));

describe('自动排版', () => {
  it('上游在第 0 列、下游往右；同层按原 y 保序', () => {
    const d = doc(
      [node('a', 900, 300), node('b', 0, 0), node('c', 500, 40)],
      [
        { id: 'e1', from: 'a', to: 'c', kind: 'lineage' },
        { id: 'e2', from: 'b', to: 'c', kind: 'lineage' },
      ],
    );
    const moves = byId(layoutCanvasNodes(d));
    // a、b 都没有入边 → 同一列；b 原 y 更小 → 排在 a 前面
    expect(moves.get('b')).toEqual({ id: 'b', x: 0, y: 0 });
    expect(moves.get('a')).toEqual({ id: 'a', x: 0, y: 200 + LAYOUT_GAP_Y });
    // c 在第二列
    expect(moves.get('c')?.x).toBe(320 + LAYOUT_GAP_X);
  });

  it('结果确定：同一份文档连续两次排版得到同一组坐标', () => {
    const d = doc(
      [node('a'), node('b', 0, 100), node('c', 100, 0)],
      [{ id: 'e1', from: 'a', to: 'c', kind: 'lineage' }],
    );
    expect(layoutCanvasNodes(d)).toEqual(layoutCanvasNodes(d));
  });

  it('成环不会让排版卡死：环里的节点落到最后一列，不重叠', () => {
    const d = doc(
      [node('a'), node('b')],
      [
        { id: 'e1', from: 'a', to: 'b', kind: 'lineage' },
        { id: 'e2', from: 'b', to: 'a', kind: 'lineage' },
      ],
    );
    const moves = layoutCanvasNodes(d);
    expect(moves).toHaveLength(2);
    const ys = new Set(moves.map((move) => move.y));
    expect(ys.size).toBe(2); // 没有叠在同一个 y 上
  });

  it('空画布 → 空结果（不抛、不造节点）', () => {
    expect(layoutCanvasNodes(doc([]))).toEqual([]);
  });
});
