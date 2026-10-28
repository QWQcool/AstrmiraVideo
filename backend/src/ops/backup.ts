import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { CanvasDocSchema, CanvasProjectIndexSchema } from '@astrmira/shared';
import type { Db } from '../store/db.js';
import { resolveCanvasDir } from '../store/canvasDocs.js';
import {
  acquireCanvasWriteLock,
  CANVAS_BACKUP_LOCK_FILE,
  type AcquiredCanvasWriteLock,
} from '../store/canvasWriteBarrier.js';

/**
 * 备份与恢复（V2.17 / B52 片 A；**V2.72 / B95 纳入画布**）。
 *
 * ## 为什么备份必须是一次 `VACUUM INTO` 而不是 `cp data/app.db`
 * 本服务用 WAL 模式（`db.ts` 的 `journal_mode = WAL`）：**直接拷 `app.db` 可能拿到一个
 * 缺了最近事务、甚至内部不一致的库**（最新数据还在 `-wal` 里）。`VACUUM INTO` 是 SQLite
 * 原生的**一致性快照**：它在一个读事务里把整个库重写到目标文件，产出的就是一个可以直接打开的完整库。
 * 这是"备份能不能用来恢复"的分界线 —— 一份拷出来的坏库只有在真正要恢复的那天才被发现。
 *
 * ## V2.72：画布也要备（否则"校验成功、恢复后没有画布"）
 * 画布文档自 §21-8 起存放在 `data/canvas/*.doc.json`（+ `index.json` + `*.deleted` 墓碑），
 * **不在 `app.db` 里**。只备数据库 = 换机后画布全丢，而 `verify` 还会说"通过"——
 * 这正是 B95 要消灭的那种"看起来完整"。
 *
 * ## 一致性策略（不是"两个目录拷一遍"）
 * 数据库与画布是两套持久化，**不能把不同时点的两份拼起来再声称完整一致**。因此：
 * 1. 先取**画布写锁**（`canvas/.backup.lock`）；服务端画布保存/删除在此期间明确拒绝（409），
 *    不是静默丢弃；
 * 2. 再做数据库 `VACUUM INTO` 快照；
 * 3. 再拷贝画布文件（小文件，逐份 sha256）；
 * 4. 释放写锁，最后拷贝体积大的 `outputs/`（它与画布引用无事务关系，且已有淘汰/清理规则）。
 *
 * 由此得到可对账的事实：**画布集合在整个窗口内不变**，所以画布文档里引用的任务
 * 一定创建于数据库快照之前 —— 恢复后引用不会指向"快照里不存在的任务"。
 * 不宣称更强的东西：备份期间**新产生的任务**不在快照里（这是"回到那一刻"的语义）。
 *
 * ## 产出的形态：**一个目录**，不是 tar
 * `backups/<时间戳>/` = `app.db`（一致性快照）+ `manifest.json` +（可选）`outputs/` + `canvas/`。
 *
 * ## 三条纪律
 * 1. **恢复前先自动备份当前状态**（`pre-restore-<时间戳>/`，同样含画布）；
 * 2. **校验不通过就不动数据**（DB 的 sha256 + 每个文件的字节数/哈希 + 画布引用关系）；
 * 3. **恢复要求服务已停止**：拿一次独占写锁来判定（拿不到就是有人在写，直接拒绝）。
 */

/** 2 = 纳入画布文档/索引/墓碑（v1 备份仍可识别，只是明确报告"不含画布"） */
export const BACKUP_VERSION = 2;

export const BackupFileSchema = z.object({
  /** 相对备份根的路径（如 `app.db` / `outputs/<taskId>.mp4` / `canvas/<id>.doc.json`） */
  path: z.string(),
  bytes: z.number().int().nonnegative(),
  /** `app.db` 与画布文件逐字节 hash；大体积 outputs 只记字节数（见文件头） */
  sha256: z.string().optional(),
});

