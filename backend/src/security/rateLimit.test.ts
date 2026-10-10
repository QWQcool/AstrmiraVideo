import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../store/db.js';
import {
  BURST_WINDOW_MS,
  BurstLimiter,
  CooldownStore,
  DEFAULT_COOLDOWN_MS,
  PlanRunRegistry,
  rateLimitKey,
  VERIFY_BURST_MAX,
} from './rateLimit.js';

/**
 * 防线 5 冷却（AC9）：**冷却状态必须落 SQLite**——内存 Map 会在服务重启后丢窗口。
 * 本文件用**文件库**验证"重启不丢窗口"，用内存库验证判定语义。
 *
 * V2.8（B25）追加：`BurstLimiter`（verify / logs 的独立桶，内存突发窗口）——见文件末尾。
 */

const TMP_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-cooldown-'));
const TMP_DB = path.join(TMP_DIR, 'cooldown.db');

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('rateLimitKey（签名预留复合键）', () => {
  it('Step 2 只传 ip → 单键形式', () => {
    expect(rateLimitKey({ ip: '203.0.113.7' })).toBe('ip:203.0.113.7');
  });

  it('传入 keyFingerprint → 复合键形式（Step 5 直接复用，无需改签名）', () => {
    expect(rateLimitKey({ ip: '203.0.113.7', keyFingerprint: 'a1b2c3d4' })).toBe(
      'ip:203.0.113.7|key:a1b2c3d4',
    );
  });
});

describe('CooldownStore 判定语义', () => {
  it('首次提交放行，随后进入 60s 冷却', () => {
    const db = openDatabase(':memory:');
    const store = new CooldownStore(db);
    const key = rateLimitKey({ ip: '198.51.100.1' });
    const t0 = 1_000_000;

    expect(store.check(key, t0).allowed).toBe(true);

    store.record(key, t0);

    const blocked = store.check(key, t0 + 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(DEFAULT_COOLDOWN_MS - 1000);

    db.close();
  });

  it('冷却窗口过后自动放行（无需手工清理）', () => {
    const db = openDatabase(':memory:');
    const store = new CooldownStore(db);
    const key = rateLimitKey({ ip: '198.51.100.2' });
    const t0 = 2_000_000;

    store.record(key, t0);

    expect(store.check(key, t0 + DEFAULT_COOLDOWN_MS).allowed).toBe(true);
    expect(store.check(key, t0 + DEFAULT_COOLDOWN_MS + 1).retryAfterMs).toBe(0);

    db.close();
  });

  it('不同 IP 互不影响（键隔离）', () => {
    const db = openDatabase(':memory:');
    const store = new CooldownStore(db);
    const t0 = 3_000_000;

    store.record(rateLimitKey({ ip: '198.51.100.3' }), t0);

    expect(store.check(rateLimitKey({ ip: '198.51.100.3' }), t0 + 100).allowed).toBe(false);
    expect(store.check(rateLimitKey({ ip: '198.51.100.4' }), t0 + 100).allowed).toBe(true);

    db.close();
  });

  it('冷却时长可配置（测试与验证路由的独立桶复用同一实现）', () => {
    const db = openDatabase(':memory:');
    const store = new CooldownStore(db, 'verify', 1000);
    const key = rateLimitKey({ ip: '198.51.100.5' });
    const t0 = 4_000_000;

    store.record(key, t0);

    expect(store.check(key, t0 + 999).allowed).toBe(false);
    expect(store.check(key, t0 + 1000).allowed).toBe(true);

    db.close();
  });

  it('prune 清理过期记录', () => {
    const db = openDatabase(':memory:');
    const store = new CooldownStore(db);
    const t0 = 5_000_000;
    store.record(rateLimitKey({ ip: '198.51.100.6' }), t0);

    expect(store.prune(t0 + 1)).toBe(0);
    expect(store.prune(t0 + DEFAULT_COOLDOWN_MS + 1)).toBe(1);

    db.close();
  });
});

describe('AC9 · 冷却跨"服务重启"不丢窗口（必须落盘）', () => {
  it('关闭连接后重新打开同一 SQLite 文件，同一 IP 仍处于冷却中', () => {
    const key = rateLimitKey({ ip: '203.0.113.99' });

    // 第一次"进程"：记录冷却
    const first = openDatabase(TMP_DB);
    const firstStore = new CooldownStore(first);
    firstStore.record(key);
    expect(firstStore.check(key).allowed).toBe(false);
    first.close();

    // "重启"：新连接、新 store 实例，数据来自磁盘
    const second = openDatabase(TMP_DB);
    const secondStore = new CooldownStore(second);
    const decision = secondStore.check(key);

    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterMs).toBeGreaterThan(0);

    second.close();
  });
});

