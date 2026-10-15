import type { ProviderStatus } from '@astrmira/shared';

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

  if (servers.length === 0) {
    return [
      {
        id: DEFAULT_COMFY_ENGINE_ID,
        label: '本地 ComfyUI',
        configured: status?.comfyui.available === true,
        hint: status?.comfyui.reason ?? '本地 ComfyUI 状态未知',
      },
    ];
  }

  const multi = servers.length > 1;
  return servers.map((server) => ({
    id: server.id,
    // 单台的默认实例 → 与 V2.35 的观感完全一致（'本地 ComfyUI'）；
    // 其余一律带上实例 label（**哪怕只有一台具名实例**，也不能把它的名字吞掉）
    label:
      server.id === DEFAULT_COMFY_ENGINE_ID && !multi ? '本地 ComfyUI' : `ComfyUI · ${server.label}`,
    configured: server.available,
    hint: server.reason ?? (server.available ? '本服务已配置这一台（地址合规）' : '这一台不可用'),
  }));
}

/**
 * provider id 的**显示名**（自检结果 / 画布节点 / 日志统一用它）。
 *
 * 未知 id **原样返回**（宁可显示一个 id，也不要显示空白 —— 空白最容易被当成"没这回事"）。
 */
export function providerLabel(id: string, status: ProviderStatus | null): string {
  if (id === 'cloud-volcano-seedance') return '云端 Seedance';
  if (id === 'local-minimax-h3') return '本地 MiniMax H3';
  if (id === 'fixture-local') return '开发期夹具';
  if (id === 'stock-local') return '素材库（未实现）';

  const option = comfyUiEngineOptions(status).find((item) => item.id === id);
  if (option !== undefined) return option.label;

  // 有实例名但 `/status` 里没有它（例如刚改配置还没刷新）→ 至少把名字显示出来
  if (id.startsWith('host-comfyui:')) return `ComfyUI · ${id.slice('host-comfyui:'.length)}`;
  return id;
}

/** 某个 id 是否属于 ComfyUI 档（**含具名实例**）—— 判分支时用它，别写 `=== 'host-comfyui'` */
export function isComfyUiEngine(id: string): boolean {
  return id === DEFAULT_COMFY_ENGINE_ID || id.startsWith('host-comfyui:');
}
