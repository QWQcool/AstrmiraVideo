/**
 * 浏览器存储封装（PLAN §6-D4：不引入状态库，存储只走这里）。
 *
 * 两条纪律：
 * 1. 键名**集中登记**，不允许在组件里出现魔法字符串（否则清理/迁移会漏）；
 * 2. 读写一律 try/catch —— 隐私模式 / 配额满 / 被策略禁用时降级为 `null`，绝不抛到渲染层
 *    （抛了就是整页白屏，用户看不到任何原因）。
 */

export const STORAGE_KEYS = {
  /** 进行中的任务 id：刷新后据此向服务端重挂载（Step 3 AC2） */
  activeTaskId: 'astrmira.activeTaskId',
  /** 最近一次任务 id：用于「上次生成」入口（与 activeTaskId 分离，终态后仍保留） */
  lastTaskId: 'astrmira.lastTaskId',
  /** BYOK 配置（sessionStorage 存储位；勾选「明文存储」时改存 localStorage） */
  byok: 'astrmira.byok',
  /** 「明文存储到本机」勾选标志（偏好，恒存 localStorage） */
  byokPersist: 'astrmira.byokPersist',
  /** Seed 锁：锁定后复用同一 seed（Step 3 左栏） */
  seedLocked: 'astrmira.seedLocked',
  /** 最近使用的 seed 值 */
  lastSeed: 'astrmira.lastSeed',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/**
 * 注入式存取：测试可传内存实现，生产用 `window.localStorage` / `window.sessionStorage`。
 * 刻意**不收窄成 DOM 的 `Storage`**（它要求 length / clear / key 全套），
 * 否则测试桩得实现一堆用不到的方法。
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function safeGet(store: StorageLike | undefined, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(store: StorageLike | undefined, key: string, value: string): void {
  try {
    store?.setItem(key, value);
  } catch {
    /* 配额满 / 隐私模式：静默降级，不打断主流程 */
  }
}

function safeRemove(store: StorageLike | undefined, key: string): void {
  try {
    store?.removeItem(key);
  } catch {
    /* 同上 */
  }
}

export interface StorageAccess {
  local?: StorageLike;
  session?: StorageLike;
}

export function readLocal(access: StorageAccess, key: string): string | null {
  return safeGet(access.local, key);
}

export function writeLocal(access: StorageAccess, key: string, value: string): void {
  safeSet(access.local, key, value);
}

export function removeLocal(access: StorageAccess, key: string): void {
  safeRemove(access.local, key);
}

export function readSession(access: StorageAccess, key: string): string | null {
  return safeGet(access.session, key);
}

export function writeSession(access: StorageAccess, key: string, value: string): void {
  safeSet(access.session, key, value);
}

export function removeSession(access: StorageAccess, key: string): void {
  safeRemove(access.session, key);
}

export function readBool(access: StorageAccess, key: string): boolean {
  return readLocal(access, key) === 'true';
}

export function writeBool(access: StorageAccess, key: string, value: boolean): void {
  writeLocal(access, key, value ? 'true' : 'false');
}

/** 生产默认访问器：SSR / 测试环境下两个 Storage 可能都不存在 */
export function browserStorage(): StorageAccess {
  return {
    local: typeof window === 'undefined' ? undefined : window.localStorage,
    session: typeof window === 'undefined' ? undefined : window.sessionStorage,
  };
}
