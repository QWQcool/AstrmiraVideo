import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import type { ErrorResponse, KeyVerifyResponse } from '@astrmira/shared';
import { createKeyVerifyRoutes } from './keysVerify.js';

/**
 * 「测试连接」（CONTRACT §9，V2.1）。
 *
 * 它存在的唯一理由是**省钱**：2026-09-23 的线上故障里，用户是花了一次真实提交
 * 才拿到"模型不存在"的结论。因此本文件重点钉两件事：
 * 1. 探测路径**不会创建任务**（视频轨用空 content，上游在参数校验处就失败）；
 * 2. 万一上游将来把空 content 当成合法请求 → 必须**立刻取消**并如实告知（安全网）。
 */

interface Call {
  url: string;
  method: string;
  body?: unknown;
}

function stubFetch(
  handler: (call: Call) => { status: number; payload?: unknown } | undefined,
): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(url),
      method: init?.method ?? 'GET',
      ...(init?.body === undefined ? {} : { body: JSON.parse(String(init.body)) as unknown }),
    };
    calls.push(call);
    const result = handler(call) ?? { status: 500, payload: { error: { code: 'Unknown' } } };
    return new Response(result.payload === undefined ? '' : JSON.stringify(result.payload), {
      status: result.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

const apps: FastifyInstance[] = [];

async function buildHarness(fetchImpl: typeof fetch): Promise<FastifyInstance> {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(createKeyVerifyRoutes({ fetchImpl, timeoutMs: 1_000 }));
  await app.ready();
  apps.push(app);
  return app;
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

const VIDEO_KEY = { 'x-provider-key': 'sk-video-1234567890' };

describe('视频轨', () => {
  it('模型已开通（探针得到 400 参数错）→ keyValid + modelListed + modelAvailable 全真', async () => {
    const { fetchImpl, calls } = stubFetch((call) => {
      if (call.url.endsWith('/models')) {
        return { status: 200, payload: { data: [{ id: 'm-1' }, { id: 'doubao-seedance-2-0-mini-260615' }] } };
      }
      if (call.url.endsWith('/contents/generations/tasks')) {
        return { status: 400, payload: { error: { code: 'InvalidParameter', message: 'content field cannot be empty' } } };
      }
      return undefined;
    });
    const app = await buildHarness(fetchImpl);

    const response = await app.inject({
      method: 'POST',
      url: '/api/providers/keys/verify',
      headers: VIDEO_KEY,
      payload: { track: 'video', model: 'doubao-seedance-2-0-mini-260615' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as KeyVerifyResponse;
    expect(body).toMatchObject({ keyValid: true, totalModels: 2, modelListed: true, modelAvailable: true });
    expect(body.message).toContain('可用');

    // 关键：探针确实是"空 content"，而且**没有**发生任何 DELETE（因为没建任务）
    const probe = calls.find((call) => call.url.endsWith('/contents/generations/tasks'));
    expect(probe?.body).toEqual({ model: 'doubao-seedance-2-0-mini-260615', content: [] });
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
  });

  it('模型不存在/未开通（404）→ modelAvailable 为假，但仍说明凭据有效', async () => {
    const { fetchImpl } = stubFetch((call) => {
      if (call.url.endsWith('/models')) return { status: 200, payload: { data: [{ id: 'm-1' }] } };
      return { status: 404, payload: { error: { code: 'InvalidEndpointOrModel.NotFound' } } };
    });
    const app = await buildHarness(fetchImpl);

    const body = (
      await app.inject({
        method: 'POST',
        url: '/api/providers/keys/verify',
        headers: VIDEO_KEY,
        payload: { track: 'video', model: 'doubao-seedance-video' },
      })
    ).json() as KeyVerifyResponse;

    expect(body.keyValid).toBe(true);
    expect(body.modelListed).toBe(false);
    expect(body.modelAvailable).toBe(false);
    expect(body.message).toContain('不可用');
  });

  it('凭据被拒（/models 401）→ 401 KEY_INVALID（前端据此把"Key 错"与"模型没开通"分开讲）', async () => {
    const { fetchImpl } = stubFetch(() => ({ status: 401, payload: { error: { code: 'AuthenticationError' } } }));
    const app = await buildHarness(fetchImpl);

    const response = await app.inject({
      method: 'POST',
      url: '/api/providers/keys/verify',
      headers: VIDEO_KEY,
      payload: { track: 'video', model: 'm' },
    });

    expect(response.statusCode).toBe(401);
    expect((response.json() as ErrorResponse).code).toBe('KEY_INVALID');
  });

  it('没带 Key → 501 KEY_MISSING（且不发起任何上游请求）', async () => {
    const { fetchImpl, calls } = stubFetch(() => ({ status: 200, payload: {} }));
    const app = await buildHarness(fetchImpl);

    const response = await app.inject({
      method: 'POST',
      url: '/api/providers/keys/verify',
      payload: { track: 'video', model: 'm' },
    });

    expect(response.statusCode).toBe(501);
    expect((response.json() as ErrorResponse).code).toBe('KEY_MISSING');
    expect(calls).toHaveLength(0);
  });

  it('安全网：万一空 content 也建了任务 → 立刻 DELETE 取消，并在 message 里说明', async () => {
    const { fetchImpl, calls } = stubFetch((call) => {
      if (call.url.endsWith('/models')) return { status: 200, payload: { data: [{ id: 'm-1' }] } };
      if (call.method === 'DELETE') return { status: 200, payload: {} };
      return { status: 200, payload: { id: 'upstream-task-1' } };
    });
    const app = await buildHarness(fetchImpl);

    const body = (
      await app.inject({
        method: 'POST',
        url: '/api/providers/keys/verify',
        headers: VIDEO_KEY,
        payload: { track: 'video', model: 'm-1' },
      })
    ).json() as KeyVerifyResponse;

    expect(calls.some((call) => call.method === 'DELETE')).toBe(true);
    expect(body.message).toContain('已立刻取消');
  });

  it('未提供模型 → 只校验凭据（modelAvailable 为 null，不猜）', async () => {
    const { fetchImpl, calls } = stubFetch(() => ({ status: 200, payload: { data: [{ id: 'm-1' }] } }));
    const app = await buildHarness(fetchImpl);

    const body = (
      await app.inject({
        method: 'POST',
        url: '/api/providers/keys/verify',
        headers: VIDEO_KEY,
        payload: { track: 'video' },
      })
    ).json() as KeyVerifyResponse;

    expect(body).toMatchObject({ keyValid: true, modelAvailable: null, modelListed: null });
    expect(calls).toHaveLength(1);
  });
});

describe('文本轨', () => {
  it('用 max_tokens=1 的最小请求验证（200 = 可用）', async () => {
    const { fetchImpl, calls } = stubFetch(() => ({ status: 200, payload: { choices: [] } }));
    const app = await buildHarness(fetchImpl);

    const body = (
      await app.inject({
        method: 'POST',
        url: '/api/providers/keys/verify',
        headers: { 'x-llm-key': 'sk-llm-1234567890' },
        payload: { track: 'text', model: 'doubao-seed-2-1-lite-260915', baseUrl: 'https://ark.example/api/v3' },
      })
    ).json() as KeyVerifyResponse;

    expect(body).toMatchObject({ keyValid: true, modelAvailable: true });
    expect(calls[0]?.url).toBe('https://ark.example/api/v3/chat/completions');
    const chatBody = calls[0]?.body as { max_tokens: number } | undefined;
    expect(chatBody?.max_tokens).toBe(1);
  });

  it('模型未开通（404）→ modelAvailable 为假', async () => {
    const { fetchImpl } = stubFetch(() => ({ status: 404, payload: { error: { code: 'InvalidEndpointOrModel.NotFound' } } }));
    const app = await buildHarness(fetchImpl);

    const body = (
      await app.inject({
        method: 'POST',
        url: '/api/providers/keys/verify',
        headers: { 'x-llm-key': 'sk-llm-1234567890' },
        payload: { track: 'text', model: 'doubao-seed-1-6-250615' },
      })
    ).json() as KeyVerifyResponse;

    expect(body.keyValid).toBe(true);
    expect(body.modelAvailable).toBe(false);
    expect(body.message).toContain('开通');
  });
});
