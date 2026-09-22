import type { FastifyInstance } from 'fastify';

/**
 * 安全响应头（PLAN §7-4 + §9 台账 **B15**）。
 *
 * B15 要求「CSP（`default-src 'self'`）与『数据路径零 `innerHTML`』的自动化断言」，
 * 且标注**公网刚需**、应在 Step 5 内落地。两半分别处理：
 * - **零 `innerHTML`**：代码现状已满足（全仓 grep 无命中），本轮把它固化成可执行断言
 *   （见 `frontend/scripts/visual-selfcheck.mjs`），避免日后有人顺手写回去；
 * - **CSP**：在本文件落地。
 *
 * ## 为什么 CSP 只在生产启用
 * 开发模式下 Vite 需要内联脚本与 HMR 的 WebSocket，套上严格 CSP 会让 `pnpm dev`
 * 直接白屏。历史经验是：**"为了安全把开发环境弄坏"的做法，最终一定会有人把 CSP 整个删掉**。
 * 所以按环境区分，让它在真正暴露于公网时才生效。
 */

/**
 * 生产 CSP。逐条取舍写在下面注释里 —— 改动前请先读，否则很容易为了"过一遍"而放宽到失去意义。
 */
export const PRODUCTION_CSP: string = [
  "default-src 'self'",
  // 前端产物是外链 JS（Vite 不注入内联脚本），因此**不需要** 'unsafe-inline'
  "script-src 'self'",
  // React 的 style 属性属于行内样式，受这条管辖，必须放开 'unsafe-inline'。
  // 代价可接受：样式注入的危害远小于脚本注入，且本项目的样式没有任何用户可控输入。
  "style-src 'self' 'unsafe-inline'",
  // data: / blob: 供上传预览与画布裁切（本地生成，不经网络）
  "img-src 'self' data: blob:",
  // 成片与预览视频来自同源 /media 或本地 blob
  "media-src 'self' blob:",
  // 接口全部同源；写死 'self' 顺带堵掉"把数据外发到第三方"这条路径
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // 双保险：即使将来 X-Frame-Options 被某个反代吞掉，这里仍然禁止被嵌套
  "frame-ancestors 'none'",
].join('; ');

export function registerSecurityHeaders(app: FastifyInstance): void {
  const isProduction = process.env.NODE_ENV === 'production';

  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    if (isProduction) {
      reply.header('Content-Security-Policy', PRODUCTION_CSP);
    }
  });
}
