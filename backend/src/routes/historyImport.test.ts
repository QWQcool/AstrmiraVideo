import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../store/db.js';
import { ProjectStore } from '../store/projects.js';
import { TaskStore } from '../store/taskStore.js';
import { createHistoryImportRoutes } from './historyImport.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

async function harness() {
  const outputsDir = mkdtempSync(path.join(tmpdir(), 'astrmira-import-out-'));
  const assetsDir = path.join(outputsDir, 'assets');
  mkdirSync(assetsDir, { recursive: true });
  const db = openDatabase(':memory:');
  const store = new TaskStore(db);
  const projects = new ProjectStore(db);
  const imageId = '11111111-1111-4111-8111-111111111111';
  writeFileSync(path.join(assetsDir, `${imageId}.jpg`), 'fake-jpeg');
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
  await app.register(
    createHistoryImportRoutes({
      store,
      projects,
      outputsDir,
      createThumbnail: async () => '/media/thumbs/unused.jpg',
    }),
  );
  await app.ready();
  apps.push(app);
  return { app, db, imageId, outputsDir };
}

describe('POST /api/history/import · 外部作品登记历史', () => {
  it('只接受已存在资产，登记为 imported 历史，不生成任务', async () => {
    const { app, imageId } = await harness();
    const res = await app.inject({
      method: 'POST',
      url: '/api/history/import',
      payload: {
        items: [
          {
            assetId: imageId,
            kind: 'image',
            title: '即梦导入图',
            prompt: '雨夜霓虹',
            source: 'jimeng',
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { tasks: Array<Record<string, unknown>> };
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0]).toMatchObject({
      status: 'succeeded',
      outputImageUrl: `/media/assets/${imageId}.jpg`,
    });
    const snapshot = body.tasks[0]?.requestSnapshot as { provider: string };
    expect(snapshot.provider).toBe('imported');
  });

  it('资产不存在 → 400，不写任务', async () => {
    const { app, db } = await harness();
    const res = await app.inject({
      method: 'POST',
      url: '/api/history/import',
      payload: {
        items: [
          {
            assetId: '22222222-2222-4222-8222-222222222222',
            kind: 'image',
          },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect((db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n).toBe(0);
  });

  it('项目不存在 → 400，不写任务', async () => {
    const { app, imageId } = await harness();
    const res = await app.inject({
      method: 'POST',
      url: '/api/history/import',
      payload: {
        projectId: 'missing-project',
        items: [{ assetId: imageId, kind: 'image' }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('kind 与文件扩展名不符 → 400', async () => {
    const { app, imageId } = await harness();
    const res = await app.inject({
      method: 'POST',
      url: '/api/history/import',
      payload: {
        items: [{ assetId: imageId, kind: 'video' }],
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
