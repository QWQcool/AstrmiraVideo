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
import { EDIT_PROJECT_VERSION, type EditProject, type HistoryResponse } from '@astrmira/shared';
import { createErrorResponse } from '../errors.js';
import { createHistoryRoutes } from './history.js';
import { openDatabase, type Db } from '../store/db.js';
import { TaskStore } from '../store/taskStore.js';

/**
 * `GET /api/history` 的分页（V2.25 / 台账 B44 画布规模与性能）。
 *
 * 分页的正确性全在**边界**上，这里逐条钉住：
 * ① `limit` 省略 = 50（V2.25 之前的行为一字不变）；
 * ② `before` 是**严格小于**（游标那条不重复出现）；
 * ③ 逐页向过去推进**不重不漏**（收集全量 id 逐一比对）；
 * ④ `hasMore` 不说谎（多查一条探测；"最后一批刚好取满"时必须是 false）；
 * ⑤ `limit` 越界 **400**（不静默 clamp —— 越界说明客户端有 bug，藏住它比报错更糟）；
 * ⑥ 「生成 / 剪辑」两类来源各自可翻页（画布把它们合并成一张图）。
 */

const TMP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-paging-data-'));
const TMP_OUTPUTS_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-paging-out-'));

/** 固定基准时间：让"谁比谁早"完全确定，不依赖机器时钟 */
const BASE_TS = 1_700_000_000_000;

/** 剪辑产物的最小合法工程（响应 schema 会校验 `editOrigin.project`，必须过 EditProjectSchema） */
const EDIT_PROJECT_STUB: EditProject = {
  version: EDIT_PROJECT_VERSION,
  fps: 30,
  width: 1080,
  height: 1920,
  tracks: [],
};

interface Ctx {
  app: FastifyInstance;
  db: Db;
  store: TaskStore;
}

let ctx: Ctx;

/** 直接落库（不经路由）：分页测试要精确控制 `created_at`，而 `insert` 用 `Date.now()` */
function seed(
  taskId: string,
  index: number,
  options: { projectId?: string; edit?: boolean } = {},
): number {
  const createdAt = BASE_TS + index * 1000;
  ctx.store.insert({
    taskId,
    track: 'cloud',
    provider: 'stub',
    status: 'succeeded',
    progressPercent: 100,
    requestSnapshot: {
      prompt: `片子 ${taskId}`,
      mode: 't2v',
      aspectRatio: '16:9',
      provider: 'fixture-local',
    },
    warnings: [],
    submitting: false,
    ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
  });
  ctx.db
    .prepare('UPDATE tasks SET created_at = ?, updated_at = ? WHERE task_id = ?')
    .run(createdAt, createdAt, taskId);
  if (options.edit === true) {
    // 剪辑产物：`listRecent` 的 edit 分支按这两列是否存在判定（V2.5 两代结构）。
    // `editOrigin.project` 必须**过 EditProjectSchema** —— 响应 schema 会校验它，
    // 一个"差不多"的 JSON 会让接口 500（第一版就是这样红的）。
    ctx.db
      .prepare('UPDATE tasks SET edit_origin = ? WHERE task_id = ?')
      .run(
        JSON.stringify({
          sourceTaskId: 'task-gen-0000',
          project: EDIT_PROJECT_STUB,
        }),
        taskId,
      );
  }
  return createdAt;
}

beforeAll(async () => {
  const db = openDatabase(path.join(TMP_DATA_DIR, 'app.db'));
  const store = new TaskStore(db);
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // 与 index.ts 同口径：schema 校验失败 → 400 INVALID_REQUEST（而不是 500）
  app.setErrorHandler((error, _request, reply) => {
    const shaped = error as { validation?: unknown; message?: string };
    if (shaped.validation !== undefined) {
      return reply
        .code(400)
        .send(createErrorResponse('INVALID_REQUEST', `请求不符合契约：${shaped.message ?? '校验失败'}`));
    }
    return reply.send(error as Error);
  });
  await app.register(createHistoryRoutes({ store, outputsDir: TMP_OUTPUTS_DIR }));
  await app.ready();
  ctx = { app, db, store };

  // 默认项目：60 条生成（index 0..59，越大越新）+ 3 条剪辑（100..102）
  for (let index = 0; index < 60; index += 1) seed(`task-gen-${String(index).padStart(4, '0')}`, index);
  for (let index = 0; index < 3; index += 1) {
    seed(`task-edit-${String(index).padStart(4, '0')}`, 100 + index, { edit: true });
  }
  // 项目 A：2 条生成
  seed('task-a-0000', 200, { projectId: 'project-a' });
  seed('task-a-0001', 201, { projectId: 'project-a' });
});

