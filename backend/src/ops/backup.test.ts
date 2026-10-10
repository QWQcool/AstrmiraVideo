import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../store/db.js';
import {
  applyRestore,
  backupDirName,
  canTakeExclusiveLock,
  createBackup,
  prepareRestore,
  vacuumDatabaseInto,
  verifyBackup,
} from './backup.js';
import {
  acquireServerLock,
  inspectServerLock,
  isProcessAlive,
  readServerLock,
} from './serverLock.js';

/**
 * 备份与恢复（V2.17 / 台账 B52 片 A）。
 *
 * 断言侧重**四件"只有真跑一遍才会发现"的事**：
 * ① `VACUUM INTO` 的快照**能直接打开**（这正是"拷 app.db 可能在恢复那天才发现坏"的分界）；
 * ② **坏备份不许动数据**（校验不通过时，现场一个字节都不该变）；
 * ③ 恢复是**整体替换**（不是合并）：恢复后库里的内容与备份那一刻**逐条一致**；
 * ④ 恢复前**自动备当前状态**（防呆——恢复错了还能回去）。
 */

const FIXED_NOW = 1_700_000_000_000;

interface Sandbox {
  root: string;
  dataDir: string;
  outputsDir: string;
  backupsDir: string;
}

function makeSandbox(): Sandbox {
  const root = mkdtempSync(path.join(tmpdir(), 'astrmira-backup-'));
  const dataDir = path.join(root, 'data');
  const outputsDir = path.join(root, 'outputs');
  const backupsDir = path.join(root, 'backups');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(outputsDir, { recursive: true });
  mkdirSync(backupsDir, { recursive: true });
  return { root, dataDir, outputsDir, backupsDir };
}

function insertTask(db: Db, taskId: string): void {
  db.prepare(
    `INSERT INTO tasks (task_id, track, provider, status, progress_percent, request_snapshot,
                        warnings, submitting, project_id, created_at, updated_at)
     VALUES (?, 'cloud', 'stub', 'succeeded', 100, '{"prompt":"备份用例"}', '[]', 0, 'default', ?, ?)`,
  ).run(taskId, FIXED_NOW, FIXED_NOW);
}

function countTasks(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS count FROM tasks').get() as { count: number }).count;
}

