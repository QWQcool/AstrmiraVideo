import { describe, expect, it } from 'vitest';
import { fingerprintKey } from './credential.js';

/**
 * 凭据指纹（PLAN §9 台账 **B8**，原标注「上线前必须做」）。
 *
 * 它进的是**限流键**，所以性质是"标识符"而不是"凭据"—— 下面几条断言钉的正是这条界限：
 * 稳定、可归一、不可逆、长度不足以承载原文。
 */
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
