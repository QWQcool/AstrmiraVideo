import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ProviderStatusSchema } from '@astrmira/shared';
import type { ProviderStatus } from '@astrmira/shared';

/**
 * 本地引擎自检结果（服务端内存缓存）。
 *
 * V1.8（PLAN §6-D22）：本端点**不再是硬件探针**，只陈述**本服务自身**的配置事实。
 * 到达路径 = 配置 env + 重启（S5 由 `providers/statusProbe.ts` 启动时做一次轻量自检并写入这里）；
 * 运行时自检路由属 PLAN §9 台账 B4，**未实现**。
 */
export interface LocalEngineSelfCheck {
  available: boolean;
  tier?: 0 | 1 | 2 | 3;
  reason: string;
}

/** 部署者是否向访客开放 host 本地轨（CONTRACT §2：`EXPOSE_HOST_LOCAL_TRACK`，默认 0） */
function isHostLocalTrackExposed(): boolean {
  return process.env.EXPOSE_HOST_LOCAL_TRACK === '1';
}

/** 启动自检缓存；在 S5 接入前恒为 null（即"未配置本地引擎"） */
let localEngineSelfCheck: LocalEngineSelfCheck | null = null;

/** 供 S5 的 statusProbe 写入自检结果 */
export function setLocalEngineSelfCheck(next: LocalEngineSelfCheck | null): void {
  localEngineSelfCheck = next;
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

  const selfCheck = localEngineSelfCheck;
  if (selfCheck === null) {
    return {
      available: false,
      provider: 'minimax-h3',
      reason: '本服务未配置本地引擎',
    };
  }

  return {
    available: selfCheck.available,
    provider: 'minimax-h3',
    tier: selfCheck.tier,
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
