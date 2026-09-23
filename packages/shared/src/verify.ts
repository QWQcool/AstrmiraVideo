import { z } from 'zod';

/**
 * 契约投影来源：docs/CONTRACT.md §9 凭据与模型校验接口 `POST /api/providers/keys/verify`（V2.1）。
 *
 * ## 它解决什么
 * 2026-09-23 线上故障：模型名不对 → 用户花了一次**真金白银的提交**才拿到报错。
 * 本接口把"Key 行不行 / 模型在不在 / 有没有开通"提前到**提交之前**回答，且**零费用**。
 *
 * ## 为什么"零费用"是硬约束
 * 视频生成按输出 token 计费，任何"发一个最小生成请求试试"的方案都是在烧钱：
 * - 视频轨：`POST .../tasks` 带**空 content** → 上游参数校验先失败（400 = 模型存在且已开通），
 *   不存在/未开通则 404。两者都不会创建任务。**安全网**：万一真返回了任务 id，
 *   服务端立刻 DELETE 取消，并把这件事如实写进 message；
 * - 文本轨：`POST /chat/completions` 带 `max_tokens: 1` → 200 = 可用（费用近乎 0）。
 */

export const KeyVerifyTrackSchema = z.enum(['video', 'text']);

export const KeyVerifyRequestSchema = z.object({
  track: KeyVerifyTrackSchema,
  /** 待校验的模型 id / 接入点 id（缺省时只校验 Key 本身） */
  model: z.string().optional(),
  /** 覆盖端点（自建代理 / 兼容端点）；缺省用服务端配置或预设 */
  baseUrl: z.string().optional(),
  /** 文本轨的预设 id（与扩写请求同一套 `LLM_PRESETS`） */
  preset: z.string().optional(),
});

export const KeyVerifyResponseSchema = z.object({
  /** 凭据本身是否被上游接受 */
  keyValid: z.boolean(),
  /** 上游 `/models` 返回的模型总数（该端点为 OpenAI 兼容接口；不可得时为 null） */
  totalModels: z.number().int().nullable(),
  /** 待校验的模型是否出现在上游清单里（未提供 model 或清单不可得时为 null） */
  modelListed: z.boolean().nullable(),
  /**
   * 模型**是否可用**（存在 ≠ 已开通）：true=可用 / false=不存在或未开通 / null=未探测。
   * 这一项才是"能不能出片"的答案。
   */
  modelAvailable: z.boolean().nullable(),
  /** 给人看的一句话结论（成功与失败都必须能直接照做） */
  message: z.string(),
});

export type KeyVerifyTrack = z.infer<typeof KeyVerifyTrackSchema>;
export type KeyVerifyRequest = z.infer<typeof KeyVerifyRequestSchema>;
export type KeyVerifyResponse = z.infer<typeof KeyVerifyResponseSchema>;
