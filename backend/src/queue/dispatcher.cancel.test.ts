import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TaskProgress, VideoGenerateRequest, VideoProvider } from '@astrmira/shared';
import { buildApp } from '../index.js';
import { __clearProviderTestOverrides, __setProviderForTesting } from '../providers/registry.js';

/**
 * 取消语义（V8.3 批次 3）。
 *
 * 背景（实测确认的真缺陷）：`POST /api/tasks/:id/cancel` 只改库里的状态，
 * 而调度器**从不回读状态** —— 它 2s 一次的 heartbeat 会把 `cancelled` 覆盖回 `running`，
 * 最终还会写 `succeeded`。用户看到"已取消"，上游仍在跑、仍在计费。
 *
 * 本用例用"永远停在 running"的桩上游把那条时间线钉死：
 * 取消之后状态必须**保持不变**，且**上游必须收到一次 cancel**。
 */

const TMP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-cancel-data-'));
const TMP_OUTPUTS_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-cancel-out-'));

/** 永远 running 的桩：模拟"上游已受理但还没出片" */
class StuckProvider implements VideoProvider {
  readonly id = 'fixture-local' as const;
  readonly name = 'cancel-stub';

  cancelCalls: string[] = [];
  private readonly tasks = new Map<string, TaskProgress>();
  private submitCount = 0;

  async checkHealth(): Promise<{ available: boolean }> {
    return { available: true };
  }

  async submit(request: VideoGenerateRequest): Promise<{ taskId: string }> {
    // 每次提交给一个**不同的**上游 id，这样"上游收到几次 cancel"可以逐条断言，不靠用例顺序
    this.submitCount += 1;
    const taskId = `upstream-cancel-${this.submitCount}`;
    this.tasks.set(taskId, {
      taskId,
      status: 'running',
      progressPercent: 10,
      requestSnapshot: request,
      message: '上游生成中（桩）',
    });
    return { taskId };
  }

  async queryStatus(taskId: string): Promise<TaskProgress> {
    const current = this.tasks.get(taskId);
    if (current === undefined) throw new Error(`未知任务：${taskId}`);
    return current;
  }

  async cancel(taskId: string): Promise<boolean> {
    this.cancelCalls.push(taskId);
    return true;
  }
}

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let provider: StuckProvider;

async function submitTask(remoteAddress: string, idempotencyKey: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/generate',
    remoteAddress,
    headers: { 'idempotency-key': idempotencyKey },
    payload: {
      prompt: '取消语义用例',
      mode: 't2v',
      aspectRatio: '16:9',
      provider: 'fixture-local',
      params: { durationSec: 2 },
    } satisfies VideoGenerateRequest,
  });

  expect(response.statusCode, response.body).toBe(200);
  return (response.json() as { taskId: string }).taskId;
}

async function readTask(taskId: string): Promise<TaskProgress> {
  const response = await app.inject({ method: 'GET', url: `/api/tasks/${taskId}` });
  return response.json() as TaskProgress;
}

beforeAll(async () => {
  process.env.DATA_DIR = TMP_DATA_DIR;
  process.env.OUTPUT_DIR = TMP_OUTPUTS_DIR;

  provider = new StuckProvider();
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

describe('取消任务 · 调度器必须停下来', () => {
  it('取消后状态不被 heartbeat 覆盖，且上游收到一次 cancel', async () => {
    const taskId = await submitTask('198.51.100.61', 'cancel-case-1');

    // 等调度器把它推进到 running（桩上游此刻在"跑"）
    await sleep(800);
    expect((await readTask(taskId)).status).toBe('running');

    const cancelCallsBefore = provider.cancelCalls.length;

    const cancel = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/cancel`,
    });
    expect(cancel.statusCode).toBe(200);
    expect((cancel.json() as { ok: boolean }).ok).toBe(true);

    // 取消后的几个心跳周期内，状态必须**保持** cancelled（旧实现在这里会变回 running）
    for (const waitMs of [1_200, 1_500, 1_500]) {
      await sleep(waitMs);
      const current = await readTask(taskId);
      expect(current.status, `等待 ${waitMs}ms 后不应被覆盖`).toBe('cancelled');
    }

    const final = await readTask(taskId);
    expect(final.message).toContain('已按用户请求取消');
    // 恰好新增一次上游 cancel，且指向本任务的上游 id
    expect(provider.cancelCalls.length).toBe(cancelCallsBefore + 1);
    expect(provider.cancelCalls.at(-1)).toMatch(/^upstream-cancel-\d+$/);
  }, 30_000);

  it('已到终态的任务再取消返回 ok:false，且不再触达上游', async () => {
    const taskId = await submitTask('198.51.100.62', 'cancel-case-2');
    await sleep(800);

    const cancelCallsBefore = provider.cancelCalls.length;
    const first = await app.inject({ method: 'POST', url: `/api/tasks/${taskId}/cancel` });
    expect((first.json() as { ok: boolean }).ok).toBe(true);

    // 已取消（终态）→ 第二次只回 ok:false，不产生第二次上游动作（幂等护栏）
    const second = await app.inject({ method: 'POST', url: `/api/tasks/${taskId}/cancel` });
    expect(second.statusCode).toBe(200);
    expect((second.json() as { ok: boolean }).ok).toBe(false);

    // 调度器的轮询间隔是 2s，所以它"发现取消"要等到下一轮 —— 用轮询式断言而不是死等一个固定时长
    await expect
      .poll(() => provider.cancelCalls.length, { timeout: 6_000, interval: 200 })
      .toBe(cancelCallsBefore + 1);
  }, 30_000);
});
