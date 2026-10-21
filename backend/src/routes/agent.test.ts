import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AgentPlanSchema,
  BUILTIN_SKILLS,
  SkillManifestSchema,
  type AgentPlan,
  type SkillManifest,
} from '@astrmira/shared';
import { ProviderFailureError } from '../errors.js';
import { createAgentRoutes, type AgentRoutesDeps } from './agent.js';

/**
 * `POST /api/agent/plan`（CONTRACT §23 / S6-B1）。
 * 用注入桩钉本服务的口径；不把某个真实模型的质量当成契约。
 */

async function buildHarness(deps: AgentRoutesDeps = {}) {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // 与生产 errorHandler 同口径：schema 校验失败是 400，不是 500。
  app.setErrorHandler((error: Error & { validation?: unknown }, _request, reply) => {
    const status = error.validation === undefined ? 500 : 400;
    return reply.code(status).send({
      code: status === 400 ? 'INVALID_REQUEST' : 'UPSTREAM_ERROR',
      message: error.message,
      disposition: 'terminal',
    });
  });
  await app.register(createAgentRoutes(deps));
  await app.ready();
  return app;
}

const apps: Array<Awaited<ReturnType<typeof buildHarness>>> = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

async function harness(deps: AgentRoutesDeps = {}) {
  const app = await buildHarness(deps);
  apps.push(app);
  return app;
}

const KEY_HEADER = 'x-llm-key';

function samplePlan(): AgentPlan {
  return AgentPlanSchema.parse({
    version: 1,
    intent: '做一个雨夜霓虹镜头',
    summary: '应用镜头技能',
    steps: [{ kind: 'apply-skill', skillId: 'camera-push-in-slow' }],
    assumptions: [],
    warnings: [],
  });
}

function customSkill(overrides: Record<string, unknown> = {}): SkillManifest {
  return SkillManifestSchema.parse({
    version: 1,
    id: 'user-route-test',
    name: '路由测试技能',
    summary: '测试',
    category: 'mood',
    origin: 'user',
    triggers: ['测试'],
    prompt: '测试提示词',
    params: {},
    modes: ['t2v'],
    requiresImage: false,
    notes: [],
    ...overrides,
  });
}

describe('POST /api/agent/plan · BYOK 与成功路径', () => {
  it('无 X-LLM-Key → 501 LLM_NOT_CONFIGURED，不调用执行者', async () => {
    let called = false;
    const app = await harness({
      plan: async () => {
        called = true;
        return { plan: samplePlan(), model: 'fake' };
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/plan',
      payload: { intent: '雨夜镜头' },
    });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toMatchObject({ code: 'LLM_NOT_CONFIGURED' });
    expect(called).toBe(false);
  });

  it('成功返回计划、engine=llm、模型与 token 用量；Key 去空白后交给执行者', async () => {
    const seen: { apiKey: string; intent: string; skills: readonly SkillManifest[] } = {
      apiKey: '',
      intent: '',
      skills: [],
    };
    const custom = customSkill();
    const app = await harness({
      plan: async (options) => {
        seen.apiKey = options.apiKey;
        seen.intent = options.intent;
        seen.skills = options.skills;
        return {
          plan: samplePlan(),
          model: 'deepseek-chat',
          usage: { promptTokens: 120, completionTokens: 45 },
        };
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/plan',
      headers: { [KEY_HEADER]: '  sk-agent-key  ' },
      payload: { intent: '做一个雨夜霓虹镜头', skills: [custom] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      engine: 'llm',
      model: 'deepseek-chat',
      usage: { promptTokens: 120, completionTokens: 45 },
      plan: { intent: '做一个雨夜霓虹镜头' },
    });
    expect(seen?.apiKey).toBe('sk-agent-key');
    expect(seen?.intent).toBe('做一个雨夜霓虹镜头');
    expect(seen?.skills.some((skill) => skill.id === 'camera-push-in-slow')).toBe(true);
    expect(seen?.skills.some((skill) => skill.id === custom.id)).toBe(true);
  });
});

describe('POST /api/agent/plan · 输入与计划校验', () => {
  it('自建技能 id 与内置冲突 → 400，不静默覆盖', async () => {
    const app = await harness();
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/plan',
      headers: { [KEY_HEADER]: 'sk-x' },
      payload: {
        intent: '测试',
        skills: [customSkill({ id: BUILTIN_SKILLS[0].id })],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('执行者返回 INVALID_REQUEST → 400，保留可读原因', async () => {
    const app = await harness({
      plan: async () => {
        throw new ProviderFailureError('INVALID_REQUEST', 'Agent 计划未通过能力校验：测试原因');
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/plan',
      headers: { [KEY_HEADER]: 'sk-x' },
      payload: { intent: '测试' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: 'INVALID_REQUEST',
      message: expect.stringContaining('测试原因'),
    });
  });

  it('请求里的任意脚本字段被 schema 拒绝，不调用执行者', async () => {
    let called = false;
    const app = await harness({
      plan: async () => {
        called = true;
        return { plan: samplePlan(), model: 'fake' };
      },
    });
    const tooMany = await app.inject({
      method: 'POST',
      url: '/api/agent/plan',
      headers: { [KEY_HEADER]: 'sk-x' },
      payload: {
        intent: '测试',
        plan: { steps: [] },
        skills: [],
        exec: 'rm -rf /',
      },
    });
    expect(tooMany.statusCode).toBe(400);
    expect(called).toBe(false);
  });
});
