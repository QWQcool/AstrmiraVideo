import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { WEBHOOK_SECRET_PREFIX } from '@astrmira/shared';

/**
 * Webhook 载荷签名（V2.15 / 台账 B51，契约 §15）。
 *
 * 客户侧的验收方式（文档里给的是同一段代码）：
 * ```js
 * const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
 * if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers['x-astrmira-signature']))) reject();
 * ```
 *
 * 三条口径：
 * 1. **签的是"原始请求体"**（不是再序列化一遍的对象）—— 客户必须对**收到的字节**验签，
 *    否则任何 JSON 归一化差异都会让验签失败（这是各家 webhook 最经典的踩坑）；
 * 2. **签名头带算法前缀**（`sha256=<hex>`）：以后换算法时客户能分辨，不用靠"长度看起来对不对"；
 * 3. **比较必须定长**（`timingSafeEqual`）—— 这里给出 `verifySignature` 供客户/测试复用。
 */

export function generateWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(24).toString('hex')}`;
}

/** `sha256=<hex>`（HMAC-SHA256） */
export function signPayload(secret: string, rawBody: string | Buffer): string {
  const digest = createHmac('sha256', secret).update(rawBody).digest('hex');
  return `sha256=${digest}`;
}

/**
 * 验签（定长比较）。长度不一致**直接 false** —— 不要拿 `timingSafeEqual` 比不同长度的 Buffer，
 * 它会抛异常（客户侧照着实现时最容易踩的一个）。
 */
export function verifySignature(secret: string, rawBody: string | Buffer, header: string): boolean {
  const expected = signPayload(secret, rawBody);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(header);
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}
