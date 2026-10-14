import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HealthResponseSchema, ProviderStatusSchema } from '@astrmira/shared';
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

  it('本地段只陈述本服务自身：未开放本地轨时 available=false + 对应 reason + 无 tier', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/providers/status' });
    const body = res.json();

    expect(body.local.available).toBe(false);
    expect(body.local.tier).toBeUndefined();
    expect(body.local.reason).toBe('本服务未向访客开放本地轨');
  });

  it('文案纪律 + 脱敏：不得替访客判断设备，也不得出现任何硬件细节', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/providers/status' });

    expect(res.body).not.toMatch(HARDWARE_DETAIL_PATTERN);
    expect(res.body).not.toMatch(VISITOR_JUDGEMENT_PATTERN);
    expect(res.json().defaultProvider).toBe('cloud-volcano-seedance');
  });

  it('AC6：EXPOSE=1 但未配置引擎 → available:false + 原因点名缺哪个 env', async () => {
    process.env.EXPOSE_HOST_LOCAL_TRACK = '1';
    const local = await buildApp();

    try {
      const res = await local.inject({ method: 'GET', url: '/api/providers/status' });
      const body = res.json();

      expect(body.local.available).toBe(false);
      // V2.32：`local` 段 = 自装 MiniMax H3 这一档，原因要点名缺 H3_WORKDIR
      // （ComfyUI 的配置事实走 `comfyui` 段 —— 一个后端一段，不互相代言）
      expect(body.local.reason).toContain('H3_WORKDIR');
      expect(body.local.tier).toBeUndefined();
      // 与 R1 同源的取反断言：**未配置态**的文案同样不得夹带任何硬件细节（型号 / 显存数字）
      expect(res.body).not.toMatch(HARDWARE_DETAIL_PATTERN);
    } finally {
      await local.close();
      delete process.env.EXPOSE_HOST_LOCAL_TRACK;
    }
  });

  it('AC6：EXPOSE=1 且 H3_WORKDIR 合法 → available:true、tier 来自显式声明，且不回显路径/型号', async () => {
    const workdir = mkdtempSync(path.join(tmpdir(), 'astrmira-probe-int-'));
    process.env.EXPOSE_HOST_LOCAL_TRACK = '1';
    process.env.H3_WORKDIR = workdir;
    process.env.H3_TIER = '2';

    const local = await buildApp();

    try {
      const res = await local.inject({ method: 'GET', url: '/api/providers/status' });
      const body = res.json();

      expect(body.local.available).toBe(true);
      expect(body.local.tier).toBe(2);
      // 键集合仍与契约一致：不得因"可用"就塞回硬件字段
      expect(Object.keys(body.local).sort()).toEqual(['available', 'provider', 'reason', 'tier']);
      expect(res.body).not.toMatch(HARDWARE_DETAIL_PATTERN);
      // 脱敏：不得回显部署者的绝对路径
      expect(res.body).not.toContain(workdir);
    } finally {
      await local.close();
      delete process.env.EXPOSE_HOST_LOCAL_TRACK;
      delete process.env.H3_WORKDIR;
      delete process.env.H3_TIER;
      rmSync(workdir, { recursive: true, force: true, maxRetries: 3 });
    }
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
