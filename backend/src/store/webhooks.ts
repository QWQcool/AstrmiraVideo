import { randomUUID } from 'node:crypto';
import {
  WEBHOOK_DELIVERY_MAX_ATTEMPTS,
  WEBHOOK_EVENT_TASK_TERMINAL,
  type WebhookDeliveryStatus,
  type WebhookEvent,
} from '@astrmira/shared';
import type { Db } from './db.js';

/**
 * Webhook 订阅与投递流水的存储（V2.15 / 台账 B51，契约 §15）。
 *
 * ## 两个设计决定
 * 1. **不做内联触发，只做扫描补投**（`enqueueMissing`）：
 *    终态写入点有三处（调度器成功 / 失败、剪辑入库直插），内联触发就得改三处、还漏掉
 *    "任务终态时进程正好重启"这种情形；扫描版只有**一处**，且天然覆盖重启与崩溃补投。
 *    代价 = 最多一个扫描间隔的延迟（默认 2s），而回调本来就是异步语义。
 * 2. **幂等靠唯一索引**（`(webhook_id, task_id, event)`）+ `INSERT OR IGNORE`：
 *    重复扫描不会重复投递，也不需要"先查再插"的竞态处理。
 */

export interface WebhookRecord {
  webhookId: string;
  projectId: string;
  url: string;
  secret: string;
  enabled: boolean;
  events: WebhookEvent[];
  createdAt: number;
  updatedAt: number;
}

export interface WebhookDeliveryRecord {
  deliveryId: string;
  webhookId: string;
  taskId: string;
  event: WebhookEvent;
  status: WebhookDeliveryStatus;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  nextAttemptAt: number | null;
  deliveredAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface WebhookRow {
  webhook_id: string;
  project_id: string;
  url: string;
  secret: string;
  enabled: number;
  events: string;
  created_at: number;
  updated_at: number;
}

interface DeliveryRow {
  delivery_id: string;
  webhook_id: string;
  task_id: string;
  event: string;
  status: string;
  attempts: number;
  last_status_code: number | null;
  last_error: string | null;
  next_attempt_at: number | null;
  delivered_at: number | null;
  created_at: number;
  updated_at: number;
}

function parseEvents(raw: string): WebhookEvent[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is WebhookEvent => typeof item === 'string');
  } catch {
    // 存储层被手改过也不许把整个列表接口带崩：如实退回空数组（→ 该订阅不会收到任何事件）
    return [];
  }
}

