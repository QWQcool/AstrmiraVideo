import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  SUBJECT_MAX_COUNT,
  SubjectCreateSchema,
  SubjectPatchSchema,
  SubjectSchema,
  type Subject,
  type SubjectCreateInput,
  type SubjectPatchInput,
} from '@astrmira/shared';

/**
 * 主体库存储（CONTRACT §21-18 / V2.86 / D-3）。
 *
 * ## 为什么是"单文件数组"而不是每主体一个文件
 * 主体库的读法是**整份列出**（左侧面板要一次显示全部），写入是单条增删改 ——
 * 单文件一次读完正好；每主体一个文件会变成"几百次 readdir + stat"，而总量有界（≤500）。
 * 与 `data/canvas/*.json` 同风格（`DATA_DIR`、原子写）。
 *
 * ## 三条纪律
 * 1. **原子写**：临时文件 + rename —— 断电不会留下半份 JSON；
 * 2. **坏文件先备份再覆盖**：读到解析不了的 `subjects.json` 时，写入前先改名成
 *    `subjects.json.broken-<时间戳>`。用户数据不能被一次写操作静默抹掉（哪怕它已经坏了）；
 * 3. **不校验资产存在**：`assetIds` 只是 id。资产被清理后仍原样保留 ——
 *    删一个素材不该顺手改主体（那是两件事），界面负责把"素材缺失"说清楚。
 */

export class SubjectLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubjectLimitError';
  }
}

export function resolveSubjectsFile(): string {
  const override = process.env.DATA_DIR;
  const trimmed = typeof override === 'string' ? override.trim() : '';
  if (trimmed === ':memory:') {
    return path.join(tmpdir(), `astrmira-subjects-${process.pid}.json`);
  }
  const base = trimmed === '' ? path.join(process.cwd(), 'data') : trimmed;
  return path.join(base, 'subjects.json');
}

/** 去重但保留顺序（同一个素材被拖两次不该变成两条参考） */
function normalizeAssetIds(assetIds: readonly string[]): string[] {
  return [...new Set(assetIds.map((id) => id.trim()).filter((id) => id !== ''))];
}

function normalizeDescription(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

export class SubjectStore {
  constructor(private readonly file: string) {}

  /**
   * 读全部主体（按 `createdAt` 升序 —— 面板里新建的永远在最后，位置稳定）。
   *
   * 文件不存在 = 空库（不是错误）；解析失败 = 空库 + 交给 `writeAtomic` 在下次写入前备份。
   */
  list(): Subject[] {
    const raw = this.readRaw();
    if (raw === null) return [];
    const parsed = parseSubjects(raw);
    if (parsed === null) return [];
    return [...parsed].sort((left, right) => left.createdAt - right.createdAt);
  }

  create(input: SubjectCreateInput, now = Date.now()): Subject {
    const body = SubjectCreateSchema.parse(input);
    const subjects = this.list();
    if (subjects.length >= SUBJECT_MAX_COUNT) {
      throw new SubjectLimitError(
        `主体库已满（上限 ${SUBJECT_MAX_COUNT} 个）：请先删除不用再新建`,
      );
    }
    const subject: Subject = SubjectSchema.parse({
      id: randomUUID(),
      name: body.name,
      ...(normalizeDescription(body.description) === undefined
        ? {}
        : { description: normalizeDescription(body.description) }),
      assetIds: normalizeAssetIds(body.assetIds),
      createdAt: now,
    });
    this.writeAtomic([...subjects, subject]);
    return subject;
  }

  /** 改一条；不存在返回 null（路由映射 404 —— 不静默创建） */
  update(id: string, patch: SubjectPatchInput): Subject | null {
    const body = SubjectPatchSchema.parse(patch);
    const subjects = this.list();
    const index = subjects.findIndex((item) => item.id === id);
    if (index === -1) return null;

    const current = subjects[index] as Subject;
    const description =
      body.description === undefined ? current.description : normalizeDescription(body.description);
    /**
     * V2.99（N9）：锚点三件套一起改。
     *
     * `anchorAssetId: null` = **清除锚点**（回到"未出定妆图"），与 `description: ''` 同一口径；
     * 清锚点时把 `anchorTaskId` / `anchorSource` / `anchorUpdatedAt` 一起删掉 ——
     * 留着一个指向旧任务的 id 会让"这条锚点是哪来的"变成假信息。
     */
    const clearingAnchor = body.anchorAssetId === null;
    const nextAnchor =
      body.anchorAssetId === undefined
        ? {}
        : clearingAnchor
          ? {}
          : {
              anchorAssetId: body.anchorAssetId,
              ...(body.anchorTaskId === null || body.anchorTaskId === undefined
                ? {}
                : { anchorTaskId: body.anchorTaskId }),
              anchorSource: body.anchorSource ?? 'manual',
              anchorUpdatedAt: Date.now(),
            };
    const next: Subject = SubjectSchema.parse({
      ...current,
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(description === undefined ? {} : { description }),
      ...(body.assetIds === undefined ? {} : { assetIds: normalizeAssetIds(body.assetIds) }),
      ...nextAnchor,
    });
    // `description` 是可选字段：要清空就必须真的没有这个键（`undefined` 会被 zod 剥掉，
    // 但这里显式删键，避免以后有人改成 passthrough 时把空串存进去）
    if (description === undefined) delete next.description;
    if (clearingAnchor) {
      delete next.anchorAssetId;
      delete next.anchorTaskId;
      delete next.anchorSource;
      delete next.anchorUpdatedAt;
    } else if (body.anchorAssetId !== undefined) {
      // 换锚点时**不继承**旧 taskId：指向 old 任务会让"这条锚点哪来的"变成假信息
      if (body.anchorTaskId === undefined || body.anchorTaskId === null) delete next.anchorTaskId;
    }

    const updated = [...subjects];
    updated[index] = next;
    this.writeAtomic(updated);
    return next;
  }

  /** 删一条；不存在返回 false（DELETE 幂等的边界在路由：404 而不是假装成功） */
  remove(id: string): boolean {
    const subjects = this.list();
    const next = subjects.filter((item) => item.id !== id);
    if (next.length === subjects.length) return false;
    this.writeAtomic(next);
    return true;
  }

  private readRaw(): string | null {
    try {
      return readFileSync(this.file, 'utf8');
    } catch {
      return null;
    }
  }

  private writeAtomic(subjects: readonly Subject[]): void {
    const dir = path.dirname(this.file);
    mkdirSync(dir, { recursive: true });
    this.backupIfBroken();
    const tmp = `${this.file}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, `${JSON.stringify(subjects, null, 2)}\n`, 'utf8');
    renameSync(tmp, this.file);
  }

  /**
   * 覆盖前把解析不了的旧文件留一份。
   *
   * 只在"文件存在且解析失败"时做 —— 正常读写的临时文件也要 rename，不能每次都备份。
   */
  private backupIfBroken(): void {
    if (!existsSync(this.file)) return;
    const raw = this.readRaw();
    if (raw === null) return;
    if (parseSubjects(raw) !== null) return;
    renameSync(this.file, `${this.file}.broken-${Date.now()}`);
  }
}

function parseSubjects(raw: string): Subject[] | null {
  try {
    const parsed = SubjectSchema.array().safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
