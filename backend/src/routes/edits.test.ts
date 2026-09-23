import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../index.js';
import { openDatabase } from '../store/db.js';
import { TaskStore } from '../store/taskStore.js';

/**
 * `POST /api/edits` 的校验分支（V9 · B9 / Step 6-AC6）。
 *
 * 三条会 4xx 的输入在这里被钉住 —— 它们都属于"能在入队前就判定"的错误，
 * 让用户**立刻**拿到可读原因，而不是等 ffmpeg 在几秒后吐一句看不懂的话。
 *
 * 成功路径不在这里测（它会真的跑 ffmpeg）：那由 `pipeline/editExecutor.test.ts` 的集成用例覆盖。
 */

const TMP_DATA = mkdtempSync(path.join(tmpdir(), 'astrmira-edits-data-'));
const TMP_OUT = mkdtempSync(path.join(tmpdir(), 'astrmira-edits-out-'));
let app: Awaited<ReturnType<typeof buildApp>>;

const REQUEST_SNAPSHOT = {
  prompt: '剪辑源片',
  mode: 't2v' as const,
  aspectRatio: '16:9' as const,
  provider: 'fixture-local' as const,
};

beforeAll(async () => {
  process.env.DATA_DIR = TMP_DATA;
  process.env.OUTPUT_DIR = TMP_OUT;

  // 另开一个连接塞一条"已成功的源任务"：路由的校验需要它存在
  const db = openDatabase(path.join(TMP_DATA, 'app.db'));
  new TaskStore(db).insert({
    taskId: 'seed-source',
    track: 'cloud',
    provider: 'fixture-local',
    status: 'succeeded',
    progressPercent: 100,
    requestSnapshot: REQUEST_SNAPSHOT,
    outputVideoUrl: '/media/seed-source.mp4',
    warnings: [],
    submitting: false,
  });
  db.close();

  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  for (const dir of [TMP_DATA, TMP_OUT]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* 临时目录残留无碍 */
    }
  }
});

/** 显式 await：`app.inject` 的重载在不 await 时会被推断成 `void & Promise & Chain` 的联合 */
async function postEdit(payload: object): Promise<Awaited<ReturnType<typeof app.inject>>> {
  const response = await app.inject({ method: 'POST', url: '/api/edits', payload });
  return response;
}

describe('POST /api/edits · 校验分支', () => {
  it('endSec ≤ startSec → 400 INVALID_REQUEST（terminal，不让 ffmpeg 去报错）', async () => {
    const response = await postEdit({
      sourceTaskId: 'seed-source',
      operations: [{ type: 'trim', startSec: 3, endSec: 3 }],
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { code: string; disposition: string; message: string };
    expect(body.code).toBe('INVALID_REQUEST');
    expect(body.disposition).toBe('terminal');
    expect(body.message).toContain('endSec');
  });

  it('源任务不存在 → 404 TASK_NOT_FOUND（terminal）', async () => {
    const response = await postEdit({
      sourceTaskId: 'no-such-task',
      operations: [{ type: 'trim', startSec: 0, endSec: 1 }],
    });

    expect(response.statusCode).toBe(404);
    const body = response.json() as { code: string; message: string };
    expect(body.code).toBe('TASK_NOT_FOUND');
    expect(body.message).toContain('no-such-task');
  });

  it('拼接素材不存在 → 404（早于执行期报出，用户知道是哪一段的问题）', async () => {
    const response = await postEdit({
      sourceTaskId: 'seed-source',
      operations: [{ type: 'concat', taskIds: ['seed-source', 'missing-part'] }],
    });

    expect(response.statusCode).toBe(404);
    expect((response.json() as { code: string }).code).toBe('TASK_NOT_FOUND');
    expect((response.json() as { message: string }).message).toContain('missing-part');
  });

  it('形状不合法（未知操作类型）→ 400（zod 判别联合直接拒，进不到业务层）', async () => {
    const response = await postEdit({
      sourceTaskId: 'seed-source',
      operations: [{ type: 'flip', axis: 'x' }],
    });

    expect(response.statusCode).toBe(400);
  });

  it('操作数为 0 或超过 8 → 400（契约的上限）', async () => {
    expect((await postEdit({ sourceTaskId: 'seed-source', operations: [] })).statusCode).toBe(400);

    const nine = Array.from({ length: 9 }, () => ({ type: 'trim', startSec: 0, endSec: 1 }));
    expect((await postEdit({ sourceTaskId: 'seed-source', operations: nine })).statusCode).toBe(400);
  });
});

describe('零上游调用的结构保证（AC6 的硬要求）', () => {
  it('剪辑链路（路由 + 执行器）不 import 任何 provider、也不碰凭据', () => {
    const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));

    for (const file of ['edits.ts', path.join('..', 'pipeline', 'editExecutor.ts')]) {
      const source = readFileSync(path.join(here, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
      // 不引入 provider（包括 registry）—— 结构上就不可能发起上游调用
      expect(source, `${file} 不应 import provider`).not.toMatch(/providers\//);
      // 不接触凭据（凭据只对"要付费的上游"有意义）
      expect(source, `${file} 不应读凭据`).not.toMatch(/keyVault|credential|X-Provider-Key/);
    }
  });
});
