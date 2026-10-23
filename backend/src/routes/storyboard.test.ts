import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import { createStoryboardRoutes, type StoryboardRoutesDeps } from './storyboard.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

async function harness(deps: StoryboardRoutesDeps = {}): Promise<FastifyInstance> {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler((error: Error & { validation?: unknown }, _request, reply) => {
    const status = error.validation === undefined ? 500 : 400;
    return reply.code(status).send({
      code: status === 400 ? 'INVALID_REQUEST' : 'UPSTREAM_ERROR',
      message: error.message,
      disposition: 'terminal',
    });
  });
  await app.register(createStoryboardRoutes(deps));
  await app.ready();
  apps.push(app);
  return app;
}

function plan() {
  return {
    version: 1 as const,
    title: '雨夜霓虹',
    aspectRatio: '16:9' as const,
    durationSec: 6,
    shots: [
      {
        index: 1,
        time: '0-3s',
        shotSize: '中景',
        camera: '缓慢推近',
        visual: '橘猫蹲在霓虹灯下',
      },
      {
        index: 2,
        time: '3-6s',
        shotSize: '近景',
        camera: '固定',
        visual: '猫抬头看雨',
        transition: '切',
      },
    ],
    openQuestions: [],
    warnings: [],
  };
}

describe('POST /api/agent/storyboard · 分镜计划', () => {
  it('无 Key → 501', async () => {
    const app = await harness();
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/storyboard',
      payload: { instruction: '雨夜短片' },
    });
    expect(res.statusCode).toBe(501);
  });

  it('成功返回独立分镜表，不包含 nodes/写操作', async () => {
    const app = await harness({
      generate: async () => ({ plan: plan(), model: 'deepseek-chat' }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/storyboard',
      headers: { 'x-llm-key': 'sk-test' },
      payload: { instruction: '雨夜短片' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      engine: 'llm',
      plan: { title: '雨夜霓虹', shots: [{ index: 1 }, { index: 2 }] },
    });
    expect(res.json()).not.toHaveProperty('nodes');
    expect(res.json()).not.toHaveProperty('toolCalls');
  });

  it('上游结构失败 → 502', async () => {
    const app = await harness({
      generate: async () => {
        throw new Error('bad json');
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/storyboard',
      headers: { 'x-llm-key': 'sk-test' },
      payload: { instruction: '雨夜短片' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ code: 'UPSTREAM_ERROR' });
  });
});
