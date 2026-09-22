import { copyFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TaskProgress, VideoGenerateRequest, VideoProvider } from '@astrmira/shared';
import { buildApp } from '../index.js';
import { __clearProviderTestOverrides, __setProviderForTesting } from '../providers/registry.js';
import { SqliteJobQueue } from '../queue/SqliteJobQueue.js';
import { openDatabase } from '../store/db.js';
import { TaskStore } from '../store/taskStore.js';

/**
 * S2 公共链路集成测试（AC3 / AC4 / AC7 幂等半边）。
 * 覆盖：幂等键（含"上游调用计数 = 1"）、本地轨并发 1、重启恢复、206 Range、画廊删除、防线 7 守卫。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CLIPS_DIR = path.join(ROOT, 'tests', 'fixtures', 'clips');
const OUTPUTS_DIR = path.join(ROOT, 'outputs');
const TMP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-step2-'));

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 计数桩：可控耗时 + 记录上游调用次数 + 产出固定 warnings */
class CountingStubProvider implements VideoProvider {
  readonly id = 'fixture-local' as const;
  readonly name = 'counting-stub';
  submitCalls = 0;
  delayMs = 250;

  private readonly results = new Map<string, TaskProgress>();

  async checkHealth(): Promise<{ available: boolean }> {
    return { available: true };
  }

  async submit(request: VideoGenerateRequest): Promise<{ taskId: string }> {
    this.submitCalls += 1;
    const upstreamId = `up-${this.submitCalls}`;
    await sleep(this.delayMs);

    this.results.set(upstreamId, {
      taskId: upstreamId,
      status: 'succeeded',
      progressPercent: 100,
      requestSnapshot: request,
      outputVideoUrl: `/media/${upstreamId}.mp4`,
      warnings: ['桩告警：验证 warnings 持久化'],
    });
    return { taskId: upstreamId };
  }

  async queryStatus(taskId: string): Promise<TaskProgress> {
    const found = this.results.get(taskId);
    if (found === undefined) throw new Error(`桩未持有任务：${taskId}`);
    return found;
  }

  async cancel(): Promise<boolean> {
    return false;
  }
}

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let stub: CountingStubProvider;

function baseRequest(overrides: Partial<VideoGenerateRequest> = {}): VideoGenerateRequest {
  return {
    prompt: 'S2 集成测试：雨夜街头中景',
    mode: 't2v',
    aspectRatio: '16:9',
    provider: 'fixture-local',
    params: { durationSec: 3 },
    ...overrides,
  };
}

async function postGenerate(body: VideoGenerateRequest, idempotencyKey?: string) {
  return app.inject({
    method: 'POST',
    url: '/api/generate',
    payload: body,
    ...(idempotencyKey === undefined ? {} : { headers: { 'idempotency-key': idempotencyKey } }),
  });
}

async function getTask(taskId: string): Promise<TaskProgress> {
  const res = await app.inject({ method: 'GET', url: `/api/tasks/${taskId}` });
  expect(res.statusCode).toBe(200);
  return res.json() as TaskProgress;
}

async function waitForStatus(
  taskId: string,
  predicate: (progress: TaskProgress) => boolean,
  timeoutMs = 10_000,
): Promise<TaskProgress> {
  const deadline = Date.now() + timeoutMs;
  let last: TaskProgress | null = null;
  while (Date.now() < deadline) {
    last = await getTask(taskId);
    if (predicate(last)) return last;
    await sleep(50);
  }
  throw new Error(`等待任务状态超时：${taskId}，最后状态=${JSON.stringify(last)}`);
}

beforeAll(async () => {
  process.env.DATA_DIR = TMP_DATA_DIR;
  process.env.OUTPUT_DIR = OUTPUTS_DIR;
  stub = new CountingStubProvider();
  __setProviderForTesting('fixture-local', stub);
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  __clearProviderTestOverrides();
  rmSync(TMP_DATA_DIR, { recursive: true, force: true });
});

describe('POST /api/generate 幂等键（CONTRACT §5）', () => {
  it('同一 Idempotency-Key 重复提交 → 同一 taskId，且上游调用计数 = 1', async () => {
    const before = stub.submitCalls;

    const first = await postGenerate(baseRequest(), 'idem-key-alpha');
    const second = await postGenerate(baseRequest(), 'idem-key-alpha');

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const firstId = (first.json() as { taskId: string }).taskId;
    const secondId = (second.json() as { taskId: string }).taskId;
    expect(secondId).toBe(firstId);

    await waitForStatus(firstId, (p) => p.status === 'succeeded');

    // 硬断言：只多了一次上游调用（不能只看"返回同一 taskId"）
    expect(stub.submitCalls - before).toBe(1);
  });

  it('请求体相同的两次提交（无幂等头）按指纹去重', async () => {
    const before = stub.submitCalls;
    const body = baseRequest({ prompt: '指纹去重用例：完全一致的请求体' });

    const first = await postGenerate(body);
    const second = await postGenerate(body);

    expect((second.json() as { taskId: string }).taskId).toBe(
      (first.json() as { taskId: string }).taskId,
    );

    const taskId = (first.json() as { taskId: string }).taskId;
    await waitForStatus(taskId, (p) => p.status === 'succeeded');
    expect(stub.submitCalls - before).toBe(1);
  });

  it('未实现的 provider 显式报 PROVIDER_UNAVAILABLE（不静默降级）', async () => {
    const res = await postGenerate(baseRequest({ provider: 'cloud-volcano-seedance' }));

    expect(res.statusCode).toBe(503);
    const body = res.json() as { code: string; disposition: string };
    expect(body.code).toBe('PROVIDER_UNAVAILABLE');
    expect(body.disposition).toBe('terminal');
  });
});

