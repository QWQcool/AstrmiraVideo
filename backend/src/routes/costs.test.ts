import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COST_DISCLAIMER, estimateVideoCost, type CostRecord } from '@astrmira/shared';
import { SqliteJobQueue } from '../queue/SqliteJobQueue.js';
import { openDatabase, type Db } from '../store/db.js';
import { ProjectStore } from '../store/projects.js';
import { TaskStore } from '../store/taskStore.js';
import { createCostRoutes } from './costs.js';

/**
 * 成本台账汇总（V2.12 / 台账 B48，CONTRACT §5 / §12）。
 *
 * 断言侧重**四件容易出错的事**：
 * ① 金额旁边的"未结算计数"必须同时在（否则金额被读成全量）；
 * ② **`?project=` 省略 = 默认项目**、`all` = 跨项目（两种口径不能混）；
 * ③ `UNCERTAIN_RESULT` 单独计数（可能已产生费用，最容易被漏）；
 * ④ 项目被删了那笔钱**仍要出现在桶里**（成本是历史事实）。
 */

const NOW = Date.now();

function snapshot(model: string, width = 1280, height = 720, durationSec = 5) {
  return {
    prompt: '成本用例',
    mode: 't2v' as const,
    aspectRatio: '16:9' as const,
    resolution: { width, height },
    provider: 'cloud-volcano-seedance' as const,
    options: { model },
    params: { durationSec },
  };
}

function cloudCost(model = 'doubao-seedance-2-0-mini-260615'): CostRecord {
  const cost = estimateVideoCost({ model, width: 1280, height: 720, outputSeconds: 5, track: 'cloud' });
  if (cost === null) throw new Error('夹具成本算不出来');
  return cost;
}

async function buildApp(db: Db) {
  const store = new TaskStore(db);
  const projects = new ProjectStore(db);
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(createCostRoutes({ store, projects }));
  return { app, store, projects };
}

interface SeedOptions {
  taskId: string;
  projectId: string;
  cost?: CostRecord;
  createdAt?: number;
  uncertain?: boolean;
  status?: 'succeeded' | 'failed';
  model?: string;
}

function seed(store: TaskStore, options: SeedOptions): void {
  store.insert({
    taskId: options.taskId,
    track: 'cloud',
    provider: 'stub',
    status: options.status ?? 'succeeded',
    progressPercent: 100,
    requestSnapshot: snapshot(options.model ?? 'doubao-seedance-2-0-mini-260615'),
    warnings: [],
    submitting: false,
    projectId: options.projectId,
    ...(options.cost === undefined ? {} : { cost: options.cost }),
    ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
  });
  if (options.uncertain === true) {
    store.update(options.taskId, {
      status: 'failed',
      error: { code: 'UNCERTAIN_RESULT', message: '结果不明', disposition: 'uncertain' },
    });
  }
}

