import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 服务进程锁（V2.17 / 台账 B52 片 A）。
 *
 * ## 为什么需要它（这是 UI 冒烟抓出来的真实缺口）
 * 恢复备份的第一版只检查"能不能拿到数据库写锁"。**实测证明它不成立**：
 * 一个**空闲**的服务进程根本不持有写锁（SQLite 的锁是"写事务期间"才拿的），
 * 于是 CLI 判定"可以恢复"，然后：
 * - Windows：`EBUSY: resource busy or locked, unlink 'app.db'` —— 至少是**响亮地失败**；
 * - **Linux（我们的部署目标）：unlink 会成功**，服务继续往那个已被删除的 inode 里写 ——
 *   运维以为恢复成功了，实际上"新库"和"跑着的服务"从此刻起各写各的。**这是数据损坏级的静默失败。**
 *
 * 结论：**"服务在不在跑"必须由服务自己声明**（锁文件 + PID），不能从数据库锁去推断。
 *
 * ## 三条口径
 * 1. 锁文件写在 `data/server.lock`（与库同目录 → 数据搬到哪、锁跟到哪）；
 * 2. 判断时**进程存活要真查一次**（`process.kill(pid, 0)`）：进程已不在 = **陈旧锁**
 *    （异常退出留下的），此时**明确提示并放行** —— 拿一把陈旧锁挡住灾难恢复是更糟的设计；
 * 3. 释放时**只删自己写的那把锁**（比对 pid），避免关服务时误删另一个实例的锁。
 */

export interface ServerLockInfo {
  pid: number;
  startedAt: number;
  version: string;
}

const LOCK_FILE_NAME = 'server.lock';

export function serverLockPath(dataDir: string): string {
  return path.join(dataDir, LOCK_FILE_NAME);
}

export function readServerLock(dataDir: string): ServerLockInfo | null {
  try {
    const raw = readFileSync(serverLockPath(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as Partial<ServerLockInfo>;
    if (typeof parsed.pid !== 'number' || typeof parsed.startedAt !== 'number') return null;
    return {
      pid: parsed.pid,
      startedAt: parsed.startedAt,
      version: typeof parsed.version === 'string' ? parsed.version : 'unknown',
    };
  } catch {
    return null; // 没有锁文件 = 没有服务在跑（这是常态，不是错误）
  }
}

/** 进程是否还活着（signal 0 = 只探测存在性，不真的发信号） */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM = 进程存在但没权限发信号（仍然算"活着"）
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface ServerLockState {
  /** 是否有**还活着**的服务进程占着这份数据 */
  running: boolean;
  info: ServerLockInfo | null;
  /** 锁文件在、但写它的进程已经不在（异常退出留下的） */
  stale: boolean;
}

export function inspectServerLock(dataDir: string): ServerLockState {
  const info = readServerLock(dataDir);
  if (info === null) return { running: false, info: null, stale: false };
  const alive = isProcessAlive(info.pid);
  return { running: alive, info, stale: !alive };
}

/**
 * 启动时写锁；返回释放函数（由 `onClose` 调用）。
 * 写失败**不阻断启动** —— 锁是运维安全设施，不该成为"服务起不来"的原因（但会留下警告）。
 */
export function acquireServerLock(
  dataDir: string,
  info: { version: string; now?: number },
): { release: () => void; warn: string | null } {
  const target = serverLockPath(dataDir);
  const existing = inspectServerLock(dataDir);
  const warn =
    existing.running && existing.info !== null
      ? `已有另一个服务进程（PID ${existing.info.pid}）在使用同一份数据目录 —— 两个进程同时写库是危险的`
      : existing.stale && existing.info !== null
        ? `发现陈旧的服务锁（PID ${existing.info.pid} 已不存在，可能是上次异常退出）：已接管`
        : null;

  const payload: ServerLockInfo = {
    pid: process.pid,
    startedAt: info.now ?? Date.now(),
    version: info.version,
  };
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(target, `${JSON.stringify(payload)}\n`, 'utf8');
  } catch {
    return { release: () => undefined, warn: warn ?? '服务锁写入失败（不影响运行，但运维脚本无法判断本进程）' };
  }

  return {
    release: () => {
      // 只删自己写的那把（被后来者接管过就不要动）
      const current = readServerLock(dataDir);
      if (current !== null && current.pid !== payload.pid) return;
      rmSync(target, { force: true });
    },
    warn,
  };
}
