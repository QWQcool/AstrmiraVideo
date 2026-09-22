import type { TaskError, TaskProgress, VideoGenerateRequest } from '@astrmira/shared';
import type { Db } from './db.js';

/**
 * 任务存储（CONTRACT §7）：任务状态 + 参数快照 + `warnings[]` + `submitting` 标记 + 幂等键映射。
 * 「中间帧」不入库（成片落盘、临时目录合成结束即删，见 pipeline/cleanup.ts）。
 */

export type TrackId = 'cloud' | 'local';

export interface TaskRecord {
  taskId: string;
  track: TrackId;
  provider: string;
  status: TaskProgress['status'];
  progressPercent: number;
  requestSnapshot: VideoGenerateRequest;
  outputVideoUrl?: string;
  warnings: string[];
  error?: TaskError;
  upstreamTaskId?: string;
  /** 「即将提交」标记（CONTRACT §5）：提交前落库，成功后写回 upstreamTaskId */
  submitting: boolean;
  message?: string;
  createdAt: number;
  updatedAt: number;
}

interface TaskRow {
  task_id: string;
  track: string;
  provider: string;
  status: string;
  progress_percent: number;
  request_snapshot: string;
  output_video_url: string | null;
  warnings: string | null;
  error: string | null;
  upstream_task_id: string | null;
  submitting: number;
  message: string | null;
  created_at: number;
  updated_at: number;
}