export const BackupManifestSchema = z.object({
  /**
   * ⚠️ 这里**故意的不是 `z.literal(BACKUP_VERSION)`**：来自**更新版本**的备份要能被解析出来，
   * 才能给出可执行的那句话"请先升级服务再恢复"。用 literal 只会得到一句
   * "manifest 形状不对" —— 对运维毫无帮助（格式闸门的下一条判据在 `verifyBackup` 里）。
   */
  backupVersion: z.number().int().positive(),
  createdAt: z.number().int(),
  /** 生成备份的服务版本（恢复时提示"从哪个版本来的"） */
  appVersion: z.string(),
  includeOutputs: z.boolean(),
  /**
   * V2.72：是否包含画布。**旧备份（v1）没有这个字段** → default false，
   * 于是"这份备份不含画布"变成可判定的数据，而不是靠人记版本号。
   */
  includeCanvas: z.boolean().default(false),
  database: BackupFileSchema,
  outputs: z.array(BackupFileSchema),
  /** 画布文件（文档 / 索引 / 墓碑）；路径相对备份根，`canvas/` 前缀 */
  canvas: z.array(BackupFileSchema).default([]),
  /** 备份时的用量快照（恢复后对账用："应该有多少条任务 / 多少资产 / 几张画布"） */
  counts: z.object({
    tasks: z.number().int(),
    projects: z.number().int(),
    canvases: z.number().int().nonnegative().default(0),
    canvasTombstones: z.number().int().nonnegative().default(0),
  }),
});
export type BackupManifest = z.infer<typeof BackupManifestSchema>;

const DB_FILE_NAME = 'app.db';
const MANIFEST_FILE_NAME = 'manifest.json';
const CANVAS_DIR_NAME = 'canvas';

export interface BackupOptions {
  /** 数据库连接（用它做 VACUUM INTO） */
  db: Db;
  /** 输出根目录（`outputs/` 的父目录 → 实际是 outputsDir 本身） */
  outputsDir: string;
  /** 备份写到哪（会被创建；**必须为空或不存在**，避免把两次备份混在一起） */
  targetDir: string;
  /**
   * 画布目录（`<DATA_DIR>/canvas`）。缺省按 `resolveCanvasDir()` 解析 ——
   * 与画布存储同一份口径，避免"备份了一个目录、服务写的是另一个"。
   */
  canvasDir?: string;
  appVersion?: string;
  /** 是否把成片与资产一起备份（默认 true；只备数据库时给 false；**画布不受它影响**） */
  includeOutputs?: boolean;
  now?: () => number;
  /** 备份侧进程号（写进画布写锁，便于诊断） */
  pid?: number;
}

/** `VACUUM INTO` 的一致性快照（目标文件必须**不存在** —— SQLite 的硬要求） */
export async function vacuumDatabaseInto(db: Db, targetFile: string): Promise<void> {
  await rm(targetFile, { force: true });
  // 参数化不行（VACUUM INTO 的路径是 SQL 字面量）：转义单引号即可，路径来自脚本参数
  db.exec(`VACUUM INTO '${targetFile.replace(/'/g, "''")}'`);
}

async function sha256OfFile(file: string): Promise<string> {
  const content = await readFile(file);
  return createHash('sha256').update(content).digest('hex');
}

async function listFiles(
  dir: string,
  relativeTo: string,
): Promise<Array<{ path: string; bytes: number }>> {
  const result: Array<{ path: string; bytes: number }> = [];
  const walk = async (current: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return; // 目录不存在 = 还没有产出（备份一个空 outputs 是合法的）
    }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await stat(absolute);
      result.push({ path: path.relative(relativeTo, absolute).split(path.sep).join('/'), bytes: info.size });
    }
  };
  await walk(dir);
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

