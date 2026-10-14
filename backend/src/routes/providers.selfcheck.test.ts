import { afterEach, describe, expect, it } from 'vitest';
import type { VideoProvider } from '@astrmira/shared';
import { __clearProviderTestOverrides, __setProviderForTesting } from '../providers/registry.js';
import { buildSelfCheck } from './providers.js';

/**
 * 本地引擎**运行时自检**（V2.34 / 台账 B4 / CONTRACT §20）。
 *
 * 这一组钉的是"自检到底有没有**真去问一次**"，以及它**失败时怎么说话**：
 * 一个"检测"按钮如果拿缓存或配置值糊弄，用户看到的绿勾就毫无意义 ——
 * 而它存在的全部理由，正是"配了 env 之后到底成没成，我现在就想知道"。
 */

const ORIGINAL_EXPOSE = process.env.EXPOSE_HOST_LOCAL_TRACK;
const ORIGINAL_BASE = process.env.COMFYUI_BASE_URL;

afterEach(() => {
  __clearProviderTestOverrides();
  if (ORIGINAL_EXPOSE === undefined) delete process.env.EXPOSE_HOST_LOCAL_TRACK;
  else process.env.EXPOSE_HOST_LOCAL_TRACK = ORIGINAL_EXPOSE;
  if (ORIGINAL_BASE === undefined) delete process.env.COMFYUI_BASE_URL;
  else process.env.COMFYUI_BASE_URL = ORIGINAL_BASE;
});

interface HealthLog {
  calls: number;
  refresh: (boolean | undefined)[];
}

/** 假 provider：只实现自检要走的那条路（其余方法一旦被调用就报错 —— 自检是**只读**的） */
function fakeProvider(
  health: () => Promise<{ available: boolean; reason?: string }>,
  log: HealthLog,
): VideoProvider {
  return {
    id: 'host-comfyui',
    name: '假 ComfyUI（测试桩）',
    async checkHealth(options?: { refresh?: boolean }) {
      log.calls += 1;
      log.refresh.push(options?.refresh);
      return await health();
    },
    async submit() {
      throw new Error('自检不该提交任务');
    },
    async queryStatus() {
      throw new Error('自检不该查任务状态');
    },
    async cancel() {
      return false;
    },
  };
}

function entryOf(response: { entries: { provider: string }[] }, provider: string) {
  return response.entries.find((entry) => entry.provider === provider) as
    | { provider: string; available: boolean; reason?: string }
    | undefined;
}

