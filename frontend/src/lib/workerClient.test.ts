import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { WORKER_PROTOCOL_VERSION, checkWorkerLink } from '@astrmira/shared';
import {
  WorkerError,
  createWorkerClient,
  describeWorkerFailure,
  resolveWorkerResultUrl,
  workerLinkCheck,
} from './workerClient';

/**
 * 本地 worker 协议 `astrmira-worker/v1`（V2.27 / 台账 A1 片 A）。
 *
 * ## 为什么这里有一个"假 worker"
 * 协议的价值在**两端的约定**上：真机 worker 要到片 B 才有，但适配器（浏览器这一端）的
 * 行为现在就能被完整验证 —— 起一个**实现协议的本地 HTTP 服务**当对端即可。
 * 它同时是协议的一份**可执行说明**：worker 作者照抄这几个端点就能对上。
 *
 * 盯五件事：正常链路 / 协议不匹配 / 不可达 / 错误映射（409→GPU_BUSY、404→TASK_NOT_FOUND）/
 * 产物直链只接受 worker 自己的相对路径（防"被诱导去别的地址"）。
 */

interface FakeWorker {
  baseUrl: string;
  close(): Promise<void>;
  requests: string[];
}

async function startFakeWorker(options: {
  protocol?: string;
  /** 让 /v1/health 直接 500（模拟"跑着但坏了"） */
  brokenHealth?: boolean;
} = {}): Promise<FakeWorker> {
  const requests: string[] = [];
  const protocol = options.protocol ?? WORKER_PROTOCOL_VERSION;

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    requests.push(`${req.method ?? 'GET'} ${url.pathname}`);

    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === '/v1/health') {
      if (options.brokenHealth === true) {
        json(500, { error: 'boom' });
        return;
      }
      json(200, { protocol, engine: '假 worker（协议测试用）', available: true, busy: false });
      return;
    }

    if (url.pathname === '/v1/jobs' && req.method === 'POST') {
      json(200, { jobId: 'job-1' });
      return;
    }

    if (url.pathname === '/v1/jobs/busy') {
      json(409, { code: 'GPU_BUSY', message: '正在跑另一条' });
      return;
    }

    if (url.pathname === '/v1/jobs/job-1' && req.method === 'GET') {
      json(200, {
        jobId: 'job-1',
        status: 'succeeded',
        progressPercent: 100,
        resultPath: '/v1/jobs/job-1/result',
      });
      return;
    }

    if (url.pathname === '/v1/jobs/job-1' && req.method === 'DELETE') {
      json(200, { cancelled: true });
      return;
    }

    json(404, { code: 'TASK_NOT_FOUND', message: '没有这个任务' });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error))),
      ),
  };
}

const workers: FakeWorker[] = [];
afterEach(async () => {
  while (workers.length > 0) {
    await workers.pop()?.close();
  }
});

async function worker(options?: Parameters<typeof startFakeWorker>[0]): Promise<FakeWorker> {
  const fake = await startFakeWorker(options);
  workers.push(fake);
  return fake;
}

