import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import type { ErrorResponse } from '@astrmira/shared';
import { ProviderFailureError } from '../errors.js';
import { createEnhanceRoutes, type EnhanceRoutesDeps } from './enhance.js';
import { MAX_PROMPT_CHARS } from './generate.js';

/**
 * `POST /api/prompt/enhance`（CONTRACT §3 V2.0）。
 *
 * 用**注入桩**而不是真上游：本文件要钉的是**本服务的口径**，不是某家模型的质量。
 * 桩的好处是可以精确制造每一种失败（401 / 5xx），而真实端点做不到这一点。
 */

async function buildHarness(deps: EnhanceRoutesDeps = {}) {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(createEnhanceRoutes(deps));
  await app.ready();
  return app;
}

const apps: Array<Awaited<ReturnType<typeof buildHarness>>> = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

async function harness(deps: EnhanceRoutesDeps = {}) {
  const app = await buildHarness(deps);
  apps.push(app);
  return app;
}

const KEY_HEADER = 'x-llm-key';

describe('POST /api/prompt/enhance · 纯 BYOK 的两条分支', () => {
  it('带 X-LLM-Key → 200 且 engine 必为 "llm"（可证伪的"确实调了模型"标记）', async () => {
    let seen: { apiKey: string; originalPrompt: string } | null = null;
    const app = await harness({
      enhance: async (options) => {
        seen = { apiKey: options.apiKey, originalPrompt: options.originalPrompt };
        return { enhancedPrompt: '扩写后的提示词', cameraMovementSuggested: '推近' };
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/prompt/enhance',
      headers: { [KEY_HEADER]: '  sk-user-key-123456  ' },
      payload: { originalPrompt: '雨夜街头', style: 'cinematic', mode: 'i2v' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { engine: string; enhancedPrompt: string };
    expect(body.engine).toBe('llm');
    expect(body.enhancedPrompt).toBe('扩写后的提示词');
    expect(body).toMatchObject({ cameraMovementSuggested: '推近' });
    // 请求头里的 Key 去空白后**原样**交给执行者（不回落、不改写）
    expect(seen).toEqual({ apiKey: 'sk-user-key-123456', originalPrompt: '雨夜街头' });
  });

  it('执行者没给 engine 也照样是 "llm"（路由硬编码，不由上游决定）', async () => {
    const app = await harness({ enhance: async () => ({ enhancedPrompt: 'x' }) });

    const res = await app.inject({
      method: 'POST',
      url: '/api/prompt/enhance',
      headers: { [KEY_HEADER]: 'sk-user-key-123456' },
      payload: { originalPrompt: '雨夜街头' },
    });

    expect((res.json() as { engine: string }).engine).toBe('llm');
  });

  it('没有 X-LLM-Key → 501 LLM_NOT_CONFIGURED，且**不调用执行者**（服务端不设兜底 Key）', async () => {
    let called = false;
    const app = await harness({
      enhance: async () => {
        called = true;
        return { enhancedPrompt: 'x' };
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/prompt/enhance',
      payload: { originalPrompt: '雨夜街头' },
    });

    expect(res.statusCode).toBe(501);
    const body = res.json() as ErrorResponse;
    expect(body.code).toBe('LLM_NOT_CONFIGURED');
    expect(body.disposition).toBe('terminal');
    expect(body.message).toContain('BYOK');
    expect(called).toBe(false);
  });

  it('空白 Key（只有空格）不算"配了"', async () => {
    const app = await harness({ enhance: async () => ({ enhancedPrompt: 'x' }) });

    const res = await app.inject({
      method: 'POST',
      url: '/api/prompt/enhance',
      headers: { [KEY_HEADER]: '   ' },
      payload: { originalPrompt: '雨夜街头' },
    });

    expect(res.statusCode).toBe(501);
  });
});

describe('POST /api/prompt/enhance · 提示词纪律（与 /api/generate 同一套）', () => {
  it('空提示词 → 400 PROMPT_REJECTED', async () => {
    const app = await harness({ enhance: async () => ({ enhancedPrompt: 'x' }) });

    const res = await app.inject({
      method: 'POST',
      url: '/api/prompt/enhance',
      headers: { [KEY_HEADER]: 'sk-user-key-123456' },
      payload: { originalPrompt: '   ' },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as ErrorResponse).code).toBe('PROMPT_REJECTED');
  });

  it(`超过 ${MAX_PROMPT_CHARS} 字符 → 400（上限与 generate 共用同一常量，不各写一个数字）`, async () => {
    const app = await harness({ enhance: async () => ({ enhancedPrompt: 'x' }) });

    const res = await app.inject({
      method: 'POST',
      url: '/api/prompt/enhance',
      headers: { [KEY_HEADER]: 'sk-user-key-123456' },
      payload: { originalPrompt: '字'.repeat(MAX_PROMPT_CHARS + 1) },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as ErrorResponse).message).toContain(String(MAX_PROMPT_CHARS));
  });
});

describe('POST /api/prompt/enhance · 上游失败的状态码与处置', () => {
  it('KEY_INVALID → 401 terminal', async () => {
    const app = await harness({
      enhance: async () => {
        throw new ProviderFailureError('KEY_INVALID', '凭据被上游拒绝');
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/prompt/enhance',
      headers: { [KEY_HEADER]: 'sk-user-key-123456' },
      payload: { originalPrompt: '雨夜街头' },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json() as ErrorResponse;
    expect(body.code).toBe('KEY_INVALID');
    expect(body.disposition).toBe('terminal');
  });

  it('UPSTREAM_ERROR → 502 且 disposition 为 retryable（D28：不适用"结果不明"）', async () => {
    const app = await harness({
      enhance: async () => {
        throw new ProviderFailureError('UPSTREAM_ERROR', '上游 500');
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/prompt/enhance',
      headers: { [KEY_HEADER]: 'sk-user-key-123456' },
      payload: { originalPrompt: '雨夜街头' },
    });

    expect(res.statusCode).toBe(502);
    const body = res.json() as ErrorResponse;
    expect(body.code).toBe('UPSTREAM_ERROR');
    expect(body.disposition).toBe('retryable');
  });

  it('未归类的异常 → 502 UPSTREAM_ERROR（不把内部异常直接抛成 500 空响应）', async () => {
    const app = await harness({
      enhance: async () => {
        throw new TypeError('fetch failed');
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/prompt/enhance',
      headers: { [KEY_HEADER]: 'sk-user-key-123456' },
      payload: { originalPrompt: '雨夜街头' },
    });

    expect(res.statusCode).toBe(502);
    expect((res.json() as ErrorResponse).code).toBe('UPSTREAM_ERROR');
  });

  it('端点没配全（自定义预设留空）→ 501 LLM_NOT_CONFIGURED', async () => {
    const app = await harness({
      enhance: async () => {
        throw new ProviderFailureError('LLM_NOT_CONFIGURED', '扩写端点未配置完整');
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/prompt/enhance',
      headers: { [KEY_HEADER]: 'sk-user-key-123456' },
      payload: { originalPrompt: '雨夜街头', llm: { preset: 'custom' } },
    });

    expect(res.statusCode).toBe(501);
    expect((res.json() as ErrorResponse).code).toBe('LLM_NOT_CONFIGURED');
  });
});
