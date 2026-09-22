import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { LOG_REDACT_PATHS, maskKey, resolveProviderKey } from './credential.js';

/**
 * 凭据通道安全断言（施工单 §5 R2）。
 * 核心口径：**Key 零留存** —— 响应与日志中都不得出现 Key 明文（至少前 8 位）。
 */

const FAKE_KEY = 'sk-abcdefghijklmnop';

function fakeReq(headers: Record<string, string | undefined>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

describe('resolveProviderKey（只读请求头）', () => {
  it('从 x-provider-key 取到凭据并去除首尾空白', () => {
    expect(resolveProviderKey(fakeReq({ 'x-provider-key': `  ${FAKE_KEY}  ` }))).toBe(FAKE_KEY);
  });

  it('缺失或纯空白时返回 null，且不回落其它位置（body / query 一律不看）', () => {
    expect(resolveProviderKey(fakeReq({}))).toBeNull();
    expect(resolveProviderKey(fakeReq({ 'x-provider-key': '   ' }))).toBeNull();
    // 仅管其它字段存在也不采纳
    expect(
      resolveProviderKey(fakeReq({ authorization: 'Bearer x', 'x-llm-key': FAKE_KEY })),
    ).toBeNull();
  });
});

describe('maskKey（掩码形状）', () => {
  it('长凭据输出 sk-****尾4，且不含前 8 位明文', () => {
    const masked = maskKey(FAKE_KEY);

    expect(masked).toMatch(/^sk-\*{4}[a-z]{4}$/);
    expect(masked).not.toContain(FAKE_KEY.slice(0, 8));
    expect(masked).not.toContain(FAKE_KEY.slice(8));
  });

  it('短凭据一律完全掩码（不泄露长度与内容）', () => {
    expect(maskKey('sk-1234')).toBe('****');
    expect(maskKey('')).toBe('****');
  });
});

describe('日志 redact（Key 零留存）', () => {
  function captureLogger() {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    return { logger: pino({ redact: [...LOG_REDACT_PATHS] }, stream), lines };
  }

  it('带凭据的请求日志中不得出现 Key 明文（前 8 位与后续段均不得出现）', () => {
    const { logger, lines } = captureLogger();

    logger.info(
      {
        req: {
          method: 'GET',
          url: '/api/providers/status',
          headers: {
            'x-provider-key': FAKE_KEY,
            authorization: 'Bearer super-secret-token',
          },
        },
      },
      'incoming request',
    );

    const out = lines.join('\n');
    expect(out).not.toContain(FAKE_KEY.slice(0, 8));
    expect(out).not.toContain(FAKE_KEY.slice(8));
    expect(out).not.toContain('super-secret-token');
    expect(out).toContain('[Redacted]');
  });

  it('顶层键形态（有人直接记录 key 名）同样被 redact 覆盖', () => {
    const { logger, lines } = captureLogger();

    logger.info({ 'x-provider-key': FAKE_KEY, authorization: `Bearer ${FAKE_KEY}` }, 'probe');

    const out = lines.join('\n');
    expect(out).not.toContain(FAKE_KEY.slice(0, 8));
    expect(out).toContain('[Redacted]');
  });

  it('防恒真抽查：去掉 redact 配置后，同一断言必须失败（证明断言真的在拦明文）', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const unredacted = pino({}, stream);

    unredacted.info({ req: { headers: { 'x-provider-key': FAKE_KEY } } }, 'incoming request');

    expect(lines.join('\n')).toContain(FAKE_KEY.slice(0, 8));
  });
});

describe('装配完整性（防止 redact / allowedHeaders / trustProxy 被误删）', () => {
  it('index.ts 必须把 LOG_REDACT_PATHS 接进 logger，并在 CORS 放行凭据头、按 env 开启 trustProxy', () => {
    const src = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');

    // 行首锚定（m 标志）：避免"把配置注释掉仍然匹配"的假绿——本断言由破坏性验证校正过
    expect(src).toMatch(/^\s*redact:\s*\[\.\.\.LOG_REDACT_PATHS\],/m);
    expect(src).toMatch(/^\s*trustProxy:\s*process\.env\.TRUST_PROXY === '1',/m);
    // 两个凭据头都必须真的在 allowedHeaders 数组内（不能只停留在 import 里）
    expect(src).toMatch(/allowedHeaders:\s*\[[\s\S]*?PROVIDER_KEY_HEADER[\s\S]*?\]/);
    expect(src).toMatch(/allowedHeaders:\s*\[[\s\S]*?LLM_KEY_HEADER[\s\S]*?\]/);
  });
});
