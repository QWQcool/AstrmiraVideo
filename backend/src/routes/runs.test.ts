import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../store/db.js';
import { RunStore } from '../runs/runStore.js';
import { createRunRoutes, type RunRoutesDeps } from './runs.js';

const apps: FastifyInstance[] = [];
const dbs: Db[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of dbs.splice(0)) db.close();
});

async function harness(
  overrides: Partial<RunRoutesDeps> = {},
): Promise<{ app: FastifyInstance; deps: RunRoutesDeps; tickCalls: string[] }> {
  const db = openDatabase(':memory:');
  dbs.push(db);
  const runs = new RunStore(db);
  const tickCalls: string[] = [];
  const deps: RunRoutesDeps = {
    runs,
    tick: async (id) => {
      tickCalls.push(id);
    },
    resolveProvider: (provider) => (provider === 'fixture-local' ? {} : null),
    ...overrides,
  };
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(createRunRoutes(deps));
  await app.ready();
  apps.push(app);
  return { app, deps, tickCalls };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    title: '雨夜霓虹',
    mode: 'unattended',
    provider: 'fixture-local',
    steps: [
      { id: 'img-1', kind: 'image', prompt: '首帧图', aspectRatio: '16:9' },
      {
        id: 'shot-1',
        kind: 'video',
        prompt: '视频',
        aspectRatio: '16:9',
        durationSec: 5,
        dependsOn: ['img-1'],
      },
    ],
    ...overrides,
  };
}

