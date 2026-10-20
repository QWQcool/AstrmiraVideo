import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskProgressSchema } from '@astrmira/shared';
import { buildApp } from '../../index.js';

/**
 * 真实 HTTP mock + 真实 Fastify 路由/调度器：
 * POST /api/generate → dispatcher → HttpServiceProvider → 上游 submit/poll/取产物 → /api/tasks。
 *
 * 不是 curl，但走的是同一条请求栈；比单独 curl 一个路由更能证明“配置型服务”真的能出片。
 */

const dirs: string[] = [];
const closers: Array<() => Promise<void>> = [];
const original = {
  DATA_DIR: process.env.DATA_DIR,
  OUTPUT_DIR: process.env.OUTPUT_DIR,
  HTTP_SERVICES_FILE: process.env.HTTP_SERVICES_FILE,
};

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const key of ['DATA_DIR', 'OUTPUT_DIR', 'HTTP_SERVICES_FILE'] as const) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

describe('HTTP 任务服务 · 路由/调度器集成（V2.47）', () => {
  it('提交 → 轮询 → /media 产物；/status 不泄露地址与 token', async () => {
    let pollCount = 0;
    let submittedBody: Record<string, unknown> | null = null;
    const server = createServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/v1/jobs') {
        let body = '';
        req.setEncoding('utf8');
        for await (const chunk of req) body += chunk;
        submittedBody = JSON.parse(body) as Record<string, unknown>;
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'remote-1' }));
        return;
      }
      if (req.method === 'GET' && req.url === '/v1/jobs/remote-1') {
        pollCount += 1;
        res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify(
            pollCount < 2
              ? { status: 'running' }
              : { status: 'succeeded', result: { video_url: '/media/remote-video.mp4' } },
          ),
        );
        return;
      }
      if (req.method === 'GET' && req.url === '/media/remote-video.mp4') {
        res.writeHead(200, { 'content-type': 'video/mp4' }).end(Buffer.from([4, 3, 2, 1]));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('mock server address');
    closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));

    const outputDir = tempDir('astrmira-http-e2e-out-');
    const dataDir = tempDir('astrmira-http-e2e-data-');
    const profileFile = path.join(tempDir('astrmira-http-e2e-config-'), 'services.json');
    writeFileSync(
      profileFile,
      JSON.stringify([
        {
          name: 'h3-gpu',
          label: 'H3 算力服务器',
          baseUrl: `http://127.0.0.1:${address.port}`,
          modes: ['t2v'],
          submit: {
            path: '/v1/jobs',
            body: { model: 'h3' },
            fields: { prompt: { from: 'prompt', format: 'text' } },
            taskIdField: 'id',
          },
          poll: {
            path: '/v1/jobs/{id}',
            stateField: 'status',
            success: ['succeeded'],
            failed: ['failed'],
          },
          outputs: { video: { path: 'result.video_url', kind: 'video' } },
        },
      ]),
      'utf8',
    );

    process.env.DATA_DIR = dataDir;
    process.env.OUTPUT_DIR = outputDir;
    process.env.HTTP_SERVICES_FILE = profileFile;

    const app = await buildApp();
    closers.push(() => app.close());

    const statusResponse = await app.inject({ method: 'GET', url: '/api/providers/status' });
    expect(statusResponse.statusCode).toBe(200);
    const status = statusResponse.json() as {
      httpServices: { servers: Array<Record<string, unknown>>; available: boolean };
    };
    expect(status.httpServices.available).toBe(true);
    expect(status.httpServices.servers).toEqual([
      {
        id: 'http-service:h3-gpu',
        label: 'H3 算力服务器',
        modes: ['t2v'],
        available: true,
      },
    ]);
    expect(statusResponse.body).not.toContain(`127.0.0.1:${address.port}`);

    const response = await app.inject({
      method: 'POST',
      url: '/api/generate',
      headers: { 'idempotency-key': 'http-service-e2e-1' },
      payload: {
        prompt: '一只猫在窗台',
        mode: 't2v',
        aspectRatio: '16:9',
        provider: 'http-service:h3-gpu',
        params: { durationSec: 5 },
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    const { taskId } = response.json() as { taskId: string };

    let task: unknown = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const poll = await app.inject({ method: 'GET', url: `/api/tasks/${taskId}` });
      expect(poll.statusCode, poll.body).toBe(200);
      task = poll.json();
      const parsed = TaskProgressSchema.parse(task);
      if (parsed.status === 'succeeded' || parsed.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const parsed = TaskProgressSchema.parse(task);
    expect(parsed.status, JSON.stringify(parsed)).toBe('succeeded');
    expect(parsed.executedBy).toBe('remote');
    expect(parsed.outputVideoUrl).toBe('/media/remote-1.mp4');
    expect(submittedBody).toMatchObject({ model: 'h3', prompt: '一只猫在窗台' });

    const media = await app.inject({ method: 'GET', url: '/media/remote-1.mp4' });
    expect(media.statusCode).toBe(200);
    expect(media.headers['content-type']).toContain('video/mp4');
    expect(media.rawPayload).toEqual(Buffer.from([4, 3, 2, 1]));
  });
});
