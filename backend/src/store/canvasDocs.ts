import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CanvasDocSchema,
  CanvasProjectIndexSchema,
  canvasDocSummary,
  createEmptyCanvasProjectIndex,
  type CanvasDoc,
  type CanvasProjectIndex,
  type CanvasProjectRef,
} from '@astrmira/shared';

/**
 * 画布文档存储（CONTRACT §21-8；Step 11-S3 / 台账 B78）。
 *
 * ## 为什么是文件而不是 SQLite
 * - 文档是**整份读、整份写**的编辑器状态（几 MB 上限），不是需要 JOIN 的关系数据；
 * - 用户可能想直接备份/拷贝某个画布，`<projectId>.doc.json` 一眼能看懂；
 * - 不与任务/资产表的事务耦合：画布写坏一份，不能影响出片记录。
 *
 * ## 三条纪律
 * 1. **原子写**：先写临时文件再 `rename` —— 断电/崩溃不会留下半份 JSON；
 * 2. **索引是派生数据**：保存文档时顺手更新摘要（节点数/封面/时间），读索引**不信**坏文件；
 * 3. **单用户部署**（D60）：没有 ownerId，目录即归属；`projectId` 只做文件名转义，不做鉴权。
 */

/** 数据根目录：与 `DATA_DIR` 同一口径（`:memory:` 时给进程级临时目录，避免测试互相污染） */
export function resolveCanvasDir(): string {
  const override = process.env.DATA_DIR;
  const trimmed = typeof override === 'string' ? override.trim() : '';
  if (trimmed === ':memory:') {
    return path.join(tmpdir(), `astrmira-canvas-${process.pid}`);
  }
  const base = trimmed === '' ? path.join(process.cwd(), 'data') : trimmed;
  return path.join(base, 'canvas');
}

/** V2.48：修订号冲突 / 已删除文档（路由映射为 409 `DOC_CONFLICT`）。 */
export class CanvasDocConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanvasDocConflictError';
  }
}

export class CanvasDocStore {
  constructor(private readonly dir: string) {}

  private indexPath(): string {
    return path.join(this.dir, 'index.json');
  }

  private docPath(projectId: string): string {
    // `encodeURIComponent` 把 `/`、`..` 这类路径字符转义掉 —— projectId 来自用户输入，
    // 不能让它决定写到哪个目录（这是本模块唯一的安全边界）。
    return path.join(this.dir, `${encodeURIComponent(projectId)}.doc.json`);
  }

  /** V2.48：删除墓碑。存在它 = 这个 projectId 已被删除，迟到的 PUT 不得复活。 */
  private tombstonePath(projectId: string): string {
    return path.join(this.dir, `${encodeURIComponent(projectId)}.deleted`);
  }