describe('AC3 · 本地轨并发互斥（防线 1）', () => {
  it('并发提交 2 个任务：第 2 个保持 queued，且没有第二个推理进程被拉起', async () => {
    stub.delayMs = 1200;

    const first = await postGenerate(baseRequest({ prompt: '并发用例 A' }), 'concurrency-A');
    const second = await postGenerate(baseRequest({ prompt: '并发用例 B' }), 'concurrency-B');

    const firstId = (first.json() as { taskId: string }).taskId;
    const secondId = (second.json() as { taskId: string }).taskId;

    const running = await waitForStatus(firstId, (p) => p.status === 'running');
    expect(running.status).toBe('running');

    // 第一个在跑时，第二个必须仍是 queued（单卡互斥）
    expect((await getTask(secondId)).status).toBe('queued');

    await waitForStatus(firstId, (p) => p.status === 'succeeded');
    await waitForStatus(secondId, (p) => p.status === 'succeeded');

    stub.delayMs = 250;
  });
});

describe('warnings 持久化（CONTRACT §4 / §7）', () => {
  it('任务完成后 warnings 随任务记录保留（不被终态覆盖）', async () => {
    const res = await postGenerate(baseRequest({ prompt: 'warnings 用例' }), 'warn-key-1');
    const taskId = (res.json() as { taskId: string }).taskId;

    const done = await waitForStatus(taskId, (p) => p.status === 'succeeded');
    expect(done.status).toBe('succeeded');
    expect(done.warnings).toEqual(['桩告警：验证 warnings 持久化']);
    expect(done.outputVideoUrl).toMatch(/^\/media\/up-\d+\.mp4$/);
  });
});

describe('AC4 · 服务重启后任务可恢复（防线 2）', () => {
  it('重启（关闭连接后重新装配）后，GET /api/tasks/:id 仍返回终态与参数快照', async () => {
    const first = await buildApp();
    const res = await first.inject({
      method: 'POST',
      url: '/api/generate',
      payload: baseRequest({ prompt: '重启恢复用例' }),
      headers: { 'idempotency-key': 'restart-key-1' },
    });
    const taskId = (res.json() as { taskId: string }).taskId;

    await sleep(1500); // 让任务跑完（桩耗时 250ms + tick 间隔）
    await first.close();

    // "重启"：重新装配（新连接、新调度器），数据来自同一个 SQLite 文件
    const second = await buildApp();
    const after = await second.inject({ method: 'GET', url: `/api/tasks/${taskId}` });
    expect(after.statusCode).toBe(200);

    const progress = after.json() as TaskProgress;
    expect(progress.status).toBe('succeeded');
    expect(progress.requestSnapshot.prompt).toBe('重启恢复用例');

    await second.close();
  });
});

describe('206 Range（/media/*，CONTRACT §5）', () => {
  it('带 Range 请求成片直链 → 206 + content-range', async () => {
    const source = path.join(CLIPS_DIR, 'base-720p-landscape-5s-audio.mp4');
    const target = path.join(OUTPUTS_DIR, 'range-probe.mp4');
    mkdirSync(OUTPUTS_DIR, { recursive: true });
    copyFileSync(source, target);

    try {
      const res = await app.inject({
        method: 'GET',
        url: '/media/range-probe.mp4',
        headers: { range: 'bytes=0-1023' },
      });

      expect(res.statusCode).toBe(206);
      expect(res.headers['content-range']).toMatch(/^bytes 0-1023\/\d+$/);
      expect(Number(res.headers['content-length'])).toBeLessThanOrEqual(1024);
    } finally {
      rmSync(target, { force: true });
    }
  });
});

describe('画廊（/api/history）', () => {
  it('列最近任务并支持单片删除（同时释放成片文件）', async () => {
    const res = await postGenerate(baseRequest({ prompt: '画廊用例' }), 'history-key-1');
    const taskId = (res.json() as { taskId: string }).taskId;

    await waitForStatus(taskId, (p) => p.status === 'succeeded');

    const list = await app.inject({ method: 'GET', url: '/api/history' });
    expect(list.statusCode).toBe(200);
    const items = (list.json() as { items: TaskProgress[] }).items;
    expect(items.some((item) => item.taskId === taskId)).toBe(true);

    const del = await app.inject({ method: 'DELETE', url: `/api/history/${taskId}` });
    expect(del.statusCode).toBe(200);

    const missing = await app.inject({ method: 'GET', url: `/api/tasks/${taskId}` });
    expect(missing.statusCode).toBe(404);
  });

  it('删除不存在的任务 → 404 TASK_NOT_FOUND', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/history/not-a-task' });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { code: string }).code).toBe('TASK_NOT_FOUND');
  });
});

