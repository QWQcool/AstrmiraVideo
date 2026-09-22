import { describe, expect, it } from 'vitest';
import { LLM_PRESETS } from '@astrmira/shared';
import {
  DEFAULT_BYOK,
  applyLlmPreset,
  clearByok,
  isKeyInputAllowed,
  isLoopbackHost,
  isPersistEnabled,
  keyInputNotice,
  readByok,
  resolveLlmConfig,
  resolveLlmKey,
  resolveProviderKey,
  writeByok,
} from './byok';
import { STORAGE_KEYS } from './storage';
import type { StorageLike } from './storage';

/**
 * F1：BYOK 前端半边的四条硬约束（HTTPS 守卫 / 存储位切换 / 清除干净 / Key 只进请求头）。
 */

function memoryStorage(initial: Record<string, string> = {}): StorageLike & {
  dump(): Record<string, string>;
} {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    dump: () => Object.fromEntries(map),
  };
}

/** 模拟隐私模式 / 存储被策略禁用 */
const throwingStorage: StorageLike = {
  getItem() {
    throw new Error('storage denied');
  },
  setItem() {
    throw new Error('storage denied');
  },
  removeItem() {
    throw new Error('storage denied');
  },
};

describe('HTTPS 守卫（PLAN §9-2 红线的前置）', () => {
  it('回环主机判定', () => {
    for (const host of ['localhost', '127.0.0.1', '127.0.0.5', '::1', 'app.localhost']) {
      expect(isLoopbackHost(host), `${host} 应判为回环`).toBe(true);
    }
    for (const host of ['example.com', '192.168.1.10', '10.0.0.1', 'localhost.evil.com']) {
      expect(isLoopbackHost(host), `${host} 不应判为回环`).toBe(false);
    }
  });

  it('HTTPS 恒允许；HTTP 仅回环允许；公网明文禁止', () => {
    expect(isKeyInputAllowed({ protocol: 'https:', hostname: 'example.com' })).toBe(true);
    expect(isKeyInputAllowed({ protocol: 'http:', hostname: 'localhost' })).toBe(true);
    expect(isKeyInputAllowed({ protocol: 'http:', hostname: '127.0.0.1' })).toBe(true);
    expect(isKeyInputAllowed({ protocol: 'http:', hostname: 'example.com' })).toBe(false);
    expect(isKeyInputAllowed({ protocol: 'http:', hostname: '203.0.113.7' })).toBe(false);
  });

  it('禁止时给出可执行的原因文案，允许时为 null', () => {
    expect(keyInputNotice({ protocol: 'https:', hostname: 'example.com' })).toBeNull();
    expect(keyInputNotice({ protocol: 'http:', hostname: 'localhost' })).toBeNull();
    expect(keyInputNotice({ protocol: 'http:', hostname: '203.0.113.7' })).toContain('HTTPS');
  });
});

describe('BYOK 存取（默认 session；显式勾选才落 localStorage）', () => {
  it('空存储读到默认占位配置', () => {
    const access = { local: memoryStorage(), session: memoryStorage() };

    expect(readByok(access)).toEqual(DEFAULT_BYOK);
    expect(isPersistEnabled(access)).toBe(false);
  });

  it('未勾选持久化 → 只写 sessionStorage', () => {
    const local = memoryStorage();
    const session = memoryStorage();

    writeByok({ local, session }, { ...DEFAULT_BYOK, key: 'k-1' }, false);

    expect(session.dump()[STORAGE_KEYS.byok]).toContain('k-1');
    expect(local.dump()[STORAGE_KEYS.byok]).toBeUndefined();
    expect(readByok({ local, session }).key).toBe('k-1');
  });

  it('勾选持久化 → 只写 localStorage，且**清掉 session 残留**', () => {
    const local = memoryStorage();
    const session = memoryStorage({ [STORAGE_KEYS.byok]: JSON.stringify({ key: 'stale' }) });

    writeByok({ local, session }, { ...DEFAULT_BYOK, key: 'k-2' }, true);

    expect(local.dump()[STORAGE_KEYS.byok]).toContain('k-2');
    expect(session.dump()[STORAGE_KEYS.byok]).toBeUndefined();
    expect(isPersistEnabled({ local, session })).toBe(true);
  });

  it('从"持久化"退回"仅本次会话"时，localStorage 里的旧值必须被清掉', () => {
    const local = memoryStorage();
    const session = memoryStorage();

    writeByok({ local, session }, { ...DEFAULT_BYOK, key: 'k-3' }, true);
    writeByok({ local, session }, { ...DEFAULT_BYOK, key: 'k-4' }, false);

    expect(local.dump()[STORAGE_KEYS.byok]).toBeUndefined();
    expect(readByok({ local, session }).key).toBe('k-4');
  });

  it('clearByok 两边都清、偏好标志也清', () => {
    const local = memoryStorage();
    const session = memoryStorage();

    writeByok({ local, session }, { ...DEFAULT_BYOK, key: 'k-5' }, true);
    clearByok({ local, session });

    expect(local.dump()[STORAGE_KEYS.byok]).toBeUndefined();
    expect(session.dump()[STORAGE_KEYS.byok]).toBeUndefined();
    expect(isPersistEnabled({ local, session })).toBe(false);
    expect(readByok({ local, session })).toEqual(DEFAULT_BYOK);
  });

  it('损坏的 JSON 不得抛出，退回默认值', () => {
    const access = {
      local: memoryStorage({ [STORAGE_KEYS.byok]: '{not json' }),
      session: memoryStorage(),
    };

    expect(() => readByok(access)).not.toThrow();
    expect(readByok(access)).toEqual(DEFAULT_BYOK);
  });

  it('隐私模式（storage 抛错）读写都不抛，读回默认值', () => {
    const access = { local: throwingStorage, session: throwingStorage };

    expect(() => writeByok(access, { ...DEFAULT_BYOK, key: 'k' }, true)).not.toThrow();
    expect(() => clearByok(access)).not.toThrow();
    expect(readByok(access)).toEqual(DEFAULT_BYOK);
  });
});

