import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CreationRun, EditScript, VideoGenerateRequest } from '@astrmira/shared';
import { openDatabase, type Db } from '../store/db.js';
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
    createdAt: 1,
    updatedAt: 1,
    ...(state === 'running' ? { startedAt: 1 } : {}),
  };
}

function makeService(
  store: RunStore,
  counts: { submit: number; edit: number },
  tasks: Map<string, { status: 'running'; hasOutput: boolean }> = new Map(),
): CreationRunService {
  const ports: RunEnginePorts = {
    getTask: (taskId) => tasks.get(taskId) ?? null,
    submit: async (_request: VideoGenerateRequest) => {
      counts.submit += 1;
      return 'should-not-submit';
    },
    submitEdit: async (_script: EditScript) => {
      counts.edit += 1;
      return 'should-not-submit';
    },
  };
  return new CreationRunService({
    load: (id) => store.get(id),
    save: (value) => store.update(value),
    ports,
    now: () => 12345,
  });
}

/** 模拟 index.ts 的 5s 定时器：只照看 listActive；不额外调用 tick(planned)。 */
async function schedulerPass(store: RunStore, service: CreationRunService): Promise<void> {
  for (const run of store.listActive()) await service.tick(run.id);
}

describe('S10-R1 / B92 · planned 显式启动护栏', () => {
  it('planned 跨两个 tick + 重启仍不启动，startedAt/task/submit 都为零', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'astrmira-run-guard-'));
    dirs.push(dir);
    const dbPath = path.join(dir, 'app.db');
    let db: Db = openDatabase(dbPath);
    const counts = { submit: 0, edit: 0 };
    let store = new RunStore(db);
    store.create(makeRun('planned-run'));
    let service = makeService(store, counts);

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
    service = makeService(store, counts);
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
    const dir = mkdtempSync(path.join(tmpdir(), 'astrmira-run-restart-'));
    dirs.push(dir);
    const db = openDatabase(path.join(dir, 'app.db'));
    const store = new RunStore(db);
    store.create(
      makeRun('running-restart', 'running', {
        status: 'submitting',
        taskId: 't-existing',
      }),
    );
    const counts = { submit: 0, edit: 0 };
    const tasks = new Map([['t-existing', { status: 'running' as const, hasOutput: false }]]);
    const service = makeService(store, counts, tasks);

    await schedulerPass(store, service);
    expect(counts.submit).toBe(0);
    expect(store.get('running-restart')?.state).toBe('running');
    expect(store.get('running-restart')?.steps[0]?.taskId).toBe('t-existing');
    db.close();
  });
});
