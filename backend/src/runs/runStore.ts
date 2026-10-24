import type { CreationRun, CreationRunSummary } from '@astrmira/shared';
import { CreationRunSchema } from '@astrmira/shared';
import type { Db } from '../store/db.js';

/**
 * 创作会话存储（CONTRACT §29 / V2.63；S8-B2）。
 *
 * 会话本体一行一档；每个步骤的**生成任务**走既有 tasks 表
 * （幂等键 `run:<runId>:<stepId>:a<attempt>` 关联），这里只存步骤状态的事实源。
 * 沿 TaskStore 约定：prepared statements + JSON 列，读写都是同步调用。
 */
export class RunStore {
  constructor(private readonly db: Db) {}

  create(run: CreationRun): void {
    this.db
      .prepare(
        `INSERT INTO creation_runs
           (id, project_id, title, mode, provider, state, steps, confirmed_at,
            failure, assembled_task_id, created_at, updated_at, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.projectId,
        run.title,
        run.mode,
        run.provider,
        run.state,
        JSON.stringify(run.steps),
        run.confirmedAt ?? null,
        run.failure === undefined ? null : JSON.stringify(run.failure),
        run.assembledTaskId ?? null,
        run.createdAt,
        run.updatedAt,
        run.startedAt ?? null,
        run.finishedAt ?? null,
      );
  }

  get(id: string): CreationRun | null {
    const row = this.db
      .prepare('SELECT * FROM creation_runs WHERE id = ?')
      .get(id) as RunRow | undefined;
    return row === undefined ? null : rowToRun(row);
  }

  /** 整档替换（步骤状态推进的唯一写路径；乐观并发由服务层的串行 tick 保证）。 */
  update(run: CreationRun): void {
    this.db
      .prepare(
        `UPDATE creation_runs
           SET state = ?, steps = ?, confirmed_at = ?, failure = ?, assembled_task_id = ?,
               updated_at = ?, started_at = ?, finished_at = ?
         WHERE id = ?`,
      )
      .run(
        run.state,
        JSON.stringify(run.steps),
        run.confirmedAt ?? null,
        run.failure === undefined ? null : JSON.stringify(run.failure),
        run.assembledTaskId ?? null,
        run.updatedAt,
        run.startedAt ?? null,
        run.finishedAt ?? null,
        run.id,
      );
  }

  listByProject(projectId: string, limit = 50): CreationRunSummary[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM creation_runs WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?',
      )
      .all(projectId, limit) as RunRow[];
    return rows.map((row) => {
      const run = rowToRun(row);
      return toSummary(run);
    });
  }

  /** 重启恢复：所有需要执行器继续照看的会话。 */
  listActive(): CreationRun[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM creation_runs WHERE state IN ('planned', 'running', 'awaiting-confirmation', 'assembling')",
      )
      .all() as RunRow[];
    return rows.map(rowToRun);
  }
}

interface RunRow {
  id: string;
  project_id: string;
  title: string;
  mode: string;
  provider: string;
  state: string;
  steps: string;
  confirmed_at: number | null;
  failure: string | null;
  assembled_task_id: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
}

/** 行 → 对象；损坏行按"读不出来"抛错（schema strict），调用方决定如何处置，不静默吞。 */
function rowToRun(row: RunRow): CreationRun {
  const parsed = CreationRunSchema.safeParse({
    version: 1,
    id: row.id,
    title: row.title,
    projectId: row.project_id,
    mode: row.mode,
    provider: row.provider,
    state: row.state,
    steps: JSON.parse(row.steps),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.confirmed_at === null ? {} : { confirmedAt: row.confirmed_at }),
    ...(row.started_at === null ? {} : { startedAt: row.started_at }),
    ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }),
    ...(row.failure === null ? {} : { failure: JSON.parse(row.failure) }),
    ...(row.assembled_task_id === null ? {} : { assembledTaskId: row.assembled_task_id }),
  });
  if (!parsed.success) {
    throw new Error(`creation_runs 行损坏（${row.id}）：${parsed.error.issues[0]?.message ?? ''}`);
  }
  return parsed.data;
}

export function toSummary(run: CreationRun): CreationRunSummary {
  return {
    id: run.id,
    title: run.title,
    projectId: run.projectId,
    mode: run.mode,
    provider: run.provider,
    state: run.state,
    videoStepCount: run.steps.filter((step) => step.kind === 'video').length,
    succeededCount: run.steps.filter((step) => step.status === 'succeeded').length,
    failedCount: run.steps.filter((step) => step.status === 'failed').length,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}
