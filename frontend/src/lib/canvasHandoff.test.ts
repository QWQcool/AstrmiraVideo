import { describe, expect, it } from 'vitest';
import {
  parseCanvasResultHandoff,
  peekCanvasResultHandoff,
  resultHandoffAsset,
  setCanvasResultHandoff,
  takeCanvasResultHandoff,
} from './canvasHandoff';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { dump: () => string | null } {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    dump: () => (map.values().next().value as string | undefined) ?? null,
  };
}

describe('画布结果交接（S4）', () => {
  it('写入 → 读取 → 消费一次', () => {
    const storage = memoryStorage();
    setCanvasResultHandoff(
      { taskId: 't1', kind: 'video', url: '/media/t1.mp4', title: '一条视频' },
      storage,
    );
    expect(peekCanvasResultHandoff(storage)).toEqual({
      taskId: 't1',
      kind: 'video',
      url: '/media/t1.mp4',
      title: '一条视频',
    });
    expect(takeCanvasResultHandoff(storage)?.taskId).toBe('t1');
    expect(takeCanvasResultHandoff(storage)).toBeNull();
  });

  it('parse 拒绝坏数据 / 外部地址 / 未知类型', () => {
    expect(parseCanvasResultHandoff(null)).toBeNull();
    expect(parseCanvasResultHandoff('not json')).toBeNull();
    expect(parseCanvasResultHandoff('{}')).toBeNull();
    expect(
      parseCanvasResultHandoff(
        JSON.stringify({ taskId: 't1', kind: 'video', url: 'https://evil.example/x.mp4', title: 'x' }),
      ),
    ).toBeNull();
    expect(
      parseCanvasResultHandoff(
        JSON.stringify({ taskId: 't1', kind: 'text', url: '/media/x', title: 'x' }),
      ),
    ).toBeNull();
    expect(
      parseCanvasResultHandoff(
        JSON.stringify({ taskId: '', kind: 'image', url: '/media/x.png', title: 'x' }),
      ),
    ).toBeNull();
  });

  it('Storage 抛错时退化而不抛异常', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() =>
      setCanvasResultHandoff({ taskId: 't1', kind: 'image', url: '/media/a.png', title: 'a' }, broken),
    ).not.toThrow();
    expect(peekCanvasResultHandoff(broken)).toBeNull();
    expect(takeCanvasResultHandoff(broken)).toBeNull();
  });

  it('交接 → assetId 是 task:<taskId>（不复制文件）', () => {
    expect(
      resultHandoffAsset({ taskId: 'abc', kind: 'image', url: '/media/a.png', title: '图' }),
    ).toEqual({ assetId: 'task:abc', kind: 'image', url: '/media/a.png', name: '图' });
  });
});
