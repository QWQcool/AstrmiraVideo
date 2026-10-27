import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SubjectLimitError, SubjectStore } from './subjects.js';

/**
 * 主体库存储（CONTRACT §21-18 / V2.86）。
 *
 * 钉的是四条纪律：整份数组落盘、空素材允许、坏文件先备份、删主体不动别人的数据。
 */

const dirs: string[] = [];

function harness(): { store: SubjectStore; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'astrmira-subjects-'));
  dirs.push(dir);
  const file = path.join(dir, 'subjects.json');
  return { store: new SubjectStore(file), file };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('主体库存储', () => {
  it('空库返回空数组（不是错误），文件不存在也不写空文件', () => {
    const { store, file } = harness();
    expect(store.list()).toEqual([]);
    expect(() => readFileSync(file, 'utf8')).toThrow();
  });

  it('新建后可读回，落盘是单个 JSON 数组', () => {
    const { store, file } = harness();
    const created = store.create(
      { name: '斯坦茜', description: '中年女性，酒红高领毛衣', assetIds: ['a1', 'a2'] },
      1_700_000_000_000,
    );

    expect(created.name).toBe('斯坦茜');
    expect(created.assetIds).toEqual(['a1', 'a2']);
    expect(created.createdAt).toBe(1_700_000_000_000);

    const onDisk = JSON.parse(readFileSync(file, 'utf8')) as unknown[];
    expect(Array.isArray(onDisk)).toBe(true);
    expect(onDisk).toHaveLength(1);
    expect(store.list()).toHaveLength(1);
  });

  it('允许先建名字、后挑图（assetIds 可以为空）', () => {
    const { store } = harness();
    const created = store.create({ name: '小院', assetIds: [] });
    expect(created.assetIds).toEqual([]);

    const patched = store.update(created.id, { assetIds: ['a9'] });
    expect(patched?.assetIds).toEqual(['a9']);
  });

  it('素材 id 去重且保序（同一个素材拖两次不该变成两条参考）', () => {
    const { store } = harness();
    const created = store.create({ name: 'A', assetIds: ['a1', 'a2', 'a1'] });
    expect(created.assetIds).toEqual(['a1', 'a2']);
  });

  it('改名 / 清空描述 / 清空素材都是显式动作', () => {
    const { store } = harness();
    const created = store.create({ name: 'A', description: '说明', assetIds: ['a1'] });

    const renamed = store.update(created.id, { name: 'B' });
    expect(renamed?.name).toBe('B');
    // 没给的字段不动（否则"改个名字把描述弄丢"）
    expect(renamed?.description).toBe('说明');

    const cleared = store.update(created.id, { description: '', assetIds: [] });
    expect(cleared?.description).toBeUndefined();
    expect(cleared?.assetIds).toEqual([]);
  });

  it('改 / 删不存在的主体返回 null / false（不静默创建）', () => {
    const { store, file } = harness();
    expect(store.update('nope', { name: 'B' })).toBeNull();
    expect(store.remove('nope')).toBe(false);
    expect(() => readFileSync(file, 'utf8')).toThrow();
  });

  it('删除只摘掉这一条，其余原样', () => {
    const { store } = harness();
    const first = store.create({ name: 'A' }, 1);
    store.create({ name: 'B' }, 2);
    expect(store.remove(first.id)).toBe(true);
    expect(store.list().map((item) => item.name)).toEqual(['B']);
  });

  it('坏文件：读取按空库返回，写入前先备份原文（不静默抹掉用户数据）', () => {
    const { store, file } = harness();
    writeFileSync(file, '{ 这不是数组', 'utf8');
    expect(store.list()).toEqual([]);

    store.create({ name: 'A' });
    const backups = readdirSync(path.dirname(file)).filter((name) =>
      name.startsWith('subjects.json.broken-'),
    );
    expect(backups).toHaveLength(1);
    expect(readFileSync(path.join(path.dirname(file), backups[0] as string), 'utf8')).toContain(
      '这不是数组',
    );
    expect(store.list().map((item) => item.name)).toEqual(['A']);
  });

  it('条数上限：达到上限后拒绝新建并给可执行原因', () => {
    const { store } = harness();
    // 直接写一份已达上限的文件（走真实读路径，不调用 500 次 create）
    const filled = Array.from({ length: 500 }, (_unused, index) => ({
      id: `s-${index}`,
      name: `主体 ${index}`,
      assetIds: [],
      createdAt: index,
    }));
    const file = path.join(dirs[dirs.length - 1] as string, 'subjects.json');
    writeFileSync(file, JSON.stringify(filled), 'utf8');

    expect(() => store.create({ name: '再来一个' })).toThrow(SubjectLimitError);
    // 事务性：拒绝后库里仍是 500 条（不是 501 或 0）
    expect(store.list()).toHaveLength(500);
  });
});
