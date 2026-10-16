import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DEFAULT_PROJECT_ID } from '@astrmira/shared';

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
  output_image_url   TEXT,
  thumbnail_url      TEXT,
  warnings           TEXT,
  error              TEXT,
  upstream_task_id   TEXT,
  submitting         INTEGER NOT NULL DEFAULT 0,
  message            TEXT,
  -- V2.5（B34 · P4）：多轨剪辑产物（浏览器端渲染入库）——JSON { sourceTaskId, project }
  edit_origin        TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_status  ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);

-- 项目维度（V2.11 / 台账 B47）：任务与资产都归属一个项目。
-- 默认项目（id = 'default'）由 bootstrapProjects 保证存在 —— 它是老数据的归属，
-- 也是"调用方没传 projectId"时的落点（见 CONTRACT §12）。
CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Webhook 订阅（V2.15 / 台账 B51，契约 §15）：客户系统的终态回调。
-- secret **落库**（服务端要它签 HMAC），但**永不回读** —— 对外只有掩码，明文只在创建响应里出现一次。
-- （注意：这段是模板字符串，注释里不能出现反引号 —— 会提前结束 SCHEMA。）
CREATE TABLE IF NOT EXISTS webhooks (
  webhook_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  url        TEXT NOT NULL,
  secret     TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  events     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 投递流水（既是重试状态，也是"客户有没有收到"的唯一证据）：
-- 一条 (webhook, task, event) 只允许一条 —— 幂等靠唯一索引 + 扫描时的 NOT EXISTS。
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  delivery_id      TEXT PRIMARY KEY,
  webhook_id       TEXT NOT NULL,
  task_id          TEXT NOT NULL,
  event            TEXT NOT NULL,
  status           TEXT NOT NULL,
  attempts         INTEGER NOT NULL DEFAULT 0,
  last_status_code INTEGER,
  last_error       TEXT,
  next_attempt_at  INTEGER,
  delivered_at     INTEGER,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

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
  // V2.40：图片产物的地址（`t2i` 任务；与 output_video_url **至多有一个**）
  { table: 'tasks', column: 'output_image_url', ddl: 'TEXT' },
  // V9 · B9（CONTRACT §11-2）：剪辑任务的 EDL（JSON）——
  // 它同时是"这条任务是不是剪辑产物"的判据（有值 = `origin.kind='edit'`，见 toTaskProgress）
  { table: 'tasks', column: 'edit_script', ddl: 'TEXT' },
  // V9 · B9：抽帧落下的参考资产 id（JSON 数组），供画廊/详情展示与 D38 闭环复用
  { table: 'tasks', column: 'extracted_asset_ids', ddl: 'TEXT' },
  // V2.5（B34 · P4）：多轨工程产物（CONTRACT §11-2）——JSON { sourceTaskId, project }。
  // 与 edit_script 并列：旧记录用 script、新记录用 project，二者都是"这条是剪辑产物"的判据。
  { table: 'tasks', column: 'edit_origin', ddl: 'TEXT' },
  // V2.11（台账 B47）：任务归属的项目。NULL = V2.11 之前建的行 → 启动时回填成默认项目
  // （`bootstrapProjects`）。回填而不是"查询时用 coalesce"：让按项目过滤能吃到索引。
  { table: 'tasks', column: 'project_id', ddl: 'TEXT' },
  // V2.12（台账 B48）：成本记录。金额与来源单独成列（SQL 才能按项目 / 按天 SUM），
  // 依据（算式 / 单价 / token 量）进 cost_detail（JSON）。NULL = 未结算（V2.12 之前的老任务）。
  { table: 'tasks', column: 'cost_yuan', ddl: 'REAL' },
  { table: 'tasks', column: 'cost_source', ddl: 'TEXT' },
  { table: 'tasks', column: 'cost_detail', ddl: 'TEXT' },
  // V2.27（台账 A1 片 A / B11）：任务**实际在哪台机器上跑的**（cloud / host-local / client-worker）。
  // NULL = V2.27 之前的老任务 —— 界面遇到 NULL **不猜**（不按 provider 反推历史事实）。
  { table: 'tasks', column: 'executed_by', ddl: 'TEXT' },
];

function applyColumnMigrations(db: Db): void {
  for (const migration of COLUMN_MIGRATIONS) {
    const columns = db.pragma(`table_info(${migration.table})`) as Array<{ name: string }>;
    if (columns.some((column) => column.name === migration.column)) continue;
    db.exec(`ALTER TABLE ${migration.table} ADD COLUMN ${migration.column} ${migration.ddl}`);
  }
}

/**
 * 迁移之后才能建的索引（V2.11）。
 *
 * 为什么不能写进 `SCHEMA`：`SCHEMA` 在 `applyColumnMigrations` **之前**执行 ——
 * 线上老库此时还没有 `project_id` 列，`CREATE INDEX ... (project_id)` 会直接报
 * 「no such column」（这正是"改表必须走 ALTER"那条经验的下半句）。
 */
const POST_MIGRATION_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, created_at DESC);
-- V2.12（B48）：成本汇总按时间区间扫，走这条（cost_yuan 为 NULL 的行不参与 SUM）
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);
-- V2.15（B51）：投递流水去重（(webhook, task, event) 唯一）与"到期该投的"扫描
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_deliveries_unique
  ON webhook_deliveries(webhook_id, task_id, event);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due
  ON webhook_deliveries(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_webhooks_project
  ON webhooks(project_id, enabled);
`;

/**
 * 项目维度的**启动引导**（V2.11 / 台账 B47）——幂等，可反复跑：
 * 1. 保证默认项目存在（老数据与"未指定项目"的落点）；
 * 2. 把 V2.11 之前建的、`project_id` 为空的任务**回填**成默认项目。
 *
 * 为什么不静默留着 NULL：留着的话每个查询都要写 `coalesce(project_id,'default')`
 * （索引失效、且"缺失"就有两种写法），回填一次让**模型里只有一个真相**。
 */
function bootstrapProjects(db: Db): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO projects (project_id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id) DO NOTHING`,
  ).run(DEFAULT_PROJECT_ID, '默认项目', now, now);

  db.prepare(
    `UPDATE tasks SET project_id = ? WHERE project_id IS NULL OR project_id = ''`,
  ).run(DEFAULT_PROJECT_ID);
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
  db.exec(POST_MIGRATION_INDEXES);
  bootstrapProjects(db);
  return db;
}
