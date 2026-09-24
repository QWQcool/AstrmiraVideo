import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EditScript } from '@astrmira/shared';
import { openDatabase, type Db } from './db.js';
import { SqliteJobQueue, type TaskTerminalEvent } from '../queue/SqliteJobQueue.js';
import { TaskStore } from './taskStore.js';

/**
 * V9 修复（2026-09-24 用户验收发现）的两条回归测试：
 *
 * ① **剪辑产物不进历史成片**：`listRecent` 默认只返回生成产物（`edit_script IS NULL`），
 *    剪辑产物复用源片的 requestSnapshot（提示词相同），混在画廊里像"重复记录"。
 *    剪辑产物仍可按源片查（`listRecent(50, { kind: 'edit', sourceTaskId })`），剪辑台不受影响。
 *
 * ② **任务终态进操作日志**：`POST /api/edits` 返回 200 只代表"入队成功"，执行是异步的 ——
 *    终态（complete / fail / uncertain）不产生新的 HTTP 请求，操作日志里原本无迹可查
 *    （用户在剪辑台看到失败，翻日志却全是 200）。现在 `SqliteJobQueue` 的终态会触发
 *    `onTaskTerminal` 回调，`index.ts` 注入它写 `EventLogStore`。
 */

const TMP = mkdtempSync(path.join(tmpdir(), 'astrmira-terminal-log-'));
let db: Db;
let store: TaskStore;

const GENERATE_SNAPSHOT = {
  prompt: '生成任务的提示词',
  mode: 't2v' as const,
  aspectRatio: '16:9' as const,
  provider: 'fixture-local' as const,
};

beforeAll(() => {
  db = openDatabase(path.join(TMP, 'app.db'));
  store = new TaskStore(db);
});

afterAll(() => {
  db.close();
  try {
    rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    /* 临时目录残留无碍 */
  }
});

function seedTask(taskId: string, editScript?: EditScript): void {
  store.insert({
    taskId,
    track: 'cloud',
    provider: 'fixture-local',
    status: 'succeeded',
    progressPercent: 100,
    requestSnapshot: GENERATE_SNAPSHOT,
    outputVideoUrl: `/media/${taskId}.mp4`,
    warnings: [],
    submitting: false,
    ...(editScript === undefined ? {} : { editScript }),
  });
}

describe('修复①：剪辑产物不进历史成片', () => {
  it('listRecent 只返回生成产物（剪辑任务被过滤）', () => {
    seedTask('gen-001');
    seedTask('gen-002');
    seedTask('edit-001', { sourceTaskId: 'gen-001', operations: [{ type: 'trim', startSec: 0, endSec: 1 }] });

    const recent = store.listRecent(50);
    const ids = recent.map((r) => r.taskId);

    expect(ids).toContain('gen-001');
    expect(ids).toContain('gen-002');
    expect(ids, '剪辑任务不该出现在历史成片里').not.toContain('edit-001');
  });

  it('剪辑产物仍可按源片查到（剪辑台的"本片剪辑历史"不受影响）', () => {
    const edits = store.listRecent(50, { kind: 'edit', sourceTaskId: 'gen-001' });
    expect(edits.map((r) => r.taskId)).toContain('edit-001');
    // 且只含剪辑产物（不含生成产物）
    expect(edits.every((r) => r.editScript !== undefined)).toBe(true);
  });
});

describe('修复②：任务终态进操作日志', () => {
  it('complete → onTaskTerminal 回调被触发（task.complete）', async () => {
    const events: TaskTerminalEvent[] = [];
    const queue = new SqliteJobQueue(store, (e) => events.push(e));

    seedTask('term-complete');
    await queue.complete('term-complete', { videoUrl: '/media/term-complete.mp4', message: '完成' });

    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('task.complete');
    expect(events[0]?.provider).toBe('fixture-local');
    expect(events[0]?.kind, '生成任务没有 kind').toBeUndefined();
  });

  it('fail → onTaskTerminal 带错误码（task.fail）；剪辑任务带 kind=edit', async () => {
    const events: TaskTerminalEvent[] = [];
    const queue = new SqliteJobQueue(store, (e) => events.push(e));

    seedTask('term-edit', { sourceTaskId: 'gen-001', operations: [{ type: 'trim', startSec: 0, endSec: 1 }] });
    await queue.fail('term-edit', {
      code: 'UPSTREAM_ERROR',
      message: 'ffmpeg 报错：抽帧时间点超片长',
      disposition: 'terminal',
    });

    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e?.action).toBe('task.fail');
    expect(e?.kind, '剪辑任务必须带 kind=edit（日志里可区分）').toBe('edit');
    expect(e?.errorCode).toBe('UPSTREAM_ERROR');
    expect(e?.disposition).toBe('terminal');
    expect(e?.message).toContain('抽帧时间点超片长');
  });

  it('markUncertain → task.uncertain（结果待核对）', async () => {
    const events: TaskTerminalEvent[] = [];
    const queue = new SqliteJobQueue(store, (e) => events.push(e));

    seedTask('term-uncertain');
    await queue.markUncertain('term-uncertain', undefined);

    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('task.uncertain');
    expect(events[0]?.errorCode).toBe('UNCERTAIN_RESULT');
    expect(events[0]?.disposition).toBe('uncertain');
  });

  it('回调抛错不影响任务终态（日志丢了不该让状态也丢）', async () => {
    const queue = new SqliteJobQueue(store, () => {
      throw new Error('日志写失败');
    });

    seedTask('term-resilient');
    await queue.complete('term-resilient', { videoUrl: '/media/x.mp4' });

    // 任务仍然成功落库
    expect(store.get('term-resilient')?.status).toBe('succeeded');
  });
});