describe('备份与恢复（B52 片 A）', () => {
  let box: Sandbox;
  let db: Db;

  beforeEach(() => {
    box = makeSandbox();
    db = openDatabase(path.join(box.dataDir, 'app.db'));
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* 用例里可能已关过 */
    }
    rmSync(box.root, { recursive: true, force: true });
  });

  it('备份：产出一致快照 + manifest（含条数与 sha256），且快照**能直接打开**', async () => {
    insertTask(db, 'task-1');
    insertTask(db, 'task-2');
    writeFileSync(path.join(box.outputsDir, 'task-1.mp4'), Buffer.alloc(1024, 7));

    const target = path.join(box.backupsDir, 'backup-1');
    const manifest = await createBackup({
      db,
      outputsDir: box.outputsDir,
      targetDir: target,
      now: () => FIXED_NOW,
    });

    expect(manifest.counts.tasks).toBe(2);
    expect(manifest.outputs).toEqual([{ path: 'task-1.mp4', bytes: 1024 }]);
    expect(manifest.database.sha256).toMatch(/^[0-9a-f]{64}$/);

    // ⚠️ 顺序有讲究：**先校验、后打开**。
    // 用 `openDatabase` 打开一份快照会**改写它**（幂等迁移 + 启动引导会写库、还会生成 -wal），
    // 于是 sha256 就不匹配了 —— 这是运维真实会踩的坑：'拿服务打开一下看看' 之后校验就再也不过了。
    const verified = await verifyBackup(target);
    expect(verified.ok).toBe(true);
    expect(verified.problems).toEqual([]);

    // 关键证据：把快照**当成一个库**打开，数据在里面（不是"看起来有个文件"）
    const snapshot = openDatabase(path.join(target, 'app.db'));
    try {
      expect(countTasks(snapshot)).toBe(2);
    } finally {
      snapshot.close();
    }
  });

  it('备份目标目录非空 → 直接拒绝（避免两次备份混在一起）', async () => {
    const target = path.join(box.backupsDir, 'backup-1');
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, 'leftover.txt'), 'x');
    await expect(
      createBackup({ db, outputsDir: box.outputsDir, targetDir: target }),
    ).rejects.toThrow('非空');
  });

  it('verify：DB 被改过 → sha256 不匹配；文件缺了 → 报缺失；**都不改数据**', async () => {
    insertTask(db, 'task-1');
    writeFileSync(path.join(box.outputsDir, 'task-1.mp4'), Buffer.alloc(64, 1));
    const target = path.join(box.backupsDir, 'backup-1');
    await createBackup({ db, outputsDir: box.outputsDir, targetDir: target });

    // 场景 A：快照的字节被改过（复制不完整 / 被手工编辑）
    const dbPath = path.join(target, 'app.db');
    const original = readFileSync(dbPath);
    writeFileSync(dbPath, Buffer.concat([original, Buffer.from('tampered')]));
    const tampered = await verifyBackup(target);
    expect(tampered.ok).toBe(false);
    expect(tampered.problems.join(' ')).toContain('体积不符');

    // 场景 B：文件缺失
    writeFileSync(dbPath, original);
    rmSync(path.join(target, 'outputs', 'task-1.mp4'));
    const missing = await verifyBackup(target);
    expect(missing.ok).toBe(false);
    expect(missing.problems.join(' ')).toContain('task-1.mp4 缺失');
  });

  it('备份来自更新的版本 → 校验提示"先升级服务"（版本闸门）', async () => {
    const target = path.join(box.backupsDir, 'backup-1');
    await createBackup({ db, outputsDir: box.outputsDir, targetDir: target });
    const manifestPath = path.join(target, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { backupVersion: number };
    manifest.backupVersion = 99;
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const result = await verifyBackup(target);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('请先升级服务');
  });

  it('恢复：整体替换（备份之后新增的任务**消失**），且恢复前自动备了当前状态', async () => {
    insertTask(db, 'task-1');
    const target = path.join(box.backupsDir, 'backup-1');
    await createBackup({ db, outputsDir: box.outputsDir, targetDir: target, now: () => FIXED_NOW });

    // 备份之后又生成了新任务（恢复应该把它"退回去"）
    insertTask(db, 'task-2');
    expect(countTasks(db)).toBe(2);

    const prepared = await prepareRestore({
      backupDir: target,
      outputsDir: box.outputsDir,
      db,
      preRestoreDir: path.join(box.backupsDir, 'pre-restore'),
      now: () => FIXED_NOW,
    });
    expect(prepared.preRestoreBackupDir).toBe(path.join(box.backupsDir, 'pre-restore'));
    db.close(); // 第二阶段前必须关连接（CLI 里由编排保证）

    const result = await applyRestore({
      backupDir: target,
      dataDir: box.dataDir,
      outputsDir: box.outputsDir,
      manifest: prepared.manifest,
    });
    expect(result.counts.tasks).toBe(1);

    const restored = openDatabase(path.join(box.dataDir, 'app.db'));
    try {
      expect(countTasks(restored)).toBe(1);
      const row = restored.prepare('SELECT task_id FROM tasks').get() as { task_id: string };
      expect(row.task_id).toBe('task-1');
    } finally {
      restored.close();
    }

    // 防呆：恢复前的状态（含 task-2）确实被备下来了
    const safety = openDatabase(path.join(box.backupsDir, 'pre-restore', 'app.db'));
    try {
      expect(countTasks(safety)).toBe(2);
    } finally {
      safety.close();
    }
  });

  it('恢复：校验不通过时**一个字节都不动**（现场任务仍在）', async () => {
    const target = path.join(box.backupsDir, 'backup-1');
    await createBackup({ db, outputsDir: box.outputsDir, targetDir: target });
    // 把快照改坏
    const dbPath = path.join(target, 'app.db');
    writeFileSync(dbPath, Buffer.concat([readFileSync(dbPath), Buffer.from('x')]));

    await expect(
      prepareRestore({ backupDir: target, outputsDir: box.outputsDir, db }),
    ).rejects.toThrow('校验不通过');
    expect(countTasks(db)).toBe(0); // 现场未被改动（这个库本来就还没任务）
  });

  it('独占写锁判定：能拿到 → 可以恢复；另开一个写事务占着 → 判定为"服务还在跑"', () => {
    expect(canTakeExclusiveLock(db)).toBe(true);

    // 另开一条连接，持有一个写事务（模拟正在写入的服务）
    const other = openDatabase(path.join(box.dataDir, 'app.db'));
    other.exec('BEGIN IMMEDIATE');
    try {
      expect(canTakeExclusiveLock(db)).toBe(false);
    } finally {
      other.exec('ROLLBACK');
      other.close();
    }
  });

  it('VACUUM INTO 目标已存在时先删（否则 SQLite 直接报错）', async () => {
    const file = path.join(box.root, 'snapshot.db');
    writeFileSync(file, 'stale');
    await vacuumDatabaseInto(db, file);
    const snapshot = openDatabase(file);
    try {
      expect(countTasks(snapshot)).toBe(0);
    } finally {
      snapshot.close();
    }
  });

  it('只备数据库（--no-outputs）时 manifest 如实标注、恢复不碰成片目录', async () => {
    insertTask(db, 'task-1');
    writeFileSync(path.join(box.outputsDir, 'task-1.mp4'), Buffer.alloc(16, 1));
    const target = path.join(box.backupsDir, 'db-only');
    const manifest = await createBackup({
      db,
      outputsDir: box.outputsDir,
      targetDir: target,
      includeOutputs: false,
    });
    expect(manifest.includeOutputs).toBe(false);
    expect(manifest.outputs).toEqual([]);

    db.close();
    await applyRestore({
      backupDir: target,
      dataDir: box.dataDir,
      outputsDir: box.outputsDir,
      manifest,
    });
    // 成片目录未被删除（"只恢复数据库"不该顺手把片子删了）
    expect(readFileSync(path.join(box.outputsDir, 'task-1.mp4')).length).toBe(16);
  });

  it('备份目录名：可读的本地时间戳（运维要在 ls 里一眼认出哪份最新）', () => {
    const name = backupDirName('backup', new Date(2026, 9, 10, 9, 5, 3).getTime());
    expect(name).toBe('backup-20261010-090503');
  });
});

