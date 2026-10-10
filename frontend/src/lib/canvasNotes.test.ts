import { describe, expect, it } from 'vitest';
import type { StorageLike } from './storage';
import {
  canvasNotesKey,
  createNote,
  loadCanvasNotes,
  removeNote,
  saveCanvasNotes,
  updateNote,
  type CanvasNote,
} from './canvasNotes';

/** 内存 Storage 桩（与 lib/storage 的 StorageLike 同形） */
function memoryStorage(initial: Record<string, string> = {}): StorageLike {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
  };
}

/**
 * 画布便签（V2.22 / 台账 B67）。
 *
 * 盯三件事：**按项目隔离**（便签属于这张图）、**坏数据不炸画布**（逐条跳过并计数）、
 * **增删改是纯函数**（组件只负责派发）。
 */
describe('画布便签（B67）', () => {
  const access = (initial: Record<string, string> = {}) => ({ local: memoryStorage(initial) });

  it('存→取 roundtrip（文本与位置一字不差）', () => {
    const storage = access();
    const notes = createNote([], { x: 120, y: 60 }, 1_000);
    saveCanvasNotes('default', notes, storage);

    const loaded = loadCanvasNotes('default', storage);
    expect(loaded.broken).toBe(0);
    expect(loaded.notes).toHaveLength(1);
    expect(loaded.notes[0]).toMatchObject({ text: '', x: 120, y: 60 });
  });

  it('**按项目隔离**：另一个项目读不到本项目的便签', () => {
    const storage = access();
    saveCanvasNotes('proj-a', createNote([], { x: 0, y: 0 }), storage);
    expect(loadCanvasNotes('proj-b', storage).notes).toEqual([]);
    expect(loadCanvasNotes('proj-a', storage).notes).toHaveLength(1);
  });

  it('坏数据逐条跳过并计数（便签是便利功能，不该让画布白屏）', () => {
    const storage = access({
      [canvasNotesKey('default')]: JSON.stringify([
        { id: 'ok', text: '这条链是给客户 A 的', x: 10, y: 20, updatedAt: 1 },
        { id: '', text: '缺 id', x: 0, y: 0 }, // 坏：id 为空
        { id: 'nan', text: '坐标不是数字', x: 'x', y: 0 }, // 坏：x 不是数字
        'not an object', // 坏
      ]),
    });
    const loaded = loadCanvasNotes('default', storage);
    expect(loaded.notes).toHaveLength(1);
    expect(loaded.broken).toBe(3);
  });

  it('JSON 坏 / 不是数组 → 空 + 不抛（画布照常渲染）', () => {
    expect(loadCanvasNotes('default', access({ [canvasNotesKey('default')]: '{bad' })).notes).toEqual(
      [],
    );
    expect(
      loadCanvasNotes('default', access({ [canvasNotesKey('default')]: '{"a":1}' })).notes,
    ).toEqual([]);
  });

  it('增删改：id 稳定、改文本不动位置、删掉只删那一条', () => {
    const first = createNote([], { x: 5, y: 5 }, 1_000);
    const id = first[0]!.id;

    const withText = updateNote(first, id, { text: '这是试错留下的废链' }, 2_000);
    expect(withText[0]).toMatchObject({ id, text: '这是试错留下的废链', x: 5, y: 5, updatedAt: 2_000 });

    const moved = updateNote(withText, id, { x: 99 }, 3_000);
    expect(moved[0]).toMatchObject({ x: 99, y: 5, text: '这是试错留下的废链' });

    const two: CanvasNote[] = [...moved, ...createNote(moved, { x: 1, y: 1 }, 4_000)];
    expect(removeNote(two, id)).toHaveLength(1);
    expect(removeNote(two, id)[0]!.id).not.toBe(id);
  });
});
