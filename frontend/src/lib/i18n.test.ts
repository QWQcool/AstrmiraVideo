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
  type MessageKey,
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

  it('没选过、且迁移已完成 → 跟随浏览器语言', () => {
    expect(
      detectLanguage({
        storage: access(memoryStorage()),
        navigatorLanguage: 'en-US',
        migrationComplete: true,
      }),
    ).toBe('en');
    expect(
      detectLanguage({
        storage: access(memoryStorage()),
        navigatorLanguage: 'zh-CN',
        migrationComplete: true,
      }),
    ).toBe('zh');
  });

  it('**迁移未完成 → 忽略浏览器偏好**（英文浏览器也不许看到"外壳英文 + 正文中文"）', () => {
    // 这一条是"半中半英"的防线：英文浏览器的访客**没点过任何东西**，
    // 不该因为 navigator.language 就被扔进一个只翻了一半的界面。
    expect(
      detectLanguage({
        storage: access(memoryStorage()),
        navigatorLanguage: 'en-US',
        migrationComplete: false,
      }),
    ).toBe('zh');
    // 但他**显式选过**的语言仍然尊重（那是他的选择，不是我们的推断）
    const chosen = memoryStorage({ [LANGUAGE_STORAGE_KEY]: 'en' });
    expect(
      detectLanguage({ storage: access(chosen), navigatorLanguage: 'zh-CN', migrationComplete: false }),
    ).toBe('en');
  });

  it('都没给 / 都不认识 → 默认中文（本项目的文档与主线是中文）', () => {
    expect(detectLanguage({ storage: access(memoryStorage()), navigatorLanguage: 'fr-FR' })).toBe('zh');
    expect(detectLanguage({ storage: access(memoryStorage()), navigatorLanguage: null })).toBe('zh');
    // 存储里是脏值（手改过）→ 不当成有效选择
    expect(
      detectLanguage({
        storage: access(memoryStorage({ [LANGUAGE_STORAGE_KEY]: 'klingon' })),
        navigatorLanguage: 'en',
        migrationComplete: true,
      }),
    ).toBe('en');
  });

  it('存储不可用（隐私模式 / SSR）→ 不炸，走浏览器 / 默认', () => {
    expect(detectLanguage({ storage: {}, navigatorLanguage: 'en', migrationComplete: true })).toBe('en');
    expect(detectLanguage({ storage: {}, navigatorLanguage: null, migrationComplete: true })).toBe('zh');
    // 迁移未完成时，存储不可用同样不许被浏览器语言带跑
    expect(detectLanguage({ storage: {}, navigatorLanguage: 'en', migrationComplete: false })).toBe('zh');
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

  /**
   * 这一组测的是**回落与插值的机制**，用假字典最干净（真实字典里没有这些键）。
   *
   * V2.38 起 `translate` 的 key 是强类型（`MessageKey`）—— 写错键名**编译期就报**；
   * 代价就是这里要显式 cast：那正是那层保护在起作用，不是测试写错了。
   */
  const key = (raw: string): MessageKey => raw as MessageKey;

  it('取目标语言；变量插值', () => {
    expect(translate('en', key('nav.create'), undefined, dictionaries)).toBe('Create');
    expect(translate('zh', key('greet'), { name: 'Mira' }, dictionaries)).toBe('你好 Mira');
  });

  it('目标语言缺这条 → 回落中文（不显示空白）', () => {
    expect(translate('en', key('greet'), { name: 'Mira' }, dictionaries)).toBe('你好 Mira');
  });

  it('两种语言都没有 → **回落键名本身**（可见地坏，而不是静默空白）', () => {
    expect(translate('en', key('nav.missing'), undefined, dictionaries)).toBe('nav.missing');
  });

  it('插值变量缺失 → 原样保留 `{name}`（宁可显示占位，也不显示半个句子）', () => {
    expect(interpolate('你好 {name}', undefined)).toBe('你好 {name}');
    expect(interpolate('你好 {name}', {})).toBe('你好 {name}');
    expect(interpolate('{a} + {b}', { a: 1, b: 2 })).toBe('1 + 2');
  });
});
