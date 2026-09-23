import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../store/db.js';
import type { Db } from '../store/db.js';
import { EventLogStore } from '../store/eventLog.js';
import { registerRequestLog } from './requestLog.js';

/**
 * 请求级操作日志（CONTRACT §10，V2.1）。
 *
 * 这个文件真正要钉死的是**噪声纪律**：日志页自己每 3s 轮询、任务进度每 2s 轮询 ——
 * 把读操作也记下来，半天就能把"操作日志"变成"轮询日志"，功能等于没做。
 * 其次才是"记下来的东西对不对"（凭据擦除、请求体截断、action 与 taskId 的推导）。
 */

let db: Db;
let store: EventLogStore;

async function buildHarness() {
  const app = Fastify();
  registerRequestLog(app, { store });

  // 用来验证"哪些记、哪些不记"的最小路由集合（形状与真实路由一致）
  app.post('/api/generate', async () => ({ taskId: 'task-abc' }));
  app.post('/api/upload', async () => ({ assets: [] }));
  app.post('/api/tasks/task-abc/cancel', async () => ({ ok: true, taskId: 'task-abc' }));
  app.delete('/api/history/task-abc', async () => ({ ok: true, taskId: 'task-abc' }));
  app.get('/api/tasks/:taskId', async () => ({ taskId: 'task-abc', status: 'running' }));
  app.get('/api/history', async () => ({ items: [] }));
  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/logs', async () => ({ items: [], total: 0 }));
  app.get('/api/boom', async (_request, reply) =>
    reply.code(502).send({
      code: 'UPSTREAM_ERROR',
      message: 'HTTP 404【InvalidEndpointOrModel.NotFound】：模型不存在 Request id: 0217abcdef',
      disposition: 'terminal',
    }),
  );
  app.get('/media/clip.mp4', async () => 'binary');
  app.get('/assets/app.js', async () => 'js');

  await app.ready();
  return app;
}

beforeEach(() => {
  db = openDatabase(':memory:');
  store = new EventLogStore(db);
});

afterEach(() => {
  db.close();
});

describe('噪声纪律：记写操作与失败，不记读操作/静态/日志页', () => {
  it('写操作全部记，且带上语义动作与 taskId', async () => {
    const app = await buildHarness();
    await app.inject({ method: 'POST', url: '/api/generate', payload: { prompt: 'x' } });
    await app.inject({ method: 'POST', url: '/api/tasks/task-abc/cancel' });
    await app.inject({ method: 'DELETE', url: '/api/history/task-abc' });
    await app.close();

    const actions = store.list().items.map((item) => item.action);
    expect(actions).toEqual(['history.delete', 'task.cancel', 'generate.submit']);

    const submit = store.list({ action: 'generate.submit' }).items[0];
    expect(submit?.taskId).toBe('task-abc');
    expect(submit?.statusCode).toBe(200);
    expect(submit?.durationMs).toBeGreaterThanOrEqual(0);
    expect(submit?.body).toContain('"prompt":"x"');
  });

  it('成功的读操作**不记**（否则轮询会把日志淹掉）', async () => {
    const app = await buildHarness();
    await app.inject({ method: 'GET', url: '/api/tasks/task-abc' });
    await app.inject({ method: 'GET', url: '/api/history' });
    await app.close();

    expect(store.list().total).toBe(0);
  });

  it('失败的读操作要记（404 之类的排错线索不能丢）', async () => {
    const app = await buildHarness();
    const response = await app.inject({ method: 'GET', url: '/api/boom' });
    await app.close();

    expect(response.statusCode).toBe(502);
    const item = store.list().items[0];
    expect(item?.action).toBe('request.error');
    expect(item?.statusCode).toBe(502);
    expect(item?.errorCode).toBe('UPSTREAM_ERROR');
    expect(item?.disposition).toBe('terminal');
    // 上游 request id 被抠进 detail —— 这正是"用户报错截图里那串"能一条命中的关键
    expect(item?.detail?.['upstreamRequestId']).toBe('0217abcdef');
  });

  it('/media、/api/health、/api/logs 一律不记（静态资源与探活会刷爆）', async () => {
    const app = await buildHarness();
    await app.inject({ method: 'GET', url: '/media/clip.mp4' });
    await app.inject({ method: 'GET', url: '/api/health' });
    await app.inject({ method: 'GET', url: '/api/logs' });
    await app.inject({ method: 'GET', url: '/assets/app.js' });
    await app.close();

    expect(store.list().total).toBe(0);
  });
});

describe('数据纪律：凭据擦除与请求体截断', () => {
  it('请求体里的 Key 形态字符串必须被擦掉（即便有人违规往 body 里塞）', async () => {
    const app = await buildHarness();
    await app.inject({
      method: 'POST',
      url: '/api/generate',
      payload: { prompt: 'x', leak: 'sk-abcdef1234567890' },
    });
    await app.close();

    const body = store.list().items[0]?.body ?? '';
    expect(body).not.toContain('sk-abcdef1234567890');
    expect(body).toContain('<redacted>');
  });

  it('超长请求体被截断（并如实标注原长）', async () => {
    const app = await buildHarness();
    await app.inject({
      method: 'POST',
      url: '/api/generate',
      payload: { prompt: '雨'.repeat(5000) },
    });
    await app.close();

    const body = store.list().items[0]?.body ?? '';
    expect(body).toContain('已截断');
    expect(body.length).toBeLessThan(4_300);
  });

  it('multipart 只记摘要，不记内容（20MB 的上传不能把库撑爆）', async () => {
    const app = await buildHarness();
    await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { 'content-type': 'multipart/form-data; boundary=----x' },
      payload: 'binary-ish',
    });
    await app.close();

    const body = store.list().items[0]?.body ?? '';
    expect(body).toContain('multipart/form-data');
    expect(body).not.toContain('binary-ish');
  });
});

describe('请求 id 可追溯', () => {
  it('响应头回写 x-request-id，且与日志里记的是同一个', async () => {
    const app = await buildHarness();
    const response = await app.inject({ method: 'POST', url: '/api/generate', payload: { prompt: 'x' } });
    await app.close();

    const header = response.headers['x-request-id'];
    expect(typeof header).toBe('string');
    expect(store.list().items[0]?.requestId).toBe(header);
  });
});