function rowToRecord(row: TaskRow): TaskRecord {
  return {
    taskId: row.task_id,
    track: row.track as TrackId,
    provider: row.provider,
    status: row.status as TaskProgress['status'],
    progressPercent: row.progress_percent,
    requestSnapshot: JSON.parse(row.request_snapshot) as VideoGenerateRequest,
    outputVideoUrl: row.output_video_url ?? undefined,
    warnings: row.warnings === null ? [] : (JSON.parse(row.warnings) as string[]),
    error: row.error === null ? undefined : (JSON.parse(row.error) as TaskError),
    upstreamTaskId: row.upstream_task_id ?? undefined,
    submitting: row.submitting === 1,
    message: row.message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 记录 → 契约响应形状（CONTRACT §4 `TaskProgress`） */
export function toTaskProgress(record: TaskRecord): TaskProgress {
  return {
    taskId: record.taskId,
    status: record.status,
    progressPercent: record.progressPercent,
    requestSnapshot: record.requestSnapshot,
    ...(record.outputVideoUrl === undefined ? {} : { outputVideoUrl: record.outputVideoUrl }),
    ...(record.warnings.length === 0 ? {} : { warnings: record.warnings }),
    ...(record.error === undefined ? {} : { error: record.error }),
    ...(record.message === undefined ? {} : { message: record.message }),
  };
}

export class TaskStore {
  constructor(private readonly db: Db) {}

  insert(record: Omit<TaskRecord, 'createdAt' | 'updatedAt'> & { createdAt?: number }): TaskRecord {
    const now = record.createdAt ?? Date.now();
    this.db
      .prepare(
        `INSERT INTO tasks (task_id, track, provider, status, progress_percent, request_snapshot,
                            output_video_url, warnings, error, upstream_task_id, submitting, message,
                            created_at, updated_at)
         VALUES (@taskId, @track, @provider, @status, @progressPercent, @requestSnapshot,
                 @outputVideoUrl, @warnings, @error, @upstreamTaskId, @submitting, @message,
                 @createdAt, @updatedAt)`,
      )
      .run({
        taskId: record.taskId,
        track: record.track,
        provider: record.provider,
        status: record.status,
        progressPercent: record.progressPercent,
        requestSnapshot: JSON.stringify(record.requestSnapshot),
        outputVideoUrl: record.outputVideoUrl ?? null,
        warnings: JSON.stringify(record.warnings),
        error: record.error === undefined ? null : JSON.stringify(record.error),
        upstreamTaskId: record.upstreamTaskId ?? null,
        submitting: record.submitting ? 1 : 0,
        message: record.message ?? null,
        createdAt: now,
        updatedAt: now,
      });

    return this.get(record.taskId) as TaskRecord;
  }

  get(taskId: string): TaskRecord | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId) as
      | TaskRow
      | undefined;
    return row === undefined ? null : rowToRecord(row);
  }

  update(taskId: string, patch: Partial<Omit<TaskRecord, 'taskId'>>): void {
    const current = this.get(taskId);
    if (current === null) throw new Error(`任务不存在：${taskId}`);

    const next: TaskRecord = { ...current, ...patch, taskId };
    this.db
      .prepare(
        `UPDATE tasks SET track = @track, provider = @provider, status = @status,
                          progress_percent = @progressPercent, request_snapshot = @requestSnapshot,
                          output_video_url = @outputVideoUrl, warnings = @warnings, error = @error,
                          upstream_task_id = @upstreamTaskId, submitting = @submitting,
                          message = @message, updated_at = @updatedAt
         WHERE task_id = @taskId`,
      )
      .run({
        taskId: next.taskId,
        track: next.track,
        provider: next.provider,
        status: next.status,
        progressPercent: next.progressPercent,
        requestSnapshot: JSON.stringify(next.requestSnapshot),
        outputVideoUrl: next.outputVideoUrl ?? null,
        warnings: JSON.stringify(next.warnings),
        error: next.error === undefined ? null : JSON.stringify(next.error),
        upstreamTaskId: next.upstreamTaskId ?? null,
        submitting: next.submitting ? 1 : 0,
        message: next.message ?? null,
        updatedAt: Date.now(),
      });
  }

  /** 历史画廊：最近 N 条（含参数快照，供一键回填） */
  listRecent(limit = 50): TaskRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?')
      .all(limit) as TaskRow[];
    return rows.map(rowToRecord);
  }

  delete(taskId: string): boolean {
    const result = this.db.prepare('DELETE FROM tasks WHERE task_id = ?').run(taskId);
    return result.changes > 0;
  }

  /** 幂等键 → taskId（同一键重复提交必须返回同一任务，且不再触达上游） */
  findTaskIdByIdempotencyKey(key: string): string | null {
    const row = this.db.prepare('SELECT task_id FROM idempotency_keys WHERE key = ?').get(key) as
      | { task_id: string }
      | undefined;
    return row?.task_id ?? null;
  }

  putIdempotencyKey(key: string, taskId: string): void {
    this.db
      .prepare(
        'INSERT INTO idempotency_keys (key, task_id, created_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING',
      )
      .run(key, taskId, Date.now());
  }

  /** 原子领取：把一条 queued 任务置为 running 并返回（SQLite 事务保证只有一个领取者） */
  claimOne(track: TrackId): TaskRecord | null {
    const claim = this.db.transaction((): TaskRow | undefined => {
      const row = this.db
        .prepare(
          // 防线 7：带 uncertain / terminal 标记的任务不得进入任何自动领取路径
          `SELECT * FROM tasks
            WHERE track = ? AND status = 'queued'
              AND (error IS NULL OR json_extract(error, '$.disposition') = 'retryable')
            ORDER BY created_at ASC LIMIT 1`,
        )
        .get(track) as TaskRow | undefined;

      if (row === undefined) return undefined;

      this.db
        .prepare("UPDATE tasks SET status = 'running', updated_at = ? WHERE task_id = ? AND status = 'queued'")
        .run(Date.now(), row.task_id);

      return row;
    });

    const row = claim();
    return row === undefined ? null : rowToRecord(row);
  }

  /**
   * 按状态列出任务 —— 启动调解（`store/reconciliation.ts`）用它找回"进程崩了就遗留"的
   * `running` 孤儿。刻意不提供通用的任意查询：多一个入口就多一份被误用的机会。
   */
  listByStatus(status: TaskProgress['status'], limit = 500): TaskRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at ASC LIMIT ?')
      .all(status, limit) as TaskRow[];
    return rows.map(rowToRecord);
  }

  /** 某轨当前 running 数量（防线 1：local 轨必须恒 ≤ 1） */
  countRunning(track: TrackId): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS c FROM tasks WHERE track = ? AND status = 'running'")
      .get(track) as { c: number };
    return row.c;
  }

  /**
   * 除 `exceptTaskId` 之外，还有多少任务引用了这个参考资产？（V8.3 批次 3）
   *
   * 为什么需要它：参数一键回填会让**同一个 assetId 被多条任务复用**，
   * 删一条任务就把资产删掉会顺手毁掉另一条任务的参考图。
   * 判据用 `request_snapshot` 的全文 LIKE（快照是 JSON，assetId 一定以字符串出现），
   * 足够精确，且不用为此加索引/关联表。
   */
  countTasksReferencingAsset(assetId: string, exceptTaskId: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS c FROM tasks WHERE task_id != ? AND request_snapshot LIKE ?",
      )
      .get(exceptTaskId, `%${assetId}%`) as { c: number };
    return row.c;
  }
}
