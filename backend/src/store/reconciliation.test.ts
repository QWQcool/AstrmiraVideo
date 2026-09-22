import { afterEach, describe, expect, it } from 'vitest';
import type { VideoGenerateRequest } from '@astrmira/shared';
import { openDatabase } from './db.js';
import { reconcileOrphanTasks } from './reconciliation.js';
import { TaskStore } from './taskStore.js';
import type { Db } from './db.js';

/**
 * 启动调解（S5b）：把上次进程退出时遗留的 `running` 任务归档。
 *
 * 这是"进程崩了"与"钱已经花出去"之间的那条分界线：
 * **有上游痕迹的一律 uncertain，没有的才敢说可安全重试。**
 */

const request: VideoGenerateRequest = {
  prompt: '孤儿任务',
  mode: 't2v',
  aspectRatio: '16:9',
  provider: 'cloud-volcano-seedance',
};

let db: Db | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

function makeStore(): TaskStore {
  db = openDatabase(':memory:');
  return new TaskStore(db);
}

function insertRunning(
  store: TaskStore,
  taskId: string,
  extra: { upstreamTaskId?: string; submitting?: boolean } = {},
): void {
  store.insert({
    taskId,
    track: 'cloud',
    provider: 'cloud-volcano-seedance',
    status: 'running',
    progressPercent: 40,
    requestSnapshot: request,
    warnings: [],
    submitting: extra.submitting ?? false,
    ...(extra.upstreamTaskId === undefined ? {} : { upstreamTaskId: extra.upstreamTaskId }),
  });
}

describe('reconcileOrphanTasks', () => {
  it('有上游 taskId → UNCERTAIN（可能已计费，禁止自动重提）', () => {
    const store = makeStore();
    insertRunning(store, 'submitted', { upstreamTaskId: 'cgt-9' });

    const result = reconcileOrphanTasks(store);
    const record = store.get('submitted');

    expect(result.uncertain).toEqual(['submitted']);
    expect(result.retryable).toEqual([]);
    expect(record?.status).toBe('failed');
    expect(record?.error?.code).toBe('UNCERTAIN_RESULT');
    expect(record?.error?.disposition).toBe('uncertain');
    expect(record?.submitting).toBe(false);
  });

  it('没有上游 id 但 submitting=true → 仍归 UNCERTAIN（提交动作可能已发出）', () => {
    const store = makeStore();
    insertRunning(store, 'submitting', { submitting: true });

    const result = reconcileOrphanTasks(store);

    expect(result.uncertain).toEqual(['submitting']);
    expect(store.get('submitting')?.error?.disposition).toBe('uncertain');
  });

  it('干净现场（无 id 且未提交）→ UPSTREAM_ERROR 且可重试（重试无副作用）', () => {
    const store = makeStore();
    insertRunning(store, 'untouched');

    const result = reconcileOrphanTasks(store);
    const record = store.get('untouched');

    expect(result.retryable).toEqual(['untouched']);
    expect(record?.error?.code).toBe('UPSTREAM_ERROR');
    expect(record?.error?.disposition).toBe('retryable');
  });

  it('三类现场混在一起时各归各位', () => {
    const store = makeStore();
    insertRunning(store, 'a-submitted', { upstreamTaskId: 'cgt-1' });
    insertRunning(store, 'b-submitting', { submitting: true });
    insertRunning(store, 'c-clean');

    const result = reconcileOrphanTasks(store);

    expect(result.uncertain.sort()).toEqual(['a-submitted', 'b-submitting']);
    expect(result.retryable).toEqual(['c-clean']);
  });

  it('只动 running：终态与 queued 不被触碰（queued 是调度器的活）', () => {
    const store = makeStore();
    store.insert({
      taskId: 'done',
      track: 'cloud',
      provider: 'cloud-volcano-seedance',
      status: 'succeeded',
      progressPercent: 100,
      requestSnapshot: request,
      warnings: [],
      submitting: false,
    });
    store.insert({
      taskId: 'waiting',
      track: 'cloud',
      provider: 'cloud-volcano-seedance',
      status: 'queued',
      progressPercent: 0,
      requestSnapshot: request,
      warnings: [],
      submitting: true,
    });

    const result = reconcileOrphanTasks(store);

    expect(result.uncertain).toEqual([]);
    expect(result.retryable).toEqual([]);
    expect(store.get('done')?.status).toBe('succeeded');
    expect(store.get('waiting')?.status).toBe('queued');
  });

  it('重复执行是幂等的（第二次找不到 running 孤儿）', () => {
    const store = makeStore();
    insertRunning(store, 'x', { upstreamTaskId: 'cgt-1' });

    expect(reconcileOrphanTasks(store).uncertain).toEqual(['x']);
    expect(reconcileOrphanTasks(store).uncertain).toEqual([]);
  });
});
