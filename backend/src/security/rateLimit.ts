import type { FastifyRequest } from 'fastify';
import type { Db } from '../store/db.js';

/**
 * 防线 5：60s 防抖限流（CONTRACT §5 / PLAN §7-5 / 决策 D25）。
 *
 * 键的构成：Step 2 按**来源 IP 单键**；复合键（IP + BYOK Key 指纹）随 Step 5 的最小鉴权落地。
 * 但 `rateLimitKey` 的**签名现在就预留** `keyFingerprint`——Step 5 只需填计算与调用点，不改函数签名。
 *
 * 冷却状态**必须落 SQLite**：内存 Map 在服务重启后会丢掉冷却窗口（破坏性验证正是盯这一点）。
 */

export const DEFAULT_COOLDOWN_MS = 60_000;

/** 冷却桶名：与"验证路由独立限流桶"（台账 B2）区分 */
export const SUBMIT_BUCKET = 'generate';

/**
 * 独立限流桶（V2.8 / 台账 B25）。三个桶**各自计时间**，互相不影响：
 * - `generate`：60s 防抖（防线 5，付费上游）—— `CooldownStore`，状态落 SQLite；
 * - `verify`：**10s 窗口最多 5 次/IP** —— `/api/providers/keys/verify` **会向视频/文本上游
 *   发真实探测请求**（`/models` + 空 content 探针），没有限流时被刷 = 拿部署者的服务器当免费探针；
 * - `logs`：**10s 窗口最多 30 次/IP** —— 读接口的底线（挡脚本级扫描；界面自身的挂载 + 轮询 + 连续交互远低于此）。
 *
 * 为什么这两个桶用**内存突发窗口**而不是 SQLite 冷却：
 * ① 它们是"底线防护"（真正的防线是 Caddy 登录 + `PUBLIC_API_TOKEN`），不是计费闸门；
 * ② 读接口若每次请求都写一次库（记录冷却），反而把轻量轮询变成 DB 写放大；
 * ③ 冷却语义（"必须间隔 N 秒"）会误伤正常交互（连点两次"测试连接"、日志页挂载+轮询），
 *    而窗口内 N 次的语义对"人"完全无感、对"脚本"生效。进程重启清零，可接受。
 */
export const VERIFY_BUCKET = 'verify';
export const LOGS_BUCKET = 'logs';
/** 突发窗口：两个桶共用窗口长度（10s），配额各自定义 */
export const BURST_WINDOW_MS = 10_000;
export const VERIFY_BURST_MAX = 5;
export const LOGS_BURST_MAX = 30;

/**
 * 窗口内计数的突发限流器（内存版；V2.8 / B25）。
 *
 * `take()` 一次完成"判定 + 记账"——没有 check/record 两步，也就不存在"忘了记"的绕过路径。
 * 内存按 key 累积，`take` 时顺手丢掉过期时间戳（无定时器、无后台清理）。
 */
export class BurstLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly maxHits: number,
  ) {}

  take(key: string, now: number = Date.now()): RateLimitDecision {
    const fresh = (this.hits.get(key) ?? []).filter((ts) => now - ts < this.windowMs);
    if (fresh.length >= this.maxHits) {
      const oldest = fresh[0] ?? now;
      this.hits.set(key, fresh);
      return { allowed: false, retryAfterMs: Math.max(1, this.windowMs - (now - oldest)) };
    }
    fresh.push(now);
    this.hits.set(key, fresh);
    return { allowed: true, retryAfterMs: 0 };
  }
}

export interface RateLimitKeyParts {
  ip: string;
  /** 复合键预留：BYOK Key 指纹（SHA-256 前 8 位）；Step 2 恒传 `undefined` */
  keyFingerprint?: string;
}

export function rateLimitKey(parts: RateLimitKeyParts): string {
  return parts.keyFingerprint === undefined
    ? `ip:${parts.ip}`
    : `ip:${parts.ip}|key:${parts.keyFingerprint}`;
}

/**
 * 取来源 IP。
 * ⚠️ 反向代理后必须开启 `TRUST_PROXY=1`（见 R2），否则所有请求同 IP → 冷却退化成**全局锁**。
 */
export function resolveClientIp(request: FastifyRequest): string {
  return request.ip !== '' ? request.ip : (request.socket.remoteAddress ?? 'unknown');
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
}

export class CooldownStore {
  constructor(
    private readonly db: Db,
    private readonly bucket: string = SUBMIT_BUCKET,
    private readonly cooldownMs: number = DEFAULT_COOLDOWN_MS,
  ) {}

  /** 只读判定（不写入冷却） */
  check(key: string, now: number = Date.now()): RateLimitDecision {
    const row = this.db
      .prepare('SELECT last_submit_at FROM cooldowns WHERE bucket = ? AND key = ?')
      .get(this.bucket, key) as { last_submit_at: number } | undefined;

    if (row === undefined) return { allowed: true, retryAfterMs: 0 };

    const elapsed = now - row.last_submit_at;
    if (elapsed >= this.cooldownMs) return { allowed: true, retryAfterMs: 0 };

    return { allowed: false, retryAfterMs: this.cooldownMs - elapsed };
  }

  /** 记录一次提交（进入冷却窗口） */
  record(key: string, now: number = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO cooldowns (bucket, key, last_submit_at) VALUES (?, ?, ?)
         ON CONFLICT(bucket, key) DO UPDATE SET last_submit_at = excluded.last_submit_at`,
      )
      .run(this.bucket, key, now);
  }

  /** 剩余冷却毫秒数（0 = 无冷却） */
  retryAfterMs(key: string, now: number = Date.now()): number {
    return this.check(key, now).retryAfterMs;
  }

  /** 清理过期记录（运维用；判定本身不依赖清理） */
  prune(now: number = Date.now()): number {
    const result = this.db
      .prepare('DELETE FROM cooldowns WHERE bucket = ? AND last_submit_at < ?')
      .run(this.bucket, now - this.cooldownMs);
    return result.changes;
  }
}
