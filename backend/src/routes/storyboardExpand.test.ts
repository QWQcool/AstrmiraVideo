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
  await app.register(createStoryboardRoutes(deps));
  await app.ready();
  apps.push(app);
  return app;
}

function plan(shotCount = 2) {
  return {
    version: 1 as const,
    title: '雨夜霓虹',
    aspectRatio: '16:9' as const,
    durationSec: shotCount * 3,
    shots: Array.from({ length: shotCount }, (_unused, i) => ({
      index: i + 1,
      time: `${i * 3}-${i * 3 + 3}s`,
      shotSize: '中景',
      camera: '缓慢推近',
      visual: '橘猫蹲在霓虹灯下',
    })),
    openQuestions: [],
    warnings: [],
  };
}

function expansion() {
  return {
    version: 1 as const,
    shots: [
      {
        index: 1,
        title: '镜头 1 · 雨夜街头',
        imagePrompt: '雨夜街头霓虹灯，橘猫蹲坐，电影感',
        videoPrompt: '雨夜街头，霓虹灯下橘猫缓慢转头，镜头缓慢推近',
        aspectRatio: '16:9' as const,
        resolutionTier: '720p' as const,
        durationSec: 3,
        referenceAssetIds: ['asset-cat-1'],
        warnings: [],
      },
      {
        index: 2,
        title: '镜头 2 · 猫抬头',
        videoPrompt: '橘猫抬头看雨，雨滴落下，固定机位',
        aspectRatio: '16:9' as const,
        resolutionTier: '720p' as const,
        durationSec: 3,
        referenceAssetIds: [],
        warnings: [],
      },
    ],
  };
}

describe('POST /api/agent/storyboard/expand · 分镜展开（S8-A2）', () => {
  it('无 Key → 501', async () => {
    const app = await harness();
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/storyboard/expand',
      payload: { plan: plan(), references: [] },
    });
    expect(res.statusCode).toBe(501);
    expect(res.json().code).toBe('LLM_NOT_CONFIGURED');
  });

  it('分镜超过 16 镜 → 400（D75 上限，花第二次规划的钱之前拒绝）', async () => {
    let called = false;
    const app = await harness({
      expand: async () => {
        called = true;
        throw new Error('不应被调用');
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/storyboard/expand',
      headers: { 'x-llm-key': 'sk-test' },
      payload: { plan: plan(17), references: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_REQUEST');
    expect(res.json().message).toContain('16');
    expect(called).toBe(false);
  });

  it('成功：逐镜生成参数 + usage，不包含任何写画布字段', async () => {
    const app = await harness({
      expand: async () => ({
        plan: expansion(),
        model: 'deepseek-chat',
        usage: { promptTokens: 900, completionTokens: 300 },
      }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/storyboard/expand',
      headers: { 'x-llm-key': 'sk-test' },
      payload: {
        plan: plan(),
        references: [{ assetId: 'asset-cat-1', kind: 'image', label: '橘猫定妆照' }],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      engine: 'llm',
      model: 'deepseek-chat',
      usage: { promptTokens: 900, completionTokens: 300 },
    });
    expect(body.plan.shots).toHaveLength(2);
    expect(body.plan.shots[0]).toMatchObject({ index: 1, resolutionTier: '720p' });
    expect(body).not.toHaveProperty('nodes');
    expect(body).not.toHaveProperty('edges');
  });

  it('上游结构不合法 → 502', async () => {
    const app = await harness({
      expand: async () => {
        throw Object.assign(new Error('bad'), { code: 'UPSTREAM_ERROR' });
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/storyboard/expand',
      headers: { 'x-llm-key': 'sk-test' },
      payload: { plan: plan(), references: [] },
    });
    expect(res.statusCode).toBe(502);
  });
});
