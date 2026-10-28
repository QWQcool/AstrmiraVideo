import { describe, expect, it } from 'vitest';
import {
  ComfyProgressTracker,
  parseComfyBinaryFrame,
  type ComfySocket,
} from './comfyuiProgress.js';

/**
 * B104：ComfyUI 的采样预览帧（V2.95）。
 *
 * 两条要钉死的东西：
 * 1. **协议解析**：前 4 字节事件类型（1 = 预览图）+ 4 字节图片格式（1 = JPEG / 2 = PNG）；
 * 2. **归属**：二进制帧本身不带 prompt_id，只能归给"最近在跑的那条"；
 *    没有在跑的任务时**宁可丢掉**，也不能挂到别的任务上（张冠李戴比没有更糟）。
 */

function frame(eventType: number, format: number, payload: number[]): Uint8Array {
  const bytes = new Uint8Array(8 + payload.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, eventType, false);
  view.setUint32(4, format, false);
  bytes.set(payload, 8);
  return bytes;
}

describe('ComfyUI 二进制预览帧解析（B104）', () => {
  it('类型 1 + 格式 1 = JPEG', () => {
    const reduction = parseComfyBinaryFrame(frame(1, 1, [0xff, 0xd8, 0xff]));
    expect(reduction).toEqual({
      kind: 'preview',
      mime: 'image/jpeg',
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
    });
  });

  it('类型 1 + 格式 2 = PNG', () => {
    const reduction = parseComfyBinaryFrame(frame(1, 2, [0x89, 0x50]));
    expect(reduction.kind).toBe('preview');
    if (reduction.kind === 'preview') expect(reduction.mime).toBe('image/png');
  });

  it('ArrayBuffer 与 Buffer 都认（Node 的 WS 两种都可能给）', () => {
    const bytes = frame(1, 1, [1, 2, 3]);
    expect(parseComfyBinaryFrame(bytes.slice().buffer).kind).toBe('preview');
    expect(parseComfyBinaryFrame(Buffer.from(bytes)).kind).toBe('preview');
  });

  it('非预览事件（文本 / 旧版未压缩）与太短的帧一律忽略', () => {
    expect(parseComfyBinaryFrame(frame(3, 0, [1, 2])).kind).toBe('ignore');
    expect(parseComfyBinaryFrame(frame(1, 9, [1, 2])).kind).toBe('ignore');
    expect(parseComfyBinaryFrame(new Uint8Array([0, 0, 0, 1])).kind).toBe('ignore');
    expect(parseComfyBinaryFrame('不是二进制').kind).toBe('ignore');
    expect(parseComfyBinaryFrame(null).kind).toBe('ignore');
  });

  it('没有图片字节的帧不算预览（空图会让界面显示破图）', () => {
    expect(parseComfyBinaryFrame(frame(1, 1, [])).kind).toBe('ignore');
  });
});

/** 假 socket：能手动推消息，方便钉"归属"与"过期" */
function fakeSocket(): {
  socket: ComfySocket;
  emit: (data: unknown) => void;
} {
  const listeners: Array<(event: { data?: unknown }) => void> = [];
  return {
    socket: {
      addEventListener: (type, listener) => {
        if (type === 'message') listeners.push(listener);
      },
      close: () => {},
    },
    emit: (data) => {
      for (const listener of listeners) listener({ data });
    },
  };
}

describe('预览帧的归属与过期（B104）', () => {
  it('收到 progress 之后才有归属：之前来的二进制帧被丢掉', () => {
    const { socket, emit } = fakeSocket();
    const tracker = new ComfyProgressTracker({ baseUrl: 'http://x', createSocket: () => socket });
    tracker.start();

    emit(frame(1, 1, [1, 2, 3]));
    expect(tracker.previewSeq('p1')).toBeNull();

    emit(JSON.stringify({ type: 'progress', data: { value: 1, max: 4, prompt_id: 'p1' } }));
    emit(frame(1, 1, [4, 5, 6]));
    expect(tracker.previewSeq('p1')).toBe(1);
    expect(tracker.preview('p1')?.mime).toBe('image/jpeg');
  });

  it('seq 递增（前端靠它判断要不要重下）', () => {
    const { socket, emit } = fakeSocket();
    const tracker = new ComfyProgressTracker({ baseUrl: 'http://x', createSocket: () => socket });
    tracker.start();
    emit(JSON.stringify({ type: 'progress', data: { value: 1, max: 4, prompt_id: 'p1' } }));
    emit(frame(1, 1, [1]));
    emit(frame(1, 1, [2]));
    expect(tracker.previewSeq('p1')).toBe(2);
  });

  it('任务完成 → 预览立刻丢（界面该看成片，不是最后一帧糊图）', () => {
    const { socket, emit } = fakeSocket();
    const tracker = new ComfyProgressTracker({ baseUrl: 'http://x', createSocket: () => socket });
    tracker.start();
    emit(JSON.stringify({ type: 'progress', data: { value: 1, max: 4, prompt_id: 'p1' } }));
    emit(frame(1, 1, [1]));
    emit(JSON.stringify({ type: 'executing', data: { node: null, prompt_id: 'p1' } }));
    expect(tracker.previewSeq('p1')).toBeNull();
  });

  it('超过 TTL 没更新 → 不认（ComfyUI 重启后 prompt_id 会重来）', () => {
    const { socket, emit } = fakeSocket();
    let now = 1_000;
    const tracker = new ComfyProgressTracker({
      baseUrl: 'http://x',
      createSocket: () => socket,
      now: () => now,
      ttlMs: 5_000,
    });
    tracker.start();
    emit(JSON.stringify({ type: 'progress', data: { value: 1, max: 4, prompt_id: 'p1' } }));
    emit(frame(1, 1, [1]));
    expect(tracker.previewSeq('p1')).toBe(1);
    now += 6_000;
    expect(tracker.previewSeq('p1')).toBeNull();
  });
});
