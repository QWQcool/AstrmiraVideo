import { afterEach, describe, expect, it } from 'vitest';
import type { VideoProvider } from '@astrmira/shared';
import { __clearProviderTestOverrides, __setProviderForTesting } from '../providers/registry.js';
import {
  buildProviderStatus,
  buildSelfCheck,
  clearComfyCapabilityCache,
  getComfyCapability,
} from './providers.js';

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
  clearComfyCapabilityCache();
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

  it('V2.51：自检把 provider 判出的 modes 写进条目、进程缓存与 /status', async () => {
    process.env.EXPOSE_HOST_LOCAL_TRACK = '1';
    process.env.COMFYUI_BASE_URL = 'http://127.0.0.1:8188';
    const log: HealthLog = { calls: 0, refresh: [] };
    const base = fakeProvider(async () => ({ available: true }), log);
    const provider = Object.assign(base, {
      capabilityModes: () => ['t2v', 't2i'],
    });
    __setProviderForTesting('host-comfyui', provider);

    const response = await buildSelfCheck();
    const entry = response.entries.find((item) => item.provider === 'host-comfyui');
    expect(entry?.modes).toEqual(['t2v', 't2i']);
    expect(getComfyCapability('host-comfyui')?.modes).toEqual(['t2v', 't2i']);
    expect(getComfyCapability('host-comfyui')?.checkedAt).toBeTruthy();

    const status = buildProviderStatus();
    expect(status.comfyui.servers[0]?.modes).toEqual(['t2v', 't2i']);
    expect(status.comfyui.servers[0]?.modesCheckedAt).toBeTruthy();
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

  it('一台连不上 → 如实说明原因（不假装成功，也不含糊成一句"不可用"）', async () => {
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
    // V2.37（D56）：撤掉的 H3 档不再出现。
    // 多台之间的"逐项独立"由两道**更真**的覆盖兜着：`comfyuiServers.test.ts`（白名单逐实例独立）
    // 与 UI 冒烟的"一台连不上不影响另一台的结论"（真浏览器 + 真注入）。
    expect(response.entries.map((entry) => entry.provider)).toEqual(['host-comfyui']);
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

  it('**撤掉的档位不再出现在自检里**（V2.37 / D56）—— 它已经不是"没配"，而是"没有了"', async () => {
    process.env.EXPOSE_HOST_LOCAL_TRACK = '1';

    const response = await buildSelfCheck();
    const ids = response.entries.map((entry) => entry.provider);

    // 撤掉之前这里会多一条"本服务没有可执行的推理 provider"
    expect(ids).not.toContain('local-minimax-h3');
    // 而"没配 ComfyUI 时照样列出那一档"这条口径**不变**（点一下就知道缺什么）
    expect(ids).toEqual(['host-comfyui']);
  });
});
