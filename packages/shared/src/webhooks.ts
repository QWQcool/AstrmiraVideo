import { z } from 'zod';

/**
 * Webhook 终态回调（V2.15 / 台账 B51 片 A，契约 §15）。
 *
 * ## 它解决什么
 * 客户系统目前只能**轮询** `/api/tasks/:id`（或整表拉历史）。集成方真正要的是
 * "任务到终态时推我一下" —— 这就是本模块。**它是"客户系统集成"里成本最低、收益最直接的一件**，
 * 所以排在项目级 API Key / 批量提交前面。
 *
 * ## 三条口径
 * 1. **只做 `task.terminal` 一个事件**：不预留一堆"将来可能会有"的事件名（那样只会让订阅语义变模糊）。
 *    真需要新事件时，扩 `WebhookEventSchema` 一处即可。
 * 2. **签名是唯一的信任来源**：`X-Astrmira-Signature: sha256=<hex>`（HMAC-SHA256，对**原始请求体**），
 *    客户侧必须验签 —— 回调 URL 可能被人猜到，但 secret 不会。
 * 3. **secret 只回显一次**：创建时给明文，之后任何接口只给掩码（`whsec_ab…cd`）。
 *    这是"不留存可回显的凭据"这条纪律在自有服务端的投影（与 BYOK 的差别见 §15：这个 secret 必须由
 *    **服务端持有**才能签名，所以它落库；但它**不可回读**）。
 */

export const WEBHOOK_EVENT_TASK_TERMINAL = 'task.terminal';

export const WebhookEventSchema = z.enum([WEBHOOK_EVENT_TASK_TERMINAL]);
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

/** 客户侧要验的三个头（常量集中在这里，避免两端各写一份字符串） */
export const WEBHOOK_SIGNATURE_HEADER = 'x-astrmira-signature';
export const WEBHOOK_EVENT_HEADER = 'x-astrmira-event';
export const WEBHOOK_DELIVERY_HEADER = 'x-astrmira-delivery';

export const WEBHOOK_URL_MAX_CHARS = 500;
export const WEBHOOK_SECRET_PREFIX = 'whsec_';
export const WEBHOOK_SECRET_MIN_CHARS = 16;
/** 投递上限（含首次）：3 次 = 首次 + 两次重试 */
export const WEBHOOK_DELIVERY_MAX_ATTEMPTS = 3;
/** 第 n 次失败后的退避（毫秒）：5s、25s。再往后不再试（客户系统长时间不可用时应自己拉历史补） */
export const WEBHOOK_RETRY_BACKOFF_MS = [5_000, 25_000] as const;
/** 单次投递超时：客户系统慢不该拖住我们的扫描循环 */
export const WEBHOOK_TIMEOUT_MS = 10_000;
/** 扫描间隔（服务端内部；决定"到终态 → 收到回调"的上限延迟） */
export const WEBHOOK_SWEEP_INTERVAL_MS = 2_000;
/** 兜底扫描的回看窗口：只补最近 7 天终态、且无投递记录的任务（不做"全历史补投"） */
export const WEBHOOK_SWEEP_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
export const WEBHOOK_SWEEP_BATCH = 50;

export const WEBHOOK_DELIVERY_STATUSES = ['pending', 'delivered', 'failed'] as const;
export const WebhookDeliveryStatusSchema = z.enum(WEBHOOK_DELIVERY_STATUSES);
export type WebhookDeliveryStatus = z.infer<typeof WebhookDeliveryStatusSchema>;

export const CreateWebhookRequestSchema = z.object({
  /** 省略 = 默认项目（与全站口径一致） */
  projectId: z.string().optional(),
  url: z.string().min(1).max(WEBHOOK_URL_MAX_CHARS),
  /** 省略由服务端生成（推荐）：手填一个弱 secret 是这条链路上最容易出的安全问题 */
  secret: z.string().min(WEBHOOK_SECRET_MIN_CHARS).max(200).optional(),
  events: z.array(WebhookEventSchema).min(1).optional(),
});
export type CreateWebhookRequest = z.infer<typeof CreateWebhookRequestSchema>;

export const UpdateWebhookRequestSchema = z
  .object({
    url: z.string().min(1).max(WEBHOOK_URL_MAX_CHARS).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => value.url !== undefined || value.enabled !== undefined, {
    message: '至少要改一项（url / enabled）',
  });
export type UpdateWebhookRequest = z.infer<typeof UpdateWebhookRequestSchema>;

/** 对外形状（**永远不含明文 secret** —— 明文只在创建响应里出现一次） */
export const WebhookViewSchema = z.object({
  webhookId: z.string(),
  projectId: z.string(),
  url: z.string(),
  enabled: z.boolean(),
  events: z.array(WebhookEventSchema),
  /** 供人辨认的掩码（不是用来验签的） */
  secretMasked: z.string(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type WebhookView = z.infer<typeof WebhookViewSchema>;

export const WebhookCreatedResponseSchema = z.object({
  webhook: WebhookViewSchema,
  /** 明文 secret —— **只在这一次响应里出现**，客户必须自己存好 */
  secret: z.string(),
});
export type WebhookCreatedResponse = z.infer<typeof WebhookCreatedResponseSchema>;

export const WebhookResponseSchema = z.object({ webhook: WebhookViewSchema });
export type WebhookResponse = z.infer<typeof WebhookResponseSchema>;

export const WebhookListResponseSchema = z.object({ webhooks: z.array(WebhookViewSchema) });
export type WebhookListResponse = z.infer<typeof WebhookListResponseSchema>;

export const WebhookDeliveryViewSchema = z.object({
  deliveryId: z.string(),
  webhookId: z.string(),
  taskId: z.string(),
  event: WebhookEventSchema,
  status: WebhookDeliveryStatusSchema,
  attempts: z.number().int(),
  lastStatusCode: z.number().int().nullable(),
  lastError: z.string().nullable(),
  nextAttemptAt: z.number().int().nullable(),
  deliveredAt: z.number().int().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type WebhookDeliveryView = z.infer<typeof WebhookDeliveryViewSchema>;

export const WebhookDeliveryListResponseSchema = z.object({
  deliveries: z.array(WebhookDeliveryViewSchema),
});
export type WebhookDeliveryListResponse = z.infer<typeof WebhookDeliveryListResponseSchema>;

/** 推给客户系统的载荷（`task.terminal`）—— 字段与 `TaskProgress` 同名同义，便于直接对账 */
export interface TaskTerminalPayload {
  event: WebhookEvent;
  deliveryId: string;
  taskId: string;
  projectId: string;
  status: string;
  disposition?: string;
  errorCode?: string;
  message?: string;
  /** 绝对 URL（`PUBLIC_BASE_URL` + `/media/...`）；未配 `PUBLIC_BASE_URL` 时为相对路径 */
  outputVideoUrl?: string;
  thumbnailUrl?: string;
  progressPercent: number;
  /** 预估成本（§13）；未结算 = 不出现（**不是 0**） */
  costYuan?: number;
  /** 任务创建时间 */
  createdAt: number;
  /** 事件生成时间（回调延迟 = 它减终态时刻） */
  terminatedAt: number;
}

/** secret 掩码：保留前缀与末 4 位（够人辨认，不够拿去验签） */
export function maskWebhookSecret(secret: string): string {
  if (secret.length <= 12) return `${WEBHOOK_SECRET_PREFIX}…`;
  return `${secret.slice(0, 8)}…${secret.slice(-4)}`;
}
