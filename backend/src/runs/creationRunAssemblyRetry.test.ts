import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import type { CreationRun, EditScript } from '@astrmira/shared';
import { openDatabase, type Db } from '../store/db.js';
import { RunStore } from './runStore.js';
import {
  CreationRunService,
  type RunEnginePorts,
  type RunTaskView,
} from './creationRunEngine.js';
import { createRunRoutes } from '../routes/runs.js';

/**
 * B99 端到端（引擎 + 路由 + 真实 RunStore）：**拼接失败 → 显式重试 → 复用镜头成功**。
 *
 * 注入点：`submitEdit` 第一次抛错（模拟 ffmpeg / 磁盘故障），第二次成功。
 * 断言的重点不是"最后成功了"，而是：
 * - 生成提交（`submit`）计数**全程为 0**：重试没有重新生成任何镜头；
 * - 两次拼接的 EDL 完全一致（同一批 taskId、同一源片），只有幂等键从 a0 变成 a1；
 * - 步骤的 taskId / attempt / 产物一个都没变；
 * - 成功后的收尾（拼接待终态）走的是既有路径。
 */

const apps: FastifyInstance[] = [];
const dbs: Db[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of dbs.splice(0)) db.close();
});

function step(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: 'video' as const,
    prompt: `${id} 提示词`,
    aspectRatio: '16:9' as const,
    resolutionTier: '480p' as const,
    durationSec: 2,
    referenceAssetIds: [],
    dependsOn: [],
    status: 'succeeded' as const,
    attempt: 0,
    taskId: `t-${id}`,
    outputAssetId: `task:t-${id}`,
    ...overrides,
  };
}

function run(overrides: Partial<CreationRun> = {}): CreationRun {
  return {
    version: 1,
    id: 'r-b99',
    title: 'B99 双镜',
    projectId: 'proj-a',
    mode: 'unattended',
    provider: 'fixture-local',
    steps: [step('shot-1'), step('shot-2')],
    state: 'running',
    assemblyAttempt: 0,
    createdAt: 1,
    updatedAt: 1,
    startedAt: 1,
    ...overrides,
  } as CreationRun;
}

async function harness(initial: CreationRun) {
  const db = openDatabase(':memory:');
  dbs.push(db);
  const runs = new RunStore(db);
  runs.create(initial);

  const tasks = new Map<string, RunTaskView>([
    ['t-shot-1', { status: 'succeeded', hasOutput: true }],
    ['t-shot-2', { status: 'succeeded', hasOutput: true }],
  ]);
  const generationSubmits: string[] = [];
  const editCalls: Array<{ script: EditScript; key: string; projectId: string }> = [];
  let failNextEdit = true;

  const ports: RunEnginePorts = {
    getTask: (id) => tasks.get(id) ?? null,
    submit: async (_request, key) => {
      generationSubmits.push(key);
      return 'should-not-happen';
    },
    submitEdit: async (script, key, projectId) => {
      editCalls.push({ script, key, projectId });
      if (failNextEdit) {
        failNextEdit = false;
        throw new Error('注入：ffmpeg 拼接失败（可重复的第一次）');
      }
      tasks.set('e-retry', { status: 'running', hasOutput: false });
      return 'e-retry';
    },
  };

  const service = new CreationRunService({
    load: (id) => runs.get(id),
    save: (value) => runs.update(value),
    ports,
    now: () => 1000,
  });

  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(
    createRunRoutes({
      runs,
      tick: (id) => service.tick(id),
      resolveProvider: () => ({}),
    }),
  );
  await app.ready();
  apps.push(app);
  return { app, runs, tasks, generationSubmits, editCalls, service };
}

describe('B99 · 拼接失败只重拼（端到端）', () => {
  it('注入拼接失败 → 显式重试 → 复用镜头成功；生成提交计数不变，幂等键 a0→a1', async () => {
    const h = await harness(run());
    const before = h.runs.get('r-b99')!;

    // ① 两次 tick：第一次推进到 assembling（既有语义），第二次提交拼接 → 注入失败 → failed(assembly)
    await h.service.tick('r-b99');
    expect(h.runs.get('r-b99')?.state).toBe('assembling');
    await h.service.tick('r-b99');
    const failed = h.runs.get('r-b99')!;
    expect(failed.state).toBe('failed');
    expect(failed.failure?.stepId).toBe('assembly');
    expect(failed.assemblyAttempt).toBe(0);
    expect(h.editCalls).toHaveLength(1);
    expect(h.editCalls[0]?.key).toBe('run:r-b99:assembly:a0');

    // ② 显式重试（路由）→ 新 attempt → 用同一个 EDL 再提交
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/agent/runs/r-b99/steps/assembly/retry',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().run.state).toBe('assembling');
    expect(response.json().run.assemblyAttempt).toBe(1);

    expect(h.editCalls).toHaveLength(2);
    expect(h.editCalls[1]?.key).toBe('run:r-b99:assembly:a1');
    expect(h.editCalls[1]?.script).toEqual(h.editCalls[0]?.script);
    expect(h.editCalls[1]?.projectId).toBe('proj-a');

    // ③ 生成提交全程 0 次；步骤（taskId / attempt / 产物）原样
    expect(h.generationSubmits).toEqual([]);
    const retried = h.runs.get('r-b99')!;
    expect(retried.steps).toEqual(before.steps);
    expect(retried.assembledTaskId).toBe('e-retry');

    // ④ 拼接任务终态 → 会话 succeeded
    h.tasks.set('e-retry', { status: 'succeeded', hasOutput: true });
    await h.service.tick('r-b99');
    expect(h.runs.get('r-b99')?.state).toBe('succeeded');
    expect(h.generationSubmits).toEqual([]);
  });

  it('重试后的恢复窗口：assembledTaskId 未落盘时用同一 attempt 的键续跑（不会自增）', async () => {
    const h = await harness(
      run({
        state: 'assembling',
        assemblyAttempt: 3,
        assembledTaskId: undefined,
        failure: undefined,
      }),
    );
    await h.service.tick('r-b99');
    expect(h.editCalls[0]?.key).toBe('run:r-b99:assembly:a3');
    expect(h.runs.get('r-b99')?.assemblyAttempt).toBe(3);
    expect(h.generationSubmits).toEqual([]);
  });
});
