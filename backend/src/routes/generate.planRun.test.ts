import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TaskProgress, VideoGenerateRequest, VideoProvider } from '@astrmira/shared';
import { createErrorResponse } from '../errors.js';
import { SqliteJobQueue } from '../queue/SqliteJobQueue.js';
import { CooldownStore, PlanRunRegistry } from '../security/rateLimit.js';
import { openDatabase, type Db } from '../store/db.js';
import { TaskStore } from '../store/taskStore.js';
import { createGenerateRoutes } from './generate.js';

/**
 * 编排运行的冷却语义（V2.26 / 台账 A5 片 A）。
 *
 * ## 为什么必须有这个文件
 * 编排的「▶ 运行」一次提交**一串**节点，而 60s 冷却（防线 5）的粒度是"一次提交" ——
 * 不特判的话第 2 个节点起全部 429，"编排即可执行"就是空话。
 * 这里把**四条边界**钉住：
 * ① 不带 `x-plan-run`：同 IP 第 2 条照样 429（原有防线一字不动）；
 * ② 带**同一个** `x-plan-run`：同一次运行的后续节点放行（一次有意动作）；
 * ③ 带**新的** `x-plan-run`：仍要吃冷却（"连点运行"不能靠换 id 绕过防线）；
 * ④ 不同 IP 各自计桶（与既有语义一致）。
 */

const TMP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-planrun-data-'));
const TMP_OUTPUTS_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-planrun-out-'));

class StubProvider implements VideoProvider {
  readonly id = 'fixture-local' as const;
  readonly name = 'plan-run-stub';

  async checkHealth(): Promise<{ available: boolean }> {
    return { available: true };
  }

  async submit(request: VideoGenerateRequest): Promise<{ taskId: string }> {
    return { taskId: `up-${request.prompt.length}` };
  }

  async queryStatus(taskId: string): Promise<TaskProgress> {
    return {
      taskId,
      status: 'succeeded',
      progressPercent: 100,
      requestSnapshot: {
        prompt: 'x',
        mode: 't2v',
        aspectRatio: '16:9',
        provider: 'fixture-local',
      },
      createdAt: Date.now(),
    };
  }

  async cancel(): Promise<boolean> {
    return false;
  }
}

interface Ctx {
  app: FastifyInstance;
  db: Db;
}

let ctx: Ctx;

beforeAll(async () => {
  const db = openDatabase(path.join(TMP_DATA_DIR, 'app.db'));
  const store = new TaskStore(db);
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler((error, _request, reply) => {
    const shaped = error as { validation?: unknown; message?: string };
    if (shaped.validation !== undefined) {
      return reply
        .code(400)
        .send(createErrorResponse('INVALID_REQUEST', `请求不符合契约：${shaped.message ?? '校验失败'}`));
    }
    return reply.send(error as Error);
  });
  await app.register(
    createGenerateRoutes({
      store,
      queue: new SqliteJobQueue(store),
      resolveProvider: () => new StubProvider(),
      cooldown: new CooldownStore(db),
      planRuns: new PlanRunRegistry(),
    }),
  );
  await app.ready();
  ctx = { app, db };
});

afterAll(async () => {
  await ctx.app.close();
  ctx.db.close();
  rmSync(TMP_DATA_DIR, { recursive: true, force: true });
  rmSync(TMP_OUTPUTS_DIR, { recursive: true, force: true });
});

function submit(options: { prompt: string; ip: string; planRun?: string }) {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/generate',
    remoteAddress: options.ip,
    headers: {
      // 每条用不同的幂等键（否则会走"重放"分支，压根不经过冷却）
      'idempotency-key': `key-${options.prompt}`,
      ...(options.planRun === undefined ? {} : { 'x-plan-run': options.planRun }),
    },
    payload: {
      prompt: options.prompt,
      mode: 't2v',
      aspectRatio: '16:9',
      provider: 'fixture-local',
    } satisfies VideoGenerateRequest,
  });
}

describe('编排运行的冷却豁免（V2.26 / A5 片 A）', () => {
  it('不带 x-plan-run：同 IP 第 2 条照样 429（原有防线一字不动）', async () => {
    const first = await submit({ prompt: '手动 A', ip: '198.51.100.20' });
    expect(first.statusCode, first.body).toBe(200);

    const second = await submit({ prompt: '手动 B', ip: '198.51.100.20' });
    expect(second.statusCode, second.body).toBe(429);
    expect((second.json() as { code: string }).code).toBe('RATE_LIMITED');
  });

  it('同一个 x-plan-run：同一次运行的后续节点放行（一次有意动作）', async () => {
    const ip = '198.51.100.21';
    const first = await submit({ prompt: '编排第 1 条', ip, planRun: 'plan-x-1' });
    expect(first.statusCode, first.body).toBe(200);

    const second = await submit({ prompt: '编排第 2 条', ip, planRun: 'plan-x-1' });
    expect(second.statusCode, second.body).toBe(200);

    const third = await submit({ prompt: '编排第 3 条', ip, planRun: 'plan-x-1' });
    expect(third.statusCode, third.body).toBe(200);
  });

  it('新的 x-plan-run：仍要吃冷却（"连点运行"不能靠换 id 绕过防线）', async () => {
    const ip = '198.51.100.22';
    const first = await submit({ prompt: '运行 1 第 1 条', ip, planRun: 'plan-y-1' });
    expect(first.statusCode, first.body).toBe(200);

    // 第二轮的第一次提交：冷却仍在窗口内 → 429（防线 5 依然在守"重新开始一轮"这个动作）
    const nextRound = await submit({ prompt: '运行 2 第 1 条', ip, planRun: 'plan-y-2' });
    expect(nextRound.statusCode, nextRound.body).toBe(429);
  });

  it('不同 IP 各自计桶（豁免不改变键隔离）', async () => {
    const blocked = await submit({ prompt: '另一台机器的第 1 条', ip: '198.51.100.23' });
    expect(blocked.statusCode, blocked.body).toBe(200);
    const other = await submit({ prompt: '再一台机器的第 1 条', ip: '203.0.113.23' });
    expect(other.statusCode, other.body).toBe(200);
  });
});