describe('GET /api/costs/summary', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase(':memory:');
    delete process.env['MONTHLY_BUDGET_YUAN'];
  });

  afterEach(() => {
    delete process.env['MONTHLY_BUDGET_YUAN'];
  });

  it('省略 project = 默认项目（老客户端行为不变）；all = 跨项目汇总', async () => {
    const { app, store, projects } = await buildApp(db);
    const second = projects.create('二号项目').projectId;
    seed(store, { taskId: 'a', projectId: 'default', cost: cloudCost() });
    seed(store, { taskId: 'b', projectId: second, cost: cloudCost() });

    const scoped = (await app.inject({ method: 'GET', url: '/api/costs/summary' })).json();
    expect(scoped.projectId).toBe('default');
    expect(scoped.taskCount).toBe(1);
    expect(scoped.totalYuan).toBeCloseTo(2.4844, 3);

    const all = (
      await app.inject({ method: 'GET', url: '/api/costs/summary?project=all' })
    ).json();
    expect(all.projectId).toBeNull();
    expect(all.taskCount).toBe(2);
    expect(all.totalYuan).toBeCloseTo(2.4844 * 2, 3);
    // 桶的 label 用**项目名**（不是 id），且按金额倒序
    expect(all.byProject.map((bucket: { label: string }) => bucket.label).sort()).toEqual([
      '二号项目',
      '默认项目',
    ]);

    await app.close();
  });

  it('未结算（V2.12 之前的老任务）单独计数，且不进金额', async () => {
    const { app, store } = await buildApp(db);
    seed(store, { taskId: 'priced', projectId: 'default', cost: cloudCost() });
    seed(store, { taskId: 'legacy', projectId: 'default' });

    const body = (await app.inject({ method: 'GET', url: '/api/costs/summary' })).json();
    expect(body.taskCount).toBe(2);
    expect(body.pricedTaskCount).toBe(1);
    expect(body.unsettledCount).toBe(1);
    expect(body.totalYuan).toBeCloseTo(2.4844, 3);

    await app.close();
  });

  it('本地轨 0 元**计入已结算**（不是未结算），并且不抬高总额', async () => {
    const { app, store } = await buildApp(db);
    seed(store, {
      taskId: 'local',
      projectId: 'default',
      cost: estimateVideoCost({ width: 1280, height: 720, outputSeconds: 5, track: 'local' }) ?? undefined,
    });

    const body = (await app.inject({ method: 'GET', url: '/api/costs/summary' })).json();
    expect(body.pricedTaskCount).toBe(1);
    expect(body.unsettledCount).toBe(0);
    expect(body.totalYuan).toBe(0);

    await app.close();
  });

  it('UNCERTAIN_RESULT 单独计数（可能已产生费用 —— 最容易被漏的成本）', async () => {
    const { app, store } = await buildApp(db);
    seed(store, { taskId: 'uncertain', projectId: 'default', uncertain: true });
    seed(store, { taskId: 'plain', projectId: 'default', status: 'failed' });

    const body = (await app.inject({ method: 'GET', url: '/api/costs/summary' })).json();
    expect(body.uncertainCount).toBe(1);
    // 失败任务不进成本统计（上游多为校验阶段拒绝，不产生费用）
    expect(body.taskCount).toBe(0);

    await app.close();
  });

  it('区间过滤按 created_at（含端点），按天分桶', async () => {
    const { app, store } = await buildApp(db);
    const day = 24 * 60 * 60 * 1000;
    seed(store, { taskId: 'old', projectId: 'default', cost: cloudCost(), createdAt: NOW - 3 * day });
    seed(store, { taskId: 'new', projectId: 'default', cost: cloudCost(), createdAt: NOW });

    const body = (
      await app.inject({ method: 'GET', url: `/api/costs/summary?from=${NOW - day}` })
    ).json();
    expect(body.taskCount).toBe(1);
    expect(body.range.from).toBe(NOW - day);
    expect(body.range.to).toBeNull();
    expect(body.byDay).toHaveLength(1);

    const both = (await app.inject({ method: 'GET', url: '/api/costs/summary' })).json();
    expect(both.byDay).toHaveLength(2);
    // 天数桶按日期倒序（新的在前）
    expect(both.byDay[0].key > both.byDay[1].key).toBe(true);

    await app.close();
  });

  it('按模型分桶：档位标签来自档位表，未指定模型归"默认档"', async () => {
    const { app, store } = await buildApp(db);
    seed(store, { taskId: 'mini', projectId: 'default', cost: cloudCost() });
    seed(store, {
      taskId: 'custom',
      projectId: 'default',
      cost: cloudCost('ep-20260101-abc'),
      model: 'ep-20260101-abc',
    });

    const body = (await app.inject({ method: 'GET', url: '/api/costs/summary' })).json();
    const labels = body.byModel.map((bucket: { label: string }) => bucket.label);
    expect(labels.some((label: string) => label.includes('Seedance 2.0 mini'))).toBe(true);
    expect(labels.some((label: string) => label.includes('ep-20260101-abc'))).toBe(true);

    await app.close();
  });

  it('项目被删了，那笔钱**仍出现在桶里**（label 退回 id，不消失）', async () => {
    const { app, store, projects } = await buildApp(db);
    const created = projects.create('临时项目').projectId;
    seed(store, { taskId: 'gone', projectId: created, cost: cloudCost() });
    // 清掉项目行（模拟"删了项目但任务还在"）—— Store 层不做级联删除，正是本用例的前提
    db.prepare('DELETE FROM projects WHERE project_id = ?').run(created);

    const body = (
      await app.inject({ method: 'GET', url: '/api/costs/summary?project=all' })
    ).json();
    expect(body.byProject).toHaveLength(1);
    expect(body.byProject[0].key).toBe(created);
    expect(body.byProject[0].label).toBe(created);

    await app.close();
  });

  it('月度预算只在 all 档给出（未配置 env 就是 null，不编默认预算）', async () => {
    const { app, store } = await buildApp(db);
    seed(store, { taskId: 'a', projectId: 'default', cost: cloudCost() });

    const noBudget = (await app.inject({ method: 'GET', url: '/api/costs/summary?project=all' })).json();
    expect(noBudget.budget).toBeNull();

    process.env['MONTHLY_BUDGET_YUAN'] = '2';
    const withBudget = (await app.inject({ method: 'GET', url: '/api/costs/summary?project=all' })).json();
    expect(withBudget.budget.monthlyYuan).toBe(2);
    expect(withBudget.budget.monthToDateYuan).toBeCloseTo(2.4844, 3);
    expect(withBudget.budget.over).toBe(true);
    expect(withBudget.budget.ratio).toBeGreaterThan(1);

    // 单项目档不给预算：项目花费 vs 全局预算是两个口径的数字，放一起只会误导
    const scoped = (await app.inject({ method: 'GET', url: '/api/costs/summary' })).json();
    expect(scoped.budget).toBeNull();

    await app.close();
  });

  it('响应带口径说明（服务端下发，界面不许自己写一版）', async () => {
    const { app } = await buildApp(db);
    const body = (await app.inject({ method: 'GET', url: '/api/costs/summary' })).json();
    expect(body.disclaimer).toBe(COST_DISCLAIMER);
    expect(body.disclaimer).toContain('以火山方舟控制台账单为准');
    expect(body.truncated).toBe(false);
    await app.close();
  });
});