describe('凭据取值：空白视为未填', () => {
  it('空串 / 纯空白 / 有值', () => {
    expect(resolveProviderKey({ ...DEFAULT_BYOK, key: '' })).toBeUndefined();
    expect(resolveProviderKey({ ...DEFAULT_BYOK, key: '   ' })).toBeUndefined();
    expect(resolveProviderKey({ ...DEFAULT_BYOK, key: '  abc  ' })).toBe('abc');
  });
});

/**
 * 文本轨（V2.0 扩写，PLAN §6-D24）：与视频轨**相互独立**。
 * 出错代价不是"界面难看"，而是把视频 Key 当文本 Key 发出去（用户会以为扩写坏了）——
 * 所以两条轨的取值必须能被分别断言。
 */
describe('文本轨凭据（V2.0）', () => {
  it('两条轨的 Key 各自独立：填了视频 Key 不等于配好了扩写', () => {
    const config = { ...DEFAULT_BYOK, key: 'sk-video-123456', llmKey: '' };

    expect(resolveProviderKey(config)).toBe('sk-video-123456');
    expect(resolveLlmKey(config)).toBeUndefined();
  });

  it('文本 Key 空白视为未填（前端据此把 ✨ 置灰）', () => {
    expect(resolveLlmKey({ ...DEFAULT_BYOK, llmKey: '   ' })).toBeUndefined();
    expect(resolveLlmKey({ ...DEFAULT_BYOK, llmKey: ' sk-llm-1 ' })).toBe('sk-llm-1');
  });

  it('默认配置指向预设表第一项（两处不会各写一个默认地址）', () => {
    expect(DEFAULT_BYOK.llmPreset).toBe(LLM_PRESETS[0]?.id);
    expect(DEFAULT_BYOK.llmBaseUrl).toBe(LLM_PRESETS[0]?.baseUrl);
    expect(DEFAULT_BYOK.llmModel).toBe(LLM_PRESETS[0]?.model);
  });

  it('切换预设会把该预设的地址与模型**填进配置**（界面上看得见，而不是隐形默认值）', () => {
    const deepseek = LLM_PRESETS.find((preset) => preset.id === 'deepseek');
    const next = applyLlmPreset(DEFAULT_BYOK, 'deepseek');

    expect(next.llmPreset).toBe('deepseek');
    expect(next.llmBaseUrl).toBe(deepseek?.baseUrl);
    expect(next.llmModel).toBe(deepseek?.model);
  });

  it('切到「自定义」**不动**地址与模型（那是用户自己的值，抹掉等于让他重填）', () => {
    const custom = applyLlmPreset({ ...DEFAULT_BYOK, llmBaseUrl: 'https://mine/v1' }, 'custom');

    expect(custom.llmPreset).toBe('custom');
    expect(custom.llmBaseUrl).toBe('https://mine/v1');
  });

  it('请求体里的 llm 配置：空字段不发（由服务端回落预设），填了就带上', () => {
    expect(resolveLlmConfig({ ...DEFAULT_BYOK, llmBaseUrl: '', llmModel: '' })).toEqual({
      preset: DEFAULT_BYOK.llmPreset,
    });

    expect(
      resolveLlmConfig({ ...DEFAULT_BYOK, llmPreset: 'custom', llmBaseUrl: ' https://mine/v1 ', llmModel: ' m ' }),
    ).toEqual({ preset: 'custom', baseUrl: 'https://mine/v1', model: 'm' });
  });

  it('旧版本存下的配置（没有文本轨字段）读取后补全为默认值，不出现 undefined', () => {
    const legacy = JSON.stringify({ baseUrl: 'https://ark.example/api/v3', key: 'sk-old', model: 'm-old' });
    // 默认不勾选持久化，因此旧值在 **sessionStorage** 里（与 byok 的读取顺序一致）
    const access = {
      local: memoryStorage(),
      session: memoryStorage({ [STORAGE_KEYS.byok]: legacy }),
    };

    const config = readByok(access);
    expect(config.key).toBe('sk-old');
    expect(config.llmPreset).toBe(DEFAULT_BYOK.llmPreset);
    expect(config.llmKey).toBe('');
    // 严格判据：任何字段都不允许是 undefined（否则 zod 请求体校验会红）
    expect(Object.values(config).every((value) => typeof value === 'string')).toBe(true);
  });
});