function rowToRecord(row: WebhookRow): WebhookRecord {
  return {
    webhookId: row.webhook_id,
    projectId: row.project_id,
    url: row.url,
    secret: row.secret,
    enabled: row.enabled === 1,
    events: parseEvents(row.events),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function deliveryRowToRecord(row: DeliveryRow): WebhookDeliveryRecord {
  return {
    deliveryId: row.delivery_id,
    webhookId: row.webhook_id,
    taskId: row.task_id,
    event: row.event as WebhookEvent,
    status: row.status as WebhookDeliveryStatus,
    attempts: row.attempts,
    lastStatusCode: row.last_status_code,
    lastError: row.last_error,
    nextAttemptAt: row.next_attempt_at,
    deliveredAt: row.delivered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class WebhookStore {
  constructor(private readonly db: Db) {}

  listByProject(projectId: string): WebhookRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM webhooks WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId) as WebhookRow[];
    return rows.map(rowToRecord);
  }

  get(webhookId: string): WebhookRecord | null {
    const row = this.db.prepare('SELECT * FROM webhooks WHERE webhook_id = ?').get(webhookId) as
      | WebhookRow
      | undefined;
    return row === undefined ? null : rowToRecord(row);
  }

  create(input: {
    projectId: string;
    url: string;
    secret: string;
    events: WebhookEvent[];
  }): WebhookRecord {
    const webhookId = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO webhooks (webhook_id, project_id, url, secret, enabled, events, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .run(webhookId, input.projectId, input.url, input.secret, JSON.stringify(input.events), now, now);
    return this.get(webhookId) as WebhookRecord;
  }

  /** 改 url / 启停；返回 false = 不存在（路由层转 `WEBHOOK_NOT_FOUND`） */
  update(webhookId: string, patch: { url?: string; enabled?: boolean }): boolean {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.url !== undefined) {
      sets.push('url = ?');
      params.push(patch.url);
    }
    if (patch.enabled !== undefined) {
      sets.push('enabled = ?');
      params.push(patch.enabled ? 1 : 0);
    }
    sets.push('updated_at = ?');
    params.push(Date.now(), webhookId);
    const result = this.db
      .prepare(`UPDATE webhooks SET ${sets.join(', ')} WHERE webhook_id = ?`)
      .run(...params);
    return result.changes > 0;
  }

  /**
   * 删除订阅：**连带删掉它的投递流水**（与"资产 + sidecar 同生共死"同一条纪律 ——
   * 留着一堆指向已删订阅的流水，只会让人以为"还有回调在跑"）。
   */
  remove(webhookId: string): boolean {
    const exists = this.get(webhookId) !== null;
    if (!exists) return false;
    this.db.prepare('DELETE FROM webhook_deliveries WHERE webhook_id = ?').run(webhookId);
    this.db.prepare('DELETE FROM webhooks WHERE webhook_id = ?').run(webhookId);
    return true;
  }

  listDeliveries(webhookId: string, limit = 50): WebhookDeliveryRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM webhook_deliveries WHERE webhook_id = ?
          ORDER BY created_at DESC LIMIT ?`,
      )
      .all(webhookId, limit) as DeliveryRow[];
    return rows.map(deliveryRowToRecord);
  }

  /**
   * 扫描补投：把"已终态、但该订阅还没有投递记录"的任务**补**成 pending 投递。
   * 返回本次新建的条数（0 = 没有新东西，扫描循环据此保持安静）。
   *
   * ⚠️ **两条时间约束，各有各的理由**：
   * - `t.created_at >= w.created_at`：**订阅从创建那一刻起生效**（forward-only）。
   *   没有这条，客户一接入就会立刻收到最近 7 天所有终态任务的**事件洪峰** —— 那不是"欢迎"，是骚扰；
   *   想看历史请走 `GET /api/history`（它本来就是为这个准备的）。
   * - `t.created_at >= now - lookbackMs`：兜底窗口。扫描重启后要能补上"进程不在时到终态"的任务，
   *   但**不做全历史补投**（那是数据迁移，不是回调）。
   */
  enqueueMissing(options: {
    now: number;
    lookbackMs: number;
    batch: number;
    event?: WebhookEvent;
  }): number {
    const event = options.event ?? WEBHOOK_EVENT_TASK_TERMINAL;
    const candidates = this.db
      .prepare(
        `SELECT w.webhook_id AS webhookId, t.task_id AS taskId
           FROM tasks t
           JOIN webhooks w ON w.project_id = t.project_id AND w.enabled = 1
          WHERE t.status IN ('succeeded', 'failed', 'cancelled')
            AND t.created_at >= w.created_at
            AND t.created_at >= ?
            AND NOT EXISTS (
                  SELECT 1 FROM webhook_deliveries d
                   WHERE d.webhook_id = w.webhook_id AND d.task_id = t.task_id AND d.event = ?
                )
          ORDER BY t.created_at DESC
          LIMIT ?`,
      )
      .all(options.now - options.lookbackMs, event, options.batch) as Array<{
      webhookId: string;
      taskId: string;
    }>;

    // 逐条 `INSERT OR IGNORE`（而不是一条 INSERT...SELECT 塞多条）：要拿到"真正新增了几条"这个数，
    // 而 INSERT OR IGNORE 的 `changes` 会如实告诉我们是插入还是被忽略 —— 逐条 run 能精确计数。
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO webhook_deliveries
         (delivery_id, webhook_id, task_id, event, status, attempts, next_attempt_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
    );
    let created = 0;
    for (const candidate of candidates) {
      const result = insert.run(
        randomUUID(),
        candidate.webhookId,
        candidate.taskId,
        event,
        options.now,
        options.now,
        options.now,
      );
      created += result.changes;
    }
    return created;
  }

  /** 到期该投的批次（pending 且 next_attempt_at <= now） */
  listDue(now: number, limit: number): WebhookDeliveryRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM webhook_deliveries
          WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
          ORDER BY next_attempt_at ASC, created_at ASC
          LIMIT ?`,
      )
      .all(now, limit) as DeliveryRow[];
    return rows.map(deliveryRowToRecord);
  }

  markDelivered(deliveryId: string, statusCode: number, deliverableNow: number): void {
    this.db
      .prepare(
        `UPDATE webhook_deliveries
            SET status = 'delivered', attempts = attempts + 1, last_status_code = ?,
                last_error = NULL, next_attempt_at = NULL, delivered_at = ?, updated_at = ?
          WHERE delivery_id = ?`,
      )
      .run(statusCode, deliverableNow, deliverableNow, deliveryId);
  }

  /**
   * 记一次失败：次数用尽 → `failed`（不再重试）；否则排下一次（退避由调用方给）。
   * **不抛**：投递失败是常态（客户系统会宕机），它只该留痕。
   */
  markAttemptFailed(input: {
    deliveryId: string;
    statusCode: number | null;
    error: string;
    now: number;
    nextAttemptAt: number | null;
  }): void {
    const status = input.nextAttemptAt === null ? 'failed' : 'pending';
    this.db
      .prepare(
        `UPDATE webhook_deliveries
            SET status = ?, attempts = attempts + 1, last_status_code = ?, last_error = ?,
                next_attempt_at = ?, updated_at = ?
          WHERE delivery_id = ?`,
      )
      .run(
        status,
        input.statusCode,
        input.error.slice(0, 500),
        input.nextAttemptAt,
        input.now,
        input.deliveryId,
      );
  }

  /** 某订阅的投递统计（界面/排错用）：只按状态计数，不返回明细 */
  countDeliveries(webhookId: string): Record<WebhookDeliveryStatus, number> {
    const rows = this.db
      .prepare('SELECT status, COUNT(*) AS count FROM webhook_deliveries WHERE webhook_id = ? GROUP BY status')
      .all(webhookId) as Array<{ status: string; count: number }>;
    const result: Record<WebhookDeliveryStatus, number> = { pending: 0, delivered: 0, failed: 0 };
    for (const row of rows) {
      if (row.status === 'pending' || row.status === 'delivered' || row.status === 'failed') {
        result[row.status] = row.count;
      }
    }
    return result;
  }

  /** 上限（供测试与文档引用；避免各处硬编码 3） */
  static maxAttempts(): number {
    return WEBHOOK_DELIVERY_MAX_ATTEMPTS;
  }
}
