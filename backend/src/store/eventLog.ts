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
}
