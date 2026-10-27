import { describe, expect, it } from 'vitest';
import {
  ComfyProgressTracker,
  comfyWsUrl,
  reduceComfyEvent,
  type ComfySocket,
} from './comfyuiProgress.js';

/**
 * V2.82：ComfyUI 的 WS 进度。
 *
 * 这一层的价值全在"**不编造**"：拿不到就是 null（调用方继续显示 0 + 说明），
 * 拿到就显示真数字。所以测试重点不是"能不能连 ComfyUI"，而是
 * ①事件收敛对不对 ②过期与断开后会不会返回陈旧值。
 */

function fakeSocket(): { socket: ComfySocket; emit(type: string, data?: unknown): void } {
  const listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
  return {
    socket: {
      addEventListener(type, listener) {
        const list = listeners.get(type) ?? [];
        list.push(listener);
        listeners.set(type, list);
      },
      close() {
        for (const listener of listeners.get('close') ?? []) listener({});
      },
    },
    emit(type, data) {
      for (const listener of listeners.get(type) ?? []) listener({ data });
    },
  };
}

const progressMessage = (promptId: string, value: number, max: number): string =>
  JSON.stringify({ type: 'progress', data: { value, max, prompt_id: promptId, node: '64' } });

describe('ComfyUI 事件收敛', () => {
  it('progress → 百分比（四舍五入），越界夹紧', () => {
    expect(reduceComfyEvent({ type: 'progress', data: { value: 1, max: 4, prompt_id: 'p' } })).toEqual({
      kind: 'progress',
      promptId: 'p',
      percent: 25,
    });
    expect(reduceComfyEvent({ type: 'progress', data: { value: 9, max: 4, prompt_id: 'p' } })).toEqual({
      kind: 'progress',
      promptId: 'p',
      percent: 100,
    });
  });

  it('executing + node=null → 完成信号（ComfyUI 用这个表示这条跑完了）', () => {
    expect(reduceComfyEvent({ type: 'executing', data: { node: null, prompt_id: 'p' } })).toEqual({
      kind: 'done',
      promptId: 'p',
    });
    // 有 node 的 executing 只代表"开始跑某个节点"，没有百分比 → 忽略
    expect(reduceComfyEvent({ type: 'executing', data: { node: '64', prompt_id: 'p' } })).toEqual({
      kind: 'ignore',
    });
  });

  it('其它消息（status / execution_cached / 二进制预览）一律忽略', () => {
    expect(reduceComfyEvent({ type: 'status', data: { prompt_id: 'p' } })).toEqual({ kind: 'ignore' });
    expect(reduceComfyEvent({ type: 'execution_cached', data: { prompt_id: 'p' } })).toEqual({
      kind: 'ignore',
    });
    expect(reduceComfyEvent('not json')).toEqual({ kind: 'ignore' });
    expect(reduceComfyEvent({ type: 'progress', data: { value: 1, max: 0, prompt_id: 'p' } })).toEqual({
      kind: 'ignore',
    });
  });
});

describe('进度跟踪器', () => {
  it('收到 progress 后能查到；收到完成信号后清掉（不残留 100%）', () => {
    const fake = fakeSocket();
    let clock = 1000;
    const tracker = new ComfyProgressTracker({
      baseUrl: 'http://127.0.0.1:8190',
      createSocket: () => fake.socket,
      now: () => clock,
    });
    tracker.start();

    expect(tracker.progress('p1')).toBeNull();
    fake.emit('message', progressMessage('p1', 2, 4));
    expect(tracker.progress('p1')).toEqual({ percent: 50 });

    clock += 10;
    fake.emit('message', JSON.stringify({ type: 'executing', data: { node: null, prompt_id: 'p1' } }));
    expect(tracker.progress('p1')).toBeNull();
    tracker.stop();
  });

  it('进度过期（ComfyUI 重启 / 事件断了）→ 返回 null，而不是停在旧值', () => {
    const fake = fakeSocket();
    let clock = 1000;
    const tracker = new ComfyProgressTracker({
      baseUrl: 'http://127.0.0.1:8190',
      createSocket: () => fake.socket,
      now: () => clock,
      ttlMs: 5_000,
    });
    tracker.start();
    fake.emit('message', progressMessage('p1', 1, 4));
    expect(tracker.progress('p1')).toEqual({ percent: 25 });

    clock += 6_000;
    expect(tracker.progress('p1')).toBeNull();
    tracker.stop();
  });

  it('环境不支持 WS（工厂返回 null）→ 静默降级，不抛错也没有进度', () => {
    const tracker = new ComfyProgressTracker({
      baseUrl: 'http://127.0.0.1:8190',
      createSocket: () => null,
    });
    tracker.start();
    expect(tracker.progress('p1')).toBeNull();
    tracker.stop();
  });

  it('start 幂等：多次调用只建一条连接', () => {
    const fake = fakeSocket();
    let created = 0;
    const tracker = new ComfyProgressTracker({
      baseUrl: 'http://127.0.0.1:8190',
      createSocket: () => {
        created += 1;
        return fake.socket;
      },
    });
    tracker.start();
    tracker.start();
    tracker.start();
    expect(created).toBe(1);
    tracker.stop();
  });

  it('V2.90：连接事实可观测 —— open 计数、断开后 state=closed、重连计数只 +1', () => {
    const fake = fakeSocket();
    const tracker = new ComfyProgressTracker({
      baseUrl: 'http://127.0.0.1:8190',
      createSocket: () => fake.socket,
      reconnectMs: 60_000,
    });

    tracker.start();
    // 构造出 socket ≠ 连上：open 之前是 connecting
    expect(tracker.stats()).toMatchObject({ state: 'connecting', opens: 0, reconnects: 0 });

    fake.emit('open');
    expect(tracker.stats()).toMatchObject({ state: 'connected', opens: 1, reconnects: 0 });

    // error 与 close 可能先后到达：只应该排一次重连、只 +1
    fake.emit('error');
    fake.emit('close');
    expect(tracker.stats()).toMatchObject({ state: 'closed', reconnects: 1 });

    tracker.stop();
    expect(tracker.stats().state).toBe('closed');
  });
});

describe('WS 地址拼接', () => {
  it('http → ws、https → wss，去掉尾斜杠并带上 clientId', () => {
    expect(comfyWsUrl('http://127.0.0.1:8190', 'astrmira')).toBe(
      'ws://127.0.0.1:8190/ws?clientId=astrmira',
    );
    expect(comfyWsUrl('https://gpu.example.com/', 'a b')).toBe(
      'wss://gpu.example.com/ws?clientId=a%20b',
    );
  });
});
