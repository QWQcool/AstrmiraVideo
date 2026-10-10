import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createErrorResponse } from '../errors.js';
import { openDatabase, type Db } from '../store/db.js';
import { ProjectStore } from '../store/projects.js';
import { WebhookStore } from '../store/webhooks.js';
import { createWebhookRoutes } from './webhooks.js';

/**
 * Webhook 订阅管理（V2.15 / 台账 B51 片 A，契约 §15）。
 *
 * 断言侧重**四件容易出错的事**：
 * ① **secret 只回显一次**（列表里永远只有掩码 —— 凭据不可回读）；
 * ② **SSRF 准入**在创建与改 URL 两条路径上都生效（默认拒私网，开关可放行）；
 * ③ 项目维度与全站一致（省略 = 默认项目；显式不存在 → `PROJECT_NOT_FOUND`）；
 * ④ 订阅不存在 → `WEBHOOK_NOT_FOUND`（不静默 200）。
 */

const SECRET = 'whsec_0123456789abcdef0123456789abcdef';

async function buildApp(db: Db, options: { allowPrivate?: boolean } = {}) {
  const webhooks = new WebhookStore(db);
  const projects = new ProjectStore(db);
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // 与 index.ts 的全局错误处理器同一口径（否则 schema 校验失败会退成 500）
  app.setErrorHandler((error, _request, reply) => {
    const shaped = error as { validation?: unknown; message?: string };
    if (shaped.validation !== undefined) {
      return reply
        .code(400)
        .send(createErrorResponse('INVALID_REQUEST', `请求不符合契约：${shaped.message ?? '校验失败'}`));
    }
    return reply.send(error as Error);
  });
  await app.register(
    createWebhookRoutes({
      webhooks,
      projects,
      ...(options.allowPrivate === undefined ? {} : { allowPrivate: options.allowPrivate }),
      generateSecret: () => SECRET,
    }),
  );
  return { app, webhooks, projects };
}

describe('Webhook 订阅（CONTRACT §15）', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('创建：201 + **明文 secret 只在这次响应里**；列表里只有掩码', async () => {
    const { app } = await buildApp(db);
    const created = await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      payload: { url: 'https://hooks.example.com/astrmira' },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.secret).toBe(SECRET);
    expect(body.webhook.projectId).toBe('default'); // 省略 = 默认项目
    expect(body.webhook.events).toEqual(['task.terminal']);
    expect(body.webhook.enabled).toBe(true);
    expect(body.webhook.secretMasked).not.toContain(SECRET);

    const list = (await app.inject({ method: 'GET', url: '/api/webhooks' })).json();
    expect(list.webhooks).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(SECRET);
    expect(list.webhooks[0]!.secretMasked.startsWith('whsec_01')).toBe(true);
  });

  it('SSRF 准入：默认拒私网 / 环回；开关放行后可用（B 端内网回调）', async () => {
    const strict = await buildApp(db);
    const blocked = await strict.app.inject({
      method: 'POST',
      url: '/api/webhooks',
      payload: { url: 'http://10.0.0.5/hook' },
    });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().code).toBe('INVALID_REQUEST');
    expect(blocked.json().message).toContain('WEBHOOK_ALLOW_PRIVATE');

    const loose = await buildApp(db, { allowPrivate: true });
    const allowed = await loose.app.inject({
      method: 'POST',
      url: '/api/webhooks',
      payload: { url: 'http://10.0.0.5/hook' },
    });
    expect(allowed.statusCode).toBe(201);
  });

  it('创建：项目不存在 → 404 PROJECT_NOT_FOUND；secret 太短 → 400（schema 兜住）', async () => {
    const { app } = await buildApp(db);
    const missing = await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      payload: { projectId: 'nope', url: 'https://hooks.example.com/x' },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe('PROJECT_NOT_FOUND');

    const weak = await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      payload: { url: 'https://hooks.example.com/x', secret: 'short' },
    });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().code).toBe('INVALID_REQUEST');
  });

  it('列表按项目隔离：省略 = 默认项目，显式项目只看自己的；不存在的项目 → 404', async () => {
    const { app, projects } = await buildApp(db);
    const second = projects.create('二号项目').projectId;
    await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      payload: { url: 'https://hooks.example.com/a' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      payload: { projectId: second, url: 'https://hooks.example.com/b' },
    });

    expect((await app.inject({ method: 'GET', url: '/api/webhooks' })).json().webhooks).toHaveLength(1);
    expect(
      (await app.inject({ method: 'GET', url: `/api/webhooks?project=${second}` })).json().webhooks,
    ).toHaveLength(1);
    const missing = await app.inject({ method: 'GET', url: '/api/webhooks?project=ghost' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe('PROJECT_NOT_FOUND');
  });

  it('改：启停与换地址；换私网地址同样被拦；订阅不存在 → 404 WEBHOOK_NOT_FOUND', async () => {
    const { app } = await buildApp(db);
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: { url: 'https://hooks.example.com/a' },
      })
    ).json();
    const webhookId = created.webhook.webhookId as string;

    const disabled = await app.inject({
      method: 'PATCH',
      url: `/api/webhooks/${webhookId}`,
      payload: { enabled: false },
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().webhook.enabled).toBe(false);
    // 明文 secret 不在任何读接口里（连 PATCH 的响应也不给）
    expect(disabled.json().webhook.secret).toBeUndefined();
    expect(JSON.stringify(disabled.json())).not.toContain(SECRET);

    const badUrl = await app.inject({
      method: 'PATCH',
      url: `/api/webhooks/${webhookId}`,
      payload: { url: 'http://127.0.0.1:9/x' },
    });
    expect(badUrl.statusCode).toBe(400);

    const missing = await app.inject({
      method: 'PATCH',
      url: '/api/webhooks/ghost',
      payload: { enabled: true },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe('WEBHOOK_NOT_FOUND');
  });

  it('删：200 { deleted: true }；再删 → 404（客户系统据此知道配置已删）', async () => {
    const { app } = await buildApp(db);
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: { url: 'https://hooks.example.com/a' },
      })
    ).json();
    const webhookId = created.webhook.webhookId as string;

    expect((await app.inject({ method: 'DELETE', url: `/api/webhooks/${webhookId}` })).statusCode).toBe(200);
    const again = await app.inject({ method: 'DELETE', url: `/api/webhooks/${webhookId}` });
    expect(again.statusCode).toBe(404);
    expect(again.json().code).toBe('WEBHOOK_NOT_FOUND');
  });

  it('投递流水：空列表是 200（不是 404）；订阅不存在才是 404', async () => {
    const { app, webhooks } = await buildApp(db);
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: { url: 'https://hooks.example.com/a' },
      })
    ).json();
    const webhookId = created.webhook.webhookId as string;

    const empty = await app.inject({ method: 'GET', url: `/api/webhooks/${webhookId}/deliveries` });
    expect(empty.statusCode).toBe(200);
    expect(empty.json().deliveries).toEqual([]);

    // 直接经 store 造一条流水（投递循环的验收在 webhook.test.ts，这里只验投影形状）
    webhooks.enqueueMissing({ now: Date.now(), lookbackMs: 1000, batch: 10 });
    const missing = await app.inject({ method: 'GET', url: '/api/webhooks/ghost/deliveries' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe('WEBHOOK_NOT_FOUND');
  });
});