describe('终态结算（SqliteJobQueue.complete）', () => {
  it('云端任务结算出估算成本，且**已入账**（历史不再变）', async () => {
    const db = openDatabase(':memory:');
    const store = new TaskStore(db);
    const queue = new SqliteJobQueue(store);
    seed(store, { taskId: 'cloud', projectId: 'default' });

    await queue.complete('cloud', { videoUrl: '/media/cloud.mp4' });
    const record = store.get('cloud');
    expect(record?.cost?.source).toBe('estimate');
    expect(record?.cost?.tokens).toBe(108_000);
    // 冗余列也写了（SQL 聚合靠它）
    const row = db
      .prepare('SELECT cost_yuan, cost_source FROM tasks WHERE task_id = ?')
      .get('cloud') as { cost_yuan: number; cost_source: string };
    expect(row.cost_yuan).toBeCloseTo(2.4844, 3);
    expect(row.cost_source).toBe('estimate');

    db.close();
  });

  it('本地轨结算 0 元（local-free），不是"未结算"', async () => {
    const db = openDatabase(':memory:');
    const store = new TaskStore(db);
    const queue = new SqliteJobQueue(store);
    store.insert({
      taskId: 'local',
      track: 'local',
      provider: 'fixture-local',
      status: 'running',
      progressPercent: 10,
      requestSnapshot: snapshot('fixture'),
      warnings: [],
      submitting: false,
      projectId: 'default',
    });

    await queue.complete('local', { videoUrl: '/media/local.mp4' });
    expect(store.get('local')?.cost?.source).toBe('local-free');
    expect(store.get('local')?.cost?.yuan).toBe(0);

    db.close();
  });

  it('快照里没有分辨率 → 不结算（任务照常成功，只是没有成本记录）', async () => {
    const db = openDatabase(':memory:');
    const store = new TaskStore(db);
    const queue = new SqliteJobQueue(store);
    store.insert({
      taskId: 'no-res',
      track: 'cloud',
      provider: 'stub',
      status: 'running',
      progressPercent: 10,
      requestSnapshot: { prompt: 'x', mode: 't2v', aspectRatio: '16:9' } as never,
      warnings: [],
      submitting: false,
      projectId: 'default',
    });

    await queue.complete('no-res', { videoUrl: '/media/x.mp4' });
    const record = store.get('no-res');
    expect(record?.status).toBe('succeeded');
    expect(record?.cost).toBeUndefined();

    db.close();
  });
});

/**
 * 时间区间的**上界**（`?to=` / `options.to`）。
 *
 * 为什么单独一组：下界（`from`）被"近 N 天"用得很多，上界只有"导出某段区间"才用得上 ——
 * 于是它成了覆盖率门禁里唯一挂着的分支（`taskStore.ts` 的 `to` 两条 if）。
 * 这里把 store 与路由两层都钉住：**少了它，区间过滤就只剩半边**。
 */
describe('时间区间上界（to）', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('store 层：listCostRows 与 countUncertain 都按 to 截断', async () => {
    const { store } = await buildApp(db);
    const early = NOW - 2 * 86_400_000;
    seed(store, { taskId: 'old', projectId: 'default', cost: cloudCost(), createdAt: early });
    seed(store, {
      taskId: 'new',
      projectId: 'default',
      cost: cloudCost(),
      createdAt: NOW,
      uncertain: true,
    });

    // 上界卡在"早"与"新"之间 → 只剩下早的那条
    const bounded = store.listCostRows({ from: 0, to: early + 1000, limit: 10 });
    expect(bounded).toHaveLength(1);
    expect(bounded[0]!.projectId).toBe('default');
    expect(store.countUncertain({ from: 0, to: early + 1000 })).toBe(0);
    // 只给下界 → 两条都在（新那条是 uncertain，但仍是 succeeded=false，故不进 listCostRows）
    expect(store.countUncertain({ from: 0 })).toBe(1);
    expect(store.listCostRows({ from: 0, limit: 10 })).toHaveLength(1);
  });

  it('路由层：?from 与 ?to 一起下发，且 range 原样回显（客户端能确认它按什么区间统计的）', async () => {
    const { app, store } = await buildApp(db);
    const early = NOW - 2 * 86_400_000;
    seed(store, { taskId: 'old', projectId: 'default', cost: cloudCost(), createdAt: early });
    seed(store, {
      taskId: 'new',
      projectId: 'default',
      cost: cloudCost(),
      createdAt: NOW,
      uncertain: true,
    });

    const payload = (
      await app.inject({
        method: 'GET',
        url: `/api/costs/summary?from=0&to=${early + 1000}`,
      })
    ).json();
    expect(payload.range).toEqual({ from: 0, to: early + 1000 });
    expect(payload.taskCount).toBe(1);
    expect(payload.pricedTaskCount).toBe(1);
    expect(payload.uncertainCount).toBe(0);
  });
});