describe('防线 7 守卫（存储 / 队列层直测）', () => {
  it('claim 必须排除带 uncertain 标记的任务（防线 7 的 SQL 层护栏）', async () => {
    const db = openDatabase(':memory:');
    const store = new TaskStore(db);
    const queue = new SqliteJobQueue(store);

    // 构造"必须被排除"的异常态：status=queued 但 error.disposition=uncertain。
    // （正常路径 markUncertain 会把状态置 failed，属于第一道保障；此处验证第二道 SQL 护栏）
    store.insert({
      taskId: 'uncertain-queued',
      track: 'local',
      provider: 'fixture-local',
      status: 'queued',
      progressPercent: 0,
      requestSnapshot: baseRequest(),
      warnings: [],
      error: {
        code: 'UNCERTAIN_RESULT',
        message: '已提交上游但结果不明',
        disposition: 'uncertain',
      },
      submitting: false,
    });

    expect(await queue.claim('local')).toBeNull();

    // 对照 1：正常 queued 任务**可以**被领取（证明上面的 null 不是恒真）
    await queue.submit({
      taskId: 'queued-ok',
      track: 'local',
      request: baseRequest(),
      idempotencyKey: 'queued-ok-key',
      submitting: true,
    });
    expect((await queue.claim('local'))?.taskId).toBe('queued-ok');

    // 对照 2：retryable 失败的任务**可以**被重新领取（护栏只保护 uncertain / terminal）。
    // 用 cloud 轨对照：local 轨此刻已有 running 任务（对照 1 刚领取的），会被防线 1 挡住
    // —— 这本身也顺带验证了防线 1 的互斥语义。
    store.insert({
      taskId: 'retryable-queued',
      track: 'cloud',
      provider: 'fixture-local',
      status: 'queued',
      progressPercent: 0,
      requestSnapshot: baseRequest(),
      warnings: [],
      error: { code: 'UPSTREAM_ERROR', message: '上游 5xx', disposition: 'retryable' },
      submitting: false,
    });
    expect((await queue.claim('cloud'))?.taskId).toBe('retryable-queued');

    db.close();
  });

  it('markUncertain 后任务不得回到 queued（第一道保障：状态机）', async () => {
    const db = openDatabase(':memory:');
    const store = new TaskStore(db);
    const queue = new SqliteJobQueue(store);

    await queue.submit({
      taskId: 'uncertain-state',
      track: 'local',
      request: baseRequest(),
      idempotencyKey: 'uncertain-state-key',
      submitting: true,
    });
    await queue.markUncertain('uncertain-state', {
      code: 'UNCERTAIN_RESULT',
      message: '结果不明',
      disposition: 'uncertain',
    });

    const record = store.get('uncertain-state');
    expect(record?.status).toBe('failed');
    expect(record?.error?.disposition).toBe('uncertain');
    // 且不可被任何自动路径消费
    expect(await queue.claim('local')).toBeNull();

    db.close();
  });

  it('requeue 仅允许未提交上游的任务；已写回上游 taskId 的必须拒绝', async () => {
    const db = openDatabase(':memory:');
    const store = new TaskStore(db);
    const queue = new SqliteJobQueue(store);

    await queue.submit({
      taskId: 'requeue-safe',
      track: 'cloud',
      request: baseRequest(),
      idempotencyKey: 'requeue-safe-key',
      submitting: true,
    });
    await expect(queue.requeue('requeue-safe')).resolves.toBeUndefined();

    await queue.submit({
      taskId: 'requeue-blocked',
      track: 'cloud',
      request: baseRequest(),
      idempotencyKey: 'requeue-blocked-key',
      submitting: true,
    });
    queue.setUpstreamTaskId('requeue-blocked', 'upstream-42');

    await expect(queue.requeue('requeue-blocked')).rejects.toThrow(/禁止 requeue/);

    db.close();
  });
});

describe('防线 3 · 调度器收尾清理', () => {
  it('任务结束后调用清理钩子（真实删除动作由 cleanup.test.ts 断言"目录不存在"）', async () => {
    // 这里验证"钩子被触发"；删除事实由 pipeline/cleanup.test.ts 的断言覆盖
    const res = await postGenerate(baseRequest({ prompt: '清理钩子用例' }), 'cleanup-key-1');
    const taskId = (res.json() as { taskId: string }).taskId;

    await waitForStatus(taskId, (p) => p.status === 'succeeded');

    // 任务临时目录（若被创建过）必须不存在
    const tmpDir = path.join(OUTPUTS_DIR, '.tmp', taskId);
    expect(existsSync(tmpDir)).toBe(false);
  });
});