function countTable(db: Db, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

/** 画布文件（只取文档/索引/墓碑；跳过写锁与原子写临时文件） */
async function listCanvasFiles(
  canvasDir: string,
): Promise<Array<{ path: string; bytes: number; sha256: string }>> {
  const files = await listFiles(canvasDir, canvasDir).catch(() => []);
  const kept = files.filter((file) => {
    const name = path.basename(file.path);
    if (name === CANVAS_BACKUP_LOCK_FILE) return false;
    if (name.includes('.tmp-')) return false;
    return (
      name === 'index.json' || name.endsWith('.doc.json') || name.endsWith('.deleted')
    );
  });
  const withHash = [];
  for (const file of kept) {
    withHash.push({
      ...file,
      sha256: await sha256OfFile(path.join(canvasDir, file.path)),
    });
  }
  return withHash;
}

async function copyCanvasFiles(
  canvasDir: string,
  targetDir: string,
  files: ReadonlyArray<{ path: string }>,
): Promise<void> {
  for (const file of files) {
    const target = path.join(targetDir, CANVAS_DIR_NAME, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await readFile(path.join(canvasDir, file.path)));
  }
}

/**
 * 跑一次备份。**先建目录、再写快照、最后写 manifest** —— 顺序很重要：
 * manifest 是"这个目录完整了"的标记，最后一个写它，就没有"看着有 manifest、其实快照没写完"的中间态。
 */
export async function createBackup(options: BackupOptions): Promise<BackupManifest> {
  const now = options.now?.() ?? Date.now();
  const includeOutputs = options.includeOutputs ?? true;
  const canvasDir = options.canvasDir ?? resolveCanvasDir();

  await mkdir(options.targetDir, { recursive: true });
  const entries = (await readdir(options.targetDir)).filter((name) => name !== MANIFEST_FILE_NAME);
  if (entries.length > 0) {
    throw new Error(`备份目标目录非空（${options.targetDir}）：换一个目录，避免两次备份混在一起`);
  }

  /**
   * 顺序是这条一致性声明的全部：**先锁画布、再取库快照、再拷画布、然后放锁**。
   * 反过来（先取库快照、后锁画布）会留出一个窗口：库是 T0、画布可能已是 T1。
   */
  let lock: AcquiredCanvasWriteLock | null = null;
  let canvasFiles: Array<{ path: string; bytes: number; sha256: string }> = [];
  try {
    lock = acquireCanvasWriteLock(canvasDir, {
      now,
      ...(options.pid === undefined ? {} : { pid: options.pid }),
    });

    const dbFile = path.join(options.targetDir, DB_FILE_NAME);
    await vacuumDatabaseInto(options.db, dbFile);
    const database: BackupManifest['database'] = {
      path: DB_FILE_NAME,
      bytes: (await stat(dbFile)).size,
      sha256: await sha256OfFile(dbFile),
    };

    canvasFiles = await listCanvasFiles(canvasDir);
    await copyCanvasFiles(canvasDir, options.targetDir, canvasFiles);

    const manifest: BackupManifest = {
      backupVersion: BACKUP_VERSION,
      createdAt: now,
      appVersion: options.appVersion ?? '0.1.0',
      includeOutputs,
      includeCanvas: true,
      database,
      outputs: [],
      canvas: canvasFiles.map((file) => ({
        path: `${CANVAS_DIR_NAME}/${file.path}`,
        bytes: file.bytes,
        sha256: file.sha256,
      })),
      counts: {
        tasks: countTable(options.db, 'tasks'),
        projects: countTable(options.db, 'projects'),
          canvases: canvasFiles.filter((file) => file.path.endsWith('.doc.json')).length,
        canvasTombstones: canvasFiles.filter((file) => file.path.endsWith('.deleted')).length,
      },
    };

    // 大体积媒体放在放锁之后：它不参与"画布 ↔ 任务"的对账，没必要延长画布只读窗口
    lock.release();
    lock = null;

    if (includeOutputs) {
      const files = await listFiles(options.outputsDir, options.outputsDir).catch(() => []);
      for (const file of files) {
        const source = path.join(options.outputsDir, file.path);
        const target = path.join(options.targetDir, 'outputs', file.path);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, await readFile(source));
      }
      manifest.outputs = files.map((file) => ({ ...file }));
    }

    await writeFile(
      path.join(options.targetDir, MANIFEST_FILE_NAME),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    return manifest;
  } finally {
    lock?.release();
  }
}

export interface VerifyResult {
  ok: boolean;
  /** 每一项都是"人话 + 该怎么修" */
  problems: string[];
  /** 不影响 ok、但必须让人看见的事实（旧版本备份、空画布集等） */
  notes: string[];
  manifest: BackupManifest | null;
}

/** 画布内部的引用关系（索引↔文档↔墓碑）：这层坏了，恢复出来的"画布"就是不可信的 */
async function verifyCanvasRelations(
  dir: string,
  manifest: BackupManifest,
): Promise<string[]> {
  const problems: string[] = [];
  const docs = new Map<string, string>(); // projectId → 相对路径
  const tombstones = new Set<string>();
  const canvasRoot = path.join(dir, CANVAS_DIR_NAME);

  for (const file of manifest.canvas) {
    const relative = file.path.startsWith(`${CANVAS_DIR_NAME}/`)
      ? file.path.slice(CANVAS_DIR_NAME.length + 1)
      : file.path;
    const name = path.basename(relative);
    if (name === 'index.json') continue;
    if (name.endsWith('.deleted')) {
      try {
        tombstones.add(decodeURIComponent(name.slice(0, -'.deleted'.length)));
      } catch {
        problems.push(`${file.path}：文件名不是合法的画布 id`);
      }
      continue;
    }
    if (!name.endsWith('.doc.json')) continue;
    let projectId: string;
    try {
      projectId = decodeURIComponent(name.slice(0, -'.doc.json'.length));
    } catch {
      problems.push(`${file.path}：文件名不是合法的画布 id`);
      continue;
    }
    try {
      const parsed = CanvasDocSchema.safeParse(JSON.parse(await readFile(path.join(canvasRoot, relative), 'utf8')));
      if (!parsed.success) {
        problems.push(`${file.path}：文档结构不合法（${parsed.error.issues[0]?.message ?? '未知'}）`);
        continue;
      }
      if (parsed.data.projectId !== projectId) {
        problems.push(`${file.path}：文档里的 projectId（${parsed.data.projectId}）与文件名不一致`);
        continue;
      }
      if (`${encodeURIComponent(projectId)}.doc.json` !== name) {
        problems.push(`${file.path}：文件名不是该 projectId 的规范转义`);
        continue;
      }
      docs.set(projectId, relative);
    } catch (error) {
      problems.push(`${file.path}：读不出或不是 JSON（${error instanceof Error ? error.message : String(error)}）`);
    }
  }

  for (const projectId of docs.keys()) {
    if (tombstones.has(projectId)) {
      problems.push(`画布 ${projectId} 同时存在文档与删除墓碑（状态矛盾）`);
    }
  }

  const indexEntry = manifest.canvas.find((file) => path.basename(file.path) === 'index.json');
  if (indexEntry !== undefined) {
    try {
      const parsed = CanvasProjectIndexSchema.safeParse(
        JSON.parse(await readFile(path.join(dir, indexEntry.path), 'utf8')),
      );
      if (!parsed.success) {
        problems.push(`canvas/index.json：结构不合法（${parsed.error.issues[0]?.message ?? '未知'}）`);
      } else {
        for (const project of parsed.data.projects) {
          if (!docs.has(project.projectId)) {
            problems.push(`canvas/index.json 列出的画布 ${project.projectId} 没有对应文档`);
          }
          if (tombstones.has(project.projectId)) {
            problems.push(`canvas/index.json 列出的画布 ${project.projectId} 已被删除（墓碑存在）`);
          }
        }
      }
    } catch (error) {
      problems.push(`canvas/index.json：读不出或不是 JSON（${error instanceof Error ? error.message : String(error)}）`);
    }
  }

  if (manifest.counts.canvases !== docs.size) {
    problems.push(
      `manifest 记的画布数（${manifest.counts.canvases}）与实际文档数（${docs.size}）不符`,
    );
  }
  return problems;
}

/**
 * 校验一份备份：manifest 可解析 + 版本兼容 + DB 的 sha256 + 每个文件的字节数/哈希 +
 * 画布引用关系（索引↔文档↔墓碑）。
 * **返回问题清单而不是抛** —— CLI 与测试都要能逐条展示"哪里不对"。
 */
export async function verifyBackup(dir: string): Promise<VerifyResult> {
  const problems: string[] = [];
  const notes: string[] = [];
  let manifest: BackupManifest | null = null;

  try {
    const raw = await readFile(path.join(dir, MANIFEST_FILE_NAME), 'utf8');
    const parsed = BackupManifestSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return { ok: false, problems: [`manifest 形状不对：${parsed.error.message}`], notes, manifest: null };
    }
    manifest = parsed.data;
  } catch (error) {
    return {
      ok: false,
      problems: [`读不到 manifest.json：${error instanceof Error ? error.message : String(error)}`],
      notes,
      manifest: null,
    };
  }

  if (manifest.backupVersion > BACKUP_VERSION) {
    problems.push(
      `备份来自更新的版本（backupVersion=${manifest.backupVersion} > 本机 ${BACKUP_VERSION}）：请先升级服务再恢复`,
    );
  }
  if (manifest.backupVersion < BACKUP_VERSION && !manifest.includeCanvas) {
    notes.push(
      `这份备份来自旧格式（backupVersion=${manifest.backupVersion}）：**不含画布文档/墓碑**。` +
        '恢复会保留目标现有的画布，不能声称完成了完整画布恢复。',
    );
  }

  const dbFile = path.join(dir, manifest.database.path);
  try {
    const info = await stat(dbFile);
    if (info.size !== manifest.database.bytes) {
      problems.push(`app.db 体积不符（快照 ${manifest.database.bytes} / 实际 ${info.size}）`);
    } else if (manifest.database.sha256 !== undefined) {
      const actual = await sha256OfFile(dbFile);
      if (actual !== manifest.database.sha256) {
        problems.push('app.db 的 sha256 不匹配（文件被改过或复制不完整）');
      }
    }
  } catch {
    problems.push('app.db 不存在');
  }

  for (const file of manifest.outputs) {
    const target = path.join(dir, 'outputs', file.path);
    try {
      const info = await stat(target);
      if (info.size !== file.bytes) {
        problems.push(`${file.path} 体积不符（清单 ${file.bytes} / 实际 ${info.size}）`);
      }
    } catch {
      problems.push(`${file.path} 缺失`);
    }
  }

  for (const file of manifest.canvas) {
    const target = path.join(dir, file.path);
    try {
      const info = await stat(target);
      if (info.size !== file.bytes) {
        problems.push(`${file.path} 体积不符（清单 ${file.bytes} / 实际 ${info.size}）`);
        continue;
      }
      if (file.sha256 !== undefined) {
        const actual = await sha256OfFile(target);
        if (actual !== file.sha256) {
          problems.push(`${file.path} 的 sha256 不匹配（文件被改过或复制不完整）`);
        }
      }
    } catch {
      problems.push(`${file.path} 缺失`);
    }
  }

  if (manifest.includeCanvas) {
    problems.push(...(await verifyCanvasRelations(dir, manifest)));
    if (manifest.canvas.length === 0) {
      notes.push('这份备份的画布集为空（备份时确实没有任何画布）');
    }
  } else if (manifest.canvas.length > 0) {
    problems.push('manifest 声明不含画布，却列出了画布文件（自相矛盾）');
  }

  return { ok: problems.length === 0, problems, notes, manifest };
}

