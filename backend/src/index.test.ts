import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HealthResponseSchema, ProviderStatusSchema } from '@astrmira/shared';
import { buildApp } from './index.js';

/**
 * 真实链路测试（Step 1.5 / T4，见 PLAN §5）：全部经 `app.inject()` 打到真实路由 +
 * 真实 response schema 序列化，
 * 不依赖任何监听端口（inject 不起服务）。契约来源：@astrmira/shared（CONTRACT 的单一事实源投影）。
 */
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;

beforeAll(async () => {
  // 固定探针前置条件：无环境 Key、无自定义 CORS 白名单，与断言口径一致
  delete process.env.VOLCANO_API_KEY;
  delete process.env.CORS_ORIGINS;
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

describe('GET /api/providers/status（CONTRACT §2 / PLAN §6-D12）', () => {
  it('返回 200，且响应体通过 ProviderStatusSchema 校验', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/providers/status' });

    expect(res.statusCode).toBe(200);

    const parsed = ProviderStatusSchema.safeParse(res.json());
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('无 Key 环境：cloud.available === false 且带 reason', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/providers/status' });
    const body = res.json();

    expect(body.cloud.available).toBe(false);
    expect(typeof body.cloud.reason).toBe('string');
    expect(body.cloud.keySource).toBeUndefined();
  });

  it('本地算力探测未实现：local.available === false 且 tier === 0，带 reason', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/providers/status' });
    const body = res.json();

    expect(body.local.available).toBe(false);
    expect(body.local.tier).toBe(0);
    expect(typeof body.local.reason).toBe('string');
  });

  it('回归断言：响应键集合必须与契约完全一致（防止型号 / 显存字段被塞回探针）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/providers/status' });
    const body = res.json();

    // 键集合严格等于 CONTRACT §2 定义：多出一个「型号 / 显存」类字段即失败。
    // 该断言严格强于「响应文本不含某型号字样」——任何回传硬件细节的字段都无处藏身，
    // 同时避免把具体型号字面量写进仓库正文（T1-AC1 / DoD 脱敏回检）。
    expect(Object.keys(body.local).sort()).toEqual(['available', 'provider', 'reason', 'tier']);
    expect(Object.keys(body.cloud).sort()).toEqual(['available', 'provider', 'reason']);

    // 文案精确锚定：把硬件细节嵌进 reason 的改动同样会失败
    expect(body.local.reason).toBe('本地算力探测尚未实现（Step 2 接入真实探针）');
  });

  it('defaultProvider 固定为 cloud-volcano-seedance', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/providers/status' });
    expect(res.json().defaultProvider).toBe('cloud-volcano-seedance');
  });
});

describe('CORS 白名单（PLAN §7-6：未配置 CORS_ORIGINS 时仅允许 http://localhost:5173）', () => {
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