describe('本地 worker 客户端（A1 片 A：协议 + 假 worker）', () => {
  it('正常链路：探测 → 提交 → 查询（轮询到有产物）→ 取消', async () => {
    const fake = await worker();
    const client = createWorkerClient({ baseUrl: fake.baseUrl });

    const health = await client.health();
    expect(health.protocol).toBe(WORKER_PROTOCOL_VERSION);
    expect(health.available).toBe(true);

    const created = await client.submit({
      prompt: '雨夜街头',
      mode: 't2v',
      aspectRatio: '16:9',
      durationSec: 5,
    });
    expect(created.jobId).toBe('job-1');

    const status = await client.status('job-1');
    expect(status.status).toBe('succeeded');
    expect(resolveWorkerResultUrl(client, status)).toBe(`${fake.baseUrl}/v1/jobs/job-1/result`);

    expect(await client.cancel('job-1')).toBe(true);
    expect(fake.requests).toEqual([
      'GET /v1/health',
      'POST /v1/jobs',
      'GET /v1/jobs/job-1',
      'DELETE /v1/jobs/job-1',
    ]);
  });

  it('协议版本不匹配 → PROVIDER_UNAVAILABLE（明确拒绝，不尝试兼容）', async () => {
    const fake = await worker({ protocol: 'astrmira-worker/v2' });
    const client = createWorkerClient({ baseUrl: fake.baseUrl });

    await expect(client.health()).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      name: 'WorkerError',
    });
    await expect(client.health()).rejects.toThrow(/astrmira-worker\/v1/);
  });

  it('worker 没启动（端口无人）→ PROVIDER_UNAVAILABLE + 可执行提示', async () => {
    // 先起再关，确保这个端口确实空着
    const fake = await worker();
    const baseUrl = fake.baseUrl;
    await fake.close();
    workers.pop();

    const client = createWorkerClient({ baseUrl, timeoutMs: 2_000 });
    const caught = await client.health().catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(WorkerError);
    expect((caught as WorkerError).code).toBe('PROVIDER_UNAVAILABLE');
    expect((caught as WorkerError).toText()).toContain('启动');
  });

  it('错误映射：409 → GPU_BUSY，404 → TASK_NOT_FOUND（上层只认契约码）', async () => {
    const fake = await worker();
    const client = createWorkerClient({ baseUrl: fake.baseUrl });

    await expect(client.status('busy')).rejects.toMatchObject({ code: 'GPU_BUSY' });
    await expect(client.status('nope')).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' });
  });

  it('产物直链只接受 worker 自己的相对路径（防被诱导去别的地址取值）', async () => {
    const fake = await worker();
    const client = createWorkerClient({ baseUrl: fake.baseUrl });

    expect(
      resolveWorkerResultUrl(client, {
        jobId: 'j',
        status: 'succeeded',
        progressPercent: 100,
        resultPath: 'https://evil.example/x.mp4',
      }),
    ).toBeNull();
    expect(
      resolveWorkerResultUrl(client, { jobId: 'j', status: 'running', progressPercent: 10 }),
    ).toBeNull();
  });

  it('连接前静态检查：HTTPS 页面 + 非回环地址 → 拦住并给可执行指引；回环 → 只提醒 PNA', () => {
    /**
     * 语言迁移第十八批：判据在共享包（**只回 code**），句子在前端。
     * 所以这一例分两段断言 —— 这正是那条分工在测试里的样子。
     */
    const lan = workerLinkCheck('https:', 'http://192.168.1.20:8765');
    expect(lan.blocked).toContain('127.0.0.1:8765');
    expect(lan.notice).toBeNull();

    expect(
      checkWorkerLink({ pageProtocol: 'https:', workerUrl: 'http://192.168.1.20:8765' }),
    ).toEqual({ kind: 'mixedContent', origin: 'http://192.168.1.20:8765' });

    const loopback = checkWorkerLink({
      pageProtocol: 'https:',
      workerUrl: 'http://127.0.0.1:8765',
    });
    expect(loopback).toEqual({ kind: 'pnaHint' });
    // 回环那种**只提醒、不拦**（拦下来会让"本来能用"的部署用不了）
    const loopbackText = workerLinkCheck('https:', 'http://127.0.0.1:8765');
    expect(loopbackText.blocked).toBeNull();
    expect(loopbackText.notice).toContain('Access-Control-Allow-Private-Network');

    expect(
      checkWorkerLink({ pageProtocol: 'http:', workerUrl: 'http://127.0.0.1:8765' }),
    ).toEqual({ kind: 'ok' });

    expect(checkWorkerLink({ pageProtocol: 'https:', workerUrl: '不是 URL' })).toEqual({
      kind: 'badUrl',
      url: '不是 URL',
    });
    expect(workerLinkCheck('https:', '不是 URL').blocked).toContain('不是合法 URL');
  });

  it('失败文案统一出口：WorkerError 带码与提示，其它错误不吞', () => {
    const workerError = new WorkerError('GPU_BUSY', '忙', '等它跑完');
    expect(describeWorkerFailure(workerError)).toBe('【GPU_BUSY】忙（等它跑完）');
    expect(describeWorkerFailure(new Error('普通错误'))).toBe('普通错误');
  });
});
