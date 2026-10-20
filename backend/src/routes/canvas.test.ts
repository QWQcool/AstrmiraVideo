import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import { createCanvasNode, createEmptyCanvasDoc, type CanvasDoc } from '@astrmira/shared';
import { createErrorResponse } from '../errors.js';
import { CanvasDocStore } from '../store/canvasDocs.js';
import { createCanvasRoutes, type CanvasRoutesDeps } from './canvas.js';

/**
 * 画布文档路由（CONTRACT §21-8 / V2.42）。
 *
 * 钉的是**存储纪律**，不是 UI：整份读写、缺失即 404、路径与体不一致就拒、索引随保存更新。
 */

const dirs: string[] = [];
const apps: Array<{ close(): Promise<void> }> = [];

async function harness(deps: CanvasRoutesDeps = {}) {
  const dir = deps.dir ?? mkdtempSync(path.join(tmpdir(), 'astrmira-canvas-'));
  if (deps.dir === undefined) dirs.push(dir);
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // 与 `index.ts` 的全局错误处理同口径：校验失败 → 400 + 契约形状（否则响应 schema 对不上）
  app.setErrorHandler((error, _request, reply) => {
    const shaped = error as { validation?: unknown; message?: string };
    if (shaped.validation !== undefined) {
      return reply
        .code(400)
        .send(createErrorResponse('INVALID_REQUEST', `请求不符合契约：${shaped.message ?? '校验失败'}`));
    }
    return reply.send(error as Error);
  });
  await app.register(createCanvasRoutes({ ...deps, dir }));
  await app.ready();
  apps.push(app);
  return { app, dir };
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function docFixture(projectId = 'proj-1', now = 1_700_000_000_000): CanvasDoc {
  const doc = createEmptyCanvasDoc(projectId, '客厅灯光广告', now);
  doc.nodes = [createCanvasNode({ id: 'n1', type: 'image', x: 0, y: 0, now })];
  doc.nodes[0].data.batches = [
    {
      id: 'b1',
      createdAt: now,
      status: 'succeeded',
      outputs: [{ assetId: 'asset-1', kind: 'image' }],
    },
  ];
  return doc;
}

describe('画布文档路由', () => {
  it('保存后能整份读回，索引里出现摘要（节点数/封面）', async () => {
    const { app } = await harness();
    const doc = docFixture();

    const saved = await app.inject({
      method: 'PUT',
      url: '/api/canvas/docs/proj-1',
      payload: doc,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      ok: true,
      summary: { projectId: 'proj-1', nodeCount: 1, coverAssetId: 'asset-1' },
      revision: 1,
    });

    const read = await app.inject({ method: 'GET', url: '/api/canvas/docs/proj-1' });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(doc);

    const index = await app.inject({ method: 'GET', url: '/api/canvas/projects' });
    expect(index.statusCode).toBe(200);
    expect(index.json().projects).toHaveLength(1);
    expect(index.json().projects[0]).toMatchObject({ projectId: 'proj-1', nodeCount: 1 });
  });

  it('没保存过的画布 → 404，且不返回空文档（"新建"与"打错 id"必须能区分）', async () => {
    const { app } = await harness();
    const res = await app.inject({ method: 'GET', url: '/api/canvas/docs/proj-none' });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('PROJECT_NOT_FOUND');
  });

  it('路径与体里的 projectId 不一致 → 400（否则会覆盖另一个画布）', async () => {
    const { app } = await harness();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/canvas/docs/proj-1',
      payload: docFixture('proj-2'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_REQUEST');
  });

  it('版本号不认识 → 400（schema 拒绝，不落盘）', async () => {
    const { app } = await harness();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/canvas/docs/proj-1',
      payload: { ...docFixture(), version: 2 },
    });
    expect(res.statusCode).toBe(400);
    const read = await app.inject({ method: 'GET', url: '/api/canvas/docs/proj-1' });
    expect(read.statusCode).toBe(404);
  });

  it('删除：文档与索引一起消失；再删同一项 → 404', async () => {
    const { app } = await harness();
    await app.inject({ method: 'PUT', url: '/api/canvas/docs/proj-1', payload: docFixture() });

    const first = await app.inject({ method: 'DELETE', url: '/api/canvas/docs/proj-1' });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ deleted: true, projectId: 'proj-1' });

    expect((await app.inject({ method: 'GET', url: '/api/canvas/docs/proj-1' })).statusCode).toBe(404);
    const index = (await app.inject({ method: 'GET', url: '/api/canvas/projects' })).json();
    expect(index.projects).toEqual([]);

    const second = await app.inject({ method: 'DELETE', url: '/api/canvas/docs/proj-1' });
    expect(second.statusCode).toBe(404);
  });

  it('重复保存只更新同一条索引（不会堆出重复项目）', async () => {
    const { app } = await harness();
    await app.inject({ method: 'PUT', url: '/api/canvas/docs/proj-1', payload: docFixture() });
    const second = docFixture('proj-1', 1_700_000_100_000);
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/canvas/docs/proj-1',
      headers: { 'x-canvas-revision': '1' },
      payload: second,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().revision).toBe(2);
    const index = (await app.inject({ method: 'GET', url: '/api/canvas/projects' })).json();
    expect(index.projects).toHaveLength(1);
    expect(index.projects[0].updatedAt).toBe(1_700_000_100_000);
  });

  it('V2.48：已有文档缺修订号 / 旧修订 → 409 DOC_CONFLICT，且不覆盖已保存内容', async () => {
    const { app } = await harness();
    await app.inject({ method: 'PUT', url: '/api/canvas/docs/proj-1', payload: docFixture() });

    const missing = await app.inject({
      method: 'PUT',
      url: '/api/canvas/docs/proj-1',
      payload: { ...docFixture(), name: '另一个标签' },
    });
    expect(missing.statusCode).toBe(409);
    expect(missing.json().code).toBe('DOC_CONFLICT');

    const stale = await app.inject({
      method: 'PUT',
      url: '/api/canvas/docs/proj-1',
      headers: { 'x-canvas-revision': '5' },
      payload: { ...docFixture(), name: '旧修订' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('DOC_CONFLICT');

    const read = await app.inject({ method: 'GET', url: '/api/canvas/docs/proj-1' });
    expect(read.json().name).toBe('客厅灯光广告');
    expect(read.json().revision).toBe(1);
  });

  it('V2.48：删除后迟到的 PUT 不能复活文档（墓碑）', async () => {
    const { app } = await harness();
    await app.inject({ method: 'PUT', url: '/api/canvas/docs/proj-1', payload: docFixture() });
    await app.inject({ method: 'DELETE', url: '/api/canvas/docs/proj-1' });

    const late = await app.inject({
      method: 'PUT',
      url: '/api/canvas/docs/proj-1',
      payload: { ...docFixture(), revision: 1 },
    });
    expect(late.statusCode).toBe(409);
    expect(late.json().code).toBe('DOC_CONFLICT');
    expect((await app.inject({ method: 'GET', url: '/api/canvas/docs/proj-1' })).statusCode).toBe(404);
  });
});

describe('CanvasDocStore', () => {
  it('删除后文档与索引一起消失', async () => {
    const { dir } = await harness();
    const store = new CanvasDocStore(dir);
    store.saveDoc(docFixture());
    expect(store.readDoc('proj-1')).not.toBeNull();
    expect(store.deleteDoc('proj-1')).toBe(true);
    expect(store.readDoc('proj-1')).toBeNull();
    expect(store.readIndex().projects).toHaveLength(0);
  });

  it('索引文件损坏时扫描文档重建，而不是显示“没有作品”', async () => {
    const { dir } = await harness();
    const store = new CanvasDocStore(dir);
    store.saveDoc(docFixture());
    // 直接写坏索引
    const fs = await import('node:fs');
    fs.writeFileSync(path.join(dir, 'index.json'), '{broken', 'utf8');
    const rebuilt = store.readIndex();
    expect(rebuilt.projects).toHaveLength(1);
    expect(rebuilt.projects[0]).toMatchObject({ projectId: 'proj-1', nodeCount: 1 });
  });
});
