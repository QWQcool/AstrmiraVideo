import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ProviderStatusSchema } from '@astrmira/shared';
import type { ProviderStatus } from '@astrmira/shared';
import { isAllowedEngineUrl, runLocalEngineSelfCheck } from '../providers/statusProbe.js';

/** 部署者是否向访客开放 host 本地轨（CONTRACT §2：`EXPOSE_HOST_LOCAL_TRACK`，默认 0） */
function isHostLocalTrackExposed(): boolean {
  return process.env.EXPOSE_HOST_LOCAL_TRACK === '1';
}

/** 服务端视角的云端状态：只表示 env 兜底 Key 是否存在（客户端 Key 由前端自行合成） */
function resolveCloudStatus(): ProviderStatus['cloud'] {
  const envKey = process.env.VOLCANO_API_KEY;
  const hasEnvKey = typeof envKey === 'string' && envKey.trim() !== '';

  return hasEnvKey
    ? {
        available: true,
        provider: 'volcano-seedance',
        keySource: 'env',
        acceptsClientKey: true,
        reason: '服务端已配置兜底 Key（env）',
      }
    : {
        available: false,
        provider: 'volcano-seedance',
        acceptsClientKey: true,
        reason: '服务端未配置兜底 Key（BYOK：由客户端随请求头携带）',
      };
}

/**
 * 本地段：只报告本服务的配置状态，**不替访客判断设备能力**。
 * 文案纪律（PLAN §3 铁律 2）：reason 不得出现「你的设备 / 你没有显卡」类判断。
 */
function resolveLocalStatus(): ProviderStatus['local'] {
  if (!isHostLocalTrackExposed()) {
    return {
      available: false,
      provider: 'minimax-h3',
      reason: '本服务未向访客开放本地轨',
    };
  }

  // V2.32：**现算**（与 `comfyui` 段同源同法）——此前读的是"启动时写一次"的缓存，
  // 而 comfyui 段读 env，两者在同一次请求里可能给出不同口径的事实。
  const selfCheck = runLocalEngineSelfCheck();
  return {
    available: selfCheck.available,
    provider: 'minimax-h3',
    ...(selfCheck.tier === undefined ? {} : { tier: selfCheck.tier }),
    reason: selfCheck.reason,
  };
}

/**
 * 文本轨能力位（CONTRACT §2 V2.0，PLAN §6-D24）：**纯 BYOK** —— 服务端不设兜底 Key。
 *
 * 所以这里 `available` **恒为 false**，而且这一点必须写清楚：
 * 前端合成实际能力 = `acceptsClientKey && 本地有 LLM Key`。
 * 若把 `available` 当成"能不能用扩写"，就会复刻 V1.6 那个
 * 「用户填了 Key 也用不了」的漏洞（状态端点没有凭据上下文，它不知道访客手里有什么）。
 */
/**
 * 本地 ComfyUI（V2.31 / A1 片 C / CONTRACT §19）：与 `local` 同一套门控。
 *
 * 三条判定，顺序即优先级（都只是**本服务的配置事实**）：
 * 1. 没向访客开放本地轨 → 不可用（**默认如此** —— ComfyUI 跑在部署者的机器上，
 *    不因为"配了地址"就自动对访客开放）；
 * 2. `COMFYUI_BASE_URL` 未配 / 地址不合规（同一份白名单 `isAllowedEngineUrl`）→ 不可用；
 * 3. 都过 → 可用。
 *
 * **不在这里探测模式能力**（那要连用户的 ComfyUI）—— 见 `ComfyUiProviderStatusSchema` 的说明。
 */
function resolveComfyUiStatus(): ProviderStatus['comfyui'] {
  if (!isHostLocalTrackExposed()) {
    return { available: false, provider: 'comfyui', reason: '本服务未向访客开放本地轨' };
  }

  const raw = process.env.COMFYUI_BASE_URL?.trim();
  if (raw === undefined || raw === '') {
    return {
      available: false,
      provider: 'comfyui',
      reason: '本服务未配置 ComfyUI（缺 COMFYUI_BASE_URL）',
    };
  }
  if (!isAllowedEngineUrl(raw)) {
    return {
      available: false,
      provider: 'comfyui',
      reason: 'COMFYUI_BASE_URL 仅允许回环或内网地址（防 SSRF）',
    };
  }

  return {
    available: true,
    provider: 'comfyui',
    reason: '本服务已配置 ComfyUI（地址合规；能跑哪些模式在提交时判定）',
  };
}

function resolveLlmStatus(): ProviderStatus['llm'] {
  return {
    available: false,
    provider: 'openai-compatible',
    acceptsClientKey: true,
    reason: '本服务不提供文本侧兜底 Key（纯 BYOK）：请在设置里填入 LLM Key',
  };
}

/**
 * 本地引擎配置状态（S5 接入启动自检前为固定未配置态）。
 * 契约：CONTRACT §2（V1.8 / V2.0）。
 * 本文件**不得**出现任何具体显卡型号或显存数字（PLAN §6-D27）。
 */
export function buildProviderStatus(): ProviderStatus {
  return {
    cloud: resolveCloudStatus(),
    local: resolveLocalStatus(),
    comfyui: resolveComfyUiStatus(),
    llm: resolveLlmStatus(),
    defaultProvider: 'cloud-volcano-seedance',
  };
}

/**
 * 算力 / 本地引擎状态路由（CONTRACT §5）。
 */
export const providerRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/api/providers/status',
    {
      schema: {
        response: { 200: ProviderStatusSchema },
      },
    },
    async () => buildProviderStatus(),
  );
};
