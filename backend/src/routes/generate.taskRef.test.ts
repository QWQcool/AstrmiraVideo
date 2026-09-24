import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TaskProgress, VideoGenerateRequest, VideoProvider } from '@astrmira/shared';
import { buildApp } from '../index.js';
import { __clearProviderTestOverrides, __setProviderForTesting } from '../providers/registry.js';
import { openDatabase } from '../store/db.js';
import { TaskStore } from '../store/taskStore.js';

/**
 * `task:<taskId>` 参考成片引用（V2.6 / 台账 B37）的**路由层**同步校验。
 *
 * 契约（§1）承诺：引用的任务不存在 / 没有可用成片 → **404 `TASK_NOT_FOUND`**，
 * 且必须在入队前判定 —— 不能留给异步 provider 造出一条 failed 任务。
 * provider 侧的 URL 解析分支由 `VolcanoSeedanceProvider.test.ts` 与 `store/assets.test.ts` 覆盖。
 */

const TMP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-taskref-data-'));
const TMP_OUTPUTS_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-taskref-out-'));

class StubProvider implements VideoProvider {
  readonly id = 'fixture-local' as const;
  readonly name = 'task-ref-stub';
  submitCalls = 0;

  async checkHealth(): Promise<{ available: boolean }> {
    return { available: true };
  }

  async submit(): Promise<{ taskId: string }> {
    this.submitCalls += 1;
    return { taskId: 'stub-upstream' };
  }

  async queryStatus(taskId: string): Promise<TaskProgress> {
    return {
      taskId,
      status: 'succeeded',
      progressPercent: 100,
      requestSnapshot: { prompt: 'x', mode: 't2v', aspectRatio: '16:9', provider: 'fixture-local' },
      createdAt: Date.now(),
    };
  }

  async cancel(): Promise<boolean> {
    return false;
  }
}

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let provider: StubProvider;

const SNAPSHOT = {
  prompt: '源片',
  mode: 't2v' as const,
  aspectRatio: '16:9' as const,
  provider: 'fixture-local' as const,
};

async function submit(referenceVideo: string, idempotencyKey: string, remoteAddress: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/generate',
    remoteAddress,
    headers: { 'idempotency-key': idempotencyKey },
    payload: {
      prompt: '按参考视频重绘成星尘风',
      mode: 'v2v',
      aspectRatio: '16:9',
      provider: 'fixture-local',
      assets: { referenceVideo },
    } satisfies VideoGenerateRequest,
  });
  return response;
}

beforeAll(async () => {
  process.env.DATA_DIR = TMP_DATA_DIR;
  process.env.OUTPUT_DIR = TMP_OUTPUTS_DIR;

  // 另开连接播种：一条已出片任务 + 一条仍在跑的任务
  const db = openDatabase(path.join(TMP_DATA_DIR, 'app.db'));
  const store = new TaskStore(db);
  store.insert({
    taskId: 'seed-video',
    track: 'cloud',
    provider: 'fixture-local',
    status: 'succeeded',
    progressPercent: 100,
    requestSnapshot: SNAPSHOT,
    outputVideoUrl: '/media/seed-video.mp4',
    warnings: [],
    submitting: false,
  });
  store.insert({
    taskId: 'seed-running',
    track: 'cloud',
    provider: 'fixture-local',
    status: 'running',
    progressPercent: 40,
    requestSnapshot: SNAPSHOT,
    warnings: [],
    submitting: true,
  });
  db.close();

  provider = new StubProvider();
  __setProviderForTesting('fixture-local', provider);
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  __clearProviderTestOverrides();
  for (const dir of [TMP_DATA_DIR, TMP_OUTPUTS_DIR]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* 临时目录残留无碍 */
    }
  }
});

describe('POST /api/generate · `task:` 参考成片引用（V2.6 / B37）', () => {
  it('引用不存在的任务 → 404 TASK_NOT_FOUND，且不入队不触达上游', async () => {
    const before = provider.submitCalls;
    const response = await submit('task:ghost', 'taskref-ghost', '198.51.100.81');

    expect(response.statusCode).toBe(404);
    const body = response.json() as { code: string; message: string };
    expect(body.code).toBe('TASK_NOT_FOUND');
    expect(body.message).toContain('ghost');
    expect(provider.submitCalls).toBe(before);
  });

  it('引用尚未出片的任务 → 404 TASK_NOT_FOUND（文案带当前状态）', async () => {
    const response = await submit('task:seed-running', 'taskref-running', '198.51.100.82');

    expect(response.statusCode).toBe(404);
    const body = response.json() as { code: string; message: string };
    expect(body.code).toBe('TASK_NOT_FOUND');
    expect(body.message).toContain('running');
  });

  it('引用已出片任务 → 200 正常入队（校验放行，URL 解析在 provider 侧另有测试）', async () => {
    const response = await submit('task:seed-video', 'taskref-ok', '198.51.100.83');

    expect(response.statusCode).toBe(200);
    const body = response.json() as { taskId: string };
    expect(body.taskId).not.toBe('');
  });

  it('普通资产 id（无 `task:` 前缀）不受新校验影响 → 200', async () => {
    const response = await submit('a-asset-id', 'taskref-asset', '198.51.100.84');

    expect(response.statusCode).toBe(200);
  });
});
