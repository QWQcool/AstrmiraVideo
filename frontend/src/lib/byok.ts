import {
  LLM_PRESETS,
  VIDEO_CUSTOM_MODEL_ID,
  VIDEO_DEFAULT_MODEL,
  VIDEO_MODEL_PRESETS,
  videoModelSelection,
} from '@astrmira/shared';
import { getLanguage, translate } from './i18n';
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
 * BYOK 前端半边（CONTRACT §5「凭据传递约定」/ PLAN §4 Step 3「BYOK 抽屉」）。
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

  // ── 文本轨（V2.0 扩写，PLAN §6-D24）─────────────────────────────
  // 与视频轨**相互独立**：视频是方舟，文本可以是任意 OpenAI 兼容端点；
  // 共用一把 Key 会让人以为"填了视频 Key 就能扩写"（前端提供一键复用，字段仍是分开的）。
  /** 预设 id（`LLM_PRESETS` 里的 id 或 'custom'） */
  llmPreset: string;
  /** 文本端点地址（随预设自动填，可覆盖） */
  llmBaseUrl: string;
  /** 文本模型名（随预设自动填，可覆盖） */
  llmModel: string;
  /** 文本 API Key：同视频 Key 一样只用不存 */
  llmKey: string;
}

/**
 * 火山方舟（方舟 v3）：地址默认已填，**模型默认取"已实测可用且最省钱的档"**
 * （`VIDEO_DEFAULT_MODEL`，V2.1；此前是一个手打值，用户填错就是一次白花钱的提交）。
 */
export const DEFAULT_BYOK: ByokConfig = {
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  key: '',
  model: VIDEO_DEFAULT_MODEL,
  llmPreset: LLM_PRESETS[0]?.id ?? 'openai',
  llmBaseUrl: LLM_PRESETS[0]?.baseUrl ?? '',
  llmModel: LLM_PRESETS[0]?.model ?? '',
  llmKey: '',
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
  // 纯函数（无 React）→ 按当前语言现取；调用它的抽屉订阅了语言，语言一变会重渲染
  return isKeyInputAllowed(location)
    ? null
    : translate(getLanguage(), 'byok.warn.publicPlaintext');
}

function parse(raw: string | null): ByokConfig | null {
  if (raw === null || raw.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Partial<Record<keyof ByokConfig, unknown>>;
    // 逐字段回落：旧版本存下的配置里没有文本轨字段（V2.0 才加），
    // 因此**必须**按字段判类型而不是"整体解析成功就用"——否则升级后 LLM 字段全是 undefined。
    return {
      baseUrl: typeof candidate.baseUrl === 'string' ? candidate.baseUrl : DEFAULT_BYOK.baseUrl,
      key: typeof candidate.key === 'string' ? candidate.key : '',
      model: typeof candidate.model === 'string' ? candidate.model : DEFAULT_BYOK.model,
      llmPreset:
        typeof candidate.llmPreset === 'string' && candidate.llmPreset !== ''
          ? candidate.llmPreset
          : DEFAULT_BYOK.llmPreset,
      llmBaseUrl:
        typeof candidate.llmBaseUrl === 'string' ? candidate.llmBaseUrl : DEFAULT_BYOK.llmBaseUrl,
      llmModel: typeof candidate.llmModel === 'string' ? candidate.llmModel : DEFAULT_BYOK.llmModel,
      llmKey: typeof candidate.llmKey === 'string' ? candidate.llmKey : '',
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

/**
 * 文本轨 Key（V2.0）。空串视为"没填" —— 扩写端点是**纯 BYOK**，
 * 服务端没有兜底 Key，没填就是 `501 LLM_NOT_CONFIGURED`（前端据此把 ✨ 置灰）。
 */
export function resolveLlmKey(config: ByokConfig): string | undefined {
  const trimmed = config.llmKey.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * 扩写请求里的端点配置。两个字段都留空时**不发送** `llm` 字段
 * （服务端会回落到 `LLM_PRESETS` 的第一项，与这里显示的值一致）。
 */
export function resolveLlmConfig(config: ByokConfig): { preset: string; baseUrl?: string; model?: string } {
  const baseUrl = config.llmBaseUrl.trim();
  const model = config.llmModel.trim();
  return {
    preset: config.llmPreset,
    ...(baseUrl === '' ? {} : { baseUrl }),
    ...(model === '' ? {} : { model }),
  };
}

/**
 * 当前 model 对应下拉里的哪一项（不在预设表里 → 自定义）。
 * 直接复用 shared 的判定，避免"前端认一个名字、后端认另一个名字"。
 */
export function videoPresetSelection(config: ByokConfig): string {
  return videoModelSelection(config.model);
}

/**
 * 选视频档位：把该档的模型 id 写进 `model`。
 *
 * `custom` 刻意**不动** `model` —— 那一刻的值就是用户自己要填的控制台接入点
 * （`ep-…`），抹掉等于让他重填（与文本轨 `applyLlmPreset` 同一口径）。
 */
export function applyVideoPreset(config: ByokConfig, presetId: string): ByokConfig {
  if (presetId === VIDEO_CUSTOM_MODEL_ID) return { ...config, model: '' };
  const preset = VIDEO_MODEL_PRESETS.find((item) => item.id === presetId);
  return preset === undefined ? config : { ...config, model: preset.id };
}

/**
 * 切换预设时把该预设的地址与模型**填进输入框**。
 *
 * 为什么不是"留空即用预设默认值"：那样用户看到的输入框是空的，
 * 却不知道实际会请求哪里 —— 凭据配置界面最不该有的就是"看不见的默认值"。
 * `custom` 刻意**不动**输入框：那是用户自己的地址，切来切去会把它抹掉。
 */
export function applyLlmPreset(config: ByokConfig, presetId: string): ByokConfig {
  const preset = LLM_PRESETS.find((item) => item.id === presetId);
  if (preset === undefined) return { ...config, llmPreset: presetId };
  return { ...config, llmPreset: preset.id, llmBaseUrl: preset.baseUrl, llmModel: preset.model };
}
