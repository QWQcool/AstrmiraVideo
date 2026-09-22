import { describe, expect, it } from 'vitest';
import type { TaskProgress, VideoGenerateRequest, VideoProvider } from '@astrmira/shared';
import { withFaultInjection, type FaultKind } from '../providers/withFaultInjection.js';
import { openDatabase } from '../store/db.js';
import { TaskStore } from '../store/taskStore.js';
import { JobDispatcher } from './dispatcher.js';
import { SqliteJobQueue } from './SqliteJobQueue.js';

/**
 * S3 / AC7 的核心落点：**故障注入 × 调度器**。
 *
 * 本文件承载 PLAN §4 的那条硬要求：
 * 「`uncertain` 必须有『上游调用次数 = 1』的硬断言，防止该护栏日后被静默改回自动重试。」
 */

function baseRequest(): VideoGenerateRequest {
  return {
    prompt: 'S3 dispatcher 故障注入用例',
    mode: 't2v',
    aspectRatio: '16:9',
    provider: 'fixture-local',
    params: { durationSec: 3 },
  };
}

function createCountingStub() {
  const state = { submitCalls: 0 };
  const results = new Map<string, TaskProgress>();

  const provider: VideoProvider = {
    id: 'fixture-local',
    name: 'counting-stub',
    async checkHealth() {
      return { available: true };
    },
    async submit(request: VideoGenerateRequest) {
      state.submitCalls += 1;
      const upstreamId = `up-${state.submitCalls}`;
      results.set(upstreamId, {
        taskId: upstreamId,
        status: 'succeeded',
        progressPercent: 100,
        requestSnapshot: request,
        outputVideoUrl: `/media/${upstreamId}.mp4`,
      });
      return { taskId: upstreamId };
    },
    async queryStatus(taskId: string) {
      const found = results.get(taskId);
      if (found === undefined) throw new Error(`桩未持有：${taskId}`);
      return found;
    },
    async cancel() {
      return false;
    },
  };

  return { provider, state };
}

/** 组装「内存库 + 队列 + 故障注入 provider + 调度器」并跑一轮 */
async function runWithFault(
  kind: FaultKind | null,
  options: { steps?: number } = {},
): Promise<{
  store: TaskStore;
  dispatcher: JobDispatcher;
  taskId: string;
  state: { submitCalls: number };
  close: () => void;
}> {
  const db = openDatabase(':memory:');
  const store = new TaskStore(db);
  const queue = new SqliteJobQueue(store);
  const { provider, state } = createCountingStub();

  const effective = kind === null ? provider : withFaultInjection(provider, { kind, ...options });

  const dispatcher = new JobDispatcher({
    queue,
    resolveProvider: () => effective,
    cleanup: async () => undefined,
    markUpstreamAccepted: async (taskId, upstreamTaskId) => {
      queue.setUpstreamTaskId(taskId, upstreamTaskId);
    },
    intervalMs: 20,
    // 快速轮询：默认 2000ms 会让 slow_progress 用例等太久
    pollIntervalMs: 20,
    pollTimeoutMs: 5000,
  });

  const taskId = `task-${kind ?? 'none'}`;
  await queue.submit({
    taskId,
    track: 'cloud',
    request: baseRequest(),
    idempotencyKey: `key-${kind ?? 'none'}`,
    submitting: true,
  });

  await dispatcher.tick();
  await dispatcher.drain();

  return { store, dispatcher, taskId, state, close: () => db.close() };
}

