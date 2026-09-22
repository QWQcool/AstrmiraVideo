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
