import type { Db } from './db.js';

/**
 * 操作日志存储（CONTRACT §10，V2.1）。
 *
 * ## 与另外两处的分工（避免"三份日志各说各话"）
 * - pino → stdout → `docker logs`：**运维**视角，技术细节与堆栈；
 * - `tasks` 表：**单任务**视角，进度 / 告警 / 结果（用户能在画廊看到）；
 * - 本表：**操作**视角，"谁、何时、对什么、做了什么、结果如何"，给开发者排错。
 *
 * ## 两条数据纪律
 * 1. **凭据永不入库**：写入前一律过 `security/redact.ts`（调用方负责，见 `server/requestLog.ts`）；
 * 2. **请求体截断入库**：`/api/upload` 这类 multipart 只记摘要，绝不记二进制
 *    （否则一次 20MB 上传就能把 SQLite 撑爆）。
 */

export interface EventLogEntry {
  id: number;
  ts: number;
  requestId?: string;
  ip?: string;
  method: string;
  path: string;
  /** 语义动作（如"提交生成"/"删除历史"）；由路由推导，见 server/requestLog.ts */
  action?: string;
  statusCode?: number;
  durationMs?: number;
  taskId?: string;
  provider?: string;
  errorCode?: string;
  disposition?: string;
  userAgent?: string;
  /** 截断后的请求体（JSON 原文 / multipart 摘要） */
  body?: string;
  /** 白名单诊断字段（上游 request id、模型名、资产 id…），JSON 文本入库 */
  detail?: Record<string, unknown>;
}

export type NewEventLogEntry = Omit<EventLogEntry, 'id'>;

export interface EventLogFilter {
  limit?: number;
  offset?: number;
  ip?: string;
  action?: string;
  errorCode?: string;
  /** 关键词：匹配 path / body / detail / ip */
  q?: string;
  since?: number;
  until?: number;
  /** V2.19（台账 B62）：只取某条任务的留痕（画布节点检查器用） */
  taskId?: string;
}

interface EventLogRow {
  id: number;
  ts: number;
  request_id: string | null;
  ip: string | null;
  method: string;
  path: string;
  action: string | null;
  status_code: number | null;
  duration_ms: number | null;
  task_id: string | null;
  provider: string | null;
  error_code: string | null;
  disposition: string | null;
  user_agent: string | null;
  body: string | null;
  detail: string | null;
}

/** `LIKE` 的通配符必须转义，否则用户搜 `%` 会扫全表、搜 `_` 会误命中 */
function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function rowToEntry(row: EventLogRow): EventLogEntry {
  return {
    id: row.id,
    ts: row.ts,
    ...(row.request_id === null ? {} : { requestId: row.request_id }),
    ...(row.ip === null ? {} : { ip: row.ip }),
    method: row.method,
    path: row.path,
    ...(row.action === null ? {} : { action: row.action }),
    ...(row.status_code === null ? {} : { statusCode: row.status_code }),
    ...(row.duration_ms === null ? {} : { durationMs: row.duration_ms }),
    ...(row.task_id === null ? {} : { taskId: row.task_id }),
    ...(row.provider === null ? {} : { provider: row.provider }),
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    ...(row.disposition === null ? {} : { disposition: row.disposition }),
    ...(row.user_agent === null ? {} : { userAgent: row.user_agent }),
    ...(row.body === null ? {} : { body: row.body }),
    ...(row.detail === null ? {} : { detail: JSON.parse(row.detail) as Record<string, unknown> }),
  };
}

