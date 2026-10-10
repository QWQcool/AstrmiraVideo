import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../store/db.js';
import { EventLogStore } from '../store/eventLog.js';
import {
  DEFAULT_MAX_ROWS,
  DEFAULT_RETENTION_DAYS,
  isRetentionDisabled,
  resolveRetentionPolicy,
  startLogRetention,
  type PruneOutcome,
} from './logRetention.js';

/**
 * 操作日志保留策略（V2.18 / 台账 B23）。
 *
 * 断言侧重**四件事**：
 * ① 两条判据（按时间 / 按条数）各自生效、**各自也能关**（0 = 关，而不是"当作没配"）；
 * ② 条数用**水位**（删到 maxRows×ratio 以下就停），不是"永远精确等于 maxRows"；
 * ③ **只删日志**：任务表那些业务数据一条都不动；
 * ④ **真删了才留痕**（onPrune 只在 deleted > 0 时回调）。
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

describe('保留策略：判据与水位（B23）', () => {
  let db: Db;
  let store: EventLogStore;

  beforeEach(() => {
    db = openDatabase(':memory:');
    store = new EventLogStore(db);
  });

  afterEach(() => {
    db.close();
  });

  function append(ts: number, index: number): void {
    store.append({ ts, method: 'POST', path: `/api/x/${index}`, statusCode: 200 });
  }

  it('按时间：删掉超期的、留下窗口内的（边界：正好在线上的是"未超期"）', () => {
    append(NOW - 100 * DAY_MS, 1); // 超期
    append(NOW - 91 * DAY_MS, 2); // 超期
    append(NOW - 90 * DAY_MS, 3); // 正好 90 天 → 保留（`ts < cutoff` 才删）
    append(NOW - 1 * DAY_MS, 4); // 保留

    const outcome = store.prune({ maxAgeDays: 90, now: NOW });
    expect(outcome.deletedByAge).toBe(2);
    expect(outcome.remaining).toBe(2);
    expect(store.countAll()).toBe(2);
  });

  it('按条数：**水位式**删除（删到 80% 以下，而不是删到刚好等于上限）', () => {
    for (let index = 0; index < 120; index += 1) append(NOW - index * 1000, index);

    const outcome = store.prune({ maxRows: 100, now: NOW });
    // 120 → 目标 80（100 × 0.8），所以删 40
    expect(outcome.deletedByCount).toBe(40);
    expect(outcome.remaining).toBe(80);
  });

  it('没超上限 → 一条都不删（噪声纪律：没事发生就不要动手）', () => {
    for (let index = 0; index < 50; index += 1) append(NOW - index * 1000, index);
    const outcome = store.prune({ maxRows: 100, now: NOW });
    expect(outcome.deleted).toBe(0);
    expect(outcome.remaining).toBe(50);
  });

  it('两条判据叠加：先按时间删、再按条数收到水位（返回各自删了多少）', () => {
    for (let index = 0; index < 30; index += 1) append(NOW - (200 + index) * DAY_MS, index);
    for (let index = 0; index < 60; index += 1) append(NOW - index * DAY_MS, 100 + index);

    const outcome = store.prune({ maxAgeDays: 90, maxRows: 40, now: NOW });
    expect(outcome.deletedByAge).toBe(30); // 30 条超期
    expect(outcome.deletedByCount).toBe(28); // 剩 60 → 水位 32（40×0.8）→ 删 28
    expect(outcome.remaining).toBe(32);
    expect(outcome.deleted).toBe(outcome.deletedByAge + outcome.deletedByCount);
  });

  it('**只删日志**：任务表不受影响（这是"保留策略"与"数据清理"的分界线）', () => {
    db.prepare(
      `INSERT INTO tasks (task_id, track, provider, status, progress_percent, request_snapshot,
                          warnings, submitting, project_id, created_at, updated_at)
       VALUES ('keep-me', 'cloud', 'stub', 'succeeded', 100, '{}', '[]', 0, 'default', ?, ?)`,
    ).run(NOW - 999 * DAY_MS, NOW - 999 * DAY_MS);
    append(NOW - 999 * DAY_MS, 1);

    store.prune({ maxAgeDays: 1, now: NOW });

    const tasks = db.prepare('SELECT COUNT(*) AS count FROM tasks').get() as { count: number };
    expect(tasks.count).toBe(1);
    expect(store.countAll()).toBe(0);
  });

  it('用户手动清空仍然可用（保留策略不改变"你还能自己删"这条既有能力）', () => {
    append(NOW, 1);
    append(NOW, 2);
    expect(store.clear()).toBe(2);
    expect(store.countAll()).toBe(0);
  });
});

describe('保留策略：env 解析与执行器（B23）', () => {
  it('没配 → 用默认（90 天 / 20 万行）；**0 是合法值**（关闭该判据）', () => {
    expect(resolveRetentionPolicy({})).toEqual({
      maxAgeDays: DEFAULT_RETENTION_DAYS,
      maxRows: DEFAULT_MAX_ROWS,
    });
    expect(resolveRetentionPolicy({ LOG_RETENTION_DAYS: '0' })).toEqual({
      maxAgeDays: 0,
      maxRows: DEFAULT_MAX_ROWS,
    });
    expect(resolveRetentionPolicy({ LOG_MAX_ROWS: '0' }).maxRows).toBe(0);
  });

  it('坏值（空串 / 非数字 / 负数）→ 回落默认，不会静默变成 0', () => {
    expect(resolveRetentionPolicy({ LOG_RETENTION_DAYS: '' }).maxAgeDays).toBe(DEFAULT_RETENTION_DAYS);
    expect(resolveRetentionPolicy({ LOG_RETENTION_DAYS: 'abc' }).maxAgeDays).toBe(
      DEFAULT_RETENTION_DAYS,
    );
    expect(resolveRetentionPolicy({ LOG_MAX_ROWS: '-5' }).maxRows).toBe(DEFAULT_MAX_ROWS);
    expect(resolveRetentionPolicy({ LOG_RETENTION_DAYS: '30' }).maxAgeDays).toBe(30);
  });

  it('两条判据都关 = 策略关闭（顶层据此在启动时警告）', () => {
    expect(isRetentionDisabled({ maxAgeDays: 0, maxRows: 0 })).toBe(true);
    expect(isRetentionDisabled({ maxAgeDays: 0, maxRows: 100 })).toBe(false);
  });

  it('执行器：真删了才回调 onPrune；策略关闭时不删但**仍然报出真实条数**', async () => {
    const db = openDatabase(':memory:');
    const store = new EventLogStore(db);
    for (let index = 0; index < 10; index += 1) {
      store.append({ ts: NOW - (index + 100) * DAY_MS, method: 'POST', path: `/api/x/${index}` });
    }

    const events: PruneOutcome[] = [];
    const handle = startLogRetention({
      store,
      policy: { maxAgeDays: 90, maxRows: 0 },
      now: () => NOW,
      intervalMs: 60_000,
      onPrune: (outcome) => events.push(outcome),
    });
    await handle.drain();
    handle.stop();

    expect(events).toHaveLength(1);
    expect(events[0]!.deleted).toBe(10);
    expect(events[0]!.maxAgeDays).toBe(90);
    expect(store.countAll()).toBe(0);

    // 策略全关：不删、不回调，但 remaining 是**真实条数**（不是 0 —— 0 会把"没在长"与"没统计"混成一样）
    store.append({ ts: NOW, method: 'POST', path: '/api/y' });
    const disabled = startLogRetention({
      store,
      policy: { maxAgeDays: 0, maxRows: 0 },
      now: () => NOW,
      intervalMs: 60_000,
      onPrune: () => {
        throw new Error('策略关闭时不该回调 onPrune');
      },
    });
    const outcome = await disabled.runOnce();
    disabled.stop();
    expect(outcome.deleted).toBe(0);
    expect(outcome.remaining).toBe(1);

    db.close();
  });

  it('执行器：单飞（并发 runOnce 不会重复删）且出错只走 onError、不抛到调用方', async () => {
    const db = openDatabase(':memory:');
    const failures: unknown[] = [];
    const handle = startLogRetention({
      store: {
        prune: () => {
          throw new Error('boom');
        },
        countAll: () =>
          (db.prepare('SELECT COUNT(*) AS count FROM event_log').get() as { count: number }).count,
      },
      intervalMs: 60_000,
      onError: (error) => failures.push(error),
    });
    await handle.drain();
    handle.stop();
    expect(failures.length).toBeGreaterThan(0);
    db.close();
  });
});
