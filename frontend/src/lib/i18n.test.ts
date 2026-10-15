import { describe, expect, it } from 'vitest';
import type { StorageAccess, StorageLike } from './storage';
import {
  LANGUAGE_STORAGE_KEY,
  detectLanguage,
  interpolate,
  normalizeLanguage,
  saveLanguage,
  translate,
  type Dictionaries,
} from './i18n';

/**
 * i18n 基础设施（L1 收官件第二批）单测。
 *
 * 盯三件事（都会**静默出错**）：
 * 1. **语言的判定顺序**（显式选择 > 浏览器偏好 > 默认）—— 顺序错了会出现"用户选过英文却被浏览器语言改回去"；
 * 2. **归一化只认支持的语言**（`zh-CN` → `zh`；`zhx` / 空值 → 不认识，交给回落，别硬算成中文）；
 * 3. **缺键不许显示空白**（回落链：目标语言 → 中文 → **键名本身**）。
 */

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { dump(): Record<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    dump: () => Object.fromEntries(map),
  };
}

const access = (store: StorageLike): StorageAccess => ({ local: store });

describe('normalizeLanguage（归一化）', () => {
  it('认带地区的形态（zh-CN / zh-Hans / en-US → zh / zh / en）', () => {
    expect(normalizeLanguage('zh-CN')).toBe('zh');
    expect(normalizeLanguage('zh_Hans')).toBe('zh');
    expect(normalizeLanguage('en-US')).toBe('en');
    expect(normalizeLanguage('EN')).toBe('en');
    expect(normalizeLanguage('  en-GB  ')).toBe('en');
  });

  it('**只认支持的语言**：野值与空值一律 null（交给调用方回落）', () => {
    expect(normalizeLanguage('zhx')).toBeNull();
    expect(normalizeLanguage('fr-FR')).toBeNull();
    expect(normalizeLanguage('')).toBeNull();
    expect(normalizeLanguage('   ')).toBeNull();
    expect(normalizeLanguage(null)).toBeNull();
    expect(normalizeLanguage(undefined)).toBeNull();
  });
});

describe('detectLanguage（判定顺序：显式选择 > 浏览器 > 默认）', () => {
  it('用户选过 → 以本机存储为准（浏览器语言压不过它）', () => {
    const storage = memoryStorage({ [LANGUAGE_STORAGE_KEY]: 'en' });
    expect(detectLanguage({ storage: access(storage), navigatorLanguage: 'zh-CN' })).toBe('en');
  });

  it('没选过 → 跟随浏览器语言', () => {
    expect(detectLanguage({ storage: access(memoryStorage()), navigatorLanguage: 'en-US' })).toBe('en');
    expect(detectLanguage({ storage: access(memoryStorage()), navigatorLanguage: 'zh-CN' })).toBe('zh');
  });

  it('都没给 / 都不认识 → 默认中文（本项目的文档与主线是中文）', () => {
    expect(detectLanguage({ storage: access(memoryStorage()), navigatorLanguage: 'fr-FR' })).toBe('zh');
    expect(detectLanguage({ storage: access(memoryStorage()), navigatorLanguage: null })).toBe('zh');
    // 存储里是脏值（手改过）→ 不当成有效选择
    expect(
      detectLanguage({
        storage: access(memoryStorage({ [LANGUAGE_STORAGE_KEY]: 'klingon' })),
        navigatorLanguage: 'en',
      }),
    ).toBe('en');
  });

  it('存储不可用（隐私模式 / SSR）→ 不炸，走浏览器 / 默认', () => {
    expect(detectLanguage({ storage: {}, navigatorLanguage: 'en' })).toBe('en');
    expect(detectLanguage({ storage: {}, navigatorLanguage: null })).toBe('zh');
  });

  it('saveLanguage 落盘（键是登记的 `astrmira.language`）', () => {
    const storage = memoryStorage();
    saveLanguage('en', access(storage));
    expect(storage.dump()[LANGUAGE_STORAGE_KEY]).toBe('en');
  });
});

describe('translate / interpolate（缺键不许显示空白）', () => {
  const dictionaries: Dictionaries = {
    zh: { 'nav.create': '创作', 'greet': '你好 {name}' },
    en: { 'nav.create': 'Create' },
  };

  it('取目标语言；变量插值', () => {
    expect(translate('en', 'nav.create', undefined, dictionaries)).toBe('Create');
    expect(translate('zh', 'greet', { name: 'Mira' }, dictionaries)).toBe('你好 Mira');
  });

  it('目标语言缺这条 → 回落中文（不显示空白）', () => {
    expect(translate('en', 'greet', { name: 'Mira' }, dictionaries)).toBe('你好 Mira');
  });

  it('两种语言都没有 → **回落键名本身**（可见地坏，而不是静默空白）', () => {
    expect(translate('en', 'nav.missing', undefined, dictionaries)).toBe('nav.missing');
  });

  it('插值变量缺失 → 原样保留 `{name}`（宁可显示占位，也不显示半个句子）', () => {
    expect(interpolate('你好 {name}', undefined)).toBe('你好 {name}');
    expect(interpolate('你好 {name}', {})).toBe('你好 {name}');
    expect(interpolate('{a} + {b}', { a: 1, b: 2 })).toBe('1 + 2');
  });
});
