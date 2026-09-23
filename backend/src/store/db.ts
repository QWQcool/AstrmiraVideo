import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

/**
 * SQLite 存储（CONTRACT §7）：任务状态 / 参数快照 / 画廊元数据 / 幂等键 / 防线 5 冷却
 * 全部落 `data/app.db`，**服务重启后必须能恢复**（防线 2 / AC4）。
 */

export type Db = Database.Database;

/** 表结构（幂等建表；后续切片如需加列，用 `ALTER TABLE` 追加并在此登记） */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  task_id            TEXT PRIMARY KEY,
  track              TEXT NOT NULL,
  provider           TEXT NOT NULL,
  status             TEXT NOT NULL,
  progress_percent   REAL NOT NULL DEFAULT 0,
  request_snapshot   TEXT NOT NULL,
  output_video_url   TEXT,
  thumbnail_url      TEXT,
  warnings           TEXT,
  error              TEXT,
  upstream_task_id   TEXT,
  submitting         INTEGER NOT NULL DEFAULT 0,
  message            TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_status  ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key        TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 防线 5 冷却（S4 使用；此处建表以固定 schema）
CREATE TABLE IF NOT EXISTS cooldowns (
  bucket         TEXT NOT NULL,
  key            TEXT NOT NULL,
  last_submit_at INTEGER NOT NULL,
  PRIMARY KEY (bucket, key)
);

-- 操作日志（V2.1，CONTRACT §10）：开发者排错用的"谁在什么时候做了什么、结果如何"。
-- 与 pino（stdout，给运维）和 tasks（单任务诊断）职责分离，见 routes/logs.ts 的注释。
-- 只增不删（用户可手动删），因此 ts 索引必须存在。
CREATE TABLE IF NOT EXISTS event_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,
  request_id  TEXT,
  ip          TEXT,
  method      TEXT NOT NULL,
  path        TEXT NOT NULL,
  action      TEXT,
  status_code INTEGER,
  duration_ms INTEGER,
  task_id     TEXT,
  provider    TEXT,
  error_code  TEXT,
  disposition TEXT,
  user_agent  TEXT,
  body        TEXT,
  detail      TEXT
);
CREATE INDEX IF NOT EXISTS idx_event_log_ts     ON event_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_event_log_ip     ON event_log(ip);
CREATE INDEX IF NOT EXISTS idx_event_log_action ON event_log(action);
`;

/** 默认库路径：`<repo>/data/app.db`（可用 `DATA_DIR` 覆盖；`DATA_DIR=:memory:` 走内存库，测试用） */
export function resolveDatabasePath(): string {
  const override = process.env.DATA_DIR;
  if (typeof override === 'string' && override.trim() === ':memory:') {
    return ':memory:';
  }
  const base =
    typeof override === 'string' && override.trim() !== ''
      ? override.trim()
      : path.join(process.cwd(), 'data');
  return path.join(base, 'app.db');
}

/**
 * 增量列迁移（V1.9）。
 *
 * 为什么需要它：`CREATE TABLE IF NOT EXISTS` 对**已存在**的库**不会**补列 ——
 * 线上 `data/app.db` 是 V1.8 建的，直接升级代码会得到「no such column: thumbnail_url」。
 * 因此新列必须走 `ALTER TABLE`，且以 `pragma table_info` 判存在（幂等，可反复跑）。
 *
 * 约定：**只加列、不删改**；每条迁移写成一行的原因，方便日后回看"这列为什么存在"。
 */
const COLUMN_MIGRATIONS: ReadonlyArray<{ table: string; column: string; ddl: string }> = [
  // V1.9：成片首帧缩略图（画廊不再挂 50 个 <video>）
  { table: 'tasks', column: 'thumbnail_url', ddl: 'TEXT' },
];

function applyColumnMigrations(db: Db): void {
  for (const migration of COLUMN_MIGRATIONS) {
    const columns = db.pragma(`table_info(${migration.table})`) as Array<{ name: string }>;
    if (columns.some((column) => column.name === migration.column)) continue;
    db.exec(`ALTER TABLE ${migration.table} ADD COLUMN ${migration.column} ${migration.ddl}`);
  }
}

export function openDatabase(filePath: string = resolveDatabasePath()): Db {
  if (filePath !== ':memory:') {
    mkdirSync(path.dirname(filePath), { recursive: true });
  }

  const db = new Database(filePath);
  // WAL：读写并发更友好，且崩溃后可恢复
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  applyColumnMigrations(db);
  return db;
}
