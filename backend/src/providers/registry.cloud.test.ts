import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { VideoGenerateRequest } from '@astrmira/shared';
import { ProviderFailureError } from '../errors.js';
import { getEnvModelWarning, getProvider, isFixtureProviderEnabled } from './registry.js';
import { SEEDANCE_DEFAULT_MODEL } from './seedanceProtocol.js';

/**
 * 云端轨的**零花费**回归（V2.1，P1''）。
 *
 * ## 为什么必须造假上游
 * 真实方舟的每一次提交都要钱，而这里要钉住的是"**我们发出去的模型到底是谁**"——
 * 2026-09-23 的线上故障正是它错了（请求里的 `doubao-seedance-2-0-mini-260615`
 * 被服务端 `VOLCANO_MODEL_NAME=doubao-seedance-video` 覆盖 → 上游 404）。
 * 这类不变量必须能在 CI 里反复跑、且不花一分钱，所以起一个本地 HTTP 假上游：
 * 它的响应形状**刻意按 `seedanceProtocol.ts` 的【待验证】字段写**（`id` / `content.video_url`），
 * 一旦协议层改了字段名，这里会先红，而不是等真金白银的冒烟才发现。
 */

interface FakeArkCall {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

let server: Server;
let baseUrl: string;
let calls: FakeArkCall[];

/** 假上游的行为开关（每个用例自己设） */
let submitResponse: { status: number; payload: unknown };
let taskResponse: { status: number; payload: unknown };

const VIDEO_BYTES = Buffer.from('fake-mp4-bytes-for-registry-test');

function collectBody(chunks: Buffer[]): Record<string, unknown> | undefined {
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = collectBody(chunks);
      const url = request.url ?? '';
      calls.push({
        method: request.method ?? 'GET',
        path: url,
        ...(body === undefined ? {} : { body }),
      });

      const json = (status: number, payload: unknown): void => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(payload));
      };

      if (request.method === 'POST' && url === '/api/v3/contents/generations/tasks') {
        return json(submitResponse.status, submitResponse.payload);
      }
      if (request.method === 'GET' && url.startsWith('/api/v3/contents/generations/tasks/')) {
        return json(taskResponse.status, taskResponse.payload);
      }
      if (request.method === 'GET' && url === '/video.mp4') {
        response.writeHead(200, { 'content-type': 'video/mp4' });
        return response.end(VIDEO_BYTES);
      }
      return json(404, { error: { code: 'NotFound', message: `unexpected ${request.method} ${url}` } });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api/v3`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const TMP_OUTPUTS = mkdtempSync(path.join(tmpdir(), 'astrmira-cloud-out-'));
const savedEnv = {
  baseUrl: process.env.VOLCANO_BASE_URL,
  model: process.env.VOLCANO_MODEL_NAME,
  outputs: process.env.OUTPUT_DIR,
};

beforeEach(() => {
  calls = [];
  submitResponse = { status: 200, payload: { id: 'up-1' } };
  taskResponse = {
    status: 200,
    payload: { id: 'up-1', status: 'succeeded', content: { video_url: `${baseUrl.replace('/api/v3', '')}/video.mp4` } },
  };
  process.env.VOLCANO_BASE_URL = baseUrl;
  process.env.OUTPUT_DIR = TMP_OUTPUTS;
  delete process.env.VOLCANO_MODEL_NAME;
});

afterEach(() => {
  for (const [key, value] of Object.entries({
    VOLCANO_BASE_URL: savedEnv.baseUrl,
    VOLCANO_MODEL_NAME: savedEnv.model,
    OUTPUT_DIR: savedEnv.outputs,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(path.join(TMP_OUTPUTS, 'up-1.mp4'), { force: true });
});

function baseRequest(overrides: Partial<VideoGenerateRequest> = {}): VideoGenerateRequest {
  return {
    prompt: '雨夜街头，女孩撑伞回头',
    mode: 't2v',
    aspectRatio: '16:9',
    params: { durationSec: 5 },
    provider: 'cloud-volcano-seedance',
    ...overrides,
  };
}

function submittedModel(): string {
  const submit = calls.find((call) => call.method === 'POST' && call.path.endsWith('/tasks'));
  return String(submit?.body?.['model'] ?? '');
}

describe('模型来源优先级：请求 > env > 内置默认（线上故障的根因）', () => {
  it('请求里带了模型 → **用它**，即便 env 配了另一个（这正是故障场景）', async () => {
    process.env.VOLCANO_MODEL_NAME = 'doubao-seedance-video';
    const provider = getProvider('cloud-volcano-seedance', {
      taskId: 't-priority',
      providerKey: 'sk-test',
      requestOptions: { model: 'doubao-seedance-2-0-mini-260615' },
    });

    await provider?.submit(baseRequest());

    expect(submittedModel()).toBe('doubao-seedance-2-0-mini-260615');
  });

  it('请求没带模型 → 用 env', async () => {
    process.env.VOLCANO_MODEL_NAME = 'env-model';
    const provider = getProvider('cloud-volcano-seedance', {
      taskId: 't-env',
      providerKey: 'sk-test',
    });

    await provider?.submit(baseRequest());

    expect(submittedModel()).toBe('env-model');
  });

  it('请求与 env 都没有 → 用协议层默认（且默认值是"已实测可用 + 最省钱"的那档）', async () => {
    const provider = getProvider('cloud-volcano-seedance', { taskId: 't-default', providerKey: 'sk-test' });

    await provider?.submit(baseRequest());

    expect(submittedModel()).toBe(SEEDANCE_DEFAULT_MODEL);
    expect(SEEDANCE_DEFAULT_MODEL).toBe('doubao-seedance-2-0-mini-260615');
  });

  it('请求里的 baseUrl 同样优先于 env（自建代理 / 兼容端点这条路必须真的通）', async () => {
    process.env.VOLCANO_BASE_URL = 'http://127.0.0.1:1/api/v3'; // 故意指向死端口
    const provider = getProvider('cloud-volcano-seedance', {
      taskId: 't-base',
      providerKey: 'sk-test',
      requestOptions: { baseUrl },
    });

    await provider?.submit(baseRequest());

    expect(submittedModel()).not.toBe('');
  });
});

describe('模型不存在时的诊断（原报文一个字都没说，现在必须说清）', () => {
  it('404 时消息里带上**实际模型 + 来源 + 被覆盖的那一个**，并给出下一步', async () => {
    process.env.VOLCANO_MODEL_NAME = 'doubao-seedance-video';
    submitResponse = {
      status: 404,
      payload: {
        error: {
          code: 'InvalidEndpointOrModel.NotFound',
          message: 'The model or endpoint doubao-seedance-video does not exist or you do not have access to it.',
        },
      },
    };

    // 该用例刻意**不带** requestOptions，复现"env 兜底值被上游拒绝"的情形
    const provider = getProvider('cloud-volcano-seedance', { taskId: 't-404', providerKey: 'sk-test' });
    const error = (await provider?.submit(baseRequest()).catch((err: unknown) => err)) as ProviderFailureError;

    expect(error).toBeInstanceOf(ProviderFailureError);
    expect(error.message).toContain('doubao-seedance-video');
    expect(error.message).toContain('VOLCANO_MODEL_NAME');
    expect(error.message).toContain('开通');
  });

  it('被覆盖时额外点明"你填的那个被谁覆盖了"（用户完全看不见的那一层）', async () => {
    process.env.VOLCANO_MODEL_NAME = 'env-model';
    submitResponse = {
      status: 404,
      payload: { error: { code: 'InvalidEndpointOrModel.NotFound', message: 'model does not exist' } },
    };

    const provider = getProvider('cloud-volcano-seedance', {
      taskId: 't-404b',
      providerKey: 'sk-test',
      requestOptions: { model: 'my-model' },
    });
    const error = (await provider?.submit(baseRequest()).catch((err: unknown) => err)) as ProviderFailureError;

    // 请求里的模型被真正使用了 → 这里应当**不**出现"被覆盖"，而是直接指向该模型
    expect(error.message).toContain('my-model');
    expect(error.message).not.toContain('要清掉该环境变量');
  });
});

describe('端到端（零花费）：提交 → 轮询 → 下载 → /media 直链', () => {
  it('全链路走通并落盘到 OUTPUT_DIR', async () => {
    const taskId = 't-e2e-cloud';
    const provider = getProvider('cloud-volcano-seedance', {
      taskId,
      providerKey: 'sk-test',
      requestOptions: { model: 'doubao-seedance-2-0-mini-260615' },
    });

    if (provider === null) throw new Error('云端 provider 未注册（registry 配置被改坏了）');
    const { taskId: upstreamId } = await provider.submit(baseRequest());
    expect(upstreamId).toBe('up-1');

    const progress = await provider?.queryStatus(upstreamId);
    expect(progress?.status).toBe('succeeded');
    expect(progress?.outputVideoUrl).toBe(`/media/${taskId}.mp4`);

    // 上游给的是**临时地址**，必须立刻下载成我们自己的文件（否则隔天画廊全是死链）
    const saved = readFileSync(path.join(TMP_OUTPUTS, `${taskId}.mp4`));
    expect(saved.equals(VIDEO_BYTES)).toBe(true);
  });
});

describe('OI 门控（与云端优先级无关，但同在一个注册点）', () => {
  it('开发环境默认开启夹具；显式 ENABLE_FIXTURE_PROVIDER=0 关闭；生产默认关闭', () => {
    const saved = {
      enable: process.env.ENABLE_FIXTURE_PROVIDER,
      nodeEnv: process.env.NODE_ENV,
    };

    delete process.env.ENABLE_FIXTURE_PROVIDER;
    process.env.NODE_ENV = 'development';
    expect(isFixtureProviderEnabled()).toBe(true);

    process.env.ENABLE_FIXTURE_PROVIDER = '0';
    expect(isFixtureProviderEnabled()).toBe(false);

    delete process.env.ENABLE_FIXTURE_PROVIDER;
    process.env.NODE_ENV = 'production';
    expect(isFixtureProviderEnabled()).toBe(false);

    process.env.ENABLE_FIXTURE_PROVIDER = '1';
    expect(isFixtureProviderEnabled()).toBe(true);

    for (const [key, value] of Object.entries({
      ENABLE_FIXTURE_PROVIDER: saved.enable,
      NODE_ENV: saved.nodeEnv,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
});

describe('env 占位符告警', () => {
  it('模板里的坑值（doubao-seedance-video）必须被明确点名', () => {
    process.env.VOLCANO_MODEL_NAME = 'doubao-seedance-video';

    const warning = getEnvModelWarning();
    expect(warning).toContain('占位符');
    expect(warning).toContain('404');
  });

  it('正常值只提示"这是兜底值"；未配置则不告警', () => {
    process.env.VOLCANO_MODEL_NAME = 'doubao-seedance-2-0-mini-260615';
    expect(getEnvModelWarning()).toContain('兜底');

    delete process.env.VOLCANO_MODEL_NAME;
    expect(getEnvModelWarning()).toBeNull();
  });
});
