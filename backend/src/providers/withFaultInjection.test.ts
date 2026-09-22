import { describe, expect, it } from 'vitest';
import type { TaskProgress, VideoGenerateRequest, VideoProvider } from '@astrmira/shared';
import { ProviderFailureError } from '../errors.js';
import {
  createFaultInjectedProvider,
  isFaultKind,
  resolveFaultPlanFromEnv,
  withFaultInjection,
} from './withFaultInjection.js';

/**
 * S3：7 项故障注入逐项断言（PLAN §4「Step 2 补充」验收要求）。
 * 每项注入至少 1 条自动化断言；`uncertain` 的"上游调用次数 = 1"硬断言在 dispatcher 集成里。
 */

function baseRequest(): VideoGenerateRequest {
  return {
    prompt: 'S3 故障注入用例',
    mode: 't2v',
    aspectRatio: '16:9',
    provider: 'fixture-local',
    params: { durationSec: 3 },
  };
}

function createCountingStub() {
  const state = { submitCalls: 0, queryStatusCalls: 0 };
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
      state.queryStatusCalls += 1;
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

describe('故障注入 · delay', () => {
  it('submit 前至少等待指定毫秒（用于验证前端轮询与超时表现）', async () => {
    const { provider } = createCountingStub();
    const injected = withFaultInjection(provider, { kind: 'delay', ms: 120 });

    const started = Date.now();
    const { taskId } = await injected.submit(baseRequest());
    const elapsed = Date.now() - started;

    expect(elapsed).toBeGreaterThanOrEqual(110);
    expect(taskId).toBe('up-1');
  });
});

describe('故障注入 · rate_limit', () => {
  it('在触达上游之前即抛 RATE_LIMITED（不产生上游调用）', async () => {
    const { provider, state } = createCountingStub();
    const injected = withFaultInjection(provider, { kind: 'rate_limit' });

    await expect(injected.submit(baseRequest())).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(state.submitCalls).toBe(0);
  });
});

describe('故障注入 · disk_full', () => {
  it('抛 DISK_FULL（terminal），且不触达上游', async () => {
    const { provider, state } = createCountingStub();
    const injected = withFaultInjection(provider, { kind: 'disk_full' });

    await expect(injected.submit(baseRequest())).rejects.toMatchObject({ code: 'DISK_FULL' });
    expect(state.submitCalls).toBe(0);
  });
});

describe('故障注入 · upstream_5xx', () => {
  it('上游调用已发生，错误归 UPSTREAM_ERROR（明确返回，可重试）', async () => {
    const { provider, state } = createCountingStub();
    const injected = withFaultInjection(provider, { kind: 'upstream_5xx' });

    await expect(injected.submit(baseRequest())).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
    });
    // 关键语义：这是"上游明确返回错误"，请求确实到达了上游
    expect(state.submitCalls).toBe(1);
  });
});

describe('故障注入 · stream_cut', () => {
  it('submit 成功、queryStatus 时抛 UNCERTAIN_RESULT（半包中断），且只抛一次', async () => {
    const { provider, state } = createCountingStub();
    const injected = withFaultInjection(provider, { kind: 'stream_cut', atPercent: 40 });

    const { taskId } = await injected.submit(baseRequest());
    expect(state.submitCalls).toBe(1);

    await expect(injected.queryStatus(taskId)).rejects.toMatchObject({
      code: 'UNCERTAIN_RESULT',
    });

    // 第二次查询不再注入（模拟"只有那一次中断"）→ 回落真实结果
    const progress = await injected.queryStatus(taskId);
    expect(progress.status).toBe('succeeded');
  });
});

describe('故障注入 · slow_progress', () => {
  it('前 N 次 queryStatus 返回 running 且进度递增，之后回落到真实结果', async () => {
    const { provider } = createCountingStub();
    const injected = withFaultInjection(provider, { kind: 'slow_progress', steps: 3 });

    const { taskId } = await injected.submit(baseRequest());

    const first = await injected.queryStatus(taskId);
    const second = await injected.queryStatus(taskId);
    const third = await injected.queryStatus(taskId);
    const final = await injected.queryStatus(taskId);

    expect([first.status, second.status, third.status]).toEqual(['running', 'running', 'running']);
    expect(first.progressPercent).toBeLessThan(second.progressPercent);
    expect(second.progressPercent).toBeLessThan(third.progressPercent);
    expect(final.status).toBe('succeeded');
  });
});

describe('故障注入 · uncertain', () => {
  it('submit 已触达上游，随后抛 UNCERTAIN_RESULT（禁止自动重提的源头）', async () => {
    const { provider, state } = createCountingStub();
    const injected = withFaultInjection(provider, { kind: 'uncertain' });

    await expect(injected.submit(baseRequest())).rejects.toBeInstanceOf(ProviderFailureError);
    // 语义要点：它**已经**提交出去了，所以后续才必须人工核对
    expect(state.submitCalls).toBe(1);
  });
});

describe('安全闸（FAULT_INJECT 默认关闭 + 生产拒绝）', () => {
  it('FAULT_INJECT 非 1 时 env 解析为 null（默认不挂载）', () => {
    expect(resolveFaultPlanFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(resolveFaultPlanFromEnv({ FAULT_INJECT: '0' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('FAULT_KIND 非法或缺省时显式报错（不猜默认值）', () => {
    expect(() => resolveFaultPlanFromEnv({ FAULT_INJECT: '1' } as NodeJS.ProcessEnv)).toThrow(
      /FAULT_KIND 非法或缺省/,
    );
    expect(() =>
      resolveFaultPlanFromEnv({ FAULT_INJECT: '1', FAULT_KIND: 'nope' } as NodeJS.ProcessEnv),
    ).toThrow(/FAULT_KIND 非法或缺省/);
  });

  it('合法 FAULT_KIND 解析成功', () => {
    expect(resolveFaultPlanFromEnv({ FAULT_INJECT: '1', FAULT_KIND: 'uncertain' } as NodeJS.ProcessEnv)).toEqual({
      kind: 'uncertain',
      ms: undefined,
      atPercent: undefined,
      steps: undefined,
    });
    expect(isFaultKind('stream_cut')).toBe(true);
    expect(isFaultKind('unknown')).toBe(false);
  });

  it('生产环境挂载直接抛错（启动即拒绝，不留误开可能）', () => {
    const { provider } = createCountingStub();
    expect(() =>
      createFaultInjectedProvider(provider, { kind: 'uncertain' }, {
        NODE_ENV: 'production',
      } as NodeJS.ProcessEnv),
    ).toThrow(/禁止在生产环境挂载/);
  });

  it('非生产环境正常挂载并改名（便于在日志里辨认）', () => {
    const { provider } = createCountingStub();
    const injected = createFaultInjectedProvider(provider, { kind: 'delay', ms: 1 }, {
      NODE_ENV: 'test',
    } as NodeJS.ProcessEnv);

    expect(injected.name).toContain('故障注入：delay');
    expect(injected.id).toBe('fixture-local');
  });
});
