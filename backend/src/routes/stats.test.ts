import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import type { StatRow, TaskStore } from '../store/taskStore.js';
import { createStatsRoutes } from './stats.js';

/**
 * `/api/stats/summary`（CONTRACT §16 附 / V2.90）。
 *
 * 路由只负责取数与拼装，所以这里用桩 store 钉**契约形状**：
 * 状态码 200、字段齐全、`comfyLinks` 由注入提供（没有实例就是空数组）。
 */

const apps: Array<{ close(): Promise<void> }> = [];

async function harness(rows: StatRow[]) {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  const store = { listStatRows: () => rows } as unknown as TaskStore;
  await app.register(
    createStatsRoutes({
      store,
      comfyLinks: () => [
        { baseUrl: 'http://127.0.0.1:8190', state: 'connected', opens: 2, reconnects: 1 },
      ],
    }),
  );
  await app.ready();
  apps.push(app);
  return app;
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

const row = (provider: string, status: string, ms: number, errorCode: string | null = null): StatRow => ({
  provider,
  status,
  createdAt: 1_000,
  updatedAt: 1_000 + ms,
  errorCode,
});

describe('GET /api/stats/summary', () => {
  it('返回按 provider 的聚合 + 失败码 + WS 连接事实', async () => {
    const app = await harness([
      row('host-comfyui', 'succeeded', 1_000),
      row('host-comfyui', 'failed', 3_000, 'UPSTREAM_ERROR'),
      row('cloud-volcano-seedance', 'succeeded', 60_000),
    ]);

    const response = await app.inject({ method: 'GET', url: '/api/stats/summary' });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.total).toBe(3);
    expect(body.truncated).toBe(false);
    expect(body.byProvider).toHaveLength(2);
    expect(body.byProvider[0]).toMatchObject({ provider: 'host-comfyui', count: 2 });
    expect(body.byProvider[0].p50Ms).toBeTypeOf('number');
    expect(body.failureCodes).toEqual([{ code: 'UPSTREAM_ERROR', count: 1 }]);
    expect(body.comfyLinks[0]).toMatchObject({ state: 'connected', reconnects: 1 });
    // 口径句由服务端下发（界面不该自己再造一句）
    expect(body.durationNote).toContain('不是模型推理耗时');
  });

  it('空库也是 200 + 空数组（不是 404，也不造一条假连接）', async () => {
    const app = await harness([]);
    const response = await app.inject({ method: 'GET', url: '/api/stats/summary' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ total: 0, byProvider: [], failureCodes: [] });
  });

  it('区间参数透传（非法值 → 400，由 schema 拒绝）', async () => {
    const app = await harness([]);
    const bad = await app.inject({ method: 'GET', url: '/api/stats/summary?from=abc' });
    expect(bad.statusCode).toBe(400);
  });
});
