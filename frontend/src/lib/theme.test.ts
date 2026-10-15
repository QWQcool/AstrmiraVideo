import { describe, expect, it } from 'vitest';
import { DICTIONARIES } from './i18n';
import { STORAGE_KEYS } from './storage';
import type { StorageAccess } from './storage';
import {
  DEFAULT_THEME_PREF,
  THEME_LABEL_KEYS,
  THEME_PREFS,
  readThemePref,
  resolveTheme,
  toDatasetTheme,
  writeThemePref,
} from './theme';

/**
 * 主题纯函数（V8.3 批次 2）。
 *
 * 重点钉两件事：① **默认跟随系统**（不是硬编码暗色）；② **脏值自愈** ——
 * 手改过 localStorage 或将来删档位时，界面不能因为一个读不懂的字符串就白屏。
 */

function memoryStorage(seed = new Map<string, string>()): StorageAccess & { dump: () => Map<string, string> } {
  const map = seed;
  return {
    local: {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, value);
      },
      removeItem: (key) => {
        map.delete(key);
      },
    },
    dump: () => map,
  };
}

describe('主题偏好读取', () => {
  it('没有存过时默认跟随系统', () => {
    expect(DEFAULT_THEME_PREF).toBe('system');
    expect(readThemePref(memoryStorage())).toBe('system');
  });

  it('存过的合法值原样读回（写入 → 读取闭环）', () => {
    const storage = memoryStorage();
    writeThemePref(storage, 'day');
    expect(storage.dump().get(STORAGE_KEYS.themePref)).toBe('day');
    expect(readThemePref(storage)).toBe('day');

    writeThemePref(storage, 'dark');
    expect(readThemePref(storage)).toBe('dark');
  });

  it('脏值（手改 / 未来删档位）回落 system，而不是抛错或返回未知值', () => {
    expect(readThemePref(memoryStorage(new Map([[STORAGE_KEYS.themePref, 'midnight']])))).toBe(
      'system',
    );
    expect(readThemePref(memoryStorage(new Map([[STORAGE_KEYS.themePref, '']])))).toBe('system');
    expect(readThemePref(memoryStorage(new Map([[STORAGE_KEYS.themePref, 'DAY']])))).toBe('system');
  });
});

describe('生效主题推导', () => {
  it('system 跟随系统；手动档不受系统影响', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('day');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('day', true)).toBe('day');
  });

  it('只有日间需要打 data-theme（暗色是 tokens.css 的 :root 默认值）', () => {
    expect(toDatasetTheme('dark')).toBeNull();
    expect(toDatasetTheme('day')).toBe('day');
  });

  it('每个档位都有中文标签（顶栏不会出现空按钮）', () => {
    for (const pref of THEME_PREFS) {
      const key = THEME_LABEL_KEYS[pref];
      expect(key).toBeTruthy();
      // V2.38：文案进了字典 —— 光有键、字典里没这条 = 界面直接显示键名（可见地坏）
      expect(DICTIONARIES.zh[key]).toBeTruthy();
      expect(DICTIONARIES.en[key]).toBeTruthy();
    }
    expect(THEME_PREFS).toContain(DEFAULT_THEME_PREF);
  });
});
