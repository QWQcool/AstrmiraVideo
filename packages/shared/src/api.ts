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
 *
 * V2.10（台账 B57）：`kind` 新增 `audio` —— 音频（mp3 / wav / m4a）**原样落盘**。
 * ⚠️ 判 `audio` 不能只看容器：实测 `file-type` 对 `.m4a` 与 `.mp4` 都返回 `video/mp4`，
 * 因此服务端用 **ffprobe 流类型复核**（无视频流且有音频流 → audio），见 CONTRACT §5。
 */
export const UploadedAssetSchema = z.object({
  assetId: z.string(),
  kind: z.enum(['image', 'video', 'audio']),
  mime: z.string(),
  size: z.number().int().nonnegative(),
});

/** `POST /api/upload` 的 200 响应 */
export const UploadResponseSchema = z.object({
  assets: z.array(UploadedAssetSchema),
});

/**
 * `GET /api/assets` 的条目（V2.7 / 台账 B41）。
 * 在 `UploadedAsset` 之上补 `url`（同源 `/media/assets/<文件>` 直链）与 `createdAt`（文件 mtime，epoch ms）。
 * 与上传响应同一口径：`mime` / `size` 都是**落盘产物事实**（图像已过防线 4 清洗）。
 */
export const AssetListEntrySchema = UploadedAssetSchema.extend({
  url: z.string(),
  createdAt: z.number().int().nonnegative(),
  /**
   * V2.9（台账 B43）：用户原始文件名的 **sanitize 结果**（来自 `<assetId>.json` sidecar）。
   * 可选：抽帧产物与 V2.9 之前的老资产没有 sidecar → 无该字段（不填占位、不猜名字）。
   * ⚠️ 它**只落本地**：不进上游请求、不进操作日志、不进任务快照（见 CONTRACT §5 / §7）。
   */
  name: z.string().optional(),
  /**
   * V2.11（台账 B47）：资产所属项目。
   *
   * **永远有值** —— 上传时把 projectId 写进 sidecar；没有 sidecar 的老资产按**默认项目**算
   * （缺失 = 默认项目，是如实的归属而不是猜一个）。界面按当前项目过滤素材池靠它。
   */
  projectId: z.string(),
});

/** `GET /api/assets` 的 200 响应（最近 200 个，新的在前；空目录 → 空数组，不是 404） */
export const AssetListResponseSchema = z.object({
  assets: z.array(AssetListEntrySchema),
});

export type GenerateResponse = z.infer<typeof GenerateResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>;
export type StorageUsage = z.infer<typeof StorageUsageSchema>;
export type OperationResult = z.infer<typeof OperationResultSchema>;
export type UploadedAsset = z.infer<typeof UploadedAssetSchema>;
export type UploadResponse = z.infer<typeof UploadResponseSchema>;
export type AssetListEntry = z.infer<typeof AssetListEntrySchema>;
export type AssetListResponse = z.infer<typeof AssetListResponseSchema>;
