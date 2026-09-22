import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from './db.js';
import { TaskStore } from './taskStore.js';

/**
 * 增量列迁移（V1.9）。
 *
 * 为什么值得一条专门的测试：`CREATE TABLE IF NOT EXISTS` 对**已存在**的表**不会**补列，
 * 而线上升级正是"代码换了、`data/app.db` 还是上一版的表"。没有这条测试时，
 * 症状会是启动后第一条**有缩略图的任务**写库时报 `no such column: thumbnail_url` ——
 * 也就是"跑了一会儿才炸"，而不是启动即炸。
 */
describe('openDatabase · 旧库升级', () => {
  let dir: string;
  let dbPath: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'astrmira-db-'));
    dbPath = path.join(dir, 'app.db');
  });

  afterAll(async () => {
    // Windows 上 SQLite 的 WAL 句柄可能延迟释放：清理失败不该让测试失败
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      /* 临时目录残留无碍 */
    }
  });

  it('V1.8 的表结构（无 thumbnail_url）打开后被补列，且不丢既有数据', () => {
    // ── ① 造一个"上一版留下的"库：tasks 表没有 thumbnail_url ──
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE tasks (
        task_id            TEXT PRIMARY KEY,
        track              TEXT NOT NULL,
        provider           TEXT NOT NULL,
        status             TEXT NOT NULL,
        progress_percent   REAL NOT NULL DEFAULT 0,
        request_snapshot   TEXT NOT NULL,
        output_video_url   TEXT,
        warnings           TEXT,
        error              TEXT,
        upstream_task_id   TEXT,
        submitting         INTEGER NOT NULL DEFAULT 0,
        message            TEXT,
        created_at         INTEGER NOT NULL,
        updated_at         INTEGER NOT NULL
      );
      INSERT INTO tasks (task_id, track, provider, status, progress_percent, request_snapshot,
                         output_video_url, warnings, submitting, created_at, updated_at)
      VALUES ('legacy-task', 'cloud', 'fixture-local', 'succeeded', 100,
              '{"prompt":"旧任务","mode":"t2v","aspectRatio":"16:9","provider":"fixture-local"}',
              '/media/legacy-task.mp4', '[]', 0, 1, 1);
    `);
    legacy.close();

    // ── ② 用当前代码打开（这一步就是升级）──
    const db = openDatabase(dbPath);
    const columns = (db.pragma('table_info(tasks)') as Array<{ name: string }>).map((c) => c.name);
    expect(columns).toContain('thumbnail_url');

    const store = new TaskStore(db);

    // 旧行读得出来（升级不得让历史任务消失）
    const legacyRow = store.get('legacy-task');
    expect(legacyRow?.outputVideoUrl).toBe('/media/legacy-task.mp4');
    expect(legacyRow?.thumbnailUrl).toBeUndefined();

    // 新列可写可读（这才是升级的真实目的）
    store.update('legacy-task', { thumbnailUrl: '/media/thumbs/legacy-task.jpg' });
    expect(store.get('legacy-task')?.thumbnailUrl).toBe('/media/thumbs/legacy-task.jpg');

    db.close();
  });

  it('重复打开是幂等的（迁移用 pragma 判存在，不靠 try/catch）', () => {
    openDatabase(dbPath).close();

    const db = openDatabase(dbPath);
    const columns = (db.pragma('table_info(tasks)') as Array<{ name: string }>).map((c) => c.name);
    // 重复迁移必须是"什么都不做"，而不是再加一列（SQLite 会直接报 duplicate column name）
    expect(columns.filter((name) => name === 'thumbnail_url')).toHaveLength(1);
    db.close();
  });
});
