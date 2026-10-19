import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

  private writeAtomic(file: string, payload: string): void {
    mkdirSync(this.dir, { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, payload, 'utf8');
    renameSync(tmp, file);
  }

  /** 读索引：坏文件/未知版本一律回落空索引（索引坏了不该让整个画布列表打不开） */
  readIndex(): CanvasProjectIndex {
    try {
      const raw = readFileSync(this.indexPath(), 'utf8');
      const parsed = CanvasProjectIndexSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : createEmptyCanvasProjectIndex();
    } catch {
      return createEmptyCanvasProjectIndex();
    }
  }

  readDoc(projectId: string): CanvasDoc | null {
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

  /** 保存文档并返回摘要；文档本体不合法时抛错（路由层转成 400） */
  saveDoc(input: unknown): CanvasProjectRef {
    const doc = CanvasDocSchema.parse(input);
    this.writeAtomic(this.docPath(doc.projectId), `${JSON.stringify(doc)}\n`);
    const summary = canvasDocSummary(doc);
    this.upsertIndex(summary);
    return summary;
  }

  deleteDoc(projectId: string): boolean {
    try {
      rmSync(this.docPath(projectId), { force: false });
    } catch {
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
