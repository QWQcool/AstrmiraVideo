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
  createCanvasNodeUpdateProposalRoutes,
  type CanvasNodeUpdateProposalRoutesDeps,
} from './canvasNodeUpdateProposal.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

async function harness(deps: CanvasNodeUpdateProposalRoutesDeps = {}): Promise<FastifyInstance> {
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
  await app.register(createCanvasNodeUpdateProposalRoutes(deps));
  await app.ready();
  apps.push(app);
  return app;
}

const KEY_HEADER = 'x-llm-key';

function canvas(): CanvasAgentContext {
  return {
    projectId: 'p1',
    name: '画布',
    nodes: [
      {
        id: 'text-1',
        type: 'text',
        title: '旧说明',
        prompt: '旧正文',
        batchCount: 0,
        outputKinds: [],
        referenceCount: 0,
      },
    ],
    edges: [],
    truncated: false,
  };
}

describe('POST /api/agent/canvas/node-update-plan · 待确认更新方案', () => {
  it('无 Key → 501，不调用执行者', async () => {
    let called = false;
    const app = await harness({
      propose: async () => {
        called = true;
        return {
          proposal: {
            version: 1,
            action: 'update-text-node',
            targetNodeId: 'text-1',
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
      url: '/api/agent/canvas/node-update-plan',
      payload: { instruction: '改', canvas: canvas(), targetNodeId: 'text-1' },
    });
    expect(res.statusCode).toBe(501);
    expect(called).toBe(false);
  });

  it('目标不存在/不是文本 → 400，不调用执行者', async () => {
    let called = false;
    const app = await harness({
      propose: async () => {
        called = true;
        return {
          proposal: {
            version: 1,
            action: 'update-text-node',
            targetNodeId: 'text-1',
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
      url: '/api/agent/canvas/node-update-plan',
      headers: { [KEY_HEADER]: 'sk-x' },
      payload: { instruction: '改', canvas: canvas(), targetNodeId: 'missing' },
    });
    expect(res.statusCode).toBe(400);
    expect(called).toBe(false);
  });

  it('成功只返回更新方案，不返回 nodes/工具/写操作', async () => {
    const seen: { apiKey: string; instruction: string; targetNodeId: string } = {
      apiKey: '',
      instruction: '',
      targetNodeId: '',
    };
    const app = await harness({
      propose: async (options) => {
        seen.apiKey = options.apiKey;
        seen.instruction = options.instruction;
        seen.targetNodeId = options.targetNodeId;
        return {
          proposal: {
            version: 1,
            action: 'update-text-node',
            targetNodeId: 'text-1',
            title: '新说明',
            content: '新正文',
            warnings: [],
          },
          model: 'deepseek-chat',
          usage: { promptTokens: 60, completionTokens: 18 },
        };
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/canvas/node-update-plan',
      headers: { [KEY_HEADER]: '  sk-update-key  ' },
      payload: { instruction: ' 改简洁 ', canvas: canvas(), targetNodeId: 'text-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      engine: 'llm',
      model: 'deepseek-chat',
      proposal: { action: 'update-text-node', targetNodeId: 'text-1' },
    });
    expect(res.json()).not.toHaveProperty('nodes');
    expect(res.json()).not.toHaveProperty('toolCalls');
    expect(seen.apiKey).toBe('sk-update-key');
    expect(seen.instruction).toBe('改简洁');
    expect(seen.targetNodeId).toBe('text-1');
  });

  it('上游凭据失败 → 401', async () => {
    const app = await harness({
      propose: async () => {
        throw new ProviderFailureError('KEY_INVALID', '凭据被拒绝');
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/canvas/node-update-plan',
      headers: { [KEY_HEADER]: 'sk-x' },
      payload: { instruction: '改', canvas: canvas(), targetNodeId: 'text-1' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'KEY_INVALID' });
  });
});
