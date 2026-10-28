import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VideoGenerateRequest } from '@astrmira/shared';

import { openDatabase, type Db } from '../store/db.js';
import { TaskStore } from '../store/taskStore.js';
import { createTaskRoutes } from './tasks.js';

/**
 * B104：`GET /api/tasks/:id/preview` 的 HTTP 行为（V2.95）。
 *
 * 为什么单独用一个假取帧函数：真机 ComfyUI 只有在**模型能出 latent 预览**时才会推二进制帧
 * （FLUX / Wan 这类 16 通道 latent 目前拿不到），所以这条路不能只靠真机验 ——
 * 把"取帧"抽成依赖，就能把 HTTP 语义（200 头 / 404 原因 / 序号头）钉死。
 */

const request = {
  prompt: 'p',
  mode: 't2i',
  aspectRatio: '16:9',
  provider: 'host-comfyui',
} as VideoGenerateRequest;

describe('GET /api/tasks/:id/preview（B104）', () => {
  let db: Db;
  let store: TaskStore;
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    store = new TaskStore(db);
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  function seed(taskId: string, upstreamTaskId?: string): void {
    store.insert({
      taskId,
      track: 'local',
      provider: 'host-comfyui',
      status: 'running',
      progressPercent: 40,
      requestSnapshot: request,
      warnings: [],
      submitting: false,
      ...(upstreamTaskId === undefined ? {} : { upstreamTaskId }),
    });
  }

  it('有预览帧 → 200 + 正确的 content-type / 序号头 / 不缓存', async () => {
    seed('t1', 'prompt-1');
    await app.register(
      createTaskRoutes({
        store,
        findPreview: (promptId) =>
          promptId === 'prompt-1'
            ? { bytes: new Uint8Array([0xff, 0xd8, 0xff]), mime: 'image/jpeg', seq: 7 }
            : null,
      }),
    );

    const response = await app.inject({ method: 'GET', url: '/api/tasks/t1/preview' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/jpeg');
    expect(response.headers['x-preview-seq']).toBe('7');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.rawPayload).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it('没有预览帧 → 404 且说清原因（不返回占位图）', async () => {
    seed('t2', 'prompt-2');
    await app.register(createTaskRoutes({ store, findPreview: () => null }));

    const response = await app.inject({ method: 'GET', url: '/api/tasks/t2/preview' });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('PREVIEW_UNAVAILABLE');
    expect(response.json().message).toContain('取不到');
  });

  it('任务还没提交到上游（无 upstreamTaskId）→ 404，不去猜', async () => {
    seed('t3');
    await app.register(
      createTaskRoutes({
        store,
        findPreview: () => {
          throw new Error('不该被调用');
        },
      }),
    );

    const response = await app.inject({ method: 'GET', url: '/api/tasks/t3/preview' });
    expect(response.statusCode).toBe(404);
  });

  it('任务不存在 → 404（与其它路由同一口径）', async () => {
    await app.register(createTaskRoutes({ store, findPreview: () => null }));
    const response = await app.inject({ method: 'GET', url: '/api/tasks/nope/preview' });
    expect(response.statusCode).toBe(404);
  });
});
