/**
 * 幂等键生成（从 WorkbenchView 提升为共享工具，V2.7 / B41 —— 创作入口也需要提交）。
 *
 * 非安全上下文（http 的局域网 IP 访问）下 `crypto.randomUUID` 不可用，必须降级 ——
 * 直接调用会让"在手机浏览器上提交"整个按钮崩掉。
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
