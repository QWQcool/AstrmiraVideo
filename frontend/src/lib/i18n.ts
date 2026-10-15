import { useSyncExternalStore } from 'react';
import { browserStorage, readLocal, writeLocal, type StorageAccess } from './storage';

/**
 * 界面语言的基础设施（**L1 收官件 · 第二批**；台账见 PLAN §5）。
 *
 * ## 本片只做基础设施（这一点必须写清，免得被当成"已经能切英文了"）
 * 这里落的是**语言状态 / 检测 / 持久化 / 字典查找 / React 接线**。
 * **切换入口与全量文案迁移在下一片一起上线** —— 那之前界面仍是纯中文：
 * 让用户能切到英文、却看到"半中半英"，比"只有中文"更糟。
 *
 * ## 三条口径
 * 1. **默认中文**：本项目的文档与产品主线都是中文；浏览器语言不认识 / 检测不到 → `zh`；
 * 2. **显式选择优先**：用户在本机选过的语言（`astrmira.language`）压过浏览器偏好 ——
 *    否则"我明明选过英文，换个浏览器语言又变回去"会反复出现；
 * 3. **缺键不显示空白**：`translate` 的回落顺序是 目标语言 → 中文 → **键名本身**
 *    （显示一个键名很丑，但它**可见**；空白会被当成"这里本来就没字"）。
 */

export type Language = 'zh' | 'en';

/** 本机存储键（与 `storage.ts` 的键集中登记同一族；语言是"本机偏好"，与项目无关） */
export const LANGUAGE_STORAGE_KEY = 'astrmira.language';

export const SUPPORTED_LANGUAGES: readonly Language[] = ['zh', 'en'];

/** 语言的自称（语言切换菜单里用它，而不是"英语 / English"混排） */
export const LANGUAGE_LABELS: Record<Language, string> = {
  zh: '中文',
  en: 'English',
};

/**
 * 把"浏览器给的那串"归一成我们支持的语言（`zh-CN` / `zh-Hans` → `zh`；不认识 → null）。
 *
 * 为什么不一上来就 `.startsWith('zh')`：那会把 `zhx` 这种野值也算成中文 ——
 * 归一化的职责是"**只认我们支持的**"，其余交给调用方回落。
 */
export function normalizeLanguage(raw: string | null | undefined): Language | null {
  if (raw === null || raw === undefined) return null;
  const primary = raw.trim().toLowerCase().split(/[-_]/)[0];
  return primary === 'zh' || primary === 'en' ? primary : null;
}

export interface DetectLanguageOptions {
  /** 注入本机存储（测试用；默认 `browserStorage()`） */
  storage?: StorageAccess;
  /** 注入浏览器语言（测试用；默认 `navigator.language`） */
  navigatorLanguage?: string | null;
  /** 默认语言（缺省 `zh`） */
  fallback?: Language;
}

/** 当前该用哪种语言：**显式选择 > 浏览器偏好 > 默认** */
export function detectLanguage(options: DetectLanguageOptions = {}): Language {
  const stored = normalizeLanguage(readLocal(options.storage ?? browserStorage(), LANGUAGE_STORAGE_KEY));
  if (stored !== null) return stored;

  const navigatorLanguage =
    options.navigatorLanguage === undefined
      ? typeof navigator === 'undefined'
        ? null
        : navigator.language
      : options.navigatorLanguage;
  return normalizeLanguage(navigatorLanguage) ?? options.fallback ?? 'zh';
}

export function saveLanguage(language: Language, storage: StorageAccess = browserStorage()): void {
  writeLocal(storage, LANGUAGE_STORAGE_KEY, language);
}

// ── 字典 ────────────────────────────────────────────────────────────────────

/** 文案字典：键 → 文案模板。模板里的 `{name}` 会被 `vars` 替换 */
export type Dictionary = Readonly<Record<string, string>>;
export type Dictionaries = Readonly<Record<Language, Dictionary>>;

/**
 * 全量文案字典（**下一片填充**）。
 *
 * 现在它是空的：本片不迁移任何界面文案 —— 迁移是"要么全做、要么不做"的事
 * （半迁移的界面切到英文就是半中半英）。
 */
export const DICTIONARIES: Dictionaries = { zh: {}, en: {} };

/** 把模板里的 `{key}` 替换成值；没有对应变量时**原样保留**（宁可显示 `{n}` 也不显示空白） */
export function interpolate(template: string, vars?: Readonly<Record<string, string | number>>): string {
  if (vars === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars[name];
    return value === undefined ? whole : String(value);
  });
}

/**
 * 取一条文案。回落顺序：目标语言 → 中文 → **键名**（见文件头的第 3 条口径）。
 */
export function translate(
  language: Language,
  key: string,
  vars?: Readonly<Record<string, string | number>>,
  dictionaries: Dictionaries = DICTIONARIES,
): string {
  const template = dictionaries[language][key] ?? dictionaries.zh[key] ?? key;
  return interpolate(template, vars);
}

// ── 运行期状态（React 通过 useSyncExternalStore 订阅）─────────────────────────

let currentLanguage: Language | null = null;
const listeners = new Set<() => void>();

/** 当前语言（首次读取时按"显式选择 > 浏览器 > 默认"检测一次并记住） */
export function getLanguage(): Language {
  currentLanguage ??= detectLanguage();
  return currentLanguage;
}

/** 切语言（并落本机存储）—— 下一片接上入口后由界面调用 */
export function setLanguage(language: Language, storage?: StorageAccess): void {
  if (currentLanguage === language) return;
  currentLanguage = language;
  saveLanguage(language, storage ?? browserStorage());
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** ⚠️ 仅供测试：清掉运行期缓存（不动本机存储） */
export function __resetLanguageCacheForTesting(): void {
  currentLanguage = null;
}

/** 当前语言（组件里用它；语言变化会重渲染） */
export function useLanguage(): Language {
  return useSyncExternalStore(subscribe, getLanguage, getLanguage);
}

/** 取文案的 hook：`const t = useTranslate(); t('nav.create')` */
export function useTranslate(): (key: string, vars?: Readonly<Record<string, string | number>>) => string {
  const language = useLanguage();
  return (key, vars) => translate(language, key, vars);
}
