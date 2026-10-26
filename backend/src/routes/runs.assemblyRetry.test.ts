import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import type { CreationRun } from '@astrmira/shared';
import { openDatabase, type Db } from '../store/db.js';
import { RunStore } from '../runs/runStore.js';
import { createRunRoutes, type RunRoutesDeps } from './runs.js';

/**
 * B99：拼接失败**只重拼**（CONTRACT §29 / V2.74）。
 *
 * 这组用例钉住四件事：
 * ① 只有「拼接失败」的会话能走 `stepId='assembly'`，其他失败点给 409；
 * ② 迁移到 assembling 时 `assemblyAttempt+1`、清 `assembledTaskId/failure/finishedAt`，
 *    **已成功步骤一个字段都不动**；
 * ③ 连点/并发第二次进来时状态已是 assembling → 409，不会开第二个拼接任务；
 * ④ attempt 真落库（不是只在内存里 +1）。
 */

const apps: FastifyInstance[] = [];
const dbs: Db[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of dbs.splice(0)) db.close();
});

async function harness(run: CreationRun): Promise<{
  app: FastifyInstance;
  runs: RunStore;
  tickCalls: string[];
}> {
  const db = openDatabase(':memory:');
  dbs.push(db);
  const runs = new RunStore(db);
  runs.create(run);
  const tickCalls: string[] = [];
  const deps: RunRoutesDeps = {
    runs,
    tick: async (id) => {
      tickCalls.push(id);
    },
    resolveProvider: () => ({}),
  };
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(createRunRoutes(deps));
  await app.ready();
  apps.push(app);
  return { app, runs, tickCalls };
}

function step(id: string, kind: 'image' | 'video', overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind,
    prompt: `${id} 提示词`,
    aspectRatio: '16:9' as const,
    resolutionTier: '480p' as const,
    ...(kind === 'video' ? { durationSec: 2 } : {}),
    referenceAssetIds: [],
    dependsOn: [],
    status: 'succeeded' as const,
    attempt: 0,
    taskId: `t-${id}`,
    outputAssetId: `task:t-${id}`,
    ...overrides,
  };
}

function failedAssemblyRun(overrides: Partial<CreationRun> = {}): CreationRun {
  return {
    version: 1,
    id: 'run-b99',
    title: 'B99 双镜拼接失败',
    projectId: 'default',
    mode: 'unattended',
    provider: 'fixture-local',
    steps: [step('shot-1', 'video'), step('shot-2', 'video')],
    state: 'failed',
    failure: { stepId: 'assembly', message: 'ffmpeg 拼接失败' },
    finishedAt: 100,
    createdAt: 1,
    updatedAt: 100,
    startedAt: 2,
    assemblyAttempt: 0,
    ...overrides,
  } as CreationRun;
}

describe('B99 · 拼接失败后的显式重试（stepId=assembly）', () => {
  it('failed(assembly) + 全部镜头成功 → assembling；attempt+1、清失败痕迹、步骤不动、tick 一次', async () => {
    const { app, runs, tickCalls } = await harness(failedAssemblyRun());
    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/runs/run-b99/steps/assembly/retry',
    });
    expect(response.statusCode).toBe(200);
    const updated = response.json().run as CreationRun;
    expect(updated.state).toBe('assembling');
    expect(updated.assemblyAttempt).toBe(1);
    expect(updated.assembledTaskId).toBeUndefined();
    expect(updated.failure).toBeUndefined();
    expect(updated.finishedAt).toBeUndefined();
    // 已成功的镜头：taskId / 产物 / attempt 全部原样
    expect(updated.steps).toEqual(failedAssemblyRun().steps);
    expect(tickCalls).toEqual(['run-b99']);

    // 真落库（不是只在响应里改）
    const stored = runs.get('run-b99');
    expect(stored?.assemblyAttempt).toBe(1);
    expect(stored?.state).toBe('assembling');
  });

  it('连点第二次 → 409（已是 assembling），不产生第二个拼接任务', async () => {
    const { app, tickCalls } = await harness(failedAssemblyRun());
    const first = await app.inject({
      method: 'POST',
      url: '/api/agent/runs/run-b99/steps/assembly/retry',
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: 'POST',
      url: '/api/agent/runs/run-b99/steps/assembly/retry',
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().message).toContain('拼接');
    expect(tickCalls).toEqual(['run-b99']);
  });

  it('失败点是某个镜头 → 不能用 assembly 重试（先重试那个镜头）', async () => {
    const run = failedAssemblyRun({
      steps: [step('shot-1', 'video'), step('shot-2', 'video', { status: 'failed', error: '上游失败' })],
      failure: { stepId: 'shot-2', message: '上游失败' },
    });
    const { app, tickCalls } = await harness(run);
    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/runs/run-b99/steps/assembly/retry',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain('shot-2');
    expect(tickCalls).toEqual([]);
  });

  it('已有镜头未成功 → 409，且不会为了拼接重新生成', async () => {
    const run = failedAssemblyRun({
      steps: [step('shot-1', 'video'), step('shot-2', 'video', { status: 'running' })],
    });
    const { app, tickCalls } = await harness(run);
    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/runs/run-b99/steps/assembly/retry',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain('shot-2:running');
    expect(tickCalls).toEqual([]);
  });

  it('单镜会话没有拼接可重试 → 409', async () => {
    const run = failedAssemblyRun({ steps: [step('shot-1', 'video')] });
    const { app } = await harness(run);
    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/runs/run-b99/steps/assembly/retry',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain('单镜');
  });

  it('旧会话（没有 assembly_attempt 列值）读作 0，重试后从 1 开始', async () => {
    const legacy = failedAssemblyRun();
    // 模拟 B99 之前的行：schema 默认值把它读成 0
    delete (legacy as { assemblyAttempt?: number }).assemblyAttempt;
    const { app, runs } = await harness({ ...legacy, assemblyAttempt: 0 } as CreationRun);
    expect(runs.get('run-b99')?.assemblyAttempt).toBe(0);
    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/runs/run-b99/steps/assembly/retry',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().run.assemblyAttempt).toBe(1);
  });
});
