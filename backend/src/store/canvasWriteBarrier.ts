import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 画布写入闸门（B95 / CONTRACT §17 一致性策略）。
 *
 * ## 为什么备份需要它
 * 画布文档是**浏览器侧整份写、服务端按文件存**的（§21-8），与 `app.db` 是两套持久化。
 * 如果备份期间画布还在写，就会得到"数据库是 T0、画布是 T1"的拼装快照 —— 这种快照
 * 看起来完整，恢复后却可能引用一个 T0 时还不存在的任务。
 *
 * 因此备份在**取数据库快照之前**先落一把锁；服务端的画布保存 / 删除 / 切活动项目
 * 看到这把锁就明确拒绝（409），而不是静默写进一个"不会被备走"的时间窗。
 * 锁窗口内画布集合不变 ⇒ 画布引用的任务都早于数据库快照 ⇒ 两者可对账。
 *
 * ## 为什么有 TTL
 * 备份进程崩溃会留下锁文件。若永久生效，画布就再也存不进去了 ——
 * 超过 `CANVAS_BACKUP_LOCK_TTL_MS` 的锁按**陈旧锁**处理（可覆盖），并给运维留一句人话。
 *
 * ## 为什么不是数据库事务锁
 * 画布写入不经过 `app.db`，数据库的 `BEGIN IMMEDIATE` 挡不住它。
 */

export const CANVAS_BACKUP_LOCK_FILE = '.backup.lock';
/** 陈旧锁阈值：一次备份远小于这个时长；超过就按"上次备份异常退出"处理 */
export const CANVAS_BACKUP_LOCK_TTL_MS = 10 * 60 * 1000;

export function canvasBackupLockPath(canvasDir: string): string {
  return path.join(canvasDir, CANVAS_BACKUP_LOCK_FILE);
}

export interface CanvasWriteLock {
  path: string;
  /** 是否有别的备份正在进行（陈旧锁不算） */
  active: boolean;
  ageMs: number;
}

/** 只读探测（画布写入路径用；不创建目录、不改文件） */
export function inspectCanvasWriteLock(
  canvasDir: string,
  now: number = Date.now(),
): CanvasWriteLock {
  const lockPath = canvasBackupLockPath(canvasDir);
  if (!existsSync(lockPath)) return { path: lockPath, active: false, ageMs: 0 };
  try {
    const ageMs = Math.max(0, now - statSync(lockPath).mtimeMs);
    return { path: lockPath, active: ageMs <= CANVAS_BACKUP_LOCK_TTL_MS, ageMs };
  } catch {
    // 读不到 = 当作没有锁：一个坏文件不该让用户永远存不了画布
    return { path: lockPath, active: false, ageMs: 0 };
  }
}

export interface AcquiredCanvasWriteLock {
  /** 本次是否接管了一把陈旧锁（调用方据此给人话提示） */
  tookStaleLock: boolean;
  release(): void;
}

/**
 * 备份侧：拿锁。已有**活的**锁 → 抛错（不排队，避免两个备份互相覆盖同一份产物）。
 * 拿锁失败不应该让备份冒险继续 —— 那正是"不同时点拼装"的来源。
 */
export function acquireCanvasWriteLock(
  canvasDir: string,
  options: { now?: number; pid?: number } = {},
): AcquiredCanvasWriteLock {
  const now = options.now ?? Date.now();
  mkdirSync(canvasDir, { recursive: true });
  const lockPath = canvasBackupLockPath(canvasDir);
  const current = inspectCanvasWriteLock(canvasDir, now);
  if (current.active) {
    throw new Error(
      `另一个备份正在进行（${lockPath}，${Math.round(current.ageMs / 1000)}s 前创建）：` +
        '等它结束再备份。若确认是上次异常退出留下的陈旧锁，等 10 分钟后再试。',
    );
  }
  const tookStaleLock = existsSync(lockPath);
  if (tookStaleLock) rmSync(lockPath, { force: true });
  writeFileSync(
    lockPath,
    `${JSON.stringify({ pid: options.pid ?? process.pid, startedAt: now, purpose: 'backup' })}\n`,
    'utf8',
  );
  let released = false;
  return {
    tookStaleLock,
    release() {
      if (released) return;
      released = true;
      try {
        rmSync(lockPath, { force: true });
      } catch {
        // 删不掉只影响下一次备份（会被当成陈旧锁）；不掩盖已经完成的备份结果
      }
    },
  };
}

/** 画布写入路径用：备份进行中就明确拒绝（带人话理由） */
export function canvasWriteBlockedReason(canvasDir: string, now?: number): string | null {
  const state = inspectCanvasWriteLock(canvasDir, now);
  if (!state.active) return null;
  return (
    '备份正在进行，画布暂时只读：本次保存没有写入，也不会丢失你的编辑。' +
    `请等备份结束（约 ${Math.max(1, Math.round((CANVAS_BACKUP_LOCK_TTL_MS - state.ageMs) / 1000))}s 内自动解除）后重试。`
  );
}
