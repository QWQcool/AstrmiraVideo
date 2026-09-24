import { z } from 'zod';

/**
 * 契约投影来源：docs/CONTRACT.md §10 操作日志（V2.1）。
 *
 * 定位（用户 2026-09-23 拍板）：**开发者排错用**，全员可见、明文 IP、全量保留、可手动删。
 * 它回答的是"谁在什么时候做了什么、结果如何"，而不是"服务器发生了什么"（那是 pino / `docker logs`）。
 */

/**
 * 语义动作清单（前后端共用一份，界面下拉直接用它）。
 * 命名规则 `<域>.<动词>`；请求级推导规则见 `backend/src/server/requestLog.ts`。
 */
export const LOG_ACTIONS = [
  'generate.submit',
  'edit.submit',
  'edit.render',
  'task.cancel',
  'task.complete',
  'task.fail',
  'task.uncertain',
  'history.delete',
  'upload',
  'enhance',
  'keys.verify',
  'logs.delete',
  'logs.clear',
  'auth.failed',
  'request.error',
] as const;

export type LogAction = (typeof LOG_ACTIONS)[number];

/** 中文标签（界面展示；后端只存 id，避免中文进库后改文案要迁数据） */
export const LOG_ACTION_LABELS: Record<string, string> = {
  'generate.submit': '提交生成',
  'edit.submit': '提交剪辑',
  'edit.render': '渲染入库',
  'task.cancel': '取消任务',
  'task.complete': '任务完成',
  'task.fail': '任务失败',
  'task.uncertain': '结果待核对',
  'history.delete': '删除历史',
  upload: '上传素材',
  enhance: '提示词扩写',
  'keys.verify': '测试连接',
  'logs.delete': '删除日志',
  'logs.clear': '清空日志',
  'auth.failed': '鉴权失败',
  'request.error': '请求失败',
};

export function logActionLabel(action: string | undefined): string {
  if (action === undefined) return '—';
  return LOG_ACTION_LABELS[action] ?? action;
}

export const EventLogEntrySchema = z.object({
  id: z.number().int(),
  /** 毫秒时间戳（前端按本机时区渲染） */
  ts: z.number().int(),
  /** 服务端请求 id（同时回写在响应头 `x-request-id`，报错截图可直接搜） */
  requestId: z.string().optional(),
  ip: z.string().optional(),
  method: z.string(),
  path: z.string(),
  action: z.string().optional(),
  statusCode: z.number().int().optional(),
  durationMs: z.number().int().optional(),
  taskId: z.string().optional(),
  provider: z.string().optional(),
  errorCode: z.string().optional(),
  disposition: z.string().optional(),
  userAgent: z.string().optional(),
  /** 截断后的请求体（JSON 原文或 multipart 摘要；**凭据永不出现**） */
  body: z.string().optional(),
  /** 白名单诊断字段：上游 request id、本次模型、资产 id 等 */
  detail: z.record(z.string(), z.unknown()).optional(),
});

export const LogListResponseSchema = z.object({
  items: z.array(EventLogEntrySchema),
  /** 满足筛选条件的总条数（分页用） */
  total: z.number().int(),
});

export const LogDeleteResponseSchema = z.object({
  ok: z.boolean(),
  /** 实际删除条数（删除不存在的条目不算错误：DELETE 幂等） */
  deleted: z.number().int(),
});

/** 列表查询参数（前端筛选器一一对应） */
export const LogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  ip: z.string().optional(),
  action: z.string().optional(),
  errorCode: z.string().optional(),
  q: z.string().optional(),
  since: z.coerce.number().int().optional(),
  until: z.coerce.number().int().optional(),
});

export type EventLogEntry = z.infer<typeof EventLogEntrySchema>;
export type LogListResponse = z.infer<typeof LogListResponseSchema>;
export type LogDeleteResponse = z.infer<typeof LogDeleteResponseSchema>;
export type LogQuery = z.infer<typeof LogQuerySchema>;
