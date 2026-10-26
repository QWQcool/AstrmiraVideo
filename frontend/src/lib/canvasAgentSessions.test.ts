import { describe, expect, it, vi } from 'vitest';
import {
  clearAgentSession,
  loadAgentSession,
  saveAgentSession,
} from './canvasAgentSessions';

function memoryStore(): Map<string, string> {
  return new Map();
}

let store = memoryStore();

vi.mock('./storage', async () => {
  const actual = await vi.importActual<typeof import('./storage')>('./storage');
  return {
    ...actual,
    browserStorage: () => ({
      local: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    }),
  };
});

describe('画布助手会话持久化（S9-B）', () => {
  it('按画布 projectId 隔离：两个画布互不可见', () => {
    store = memoryStore();
    saveAgentSession('p1', [{ role: 'user', text: 'p1 的问题' }]);
    saveAgentSession('p2', [{ role: 'user', text: 'p2 的问题' }]);
    expect(loadAgentSession('p1').map((m) => m.text)).toEqual(['p1 的问题']);
    expect(loadAgentSession('p2').map((m) => m.text)).toEqual(['p2 的问题']);
  });

  it('B94：清除一个画布只清该画布，另一个画布历史保留', () => {
    store = memoryStore();
    saveAgentSession('scope-a', [{ role: 'user', text: 'A 历史' }]);
    saveAgentSession('scope-b', [{ role: 'user', text: 'B 历史' }]);
    clearAgentSession('scope-a');
    expect(loadAgentSession('scope-a')).toEqual([]);
    expect(loadAgentSession('scope-b').map((m) => m.text)).toEqual(['B 历史']);
  });

  it('损坏的 JSON / 非法条目被过滤，不抛错', () => {
    store = memoryStore();
    store.set('astrmira.canvasAgentSession.bad', '{broken');
    expect(loadAgentSession('bad')).toEqual([]);
    saveAgentSession('p3', [
      { role: 'user', text: 'ok' },
      // @ts-expect-error 模拟脏数据混入
      { role: 'system', text: '非对话条目' },
      // @ts-expect-error 模拟脏数据混入
      { role: 'assistant' },
    ]);
    expect(loadAgentSession('p3')).toEqual([{ role: 'user', text: 'ok' }]);
  });

  it('超出 60 条 FIFO 裁剪最旧；clear 后为空', () => {
    store = memoryStore();
    const many = Array.from({ length: 80 }, (_u, i) => ({
      role: 'user' as const,
      text: `消息 ${i}`,
    }));
    saveAgentSession('p4', many);
    const loaded = loadAgentSession('p4');
    expect(loaded).toHaveLength(60);
    expect(loaded[0]?.text).toBe('消息 20');
    expect(loaded.at(-1)?.text).toBe('消息 79');

    clearAgentSession('p4');
    expect(loadAgentSession('p4')).toEqual([]);
  });

  it('usage/model/freeform 等可选字段往返保留', () => {
    store = memoryStore();
    saveAgentSession('p5', [
      {
        role: 'assistant',
        text: '回答',
        model: 'deepseek-chat',
        usage: { promptTokens: 100, completionTokens: 50 },
        freeform: true,
      },
    ]);
    expect(loadAgentSession('p5')).toEqual([
      {
        role: 'assistant',
        text: '回答',
        model: 'deepseek-chat',
        usage: { promptTokens: 100, completionTokens: 50 },
        freeform: true,
      },
    ]);
  });
});
