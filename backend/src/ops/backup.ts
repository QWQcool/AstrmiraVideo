import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Db } from '../store/db.js';

/**
 * 备份与恢复（V2.17 / 台账 B52 片 A）。
 *
 * ## 为什么备份必须是一次 `VACUUM INTO` 而不是 `cp data/app.db`
 * 本服务用 WAL 模式（`db.ts` 的 `journal_mode = WAL`）：**直接拷 `app.db` 可能拿到一个
 * 缺了最近事务、甚至内部不一致的库**（最新数据还在 `-wal` 里）。`VACUUM INTO` 是 SQLite
 * 原生的**一致性快照**：它在一个读事务里把整个库重写到目标文件，产出的就是一个可以直接打开的完整库。
 * 这是"备份能不能用来恢复"的分界线 —— 一份拷出来的坏库只有在真正要恢复的那天才被发现。
 *
 * ## 产出的形态：**一个目录**，不是 tar
 * `backups/<时间戳>/` = `app.db`（一致性快照）+ `manifest.json` + （可选）`outputs/`。
 * 不打包成 tar/zip 的理由：运维要能用**任何**工具处理它（rsync 增量、tar、对象存储 CLI），
 * 而且大体积成片不该在我们的进程里过一遍内存。
 *
 * ## 三条纪律
 * 1. **恢复前先自动备份当前状态**（`pre-restore-<时间戳>/`）—— 恢复错了还能回去；
 * 2. **校验不通过就不动数据**（DB 的 sha256 + 每个文件的字节数都必须对得上）；
 * 3. **恢复要求服务已停止**：拿一次独占写锁来判定（拿不到就是有人在写，直接拒绝）。
 */

export const BACKUP_VERSION = 1;

export const BackupFileSchema = z.object({
  /** 相对备份根的路径（如 `app.db` / `outputs/<taskId>.mp4`） */
  path: z.string(),
  bytes: z.number().int().nonnegative(),
  /** 只对 `app.db` 计算（大文件逐字节 hash 的代价与收益不成比例，见文件头） */
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
  database: BackupFileSchema,
  outputs: z.array(BackupFileSchema),
  /** 备份时的用量快照（恢复后对账用："应该有多少条任务 / 多少资产"） */
  counts: z.object({
    tasks: z.number().int(),
    projects: z.number().int(),
    webhooks: z.number().int(),
  }),
});
export type BackupManifest = z.infer<typeof BackupManifestSchema>;

const DB_FILE_NAME = 'app.db';
const MANIFEST_FILE_NAME = 'manifest.json';

export interface BackupOptions {
  /** 数据库连接（用它做 VACUUM INTO） */
  db: Db;
  /** 输出根目录（`outputs/` 的父目录 → 实际是 outputsDir 本身） */
  outputsDir: string;
  /** 备份写到哪（会被创建；**必须为空或不存在**，避免把两次备份混在一起） */
  targetDir: string;
  appVersion?: string;
  /** 是否把成片与资产一起备份（默认 true；只备数据库时给 false） */
  includeOutputs?: boolean;
  now?: () => number;
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

/**
 * 跑一次备份。**先建目录、再写快照、最后写 manifest** —— 顺序很重要：
 * manifest 是"这个目录完整了"的标记，最后一个写它，就没有"看着有 manifest、其实快照没写完"的中间态。
 */
export async function createBackup(options: BackupOptions): Promise<BackupManifest> {
  const now = options.now?.() ?? Date.now();
  const includeOutputs = options.includeOutputs ?? true;

  await mkdir(options.targetDir, { recursive: true });
  const entries = (await readdir(options.targetDir)).filter((name) => name !== MANIFEST_FILE_NAME);
  if (entries.length > 0) {
    throw new Error(`备份目标目录非空（${options.targetDir}）：换一个目录，避免两次备份混在一起`);
  }

  const dbFile = path.join(options.targetDir, DB_FILE_NAME);
  await vacuumDatabaseInto(options.db, dbFile);

  const database: BackupManifest['database'] = {
    path: DB_FILE_NAME,
    bytes: (await stat(dbFile)).size,
    sha256: await sha256OfFile(dbFile),
  };

  let outputs: BackupManifest['outputs'] = [];
  if (includeOutputs) {
    const files = await listFiles(options.outputsDir, options.outputsDir).catch(() => []);
    for (const file of files) {
      const source = path.join(options.outputsDir, file.path);
      const target = path.join(options.targetDir, 'outputs', file.path);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, await readFile(source));
    }
    outputs = files.map((file) => ({ ...file }));
  }

  const manifest: BackupManifest = {
    backupVersion: BACKUP_VERSION,
    createdAt: now,
    appVersion: options.appVersion ?? '0.1.0',
    includeOutputs,
    database,
    outputs,
    counts: {
      tasks: countTable(options.db, 'tasks'),
      projects: countTable(options.db, 'projects'),
      webhooks: countTable(options.db, 'webhooks'),
    },
  };

  await writeFile(
    path.join(options.targetDir, MANIFEST_FILE_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  return manifest;
}

export interface VerifyResult {
  ok: boolean;
  /** 每一项都是"人话 + 该怎么修" */
  problems: string[];
  manifest: BackupManifest | null;
}

/**
 * 校验一份备份：manifest 可解析 + 版本兼容 + DB 的 sha256 对得上 + 每个文件字节数对得上。
 * **返回问题清单而不是抛** —— CLI 与测试都要能逐条展示"哪里不对"。
 */
export async function verifyBackup(dir: string): Promise<VerifyResult> {
  const problems: string[] = [];
  let manifest: BackupManifest | null = null;

  try {
    const raw = await readFile(path.join(dir, MANIFEST_FILE_NAME), 'utf8');
    const parsed = BackupManifestSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return { ok: false, problems: [`manifest 形状不对：${parsed.error.message}`], manifest: null };
    }
    manifest = parsed.data;
  } catch (error) {
    return {
      ok: false,
      problems: [`读不到 manifest.json：${error instanceof Error ? error.message : String(error)}`],
      manifest: null,
    };
  }

  if (manifest.backupVersion > BACKUP_VERSION) {
    problems.push(
      `备份来自更新的版本（backupVersion=${manifest.backupVersion} > 本机 ${BACKUP_VERSION}）：请先升级服务再恢复`,
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

  return { ok: problems.length === 0, problems, manifest };
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
      ...(options.appVersion === undefined ? {} : { appVersion: options.appVersion }),
      includeOutputs: manifest.includeOutputs,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  }

  return { manifest, preRestoreBackupDir };
}

/**
 * 恢复的**第二阶段**：整体替换 `data/app.db` 与 `outputs/`。
 * **前置：数据库连接已关闭**（CLI 在两步之间关连接；测试自己保证）。
 * `dataDir` 是 `app.db` 所在目录。恢复的语义是"回到那一刻"，不是"合并"。
 */
export async function applyRestore(options: {
  backupDir: string;
  dataDir: string;
  outputsDir: string;
  manifest: BackupManifest;
}): Promise<RestoreResult> {
  const manifest = options.manifest;

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

  return { restoredFiles, counts: manifest.counts, preRestoreBackupDir: null };
}

/** 备份目录名：`<前缀>-YYYYMMDD-HHMMSS`（本地时区；人读为主，不承诺时区语义） */
export function backupDirName(prefix: string, now: number): string {
  const date = new Date(now);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${prefix}-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