describe('AC7 · uncertain 不自动重提（防线 7 的硬护栏）', () => {
  it('注入 uncertain → 任务归 UNCERTAIN_RESULT，且「上游调用次数 = 1」；多轮 tick 后仍为 1', async () => {
    const { store, dispatcher, taskId, state, close } = await runWithFault('uncertain');

    const record = store.get(taskId);
    expect(record?.status).toBe('failed');
    expect(record?.error?.code).toBe('UNCERTAIN_RESULT');
    expect(record?.error?.disposition).toBe('uncertain');
    // 语义前提：上游**确实收到了请求**（调用已发生）、但我们**拿不到** upstreamTaskId
    // ——拿不到上游 ID 正是"结果不确定"的来源，因此必须靠 `submitting` 标记留痕；
    // 它也是 CONTRACT §5「重启后判定到底提交出去没有」的唯一依据。
    expect(state.submitCalls).toBe(1);
    expect(record?.upstreamTaskId).toBeUndefined();
    expect(record?.submitting).toBe(true);

    // ── 硬断言：多轮调度后上游调用次数**不得**增加（防止日后被改回自动重试）──
    for (let i = 0; i < 8; i += 1) {
      await dispatcher.tick();
    }
    await dispatcher.drain();

    expect(state.submitCalls).toBe(1);
    expect(store.get(taskId)?.status).toBe('failed');
    expect(store.get(taskId)?.error?.disposition).toBe('uncertain');

    close();
  });

  it('对照：无注入时同一链路必须 succeeded（证明上面的失败来自注入，而非链路本身坏）', async () => {
    const { store, taskId, state, close } = await runWithFault(null);

    expect(store.get(taskId)?.status).toBe('succeeded');
    expect(store.get(taskId)?.error).toBeUndefined();
    expect(state.submitCalls).toBe(1);

    close();
  });
});

describe('S3 · 其他注入项的端到端归属', () => {
  it('rate_limit → RATE_LIMITED / retryable，且**未触达上游**（未提交就不得归 uncertain）', async () => {
    const { store, taskId, state, close } = await runWithFault('rate_limit');

    const record = store.get(taskId);
    expect(record?.error?.code).toBe('RATE_LIMITED');
    expect(record?.error?.disposition).toBe('retryable');
    expect(record?.upstreamTaskId).toBeUndefined();
    expect(state.submitCalls).toBe(0);

    close();
  });

  it('upstream_5xx → UPSTREAM_ERROR / retryable（上游明确返回），上游调用 = 1', async () => {
    const { store, taskId, state, close } = await runWithFault('upstream_5xx');

    const record = store.get(taskId);
    expect(record?.error?.code).toBe('UPSTREAM_ERROR');
    expect(record?.error?.disposition).toBe('retryable');
    expect(state.submitCalls).toBe(1);

    close();
  });

  it('stream_cut → UNCERTAIN_RESULT / uncertain（半包中断），上游调用 = 1', async () => {
    const { store, taskId, state, close } = await runWithFault('stream_cut');

    const record = store.get(taskId);
    expect(record?.error?.code).toBe('UNCERTAIN_RESULT');
    expect(record?.error?.disposition).toBe('uncertain');
    expect(state.submitCalls).toBe(1);

    close();
  });

  it('slow_progress → 进度推进不影响终态，任务最终 succeeded', async () => {
    const { store, taskId, close } = await runWithFault('slow_progress', { steps: 2 });

    expect(store.get(taskId)?.status).toBe('succeeded');
    expect(store.get(taskId)?.progressPercent).toBe(100);

    close();
  });

  it('disk_full → DISK_FULL / terminal，且不触达上游', async () => {
    const { store, taskId, state, close } = await runWithFault('disk_full');

    const record = store.get(taskId);
    expect(record?.error?.code).toBe('DISK_FULL');
    expect(record?.error?.disposition).toBe('terminal');
    expect(state.submitCalls).toBe(0);

    close();
  });

  it('delay → 任务仍成功，但执行被拉长（验证前端轮询窗口）', async () => {
    const started = Date.now();
    const { store, taskId, close } = await runWithFault('delay');

    expect(store.get(taskId)?.status).toBe('succeeded');
    expect(Date.now() - started).toBeGreaterThanOrEqual(1500); // 默认 2000ms，富余判定

    close();
  });
});