describe('运行时自检 · 真去问一次', () => {
  it('通过的结论**来自 provider 的实时回答**，且带 `refresh: true`（用户点了 = 要现在的事实）', async () => {
    process.env.EXPOSE_HOST_LOCAL_TRACK = '1';
    const log: HealthLog = { calls: 0, refresh: [] };
    __setProviderForTesting(
      'host-comfyui',
      fakeProvider(
        async () => ({ available: true, reason: '模型：wan2.2_ti2v_5B_fp16.safetensors · 支持 t2v / i2v' }),
        log,
      ),
    );

    const response = await buildSelfCheck();

    expect(log.calls).toBe(1);
    expect(log.refresh).toEqual([true]); // ← 不 refresh 就等于拿 10 分钟前的缓存糊弄用户
    expect(entryOf(response, 'host-comfyui')).toMatchObject({
      available: true,
      reason: '模型：wan2.2_ti2v_5B_fp16.safetensors · 支持 t2v / i2v',
    });
  });

  it('不可用的原因**原样透出**（provider 已经写好人话，聚合层不吞它）', async () => {
    process.env.EXPOSE_HOST_LOCAL_TRACK = '1';
    const log: HealthLog = { calls: 0, refresh: [] };
    __setProviderForTesting(
      'host-comfyui',
      fakeProvider(async () => ({ available: false, reason: '连不上 ComfyUI（http://127.0.0.1:8188）' }), log),
    );

    const response = await buildSelfCheck();
    expect(entryOf(response, 'host-comfyui')?.reason).toContain('连不上 ComfyUI');
  });

  it('**逐项独立**：一个后端炸了，不影响另一项的结论（这正是自检相对"提交时才发现"的价值）', async () => {
    process.env.EXPOSE_HOST_LOCAL_TRACK = '1';
    const log: HealthLog = { calls: 0, refresh: [] };
    __setProviderForTesting(
      'host-comfyui',
      fakeProvider(async () => {
        throw new Error('socket hang up');
      }, log),
    );

    const response = await buildSelfCheck();

    expect(entryOf(response, 'host-comfyui')?.available).toBe(false);
    expect(entryOf(response, 'host-comfyui')?.reason).toContain('socket hang up');
    // 另一项（本地 H3：本服务没有可执行的推理 provider）照样给出自己的结论
    expect(entryOf(response, 'local-minimax-h3')?.available).toBe(false);
    expect(entryOf(response, 'local-minimax-h3')?.reason).toContain('MiniMax H3');
  });

  it('挂着不响应 → **硬超时**（一个"检测"按钮转十分钟，比报一句超时糟得多）', async () => {
    process.env.EXPOSE_HOST_LOCAL_TRACK = '1';
    const log: HealthLog = { calls: 0, refresh: [] };
    __setProviderForTesting(
      'host-comfyui',
      fakeProvider(() => new Promise(() => {}), log), // 永不 settle
    );

    const started = Date.now();
    const response = await buildSelfCheck(30); // 测试用 30ms，生产是 15s
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(5_000); // 证明真的被超时切断，而不是一直等
    expect(entryOf(response, 'host-comfyui')?.reason).toContain('超时');
  });

  it('结果**不缓存**：连点两次 = 问两次（"刚才通不通"不能拿上一次的答案）', async () => {
    process.env.EXPOSE_HOST_LOCAL_TRACK = '1';
    const log: HealthLog = { calls: 0, refresh: [] };
    __setProviderForTesting('host-comfyui', fakeProvider(async () => ({ available: true }), log));

    await buildSelfCheck();
    await buildSelfCheck();

    expect(log.calls).toBe(2);
  });

  it('available=true 且没有 reason 时**不硬塞**一个（形状保持最小）', async () => {
    process.env.EXPOSE_HOST_LOCAL_TRACK = '1';
    const log: HealthLog = { calls: 0, refresh: [] };
    __setProviderForTesting('host-comfyui', fakeProvider(async () => ({ available: true }), log));

    const entry = entryOf(await buildSelfCheck(), 'host-comfyui');
    expect(entry?.available).toBe(true);
    expect(entry?.reason).toBeUndefined();
  });

  it('checkedAt 是 ISO 时刻（它回答的是"刚才"，所以必须带时间）', async () => {
    const response = await buildSelfCheck();
    expect(Number.isNaN(Date.parse(response.checkedAt))).toBe(false);
    expect(response.checkedAt).toContain('T');
  });
});

describe('运行时自检 · 未配置时如实说话', () => {
  it('未开放本地轨 → 原因里点名那个 env（用户照着改就能通）', async () => {
    delete process.env.EXPOSE_HOST_LOCAL_TRACK;
    delete process.env.COMFYUI_BASE_URL;

    const response = await buildSelfCheck();
    expect(response.entries.every((entry) => entry.available === false)).toBe(true);
    expect(entryOf(response, 'host-comfyui')?.reason).toContain('EXPOSE_HOST_LOCAL_TRACK');
  });

  it('开放了但没配 ComfyUI 地址 → 说清缺哪个 env（不是"本地引擎不可用"这种糊话）', async () => {
    process.env.EXPOSE_HOST_LOCAL_TRACK = '1';
    delete process.env.COMFYUI_BASE_URL;

    const response = await buildSelfCheck();
    expect(entryOf(response, 'host-comfyui')?.reason).toContain('COMFYUI_BASE_URL');
  });

  it('本地 H3 那一档如实说明"没有可执行的推理 provider"（不是含糊的"不可用"）', async () => {
    process.env.EXPOSE_HOST_LOCAL_TRACK = '1';

    const response = await buildSelfCheck();
    expect(entryOf(response, 'local-minimax-h3')?.reason).toContain('没有可执行的推理 provider');
  });
});
