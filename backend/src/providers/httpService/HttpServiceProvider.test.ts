import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { VideoGenerateRequest } from '@astrmira/shared';
import { ProviderFailureError } from '../../errors.js';
import { HttpServiceProvider } from './HttpServiceProvider.js';
import { HttpServiceEntrySchema } from './httpServiceProfile.js';

const dirs: string[] = [];
const servers: Array<{ close: (callback?: () => void) => void }> = [];

afterEach(async () => {
  delete process.env.HTTP_TEST_TOKEN;
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'astrmira-http-provider-'));
  dirs.push(dir);
  return dir;
}

async function listen(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('test server address');
  return `http://127.0.0.1:${address.port}`;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function request(prompt = '一只猫'): VideoGenerateRequest {
  return {
    prompt,
    mode: 't2v',
    aspectRatio: '16:9',
    durationSec: 5,
    provider: 'http-service:h3-gpu',
  } as VideoGenerateRequest;
}

function profile(baseUrl: string, overrides: Record<string, unknown> = {}) {
  return HttpServiceEntrySchema.parse({
    name: 'h3-gpu',
    label: 'H3 算力服务器',
    baseUrl,
    modes: ['t2v'],
    tokenEnv: 'HTTP_TEST_TOKEN',
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
    cancel: { path: '/v1/jobs/{id}/cancel' },
    health: { path: '/health' },
    outputs: { video: { path: 'result.video_url', kind: 'video' } },
    ...overrides,
  });
}

describe('HTTP 任务服务 provider（CONTRACT §22 / V2.47）', () => {
  it('异步：submit → poll → 下载产物 → cancel；token 只从 env 走', async () => {
    process.env.HTTP_TEST_TOKEN = 'secret-token';
    let pollCount = 0;
    let submitted: Record<string, unknown> | null = null;
    const baseUrl = await listen(async (req, res) => {
      if (req.method === 'POST' && req.url === '/v1/jobs') {
        if (req.headers.authorization !== 'Bearer secret-token') {
          res.writeHead(401).end('bad token');
          return;
        }
        submitted = JSON.parse(await readBody(req)) as Record<string, unknown>;
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'remote-1' }));
        return;
      }
      if (req.method === 'GET' && req.url === '/v1/jobs/remote-1') {
        pollCount += 1;
        res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify(
            pollCount === 1
              ? { status: 'running' }
              : { status: 'succeeded', result: { video_url: '/media/video.mp4' } },
          ),
        );
        return;
      }
      if (req.method === 'GET' && req.url === '/media/video.mp4') {
        res.writeHead(200, { 'content-type': 'video/mp4' }).end(Buffer.from([1, 2, 3, 4]));
        return;
      }
      if (req.method === 'POST' && req.url === '/v1/jobs/remote-1/cancel') {
        res.writeHead(200).end('cancelled');
        return;
      }
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200).end('ok');
        return;
      }
      res.writeHead(404).end();
    });

    const outputDir = tempDir();
    const provider = new HttpServiceProvider({
      id: 'http-service:h3-gpu',
      name: 'HTTP 服务（H3 算力服务器）',
      profile: profile(baseUrl),
      outputDir,
      taskId: 'task-1',
    });

    expect(await provider.checkHealth()).toEqual({ available: true });
    const submittedTask = await provider.submit(request());
    expect(submittedTask).toEqual({ taskId: 'remote-1' });
    expect(submitted).toMatchObject({ model: 'h3', prompt: '一只猫' });

    const first = await provider.queryStatus('remote-1');
    expect(first.status).toBe('running');
    expect(first.progressPercent).toBe(0);

    const second = await provider.queryStatus('remote-1');
    expect(second.status).toBe('succeeded');
    expect(second.outputVideoUrl).toBe('/media/remote-1.mp4');
    expect(readFileSync(path.join(outputDir, 'remote-1.mp4'))).toEqual(Buffer.from([1, 2, 3, 4]));

    expect(await provider.cancel('remote-1')).toBe(true);
  });

  it('同步服务：submit 直接返回产物，queryStatus 立即成功', async () => {
    process.env.HTTP_TEST_TOKEN = 'secret-token';
    const baseUrl = await listen(async (req, res) => {
      if (req.method === 'POST' && req.url === '/sync') {
        await readBody(req);
        res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({ video_url: '/media/sync.mp4' }),
        );
        return;
      }
      if (req.method === 'GET' && req.url === '/media/sync.mp4') {
        res.writeHead(200, { 'content-type': 'video/mp4' }).end(Buffer.from([9, 8, 7]));
        return;
      }
      res.writeHead(404).end();
    });

    const outputDir = tempDir();
    const provider = new HttpServiceProvider({
      id: 'http-service:h3-gpu',
      name: 'HTTP 服务（同步）',
      profile: profile(baseUrl, {
        submit: {
          path: '/sync',
          body: {},
          fields: { prompt: { from: 'prompt', format: 'text' } },
        },
        poll: undefined,
        cancel: undefined,
        health: undefined,
        outputs: { video: { path: 'video_url', kind: 'video' } },
      }),
      outputDir,
      taskId: 'task-sync',
    });

    expect(await provider.submit(request())).toEqual({ taskId: 'task-sync' });
    const status = await provider.queryStatus('task-sync');
    expect(status.status).toBe('succeeded');
    expect(status.outputVideoUrl).toBe('/media/task-sync.mp4');
  });

  it('401 → KEY_INVALID；失败状态 → terminal，不让调度器自动重投', async () => {
    process.env.HTTP_TEST_TOKEN = 'secret-token';
    const baseUrl = await listen(async (req, res) => {
      if (req.method === 'POST' && req.url === '/v1/jobs') {
        await readBody(req);
        res.writeHead(401).end('no');
        return;
      }
      if (req.method === 'GET' && req.url === '/v1/jobs/remote-1') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'failed' }));
        return;
      }
      res.writeHead(404).end();
    });

    const provider = new HttpServiceProvider({
      id: 'http-service:h3-gpu',
      name: 'HTTP 服务（失败）',
      profile: profile(baseUrl),
      outputDir: tempDir(),
      taskId: 'task-fail',
    });

    const error = (await provider.submit(request()).catch((caught: unknown) => caught)) as ProviderFailureError;
    expect(error).toBeInstanceOf(ProviderFailureError);
    expect(error.code).toBe('KEY_INVALID');

    // 直接构造一个已提交的 job 不方便，这里验证 failed 分支用独立 provider：先成功提交再查失败
    const pollingBase = await listen((req, res) => {
      if (req.method === 'POST' && req.url === '/v1/jobs') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'remote-1' }));
        return;
      }
      if (req.method === 'GET' && req.url === '/v1/jobs/remote-1') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'failed' }));
        return;
      }
      res.writeHead(404).end();
    });
    const polling = new HttpServiceProvider({
      id: 'http-service:h3-gpu',
      name: 'HTTP 服务（轮询失败）',
      profile: profile(pollingBase),
      outputDir: tempDir(),
      taskId: 'task-poll-fail',
    });
    await polling.submit(request());
    const status = await polling.queryStatus('remote-1');
    expect(status.status).toBe('failed');
    expect(status.error?.disposition).toBe('terminal');
  });
});
