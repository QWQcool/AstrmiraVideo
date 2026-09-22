import { z } from 'zod';

/**
 * 契约投影来源：docs/CONTRACT.md §8 辅助响应类型 `HealthResponse`（V1.7 新增）
 * 此前路由表只写「存活探针」而无响应形状定义，本节补齐该缺口。
 */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  name: z.string(), // 服务标识，如 'AstrmiraVideo Backend'
  version: z.string(), // 服务版本号
  timestamp: z.string(), // ISO 8601
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
