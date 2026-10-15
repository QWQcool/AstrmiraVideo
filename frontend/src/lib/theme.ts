import type { MessageKey } from './i18n';
import { STORAGE_KEYS, readLocal, writeLocal } from './storage';
import type { StorageAccess } from './storage';

/**
 * 主题（V8.3 批次 2）。
 *
 * 三条约定：
 * 1. **默认跟随系统**（`prefers-color-scheme`）——不做"猜你喜欢"，也不强行暗色；
 * 2. 用户在顶栏可覆盖为 `dark`（星尘内核）或 `day`（现代简洁·蔚蓝），选择存 localStorage；
 * 3. 挂到 `<html data-theme="...">` 上，**颜色全部由 tokens.css 的两个 token 块决定**，
 *    组件层不认识主题（所以组件里不可能出现"只适配了暗色"的分支）。
 *
 * 纯函数（`readThemePref` / `resolveTheme` / `toDatasetTheme`）单独可测；
 * 触 DOM 的只有 `applyTheme` / `watchSystemTheme` 两个薄封装。
 */
export type ThemePref = 'system' | 'dark' | 'day';
export type ResolvedTheme = 'dark' | 'day';

export const THEME_PREFS = ['system', 'dark', 'day'] as const;

export const DEFAULT_THEME_PREF: ThemePref = 'system';

/**
 * 顶栏展示用文案的**键**（V2.38：外壳文案已进字典）。
 *
 * 为什么是键不是文案：主题档位的名字会出现在侧栏底部的分段控件里，
 * 而那里是"外壳"的一部分 —— 外壳切英文时它必须跟着切。
 * 渲染处 `t(THEME_LABEL_KEYS[pref])`（见 `components/Sidebar.tsx`）。
 */
export const THEME_LABEL_KEYS: Record<ThemePref, MessageKey> = {
  system: 'shell.themePref.system',
  dark: 'shell.themePref.dark',
  day: 'shell.themePref.day',
};

const PREF_SET = new Set<string>(THEME_PREFS);

/**
 * 读偏好。**脏值一律回落 `system`**（自愈而不是抛）：
 * 手改过 localStorage、或将来删掉某个档位时，界面不该因此白屏。
 */
export function readThemePref(storage: StorageAccess): ThemePref {
  const raw = readLocal(storage, STORAGE_KEYS.themePref);
  if (raw === null) return DEFAULT_THEME_PREF;
  return PREF_SET.has(raw) ? (raw as ThemePref) : DEFAULT_THEME_PREF;
}

export function writeThemePref(storage: StorageAccess, pref: ThemePref): void {
  writeLocal(storage, STORAGE_KEYS.themePref, pref);
}

/** 偏好 + 系统状态 → 实际生效的主题 */
export function resolveTheme(pref: ThemePref, systemPrefersDark: boolean): ResolvedTheme {
  if (pref === 'dark') return 'dark';
  if (pref === 'day') return 'day';
  return systemPrefersDark ? 'dark' : 'day';
}

/**
 * `data-theme` 的取值：暗色是**默认态**（`tokens.css` 的 `:root`），因此不带属性；
 * 只有日间需要显式打标（`:root[data-theme='day']`）。
 */
export function toDatasetTheme(resolved: ResolvedTheme): string | null {
  return resolved === 'day' ? 'day' : null;
}

export function applyTheme(resolved: ResolvedTheme, root?: HTMLElement): void {
  const target = root ?? document.documentElement;
  const value = toDatasetTheme(resolved);

  if (value === null) {
    // 暗色 = tokens.css 的 :root 默认值，去掉属性即可（避免留一个永假的选择器）
    target.removeAttribute('data-theme');
    return;
  }
  target.setAttribute('data-theme', value);
}

export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * 订阅系统主题变化；返回取消订阅函数。
 * 只有 `pref === 'system'` 时才需要订阅（手动档自己说了算）。
 */
export function watchSystemTheme(onChange: (prefersDark: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = (event: MediaQueryListEvent) => onChange(event.matches);
  media.addEventListener('change', handler);
  return () => media.removeEventListener('change', handler);
}
