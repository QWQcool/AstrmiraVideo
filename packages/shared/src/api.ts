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

/** `GET /api/history` 的 200 响应（含完整参数快照，供画廊一键回填） */
export const HistoryResponseSchema = z.object({
  items: z.array(TaskProgressSchema),
});

/** `DELETE /api/history/:taskId` 与 `POST /api/tasks/:taskId/cancel` 的 200 响应 */
export const OperationResultSchema = z.object({
  ok: z.boolean(),
  taskId: z.string(),
});

export type GenerateResponse = z.infer<typeof GenerateResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>;
export type OperationResult = z.infer<typeof OperationResultSchema>;
