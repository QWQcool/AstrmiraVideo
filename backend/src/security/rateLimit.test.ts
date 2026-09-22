import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../store/db.js';
import { CooldownStore, DEFAULT_COOLDOWN_MS, rateLimitKey } from './rateLimit.js';

/**
 * 防线 5 冷却（AC9）：**冷却状态必须落 SQLite**——内存 Map 会在服务重启后丢窗口。
 * 本文件用**文件库**验证"重启不丢窗口"，用内存库验证判定语义。
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