  private writeAtomic(file: string, payload: string): void {
    mkdirSync(this.dir, { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, payload, 'utf8');
    renameSync(tmp, file);
  }

  /**
   * 读索引。
   *
   * V2.48：索引坏/缺失时**扫描文档重建**，不再一坏就返回空列表 ——
   * 否则用户的画布明明在磁盘上，界面却显示“没有作品”。
   */
  readIndex(): CanvasProjectIndex {
    try {
      const raw = readFileSync(this.indexPath(), 'utf8');
      const parsed = CanvasProjectIndexSchema.safeParse(JSON.parse(raw));
      // 空索引也可能只是“索引被清掉/写丢”，而文档还在 —— 先扫一遍再相信它
      if (parsed.success && parsed.data.projects.length > 0) return parsed.data;
    } catch {
      // 落到重建
    }
    return this.rebuildIndex();
  }

  readDoc(projectId: string): CanvasDoc | null {
    // 墓碑优先：删除后即使文档文件因为崩溃残留，也不该再被打开
    if (existsSync(this.tombstonePath(projectId))) return null;
    try {
      const raw = readFileSync(this.docPath(projectId), 'utf8');
      const parsed = CanvasDocSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return null;
      // 文件名与文档内的 projectId 必须一致：防止"复制了别人的文件"导致列表串项目
      return parsed.data.projectId === projectId ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /**
   * 保存文档并返回摘要 + 新修订号。
   *
   * V2.48：已有文档必须带 `expectedRevision` 且等于当前值；否则抛
   * `CanvasDocConflictError`（路由转 409 `DOC_CONFLICT`）。新建文档允许缺省/1。
   */
  saveDoc(
    input: unknown,
    expectedRevision?: number,
  ): { summary: CanvasProjectRef; revision: number } {
    const doc = CanvasDocSchema.parse(input);
    if (existsSync(this.tombstonePath(doc.projectId))) {
      throw new CanvasDocConflictError('这个画布已被删除，不能通过迟到的保存复活');
    }

    const existing = this.readDoc(doc.projectId);
    let revision: number;
    if (existing === null) {
      if (expectedRevision !== undefined && expectedRevision !== 1) {
        throw new CanvasDocConflictError('画布不存在或已被删除，请重载后再保存');
      }
      revision = 1;
    } else {
      if (expectedRevision === undefined) {
        throw new CanvasDocConflictError('缺少修订号：这个画布已在别处保存过，请重载后再编辑');
      }
      if (expectedRevision !== existing.revision) {
        throw new CanvasDocConflictError(
          `修订号不匹配（当前 ${existing.revision}，提交 ${expectedRevision}）：请重载后再编辑`,
        );
      }
      revision = existing.revision + 1;
    }

    const next: CanvasDoc = { ...doc, revision };
    this.writeAtomic(this.docPath(next.projectId), `${JSON.stringify(next)}\n`);
    const summary = canvasDocSummary(next);
    this.upsertIndex(summary);
    return { summary, revision };
  }

  deleteDoc(projectId: string): boolean {
    if (!existsSync(this.docPath(projectId))) return false;

    // 先写墓碑再删文档：即使删文件失败，也可回滚墓碑；
    // 反过来（先删再写）会留下“迟到 PUT 把文档建回来”的窗口。
    this.writeAtomic(this.tombstonePath(projectId), `${Date.now()}\n`);
    try {
      rmSync(this.docPath(projectId), { force: false });
    } catch {
      rmSync(this.tombstonePath(projectId), { force: true });
      return false;
    }

    const index = this.readIndex();
    const next: CanvasProjectIndex = {
      ...index,
      projects: index.projects.filter((p) => p.projectId !== projectId),
    };
    if (next.activeProjectId === projectId) delete next.activeProjectId;
    this.writeIndex(next);
    return true;
  }

  /** 把当前打开的项目记进索引（多画布列表用来高亮"上次打开"） */
  setActive(projectId: string | undefined): CanvasProjectIndex {
    const index = this.readIndex();
    const next: CanvasProjectIndex = { ...index };
    if (projectId === undefined) delete next.activeProjectId;
    else next.activeProjectId = projectId;
    this.writeIndex(next);
    return next;
  }

  /** V2.48：索引坏/缺失时扫描文档重建（文件名必须与文档 projectId 一致） */
  private rebuildIndex(): CanvasProjectIndex {
    const projects: CanvasProjectRef[] = [];
    try {
      for (const file of readdirSync(this.dir)) {
        if (!file.endsWith('.doc.json')) continue;
        const encoded = file.slice(0, -'.doc.json'.length);
        let projectId: string;
        try {
          projectId = decodeURIComponent(encoded);
        } catch {
          continue;
        }
        if (existsSync(this.tombstonePath(projectId))) continue;
        try {
          const raw = readFileSync(path.join(this.dir, file), 'utf8');
          const parsed = CanvasDocSchema.safeParse(JSON.parse(raw));
          if (!parsed.success) continue;
          if (`${encodeURIComponent(parsed.data.projectId)}.doc.json` !== file) continue;
          projects.push(canvasDocSummary(parsed.data));
        } catch {
          // 单份文档坏了不该拖垮整个列表
        }
      }
    } catch {
      // 目录还不存在 = 还没有作品
    }

    projects.sort((a, b) => b.updatedAt - a.updatedAt);
    const index: CanvasProjectIndex = {
      version: createEmptyCanvasProjectIndex().version,
      projects,
    };
    try {
      this.writeIndex(index);
    } catch {
      // 只读目录/磁盘错误：仍然返回扫描结果，让列表能打开
    }
    return index;
  }

  private upsertIndex(summary: CanvasProjectRef): void {
    const index = this.readIndex();
    const projects = index.projects.filter((p) => p.projectId !== summary.projectId);
    projects.push(summary);
    projects.sort((a, b) => b.updatedAt - a.updatedAt);
    this.writeIndex({ ...index, projects });
  }

  private writeIndex(index: CanvasProjectIndex): void {
    this.writeAtomic(this.indexPath(), `${JSON.stringify(index)}\n`);
  }
}
