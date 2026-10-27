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
import { createErrorResponse } from '../errors.js';
import { createSubjectRoutes, type SubjectRoutesDeps } from './subjects.js';

/**
 * 主体库路由（CONTRACT §21-18 / V2.86）。
 *
 * 钉的是契约形状与状态码：空库 200、建/改/删 200、不存在 404、体非法 400。
 */

const dirs: string[] = [];
const apps: Array<{ close(): Promise<void> }> = [];

async function harness(deps: SubjectRoutesDeps = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'astrmira-subject-routes-'));
  dirs.push(dir);
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
  await app.register(createSubjectRoutes({ ...deps, file: path.join(dir, 'subjects.json') }));
  await app.ready();
  apps.push(app);
  return { app };
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('主体库路由', () => {
  it('空库返回 200 + 空数组（不是 404）', async () => {
    const { app } = await harness();
    const response = await app.inject({ method: 'GET', url: '/api/subjects' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ subjects: [] });
  });

  it('建 -> 列 -> 改 -> 删 的完整闭环', async () => {
    const { app } = await harness();

    const created = await app.inject({
      method: 'POST',
      url: '/api/subjects',
      payload: { name: '斯坦茜', description: '中年女性', assetIds: ['a1'] },
    });
    expect(created.statusCode).toBe(200);
    const subjectId = created.json().subject.id as string;
    expect(created.json().subject.createdAt).toBeTypeOf('number');

    const listed = await app.inject({ method: 'GET', url: '/api/subjects' });
    expect(listed.json().subjects).toHaveLength(1);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/subjects/${subjectId}`,
      payload: { assetIds: ['a1', 'a2'] },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().subject.assetIds).toEqual(['a1', 'a2']);

    const removed = await app.inject({ method: 'DELETE', url: `/api/subjects/${subjectId}` });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ deleted: true, subjectId });

    const after = await app.inject({ method: 'GET', url: '/api/subjects' });
    expect(after.json().subjects).toEqual([]);
  });

  it('名字为空 / 空 body 改 -> 400（不静默接受）', async () => {
    const { app } = await harness();
    const created = await app.inject({
      method: 'POST',
      url: '/api/subjects',
      payload: { name: '   ' },
    });
    expect(created.statusCode).toBe(400);

    const subject = await app.inject({
      method: 'POST',
      url: '/api/subjects',
      payload: { name: 'A' },
    });
    const emptyPatch = await app.inject({
      method: 'PATCH',
      url: `/api/subjects/${subject.json().subject.id as string}`,
      payload: {},
    });
    expect(emptyPatch.statusCode).toBe(400);
  });

  it('改 / 删不存在 -> 404', async () => {
    const { app } = await harness();
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/subjects/nope',
      payload: { name: 'B' },
    });
    expect(patch.statusCode).toBe(404);
    expect(patch.json().code).toBe('PROJECT_NOT_FOUND');

    const removed = await app.inject({ method: 'DELETE', url: '/api/subjects/nope' });
    expect(removed.statusCode).toBe(404);
  });

  it('assetIds 超过 9 张 -> 400（结构上限，不静默截断）', async () => {
    const { app } = await harness();
    const response = await app.inject({
      method: 'POST',
      url: '/api/subjects',
      payload: { name: 'A', assetIds: Array.from({ length: 10 }, (_v, i) => `a${i}`) },
    });
    expect(response.statusCode).toBe(400);
  });
});
