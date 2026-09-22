import { z } from 'zod';
import { ProviderTypeSchema } from './request.js';

/**
 * 契约投影来源：docs/CONTRACT.md §2 算力状态检测契约 `ProviderStatus`
 * 分级定义见 GUIDE.md §一（Tier 0~3）；服务端探测不得硬编码任何显卡型号（PLAN §6-D12）。
 */

export const HardwareTierSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const CloudProviderStatusSchema = z.object({
  // V1.6：env VOLCANO_API_KEY 或会话内存 BYOK Key 任一存在即为 true
  available: z.boolean(),
  provider: z.literal('volcano-seedance'),
  // V1.6：Key 来源；available=true 时必填。session = 前端设置抽屉填入、服务端会话内存持有
  keySource: z.enum(['env', 'session']).optional(),
  // 需能区分「完全未配置」与具体来源情形
  reason: z.string().optional(),
});

export const LocalProviderStatusSchema = z.object({
  available: z.boolean(),
  provider: z.literal('minimax-h3'),
  tier: HardwareTierSchema,
  gpuName: z.string().optional(),
  vramFreeGB: z.number().optional(),
  // 无 GPU 时提示「未检测到本地 GPU 推理环境，推荐使用云端 API」
  reason: z.string().optional(),
});

export const ProviderStatusSchema = z.object({
  cloud: CloudProviderStatusSchema,
  local: LocalProviderStatusSchema,
  // Tier 0 时固定为 'cloud-volcano-seedance'
  defaultProvider: ProviderTypeSchema,
});

export type HardwareTier = z.infer<typeof HardwareTierSchema>;
export type CloudProviderStatus = z.infer<typeof CloudProviderStatusSchema>;
export type LocalProviderStatus = z.infer<typeof LocalProviderStatusSchema>;
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;
