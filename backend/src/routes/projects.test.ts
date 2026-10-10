import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECT_ID,
  type AssetListResponse,
  type HistoryResponse,
  type ProjectListResponse,
  type ProjectResponse,
  type VideoProvider,
} from '@astrmira/shared';
import { createErrorResponse } from '../errors.js';
import { openDatabase } from '../store/db.js';
import { ProjectStore } from '../store/projects.js';
import { TaskStore } from '../store/taskStore.js';
import { SqliteJobQueue } from '../queue/SqliteJobQueue.js';
import { createAssetRoutes } from './assets.js';
import { createGenerateRoutes } from './generate.js';
import { createHistoryRoutes } from './history.js';
import { createProjectRoutes } from './projects.js';
import { MAX_FILE_BYTES, createUploadRoutes } from './upload.js';

/**
 * V2.11（台账 B47）· 项目维度的**端到端口径**。
 *
 * 本文件钉住五件事（都是"不测就会悄悄错"的地方）：
 * 1. **老数据零迁移成本**：启动引导建默认项目 + 回填 `project_id IS NULL` 的旧行（幂等）；
 * 2. **省略 = 默认项目**（不是"全部项目"）：`/api/history`、`/api/assets` 省略 `?project=` 时
 *    看不到别的项目的东西 —— 这是"老客户端行为不变"的准确含义；
 * 3. **显式给了不存在的项目就报错**（生成 404 / 上传 400），且上传会把已落盘的文件**撤回**（不留孤儿）；
 * 4. **删除护栏**：默认项目不可删、非空项目不可删（报出真实用量）；
 * 5. **用量如实**：`taskCount` / `assetCount` 与历史、资产列表逐条对账。
 */

const TMP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-proj-data-'));
const TMP_OUTPUTS_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-proj-out-'));
const DB_PATH = path.join(TMP_DATA_DIR, 'app.db');
const ASSETS_DIR = path.join(TMP_OUTPUTS_DIR, 'assets');

/** 最小可嗅探 WAV（44 字节头）—— 音频走"落盘后判类型"的路径，正好用来验项目字段的顺序无关性 */
function wavBytes(padding = 64): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + padding, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(8000, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(padding, 40);
  return Buffer.concat([header, Buffer.alloc(padding, 0)]);
}

type App = Awaited<ReturnType<typeof makeApp>>;

/** 桩 provider：本文件只验"路由层"（真正的上游调用发生在队列里，不在这里） */
const stubProvider = {
  name: 'stub',
  submit: () => Promise.resolve({ upstreamTaskId: 'up-1' }),
  queryStatus: () => Promise.resolve({ status: 'running' as const, progressPercent: 10 }),
  cancel: () => Promise.resolve(false),
} as unknown as VideoProvider;

async function makeApp() {
  const db = openDatabase(DB_PATH);
  const store = new TaskStore(db);
  const projects = new ProjectStore(db);

  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // 与 index.ts 的全局错误处理器**同一条口径**（否则 schema 级校验失败会退成 500，
  // 而不是契约承诺的 400 INVALID_REQUEST —— 第一版测试就是这样抓到"少挂一个 handler"的）
  app.setErrorHandler((error, _request, reply) => {
    const shaped = error as { validation?: unknown; message?: string };
    if (shaped.validation !== undefined) {
      return reply
        .code(400)
        .send(createErrorResponse('INVALID_REQUEST', `请求不符合契约：${shaped.message ?? '校验失败'}`));
    }
    return reply.send(error as Error);
  });
  await app.register(multipart, { limits: { fileSize: MAX_FILE_BYTES } });
  await app.register(createProjectRoutes({ projects, outputsDir: TMP_OUTPUTS_DIR }));
  await app.register(createAssetRoutes({ outputsDir: TMP_OUTPUTS_DIR }));
  await app.register(
    createUploadRoutes({
      outputsDir: TMP_OUTPUTS_DIR,
      projects,
      // 复核不可用 = 退回容器判定（与生产一致；音频的 WAV 容器自己就能判对）
      probeStreams: () => Promise.resolve(null),
    }),
  );
  await app.register(createHistoryRoutes({ store, outputsDir: TMP_OUTPUTS_DIR }));
  await app.register(
    createGenerateRoutes({
      store,
      queue: new SqliteJobQueue(store),
      resolveProvider: () => stubProvider,
      projects,
    }),
  );
  await app.ready();

  return { app, db, store, projects };
}

