import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, describe, expect, it } from 'vitest';
import type { ErrorResponse, LogListResponse } from '@astrmira/shared';
import { BURST_WINDOW_MS, BurstLimiter } from '../security/rateLimit.js';
import { openDatabase } from '../store/db.js';
import { EventLogStore } from '../store/eventLog.js';
import { createLogRoutes } from './logs.js';

/**
 * `GET /api/logs` 的独立限流桶（V2.8 / 台账 B25）。
 *
 * 两条都要钉住：
 * - **脚本级高频**被挡（429 + Retry-After）；
 * - **正常界面节奏**不受影响 —— 日志页挂载 + 轮询 + 连续交互的请求间隔远大于配额窗口，
 *   而两个 DELETE（写操作、频率天然低）**刻意不挂桶**，避免误伤"连续手删"。
 */

const TMP_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-logs-limit-'));
const db = openDatabase(path.join(TMP_DIR, 'app.db'));

afterAll(() => {
  db.close();
  rmSync(TMP_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

async function buildApp(limiter?: BurstLimiter) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(
    createLogRoutes({
      store: new EventLogStore(db),
      ...(limiter === undefined ? {} : { limiter }),
    }),
  );
  await app.ready();
  return app;
}

describe('GET /api/logs · 限流桶（V2.8 / B25）', () => {
  it('配额用尽 → 429 + Retry-After；另一个 IP 不受影响', async () => {
    const app = await buildApp(new BurstLimiter(BURST_WINDOW_MS, 2));
    try {
      const first = await app.inject({
        method: 'GET',
        url: '/api/logs',
        remoteAddress: '198.51.100.61',
      });
      const second = await app.inject({
        method: 'GET',
        url: '/api/logs',
        remoteAddress: '198.51.100.61',
      });
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect((first.json() as LogListResponse).items).toEqual([]);

      const limited = await app.inject({
        method: 'GET',
        url: '/api/logs',
        remoteAddress: '198.51.100.61',
      });
      expect(limited.statusCode).toBe(429);
      expect(limited.headers['retry-after']).toBeDefined();
      expect((limited.json() as ErrorResponse).code).toBe('RATE_LIMITED');

      const other = await app.inject({
        method: 'GET',
        url: '/api/logs',
        remoteAddress: '198.51.100.62',
      });
      expect(other.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('两个 DELETE 不挂桶（连续删多条不误伤）', async () => {
    const app = await buildApp(new BurstLimiter(BURST_WINDOW_MS, 1));
    try {
      // 先占满 GET 的配额，证明 DELETE 走的是另一条路（不受该桶约束）
      await app.inject({ method: 'GET', url: '/api/logs', remoteAddress: '198.51.100.63' });
      const limited = await app.inject({
        method: 'GET',
        url: '/api/logs',
        remoteAddress: '198.51.100.63',
      });
      expect(limited.statusCode).toBe(429);

      const deleteOne = await app.inject({
        method: 'DELETE',
        url: '/api/logs/999',
        remoteAddress: '198.51.100.63',
      });
      const deleteMany = await app.inject({
        method: 'DELETE',
        url: '/api/logs',
        remoteAddress: '198.51.100.63',
      });
      expect(deleteOne.statusCode).toBe(200);
      expect(deleteMany.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
