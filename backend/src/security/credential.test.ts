import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import {
  fingerprintKey,
  LLM_KEY_HEADER,
  LOG_REDACT_PATHS,
  maskKey,
  PROVIDER_KEY_HEADER,
  resolveProviderKey,
} from './credential.js';

/** 造一个只带 headers 的最小请求对象（本模块只读这一个字段） */
function requestWith(headers: Record<string, string | string[] | undefined>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

/**
 * 凭据通道的**读取与掩码**半边（PLAN §6-D23「Key 零留存」）。
 *
 * `resolveProviderKey` 决定"从哪里取"，`maskKey` 决定"日志里长什么样"——
 * 两者任一失守都会让"过手不留存"变成一句空话（要么从 query 里悄悄取，要么把明文写进日志）。
 */
describe('resolveProviderKey · 唯一载体是请求头', () => {
  it('读到请求头就返回去空白后的值', () => {
    expect(resolveProviderKey(requestWith({ [PROVIDER_KEY_HEADER]: '  sk-abcdef123456  ' }))).toBe(
      'sk-abcdef123456',
    );
  });

  it('缺失 / 空白 / 非字符串一律返回 null（**不回落**到 query、URL 或 body）', () => {
    expect(resolveProviderKey(requestWith({}))).toBeNull();
    expect(resolveProviderKey(requestWith({ [PROVIDER_KEY_HEADER]: '   ' }))).toBeNull();
    expect(resolveProviderKey(requestWith({ [PROVIDER_KEY_HEADER]: undefined }))).toBeNull();
    // 只有 headers 里的那个键算数：同名的 query 参数不会命中
    const req = requestWith({}) as FastifyRequest & { query: Record<string, string> };
    req.query = { [PROVIDER_KEY_HEADER]: 'sk-should-not-be-read' };
    expect(resolveProviderKey(req)).toBeNull();
  });

  it('重复请求头（数组）取第一项', () => {
    expect(
      resolveProviderKey(requestWith({ [PROVIDER_KEY_HEADER]: ['sk-first', 'sk-second'] })),
    ).toBe('sk-first');
  });
});

describe('maskKey · 日志与错误提示只允许出现掩码', () => {
  it('保留 1~4 位字母前缀与末 4 位，中间一律 ****', () => {
    expect(maskKey('sk-abcdef123456')).toBe('sk-****3456');
    expect(maskKey('sk-proj-abcdef123456')).toBe('sk-****3456');
  });

  it('无字母前缀的 Key 不带前缀，同样只留末 4 位', () => {
    expect(maskKey('1234567890abcdef')).toBe('****cdef');
  });

  it('短 Key（≤ 8 字符）整串掩码 —— 否则"掩码"反而泄露大部分内容', () => {
    expect(maskKey('sk-1234')).toBe('****');
    expect(maskKey('12345678')).toBe('****');
    expect(maskKey('   ')).toBe('****');
  });

  it('掩码结果里不含 Key 的中段（防"掩码里其实藏着原文"）', () => {
    const masked = maskKey('sk-verysecretmiddle-9999');
    expect(masked).not.toContain('verysecretmiddle');
    expect(masked).toBe('sk-****9999');
  });
});

describe('LOG_REDACT_PATHS · 漏配任意一项即等于凭据明文入日志', () => {
  it('覆盖视频轨 / 文本轨请求头与 authorization 的两类形态', () => {
    expect(LOG_REDACT_PATHS).toContain(`req.headers["${PROVIDER_KEY_HEADER}"]`);
    expect(LOG_REDACT_PATHS).toContain(`req.headers["${LLM_KEY_HEADER}"]`);
    expect(LOG_REDACT_PATHS).toContain('req.headers.authorization');
    expect(LOG_REDACT_PATHS).toContain(PROVIDER_KEY_HEADER);
    expect(LOG_REDACT_PATHS).toContain(LLM_KEY_HEADER);
    expect(LOG_REDACT_PATHS).toContain('authorization');
  });
});

describe('fingerprintKey', () => {
  it('同一把 Key 稳定得到同一指纹（否则冷却永远命中不到同一个桶）', () => {
    expect(fingerprintKey('sk-abcdef123456')).toBe(fingerprintKey('sk-abcdef123456'));
  });

  it('首尾空白被归一 —— 否则加个空格就能绕过冷却', () => {
    expect(fingerprintKey('  sk-abcdef123456  ')).toBe(fingerprintKey('sk-abcdef123456'));
    expect(fingerprintKey('\tsk-abcdef123456\n')).toBe(fingerprintKey('sk-abcdef123456'));
  });

  it('不同 Key 得到不同指纹（共享出口下互不误伤的前提）', () => {
    expect(fingerprintKey('sk-aaaaaaaa')).not.toBe(fingerprintKey('sk-bbbbbbbb'));
  });

  it('是 8 位小写十六进制：可直接拼进限流键', () => {
    expect(fingerprintKey('sk-abcdef123456')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('**不可逆**：既不含原文片段，本身也不可能还原出 Key', () => {
    const key = 'sk-verysecret-value';
    const fingerprint = fingerprintKey(key);

    expect(fingerprint).not.toContain('verysecret');
    expect(key).not.toContain(fingerprint);
    // 32 bit 的输出，长度上就不足以承载原文
    expect(fingerprint.length).toBeLessThan(key.length);
  });

  it('任何输入都不抛（调用方负责在 Key 缺失时**不传**该参数）', () => {
    expect(() => fingerprintKey('')).not.toThrow();
    expect(() => fingerprintKey('   ')).not.toThrow();
  });
});