/** multipart：`fields` 在前、文件在后（浏览器 FormData 的常见顺序） */
function multipartPayload(
  file: { filename: string; contentType: string; content: Buffer },
  fields: Array<[string, string]> = [],
) {
  const boundary = '----astrmiraProjectBoundary';
  const chunks: Buffer[] = [];
  for (const [name, value] of fields) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        'utf8',
      ),
    );
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="files"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.contentType}\r\n\r\n`,
      'utf8',
    ),
    file.content,
    Buffer.from('\r\n', 'utf8'),
    Buffer.from(`--${boundary}--\r\n`, 'utf8'),
  );
  return { boundary, payload: Buffer.concat(chunks) };
}

let ctx: App;

beforeAll(async () => {
  ctx = await makeApp();
});

afterAll(async () => {
  await ctx.app.close();
  ctx.db.close();
  rmSync(TMP_DATA_DIR, { recursive: true, force: true });
  rmSync(TMP_OUTPUTS_DIR, { recursive: true, force: true });
});

describe('启动引导（老数据零迁移成本）', () => {
  it('默认项目永远存在，且是列表里唯一一项（新库）', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ProjectListResponse;
    expect(body.projects.map((project) => project.projectId)).toEqual([DEFAULT_PROJECT_ID]);
    expect(body.projects[0]?.isDefault).toBe(true);
    expect(body.projects[0]?.name).toBe('默认项目');
  });

  it('`project_id IS NULL` 的老行在启动时被**回填**成默认项目（再开库一次验证幂等）', () => {
    // 手工插一条 V2.11 之前的形态（project_id 为空）。快照必须是**合法且完整**的请求形状：
    // 它是 `TaskProgress.requestSnapshot` 的来源，缺字段会在读链路（toTaskProgress）炸掉。
    ctx.db
      .prepare(
        `INSERT INTO tasks (task_id, track, provider, status, progress_percent, request_snapshot,
                            warnings, submitting, project_id, created_at, updated_at)
         VALUES ('legacy-null', 'cloud', 'stub', 'succeeded', 100, ?, '[]', 0, NULL, 1, 1)`,
      )
      .run(
        JSON.stringify({
          prompt: 'V2.11 之前的老任务',
          mode: 't2v',
          aspectRatio: '16:9',
          provider: 'fixture-local',
        }),
      );

    // 重新开库 = 再跑一次 bootstrapProjects（真实升级路径：进程重启）
    const reopened = openDatabase(DB_PATH);
    const row = reopened.prepare('SELECT project_id FROM tasks WHERE task_id = ?').get('legacy-null') as
      | { project_id: string | null }
      | undefined;
    expect(row?.project_id).toBe(DEFAULT_PROJECT_ID);
    reopened.close();
  });
});

describe('项目 CRUD 与护栏', () => {
  let createdProjectId = '';

  it('新建项目：200 + 返回条目（非默认、用量为 0）', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: '  2026 双十一 · 主推片  ' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as ProjectResponse;
    expect(body.project.name).toBe('2026 双十一 · 主推片'); // trim 生效
    expect(body.project.isDefault).toBe(false);
    expect(body.project.taskCount).toBe(0);
    expect(body.project.assetCount).toBe(0);
    createdProjectId = body.project.projectId;
    expect(createdProjectId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('重名被拒（400 INVALID_REQUEST）—— 切换器里两个同名项目认不出来', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: '2026 双十一 · 主推片' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe('INVALID_REQUEST');
  });

  it('纯空白名字被 schema 拒（400）', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('改名：200 + 新名字；不存在的项目 → 404 PROJECT_NOT_FOUND', async () => {
    const ok = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/projects/${createdProjectId}`,
      payload: { name: '双十一主片' },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((ok.json() as ProjectResponse).project.name).toBe('双十一主片');

    const missing = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/projects/does-not-exist',
      payload: { name: 'x' },
    });
    expect(missing.statusCode).toBe(404);
    expect((missing.json() as { code: string }).code).toBe('PROJECT_NOT_FOUND');
  });

  it('默认项目不可删（400）—— 它是老数据与"未指定项目"的落点', async () => {
    const res = await ctx.app.inject({ method: 'DELETE', url: `/api/projects/${DEFAULT_PROJECT_ID}` });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe('INVALID_REQUEST');
  });

  it('删除不存在的项目 → 404 PROJECT_NOT_FOUND', async () => {
    const res = await ctx.app.inject({ method: 'DELETE', url: '/api/projects/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('空项目可以删：200 + 列表里消失', async () => {
    const res = await ctx.app.inject({ method: 'DELETE', url: `/api/projects/${createdProjectId}` });
    expect(res.statusCode, res.body).toBe(200);
    const list = (await ctx.app.inject({ method: 'GET', url: '/api/projects' })).json() as ProjectListResponse;
    expect(list.projects.some((project) => project.projectId === createdProjectId)).toBe(false);
  });
});

