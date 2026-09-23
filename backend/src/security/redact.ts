import type { FastifyRequest } from 'fastify';
import { LLM_KEY_HEADER, PROVIDER_KEY_HEADER } from './credential.js';

/**
 * 凭据擦除（"Key 零留存"的最后一道手工防线，CONTRACT §5）。
 *
 * ## 为什么必须有它
 * pino 的 `redact` 只能覆盖**我们自己主动记录**的结构化字段；
 * 而真正危险的路径是**上游返回的报文** —— 各家在鉴权失败时会原样回显 Key
 * （`Invalid API key provided: sk-…`），我们又把这段文本原样回给前端并写进日志。
 * 不擦，就等于把 Key 打印在界面上和磁盘里（发布级缺陷）。
 *
 * 用法：任何"来自上游 / 来自请求体"的文本进入 message 或日志前，先过一遍。
 * 第二个参数传本次请求用的 Key 原文（精确匹配最可靠），正则兜底处理其它形态。
 */
export function redactSecrets(text: string, ...secrets: Array<string | undefined>): string {
  let output = String(text);

  for (const secret of secrets) {
    const trimmed = secret?.trim();
    if (trimmed !== undefined && trimmed !== '') {
      output = output.split(trimmed).join('<redacted>');
    }
  }

  return output
    .replace(/Bearer\s+[\w.-]{8,}/gi, 'Bearer <redacted>')
    .replace(/\b(sk|api|key)[-_][\w.-]{8,}/gi, '<redacted>')
    .replace(/\bark-[0-9a-f-]{20,}/gi, '<redacted>');
}

/**
 * 读取请求头里的凭据值（供"擦除了哪些"用）。
 * 只读不存：返回值仅存在于调用栈上，不写入任何模块级变量。
 */
export function collectRequestSecrets(request: FastifyRequest): string[] {
  const values: string[] = [];
  for (const header of [PROVIDER_KEY_HEADER, LLM_KEY_HEADER, 'authorization']) {
    const raw = request.headers[header];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === 'string' && value.trim() !== '') values.push(value.trim());
  }
  return values;
}