/** 由筛选条件拼出 `WHERE`（list 与 clear 共用，保证"清空"清的就是"你看到的那批"） */
function buildWhere(filter: EventLogFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.ip !== undefined && filter.ip !== '') {
    clauses.push('ip = ?');
    params.push(filter.ip);
  }
  if (filter.action !== undefined && filter.action !== '') {
    clauses.push('action = ?');
    params.push(filter.action);
  }
  if (filter.errorCode !== undefined && filter.errorCode !== '') {
    clauses.push('error_code = ?');
    params.push(filter.errorCode);
  }
  if (filter.since !== undefined) {
    clauses.push('ts >= ?');
    params.push(filter.since);
  }
  if (filter.until !== undefined) {
    clauses.push('ts <= ?');
    params.push(filter.until);
  }
  // V2.19（台账 B62）：按任务 id 过滤 —— 画布节点检查器看"这条任务的全部留痕"
  if (filter.taskId !== undefined && filter.taskId !== '') {
    clauses.push('task_id = ?');
    params.push(filter.taskId);
  }
  if (filter.q !== undefined && filter.q.trim() !== '') {
    const pattern = likePattern(filter.q.trim());
    clauses.push(
      "(path LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\' OR ip LIKE ? ESCAPE '\\' OR action LIKE ? ESCAPE '\\')",
    );
    params.push(pattern, pattern, pattern, pattern, pattern);
  }

  return { sql: clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`, params };
}

export class EventLogStore {
  constructor(private readonly db: Db) {}

  append(entry: NewEventLogEntry): number {
    const result = this.db
      .prepare(
        `INSERT INTO event_log (ts, request_id, ip, method, path, action, status_code, duration_ms,
                               task_id, provider, error_code, disposition, user_agent, body, detail)
         VALUES (@ts, @requestId, @ip, @method, @path, @action, @statusCode, @durationMs,
                 @taskId, @provider, @errorCode, @disposition, @userAgent, @body, @detail)`,
      )
      .run({
        ts: entry.ts,
        requestId: entry.requestId ?? null,
        ip: entry.ip ?? null,
        method: entry.method,
        path: entry.path,
        action: entry.action ?? null,
        statusCode: entry.statusCode ?? null,
        durationMs: entry.durationMs ?? null,
        taskId: entry.taskId ?? null,
        provider: entry.provider ?? null,
        errorCode: entry.errorCode ?? null,
        disposition: entry.disposition ?? null,
        userAgent: entry.userAgent ?? null,
        body: entry.body ?? null,
        detail: entry.detail === undefined ? null : JSON.stringify(entry.detail),
      });

    return Number(result.lastInsertRowid);
  }

  list(filter: EventLogFilter = {}): { items: EventLogEntry[]; total: number } {
    const { sql, params } = buildWhere(filter);
    const total = (
      this.db.prepare(`SELECT COUNT(*) AS count FROM event_log${sql}`).get(...params) as {
        count: number;
      }
    ).count;

    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
    const offset = Math.max(filter.offset ?? 0, 0);
    const rows = this.db
      .prepare(`SELECT * FROM event_log${sql} ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as EventLogRow[];

    return { items: rows.map(rowToEntry), total };
  }

  /** 该条是否属于某个 IP（供前端"按 IP 过滤"一键点选使用，不做权限判定） */
  remove(id: number): number {
    return this.db.prepare('DELETE FROM event_log WHERE id = ?').run(id).changes;
  }

  /** 清空：不带筛选即全清（用户明确要求"可手动删除"）；返回实际删除条数 */
  clear(filter: EventLogFilter = {}): number {
    const { sql, params } = buildWhere(filter);
    return this.db.prepare(`DELETE FROM event_log${sql}`).run(...params).changes;
  }

  countAll(): number {
    return (
      this.db.prepare('SELECT COUNT(*) AS count FROM event_log').get() as { count: number }
    ).count;
  }

  /**
   * 保留策略（V2.18 / 台账 B23；**V2.24 / B73 改为按结果分级**）：**按时间**与**按条数**两条判据，删的都是最旧的。
   *
   * ## 四条口径
   * 1. **只删操作日志** —— 任务表与项目是用户与业务数据，一条都不动
   *    （这是本方法写在 `EventLogStore` 里、而不是写成通用 SQL 的原因）；
   * 2. **时间判据分级**（V2.24）：**异常记录留久、正常记录留短** —— 失败的记录是排错资产、
   *    成功的记录是噪声。两类的条件是**显式且互补**的：异常 = `status_code >= 400` 或带
   *    `disposition` / `error_code`；正常 = 其余（含 `status_code IS NULL`）。
   *    ⚠️ **不能用 `NOT(异常)` 写正常类**：SQL 三值逻辑下 `NOT NULL` 仍是 NULL，会**漏删**那一批行；
   * 3. **条数用"水位"而不是"删到刚好 maxRows"**：删到 `maxRows × ratio` 以下就停。
   *    否则每天跑一次时每来一条新日志就会触发一次删除（读写放大），
   *    而运维真正想要的是"库不要无限长"，不是"永远精确等于 20 万条"；
   *    **条数判据不分类**：防膨胀的硬上限与"哪类记录更值钱"是两个问题；
   * 4. **各判据的删除量分别返回**（时间还拆正常 / 异常两类），**实际删了多少** ——
   *    调用方据此决定要不要留痕与怎么留痕（噪声纪律：没删就不写日志）。
   */
  prune(options: {
    maxAgeDays?: number;
    maxAgeDaysFailed?: number;
    maxRows?: number;
    now?: number;
    ratio?: number;
  }): {
    deleted: number;
    remaining: number;
    deletedByAge: number;
    deletedByAgeNormal: number;
    deletedByAgeFailed: number;
    deletedByCount: number;
  } {
    const now = options.now ?? Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    let deletedByAgeNormal = 0;
    let deletedByAgeFailed = 0;
    let deletedByCount = 0;

    /** 「异常记录」：失败请求，或带处置 / 错误码的（任务终态失败与不确定都落这一类） */
    const ABNORMAL = '(status_code >= 400 OR disposition IS NOT NULL OR error_code IS NOT NULL)';
    /** 「正常记录」：上面那条的**补集**，显式写出（对 NULL 安全） */
    const NORMAL = '(status_code IS NULL OR status_code < 400) AND disposition IS NULL AND error_code IS NULL';

    if (options.maxAgeDaysFailed !== undefined && options.maxAgeDaysFailed > 0) {
      const cutoff = now - options.maxAgeDaysFailed * dayMs;
      deletedByAgeFailed = this.db
        .prepare(`DELETE FROM event_log WHERE ts < ? AND ${ABNORMAL}`)
        .run(cutoff).changes;
    }

    if (options.maxAgeDays !== undefined && options.maxAgeDays > 0) {
      const cutoff = now - options.maxAgeDays * dayMs;
      deletedByAgeNormal = this.db
        .prepare(`DELETE FROM event_log WHERE ts < ? AND ${NORMAL}`)
        .run(cutoff).changes;
    }

    if (options.maxRows !== undefined && options.maxRows > 0) {
      const ratio = options.ratio ?? 0.8;
      const target = Math.floor(options.maxRows * (ratio > 0 && ratio < 1 ? ratio : 0.8));
      const remaining = this.countAll();
      if (remaining > options.maxRows) {
        // 按 id 升序（= 时间顺序）删掉最旧的那些，直到剩余 ≤ 水位线
        const excess = remaining - target;
        deletedByCount = this.db
          .prepare(
            `DELETE FROM event_log WHERE id IN (
               SELECT id FROM event_log ORDER BY id ASC LIMIT ?
             )`,
          )
          .run(excess).changes;
      }
    }

    const deletedByAge = deletedByAgeNormal + deletedByAgeFailed;
    return {
      deleted: deletedByAge + deletedByCount,
      remaining: this.countAll(),
      deletedByAge,
      deletedByAgeNormal,
      deletedByAgeFailed,
      deletedByCount,
    };
  }
}
