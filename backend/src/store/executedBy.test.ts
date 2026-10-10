import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveExecutedBy, type VideoGenerateRequest } from '@astrmira/shared';
import { SqliteJobQueue } from '../queue/SqliteJobQueue.js';
import { openDatabase, type Db } from './db.js';
import { TaskStore, toTaskProgress } from './taskStore.js';

/**
 * 任务执行位置 `executedBy`（V2.27 / 台账 A1 片 A，B11）。
 *
 * 盯四件事：
 * ① **入库那一刻定死**（由队列按 provider 判定，而不是读的时候反推）；
 * ② provider → 位置的映射（cloud 轨 vs 本地轨；将来 client-worker 另算）；
 * ③ **缺省 = 老任务**（读路径不猜 —— 不按 provider 反推历史事实）；
 * ④ 契约响应（`toTaskProgress`）如实透出。
 */

const SNAPSHOT: VideoGenerateRequest = {
  prompt: '执行位置用例',
  mode: 't2v',
  aspectRatio: '16:9',
  provider: 'fixture-local',
};

describe('执行位置 executedBy（V2.27 / A1 片 A）', () => {
  let db: Db;
  let store: TaskStore;

  beforeEach(() => {
    db = openDatabase(':memory:');
    store = new TaskStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('resolveExecutedBy：云端 Seedance = cloud，其余（本地轨 / 开发期 provider）= host-local', () => {
    expect(resolveExecutedBy('cloud-volcano-seedance')).toBe('cloud');
    expect(resolveExecutedBy('local-minimax-h3')).toBe('host-local');
    expect(resolveExecutedBy('fixture-local')).toBe('host-local');
    expect(resolveExecutedBy('stock-local')).toBe('host-local');
  });

  it('队列提交时按 provider 写死（cloud 轨 / 本地轨各一条）', async () => {
    const queue = new SqliteJobQueue(store);

    await queue.submit({
      taskId: 'task-local',
      track: 'local',
      request: { ...SNAPSHOT, provider: 'fixture-local' },
      idempotencyKey: 'key-local',
      submitting: false,
    });
    await queue.submit({
      taskId: 'task-cloud',
      track: 'cloud',
      request: { ...SNAPSHOT, provider: 'cloud-volcano-seedance' },
      idempotencyKey: 'key-cloud',
      submitting: false,
    });

    expect(store.get('task-local')?.executedBy).toBe('host-local');
    expect(store.get('task-cloud')?.executedBy).toBe('cloud');
  });

  it('契约响应透出 executedBy；**缺省 = 老任务**（不猜）', () => {
    store.insert({
      taskId: 'task-with',
      track: 'local',
      provider: 'fixture-local',
      status: 'queued',
      progressPercent: 0,
      requestSnapshot: SNAPSHOT,
      warnings: [],
      submitting: false,
      executedBy: 'client-worker',
    });
    // 模拟 V2.27 之前的老行：不传 executedBy
    store.insert({
      taskId: 'task-legacy',
      track: 'cloud',
      provider: 'cloud-volcano-seedance',
      status: 'succeeded',
      progressPercent: 100,
      requestSnapshot: { ...SNAPSHOT, provider: 'cloud-volcano-seedance' },
      warnings: [],
      submitting: false,
    });

    const withValue = toTaskProgress(store.get('task-with')!);
    expect(withValue.executedBy).toBe('client-worker');

    const legacy = toTaskProgress(store.get('task-legacy')!);
    // 关键断言：**不按 provider 反推**（老任务就是没有这个事实 —— 猜一个比缺省更糟）
    expect(legacy.executedBy).toBeUndefined();
    expect('executedBy' in legacy).toBe(false);
  });

  it('更新路径不会把老任务的 executedBy"补写"成推测值', () => {
    store.insert({
      taskId: 'task-legacy-2',
      track: 'cloud',
      provider: 'cloud-volcano-seedance',
      status: 'queued',
      progressPercent: 0,
      requestSnapshot: SNAPSHOT,
      warnings: [],
      submitting: false,
    });
    store.update('task-legacy-2', { status: 'succeeded', progressPercent: 100 });
    expect(store.get('task-legacy-2')?.executedBy).toBeUndefined();
  });
});
