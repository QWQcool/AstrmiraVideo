import { useCallback, useSyncExternalStore } from 'react';
import { DICTIONARIES, I18N_MIGRATION_COMPLETE } from './dict/index.js';
import type { MessageKey } from './dict/index.js';
import { browserStorage, readLocal, writeLocal, type StorageAccess } from './storage';

/**
 * 界面语言的基础设施（**L1 收官件 · 第二批**；台账见 PLAN §5）。
 *
 * ## 现状（诚实地说，免得被当成"已经能切英文了"）
 * 基础设施 + **外壳文案已迁移**（侧栏 / 顶栏 / 区域名 / 凭据提示 —— 见 `lib/dict/`）。
 * 其余视图的文案**仍在迁移中**，所以**切换入口还没上线**：
 * 让用户能切到英文、却看到"半中半英"，比"只有中文"更糟。
 * **上线条件 = `lib/dict/index.ts` 里列的各域全部迁完**（那份文件同时就是迁移进度表）。
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
  // 语言的**自称**：`中文` 与 `English` 各自用本语言写，两种界面语言下都不变 ——
  // 这正是语言切换菜单的惯例（把"中文"在英文界面里写成 "Chinese" 反而更难认）。
  // i18n-exempt: 语言自称（切换菜单里两种语言下都保持原样，理由见上两行）
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
  /**
   * 迁移是否完成（缺省 = `I18N_MIGRATION_COMPLETE`）。
   *
   * 为什么做成可注入：这一条**行为分叉**必须两边都测 —— "未完成时不许被浏览器语言带跑"
   * 与"完成后正常跟随浏览器"各有用例。靠改常量来测，迟早会有人忘了改回来。
   */
  migrationComplete?: boolean;
}

/**
 * 当前该用哪种语言：**显式选择 > 浏览器偏好 > 默认**。
 *
 * ⚠️ 例外：**迁移未完成时跳过"浏览器偏好"那一环** —— 否则英文浏览器的访客会看到
 * "外壳英文 + 正文中文"（半中半英，且不是他能控制的：他没点过任何东西）。
 * 显式选择仍然尊重（那是用户自己的选择）。见 `dict/index.ts` 的 `I18N_MIGRATION_COMPLETE`。
 */
export function detectLanguage(options: DetectLanguageOptions = {}): Language {
  const stored = normalizeLanguage(readLocal(options.storage ?? browserStorage(), LANGUAGE_STORAGE_KEY));
  if (stored !== null) return stored;

  if (!(options.migrationComplete ?? I18N_MIGRATION_COMPLETE)) return options.fallback ?? 'zh';

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
 * 全量文案字典：**组装处只有一处** = `lib/dict/index.ts`（那里也是迁移进度表）。
 *
 * 这里只重新导出，调用方继续从 `i18n` 取用即可；依赖方向是**单向**的
 * （`i18n` → `dict/`，`dict/` 不 import 运行时代码），所以不会有循环依赖。
 */
export { DICTIONARIES };
export type { MessageKey };

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
  key: MessageKey,
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

/**
 * 取文案的 hook：`const t = useTranslate(); t('shell.nav.create')`。
 *
 * ⚠️ 返回值用 `useCallback` 包住（**身份只在语言变化时变**）：
 * 组件里那些 `useCallback(..., [t])` 才不会被"每次渲染都新建的函数"逼着重建
 * （那会让依赖数组失去意义，也让 lint 的 exhaustive-deps 变成噪音）。
 */
export function useTranslate(): Translate {
  const language = useLanguage();
  return useCallback<Translate>(
    (key, vars) => translate(language, key, vars),
    [language],
  );
}

/**
 * "取文案"这件事的**类型**（`useTranslate()` 的返回值）。
 *
 * 存在的理由：有些**纯函数**（如 `views/CreateView.tsx` 里把资产转成 chip 引用的
 * `refFromAsset`）也要产出用户可见的文案 —— 它们不该 import React，
 * 所以把 `t` 当参数传进去。有了这个类型，传参处就有类型检查（而不是 `any` 乱飞）。
 */
export type Translate = (key: MessageKey, vars?: Readonly<Record<string, string | number>>) => string;
