import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  CreateWebhookRequestSchema,
  ErrorResponseSchema,
  UpdateWebhookRequestSchema,
  WEBHOOK_EVENT_TASK_TERMINAL,
  WebhookCreatedResponseSchema,
  WebhookDeliveryListResponseSchema,
  WebhookListResponseSchema,
  WebhookResponseSchema,
  maskWebhookSecret,
  normalizeProjectId,
  type WebhookView,
} from '@astrmira/shared';
import { createErrorResponse } from '../errors.js';
import { generateWebhookSecret } from '../webhook/signature.js';
import { checkWebhookUrl } from '../webhook/urlGuard.js';
import type { ProjectStore } from '../store/projects.js';
import type { WebhookStore } from '../store/webhooks.js';

/**
 * Webhook 订阅管理（V2.15 / 台账 B51 片 A，契约 §15）。
 *
 * ## 五条口径
 * 1. **secret 只回显一次**：创建响应里有明文，之后一切接口只给掩码 —— 客户系统必须自己存好；
 * 2. **URL 要过 SSRF 准入**（`checkWebhookUrl`）：默认拒绝环回 / 私网 / 链路本地；
 *    私有部署要回调内网时，由部署者显式设 `WEBHOOK_ALLOW_PRIVATE=1`；
 * 3. **项目维度与全站一致**：`?project=` 省略 = **默认项目**，显式给不存在的项目 → 404 `PROJECT_NOT_FOUND`；
 * 4. **订阅不存在 → 404 `WEBHOOK_NOT_FOUND`**（不静默 200 —— 客户系统据此知道配置被删了）；
 * 5. **交付流水随订阅同生共死**：删订阅连带删流水（见 store 层注释）。
 */

const WebhookIdParamsSchema = z.object({ webhookId: z.string().min(1).max(64) });

export interface WebhookRoutesDeps {
  webhooks: WebhookStore;
  projects: ProjectStore;
  /** 测试注入：是否允许私网目标（生产读 `WEBHOOK_ALLOW_PRIVATE`） */
  allowPrivate?: boolean;
  /** 测试注入：secret 生成（默认随机） */
  generateSecret?: () => string;
}

/** `WEBHOOK_ALLOW_PRIVATE=1` 才允许私网目标（默认关：SSRF 防护优先） */
export function allowPrivateFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['WEBHOOK_ALLOW_PRIVATE'] === '1';
}

