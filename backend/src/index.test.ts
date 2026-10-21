import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HealthResponseSchema, ProviderStatusSchema, SelfCheckResponseSchema } from '@astrmira/shared';
import { buildApp } from './index.js';

/**
 * 真实链路测试（Step 1.5 / T4，见 PLAN §5）：全部经 `app.inject()` 打到真实路由 +
 * 真实 response schema 序列化，不依赖任何监听端口（inject 不起服务）。
 * 契约来源：`@astrmira/shared`（CONTRACT 的单一事实源投影，现为 **V1.8**）。
 */
type App = Awaited<ReturnType<typeof buildApp>>;

/**
 * 硬件细节的**反例样本**（不是硬件信息登记，只服务于「不得泄漏」的取反断言）——
 * 与 CONTRACT §2（V1.8 删除 gpuName / vramFreeGB）及 PLAN §6-D27 配套。
 */
const HARDWARE_DETAIL_PATTERN = /(RTX|GTX|A100|H100|[0-9]+\s?GB)/i;

/** 对访问者设备的越界判断（PLAN §3 铁律 2 文案纪律的反例样本） */
const VISITOR_JUDGEMENT_PATTERN = /你的设备|你的显存|你没有显卡/;

let app: App;

beforeAll(async () => {
  // 固定前置条件：无 env 兜底 Key、无自定义 CORS 白名单、host 本地轨未开放
  delete process.env.VOLCANO_API_KEY;
  delete process.env.CORS_ORIGINS;
  delete process.env.EXPOSE_HOST_LOCAL_TRACK;
  // 存储走内存库，避免测试污染真实 data/app.db
  process.env.DATA_DIR = ':memory:';
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('POST /api/agent/plan（CONTRACT §23 / S6-B1）', () => {
  it('非法 JSON body → 400 ErrorResponse，而不是 500 序列化错误', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/plan',
      headers: { 'content-type': 'application/json' },
      payload: '{bad',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'INVALID_REQUEST', disposition: 'terminal' });
  });
});

describe('GET /api/health（CONTRACT §5 路由表 / §8 响应形状）', () => {
  it('返回 200，且响应体通过 HealthResponseSchema 校验', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);

    const parsed = HealthResponseSchema.safeParse(res.json());
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);

    expect(res.json().status).toBe('ok');
    expect(Number.isNaN(Date.parse(res.json().timestamp))).toBe(false);
  });
});

