import type { GenerationMode, ProviderStatus } from '@astrmira/shared';
import { getLanguage, translate } from './i18n';

/**
 * 执行引擎的**选项生成**（V2.36 / CONTRACT §19-1；台账 A1 后续）。
 *
 * ## 为什么要有这个模块
 * 此前"本地 ComfyUI"在界面上是**写死的一档**（一个按钮 + 一个常量 id）。
 * 多实例之后，"有哪些引擎可选"取决于**本服务的配置**（`/status` 的 `comfyui.servers`）——
 * 前端不该自己维护第二份名单（那必然与服务端漂移：配了三台、界面只显示一台）。
 *
 * 左栏与创作入口都用这一份（**一处口径**）；纯函数，所以能在单测里钉住"几台 → 几个选项"。
 */

export interface EngineOption {
  /** provider id（提交时原样放进请求体；实例名是 id 的一部分，见 §1） */
  id: string;
  /** 显示名（多实例时带上实例 label —— 不然分不清是哪一台） */
  label: string;
  /** 本服务这一台的**配置事实**（来自 `/status`；未配置 / 不合规 = false） */
  configured: boolean;
  /** 状态说明（按钮 title 与下方那行说明用） */
  hint: string;
  /** V2.47：配置型 HTTP 服务声明的能力；ComfyUI 选项不填 */
  modes?: GenerationMode[];
}

/** 没有配任何 ComfyUI 时界面上仍保留的那一档（与后端 `DEFAULT_COMFY_SERVER_ID` 同一个值） */
export const DEFAULT_COMFY_ENGINE_ID = 'host-comfyui';

/**
 * 由 `/status` 的 `comfyui` 段生成"本地 ComfyUI"的引擎选项。
 *
 * **没配任何一台时给出一项默认**（而不是空列表）：状态端点会说"未配置"，
 * 而开关本身保持可选、不置灰 —— §2 V1.8 的纪律是"只陈述本服务配没配，不替访客判断能不能用"。
 */
export function comfyUiEngineOptions(status: ProviderStatus | null): EngineOption[] {
  const servers = status?.comfyui.servers ?? [];

  const lang = getLanguage();

  if (servers.length === 0) {
    return [
      {
        id: DEFAULT_COMFY_ENGINE_ID,
        label: translate(lang, 'common.engine.localComfyUi'),
        configured: status?.comfyui.available === true,
        hint: status?.comfyui.reason ?? translate(lang, 'common.engine.comfyUiUnknown'),
      },
    ];
  }

  const multi = servers.length > 1;
  return servers.map((server) => ({
    id: server.id,
    // 单台的默认实例 → 与 V2.35 的观感完全一致（'本地 ComfyUI'）；
    // 其余一律带上实例 label（**哪怕只有一台具名实例**，也不能把它的名字吞掉）
    label:
      server.id === DEFAULT_COMFY_ENGINE_ID && !multi
        ? translate(lang, 'common.engine.localComfyUi')
        : translate(lang, 'common.engine.comfyUiNamed', { name: server.label }),
    configured: server.available,
    hint:
      server.reason ??
      (server.available
        ? translate(lang, 'common.engine.configured')
        : translate(lang, 'common.engine.unavailable')),
    // V2.51：最近一次自检的模式；缺省 = 未检测，调用方不得据此禁用
    ...(server.modes === undefined ? {} : { modes: server.modes }),
  }));
}

/**
 * V2.47（§22）：配置型 HTTP 任务服务的引擎选项。
 *
 * 没有配置时返回**空数组**（不造一个假的“远程服务”档）；每一项带 `modes`，
 * 让首页/画布按目标能力过滤，而不是选了才报 503。
 */
export function httpServiceEngineOptions(status: ProviderStatus | null): EngineOption[] {
  const servers = status?.httpServices.servers ?? [];
  const lang = getLanguage();
  return servers.map((server) => ({
    id: server.id,
    label: translate(lang, 'common.engine.httpServiceNamed', { name: server.label }),
    configured: server.available,
    hint:
      server.reason ??
      (server.available
        ? translate(lang, 'common.engine.httpConfigured')
        : translate(lang, 'common.engine.unavailable')),
    modes: server.modes,
  }));
}

/** 某个 id 是否属于配置型 HTTP 服务（含具名实例） */
export function isHttpServiceEngine(id: string): boolean {
  return id.startsWith('http-service:');
}

/**
 * provider id 的**显示名**（自检结果 / 画布节点 / 日志统一用它）。
 *
 * 未知 id **原样返回**（宁可显示一个 id，也不要显示空白 —— 空白最容易被当成"没这回事"）。
 */
export function providerLabel(id: string, status: ProviderStatus | null): string {
  const lang = getLanguage();
  if (id === 'cloud-volcano-seedance') return translate(lang, 'common.engine.cloud');
  // V2.37（D56）：这一档**已撤掉** —— 但它仍可能出现在**历史任务**与**旧编排文件**里，
  // 显示名必须如实（既不能显示成空白，也不能假装它还在）
  if (id === 'local-minimax-h3') return translate(lang, 'common.engine.h3Revoked');
  if (id === 'fixture-local') return translate(lang, 'common.engine.fixture');
  if (id === 'stock-local') return translate(lang, 'common.engine.stockLibrary');

  const comfyOption = comfyUiEngineOptions(status).find((item) => item.id === id);
  if (comfyOption !== undefined) return comfyOption.label;
  const httpOption = httpServiceEngineOptions(status).find((item) => item.id === id);
  if (httpOption !== undefined) return httpOption.label;

  // 有实例名但 `/status` 里没有它（例如刚改配置还没刷新）→ 至少把名字显示出来
  if (id.startsWith('host-comfyui:')) return `ComfyUI · ${id.slice('host-comfyui:'.length)}`;
  if (id.startsWith('http-service:')) return `HTTP · ${id.slice('http-service:'.length)}`;
  return id;
}

/** 某个 id 是否属于 ComfyUI 档（**含具名实例**）—— 判分支时用它，别写 `=== 'host-comfyui'` */
export function isComfyUiEngine(id: string): boolean {
  return id === DEFAULT_COMFY_ENGINE_ID || id.startsWith('host-comfyui:');
}
