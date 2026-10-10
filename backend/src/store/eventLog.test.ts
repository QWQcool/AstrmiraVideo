import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from './db.js';
import type { Db } from './db.js';
import { EventLogStore } from './eventLog.js';
import type { NewEventLogEntry } from './eventLog.js';

/**
 * 操作日志存储（CONTRACT §10，V2.1）。
 *
 * 这里盯住的是三件"用起来才会疼"的事：
 * 1. 筛选条件必须**同时**作用于"查"和"清空"（否则"清空"清掉的不是你看到的那批）；
 * 2. 关键词的 `LIKE` 通配符必须转义（用户搜 `%` 不该命中全表）；
 * 3. 详情字段的 JSON 往返不能丢（排错全靠它）。
 */

let db: Db;
let store: EventLogStore;

function entry(overrides: Partial<NewEventLogEntry> = {}): NewEventLogEntry {
  return {
    ts: 1_700_000_000_000,
    method: 'POST',
    path: '/api/generate',
    ...overrides,
  };
}

beforeEach(() => {
  db = openDatabase(':memory:');
  store = new EventLogStore(db);
});

afterEach(() => {
  db.close();
});

describe('写入与读取', () => {
  it('按 ts 倒序返回，并带出全部字段（含 detail 的 JSON 往返）', () => {
    store.append(entry({ ts: 100, action: 'generate.submit', detail: { model: 'm-1', n: 2 } }));
    store.append(entry({ ts: 200, action: 'upload', ip: '203.0.113.7', statusCode: 200 }));

    const { items, total } = store.list();

    expect(total).toBe(2);
    expect(items[0]?.ts).toBe(200);
    expect(items[0]?.ip).toBe('203.0.113.7');
    expect(items[1]?.detail).toEqual({ model: 'm-1', n: 2 });
  });

  it('可选字段不写时不会变成 null 字面量（前端不用区分 null 与缺省）', () => {
    store.append(entry());

    const { items } = store.list();
    expect(items[0]).toEqual({
      id: expect.any(Number) as number,
      ts: 1_700_000_000_000,
      method: 'POST',
      path: '/api/generate',
    });
  });
});

describe('筛选', () => {
  beforeEach(() => {
    store.append(entry({ ts: 1, ip: 'a', action: 'upload' }));
    store.append(entry({ ts: 2, ip: 'b', action: 'generate.submit', errorCode: 'UPSTREAM_ERROR' }));
    store.append(entry({ ts: 3, ip: 'b', action: 'generate.submit', body: '{"prompt":"雨夜"}' }));
  });

  it('按 ip / action / errorCode / 时间范围', () => {
    expect(store.list({ ip: 'b' }).total).toBe(2);
    expect(store.list({ action: 'upload' }).total).toBe(1);
    expect(store.list({ errorCode: 'UPSTREAM_ERROR' }).total).toBe(1);
    expect(store.list({ since: 2 }).total).toBe(2);
    expect(store.list({ since: 2, until: 2 }).total).toBe(1);
  });

  it('关键词命中 path / body / ip，且 % 被转义（不会变成"匹配全部"）', () => {
    expect(store.list({ q: '雨夜' }).total).toBe(1);
    expect(store.list({ q: 'upload' }).total).toBe(1);
    expect(store.list({ q: '%' }).total).toBe(0);
    expect(store.list({ q: '_' }).total).toBe(0);
  });

  it('分页：limit 生效而 total 仍是筛选后的总数', () => {
    const { items, total } = store.list({ limit: 1, offset: 1 });

    expect(items).toHaveLength(1);
    expect(items[0]?.ts).toBe(2);
    expect(total).toBe(3);
  });
});

describe('删除（用户明确要求"可手动删"）', () => {
  beforeEach(() => {
    store.append(entry({ ts: 1, ip: 'a' }));
    store.append(entry({ ts: 2, ip: 'b' }));
    store.append(entry({ ts: 3, ip: 'b' }));
  });

  it('删单条按 id，返回实际删除条数（幂等：删不存在的是 0）', () => {
    const { items } = store.list();
    const target = items[0]?.id as number;

    expect(store.remove(target)).toBe(1);
    expect(store.remove(target)).toBe(0);
    expect(store.list().total).toBe(2);
  });

  it('清空**带筛选**时只清筛选命中的那批（与界面"清空当前筛选"语义一致）', () => {
    expect(store.clear({ ip: 'b' })).toBe(2);
    expect(store.list().total).toBe(1);
  });

  it('清空不带筛选 = 全清', () => {
    expect(store.clear()).toBe(3);
    expect(store.list().total).toBe(0);
  });
});

/**
 * V2.19（台账 B62）：`?taskId=` 过滤 —— 画布节点检查器看"这条任务的全部留痕"。
 * 它同时也是**清空**的筛选条件之一（同一条纪律：查什么就清什么）。
 */
describe('按任务过滤（B62）', () => {
  it('只返回该任务的留痕；空串与 undefined 都视为"不过滤"', () => {
    store.append(entry({ ts: 300, taskId: 'task-a', action: 'generate.submit' }));
    store.append(entry({ ts: 200, taskId: 'task-a', action: 'task.complete', method: 'TASK' }));
    store.append(entry({ ts: 100, taskId: 'task-b', action: 'generate.submit' }));

    const filtered = store.list({ taskId: 'task-a' });
    expect(filtered.total).toBe(2);
    expect(filtered.items.map((item) => item.action)).toEqual(['generate.submit', 'task.complete']);

    // 空串 = 不过滤（HTTP 查询串里 `?taskId=` 是常见形态，不该变成"筛出零条"）
    expect(store.list({ taskId: '' }).total).toBe(3);
    expect(store.list({}).total).toBe(3);
  });

  it('可与其它筛选叠加，且**清空**同样只清该任务的那批', () => {
    store.append(entry({ ts: 300, taskId: 'task-a', action: 'task.complete', method: 'TASK' }));
    store.append(entry({ ts: 200, taskId: 'task-a', action: 'task.fail', statusCode: 500 }));
    store.append(entry({ ts: 100, taskId: 'task-b', action: 'generate.submit' }));

    expect(store.list({ taskId: 'task-a', action: 'task.fail' }).total).toBe(1);
    expect(store.clear({ taskId: 'task-a' })).toBe(2);
    expect(store.list().total).toBe(1);
    expect(store.list().items[0]!.taskId).toBe('task-b');
  });
});
