import { z } from 'zod';
import { ErrorCodeSchema, ErrorDispositionSchema, TaskProgressSchema } from './progress.js';

/**
 * 契约投影来源：docs/CONTRACT.md §5 路由表的响应形状（V1.8 补登）。
 *
 * 背景：V1.8 之前路由表只写"返回统一 `taskId`"等语义描述，未定义响应形状，
 * `packages/shared` 无法为这些路由挂 response schema（与 V1.7 补 `/api/health` 同型）。
 */

/** `POST /api/generate` 的 200 响应 */
export const GenerateResponseSchema = z.object({
  taskId: z.string(),
});

/** 统一错误响应体（CONTRACT §6：所有错误分支必须可归入三态之一） */
export const ErrorResponseSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  disposition: ErrorDispositionSchema,
});

/**
 * V2.3（CONTRACT §4 末尾）：`GET /api/history` 响应里的**输出目录聚合**。
 * 目录级扫描（不是逐条累加），因此**老数据同样准确**；对账口径 = `du -sb outputs/`。
 */
export const StorageUsageSchema = z.object({
  totalBytes: z.number().int().nonnegative(),
  videoBytes: z.number().int().nonnegative(),
  videoCount: z.number().int().nonnegative(),
  thumbBytes: z.number().int().nonnegative(),
  assetBytes: z.number().int().nonnegative(),
  assetCount: z.number().int().nonnegative(),
});

/** `GET /api/history` 的 200 响应（含完整参数快照，供画廊一键回填） */
export const HistoryResponseSchema = z.object({
  items: z.array(TaskProgressSchema),
  // V2.3：输出目录聚合 —— 总览"存储占用"卡与"去清理"的数据源
  storage: StorageUsageSchema,
});

/** `DELETE /api/history/:taskId` 与 `POST /api/tasks/:taskId/cancel` 的 200 响应 */
export const OperationResultSchema = z.object({
  ok: z.boolean(),
  taskId: z.string(),
});

/**
 * `POST /api/upload` 的资产描述（CONTRACT §5 / §7）。
 * `mime` 来自**魔数嗅探**结果，不是客户端声明的 Content-Type（PLAN §7-6）。
 */
export const UploadedAssetSchema = z.object({
  assetId: z.string(),
  kind: z.enum(['image', 'video']),
  mime: z.string(),
  size: z.number().int().nonnegative(),
});

/** `POST /api/upload` 的 200 响应 */
export const UploadResponseSchema = z.object({
  assets: z.array(UploadedAssetSchema),
});

export type GenerateResponse = z.infer<typeof GenerateResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>;
export type StorageUsage = z.infer<typeof StorageUsageSchema>;
export type OperationResult = z.infer<typeof OperationResultSchema>;
export type UploadedAsset = z.infer<typeof UploadedAssetSchema>;
export type UploadResponse = z.infer<typeof UploadResponseSchema>;
