import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CreationRun, EditScript, VideoGenerateRequest } from '@astrmira/shared';
import { openDatabase, type Db } from '../store/db.js';
import { TaskStore, type TaskRecord } from '../store/taskStore.js';
import { SqliteJobQueue } from '../queue/SqliteJobQueue.js';
import { CreationRunService, type RunEnginePorts } from './creationRunEngine.js';
import { RunStore } from './runStore.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeRun(
  id: string,
  state: CreationRun['state'] = 'planned',
  stepOverride: Partial<CreationRun['steps'][number]> = {},
): CreationRun {
  return {
    version: 1,
    id,
    title: 'S10-R1 隔离测试',
    projectId: 'default',
    mode: 'unattended',
    provider: 'fixture-local',
    steps: [
      {
        id: 'img-1',
        kind: 'image',
        prompt: '首帧',
        aspectRatio: '16:9',
        resolutionTier: '720p',
        referenceAssetIds: [],
        dependsOn: [],
        status: 'pending',
        attempt: 0,
        ...stepOverride,
      },
    ],
    state,
    assemblyAttempt: 0,
    createdAt: 1,
    updatedAt: 1,
    ...(state === 'running' ? { startedAt: 1 } : {}),
  };
}

function requestSnapshot(): VideoGenerateRequest {
  return {
    prompt: '首帧',
    mode: 't2i',
    aspectRatio: '16:9',
    provider: 'fixture-local',
    projectId: 'default',
  };
}

function taskView(task: TaskRecord | null) {
  if (task === null) return null;
  if (task.status === 'succeeded') {
    return {
      status: 'succeeded' as const,
      hasOutput: task.outputImageUrl !== undefined || task.outputVideoUrl !== undefined,
    };
  }
  if (task.status === 'failed' || task.status === 'cancelled') {
    return {
      status: 'failed' as const,
      hasOutput: false,
      ...(task.error?.message === undefined ? {} : { message: task.error.message }),
    };
  }
  return { status: 'running' as const, hasOutput: false };
}

function makePorts(
  db: Db,
  counts: { submit: number; edit: number },
): { store: TaskStore; queue: SqliteJobQueue; ports: RunEnginePorts } {
  const store = new TaskStore(db);
  const queue = new SqliteJobQueue(store);
  const ports: RunEnginePorts = {
    getTask: (taskId) => taskView(store.get(taskId)),
    submit: async (request: VideoGenerateRequest, idempotencyKey: string) => {
      counts.submit += 1;
      const result = await queue.submit({
        taskId: randomUUID(),
        track: 'local',
        request,
        idempotencyKey,
        projectId: 'default',
        submitting: true,
      });
      return result.taskId;
    },
    submitEdit: async (_script: EditScript) => {
      counts.edit += 1;
      throw new Error('不应进入拼接');
    },
  };
  return { store, queue, ports };
}

function makeService(store: RunStore, ports: RunEnginePorts): CreationRunService {
  return new CreationRunService({
    load: (id) => store.get(id),
    save: (value) => store.update(value),
    ports,
    now: () => 12345,
  });
}

/**
 * 模拟 index.ts 的 5s 定时器：只照看 listActive。
 * 不额外调用 tick(planned)；直接 tick 由单独断言覆盖。
 */
async function schedulerPass(store: RunStore, service: CreationRunService): Promise<void> {
  for (const run of store.listActive()) await service.tick(run.id);
}

function setupDb(): { dir: string; dbPath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'astrmira-run-guard-'));
  dirs.push(dir);
  return { dir, dbPath: path.join(dir, 'app.db') };
}