describe('POST /api/agent/runs · 创建（S8-B3）', () => {
  it('合法输入 → 201 planned，步骤归一（pending / attempt 0 / 依赖补默认）', async () => {
    const { app } = await harness();
    const res = await app.inject({ method: 'POST', url: '/api/agent/runs', payload: body() });
    expect(res.statusCode).toBe(201);
    const run = res.json().run;
    expect(run.state).toBe('planned');
    expect(run.projectId).toBe('default');
    expect(run.steps[0]).toMatchObject({ id: 'img-1', status: 'pending', attempt: 0 });
    expect(run.steps[1].dependsOn).toEqual(['img-1']);
  });

  it('云轨 provider → 400（D74 明确拒绝）；未启用引擎 → 400 PROVIDER_UNAVAILABLE', async () => {
    const { app } = await harness();
    const cloud = await app.inject({
      method: 'POST',
      url: '/api/agent/runs',
      payload: body({ provider: 'cloud-volcano-seedance' }),
    });
    expect(cloud.statusCode).toBe(400);
    expect(cloud.json().message).toContain('D74');

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/agent/runs',
      payload: body({ provider: 'host-comfyui:ghost' }),
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('结构问题（>16 视频 / 依赖不存在）→ 400 且不落库', async () => {
    const { app, deps } = await harness();
    const tooMany = body({
      steps: Array.from({ length: 17 }, (_u, i) => ({
        id: `shot-${i + 1}`,
        kind: 'video',
        prompt: 'p',
        aspectRatio: '16:9',
      })),
    });
    const res1 = await app.inject({ method: 'POST', url: '/api/agent/runs', payload: tooMany });
    expect(res1.statusCode).toBe(400);
    expect(res1.json().message).toContain('16');

    const badDep = body({
      steps: [
        { id: 'shot-1', kind: 'video', prompt: 'p', aspectRatio: '16:9', dependsOn: ['ghost'] },
      ],
    });
    const res2 = await app.inject({ method: 'POST', url: '/api/agent/runs', payload: badDep });
    expect(res2.statusCode).toBe(400);
    expect(deps.runs.listByProject('default')).toHaveLength(0);
  });
});

describe('会话生命周期（S8-B3）', () => {
  async function createStarted(app: FastifyInstance): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/agent/runs', payload: body() });
    return res.json().run.id as string;
  }

  it('get / list：404 与项目过滤', async () => {
    const { app } = await harness();
    const id = await createStarted(app);
    const detail = await app.inject({ method: 'GET', url: `/api/agent/runs/${id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().run.id).toBe(id);

    const missing = await app.inject({ method: 'GET', url: '/api/agent/runs/nope' });
    expect(missing.statusCode).toBe(404);

    const list = await app.inject({ method: 'GET', url: '/api/agent/runs' });
    expect(list.statusCode).toBe(200);
    expect(list.json().runs).toHaveLength(1);
    expect(list.json().runs[0]).toMatchObject({ state: 'planned', videoStepCount: 1 });
  });

  it('start：planned → running 并触发 tick；重复 start → 409', async () => {
    const { app, tickCalls } = await harness();
    const id = await createStarted(app);
    const res = await app.inject({ method: 'POST', url: `/api/agent/runs/${id}/start` });
    expect(res.statusCode).toBe(200);
    expect(res.json().run.state).toBe('running');
    expect(res.json().run.startedAt).toBeGreaterThan(0);
    expect(tickCalls).toEqual([id]);
    const again = await app.inject({ method: 'POST', url: `/api/agent/runs/${id}/start` });
    expect(again.statusCode).toBe(409);
  });

  it('confirm：非 awaiting-confirmation → 409；到达该态后 → running + confirmedAt', async () => {
    const { app, deps } = await harness();
    const id = await createStarted(app);
    const early = await app.inject({ method: 'POST', url: `/api/agent/runs/${id}/confirm` });
    expect(early.statusCode).toBe(409);

    const run = deps.runs.get(id)!;
    run.state = 'awaiting-confirmation';
    deps.runs.update(run);
    const res = await app.inject({ method: 'POST', url: `/api/agent/runs/${id}/confirm` });
    expect(res.statusCode).toBe(200);
    expect(res.json().run.state).toBe('running');
    expect(res.json().run.confirmedAt).toBeGreaterThan(0);
  });

  it('cancel：活跃态可取消（finishedAt 落盘）；终态再取消 → 409', async () => {
    const { app, deps } = await harness();
    const id = await createStarted(app);
    const res = await app.inject({ method: 'POST', url: `/api/agent/runs/${id}/cancel` });
    expect(res.statusCode).toBe(200);
    expect(res.json().run.state).toBe('cancelled');
    expect(deps.runs.get(id)?.finishedAt).toBeGreaterThan(0);
    const again = await app.inject({ method: 'POST', url: `/api/agent/runs/${id}/cancel` });
    expect(again.statusCode).toBe(409);
  });

  it('retry：failed 会话的失败步 attempt+1 换执行意图，其余成功步不动；非 failed → 409', async () => {
    const { app, deps } = await harness();
    const id = await createStarted(app);
    const early = await app.inject({
      method: 'POST',
      url: `/api/agent/runs/${id}/steps/img-1/retry`,
    });
    expect(early.statusCode).toBe(409);

    const run = deps.runs.get(id)!;
    const { failure: _f, finishedAt: _ft, ...rest } = {
      ...run,
      state: 'failed' as const,
      steps: run.steps.map((step) =>
        step.id === 'img-1'
          ? { ...step, status: 'failed' as const, error: '上游拒绝', attempt: 0 }
          : { ...step, status: 'succeeded' as const, outputAssetId: 'task:t9', attempt: 0 },
      ),
    };
    deps.runs.update(rest);

    const res = await app.inject({ method: 'POST', url: `/api/agent/runs/${id}/steps/img-1/retry` });
    expect(res.statusCode).toBe(200);
    const after = res.json().run;
    expect(after.state).toBe('running');
    expect(after.failure).toBeUndefined();
    expect(after.steps[0]).toMatchObject({ status: 'pending', attempt: 1 });
    expect(after.steps[1]).toMatchObject({ status: 'succeeded', attempt: 0 });

    const wrongStep = await app.inject({
      method: 'POST',
      url: `/api/agent/runs/${id}/steps/shot-1/retry`,
    });
    expect(wrongStep.statusCode).toBe(409);
  });
});
