import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ErrorResponseSchema,
  HealthLiveResponseSchema,
  HealthReadyResponseSchema,
  MetricsResponseSchema,
  summarizeReadiness,
} from '@astrmira/shared';
import {
  collectMetrics,
  collectReadinessChecks,
  type ObservabilityDeps,
} from '../observability/collect.js';

/**
 * 可观测（V2.16 / 台账 B53，契约 §16）。
 *
 * ## 三个端点，三种用途（**不要混用**）
 * | 端点 | 用途 | 鉴权 | 依赖 |
 * |---|---|---|---|
 * | `GET /api/health` | **存活**（V1.7 起就有，语义不变） | 任何来源免鉴权 | **零依赖**（不碰数据库） |
 * | `GET /api/health/live` | 存活（与上面**同语义**，新路径为了与 ready 成对） | 任何来源免鉴权 | 零依赖 |
 * | `GET /api/health/ready` | **能干活**（DB 可读 + 目录可写） | 需鉴权（回环免） | DB + 文件系统 |
 * | `GET /api/metrics` | 运维快照（队列/存储/Webhook/告警） | 需鉴权（回环免） | 全部（含扫目录） |
 *
 * **为什么 live 与 ready 必须分开**：探针若在依赖故障时也变慢或失败，编排器会把
 * "数据库卡住"当成"进程死了"并重启 —— 那会把一次依赖故障放大成服务不可用。
 *
 * **为什么 ready 要真写一次文件**：`stat` 成功不代表 `write` 成功（只读挂载 / 磁盘满 / 权限位）。
 * 与"上游链路要真发一次请求"同一条纪律 —— 证据必须是动作，不是推断。
 */

export interface ObservabilityRoutesDeps extends ObservabilityDeps {
  /** 媒体工具自检（生产传 ffmpeg/ffprobe 探测；缺省不检查该项） */
  checkMediaTools?: () => Promise<{ ok: boolean; detail: string }>;
}

const SERVICE_NAME = 'AstrmiraVideo Backend';
const SERVICE_VERSION = '0.1.0';

export const createObservabilityRoutes =
  (deps: ObservabilityRoutesDeps): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/api/health/live',
      { schema: { response: { 200: HealthLiveResponseSchema } } },
      async () => ({
        status: 'ok' as const,
        name: SERVICE_NAME,
        version: SERVICE_VERSION,
        timestamp: new Date().toISOString(),
        // 进程存活时间：重启排查的第一手事实（"刚重启过"往往解释了大部分异常）
        uptimeSec: Math.round(process.uptime()),
      }),
    );

    app.get(
      '/api/health/ready',
      {
        schema: {
          response: { 200: HealthReadyResponseSchema, 503: HealthReadyResponseSchema },
        },
      },
      async (_request, reply) => {
        const checks = await collectReadinessChecks(deps);
        const status = summarizeReadiness(checks);
        const payload = {
          status,
          timestamp: new Date().toISOString(),
          version: SERVICE_VERSION,
          checks,
        };
        // degraded → 503：编排器据此停止导流；**响应体照样是完整的 checks**（排错要看原因，不是只看状态码）
        return status === 'ready' ? payload : reply.code(503).send(payload);
      },
    );

    app.get(
      '/api/metrics',
      { schema: { response: { 200: MetricsResponseSchema, 500: ErrorResponseSchema } } },
      async () => collectMetrics(deps),
    );
  };