describe('S10-R1 / B92 · planned 显式启动护栏', () => {
  it('planned 跨两个 tick + 重启仍不启动，startedAt/task/submit 都为零', async () => {
    const { dbPath } = setupDb();
    let db: Db = openDatabase(dbPath);
    const counts = { submit: 0, edit: 0 };
    let store = new RunStore(db);
    store.create(makeRun('planned-run'));
    let ctx = makePorts(db, counts);
    let service = makeService(store, ctx.ports);

    // 两个 5s 周期：listActive 不应包含 planned；直接 tick 也必须 no-op。
    await schedulerPass(store, service);
    await schedulerPass(store, service);
    await service.tick('planned-run');

    expect(store.get('planned-run')?.state).toBe('planned');
    expect(store.get('planned-run')?.startedAt).toBeUndefined();
    expect(counts.submit).toBe(0);
    expect(counts.edit).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n).toBe(0);

    // 重启：同一隔离数据目录，新 store/service；planned 仍不能被照看。
    db.close();
    db = openDatabase(dbPath);
    store = new RunStore(db);
    ctx = makePorts(db, counts);
    service = makeService(store, ctx.ports);
    expect(store.listActive()).toHaveLength(0);
    await schedulerPass(store, service);
    await service.tick('planned-run');
    expect(store.get('planned-run')?.state).toBe('planned');
    expect(store.get('planned-run')?.startedAt).toBeUndefined();
    expect(counts.submit).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n).toBe(0);
    db.close();
  });

  it('running 重启：已有 taskId 的步骤不会再次提交', async () => {
    const { dbPath } = setupDb();
    let db = openDatabase(dbPath);
    let store = new RunStore(db);
    const counts = { submit: 0, edit: 0 };
    let ctx = makePorts(db, counts);
    const existingTaskId = randomUUID();
    await ctx.queue.submit({
      taskId: existingTaskId,
      track: 'local',
      request: requestSnapshot(),
      idempotencyKey: 'run:running-restart:img-1:a0',
      projectId: 'default',
      submitting: true,
    });
    store.create(
      makeRun('running-restart', 'running', {
        status: 'submitting',
        taskId: existingTaskId,
      }),
    );
    expect((db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n).toBe(1);

    db.close();
    db = openDatabase(dbPath);
    store = new RunStore(db);
    ctx = makePorts(db, counts);
    const service = makeService(store, ctx.ports);
    await schedulerPass(store, service);

    const after = store.get('running-restart')!;
    expect(after.steps[0]?.taskId).toBe(existingTaskId);
    expect(after.state).toBe('running');
    expect(counts.submit).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n).toBe(1);
    expect((db.prepare("SELECT task_id FROM idempotency_keys WHERE key = ?").get(
      'run:running-restart:img-1:a0',
    ) as { task_id: string }).task_id).toBe(existingTaskId);
    db.close();
  });

  it('恢复窗口：任务已入库但步骤未回填 taskId，重启后用同一幂等键找回原任务', async () => {
    const { dbPath } = setupDb();
    let db = openDatabase(dbPath);
    let store = new RunStore(db);
    let ctx = makePorts(db, { submit: 0, edit: 0 });
    const existingTaskId = randomUUID();
    const existingKey = 'run:recovery-window:img-1:a0';
    await ctx.queue.submit({
      taskId: existingTaskId,
      track: 'local',
      request: requestSnapshot(),
      idempotencyKey: existingKey,
      projectId: 'default',
      submitting: true,
    });
    // 模拟“任务已入库，但步骤尚未回填 taskId”的崩溃窗口。
    store.create(
      makeRun('recovery-window', 'running', {
        status: 'submitting',
      }),
    );

    db.close();
    db = openDatabase(dbPath);
    store = new RunStore(db);
    const counts = { submit: 0, edit: 0 };
    ctx = makePorts(db, counts);
    const service = makeService(store, ctx.ports);
    await schedulerPass(store, service);

    const after = store.get('recovery-window')!;
    expect(after.steps[0]?.taskId).toBe(existingTaskId);
    expect(after.steps[0]?.status).toBe('submitting');
    expect(counts.submit).toBe(1); // 调用了一次；实际队列按幂等键复用原任务
    expect((db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM idempotency_keys').get() as { n: number }).n).toBe(1);
    db.close();
  });
});
