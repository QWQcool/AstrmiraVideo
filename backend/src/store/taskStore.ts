import type {
  EditProject,
  EditScript,
  TaskError,
  TaskProgress,
  VideoGenerateRequest,
} from '@astrmira/shared';
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
  /** V1.9：成片首帧缩略图（同源 `/media/thumbs/<taskId>.jpg`）；抽帧失败时缺省 */
  thumbnailUrl?: string;
  warnings: string[];
  error?: TaskError;
  upstreamTaskId?: string;
  /** 「即将提交」标记（CONTRACT §5）：提交前落库，成功后写回 upstreamTaskId */
  submitting: boolean;
  message?: string;
  /**
   * V9 · B9（CONTRACT §11-2）：剪辑任务的 EDL（**旧**——B34 改版前的基础剪辑）。
   * **有值 = 这条任务由剪辑产生**（`TaskProgress.origin.kind === 'edit'` 由它派生）——
   * 一列两用，避免再加一个"是不是剪辑产物"的布尔列而两者可能不同步。
   */
  editScript?: EditScript;
  /**
   * V2.5（B34 · P4）：多轨工程产物（**新**——浏览器端渲染后入库）。
   * 与 `editScript` 并列、**互斥**：旧记录用 script、新记录用 project，
   * 两者都是"这是剪辑产物"的判据（`origin.kind === 'edit'`）。
   */
  editOrigin?: { sourceTaskId: string; project: EditProject };
  /** 抽帧产物的资产 id（可能多个） */
  extractedAssetIds?: string[];
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
  thumbnail_url: string | null;
  warnings: string | null;
  error: string | null;
  upstream_task_id: string | null;
  submitting: number;
  message: string | null;
  edit_script: string | null;
  edit_origin: string | null;
  extracted_asset_ids: string | null;
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
    thumbnailUrl: row.thumbnail_url ?? undefined,
    warnings: row.warnings === null ? [] : (JSON.parse(row.warnings) as string[]),
    error: row.error === null ? undefined : (JSON.parse(row.error) as TaskError),
    upstreamTaskId: row.upstream_task_id ?? undefined,
    submitting: row.submitting === 1,
    message: row.message ?? undefined,
    ...(row.edit_script === null ? {} : { editScript: JSON.parse(row.edit_script) as EditScript }),
    ...(row.edit_origin === null
      ? {}
      : { editOrigin: JSON.parse(row.edit_origin) as { sourceTaskId: string; project: EditProject } }),
    ...(row.extracted_asset_ids === null
      ? {}
      : { extractedAssetIds: JSON.parse(row.extracted_asset_ids) as string[] }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 剪辑来源 → `TaskProgress.origin`（两代互斥；都没有就是生成产物，返回空对象由调用方展开）。
 * 抽成独立函数是为了让"两种剪辑记录都能正确读"这件事只有一处实现。
 */
function originOf(record: TaskRecord): { origin?: TaskProgress['origin'] } {
  if (record.editOrigin !== undefined) {
    return {
      origin: {
        kind: 'edit',
        sourceTaskId: record.editOrigin.sourceTaskId,
        project: record.editOrigin.project,
      },
    };
  }
  if (record.editScript !== undefined) {
    return {
      origin: {
        kind: 'edit',
        sourceTaskId: record.editScript.sourceTaskId,
        script: record.editScript,
      },
    };
  }
  return {};
}

/** 记录 → 契约响应形状（CONTRACT §4 `TaskProgress`） */
export function toTaskProgress(record: TaskRecord): TaskProgress {
  return {
    taskId: record.taskId,
    status: record.status,
    progressPercent: record.progressPercent,
    requestSnapshot: record.requestSnapshot,
    ...(record.outputVideoUrl === undefined ? {} : { outputVideoUrl: record.outputVideoUrl }),
    ...(record.thumbnailUrl === undefined ? {} : { thumbnailUrl: record.thumbnailUrl }),
    ...(record.warnings.length === 0 ? {} : { warnings: record.warnings }),
    ...(record.error === undefined ? {} : { error: record.error }),
    ...(record.message === undefined ? {} : { message: record.message }),
    // CONTRACT §11-2：剪辑产物 —— 两代来源都派生 `origin`（缺省即"生成产物"）：
    // - 旧（B9）：`edit_script` 列 → origin.script
    // - 新（V2.5）：`edit_origin` 列 → origin.project（浏览器端渲染入库，见 routes/editRenders.ts）
    ...originOf(record),
    ...(record.extractedAssetIds === undefined
      ? {}
      : { extractedAssetIds: record.extractedAssetIds }),
    // V2.3：任务创建时间（`tasks.created_at` 列本就存在且有索引，零迁移）。
    // 总览"今日生成"与视频库"按时间排序"的数据源。
    createdAt: record.createdAt,
    // 注：`outputSizeBytes` **不在这里**填 —— 它要 stat 落盘文件（IO），
    // 由路由层的 `withOutputSize` 补（见 routes/history.ts），本函数保持纯映射。
  };
}

export class TaskStore {
  constructor(private readonly db: Db) {}

  insert(record: Omit<TaskRecord, 'createdAt' | 'updatedAt'> & { createdAt?: number }): TaskRecord {
    const now = record.createdAt ?? Date.now();
    this.db
      .prepare(
        `INSERT INTO tasks (task_id, track, provider, status, progress_percent, request_snapshot,
                            output_video_url, thumbnail_url, warnings, error, upstream_task_id,
                            submitting, message, edit_script, edit_origin, extracted_asset_ids,
                            created_at, updated_at)
         VALUES (@taskId, @track, @provider, @status, @progressPercent, @requestSnapshot,
                 @outputVideoUrl, @thumbnailUrl, @warnings, @error, @upstreamTaskId, @submitting,
                 @message, @editScript, @editOrigin, @extractedAssetIds, @createdAt, @updatedAt)`,
      )
      .run({
        taskId: record.taskId,
        track: record.track,
        provider: record.provider,
        status: record.status,
        progressPercent: record.progressPercent,
        requestSnapshot: JSON.stringify(record.requestSnapshot),
        outputVideoUrl: record.outputVideoUrl ?? null,
        thumbnailUrl: record.thumbnailUrl ?? null,
        warnings: JSON.stringify(record.warnings),
        error: record.error === undefined ? null : JSON.stringify(record.error),
        upstreamTaskId: record.upstreamTaskId ?? null,
        submitting: record.submitting ? 1 : 0,
        message: record.message ?? null,
        editScript: record.editScript === undefined ? null : JSON.stringify(record.editScript),
        editOrigin: record.editOrigin === undefined ? null : JSON.stringify(record.editOrigin),
        extractedAssetIds:
          record.extractedAssetIds === undefined ? null : JSON.stringify(record.extractedAssetIds),
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
                         output_video_url = @outputVideoUrl, thumbnail_url = @thumbnailUrl,
                         warnings = @warnings, error = @error,
                         upstream_task_id = @upstreamTaskId, submitting = @submitting,
                         message = @message,
                         edit_script = @editScript, edit_origin = @editOrigin,
                         extracted_asset_ids = @extractedAssetIds,
                         updated_at = @updatedAt
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
        thumbnailUrl: next.thumbnailUrl ?? null,
        warnings: JSON.stringify(next.warnings),
        error: next.error === undefined ? null : JSON.stringify(next.error),
        upstreamTaskId: next.upstreamTaskId ?? null,
        submitting: next.submitting ? 1 : 0,
        message: next.message ?? null,
        editScript: next.editScript === undefined ? null : JSON.stringify(next.editScript),
        editOrigin: next.editOrigin === undefined ? null : JSON.stringify(next.editOrigin),
        extractedAssetIds:
          next.extractedAssetIds === undefined ? null : JSON.stringify(next.extractedAssetIds),
        updatedAt: Date.now(),
      });
  }

  /**
   * 历史画廊：最近 N 条（含参数快照，供一键回填）。
   *
   * V9 修复（用户 2026-09-24 拍板）：**剪辑产物默认不进历史成片** —— 它们复用源片的
   * requestSnapshot（提示词与源片相同），混在画廊里看起来像"重复记录"。
   *
   * - 默认（无 filter）：只返回**生成产物**（既无 EDL 也无工程）；
   * - `filter = { kind: 'edit', sourceTaskId }`：返回某源片的剪辑产物（剪辑台的
   *   「本片剪辑历史」用它 —— 剪辑产物仍然可查可删，只是不混在生成历史里）；
   * - `filter = { kind: 'edit' }`（V2.6 / B37：`sourceTaskId` 可选）：返回**全部**剪辑产物
   *   （剪辑台素材候选与 L2 血缘画布用）。
   *
   * V2.5：剪辑产物有两代 —— 旧记录 `edit_script`、新记录 `edit_origin`（浏览器端渲染入库），
   * 两条判据都要算（`coalesce` 取 sourceTaskId，两代各自的 JSON 结构不同但字段名一致）。
   */
  listRecent(limit = 50, filter?: { kind: 'edit'; sourceTaskId?: string }): TaskRecord[] {
    if (filter !== undefined) {
      if (filter.sourceTaskId === undefined) {
        const rows = this.db
          .prepare(
            `SELECT * FROM tasks
              WHERE (edit_script IS NOT NULL OR edit_origin IS NOT NULL)
              ORDER BY created_at DESC LIMIT ?`,
          )
          .all(limit) as TaskRow[];
        return rows.map(rowToRecord);
      }
      const rows = this.db
        .prepare(
          `SELECT * FROM tasks
            WHERE (edit_script IS NOT NULL OR edit_origin IS NOT NULL)
              AND coalesce(json_extract(edit_script, '$.sourceTaskId'),
                           json_extract(edit_origin, '$.sourceTaskId')) = ?
            ORDER BY created_at DESC LIMIT ?`,
        )
        .all(filter.sourceTaskId, limit) as TaskRow[];
      return rows.map(rowToRecord);
    }

    const rows = this.db
      .prepare(
        'SELECT * FROM tasks WHERE edit_script IS NULL AND edit_origin IS NULL ORDER BY created_at DESC LIMIT ?',
      )
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
