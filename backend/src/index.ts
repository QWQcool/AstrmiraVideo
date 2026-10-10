import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { createErrorResponse } from './errors.js';
import { cleanupTaskTemp } from './pipeline/cleanup.js';
import { createEditJobRunner } from './pipeline/editExecutor.js';
import { createTaskThumbnail } from './pipeline/thumbnail.js';
import { getEnvModelWarning, getProvider } from './providers/registry.js';
import { runLocalEngineSelfCheck } from './providers/statusProbe.js';
import { JobDispatcher } from './queue/dispatcher.js';
import { SqliteJobQueue } from './queue/SqliteJobQueue.js';
import { createEditRoutes } from './routes/edits.js';
import { createEditRenderRoutes } from './routes/editRenders.js';
import { createAssetRoutes } from './routes/assets.js';
import { createEnhanceRoutes } from './routes/enhance.js';
import { createGenerateRoutes } from './routes/generate.js';
import { healthRoutes } from './routes/health.js';
// V2.16（B53）：告警阈值走 shared 的**同一份**解析（env 变量名也定义在那边，一处改、两处生效）
import { readThresholdsFromEnv, resolveThresholds } from '@astrmira/shared';
import { createCostRoutes } from './routes/costs.js';
import { createObservabilityRoutes } from './routes/observability.js';
import { createWebhookRoutes } from './routes/webhooks.js';
import { createHistoryRoutes } from './routes/history.js';
// V2.16（B53）：readiness 的媒体工具自检（ffmpeg/ffprobe 缺失不降级，但如实陈述）
import { assertMediaToolsAvailable } from './lib/ffmpeg.js';
// V2.17（B52）：服务进程锁（备份 CLI 判断"能不能恢复"的权威判据）
import { acquireServerLock } from './ops/serverLock.js';
import { SERVICE_VERSION } from './version.js';
import { createKeyVerifyRoutes } from './routes/keysVerify.js';
import { createLogRoutes } from './routes/logs.js';
import { createProjectRoutes } from './routes/projects.js';
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
import {
  BURST_WINDOW_MS,
  BurstLimiter,
  CooldownStore,
  LOGS_BURST_MAX,
  VERIFY_BURST_MAX,
} from './security/rateLimit.js';
// V2.18（B23）：操作日志保留策略（定时 + 启动一次；真删了才留痕）
import {
  isRetentionDisabled,
  resolveRetentionPolicy,
  startLogRetention,
} from './server/logRetention.js';
import { registerRequestLog } from './server/requestLog.js';
import { registerSecurityHeaders } from './server/securityHeaders.js';
import { registerSpa } from './server/spa.js';
import { registerStaticOutputs, resolveOutputsDir } from './server/staticOutputs.js';
import { resolveOutputsMaxBytes, startStorageEvictor } from './server/storageEvict.js';
import { createAssetUrlResolver, createTaskVideoUrlResolver } from './store/assets.js';
import { openDatabase, resolveDatabasePath } from './store/db.js';
import { EventLogStore } from './store/eventLog.js';
import { ProjectStore } from './store/projects.js';
import { WebhookStore } from './store/webhooks.js';
import { WebhookDispatcher } from './webhook/dispatcher.js';
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
    /**
     * 请求 id：默认是自增整数，做排错标识太"飘"（用户截图里看到 `7` 无法定位）。
     * 这里用 8 位随机串，并回写在响应头 `x-request-id`（见 server/requestLog.ts）——
     * 「把界面上那串发我」就能在日志里一条命中。
     */
    genReqId: () => randomUUID().slice(0, 8),
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

  /**
   * 请求体不符合 zod schema 时，统一回 **400 + `ErrorResponse` 形状**（CONTRACT §5 / §6）。
   *
   * 为什么必须有：Fastify 默认的校验错误体是 `{ statusCode, error, message }` ——
   * 与契约的 ErrorResponse 不符，于是 **response schema 序列化会失败并把结果升级成 500**
   * （实测：一个本该 400 的剪辑请求返回了 500，前端拿不到可读原因）。
   * 这里只拦"校验类"错误；其余错误交回 Fastify 的默认处理（不吞真实故障）。
   */
  app.setErrorHandler((error, _request, reply) => {
    // 这个 Fastify 版本把 error 标成 unknown（它可能是任意抛出的东西）—— 显式窄化，不用 as any
    const shaped = error as { validation?: unknown; message?: string };
    if (shaped.validation !== undefined) {
      return reply
        .code(400)
        .send(createErrorResponse('INVALID_REQUEST', `请求不符合契约：${shaped.message ?? '校验失败'}`));
    }
    return reply.send(error as Error);
  });

  // 安全响应头 + 生产环境 CSP（PLAN §7-4；CSP 属 §9 台账 B15「公网刚需」）
  registerSecurityHeaders(app);

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

  // 已配置的兜底模型名必须在日志里看得见（含"这是模板占位符"的精确告警，见 registry.ts）
  const envModelWarning = getEnvModelWarning();
  if (envModelWarning !== null) app.log.warn(envModelWarning);

  // ── 公共链路（S2）：SQLite 存储 + 队列 + 双轨调度器 + 静态媒体（206 载体）─────────
  const db = openDatabase();
  // V2.17（B52）：服务进程锁 —— 备份 CLI 靠它判断"现在能不能恢复"。
  // 为什么不由数据库锁推断：**空闲的服务不持有写锁**，那条路子会在 Linux 上静默地把库换掉（见 serverLock.ts 的文件头）。
  const serverLock = acquireServerLock(path.dirname(resolveDatabasePath()), {
    version: SERVICE_VERSION,
  });
  if (serverLock.warn !== null) app.log.warn({ lock: serverLock.warn }, '服务锁提示');
  const store = new TaskStore(db);
  // V2.11（B47）：项目维度（默认项目由 openDatabase 的 bootstrapProjects 保证存在）
  const projects = new ProjectStore(db);
  // V2.15（B51）：Webhook 订阅与投递流水
  const webhooks = new WebhookStore(db);
  const eventLog = new EventLogStore(db);
  // V9 修复：任务终态（complete / fail / uncertain）也进操作日志 —— 否则异步任务的失败
  // 不产生新的 HTTP 请求，操作日志里无迹可查（剪辑失败但日志全是 200 的缺口）。
  const queue = new SqliteJobQueue(store, (event) => {
    eventLog.append({
      ts: Date.now(),
      method: 'TASK',
      path: `/api/tasks/${event.taskId}`,
      action: event.action,
      ...(event.action === 'task.complete' ? { statusCode: 200 } : {}),
      ...(event.action === 'task.fail' ? { statusCode: 500 } : {}),
      taskId: event.taskId,
      provider: event.provider,
      ...(event.errorCode === undefined ? {} : { errorCode: event.errorCode }),
      ...(event.disposition === undefined ? {} : { disposition: event.disposition }),
      detail: {
        ...(event.kind === undefined ? {} : { kind: event.kind }),
        ...(event.message === undefined ? {} : { message: event.message }),
      },
    });
  });
  // 防线 5：60s 防抖冷却（键的构成见 security/rateLimit.ts）
  const cooldown = new CooldownStore(db);
  // V2.8（B25）：两条独立限流桶（内存突发窗口；与生成冷却各自计桶、互不影响）
  const verifyLimiter = new BurstLimiter(BURST_WINDOW_MS, VERIFY_BURST_MAX);
  const logsLimiter = new BurstLimiter(BURST_WINDOW_MS, LOGS_BURST_MAX);

  // 操作日志钩子必须**在路由注册之前**挂：Fastify 的 `register()` 子上下文在注册那一刻
  // 继承父级已存在的钩子 —— 放后面挂，前面注册的路由就一条都记不到（实测踩点）。
  registerRequestLog(app, {
    store: eventLog,
    onError: (err) => app.log.warn({ err }, '写入操作日志失败（不影响请求）'),
  });

  // 路由目录惯例：backend/src/routes/<域>.ts（Step 2 的 6 条新路由沿用同一惯例）
  await app.register(healthRoutes);
  await app.register(providerRoutes);

  // B 方案（PLAN §6-D23）：BYOK 凭据的**进程内**暂存。不落库、终态即清、重启即空
  // （重启后仍在途的任务由下面的启动调解如实归档，绝不猜、绝不自动重提）。
  const keyVault = createKeyVault();

  // 参考资产 → 上游可访问地址；`PUBLIC_BASE_URL` 未配（本地/内网）时退回 data URL
  const publicBaseUrl = process.env.PUBLIC_BASE_URL?.trim();
  const resolveAssetUrl = createAssetUrlResolver({
    assetsDir: path.join(resolveOutputsDir(), 'assets'),
    ...(publicBaseUrl === undefined || publicBaseUrl === '' ? {} : { publicBaseUrl }),
  });
  // V2.6（B37）：`task:<taskId>` 引用 → 成片公网地址（无 data URL 退路，见 store/assets.ts）
  const resolveTaskVideoUrl = createTaskVideoUrlResolver({
    store,
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
    // V2.6（B37）：`task:` 引用 → 成片公网地址
    resolveTaskVideoUrl,
    // 防线 3：合成结束即清中间帧目录（成败都清）
    cleanup: (taskId) => cleanupTaskTemp(taskId),
    // V9 · B9：剪辑任务（本地 ffmpeg，**零上游调用**）——
    // 它自己 complete/fail，调度器只负责"按类别分派"
    runEditJob: createEditJobRunner({ store, queue, outputsDir: resolveOutputsDir() }),
    // 画廊封面（V1.9）：成功出片后抽首帧为 JPEG；失败只记日志，不改任务终态
    createThumbnail: (taskId, videoUrl) =>
      createTaskThumbnail({ outputsDir: resolveOutputsDir(), taskId, videoUrl }),
    // 防线 7：上游接受提交后立即写回，此后该任务不可 requeue
    markUpstreamAccepted: async (taskId, upstreamTaskId) => {
      queue.setUpstreamTaskId(taskId, upstreamTaskId);
    },
    // 取消：调度器每轮回读一次状态（否则 heartbeat 会把 cancelled 覆盖回 running，见 V8.3 批次 3）
    isCancellationRequested: (taskId) => store.get(taskId)?.status === 'cancelled',
    onError: (err) => app.log.warn({ err }, '任务执行异常'),
  });
  dispatcher.start();

  // V2.8（B22）：容量淘汰 —— 后台扫描（默认 5 分钟 + 启动一次），超阈值时从最旧的已成功任务
  // 开始删成片与缩略图（保留任务记录；三类保护见 server/storageEvict.ts 的头注释）。
  // 真正删了文件才写操作日志（噪声纪律）。
  const storageEvictor = startStorageEvictor({
    outputsDir: resolveOutputsDir(),
    store,
    onEvict: (outcome) => {
      eventLog.append({
        ts: Date.now(),
        method: 'STORAGE',
        path: '/api/storage/evict',
        action: 'storage.evict',
        statusCode: 200,
        detail: {
          freedBytes: outcome.freedBytes,
          beforeBytes: outcome.beforeBytes,
          afterBytes: outcome.afterBytes,
          evictedCount: outcome.evictedTaskIds.length,
          // 只留前 10 个 id：日志是排错用的，不是全量清单（明细可由 tasks 表反查）
          evictedTaskIds: outcome.evictedTaskIds.slice(0, 10),
          skippedReferenced: outcome.skippedReferenced,
        },
      });
    },
    onError: (err) => app.log.warn({ err }, '容量淘汰扫描异常（不影响服务）'),
  });

  // V2.18（B23）：操作日志保留策略（默认 90 天 / 20 万行；两条判据各自可用 0 关闭）。
  // 真删了才写 `log.prune`（噪声纪律，与 `storage.evict` 同一条）；两条都关时**启动即警告** ——
  // 那种配置下先被吃掉的会是日志，而运维往往直到冒烟才发现。
  const logRetention = startLogRetention({
    store: eventLog,
    policy: resolveRetentionPolicy(),
    onPrune: (outcome) => {
      eventLog.append({
        ts: Date.now(),
        method: 'LOG',
        path: '/api/logs/prune',
        action: 'log.prune',
        statusCode: 200,
        detail: {
          deleted: outcome.deleted,
          deletedByAge: outcome.deletedByAge,
          deletedByCount: outcome.deletedByCount,
          remaining: outcome.remaining,
          policy: { maxAgeDays: outcome.maxAgeDays, maxRows: outcome.maxRows },
        },
      });
    },
    onError: (err) => app.log.warn({ err }, '日志保留策略执行异常（不影响服务）'),
  });
  if (isRetentionDisabled(logRetention.policy())) {
    app.log.warn(
      { policy: logRetention.policy() },
      '日志保留策略已关闭（LOG_RETENTION_DAYS=0 且 LOG_MAX_ROWS=0）：操作日志将无限增长，数据库会持续变大',
    );
  }

  // V2.15（B51）：Webhook 终态回调 —— 扫描补投 + 投递循环（默认 2s 一轮）。
  // 为什么是扫描而不是"终态时立刻推"：见 store/webhooks.ts 的文件头（一处覆盖全部终态写入点 + 重启补投）。
  const webhookDispatcher = new WebhookDispatcher({
    webhooks,
    tasks: store,
    ...(process.env['PUBLIC_BASE_URL'] === undefined
      ? {}
      : { publicBaseUrl: process.env['PUBLIC_BASE_URL'] }),
    onError: (err) => app.log.warn({ err }, 'Webhook 投递循环异常（不影响服务）'),
  });
  webhookDispatcher.start();

  app.addHook('onClose', async () => {
    // 先排空后台任务（淘汰器 + 调度器 + Webhook 投递 + 日志保留：停表 + 等在飞的一轮）**再关库**：
    // 关早了，在飞的扫描会在关闭后的连接上读写 → unhandled rejection（2026-09-24 CI 实测）
    logRetention.stop();
    webhookDispatcher.stop();
    await storageEvictor.drain();
    await logRetention.drain();
    await dispatcher.drain();
    await webhookDispatcher.drain();
    db.close();
    // V2.17（B52）：释放服务进程锁（备份 CLI 靠它判断"能不能恢复"）
    serverLock.release();
  });

  await app.register(
    createGenerateRoutes({
      store,
      queue,
      resolveProvider: getProvider,
      cooldown,
      keyVault,
      projects,
    }),
  );
  // V2.11（B47）：项目维度（列表 / 新建 / 改名 / 删除空项目）
  await app.register(createProjectRoutes({ projects }));
  await app.register(createUploadRoutes({ projects }));
  // V2.7（B41）：资产库清单（只读；`@` 提及素材弹层用）
  await app.register(createAssetRoutes());
  await app.register(createEnhanceRoutes());
  // V9 · B9：基础剪辑 EDL（本地 ffmpeg；与生成任务共用队列与轮询）—— B34 后 UI 不再暴露，API 保留
  await app.register(createEditRoutes({ store, queue }));
  // V2.5（B34 · P4）：浏览器端渲染产物入库（同步归档，服务端不渲染）
  await app.register(createEditRenderRoutes({ store }));
  // V2.8（B25）：校验与日志各带独立限流桶（见 security/rateLimit.ts 的桶常量）
  await app.register(createKeyVerifyRoutes({ limiter: verifyLimiter }));
  await app.register(createTaskRoutes({ store }));
  await app.register(createHistoryRoutes({ store }));
  // V2.12（B48）：成本台账汇总（只读；金额为预估，口径见 COST_DISCLAIMER）
  await app.register(createCostRoutes({ store, projects }));
  // V2.15（B51 片 A）：Webhook 订阅管理（终态回调；secret 只回显一次，URL 过 SSRF 准入）
  await app.register(createWebhookRoutes({ webhooks, projects }));
  // V2.16（B53）：可观测 —— live/ready 分级 + 运维快照（告警阈值可 env 覆盖）
  await app.register(
    createObservabilityRoutes({
      tasks: store,
      webhooks,
      outputsDir: resolveOutputsDir(),
      // 与淘汰器**共用同一个上限解析**（否则会出现"面板说没超、淘汰器已经在删"）
      maxBytes: resolveOutputsMaxBytes(),
      thresholds: resolveThresholds(readThresholdsFromEnv(process.env)),
      checkMediaTools: async () => {
        try {
          await assertMediaToolsAvailable();
          return { ok: true, detail: 'ffmpeg / ffprobe 可用（本地轨、缩略图、抽帧依赖它）' };
        } catch (error) {
          return {
            ok: false,
            detail: `ffmpeg / ffprobe 不可用：${error instanceof Error ? error.message : String(error)}（云端轨不受影响；本地轨与缩略图会失败）`,
          };
        }
      },
    }),
  );
  await app.register(createLogRoutes({ store: eventLog, limiter: logsLimiter }));
  await registerStaticOutputs(app);

  // 单进程形态（PLAN §7-9）：进程同时托管 /api、/media 与前端产物。
  // 刻意放在**所有路由之后**——`setNotFoundHandler` 是全局的，顺序反了会把 API 的 404 变成 index.html。
  await registerSpa(app);

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
