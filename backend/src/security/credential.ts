import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

/**
 * 凭据通道（CONTRACT §5「凭据传递约定」/ PLAN §6-D23，R2）。
 *
 * 铁律：**Key 零留存**——只用不存。本文件只从**请求头**读取凭据，
 * **禁止**把 Key 写入任何模块级变量、缓存或闭包（唯一的例外是单次请求的局部变量）。
 */

/** 视频轨凭据请求头（唯一载体：禁止出现在 query / URL path / body / cookie） */
export const PROVIDER_KEY_HEADER = 'x-provider-key';

/** 文本轨凭据请求头（随 V2.0【规划】的 LLM 实现启用） */
export const LLM_KEY_HEADER = 'x-llm-key';

/**
 * pino 日志的 redact 路径（单一事实源：装配处与测试共用）。
 * 漏配任意一项 = 凭据明文入日志（发布级缺陷）。
 *
 * 覆盖两种常见形态：
 * - `req.headers[...]`：记录整个请求对象时（fastify 的 reqSerializer 通常已过滤 headers，
 *   此处为第二道防线——一旦有人调整 logger 序列化器，这层才会真正生效）；
 * - 顶层键：有人直接 `log.info({ 'x-provider-key': … })` 或 `log.info({ authorization: … })` 时兜底。
 */
export const LOG_REDACT_PATHS: readonly string[] = [
  `req.headers["${PROVIDER_KEY_HEADER}"]`,
  `req.headers["${LLM_KEY_HEADER}"]`,
  'req.headers.authorization',
  PROVIDER_KEY_HEADER,
  LLM_KEY_HEADER,
  'authorization',
];

/**
 * 从请求头解析视频轨凭据。
 * @returns 去掉首尾空白后的 Key；缺失或空白时返回 `null`（**不回落**到其它位置）
 */
export function resolveProviderKey(req: FastifyRequest): string | null {
  const raw = req.headers[PROVIDER_KEY_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * 凭据掩码：仅用于日志与错误提示，形如 `sk-****abcd`。
 * 短凭据（≤ 8 字符）一律完全掩码，避免"掩码"反而泄露大部分内容。
 */
export function maskKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed === '' || trimmed.length <= 8) return '****';

  const prefixMatch = /^([a-zA-Z]{1,4})[-_]/.exec(trimmed);
  const prefix = prefixMatch ? `${prefixMatch[1]}-` : '';
  return `${prefix}****${trimmed.slice(-4)}`;
}

/**
 * 凭据指纹：**限流键的第二个维度**（PLAN §9 台账 **B8**，标注「上线前必须做」）。
 *
 * ## 为什么不能只用 IP
 * 共享出口（公司 NAT / 校园网 / 移动网络）下所有访客同 IP，于是 A 提交后 B 被
 * 「冷却中 60s」挡住 —— 用户看到的是"别人用过我就不能用了"，完全无法自查。
 * 防线 5 的本意是**防单人刷接口**，不是防整栋楼。
 *
 * ## 三条设计约束
 * 1. 只取 SHA-256 **前 8 位**（32 bit）：足以区分不同 Key，又不可逆 ——
 *    它出现在数据库或日志里都不构成"存储凭据"（对比：存原文或可逆编码就破功了）；
 * 2. 输入先 `trim()`：同一把 Key 带不同空白必须归一到同一个桶，否则限流能被空白绕过；
 * 3. 返回值是小写十六进制，可直接拼进限流键。
 *
 * ⚠️ 副作用（有意为之，且必须记住）：**不填 Key 的访客退化为纯 IP 键**。
 * 也就是说未配置 BYOK 的自带 Key 用户之间仍会互相影响 —— 这是可接受的：
 * 他们本来也提交不了（无凭据 → `KEY_MISSING`）。
 */
export function fingerprintKey(key: string): string {
  return createHash('sha256').update(key.trim()).digest('hex').slice(0, 8);
}