/**
 * 服务进程锁（V2.17 / B52）。
 *
 * 这组用例的存在理由是一条**实测缺口**：恢复的第一版只查"数据库写锁"，
 * 而**空闲的服务不持有写锁** → 判定放行 → 在 Linux 上会静默地把 app.db 换掉（数据损坏级）。
 * 所以"服务在不在跑"必须由服务自己声明，且**陈旧锁不能挡住灾难恢复**。
 */
describe('服务进程锁（B52 片 A）', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'astrmira-lock-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('没有锁文件 = 没有服务在跑（常态，不是错误）', () => {
    expect(inspectServerLock(dir)).toEqual({ running: false, info: null, stale: false });
  });

  it('写锁后能读到自己的 pid；**当前进程**判定为"在跑"；释放后文件消失', () => {
    const lock = acquireServerLock(dir, { version: 'test' });
    const state = inspectServerLock(dir);
    expect(state.running).toBe(true);
    expect(state.info?.pid).toBe(process.pid);
    expect(state.stale).toBe(false);

    lock.release();
    expect(readServerLock(dir)).toBeNull();
  });

  it('陈旧锁（进程已不存在）→ 如实标 stale，**但不当作"在跑"**（异常退出后还能恢复）', () => {
    // 用一个几乎不可能存在的 pid 手工写一把锁
    writeFileSync(
      path.join(dir, 'server.lock'),
      JSON.stringify({ pid: 999_999, startedAt: FIXED_NOW, version: 'test' }),
    );
    const state = inspectServerLock(dir);
    expect(state.running).toBe(false);
    expect(state.stale).toBe(true);
    expect(isProcessAlive(999_999)).toBe(false);
  });

  it('接管时给提示：已有一个活着的锁 → 警告"两个进程同时写库是危险的"', () => {
    // 同进程再 acquire 一次会看到"自己"那把锁（pid 相同、活着）→ 应当给出警告
    const first = acquireServerLock(dir, { version: 'test' });
    const second = acquireServerLock(dir, { version: 'test' });
    expect(second.warn).toContain('另一个服务进程');
    second.release();
    // ⚠️ 后写的那把已经覆盖了前一把，且 release 只删自己写的 —— 前一把的 release 不该误删
    expect(readServerLock(dir)).toBeNull();
    first.release();
    expect(readServerLock(dir)).toBeNull();
  });

  it('锁文件内容坏掉 → 当作"没有锁"（坏文件不该让备份/恢复罢工）', () => {
    writeFileSync(path.join(dir, 'server.lock'), '{ not json');
    expect(readServerLock(dir)).toBeNull();
    expect(inspectServerLock(dir).running).toBe(false);
  });
});
