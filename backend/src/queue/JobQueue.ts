import type { TaskProgress, VideoGenerateRequest } from '@astrmira/shared';

/**
 * 任务队列抽象层（PLAN §6-D20；生命周期与存储口径见 CONTRACT §5 / §7）。
 *
 * ⚠️ 本文件只定义契约，**不含任何实现**（EXEC T6 边界）：SQLite 承载属 Step 2 公共链路，
 * 本层存在的意义是让调度器面向接口编程，而不是面向具体的存储实现。
 */

/** 调度轨：云端并发队列 / 本地单卡互斥队列（PLAN §3 防线 1：local 轨 Concurrency = 1） */
export type TrackId = 'cloud' | 'local';

/** 入队任务（CONTRACT §5 幂等键与 submitting 标记 / §7 存储与生命周期） */
export interface QueueJob {
  /** 服务端分配的任务 ID，也是幂等键 → taskId 映射的目标（CONTRACT §5） */
  taskId: string;
  /** 所属调度轨 */
  track: TrackId;
  /** 完整请求快照；落库供画廊一键回填（CONTRACT §4 requestSnapshot） */
  request: VideoGenerateRequest;
  /** 幂等键；缺省时由服务端按「provider + 请求指纹」生成（CONTRACT §5） */
  idempotencyKey: string;
  /**
   * 「即将提交」标记：在**真正向上游提交之前**先落库（CONTRACT §5 / §7）。
   * 它是防线 7 能够落地的唯一判据——没有该标记就无法区分
   * 「没提交」与「提交了但不知道结果」。
   */
  submitting: boolean;
  /** 上游任务 ID；仅在上游接受提交后写回。空值 = 尚未提交上游 */
  upstreamTaskId?: string;
}

/**
 * 队列抽象：当前由 SQLite 实现承载（Step 2），
 * 多实例公网部署时可替换为 BullMQ 适配器，调度器不得感知差异。
 */
export interface JobQueue {
  /** 入队并返回服务端分配的 taskId；幂等键去重由实现保证（CONTRACT §5） */
  submit(job: QueueJob): Promise<{ taskId: string }>;

  /**
   * 原子领取；`local` 轨 Concurrency = 1（防线 1）。
   * **必须显式排除 uncertain / terminal 态任务**——UNCERTAIN_RESULT 与终态失败
   * 不得被任何自动领取路径消费（防线 7）。无可用任务时返回 null。
   */
  claim(track: TrackId): Promise<QueueJob | null>;

  /** 进度心跳：落库以支持刷新重挂载（防线 2）与 warnings 持久化（CONTRACT §4） */
  heartbeat(taskId: string, progress: TaskProgress): Promise<void>;

  /**
   * 置终态成功。
   *
   * `message` 是可选的**终态文案**：必须允许覆盖上一阶段的进行中说明，
   * 否则会留下「succeeded 却写着『上游生成中』」这种自相矛盾的展示
   * （实测踩到：轮询阶段的 heartbeat 写入 message，成功后不动它就残留在终态上）。
   *
   * `thumbnailUrl`（V1.9）同理可选：抽帧失败**不得**影响任务成功 ——
   * 缩略图是画廊体验优化，不是任务结果的一部分。
   */
  complete(
    taskId: string,
    output: { videoUrl: string; thumbnailUrl?: string; message?: string },
  ): Promise<void>;

  fail(taskId: string, error: TaskProgress['error']): Promise<void>;

  /**
   * 仅允许「尚未提交上游」的任务回队列重跑——凭 CONTRACT §5 的 `submitting` 标记判定：
   * 无上游 taskId 才可 requeue。已提交但结果不明的任务**禁止**走此路径（防线 7）：
   * 对云端轨而言，一个已提交 Seedance 且正在计费的任务被自动重跑 = 重复扣费。
   */
  requeue(taskId: string): Promise<void>;

  /**
   * 已提交上游但结果不明（轮询中断 / 进程重启 / 上游超时）→ 归 UNCERTAIN_RESULT，
   * 终态待人工核对；任何自动领取 / 重跑路径不得消费此状态
   * （PLAN §3 防线 7 / CONTRACT §6 硬规则 2：超时一律归 UNCERTAIN_RESULT，不归 UPSTREAM_ERROR）。
   */
  markUncertain(taskId: string, error: TaskProgress['error']): Promise<void>;
}
