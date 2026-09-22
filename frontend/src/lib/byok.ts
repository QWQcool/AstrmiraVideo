import type { StorageAccess } from './storage';
import {
  STORAGE_KEYS,
  readBool,
  readLocal,
  readSession,
  removeLocal,
  removeSession,
  writeBool,
  writeLocal,
  writeSession,
} from './storage';

/**
 * BYOK 前端半边（CONTRACT §5「凭据传递约定」/ 施工单 §7「BYOK 抽屉」）。
 *
 * 四条硬约束：
 * 1. Key **只**放进请求头 `X-Provider-Key`，**永不**进 URL / body / 日志；
 * 2. 默认存 `sessionStorage`（关标签页即失）；切 `localStorage` 必须**显式勾选**并看到明文警示；
 * 3. 清除 = 清本地存储（契约里没有服务端路由，符合"服务端只用不存"）；
 * 4. **HTTPS 守卫**：公网明文（`http:` 且非回环主机）**禁止填写 Key**（PLAN §9-2 红线的前置）。
 */

export interface ByokConfig {
  /** 服务端地址：火山方舟默认已填，允许用户改（自建代理 / 兼容端点） */
  baseUrl: string;
  /** API Key：仅存在于内存与浏览器存储，服务端只用不存 */
  key: string;
  /** 模型名（endpoint id 或模型 id） */
  model: string;
}

/** 火山方舟（方舟 v3）：默认值仅作**占位**，用户可改 */
export const DEFAULT_BYOK: ByokConfig = {
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  key: '',
  model: 'doubao-seedance-1-0-pro-250528',
};

/** 回环主机：明文 HTTP 下**唯一**允许填写 Key 的情形（本地开发） */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host === '127.0.0.1') return true;
  if (host.endsWith('.localhost')) return true;
  if (host.startsWith('127.')) return true;
  return false;
}

/**
 * 是否允许在本页面填写密钥。
 * HTTPS 恒允许；HTTP 仅当主机为回环（本地开发）。
 */
export function isKeyInputAllowed(location: {
  protocol: string;
  hostname: string;
}): boolean {
  if (location.protocol === 'https:') return true;
  return isLoopbackHost(location.hostname);
}

export function keyInputNotice(location: { protocol: string; hostname: string }): string | null {
  return isKeyInputAllowed(location)
    ? null
    : '公网明文环境禁止填写密钥，请使用 HTTPS（见部署说明 §9-2）';
}

function parse(raw: string | null): ByokConfig | null {
  if (raw === null || raw.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Partial<Record<keyof ByokConfig, unknown>>;
    return {
      baseUrl: typeof candidate.baseUrl === 'string' ? candidate.baseUrl : DEFAULT_BYOK.baseUrl,
      key: typeof candidate.key === 'string' ? candidate.key : '',
      model: typeof candidate.model === 'string' ? candidate.model : DEFAULT_BYOK.model,
    };
  } catch {
    return null;
  }
}

/** 是否勾选了「明文存储到本机」（偏好恒存 localStorage） */
export function isPersistEnabled(access: StorageAccess): boolean {
  return readBool(access, STORAGE_KEYS.byokPersist);
}

/** 读取配置：勾选了持久化就读 localStorage，否则读 sessionStorage */
export function readByok(access: StorageAccess): ByokConfig {
  const persist = isPersistEnabled(access);
  const raw = persist ? readLocal(access, STORAGE_KEYS.byok) : readSession(access, STORAGE_KEYS.byok);
  return parse(raw) ?? DEFAULT_BYOK;
}

/**
 * 写入配置：`persist` 决定落哪个 storage。
 * 切换时**两边都写干净**——否则「取消勾选」后旧值仍留在 localStorage（用户以为已清除）。
 */
export function writeByok(access: StorageAccess, config: ByokConfig, persist: boolean): void {
  const payload = JSON.stringify(config);

  if (persist) {
    writeLocal(access, STORAGE_KEYS.byok, payload);
    removeSession(access, STORAGE_KEYS.byok);
  } else {
    writeSession(access, STORAGE_KEYS.byok, payload);
    removeLocal(access, STORAGE_KEYS.byok);
  }

  writeBool(access, STORAGE_KEYS.byokPersist, persist);
}

/** 清除：两个 storage + 偏好标志一并清掉 */
export function clearByok(access: StorageAccess): void {
  removeLocal(access, STORAGE_KEYS.byok);
  removeSession(access, STORAGE_KEYS.byok);
  removeLocal(access, STORAGE_KEYS.byokPersist);
}

/** 提交时才取 Key；空串视为"没填"（服务端会回落到 env 兜底 Key 或报 KEY_MISSING） */
export function resolveProviderKey(config: ByokConfig): string | undefined {
  const trimmed = config.key.trim();
  return trimmed === '' ? undefined : trimmed;
}
