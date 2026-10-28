import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ALWAYS_PUBLIC_PATHS } from '../security/auth.js';
import { openDatabase, type Db } from '../store/db.js';
import { TaskStore } from '../store/taskStore.js';
import { createObservabilityRoutes, type ObservabilityRoutesDeps } from './observability.js';

/**
 * 可观测端点（V2.16 / 台账 B53，契约 §16）。
 *
 * 断言侧重**三件事**：
 * ① **live 与 ready 的语义差**（live 零依赖、永远 200；ready 依赖故障时 **503** 且响应体仍给完整 checks）；
 * ② **免鉴权名单**只放开存活探针 —— ready/metrics 会暴露部署内部细节，刻意要鉴权；
 * ③ 快照经契约 schema 序列化后**形状稳定**（契约之外的字段会被剥离，这是 D19 的既定行为）。
 */

const FIXED_NOW = 1_700_000_000_000;

function emptyStorage() {
  return {
    totalBytes: 0,
    videoBytes: 0,
    videoCount: 0,
    thumbBytes: 0,
    assetBytes: 0,
    assetCount: 0,
  };
}

async function buildApp(db: Db, overrides: Partial<ObservabilityRoutesDeps> = {}) {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(
    createObservabilityRoutes({
      tasks: new TaskStore(db),
      outputsDir: process.cwd(),
      maxBytes: 1_000,
      now: () => FIXED_NOW,
      readStorage: async () => emptyStorage(),
      ...overrides,
    }),
  );
  return app;
}

describe('可观测端点（CONTRACT §16）', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('GET /api/health/live：零依赖、永远 200、带 uptime（重启排查的第一手事实）', async () => {
    const app = await buildApp(db);
    const response = await app.inject({ method: 'GET', url: '/api/health/live' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.name).toContain('AstrmiraVideo');
    expect(typeof body.uptimeSec).toBe('number');
    expect(typeof body.timestamp).toBe('string');
  });

  it('GET /api/health/ready：正常 → 200 ready，checks 含数据库与目录可写', async () => {
    const app = await buildApp(db);
    const response = await app.inject({ method: 'GET', url: '/api/health/ready' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ready');
    expect(body.checks.map((check: { id: string }) => check.id)).toEqual([
      'database',
      'storage.writable',
      'storage.headroom',
    ]);
  });

  it('GET /api/health/ready：依赖故障 → **503**，且响应体照样给完整 checks（排错要看原因）', async () => {
    const app = await buildApp(db, {
      tasks: {
        countByStatus: () => {
          throw new Error('database is locked');
        },
        countRunning: () => 0,
        countUncertain: () => 0,
        oldestCreatedAt: () => null,
        databaseFileBytes: () => ({ fileBytes: 0, walBytes: 0 }),
      },
    });
    const response = await app.inject({ method: 'GET', url: '/api/health/ready' });
    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.status).toBe('degraded');
    expect(body.checks[0]).toMatchObject({ id: 'database', ok: false, required: true });
  });

  it('GET /api/metrics：快照形状齐全（任务/队列/存储/数据库/告警/阈值）', async () => {
    const app = await buildApp(db);
    const response = await app.inject({ method: 'GET', url: '/api/metrics' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Object.keys(body).sort()).toEqual([
      'alerts',
      'database',
      'generatedAt',
      'queue',
      'service',
      'status',
      'storage',
      'tasks',
      'thresholds',
      'uptimeSec',
    ]);
    expect(body.status).toBe('ok');
    expect(body.alerts).toEqual([]);
    expect(body.storage.maxBytes).toBe(1_000);
    expect(body.tasks.byStatus.succeeded).toBe(0);
  });

  it('GET /api/metrics：越过阈值时 status=degraded 并带上告警（value/threshold 可复核）', async () => {
    const app = await buildApp(db, {
      readStorage: async () => ({
        ...emptyStorage(),
        totalBytes: 2_000, // > maxBytes 1_000 → 同时触发 overThreshold
        videoBytes: 2_000,
        videoCount: 1,
      }),
    });
    const body = (await app.inject({ method: 'GET', url: '/api/metrics' })).json();
    expect(body.status).toBe('degraded');
    expect(body.alerts[0]).toMatchObject({ id: 'storage.critical', severity: 'critical' });
    expect(body.alerts[0].value).not.toBeNull();
  });

  it('**免鉴权名单只放开存活探针**：ready 与 metrics 必须鉴权（它们暴露部署内部细节）', () => {
    expect(ALWAYS_PUBLIC_PATHS).toContain('/api/health');
    expect(ALWAYS_PUBLIC_PATHS).toContain('/api/health/live');
    expect(ALWAYS_PUBLIC_PATHS).not.toContain('/api/health/ready');
    expect(ALWAYS_PUBLIC_PATHS).not.toContain('/api/metrics');
  });
});
