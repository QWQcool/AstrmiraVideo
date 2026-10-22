import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import type { CanvasAgentContext } from '@astrmira/shared';
import { ProviderFailureError } from '../errors.js';
import {
  createCanvasNodeProposalRoutes,
  type CanvasNodeProposalRoutesDeps,
} from './canvasNodeProposal.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

async function harness(deps: CanvasNodeProposalRoutesDeps = {}): Promise<FastifyInstance> {
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
  await app.register(createCanvasNodeProposalRoutes(deps));
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

describe('POST /api/agent/canvas/node-plan · 待确认文本节点方案', () => {
  it('无 Key → 501，不调用执行者', async () => {
    let called = false;
    const app = await harness({
      propose: async () => {
        called = true;
        return {
          proposal: {
            version: 1,
            action: 'create-text-node',
            title: 'x',
            content: 'y',
            warnings: [],
          },
          model: 'fake',
        };
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/canvas/node-plan',
      payload: { instruction: '写一条说明', canvas: canvas() },
    });
    expect(res.statusCode).toBe(501);
    expect(called).toBe(false);
  });

  it('成功只返回方案，不返回画布/工具/写操作；Key 与快照交给执行者', async () => {
    const seen: { apiKey: string; instruction: string; canvas: CanvasAgentContext | null } = {
      apiKey: '',
      instruction: '',
      canvas: null,
    };
    const app = await harness({
      propose: async (options) => {
        seen.apiKey = options.apiKey;
        seen.instruction = options.instruction;
        seen.canvas = options.canvas;
        return {
          proposal: {
            version: 1,
            action: 'create-text-node',
            title: '雨夜转场说明',
            content: '从雨幕切到霓虹倒影。',
            warnings: [],
          },
          model: 'deepseek-chat',
          usage: { promptTokens: 50, completionTokens: 20 },
        };
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/canvas/node-plan',
      headers: { [KEY_HEADER]: '  sk-canvas-key  ' },
      payload: { instruction: ' 写一条转场说明 ', canvas: canvas() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      engine: 'llm',
      model: 'deepseek-chat',
      proposal: { action: 'create-text-node', title: '雨夜转场说明' },
    });
    expect(res.json()).not.toHaveProperty('nodes');
    expect(res.json()).not.toHaveProperty('toolCalls');
    expect(seen.apiKey).toBe('sk-canvas-key');
    expect(seen.instruction).toBe('写一条转场说明');
    expect(seen.canvas?.nodes).toHaveLength(1);
  });

  it('请求里的写操作字段被 strict schema 拒绝，不调用执行者', async () => {
    let called = false;
    const app = await harness({
      propose: async () => {
        called = true;
        return {
          proposal: {
            version: 1,
            action: 'create-text-node',
            title: 'x',
            content: 'y',
            warnings: [],
          },
          model: 'fake',
        };
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/canvas/node-plan',
      headers: { [KEY_HEADER]: 'sk-x' },
      payload: { instruction: '创建', canvas: canvas(), delete: true },
    });
    expect(res.statusCode).toBe(400);
    expect(called).toBe(false);
  });

  it('上游 401 → KEY_INVALID', async () => {
    const app = await harness({
      propose: async () => {
        throw new ProviderFailureError('KEY_INVALID', '凭据被拒绝');
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/canvas/node-plan',
      headers: { [KEY_HEADER]: 'sk-x' },
      payload: { instruction: '创建', canvas: canvas() },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'KEY_INVALID' });
  });
});
