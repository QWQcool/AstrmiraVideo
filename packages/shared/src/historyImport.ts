import { z } from 'zod';
import { TaskProgressSchema } from './progress.js';

/**
 * S7-D8 / P3：把已经上传到本站的外部作品登记成历史记录。
 *
 * 这不是“模型生成任务”：provider 固定为 `imported`，没有上游任务、没有成本；
 * 只接受**本站已有 assetId**，不接受任意 URL（避免 SSRF 与伪造来源）。
 */
export const HistoryImportItemSchema = z
  .object({
    assetId: z.string().min(1).max(160),
    kind: z.enum(['image', 'video']),
    title: z.string().trim().min(1).max(120).optional(),
    prompt: z.string().max(4000).optional(),
    source: z.string().trim().max(80).optional(),
    createdAt: z.number().int().positive().optional(),
  })
  .strict();
export type HistoryImportItem = z.infer<typeof HistoryImportItemSchema>;

export const HistoryImportRequestSchema = z
  .object({
    projectId: z.string().min(1).max(160).optional(),
    items: z.array(HistoryImportItemSchema).min(1).max(20),
  })
  .strict();
export type HistoryImportRequest = z.infer<typeof HistoryImportRequestSchema>;

export const HistoryImportResponseSchema = z
  .object({
    tasks: z.array(TaskProgressSchema),
  })
  .strict();
export type HistoryImportResponse = z.infer<typeof HistoryImportResponseSchema>;
