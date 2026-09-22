import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { HealthResponseSchema } from '@astrmira/shared';
import type { HealthResponse } from '@astrmira/shared';

const SERVICE_NAME = 'AstrmiraVideo Backend';
const SERVICE_VERSION = '0.1.0';

/**
 * 存活探针。
 * 路由权威：CONTRACT §5；响应形状权威：CONTRACT §8（V1.7 新增 `HealthResponse`）。
 * 响应经 response schema 序列化——schema 之外的字段会被剥离（PLAN §6-D19）。
 */
export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/api/health',
    {
      schema: {
        response: { 200: HealthResponseSchema },
      },
    },
    async (): Promise<HealthResponse> => ({
      status: 'ok',
      name: SERVICE_NAME,
      version: SERVICE_VERSION,
      timestamp: new Date().toISOString(),
    }),
  );
};