describe('GET /api/providers/status（CONTRACT §2 V1.8 / PLAN §6-D22、D27）', () => {
  it('返回 200，且响应体通过 ProviderStatusSchema 校验', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/providers/status' });

    expect(res.statusCode).toBe(200);

    const parsed = ProviderStatusSchema.safeParse(res.json());
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('键集合与契约完全一致：local 不得出现 gpuName / vramFreeGB 等硬件字段', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/providers/status' });
    const body = res.json();

    expect(Object.keys(body.local).sort()).toEqual(['available', 'provider', 'reason']);
    expect(Object.keys(body.cloud).sort()).toEqual([
      'acceptsClientKey',
      'available',
      'provider',
      'reason',
    ]);
  });

  it('无 env 兜底 Key：cloud.available === false、keySource 为 undefined，acceptsClientKey 恒 true', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/providers/status' });
    const body = res.json();

    expect(body.cloud.available).toBe(false);
    expect(body.cloud.keySource).toBeUndefined();
    expect(body.cloud.acceptsClientKey).toBe(true);
  });

  it('`local` 段如实说明「这一档已撤掉」（V2.37 / D56）—— 且仍不给硬件字段', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/providers/status' });
    const body = res.json();

    expect(body.local.available).toBe(false);
    expect(body.local.tier).toBeUndefined();
    // 撤掉之后这一段的唯一口径：说清"没有了、该改用哪个"
    expect(body.local.reason).toContain('已撤掉');
    expect(body.local.reason).toContain('host-comfyui');
    // 字段**保留**的理由钉在这里：它现在是一句人话；删掉字段会让旧前端读到 undefined
    expect(Object.keys(body.local).sort()).toEqual(['available', 'provider', 'reason']);
  });

  it('文案纪律 + 脱敏：不得替访客判断设备，也不得出现任何硬件细节', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/providers/status' });

    expect(res.body).not.toMatch(HARDWARE_DETAIL_PATTERN);
    expect(res.body).not.toMatch(VISITOR_JUDGEMENT_PATTERN);
    expect(res.json().defaultProvider).toBe('cloud-volcano-seedance');
  });

  it('AC6：EXPOSE=1 但未配置 ComfyUI → 原因点名缺哪个 env（V2.37 起这件事归 `comfyui` 段）', async () => {
    process.env.EXPOSE_HOST_LOCAL_TRACK = '1';
    const local = await buildApp();

    try {
      const res = await local.inject({ method: 'GET', url: '/api/providers/status' });
      const body = res.json();

      expect(body.comfyui.available).toBe(false);
      expect(body.comfyui.reason).toContain('COMFYUI_BASE_URL');
      expect(body.comfyui.servers).toEqual([]);
      // 与 R1 同源的取反断言：**未配置态**的文案同样不得夹带任何硬件细节（型号 / 显存数字）
      expect(res.body).not.toMatch(HARDWARE_DETAIL_PATTERN);
    } finally {
      await local.close();
      delete process.env.EXPOSE_HOST_LOCAL_TRACK;
    }
  });

  it('AC6：EXPOSE=1 且配了回环 ComfyUI → 那一段可用，而 `local` 段**照样**说已撤（不互相代言）', async () => {
    process.env.EXPOSE_HOST_LOCAL_TRACK = '1';
    process.env.COMFYUI_BASE_URL = 'http://127.0.0.1:8188';

    const local = await buildApp();

    try {
      const res = await local.inject({ method: 'GET', url: '/api/providers/status' });
      const body = res.json();

      expect(body.comfyui.available).toBe(true);
      expect(body.comfyui.servers).toEqual([
        { id: 'host-comfyui', label: '默认引擎', available: true },
      ]);
      // V2.32 的"一个后端一段"在撤档之后**仍然成立**：ComfyUI 配好了，不代表 H3 那一档能用了 ——
      // 它已经不是"没配"，而是"没有了"
      expect(body.local.available).toBe(false);
      expect(body.local.reason).toContain('已撤掉');
      expect(res.body).not.toMatch(HARDWARE_DETAIL_PATTERN);
    } finally {
      await local.close();
      delete process.env.EXPOSE_HOST_LOCAL_TRACK;
      delete process.env.COMFYUI_BASE_URL;
    }
  });
});

describe('GET /api/providers/selfcheck（CONTRACT §20 V2.34 / 台账 B4）', () => {
  it('返回 200，且响应体通过 SelfCheckResponseSchema 校验（checkedAt 是合法时间）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/providers/selfcheck' });

    expect(res.statusCode).toBe(200);
    const parsed = SelfCheckResponseSchema.safeParse(res.json());
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(Number.isNaN(Date.parse(res.json().checkedAt))).toBe(false);
  });

  it('只自检 ComfyUI 实例（云端是配置事实，不联网探测；**H3 那一档已撤** —— V2.37 / D56）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/providers/selfcheck' });
    const ids = (res.json().entries as { provider: string }[]).map((entry) => entry.provider);

    // 一台都没配时仍列出默认那一档 —— B4 的价值就是"点一下就知道缺什么"
    expect(ids).toEqual(['host-comfyui']);
    expect(ids).not.toContain('cloud-volcano-seedance');
    // 撤掉的档位不该继续出现在自检里：它已经不是"没配"，而是"没有了"
    expect(ids).not.toContain('local-minimax-h3');
  });

  it('默认（未开放本地轨）→ 每一项都不可用，且**原因里点名那个 env**（不是一句"不可用"）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/providers/selfcheck' });
    const entries = res.json().entries as { available: boolean; reason?: string }[];

    expect(entries.every((entry) => entry.available === false)).toBe(true);
    expect(entries.every((entry) => (entry.reason ?? '').includes('EXPOSE_HOST_LOCAL_TRACK'))).toBe(true);
  });

  it('文案纪律同样适用：自检结果不得出现硬件型号 / 显存数字（D27）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/providers/selfcheck' });
    expect(res.body).not.toMatch(HARDWARE_DETAIL_PATTERN);
    expect(res.body).not.toMatch(VISITOR_JUDGEMENT_PATTERN);
  });
});

describe('CORS 白名单（PLAN §7-4 / §7-6：未配置 CORS_ORIGINS 时仅允许 http://localhost:5173）', () => {
  it('白名单内来源回显 access-control-allow-origin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'http://localhost:5173' },
    });

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('白名单外来源不回 access-control-allow-origin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'http://evil.example' },
    });

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
