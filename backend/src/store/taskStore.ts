import type {
  CostRecord,
  EditProject,
  EditScript,
  ExecutedBy,
  TaskError,
  TaskProgress,
  VideoGenerateRequest,
} from '@astrmira/shared';
import { statSync } from 'node:fs';
import { DEFAULT_PROJECT_ID } from '@astrmira/shared';
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
  /**
   * V2.40：**图片产物的地址**（`t2i` 任务）。
   * 与 `outputVideoUrl` **至多有一个**（写侧保证：provider 按模式只填一个）。
   */
  outputImageUrl?: string;
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
  /**
   * V2.11（台账 B47）：任务归属的项目。
   * 可选是**为了兼容 V2.11 之前建的行**：`rowToRecord` 会把 NULL 读成默认项目，
   * 而 `bootstrapProjects` 在启动时已把老行回填 —— 两条路都指向同一个真相。
   */
  projectId?: string;
  /**
   * V2.27（台账 A1 片 A / B11）：**这条任务实际在哪台机器上跑的**。
   * 可选 = V2.27 之前的老任务（读路径**不猜** —— 不按 provider 反推历史事实）。
   */
  executedBy?: ExecutedBy;
  /**
   * V2.12（台账 B48）：成本记录（预估）。**只有成功任务在终态结算时写入**，
   * 缺省 = 未结算（V2.12 之前的老任务 / 无法估算的任务）。
   */
  cost?: CostRecord;
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
  output_image_url: string | null;
  thumbnail_url: string | null;
  warnings: string | null;
  error: string | null;
  upstream_task_id: string | null;
  submitting: number;
  message: string | null;
  edit_script: string | null;
  edit_origin: string | null;
  extracted_asset_ids: string | null;
  project_id: string | null;
  executed_by: string | null;
  cost_yuan: number | null;
  cost_source: string | null;
  cost_detail: string | null;
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
    outputImageUrl: row.output_image_url ?? undefined,
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
    // V2.11：NULL 读作默认项目（回填之前建的行；回填之后理论上不会再出现 NULL）
    projectId: row.project_id ?? DEFAULT_PROJECT_ID,
    // V2.27（A1 片 A / B11）：NULL = V2.27 之前的老任务 —— **不猜**（不按 provider 反推）
    ...(row.executed_by === null ? {} : { executedBy: row.executed_by as ExecutedBy }),
    // V2.12：成本记录（NULL = 未结算，**不给默认值** —— "花了 0 元"与"不知道花了多少"要分开）。
    // `cost_yuan` / `cost_source` 是给 SQL 聚合用的**冗余列**，真相在 `cost_detail` 的完整 JSON；
    // 万一 detail 损坏，退回到"只有金额与来源"的最小记录（不整条丢掉）。
    ...(row.cost_yuan === null ? {} : { cost: parseCostRow(row) }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 成本汇总的一行（V2.12 / B48；只取聚合需要的列，不拉整条快照） */
export interface CostRow {
  projectId: string;
  /** 有成本记录时是金额；NULL = 未结算（V2.12 之前的老任务） */
  costYuan: number | null;
  createdAt: number;
  /** 请求快照里的模型 id（缺省 = 部署默认档，交给上层显示成"默认档"） */
  modelId: string | null;
}

/**
 * 成本 → SQL 参数（V2.12）。`cost_yuan` / `cost_source` 是**给聚合用的冗余列**
 * （按项目 / 按天 SUM 不必解 JSON），完整记录进 `cost_detail`。
 * 未结算（`undefined`）时三列都写 NULL —— **不写 0**（0 是"本地轨免费"的真实值）。
 */
function costParams(cost: CostRecord | undefined): {
  costYuan: number | null;
  costSource: string | null;
  costDetail: string | null;
} {
  if (cost === undefined) return { costYuan: null, costSource: null, costDetail: null };
  return {
    costYuan: cost.yuan,
    costSource: cost.source,
    costDetail: JSON.stringify(cost),
  };
}

/**
 * 成本行的读取（V2.12）：优先用 `cost_detail` 的完整 JSON；
 * 损坏 / 缺失时退化成"金额 + 来源"的最小记录 —— 金额是 B 端最不能丢的那部分。
 */
function parseCostRow(row: TaskRow): CostRecord {
  const yuan = row.cost_yuan ?? 0;
  const source = (row.cost_source ?? 'estimate') as CostRecord['source'];
  if (row.cost_detail === null) return { yuan, source } as CostRecord;
  try {
    return JSON.parse(row.cost_detail) as CostRecord;
  } catch {
    return { yuan, source } as CostRecord;
  }
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
    // V2.40：图片产物（`t2i`）—— 漏了这一行会让"真机出图成功、接口里却看不到产物地址"
    // （正是本片真机验收抓到的第一个缺陷）
    ...(record.outputImageUrl === undefined ? {} : { outputImageUrl: record.outputImageUrl }),
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
    // V2.12（B48）：成本记录（缺省 = 未结算；界面必须把"未结算"显示出来，否则金额会被误读成全部）
    ...(record.cost === undefined ? {} : { cost: record.cost }),
    // V2.27（A1 片 A / B11）：执行位置（缺省 = V2.27 之前的老任务 —— 界面对缺省**不猜**）
    ...(record.executedBy === undefined ? {} : { executedBy: record.executedBy }),
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
                            output_video_url, output_image_url, thumbnail_url, warnings, error,
                            upstream_task_id,
                            submitting, message, edit_script, edit_origin, extracted_asset_ids,
                            project_id, executed_by, cost_yuan, cost_source, cost_detail,
                            created_at, updated_at)
         VALUES (@taskId, @track, @provider, @status, @progressPercent, @requestSnapshot,
                 @outputVideoUrl, @outputImageUrl, @thumbnailUrl, @warnings, @error, @upstreamTaskId,
                 @submitting,
                 @message, @editScript, @editOrigin, @extractedAssetIds, @projectId, @executedBy,
                 @costYuan, @costSource, @costDetail, @createdAt, @updatedAt)`,
      )
      .run({
        taskId: record.taskId,
        track: record.track,
        provider: record.provider,
        status: record.status,
        progressPercent: record.progressPercent,
        requestSnapshot: JSON.stringify(record.requestSnapshot),
        outputVideoUrl: record.outputVideoUrl ?? null,
        outputImageUrl: record.outputImageUrl ?? null,
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
        // V2.11：入库时缺省即默认项目（调用方不传也不会留下 NULL）
        projectId: record.projectId ?? DEFAULT_PROJECT_ID,
        // V2.27（A1 片 A）：执行位置 —— **调用方（队列）按 provider 判定**；缺省即 NULL（老行为）
        executedBy: record.executedBy ?? null,
        // V2.12：入库时通常还没有成本（结算在终态），但接口保持一致（可写入已算好的成本）
        ...costParams(record.cost),
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
                        output_video_url = @outputVideoUrl, output_image_url = @outputImageUrl,
                        thumbnail_url = @thumbnailUrl,
                        warnings = @warnings, error = @error,
                         upstream_task_id = @upstreamTaskId, submitting = @submitting,
                         message = @message,
                         edit_script = @editScript, edit_origin = @editOrigin,
                         extracted_asset_ids = @extractedAssetIds,
                         executed_by = @executedBy,
                         cost_yuan = @costYuan, cost_source = @costSource,
                         cost_detail = @costDetail,
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
        outputImageUrl: next.outputImageUrl ?? null,
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
        // V2.27（A1 片 A）：执行位置（缺省 → NULL —— 老任务不被"补写"成推测值）
        executedBy: next.executedBy ?? null,
        // V2.12（B48）：成本三列与 record.cost 同步（缺省 → NULL，**不写 0**）
        ...costParams(next.cost),
        updatedAt: Date.now(),
      });
  }

  /**
   * 成本汇总的行集（V2.12 / 台账 B48）。
   *
   * 为什么把聚合放在**上层**而不是这里：聚合要按项目 / 按天 / 按模型三种维度分组，
   * 用一条 SQL 写三个 `GROUP BY` 反而更难读；这里只负责"取哪些行"，
   * 分组与求和交给路由层（那里同时能拿到项目名、档位标签与免责声明）。
   *
   * `limit` 是**有意的上界**：汇总宁可报"已截断"，也不把十万行拉进内存
   * （调用方据返回条数是否等于 limit 判定，并在响应里如实标注）。
   */
  listCostRows(options: {
    projectId?: string;
    from?: number;
    to?: number;
    limit: number;
  }): CostRow[] {
    const where: string[] = ["status = 'succeeded'"];
    const params: Record<string, unknown> = { limit: options.limit };
    if (options.projectId !== undefined) {
      where.push('project_id = @projectId');
      params['projectId'] = options.projectId;
    }
    if (options.from !== undefined) {
      where.push('created_at >= @from');
      params['from'] = options.from;
    }
    if (options.to !== undefined) {
      where.push('created_at <= @to');
      params['to'] = options.to;
    }

    const rows = this.db
      .prepare(
        `SELECT project_id AS projectId, cost_yuan AS costYuan, created_at AS createdAt,
                json_extract(request_snapshot, '$.options.model') AS modelId
           FROM tasks
          WHERE ${where.join(' AND ')}
          ORDER BY created_at DESC
          LIMIT @limit`,
      )
      .all(params) as CostRow[];

    return rows;
  }

  /**
   * 已提交但结果不明的任务数（V2.12 / B48）——**可能已产生费用**，
   * 预算视图必须单独暴露它（这是最容易被漏掉的成本）。
   * 判据用 `disposition='uncertain'` 而不是具体错误码：将来新增"不确定"类错误码也能覆盖。
   */
  countUncertain(options: { projectId?: string; from?: number; to?: number } = {}): number {
    const where: string[] = ["json_extract(error, '$.disposition') = 'uncertain'"];
    const params: Record<string, unknown> = {};
    if (options.projectId !== undefined) {
      where.push('project_id = @projectId');
      params['projectId'] = options.projectId;
    }
    if (options.from !== undefined) {
      where.push('created_at >= @from');
      params['from'] = options.from;
    }
    if (options.to !== undefined) {
      where.push('created_at <= @to');
      params['to'] = options.to;
    }

    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM tasks WHERE ${where.join(' AND ')}`)
      .get(params) as { count: number };
    return row.count;
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
   *
   * V2.11（台账 B47）：新增可选 `projectId` —— **传了才过滤**。所有调用方都显式传
   * （路由层把"省略"收敛成默认项目，见 `normalizeProjectId`），此处不设隐式默认：
   * 存储层"悄悄按默认项目过滤"会让别的调用点（测试、脚本）拿到意料之外的空列表。
   *
   * V2.25（台账 B44）：新增可选 `before`（`created_at < before`）—— 分页游标。
   * 排序键是 `created_at`（不是 `updated_at`），游标语义与排序键**必须**一致，
   * 否则"翻页期间恰好有任务更新"会导致重复或跳漏。
   */
  listRecent(
    limit = 50,
    options: {
      kind?: 'edit';
      sourceTaskId?: string;
      projectId?: string;
      /** V2.25（台账 B44）：只返回 `created_at < before` 的任务 —— "加载更早"的游标 */
      before?: number;
      /**
       * V2.43（Step 11-S3）：来源过滤。
       * - 缺省 / `create`：**排除画布产物**（实测产品的生成历史不含画布结果）；
       * - `canvas`：只看画布产物（画布内回查用）。
       */
      origin?: 'create' | 'canvas';
    } = {},
  ): TaskRecord[] {
    const projectClause = options.projectId === undefined ? '' : ' AND project_id = @projectId';
    const beforeClause = options.before === undefined ? '' : ' AND created_at < @before';
    const params: Record<string, unknown> = { limit };
    if (options.projectId !== undefined) params['projectId'] = options.projectId;
    if (options.before !== undefined) params['before'] = options.before;

    if (options.kind === 'edit') {
      const sourceClause =
        options.sourceTaskId === undefined
          ? ''
          : ` AND coalesce(json_extract(edit_script, '$.sourceTaskId'),
                           json_extract(edit_origin, '$.sourceTaskId')) = @sourceTaskId`;
      if (options.sourceTaskId !== undefined) params['sourceTaskId'] = options.sourceTaskId;

      const rows = this.db
        .prepare(
          `SELECT * FROM tasks
            WHERE (edit_script IS NOT NULL OR edit_origin IS NOT NULL)${sourceClause}${projectClause}${beforeClause}
            ORDER BY created_at DESC LIMIT @limit`,
        )
        .all(params) as TaskRow[];
      return rows.map(rowToRecord);
    }

    // V2.43：画布产物不进生成历史。老记录没有 origin 字段 → `coalesce` 当 `create` 处理。
    const originClause =
      options.origin === 'canvas'
        ? " AND json_extract(request_snapshot, '$.origin') = 'canvas'"
        : " AND coalesce(json_extract(request_snapshot, '$.origin'), 'create') <> 'canvas'";

    const rows = this.db
      .prepare(
        `SELECT * FROM tasks
          WHERE edit_script IS NULL AND edit_origin IS NULL${projectClause}${beforeClause}${originClause}
          ORDER BY created_at DESC LIMIT @limit`,
      )
      .all(params) as TaskRow[];
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

  /**
   * 按状态计数（V2.16 / 台账 B53）：给 `since` 就只统计窗口内的（近 24h 成功率用）。
   * **五种状态永远都在结果里**（0 也要出现）—— 缺键会让调用方写出 `?? 0`，
   * 而那正是"同一个数字有两种写法"的开端。
   */
  countByStatus(options: { since?: number } = {}): Record<TaskProgress['status'], number> {
    const rows = (
      options.since === undefined
        ? this.db.prepare('SELECT status, COUNT(*) AS count FROM tasks GROUP BY status').all()
        : this.db
            .prepare(
              'SELECT status, COUNT(*) AS count FROM tasks WHERE created_at >= ? GROUP BY status',
            )
            .all(options.since)
    ) as Array<{ status: string; count: number }>;

    const result: Record<TaskProgress['status'], number> = {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    };
    // 用集合查而不是五连 `||`：一是可读，二是**分支覆盖**上的实话 ——
    // 五连或会让"最后那个状态没被数据命中"变成一条永远走不到的分支。
    const known: readonly string[] = ['queued', 'running', 'succeeded', 'failed', 'cancelled'];
    for (const row of rows) {
      if (known.includes(row.status)) {
        result[row.status as TaskProgress['status']] = row.count;
      }
    }
    return result;
  }

  /** 某状态里**最老的**一条的创建时间（队列积压 / 任务卡住的判据；没有则 null） */
  oldestCreatedAt(status: TaskProgress['status']): number | null {
    const row = this.db
      .prepare('SELECT MIN(created_at) AS oldest FROM tasks WHERE status = ?')
      .get(status) as { oldest: number | null };
    return row.oldest;
  }

  /**
   * 数据库文件占用（V2.16 / B53）：库 + WAL 共两个文件。
   * 用 `this.db.name`（better-sqlite3 给的**实际**路径）而不是重新解析 env ——
   * 测试用内存库时它是 `:memory:`，两处 size 都如实为 0，不会去 stat 一个奇怪的文件名。
   */
  databaseFileBytes(): { fileBytes: number; walBytes: number } {
    const file = this.db.name;
    const sizeOfFile = (target: string): number => {
      try {
        const info = statSync(target);
        return info.isFile() ? info.size : 0;
      } catch {
        return 0; // 还没落盘 / 内存库：0 是事实，不抛
      }
    };
    return { fileBytes: sizeOfFile(file), walBytes: sizeOfFile(`${file}-wal`) };
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
  /**
   * 容量淘汰用（V2.8 / 台账 B22）：**最旧的已成功且有成片**的任务（`created_at` 升序）。
   *
   * 为什么单独一条查询而不是复用 `listRecent`：淘汰要从**最旧**的一端开始，
   * 而 `listRecent` 按最新 50 条截断——只看最近 50 条永远看不到该淘汰的那批。
   */
  listOldestWithOutput(limit: number): TaskRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM tasks
          WHERE status = 'succeeded'
            AND ((output_video_url IS NOT NULL AND output_video_url != '')
              OR (output_image_url IS NOT NULL AND output_image_url != ''))
          ORDER BY created_at ASC LIMIT ?`,
      )
      .all(limit) as TaskRow[];
    return rows.map(rowToRecord);
  }

  /**
   * 有多少任务把这条成片以 `task:<taskId>` 引用当参考？（V2.8 容量淘汰的保护规则）
   *
   * 与 `countTasksReferencingAsset` 同一套路（快照 JSON 全文 LIKE）：被引用的成片**不淘汰** ——
   * 否则"参数一键回填"再提交会撞 404（引用还在，片子没了）。
   */
  countTasksReferencingTaskRef(taskId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS c FROM tasks WHERE task_id != ? AND request_snapshot LIKE ?')
      .get(taskId, `%task:${taskId}%`) as { c: number };
    return row.c;
  }

  countTasksReferencingAsset(assetId: string, exceptTaskId: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS c FROM tasks WHERE task_id != ? AND request_snapshot LIKE ?",
      )
      .get(exceptTaskId, `%${assetId}%`) as { c: number };
    return row.c;
  }
}