export const createWebhookRoutes =
  (deps: WebhookRoutesDeps): FastifyPluginAsyncZod =>
  async (app) => {
    const allowPrivate = deps.allowPrivate ?? allowPrivateFromEnv();
    const makeSecret = deps.generateSecret ?? generateWebhookSecret;

    const toView = (record: {
      webhookId: string;
      projectId: string;
      url: string;
      enabled: boolean;
      events: WebhookView['events'];
      secret: string;
      createdAt: number;
      updatedAt: number;
    }): WebhookView => ({
      webhookId: record.webhookId,
      projectId: record.projectId,
      url: record.url,
      enabled: record.enabled,
      events: record.events,
      // 明文永不出现（除了创建响应里那一次）
      secretMasked: maskWebhookSecret(record.secret),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });

    app.get(
      '/api/webhooks',
      {
        schema: {
          querystring: z.object({ project: z.string().optional() }),
          response: { 200: WebhookListResponseSchema, 404: ErrorResponseSchema },
        },
      },
      async (request, reply) => {
        const projectId = normalizeProjectId(request.query.project);
        if (deps.projects.get(projectId) === null) {
          return reply
            .code(404)
            .send(createErrorResponse('PROJECT_NOT_FOUND', `项目 ${projectId} 不存在`));
        }
        return { webhooks: deps.webhooks.listByProject(projectId).map(toView) };
      },
    );

    app.post(
      '/api/webhooks',
      {
        schema: {
          body: CreateWebhookRequestSchema,
          response: {
            201: WebhookCreatedResponseSchema,
            400: ErrorResponseSchema,
            404: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const projectId = normalizeProjectId(request.body.projectId);
        if (deps.projects.get(projectId) === null) {
          return reply
            .code(404)
            .send(createErrorResponse('PROJECT_NOT_FOUND', `项目 ${projectId} 不存在`));
        }

        const checked = checkWebhookUrl(request.body.url, { allowPrivate });
        if (!checked.ok) {
          return reply.code(400).send(createErrorResponse('INVALID_REQUEST', checked.reason));
        }

        const secret = request.body.secret ?? makeSecret();
        const record = deps.webhooks.create({
          projectId,
          url: checked.url,
          secret,
          events: request.body.events ?? [WEBHOOK_EVENT_TASK_TERMINAL],
        });
        // 明文 secret 只在这里出现一次（客户必须自己存好；之后只有掩码）
        return reply.code(201).send({ webhook: toView(record), secret: record.secret });
      },
    );

    app.patch(
      '/api/webhooks/:webhookId',
      {
        schema: {
          params: WebhookIdParamsSchema,
          body: UpdateWebhookRequestSchema,
          response: { 200: WebhookResponseSchema, 400: ErrorResponseSchema, 404: ErrorResponseSchema },
        },
      },
      async (request, reply) => {
        const existing = deps.webhooks.get(request.params.webhookId);
        if (existing === null) {
          return reply
            .code(404)
            .send(createErrorResponse('WEBHOOK_NOT_FOUND', 'Webhook 订阅不存在或已被删除'));
        }
        const patch: { url?: string; enabled?: boolean } = {};
        if (request.body.url !== undefined) {
          const checked = checkWebhookUrl(request.body.url, { allowPrivate });
          if (!checked.ok) {
            return reply.code(400).send(createErrorResponse('INVALID_REQUEST', checked.reason));
          }
          patch.url = checked.url;
        }
        if (request.body.enabled !== undefined) patch.enabled = request.body.enabled;
        deps.webhooks.update(existing.webhookId, patch);

        const updated = deps.webhooks.get(existing.webhookId);
        if (updated === null) {
          return reply.code(404).send(createErrorResponse('WEBHOOK_NOT_FOUND', '订阅在此期间被删除'));
        }
        return { webhook: toView(updated) };
      },
    );

    app.delete(
      '/api/webhooks/:webhookId',
      {
        schema: {
          params: WebhookIdParamsSchema,
          response: {
            200: z.object({ deleted: z.literal(true) }),
            404: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const removed = deps.webhooks.remove(request.params.webhookId);
        if (!removed) {
          return reply
            .code(404)
            .send(createErrorResponse('WEBHOOK_NOT_FOUND', 'Webhook 订阅不存在或已被删除'));
        }
        return { deleted: true as const };
      },
    );

    app.get(
      '/api/webhooks/:webhookId/deliveries',
      {
        schema: {
          params: WebhookIdParamsSchema,
          querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }),
          response: { 200: WebhookDeliveryListResponseSchema, 404: ErrorResponseSchema },
        },
      },
      async (request, reply) => {
        if (deps.webhooks.get(request.params.webhookId) === null) {
          return reply
            .code(404)
            .send(createErrorResponse('WEBHOOK_NOT_FOUND', 'Webhook 订阅不存在或已被删除'));
        }
        const rows = deps.webhooks.listDeliveries(request.params.webhookId, request.query.limit ?? 50);
        return {
          deliveries: rows.map((row) => ({
            deliveryId: row.deliveryId,
            webhookId: row.webhookId,
            taskId: row.taskId,
            event: row.event,
            status: row.status,
            attempts: row.attempts,
            lastStatusCode: row.lastStatusCode,
            lastError: row.lastError,
            nextAttemptAt: row.nextAttemptAt,
            deliveredAt: row.deliveredAt,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          })),
        };
      },
    );

  };
