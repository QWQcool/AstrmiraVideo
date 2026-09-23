import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { LogDeleteResponseSchema, LogListResponseSchema, LogQuerySchema } from '@astrmira/shared';
import type { EventLogFilter, EventLogStore } from '../store/eventLog.js';

/**
 * 操作日志接口（CONTRACT §10，V2.1）：**增 / 删 / 查**（用户 2026-09-23 明确要求的三件事）。
 *
 * - "增"没有路由：由 `server/requestLog.ts` 的钩子自动写入（用户不可能手写一条日志）；
 * - "查"= `GET /api/logs`（筛选：时间 / IP / 动作 / 错误码 / 关键词 + 分页）；
 * - "删"= 单条 `DELETE /api/logs/:id` 与按筛选清空 `DELETE /api/logs`。
 *
 * ## 权限
 * 用户拍板"**全都可看，不加额外权限**"：仍复用既有的两层保护
 * （公网由 Caddy 登录 + 服务端 `PUBLIC_API_TOKEN`，见 PLAN §7-4），本路由不再加码。
 *
 * ## 删除是幂等的
 * 删不存在的条目返回 `200 { ok: false, deleted: 0 }` —— 不引入新错误码
 * （契约 §6 的码是闭集，为一个"已经没了"的场景加码不划算）。
 */
export interface LogRoutesDeps {
  store: EventLogStore;
}

/** 路径参数：`z.coerce` 让 `"12"` 也能通过（HTTP 路径参数天然是字符串） */
const LogIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });

function toFilter(query: z.infer<typeof LogQuerySchema>): EventLogFilter {
  return {
    ...(query.limit === undefined ? {} : { limit: query.limit }),
    ...(query.offset === undefined ? {} : { offset: query.offset }),
    ...(query.ip === undefined || query.ip === '' ? {} : { ip: query.ip }),
    ...(query.action === undefined || query.action === '' ? {} : { action: query.action }),
    ...(query.errorCode === undefined || query.errorCode === '' ? {} : { errorCode: query.errorCode }),
    ...(query.q === undefined || query.q === '' ? {} : { q: query.q }),
    ...(query.since === undefined ? {} : { since: query.since }),
    ...(query.until === undefined ? {} : { until: query.until }),
  };
}

export const createLogRoutes =
  (deps: LogRoutesDeps): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/api/logs',
      {
        schema: {
          querystring: LogQuerySchema,
          response: { 200: LogListResponseSchema },
        },
      },
      async (request) => deps.store.list(toFilter(request.query)),
    );

    app.delete(
      '/api/logs/:id',
      {
        schema: {
          params: LogIdParamsSchema,
          response: { 200: LogDeleteResponseSchema },
        },
      },
      async (request) => {
        const deleted = deps.store.remove(request.params.id);
        return { ok: deleted > 0, deleted };
      },
    );

    app.delete(
      '/api/logs',
      {
        schema: {
          querystring: LogQuerySchema,
          response: { 200: LogDeleteResponseSchema },
        },
      },
      // 带筛选时"清空"清的就是**当前筛选看到的那批**（与界面按钮语义一致）；
      // 不带筛选即全清 —— 这是用户明确要的"可手动删除"。
      async (request) => ({ ok: true, deleted: deps.store.clear(toFilter(request.query)) }),
    );
  };
