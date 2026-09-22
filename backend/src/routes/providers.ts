import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ProviderStatusSchema } from '@astrmira/shared';
import type { ProviderStatus } from '@astrmira/shared';

/**
 * BYOK Key 的第二入口：会话内存（前端设置抽屉填入、服务端持有，见 GUIDE §二轨道 B）。
 * Step 1.5 阶段会话存储尚不存在，此处为恒空 stub；保留该入口是为了让 available 判定
 * 与 CONTRACT §2 语义保持一致（env VOLCANO_API_KEY 或会话 Key 任一存在即为 true），
 * 避免 Step 2 接入会话存储时再改动判定分支。
 */
const sessionKeyStore: { volcanoApiKey: string | null } = { volcanoApiKey: null };

function resolveCloudKeySource(): 'env' | 'session' | null {
  const envKey = process.env.VOLCANO_API_KEY;
  if (typeof envKey === 'string' && envKey.trim() !== '') {
    return 'env';
  }
  if (typeof sessionKeyStore.volcanoApiKey === 'string' && sessionKeyStore.volcanoApiKey !== '') {
    return 'session';
  }
  return null;
}

/**
 * 算力探针（占位实现，Step 2 由 statusProbe 真实探测替换）。
 * 契约：CONTRACT §2（V1.6）。本文件禁止出现任何具体显卡型号或显存数字（PLAN §6-D12 / §1）。
 */
export function buildProviderStatus(): ProviderStatus {
  const keySource = resolveCloudKeySource();

  // 显式标注为契约类型：字段改名 / 漏字段会在编译期立刻暴露
  const cloud: ProviderStatus['cloud'] = keySource
    ? {
        available: true,
        provider: 'volcano-seedance',
        keySource,
        reason:
          keySource === 'env'
            ? '已从服务端环境变量读取火山方舟 Key（BYOK）'
            : '已使用会话内存中的 BYOK Key（前端设置抽屉填入）',
      }
    : {
        available: false,
        provider: 'volcano-seedance',
        reason: '未配置火山方舟 Key，请在前端设置抽屉或 .env 中填入',
      };

  // 本地算力探测尚未实现：一律 available: false + reason
  const local: ProviderStatus['local'] = {
    available: false,
    provider: 'minimax-h3',
    tier: 0,
    reason: '本地算力探测尚未实现（Step 2 接入真实探针）',
  };

  return { cloud, local, defaultProvider: 'cloud-volcano-seedance' };
}

/**
 * 算力状态探测路由（CONTRACT §5；Tier 0 默认锁定云端）。
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