/**
 * 恢复时"能不能独占数据库"的判据：拿一次写锁（拿不到 = 有人在写，说明服务还在跑）。
 *
 * ⚠️ 必须**临时**把 `busy_timeout` 调到很小：默认 5 秒会让 CLI 在"服务确实还在跑"时白等 5 秒
 * （实测 5.5s 的探测）—— 这是个"立刻该拒绝"的判断，等待没有任何意义。
 * 探测完把原值放回去，不留副作用。
 */
export function canTakeExclusiveLock(db: Db): boolean {
  const previous = db.pragma('busy_timeout', { simple: true }) as number;
  try {
    db.pragma('busy_timeout = 200');
    db.exec('BEGIN IMMEDIATE');
    db.exec('ROLLBACK');
    return true;
  } catch {
    return false;
  } finally {
    db.pragma(`busy_timeout = ${Number.isFinite(previous) ? previous : 5000}`);
  }
}

export interface RestoreResult {
  restoredFiles: number;
  restoredCanvasFiles: number;
  /** 这份备份是否真的恢复了画布（旧备份 / 不含画布时 false —— 目标画布保持原样） */
  canvasRestored: boolean;
  counts: BackupManifest['counts'];
  /** 恢复前自动备份到的目录（**防呆**：恢复错了还能回去） */
  preRestoreBackupDir: string | null;
}