afterAll(async () => {
  await ctx.app.close();
  ctx.db.close();
  rmSync(TMP_DATA_DIR, { recursive: true, force: true });
  rmSync(TMP_OUTPUTS_DIR, { recursive: true, force: true });
});

async function fetchPage(query: string): Promise<HistoryResponse> {
  const response = await ctx.app.inject({ method: 'GET', url: `/api/history${query}` });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as HistoryResponse;
}

describe('分页：limit / before / hasMore（V2.25 / B44）', () => {
  it('limit 省略 = 50（与 V2.25 之前一致），且取的是**最新**的一批', async () => {
    const body = await fetchPage('');
    expect(body.items).toHaveLength(50);
    expect(body.hasMore).toBe(true); // 库里共 60 条生成
    expect(body.items[0]?.taskId).toBe('task-gen-0059'); // 最新在最前
    expect(body.items[49]?.taskId).toBe('task-gen-0010');
  });

  it('before 是**严格小于**：游标那条自己不会重复出现', async () => {
    const cursor = BASE_TS + 59 * 1000; // task-gen-0059 的时间
    const body = await fetchPage(`?limit=3&before=${cursor}`);
    expect(body.items.map((item) => item.taskId)).toEqual([
      'task-gen-0058',
      'task-gen-0057',
      'task-gen-0056',
    ]);
  });

  it('逐页向过去推进：**不重不漏**（把 60 条按 7 条一页收全）', async () => {
    const pageSize = 7;
    const collected: string[] = [];
    let before: number | undefined;
    let hasMore = true;
    let pages = 0;

    while (hasMore) {
      const suffix: string = before === undefined ? '' : `&before=${before}`;
      const body = await fetchPage(`?limit=${pageSize}${suffix}`);
      pages += 1;
      expect(pages).toBeLessThanOrEqual(12); // 防御：不因 hasMore 说谎而死循环
      collected.push(...body.items.map((item) => item.taskId));
      hasMore = body.hasMore;
      const oldest = body.items.at(-1);
      expect(oldest).toBeDefined();
      before = oldest?.createdAt;
    }

    expect(collected).toHaveLength(60);
    expect(new Set(collected).size).toBe(60); // 无重复
    expect(collected[0]).toBe('task-gen-0059');
    expect(collected.at(-1)).toBe('task-gen-0000'); // 恰好收全到最早那条
  });

  it('最后一批**刚好取满**时 hasMore=false（用长度猜会在这一格说谎）', async () => {
    // 项目 A 只有 2 条；limit=2 时"取满"但不是"还有更多"
    const body = await fetchPage('?project=project-a&limit=2');
    expect(body.items).toHaveLength(2);
    expect(body.hasMore).toBe(false);
  });

  it('limit 越界（0 / 201）→ 400 INVALID_REQUEST（不静默 clamp）', async () => {
    for (const limit of ['0', '201', '-1', 'abc']) {
      const response = await ctx.app.inject({ method: 'GET', url: `/api/history?limit=${limit}` });
      expect(response.statusCode, `limit=${limit} body=${response.body}`).toBe(400);
      expect((response.json() as { code: string }).code, `limit=${limit} body=${response.body}`).toBe(
        'INVALID_REQUEST',
      );
    }
  });

  it('kind=edit 也支持分页（两类来源各自有游标，画布把它们合并成一张图）', async () => {
    const first = await fetchPage('?kind=edit&limit=1');
    expect(first.items.map((item) => item.taskId)).toEqual(['task-edit-0002']);
    expect(first.hasMore).toBe(true);

    const second = await fetchPage(`?kind=edit&limit=2&before=${first.items[0]?.createdAt}`);
    expect(second.items.map((item) => item.taskId)).toEqual(['task-edit-0001', 'task-edit-0000']);
    expect(second.hasMore).toBe(false); // 剪辑产物恰好翻完
  });

  it('项目过滤与分页叠加：项目 A 的游标不会翻进默认项目', async () => {
    const first = await fetchPage('?project=project-a&limit=1');
    expect(first.items.map((item) => item.taskId)).toEqual(['task-a-0001']);
    expect(first.hasMore).toBe(true);

    const second = await fetchPage(
      `?project=project-a&limit=5&before=${first.items[0]?.createdAt}`,
    );
    expect(second.items.map((item) => item.taskId)).toEqual(['task-a-0000']);
    expect(second.hasMore).toBe(false);
  });
});
