import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  acquireServerLock,
  inspectServerLock,
  isProcessAlive,
  readServerLock,
} from './serverLock.js';

/**
 * 服务进程锁（V2.17 / B52 片 A）。
 *
 * 这组用例原本挂在备份测试文件里（恢复闸门要用它判"服务在不在跑"）。V2.92 删掉备份与恢复后
 * 锁本身仍然留着：它挡的是"两个进程同时写一个库"，与本机是否还有备份功能无关。
 *
 * 留下的一条实测教训：**空闲的服务不持有数据库写锁**，所以"服务在不在跑"必须由服务自己声明；
 * 而**陈旧锁不能挡住启动**（异常退出后必须还能起来）。
 */
const FIXED_NOW = 1_700_000_000_000;

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

  it('陈旧锁（进程已不存在）→ 如实标 stale，**但不当作"在跑"**（异常退出后还能起来）', () => {
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

  it('锁文件内容坏掉 → 当作"没有锁"（坏文件不该让启动罢工）', () => {
    writeFileSync(path.join(dir, 'server.lock'), '{ not json');
    expect(readServerLock(dir)).toBeNull();
    expect(inspectServerLock(dir).running).toBe(false);
  });
});
