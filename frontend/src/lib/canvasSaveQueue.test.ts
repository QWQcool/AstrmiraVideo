import { describe, expect, it, vi } from 'vitest';
import { createEmptyCanvasDoc, type CanvasDoc } from '@astrmira/shared';
import { createCanvasSaveQueue, type CanvasSaveState } from './canvasSaveQueue';

function docWithName(name: string): CanvasDoc {
  const doc = createEmptyCanvasDoc('p1', name, 1);
  return doc;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const wait = (ms = 20) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('画布保存队列（S4-R1a）', () => {
  it('去抖后只保存最后一次文档；dirty → saving → saved', async () => {
    const states: CanvasSaveState[] = [];
    const save = vi.fn<(doc: CanvasDoc) => Promise<void>>(async () => undefined);
    const queue = createCanvasSaveQueue({
      save,
      onState: (state) => states.push(state),
      delayMs: 5,
    });

    queue.schedule(docWithName('first'));
    queue.schedule(docWithName('second'));
    queue.schedule(docWithName('third'));
    expect(states[0]).toBe('dirty');
    await wait();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].name).toBe('third');
    expect(states).toEqual(['dirty', 'dirty', 'dirty', 'saving', 'saved']);
    expect(queue.isDirty()).toBe(false);
  });

  it('保存期间的新修改会再存一次，中间不报 saved', async () => {
    const first = deferred<void>();
    const states: CanvasSaveState[] = [];
    const save = vi
      .fn<(doc: CanvasDoc) => Promise<void>>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(undefined);
    const queue = createCanvasSaveQueue({
      save,
      onState: (state) => states.push(state),
      delayMs: 1,
    });

    queue.schedule(docWithName('a'));
    await wait(5);
    expect(states).toEqual(['dirty', 'saving']);

    queue.schedule(docWithName('b'));
    expect(states.at(-1)).toBe('dirty');
    first.resolve();
    await wait(10);

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0].name).toBe('b');
    expect(states).toEqual(['dirty', 'saving', 'dirty', 'saving', 'saved']);
    expect(queue.isDirty()).toBe(false);
  });

  it('失败保留 dirty；flush 重试成功后才干净', async () => {
    const states: CanvasSaveState[] = [];
    const save = vi
      .fn<(doc: CanvasDoc) => Promise<void>>()
      .mockRejectedValueOnce(new Error('500'))
      .mockResolvedValueOnce(undefined);
    const queue = createCanvasSaveQueue({
      save,
      onState: (state) => states.push(state),
      delayMs: 1,
    });

    queue.schedule(docWithName('a'));
    await wait(5);
    expect(states).toEqual(['dirty', 'saving', 'error']);
    expect(queue.isDirty()).toBe(true);

    const ok = await queue.flush();
    expect(ok).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toBe('saved');
    expect(queue.isDirty()).toBe(false);
  });

  it('flush 在没有脏数据时直接成功，不发请求', async () => {
    const save = vi.fn<(doc: CanvasDoc) => Promise<void>>(async () => undefined);
    const queue = createCanvasSaveQueue({ save, onState: () => undefined, delayMs: 1 });
    expect(await queue.flush()).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it('settle 只等完在飞请求，不补存脏数据', async () => {
    const first = deferred<void>();
    const save = vi
      .fn<(doc: CanvasDoc) => Promise<void>>()
      .mockImplementationOnce(() => first.promise);
    const queue = createCanvasSaveQueue({ save, onState: () => undefined, delayMs: 1 });

    queue.schedule(docWithName('a'));
    await wait(5);
    queue.schedule(docWithName('b'));
    const settled = queue.settle();
    first.resolve();
    await settled;
    expect(save).toHaveBeenCalledTimes(1);
    expect(queue.isDirty()).toBe(true);
  });

  it('cancel 丢掉脏状态，并抑制在飞请求的迟到状态', async () => {
    const first = deferred<void>();
    const states: CanvasSaveState[] = [];
    const save = vi
      .fn<(doc: CanvasDoc) => Promise<void>>()
      .mockImplementationOnce(() => first.promise);
    const queue = createCanvasSaveQueue({
      save,
      onState: (state) => states.push(state),
      delayMs: 1,
    });

    queue.schedule(docWithName('a'));
    await wait(5);
    expect(states).toEqual(['dirty', 'saving']);
    queue.cancel();
    first.resolve();
    await wait(10);
    expect(states).toEqual(['dirty', 'saving']);
    expect(queue.isDirty()).toBe(false);
  });
});
