import path from 'node:path';
import {
  applyRestore,
  backupDirName,
  canTakeExclusiveLock,
  createBackup,
  prepareRestore,
  verifyBackup,
} from './backup.js';
import { openDatabase, resolveDatabasePath } from '../store/db.js';
import { resolveOutputsDir } from '../server/staticOutputs.js';
import { inspectServerLock } from './serverLock.js';

/**
 * 运维 CLI（V2.17 / 台账 B52 片 A）：`backup` / `verify` / `restore`。
 *
 * 用法（**必须先 `pnpm build`** —— 与 UI 冒烟同一前提）：
 * ```bash
 * node backend/dist/ops/cli.js backup  [--out <dir>] [--no-outputs]
 * node backend/dist/ops/cli.js verify  <backupDir>
 * node backend/dist/ops/cli.js restore <backupDir> --yes
 * ```
 *
 * ## 三条安全默认（都是"防呆"而不是"防坏人"）
 * 1. `restore` **必须带 `--yes`**：它是不可逆的整体替换，敲一次命令就换掉整个库与成片目录；
 * 2. `restore` 前**先自动备份当前状态**（`pre-restore-*` 目录）；
 * 3. `restore` 前检查**能否拿到独占写锁** —— 拿不到说明服务还在跑，直接拒绝（半途被写会得到一个坏库）。
 */

