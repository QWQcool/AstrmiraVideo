import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRODUCTION_CSP, registerSecurityHeaders } from './securityHeaders.js';

/**
 * 安全响应头断言（PLAN §7-4 / 台账 B15 的 CSP 半边；B34 · P2 追加 worker-src 口径）。
 *
 * 这里钉的是**行为事实**（生产下发 / 开发不下发 / 关键指令在场），
 * 而不是"某条指令的字面量"—— 注释改了不影响，指令被误删才会红。
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('securityHeaders（CSP）', () => {
  it('生产：下发 CSP，且关键指令齐备', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const app = Fastify();
    registerSecurityHeaders(app);
    app.get('/x', async () => ({ ok: true }));

    const response = await app.inject({ method: 'GET', url: '/x' });
    expect(response.headers['content-security-policy']).toBe(PRODUCTION_CSP);
    // 脚本仍只允许同源（这条是 CSP 的意义所在，不能被顺手放宽）
    expect(PRODUCTION_CSP).toContain("script-src 'self'");
    expect(PRODUCTION_CSP).not.toContain("script-src 'self' 'unsafe-inline'");
    // B34 · P2：浏览器端导出（@remotion/web-renderer）的 blob keepalive worker 需要它
    expect(PRODUCTION_CSP).toContain("worker-src 'self' blob:");
    await app.close();
  });

  it('开发：不下发 CSP（否则 Vite 的 HMR 与内联脚本会直接白屏）', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const app = Fastify();
    registerSecurityHeaders(app);
    app.get('/x', async () => ({ ok: true }));

    const response = await app.inject({ method: 'GET', url: '/x' });
    expect(response.headers['content-security-policy']).toBeUndefined();
    // 另外三条安全头两个环境都有（它们不会破坏开发体验）
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    await app.close();
  });
});
