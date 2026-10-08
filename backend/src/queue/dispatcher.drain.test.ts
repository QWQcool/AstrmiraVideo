import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import type { JobQueue } from './JobQueue.js';
import { JobDispatcher } from './dispatcher.js';

/**
 * 调度器收尾纪律（2026-09-24 CI 的真实红：`The database connection is not open`）。
 *
 * 背景：`onClose` 曾只调 `stop()`（清定时器）就 `db.close()` —— **在飞的 tick 不被等待**，
 * claim 阶段在关库后落地，变成 unhandled rejection，Vitest 直接判整个套件失败（本地快、
 * 撞不上这个时序窗口；CI 上 101MB 上传把套件拖慢后必现）。
 *
 * 两条回归断言：
 * 1. `drain()` 会**等在飞的 tick 收尾**（而不是只清定时器）；
 * 2. tick 里的异常**统一走 onError**（不会变成 unhandled rejection —— vitest 会把
 *    unhandled rejection 算作套件错误，所以这条用例本身就是断言）。
 */

/** 只实现 claim 的最简 JobQueue 桩（本文件不涉及 run 路径） */
function stubQueue(claimImpl: () => Promise<null>): JobQueue {
  return { claim: claimImpl } as unknown as JobQueue;
}

describe('JobDispatcher · drain 收尾', () => {
  it('drain 等在飞的 tick 收尾（不是清个定时器就走）', async () => {
    let claimSettled = false;
    const dispatcher = new JobDispatcher({
      queue: stubQueue(async () => {
        await sleep(40);
        claimSettled = true;
        return null;
      }),
      resolveProvider: () => null,
      intervalMs: 5,
    });

    dispatcher.start();
    await sleep(12); // 至少一轮 tick 已起飞、claim 还在飞
    expect(claimSettled).toBe(false);

    await dispatcher.drain();
    expect(claimSettled).toBe(true);
  });

  it('tick 抛错走 onError（关库后的 claim 不再炸成 unhandled rejection）', async () => {
    const errors: unknown[] = [];
    const dispatcher = new JobDispatcher({
      queue: stubQueue(async () => {
        throw new Error('The database connection is not open');
      }),
      resolveProvider: () => null,
      intervalMs: 5,
      onError: (err) => errors.push(err),
    });

    dispatcher.start();
    await sleep(30);
    await dispatcher.drain();

    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect((errors[0] as Error).message).toContain('database connection');
  });

  it('drain 之后再无新 tick（停表生效）', async () => {
    let claims = 0;
    const dispatcher = new JobDispatcher({
      queue: stubQueue(async () => {
        claims += 1;
        return null;
      }),
      resolveProvider: () => null,
      intervalMs: 5,
    });

    dispatcher.start();
    await sleep(25);
    await dispatcher.drain();
    const settled = claims;
    await sleep(25);
    expect(claims).toBe(settled);
  });
});
