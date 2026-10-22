import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import type { CanvasAgentContext } from '@astrmira/shared';
import { ProviderFailureError } from '../errors.js';
import { createAgentCanvasRoutes, type AgentCanvasRoutesDeps } from './agentCanvas.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

async function harness(deps: AgentCanvasRoutesDeps = {}): Promise<FastifyInstance> {
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
  await app.register(createAgentCanvasRoutes(deps));
  await app.ready();
  apps.push(app);
  return app;
}

const KEY_HEADER = 'x-llm-key';

function canvas(): CanvasAgentContext {
  return {
    projectId: 'p1',
    name: '测试画布',
    nodes: [
      {
        id: 'n1',
        type: 'image',
        title: '首帧',
        prompt: '雨夜霓虹',
        batchCount: 1,
        outputKinds: ['image'],
        referenceCount: 0,
      },
    ],
    edges: [],
    truncated: false,
  };
}

describe('POST /api/agent/canvas · 只读画布助手', () => {
  it('无 X-LLM-Key → 501，不调用执行者', async () => {
    let called = false;
    const app = await harness({
      ask: async () => {
        called = true;
        return { answer: 'x', model: 'fake' };
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/canvas',
      payload: { question: '总结', canvas: canvas() },
    });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toMatchObject({ code: 'LLM_NOT_CONFIGURED' });
    expect(called).toBe(false);
  });

  it('成功返回 answer/engine/model/usage，Key 与快照交给执行者', async () => {
    const seen: { apiKey: string; question: string; canvas: CanvasAgentContext | null } = {
      apiKey: '',
      question: '',
      canvas: null,
    };
    const app = await harness({
      ask: async (options) => {
        seen.apiKey = options.apiKey;
        seen.question = options.question;
        seen.canvas = options.canvas;
        return {
          answer: '当前画布有 1 个节点，已有图片产物。',
          model: 'deepseek-chat',
          usage: { promptTokens: 80, completionTokens: 24 },
        };
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/canvas',
      headers: { [KEY_HEADER]: '  sk-canvas-key  ' },
      payload: { question: ' 总结当前画布 ', canvas: canvas() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      engine: 'llm',
      model: 'deepseek-chat',
      usage: { promptTokens: 80, completionTokens: 24 },
      answer: expect.stringContaining('1 个节点'),
    });
    expect(seen.apiKey).toBe('sk-canvas-key');
    expect(seen.question).toBe('总结当前画布');
    expect(seen.canvas?.nodes).toHaveLength(1);
  });

  it('请求里的写操作字段被 strict schema 拒绝，不调用执行者', async () => {
    let called = false;
    const app = await harness({
      ask: async () => {
        called = true;
        return { answer: 'x', model: 'fake' };
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/canvas',
      headers: { [KEY_HEADER]: 'sk-x' },
      payload: { question: '删除节点', canvas: canvas(), operation: 'delete' },
    });
    expect(res.statusCode).toBe(400);
    expect(called).toBe(false);
  });

  it('上游凭据失败 → 401，不伪装成回答', async () => {
    const app = await harness({
      ask: async () => {
        throw new ProviderFailureError('KEY_INVALID', '画布助手凭据被上游拒绝');
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/canvas',
      headers: { [KEY_HEADER]: 'sk-x' },
      payload: { question: '总结', canvas: canvas() },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'KEY_INVALID' });
  });
});