export interface PreparedRestore {
  manifest: BackupManifest;
  /** 恢复前自动备份到的目录（**防呆**：恢复错了还能回去） */
  preRestoreBackupDir: string | null;
}

/**
 * 恢复的**第一阶段**：校验备份 + 把当前状态备一份（防呆）。
 *
 * ⚠️ 这一步**必须**在关掉数据库连接**之前**做 —— 第二阶段会替换 `app.db` 文件，
 * 而那些文件正被连接持有时去替换（尤其 Windows）会失败或写出坏库。
 * 因此恢复被拆成两阶段，CLI 负责编排"先 prepare → 关连接 → 再 apply"。
 */
export async function prepareRestore(options: {
  backupDir: string;
  outputsDir: string;
  db: Db;
  canvasDir?: string;
  /** 恢复前备份到哪；给 null 表示调用方自己负责（不建议） */
  preRestoreDir?: string | null;
  appVersion?: string;
  now?: () => number;
}): Promise<PreparedRestore> {
  const verified = await verifyBackup(options.backupDir);
  if (!verified.ok || verified.manifest === null) {
    throw new Error(`备份校验不通过，未改动任何数据：\n  - ${verified.problems.join('\n  - ')}`);
  }
  const manifest = verified.manifest;

  let preRestoreBackupDir: string | null = null;
  if (options.preRestoreDir !== null) {
    const target =
      options.preRestoreDir ??
      path.join(options.backupDir, '..', `pre-restore-${backupDirName('state', options.now?.() ?? Date.now())}`);
    preRestoreBackupDir = target;
    await createBackup({
      db: options.db,
      outputsDir: options.outputsDir,
      targetDir: target,
      ...(options.canvasDir === undefined ? {} : { canvasDir: options.canvasDir }),
      ...(options.appVersion === undefined ? {} : { appVersion: options.appVersion }),
      includeOutputs: manifest.includeOutputs,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  }

  return { manifest, preRestoreBackupDir };
}

/**
 * 恢复的**第二阶段**：整体替换 `data/app.db`、`outputs/` 与 `canvas/`。
 * **前置：数据库连接已关闭**（CLI 在两步之间关连接；测试自己保证）。
 * `dataDir` 是 `app.db` 所在目录。恢复的语义是"回到那一刻"，不是"合并"。
 *
 * 旧备份（不含画布）**不删除目标画布**：那不是"恢复成空画布"，而是"这份备份没有画布信息"——
 * 静默清空用户现存画布是数据丢失，不是恢复。
 */
export async function applyRestore(options: {
  backupDir: string;
  dataDir: string;
  outputsDir: string;
  canvasDir?: string;
  manifest: BackupManifest;
}): Promise<RestoreResult> {
  const manifest = options.manifest;
  const canvasDir = options.canvasDir ?? resolveCanvasDir();

  await mkdir(options.dataDir, { recursive: true });
  // WAL 与 SHM 是**派生文件**：留着它们去配一个新拷来的库，正是"恢复出一个坏库"的经典成因
  for (const suffix of ['', '-wal', '-shm']) {
    await rm(path.join(options.dataDir, `app.db${suffix}`), { force: true });
  }
  await writeFile(
    path.join(options.dataDir, 'app.db'),
    await readFile(path.join(options.backupDir, manifest.database.path)),
  );

  let restoredFiles = 0;
  if (manifest.includeOutputs) {
    await rm(options.outputsDir, { recursive: true, force: true });
    for (const file of manifest.outputs) {
      const target = path.join(options.outputsDir, file.path);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, await readFile(path.join(options.backupDir, 'outputs', file.path)));
      restoredFiles += 1;
    }
  }

  let restoredCanvasFiles = 0;
  const canvasRestored = manifest.includeCanvas;
  if (canvasRestored) {
    await rm(canvasDir, { recursive: true, force: true });
    for (const file of manifest.canvas) {
      const target = path.join(canvasDir, file.path.replace(`${CANVAS_DIR_NAME}/`, ''));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, await readFile(path.join(options.backupDir, file.path)));
      restoredCanvasFiles += 1;
    }
  }

  return {
    restoredFiles,
    restoredCanvasFiles,
    canvasRestored,
    counts: manifest.counts,
    preRestoreBackupDir: null,
  };
}

/** 备份目录名：`<前缀>-YYYYMMDD-HHMMSS`（本地时区；人读为主，不承诺时区语义） */
export function backupDirName(prefix: string, now: number): string {
  const date = new Date(now);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${prefix}-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
