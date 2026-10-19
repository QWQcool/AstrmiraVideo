import { describe, expect, it } from 'vitest';
import { createCanvasNode, createEmptyCanvasDoc, type CanvasDoc } from '@astrmira/shared';
import {
  CANVAS_HISTORY_COALESCE_MS,
  CANVAS_HISTORY_LIMIT,
  canRedoCanvas,
  canUndoCanvas,
  createCanvasHistory,
  recordCanvasHistory,
  redoCanvasHistory,
  restoreCanvasHistoryDoc,
  undoCanvasHistory,
} from './canvasHistory';

function docWith(title: string, now = 1): CanvasDoc {
  const doc = createEmptyCanvasDoc('p1', '画布', now);
  doc.nodes = [createCanvasNode({ id: 'n1', type: 'video', x: 0, y: 0, title, now })];
  return doc;
}

describe('撤销栈（B3）', () => {
  it('记录 → 撤销 → 重做：回到上一份/下一份文档', () => {
    const before = docWith('改之前', 1);
    const after = docWith('改之后', 2);
    let history = createCanvasHistory();
    expect(canUndoCanvas(history)).toBe(false);

    history = recordCanvasHistory(history, before, { now: 10 });
    expect(canUndoCanvas(history)).toBe(true);

    const undone = undoCanvasHistory(history, after, 20);
    expect(undone).not.toBeNull();
    expect(undone!.doc.nodes[0]!.data.title).toBe('改之前');
    expect(canRedoCanvas(undone!.history)).toBe(true);

    const redone = redoCanvasHistory(undone!.history, undone!.doc, 30);
    expect(redone!.doc.nodes[0]!.data.title).toBe('改之后');
    expect(canRedoCanvas(redone!.history)).toBe(false);
  });

  it('栈空时撤销/重做返回 null（界面按钮据此置灰）', () => {
    expect(undoCanvasHistory(createCanvasHistory(), docWith('x'))).toBeNull();
    expect(redoCanvasHistory(createCanvasHistory(), docWith('x'))).toBeNull();
  });

  it('同一合并键的连续输入只算一步（打字不会一步一个字）', () => {
    let history = createCanvasHistory();
    history = recordCanvasHistory(history, docWith('a'), { coalesceKey: 'draft:n1', now: 100 });
    history = recordCanvasHistory(history, docWith('b'), {
      coalesceKey: 'draft:n1',
      now: 100 + CANVAS_HISTORY_COALESCE_MS - 1,
    });
    expect(history.past).toHaveLength(1);

    // 超过窗口 → 新的一步
    history = recordCanvasHistory(history, docWith('c'), {
      coalesceKey: 'draft:n1',
      now: 100 + CANVAS_HISTORY_COALESCE_MS * 3,
    });
    expect(history.past).toHaveLength(2);
  });

  it('不同键不合并；新的编辑清空重做分支', () => {
    let history = recordCanvasHistory(createCanvasHistory(), docWith('a'), {
      coalesceKey: 'draft:n1',
      now: 1,
    });
    history = recordCanvasHistory(history, docWith('b'), { coalesceKey: 'draft:n2', now: 2 });
    expect(history.past).toHaveLength(2);

    const undone = undoCanvasHistory(history, docWith('c'), 3)!;
    expect(canRedoCanvas(undone.history)).toBe(true);
    const afterNewEdit = recordCanvasHistory(undone.history, undone.doc, { now: 4 });
    expect(canRedoCanvas(afterNewEdit)).toBe(false);
  });

  it('栈深有上限（不会无限吃内存）', () => {
    let history = createCanvasHistory();
    for (let index = 0; index < CANVAS_HISTORY_LIMIT + 10; index += 1) {
      history = recordCanvasHistory(history, docWith(`v${index}`), { now: index * 2000 });
    }
    expect(history.past).toHaveLength(CANVAS_HISTORY_LIMIT);
    // 留下的是最近的那一批（最旧的被丢掉）
    expect(history.past[0]!.nodes[0]!.data.title).toBe('v10');
  });

  it('恢复快照时：幸存节点的批次取当前值（撤销改字不会让进度倒退）', () => {
    const before = docWith('旧提示词', 1);
    before.nodes[0]!.data.batches = [
      { id: 'b1', taskId: 't1', createdAt: 1, status: 'queued', outputs: [] },
    ];
    const current = docWith('新提示词', 2);
    current.nodes[0]!.data.batches = [
      {
        id: 'b1',
        taskId: 't1',
        createdAt: 1,
        status: 'succeeded',
        outputs: [{ assetId: 'task:t1', kind: 'video', url: '/media/t1.mp4' }],
      },
    ];

    const restored = restoreCanvasHistoryDoc(before, current, 9);
    expect(restored.nodes[0]!.data.title).toBe('旧提示词');
    expect(restored.nodes[0]!.data.batches[0]!.status).toBe('succeeded');
    expect(restored.updatedAt).toBe(9);
  });

  it('撤销"删节点"：被恢复的节点用它自己在快照里的批次（当前已不存在）', () => {
    const before = docWith('要恢复', 1);
    before.nodes[0]!.data.batches = [
      { id: 'b1', createdAt: 1, status: 'succeeded', outputs: [{ assetId: 'a1', kind: 'image' }] },
    ];
    const current = createEmptyCanvasDoc('p1', '画布', 2);

    const restored = restoreCanvasHistoryDoc(before, current, 5);
    expect(restored.nodes).toHaveLength(1);
    expect(restored.nodes[0]!.data.batches).toHaveLength(1);
  });
});
