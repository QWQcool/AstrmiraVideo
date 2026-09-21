import Fastify from 'fastify';
import cors from '@fastify/cors';

const fastify = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  },
});

await fastify.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
});

// AC1 存活探针
fastify.get('/api/health', async () => {
  return {
    status: 'ok',
    name: 'AstrmiraVideo Backend',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  };
});

// 算力探针骨架（Step 2 将接入深度硬件检测）
fastify.get('/api/providers/status', async () => {
  return {
    cloud: {
      available: true,
      provider: 'volcano-seedance',
      reason: '云端 API 可用 (BYOK 模式)',
    },
    local: {
      available: true,
      provider: 'minimax-h3',
      tier: 2,
      gpuName: 'NVIDIA GeForce RTX 4060 Ti',
      vramFreeGB: 16,
      reason: '已检测到本地 MiniMax H3 推理环境',
    },
    defaultProvider: 'cloud-volcano-seedance',
  };
});

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

try {
  await fastify.listen({ port: PORT, host: HOST });
  fastify.log.info(`AstrmiraVideo 后端服务已就绪: http://localhost:${PORT}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