describe('归属与过滤（省略 = 默认项目）', () => {
  const projectA = 'aaaaaaaa-1111-4111-8111-111111111111';

  beforeAll(async () => {
    await ctx.app.inject({ method: 'POST', url: '/api/projects', payload: { name: '项目 A' } });
    // 用项目 A 的真实 id（上面那行只为证明"能建"，这里直接写库以获得固定 id 便于断言）
    ctx.projects.create('项目 A（固定 id 用）');
    ctx.db
      .prepare(
        `INSERT INTO projects (project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      )
      .run(projectA, '项目 A', Date.now(), Date.now());

    const snapshot = {
      prompt: '默认项目的片子',
      mode: 't2v' as const,
      aspectRatio: '16:9' as const,
      provider: 'fixture-local' as const,
    };
    ctx.store.insert({
      taskId: 'task-default',
      track: 'cloud',
      provider: 'stub',
      status: 'succeeded',
      progressPercent: 100,
      requestSnapshot: snapshot,
      outputVideoUrl: '/media/task-default.mp4',
      warnings: [],
      submitting: false,
    });
    ctx.store.insert({
      taskId: 'task-project-a',
      track: 'cloud',
      provider: 'stub',
      status: 'succeeded',
      progressPercent: 100,
      requestSnapshot: { ...snapshot, prompt: '项目 A 的片子' },
      outputVideoUrl: '/media/task-project-a.mp4',
      warnings: [],
      submitting: false,
      projectId: projectA,
    });
  });

  it('`/api/history` 省略 project → 只看到默认项目的任务（老客户端行为不变）', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/history' });
    const body = res.json() as HistoryResponse;
    const ids = body.items.map((item) => item.taskId);
    expect(ids).toContain('task-default');
    expect(ids).not.toContain('task-project-a');
  });

  it('`/api/history?project=<id>` → 只看到该项目的任务', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: `/api/history?project=${projectA}` });
    const body = res.json() as HistoryResponse;
    const ids = body.items.map((item) => item.taskId);
    expect(ids).toContain('task-project-a');
    expect(ids).not.toContain('task-default');
  });

  it('上传带 `projectId` 字段 → sidecar 记项目；资产列表按项目过滤', async () => {
    const { boundary, payload } = multipartPayload(
      { filename: '项目 A 的参考音.wav', contentType: 'audio/wav', content: wavBytes() },
      [['projectId', projectA]],
    );
    const uploadRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(uploadRes.statusCode, uploadRes.body).toBe(200);
    const assetId = (uploadRes.json() as { assets: Array<{ assetId: string }> }).assets[0]!.assetId;

    const inA = (await ctx.app.inject({ method: 'GET', url: `/api/assets?project=${projectA}` }))
      .json() as AssetListResponse;
    const entry = inA.assets.find((asset) => asset.assetId === assetId);
    expect(entry?.projectId).toBe(projectA);
    expect(entry?.name).toBe('项目 A 的参考音.wav');

    // 默认项目里看不到它（省略 project 与显式 default 语义一致）
    const inDefault = (await ctx.app.inject({ method: 'GET', url: '/api/assets' }))
      .json() as AssetListResponse;
    expect(inDefault.assets.some((asset) => asset.assetId === assetId)).toBe(false);
  });

  it('上传给了不存在的项目 → 400 + **撤回已落盘的文件**（不留孤儿）', async () => {
    const before = existsSync(ASSETS_DIR) ? readdirSync(ASSETS_DIR).length : 0;
    const { boundary, payload } = multipartPayload(
      { filename: '错项目.wav', contentType: 'audio/wav', content: wavBytes() },
      [['projectId', 'no-such-project']],
    );
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe('INVALID_REQUEST');
    const after = existsSync(ASSETS_DIR) ? readdirSync(ASSETS_DIR).length : 0;
    expect(after).toBe(before); // 一个字节的残渣都不留
  });

  it('生成任务：不存在的项目 → 404 PROJECT_NOT_FOUND（不静默落到默认项目）', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/generate',
      payload: {
        prompt: '一句话',
        mode: 't2v',
        aspectRatio: '16:9',
        provider: 'fixture-local',
        projectId: 'no-such-project',
      },
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { code: string }).code).toBe('PROJECT_NOT_FOUND');
  });

  it('生成任务：指定项目 → 任务落进该项目（并进幂等指纹）', async () => {
    const payload = {
      prompt: '项目 A 的新片',
      mode: 't2v' as const,
      aspectRatio: '16:9' as const,
      provider: 'fixture-local' as const,
      projectId: projectA,
    };
    const first = await ctx.app.inject({ method: 'POST', url: '/api/generate', payload });
    expect(first.statusCode, first.body).toBe(200);
    const taskId = (first.json() as { taskId: string }).taskId;
    expect(ctx.store.get(taskId)?.projectId).toBe(projectA);

    // 同一提示词、**不同项目** → 不能命中同一条任务（项目必须进指纹）
    const other = await ctx.app.inject({
      method: 'POST',
      url: '/api/generate',
      payload: { ...payload, prompt: '项目 A 的新片', projectId: DEFAULT_PROJECT_ID },
    });
    expect((other.json() as { taskId: string }).taskId).not.toBe(taskId);
  });

  it('删除非空项目 → 400，且文案报出真实用量', async () => {
    const res = await ctx.app.inject({ method: 'DELETE', url: `/api/projects/${projectA}` });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { code: string; message: string };
    expect(body.code).toBe('INVALID_REQUEST');
    expect(body.message).toContain('项目非空');
  });

  it('项目列表的用量与历史 / 资产逐条对账', async () => {
    const list = (await ctx.app.inject({ method: 'GET', url: '/api/projects' }))
      .json() as ProjectListResponse;
    const a = list.projects.find((project) => project.projectId === projectA);
    expect(a?.taskCount).toBe(ctx.projects.countTasks(projectA));
    expect(a?.taskCount).toBeGreaterThanOrEqual(2);

    const assetsInA = (await ctx.app.inject({ method: 'GET', url: `/api/assets?project=${projectA}` }))
      .json() as AssetListResponse;
    expect(a?.assetCount).toBe(assetsInA.assets.length);
    expect(a?.assetCount).toBe(1);
  });
});
