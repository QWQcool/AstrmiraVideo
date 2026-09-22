import { z } from 'zod';
import { VideoGenerateRequestSchema } from './request.js';
import type { ProviderType, VideoGenerateRequest } from './request.js';

/**
 * 契约投影来源：docs/CONTRACT.md §4 任务进度与统一 Provider 接口 / §6 错误码字典
 */

export const TaskStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);

/**
 * V1.3：由 `retryable: boolean` 升级为三态。所有错误分支必须可归入其中之一，
 * 不允许「视情况而定」；'uncertain' 时禁止任何自动重提（PLAN §3 防线 7）。
 */
export const ErrorDispositionSchema = z.enum(['retryable', 'terminal', 'uncertain']);

/** CONTRACT §6：9 个错误码全量 */
export const ErrorCodeSchema = z.enum([
  'PROVIDER_UNAVAILABLE', // 所选引擎健康检查失败
  'GPU_BUSY', // 本地队列已有任务在执行
  'RATE_LIMITED', // 60s 防抖窗口内重复提交
  'INVALID_ASSET', // 资产格式无法清洗 / 32 倍数规整失败
  'PROMPT_REJECTED', // 提示词为空 / 超长 / 台词超长引导未确认
  'UPSTREAM_ERROR', // 上游**明确返回**错误（响应体可读）
  'UNCERTAIN_RESULT', // 已提交但无法确认结果：轮询中断 / 进程重启 / 上游超时无响应
  'TASK_NOT_FOUND', // taskId 不存在或已清理
  'DISK_FULL', // 输出目录磁盘不足
]);

export const TaskErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  disposition: ErrorDispositionSchema,
});

export const TaskProgressSchema = z.object({
  taskId: z.string(),
  status: TaskStatusSchema,
  progressPercent: z.number().min(0).max(100),
  currentStep: z.number().int().optional(),
  totalSteps: z.number().int().optional(),
  message: z.string().optional(),
  outputVideoUrl: z.string().optional(),
  // V1.4：用户可见的非阻断告警（如「素材短于请求时长，已循环播放」「循环素材自带音轨，已静音」）。
  // 与 message 职责分离：可并存多条、不随进度刷新被覆盖、随任务记录持久化（PLAN §6-D15）。
  warnings: z.array(z.string()).optional(),
  // 完整请求快照，供画廊一键回填
  requestSnapshot: VideoGenerateRequestSchema,
  error: TaskErrorSchema.optional(),
});

/**
 * CONTRACT §4：统一 Provider 接口（interface 用 TS 原生定义，方法签名与 CONTRACT 一致）。
 * OI（stock-local / fixture-local）必须实现完全相同的接口，不得新增专属请求字段、
 * 不得改变接口形状、不得要求调用方分支判断（详见 CONTRACT §4 与 PLAN §4「Step 2 补充」）。
 */
export interface VideoProvider {
  readonly id: ProviderType;
  readonly name: string;
  checkHealth(): Promise<{ available: boolean; reason?: string }>;
  submit(req: VideoGenerateRequest): Promise<{ taskId: string }>;
  queryStatus(taskId: string): Promise<TaskProgress>;
  cancel(taskId: string): Promise<boolean>;
}

export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type ErrorDisposition = z.infer<typeof ErrorDispositionSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type TaskError = z.infer<typeof TaskErrorSchema>;
export type TaskProgress = z.infer<typeof TaskProgressSchema>;
