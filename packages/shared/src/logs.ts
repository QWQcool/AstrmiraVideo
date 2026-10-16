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
  // V2.8（台账 B22）：容量淘汰真正删了文件才写 —— 文件是**被系统删掉的**，
  // 用户"片子怎么没了"时日志里必须有据可查
  'storage.evict',
  'auth.failed',
  'request.error',
] as const;

export type LogAction = (typeof LOG_ACTIONS)[number];

/**
 * 动作 id → 显示名：**已搬去前端字典**（语言迁移第十六批 · 跨包决策）。
 *
 * 关键事实（这也是当初这些表能安心搬走的理由）：**后端只存 id、从不存中文**
 * （"避免中文进库后改文案要迁数据"）—— 所以搬走不碰任何历史数据。
 * 现在：文案在前端 `dict/edit.ts`（`edit.logAction.*`）；取用函数在前端 `lib/format.ts`
 * （`logActionLabel`，按当前语言取）。
 *
 * ⚠️ 它保留了**原来那个好设计的语义**：**未知动作原样返回 id**（宁可显示 id，
 * 也不要显示空白或"未知"—— 空白最容易被当成"没这回事"，而 id 至少能搜）。
 */

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
  /**
   * V2.19 新增（台账 B62）：**按任务 id 取一条任务的全部留痕**。
   *
   * 为什么加：画布的节点检查器要回答"这条片子当时发生了什么" —— 任务终态
   * （`task.complete` / `task.fail` / `task.uncertain`）、提交、取消、渲染入库都带 `task_id`，
   * 用关键词搜提示词只能碰运气。有了它，"点节点 → 看到这条任务的全部事件"是一条直路。
   */
  taskId: z.string().optional(),
});

export type EventLogEntry = z.infer<typeof EventLogEntrySchema>;
export type LogListResponse = z.infer<typeof LogListResponseSchema>;
export type LogDeleteResponse = z.infer<typeof LogDeleteResponseSchema>;
export type LogQuery = z.infer<typeof LogQuerySchema>;
