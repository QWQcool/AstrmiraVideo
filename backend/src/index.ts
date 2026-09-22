import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { cleanupTaskTemp } from './pipeline/cleanup.js';
import { getProvider } from './providers/registry.js';
import { runLocalEngineSelfCheck } from './providers/statusProbe.js';
import { JobDispatcher } from './queue/dispatcher.js';
import { SqliteJobQueue } from './queue/SqliteJobQueue.js';
import { createEnhanceRoutes } from './routes/enhance.js';
import { createGenerateRoutes } from './routes/generate.js';
import { healthRoutes } from './routes/health.js';
import { createHistoryRoutes } from './routes/history.js';
import { providerRoutes, setLocalEngineSelfCheck } from './routes/providers.js';
import { createTaskRoutes } from './routes/tasks.js';
import { createUploadRoutes, MAX_FILE_BYTES } from './routes/upload.js';
import {
  assertAuthConfiguredForProduction,
  createAuthHook,
  resolveAuthToken,
} from './security/auth.js';
import { LLM_KEY_HEADER, LOG_REDACT_PATHS, PROVIDER_KEY_HEADER } from './security/credential.js';
import { createKeyVault } from './security/keyVault.js';
import { CooldownStore } from './security/rateLimit.js';
import { registerStaticOutputs, resolveOutputsDir } from './server/staticOutputs.js';
import { createAssetUrlResolver } from './store/assets.js';
import { openDatabase } from './store/db.js';
import { reconcileOrphanTasks } from './store/reconciliation.js';
import { TaskStore } from './store/taskStore.js';

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

  // 生产护栏：未配置访问令牌直接启动失败（PLAN §7-4）
  assertAuthConfiguredForProduction();

  // 安全响应头（PLAN §7-4 加固）
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
  });

  // 最小鉴权：两层免鉴权（回环来源全部 + 任何来源的 /api/health），其余需 Bearer
  const authToken = resolveAuthToken();
  if (authToken === undefined && !isTestEnv) {
    app.log.warn(
      '未配置 PUBLIC_API_TOKEN：当前不启用鉴权（本地开发）。公网部署必须配置（PLAN §7-4）',
    );
  }
  app.addHook('onRequest', createAuthHook(authToken));

  // 上传：体积上限交给 multipart 做流式保护；**数量**上限由路由自行计数（见 routes/upload.ts）
  await app.register(multipart, {
    limits: { fileSize: MAX_FILE_BYTES },
  });

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

  // 本地引擎**配置自检**：启动时一次、写内存缓存（不扫描硬件 —— CONTRACT §2 V1.8 / PLAN §6-D22）
  setLocalEngineSelfCheck(runLocalEngineSelfCheck());

  // 路由目录惯例：backend/src/routes/<域>.ts（Step 2 的 6 条新路由沿用同一惯例）
  await app.register(healthRoutes);
  await app.register(providerRoutes);

  // ── 公共链路（S2）：SQLite 存储 + 队列 + 双轨调度器 + 静态媒体（206 载体）─────────
  const db = openDatabase();
  const store = new TaskStore(db);
  const queue = new SqliteJobQueue(store);
  // 防线 5：60s 防抖冷却（键的构成见 security/rateLimit.ts）
  const cooldown = new CooldownStore(db);

  // B 方案（PLAN §6-D23）：BYOK 凭据的**进程内**暂存。不落库、终态即清、重启即空
  // （重启后仍在途的任务由下面的启动调解如实归档，绝不猜、绝不自动重提）。
  const keyVault = createKeyVault();

  // 参考资产 → 上游可访问地址；`PUBLIC_BASE_URL` 未配（本地/内网）时退回 data URL
  const publicBaseUrl = process.env.PUBLIC_BASE_URL?.trim();
  const resolveAssetUrl = createAssetUrlResolver({
    assetsDir: path.join(resolveOutputsDir(), 'assets'),
    ...(publicBaseUrl === undefined || publicBaseUrl === '' ? {} : { publicBaseUrl }),
  });

  // 启动调解：上次进程退出时留下的 running 任务必须归档 ——
  // 否则界面上它们会永远停在 40%，而持有上游 id 的那批其实已经可能计费了。
  const reconciled = reconcileOrphanTasks(store);
  if (reconciled.uncertain.length > 0 || reconciled.retryable.length > 0) {
    app.log.warn(
      {
        uncertain: reconciled.uncertain.length,
        retryable: reconciled.retryable.length,
      },
      '已归档上次退出时遗留的在途任务（uncertain 需人工核对）',
    );
  }

  const dispatcher = new JobDispatcher({
    queue,
    resolveProvider: getProvider,
    // B 方案：凭据按任务暂存在进程内存，调度器领取时取出、终态时释放
    keyVault,
    // 参考资产 → 上游可访问地址（公网基址未配时退回 data URL）
    resolveAssetUrl,
    // 防线 3：合成结束即清中间帧目录（成败都清）
    cleanup: (taskId) => cleanupTaskTemp(taskId),
    // 防线 7：上游接受提交后立即写回，此后该任务不可 requeue
    markUpstreamAccepted: async (taskId, upstreamTaskId) => {
      queue.setUpstreamTaskId(taskId, upstreamTaskId);
    },
    onError: (err) => app.log.warn({ err }, '任务执行异常'),
  });
  dispatcher.start();

  app.addHook('onClose', async () => {
    dispatcher.stop();
    db.close();
  });

  await app.register(
    createGenerateRoutes({ store, queue, resolveProvider: getProvider, cooldown, keyVault }),
  );
  await app.register(createUploadRoutes());
  await app.register(createEnhanceRoutes());
  await app.register(createTaskRoutes({ store }));
  await app.register(createHistoryRoutes({ store }));
  await registerStaticOutputs(app);

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