const USAGE = `用法：
  node backend/dist/ops/cli.js backup  [--out <dir>] [--no-outputs]
  node backend/dist/ops/cli.js verify  <backupDir>
  node backend/dist/ops/cli.js restore <backupDir> --yes

环境：DATA_DIR（数据目录，默认 ./data）、OUTPUT_DIR（成片目录，默认 ./outputs）

范围：app.db + data/canvas（文档/索引/墓碑，总是包含）+ outputs（--no-outputs 只影响媒体）。
备份期间画布保存会被明确拒绝（409），以保证数据库快照与画布集合是同一时点。`;

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} 后面要跟一个值`);
  }
  return value;
}

async function runBackup(args: string[]): Promise<number> {
  const dataDir = path.dirname(resolveDatabasePath());
  const outputsDir = resolveOutputsDir();
  const canvasDir = path.join(dataDir, 'canvas');
  const target =
    readFlag(args, '--out') ?? path.join(dataDir, 'backups', backupDirName('backup', Date.now()));
  const includeOutputs = !args.includes('--no-outputs');

  const db = openDatabase();
  try {
    const manifest = await createBackup({
      db,
      outputsDir,
      canvasDir,
      targetDir: target,
      includeOutputs,
    });
    console.log(`✓ 备份完成：${target}`);
    console.log(
      `  库：${(manifest.database.bytes / 1024).toFixed(1)}KB · 任务 ${manifest.counts.tasks} 条 · ` +
        `项目 ${manifest.counts.projects} 个 · 成片文件 ${manifest.outputs.length} 个` +
        (includeOutputs ? '' : '（本次不含 outputs）'),
    );
    console.log(
      `  画布：${manifest.counts.canvases} 张 · 墓碑 ${manifest.counts.canvasTombstones} 个 · ` +
        `画布文件 ${manifest.canvas.length} 个（--no-outputs 不影响画布）`,
    );
    console.log('  ⚠️ 备份可在服务运行时进行（VACUUM INTO 是一致性快照）；**恢复**必须在服务停止后做。');
    return 0;
  } finally {
    db.close();
  }
}

async function runVerify(args: string[]): Promise<number> {
  const dir = args.find((arg) => !arg.startsWith('--'));
  if (dir === undefined) throw new Error('verify 需要备份目录：verify <backupDir>');

  const result = await verifyBackup(dir);
  if (result.manifest !== null) {
    const manifest = result.manifest;
    console.log(
      `备份时间 ${new Date(manifest.createdAt).toLocaleString()} · 服务版本 ${manifest.appVersion} · ` +
        `任务 ${manifest.counts.tasks} 条 · 成片 ${manifest.outputs.length} 个 · ` +
        `画布 ${manifest.includeCanvas ? `${manifest.counts.canvases} 张` : '未包含'}`,
    );
  }
  for (const note of result.notes) console.warn(`⚠️ ${note}`);
  if (!result.ok) {
    console.error('✗ 校验不通过：');
    for (const problem of result.problems) console.error(`  - ${problem}`);
    return 1;
  }
  console.log('✓ 校验通过（sha256 与逐文件字节数都对得上；画布索引↔文档↔墓碑关系一致）');
  return 0;
}

async function runRestore(args: string[]): Promise<number> {
  const dir = args.find((arg) => !arg.startsWith('--'));
  if (dir === undefined) throw new Error('restore 需要备份目录：restore <backupDir> --yes');
  if (!args.includes('--yes')) {
    throw new Error('restore 会把**整个数据库与成片目录**替换成备份里的那一份（不可逆）。确认后加 --yes。');
  }

  const dataDir = path.dirname(resolveDatabasePath());
  const outputsDir = resolveOutputsDir();
  const canvasDir = path.join(dataDir, 'canvas');

  // 三道闸门（顺序是安全性的全部）：
  //   ① **服务进程锁**（权威判据：服务自己声明的"我在跑"）；
  //   ② 数据库独占写锁（挡住"另一个运维脚本/另一个实例正在写"）；
  //   ③ 校验备份 + 备当前状态 → **关连接** → 替换文件。
  // 为什么①不能省：**空闲的服务不持有数据库写锁**（实测：只查写锁会放行，
  // 然后在 Linux 上静默地把 app.db 换掉，而服务继续往被删除的 inode 写 —— 数据损坏级）。
  const lock = inspectServerLock(dataDir);
  if (lock.running && lock.info !== null) {
    throw new Error(
      `服务还在跑（PID ${lock.info.pid}，启动于 ${new Date(lock.info.startedAt).toLocaleString()}）：` +
        '请先停止服务再恢复 —— 半途被写会得到一个坏库。',
    );
  }
  if (lock.stale && lock.info !== null) {
    console.warn(
      `⚠️ 发现陈旧的服务锁（PID ${lock.info.pid} 已不存在，可能是上次异常退出）；本次恢复按"服务已停"处理。`,
    );
  }

  const db = openDatabase();
  let prepared;
  try {
    if (!canTakeExclusiveLock(db)) {
      throw new Error(
        '数据库正被写入（另一个进程正在写）：请先停止它再恢复 —— 半途被写会得到一个坏库。',
      );
    }
    prepared = await prepareRestore({ backupDir: dir, outputsDir, canvasDir, db });
  } finally {
    db.close();
  }

  const result = await applyRestore({
    backupDir: dir,
    dataDir,
    outputsDir,
    canvasDir,
    manifest: prepared.manifest,
  });
  console.log(
    `✓ 已恢复：任务 ${result.counts.tasks} 条 · 项目 ${result.counts.projects} 个 · 成片 ${result.restoredFiles} 个`,
  );
  console.log(
    result.canvasRestored
      ? `  画布：已恢复 ${result.restoredCanvasFiles} 个文件（${result.counts.canvases} 张 · 墓碑 ${result.counts.canvasTombstones} 个）`
      : '  画布：⚠️ 这份备份不含画布 —— 目标现有画布保持原样，不能声称完成了完整画布恢复',
  );
  if (prepared.preRestoreBackupDir !== null) {
    console.log(`  恢复前的状态已备份到：${prepared.preRestoreBackupDir}`);
  }
  console.log('  下一步：启动服务，用 /api/health/ready 与 /api/metrics 确认状态。');
  return 0;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === undefined || ['-h', '--help', 'help'].includes(command)) {
    console.log(USAGE);
    return;
  }
  const code =
    command === 'backup'
      ? await runBackup(args)
      : command === 'verify'
        ? await runVerify(args)
        : command === 'restore'
          ? await runRestore(args)
          : (console.error(`未知子命令：${command}\n${USAGE}`), 2);
  process.exitCode = code;
}

await main().catch((error: unknown) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