describe('PlanRunRegistry（V2.26 / A5 片 A：编排运行的一次动作豁免）', () => {
  it('同一 runId：第一次为 true，后续为 false（同一次运行只吃一次冷却）', () => {
    const registry = new PlanRunRegistry();
    expect(registry.firstOf('run-1', 1000)).toBe(true);
    expect(registry.firstOf('run-1', 1001)).toBe(false);
    expect(registry.firstOf('run-1', 1002)).toBe(false);
  });

  it('不同 runId 互不影响（新一轮要重新走冷却检查）', () => {
    const registry = new PlanRunRegistry();
    expect(registry.firstOf('run-a', 1000)).toBe(true);
    expect(registry.firstOf('run-b', 1000)).toBe(true);
  });

  it('TTL 过后同 id 会被当成新的一轮（顺手清理，不留无界增长）', () => {
    const registry = new PlanRunRegistry(60_000);
    expect(registry.firstOf('run-ttl', 0)).toBe(true);
    expect(registry.firstOf('run-ttl', 30_000)).toBe(false);
    expect(registry.firstOf('run-ttl', 61_000)).toBe(true);
  });
});

describe('BurstLimiter（V2.8 / B25：verify 与 logs 的独立桶）', () => {
  it('窗口内配额用尽 → 拒绝并给出 Retry-After；窗口滑走后恢复', () => {
    const limiter = new BurstLimiter(BURST_WINDOW_MS, 3);
    const key = rateLimitKey({ ip: '198.51.100.9' });
    const t0 = 10_000_000;

    expect(limiter.take(key, t0).allowed).toBe(true);
    expect(limiter.take(key, t0 + 1).allowed).toBe(true);
    expect(limiter.take(key, t0 + 2).allowed).toBe(true);

    const blocked = limiter.take(key, t0 + 3);
    expect(blocked.allowed).toBe(false);
    // 最早那次在 t0 → 还要等接近一个窗口
    expect(blocked.retryAfterMs).toBeGreaterThan(9_000);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(BURST_WINDOW_MS);

    // 窗口滑走：最早的时间戳过期，配额恢复
    expect(limiter.take(key, t0 + BURST_WINDOW_MS + 1).allowed).toBe(true);
  });

  it('按 key 各自计桶（同一 IP 被限不影响其它 IP）', () => {
    const limiter = new BurstLimiter(BURST_WINDOW_MS, 1);
    const alpha = rateLimitKey({ ip: '198.51.100.10' });
    const beta = rateLimitKey({ ip: '198.51.100.11' });

    expect(limiter.take(alpha, 1).allowed).toBe(true);
    expect(limiter.take(alpha, 2).allowed).toBe(false);
    expect(limiter.take(beta, 2).allowed).toBe(true);
  });

  it('生产配额是常量事实：verify 桶 10s / 5 次（改配额必须同时改契约 §5）', () => {
    const limiter = new BurstLimiter(BURST_WINDOW_MS, VERIFY_BURST_MAX);
    const key = rateLimitKey({ ip: '198.51.100.12' });

    for (let index = 0; index < VERIFY_BURST_MAX; index += 1) {
      expect(limiter.take(key, index).allowed).toBe(true);
    }
    expect(limiter.take(key, VERIFY_BURST_MAX).allowed).toBe(false);
  });
});
