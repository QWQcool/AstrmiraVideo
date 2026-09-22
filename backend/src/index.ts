import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { healthRoutes } from './routes/health.js';
import { providerRoutes } from './routes/providers.js';
import { LLM_KEY_HEADER, LOG_REDACT_PATHS, PROVIDER_KEY_HEADER } from './security/credential.js';

/**
 * CORS 白名单（PLAN §7-6 第一步）：由 `origin: true` 收紧为 `CORS_ORIGINS` 白名单，
 * 逗号分隔，本地开发默认 `http://localhost:5173`。
 */
const DEFAULT_CORS_ORIGINS = 'http://localhost:5173';

function resolveCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS;
  const source = typeof raw === 'string' && raw.trim() !== '' ? raw : DEFAULT_CORS_ORIGINS;
  return source
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
}

/** 测试环境关闭 pino-pretty transport（避免 worker 句柄与日志噪音干扰 inject 测试） */
const isTestEnv = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

/**
 * 组装应用（插件 + 路由）但**不 listen**：
 * 供 `app.inject()` 测试与直接运行共用同一装配路径（Step 1.5 / T4；PLAN §6-D19）。
 */
export async function buildApp() {
  const app = Fastify({
    // R2：反代后 req.ip 的正确性 —— 未开启时所有请求同 IP，防线 5 的冷却会退化成全局锁
    trustProxy: process.env.TRUST_PROXY === '1',
    logger: isTestEnv
      ? false
      : {
          // R2：Key 零留存 —— 凭据请求头与 authorization 一律不入日志（CONTRACT §5）
          redact: [...LOG_REDACT_PATHS],
          transport: {
            target: 'pino-pretty',
            options: {
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname',
            },
          },
        },
  }).withTypeProvider<ZodTypeProvider>();

  // schema 校验一等公民：请求校验与响应序列化均走 @astrmira/shared 的 zod schema
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, {
    origin: resolveCorsOrigins(),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    // R2：浏览器携带自定义请求头必须先被预检放行，否则本地 curl 通、浏览器必失败
    // （CONTRACT §5「凭据传递约定」）
    allowedHeaders: [
      'content-type',
      PROVIDER_KEY_HEADER,
      LLM_KEY_HEADER,
      'idempotency-key',
      'authorization',
    ],
  });

  // 路由目录惯例：backend/src/routes/<域>.ts（Step 2 的 6 条新路由沿用同一惯例）
  await app.register(healthRoutes);
  await app.register(providerRoutes);

  return app;
}

/**
 * 仅当本文件被**直接运行**（`tsx watch src/index.ts` / `node dist/index.js`）时才监听端口；
 * 被测试或其它模块 import 时不监听（T4-AC2：测试不依赖任何监听端口）。
 */
const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const HOST = process.env.HOST || '0.0.0.0';

  const app = await buildApp();

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`AstrmiraVideo 后端服务已就绪: http://localhost:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
