import { randomUUID } from 'node:crypto';
import { DEFAULT_PROJECT_ID, PROJECT_NAME_MAX_CHARS } from '@astrmira/shared';
import type { Db } from './db.js';

/**
 * 项目存储（V2.11 / 台账 B47，CONTRACT §12）。
 *
 * 三个口径（都是"不静默"的具体化）：
 * 1. **默认项目不可删**（它是老数据与"未指定项目"的落点，删了就有数据无处安放）；
 * 2. **项目名去重**：同名项目在切换器里根本认不出来（这是可用性问题，不是洁癖），
 *    因此重名在**这一层**就被拒 —— 判定交给调用方转成 `INVALID_REQUEST`；
 * 3. **删除只允许空项目**（无任务、无资产）—— 由路由层连同资产计数一起判，
 *    本层只提供 `countTasks` 与真正执行删除的 `remove`。
 */

export interface ProjectRecord {
  projectId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

interface ProjectRow {
  project_id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

function rowToRecord(row: ProjectRow): ProjectRecord {
  return {
    projectId: row.project_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 项目名的收敛：trim + 截断（**不**在这里判空/重名 —— 那是路由层的错误码职责） */
export function normalizeProjectName(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.length > PROJECT_NAME_MAX_CHARS ? trimmed.slice(0, PROJECT_NAME_MAX_CHARS) : trimmed;
}

export class ProjectStore {
  constructor(private readonly db: Db) {}

  /** 默认项目排最前，其余按创建时间（新的在前）—— 切换器的阅读顺序 */
  list(): ProjectRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM projects
          ORDER BY CASE WHEN project_id = ? THEN 0 ELSE 1 END, created_at DESC`,
      )
      .all(DEFAULT_PROJECT_ID) as ProjectRow[];
    return rows.map(rowToRecord);
  }

  get(projectId: string): ProjectRecord | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE project_id = ?').get(projectId) as
      | ProjectRow
      | undefined;
    return row === undefined ? null : rowToRecord(row);
  }

  /** 同名（trim 后全等）是否已存在；`exceptProjectId` 用于改名时排除自己 */
  nameTaken(name: string, exceptProjectId?: string): boolean {
    const row = this.db
      .prepare('SELECT project_id FROM projects WHERE name = ? AND project_id <> ?')
      .get(name, exceptProjectId ?? '') as { project_id: string } | undefined;
    return row !== undefined;
  }

  create(name: string): ProjectRecord {
    const projectId = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO projects (project_id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(projectId, name, now, now);
    return this.get(projectId) as ProjectRecord;
  }

  /** 改名；返回 false = 项目不存在（调用方转 `PROJECT_NOT_FOUND`） */
  rename(projectId: string, name: string): boolean {
    const result = this.db
      .prepare('UPDATE projects SET name = ?, updated_at = ? WHERE project_id = ?')
      .run(name, Date.now(), projectId);
    return result.changes > 0;
  }

  /** 真正删除；**前置条件是空项目**（由路由层保证，本层不做数据搬迁） */
  remove(projectId: string): boolean {
    const result = this.db.prepare('DELETE FROM projects WHERE project_id = ?').run(projectId);
    return result.changes > 0;
  }

  /** 项目内的任务条数（含剪辑产物与失败记录 —— 它们是"这个项目用过多少"的事实） */
  countTasks(projectId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM tasks WHERE project_id = ?')
      .get(projectId) as { count: number };
    return row.count;
  }

  /** 项目 id 是否是默认项目（删除护栏用；写成一处，避免各处硬编码字符串） */
  static isDefault(projectId: string): boolean {
    return projectId === DEFAULT_PROJECT_ID;
  }
}
