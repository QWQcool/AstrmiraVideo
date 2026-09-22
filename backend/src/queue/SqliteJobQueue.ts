import type { TaskError, TaskProgress } from '@astrmira/shared';
import type { TaskStore, TrackId } from '../store/taskStore.js';
import type { JobQueue, QueueJob } from './JobQueue.js';

/**
 * `JobQueue` 的 SQLite 实现（PLAN §6-D20）：调度器只面向接口，
 * 多实例部署时可整体替换为 BullMQ 适配器而不动调度逻辑。
 *
 * 两条硬护栏（防线 7）：
 * 1. `claim` 必须排除 `uncertain` / 终态任务（由 TaskStore.claimOne 的 SQL 条件保证）；
 * 2. `requeue` 仅允许**尚未提交上游**的任务（凭 `upstreamTaskId` 判定）。
 */
export class SqliteJobQueue implements JobQueue {
  constructor(private readonly store: TaskStore) {}

  async submit(job: QueueJob): Promise<{ taskId: string }> {
    const existing = this.store.findTaskIdByIdempotencyKey(job.idempotencyKey);
    if (existing !== null) {
      // 同一幂等键：返回既有任务，**不产生第二次上游调用**（CONTRACT §5）
      return { taskId: existing };
    }

    this.store.insert({
      taskId: job.taskId,
      track: job.track,
      provider: job.request.provider,
      status: 'queued',
      progressPercent: 0,
      requestSnapshot: job.request,
      warnings: [],
      upstreamTaskId: job.upstreamTaskId,
      submitting: job.submitting,
    });
    this.store.putIdempotencyKey(job.idempotencyKey, job.taskId);

    return { taskId: job.taskId };
  }

  async claim(track: TrackId): Promise<QueueJob | null> {
    // 防线 1：本地轨单卡互斥 —— 已有 running 就不再领取
    if (track === 'local' && this.store.countRunning('local') >= 1) {
      return null;
    }

    const record = this.store.claimOne(track);
    if (record === null) return null;

    return {
      taskId: record.taskId,
      track: record.track,
      request: record.requestSnapshot,
      idempotencyKey: '',
      submitting: record.submitting,
      upstreamTaskId: record.upstreamTaskId,
    };
  }

  async heartbeat(taskId: string, progress: TaskProgress): Promise<void> {
    this.store.update(taskId, {
      status: progress.status,
      progressPercent: progress.progressPercent,
      message: progress.message,
      warnings: progress.warnings ?? this.store.get(taskId)?.warnings ?? [],
    });
  }

  async complete(taskId: string, output: { videoUrl: string; message?: string }): Promise<void> {
    this.store.update(taskId, {
      status: 'succeeded',
      progressPercent: 100,
      outputVideoUrl: output.videoUrl,
      submitting: false,
      // 终态文案：不传则回落到中性文案。
      // 关键是不能沿用上一阶段（轮询 heartbeat 写下的"上游生成中"）——
      // 那会让界面出现"succeeded + 上游生成中"的矛盾组合。
      message: output.message ?? '生成完成',
    });
  }

  async fail(taskId: string, error: TaskProgress['error']): Promise<void> {
    this.store.update(taskId, {
      status: 'failed',
      submitting: false,
      error: error ?? {
        code: 'UPSTREAM_ERROR',
        message: '未知失败（provider 未给出错误详情）',
        disposition: 'retryable',
      },
    });
  }

  /**
   * 写回上游 taskId。**不在 `JobQueue` 接口内**——调度器通过注入的 `markUpstreamAccepted`
   * 钩子调用（见 dispatcher.ts），以保证接口本身不暴露"绕过防线 7 判据"的能力。
   */
  setUpstreamTaskId(taskId: string, upstreamTaskId: string): void {
    this.store.update(taskId, { upstreamTaskId, submitting: false });
  }

  async requeue(taskId: string): Promise<void> {
    const record = this.store.get(taskId);
    if (record === null) throw new Error(`任务不存在：${taskId}`);

    // 防线 7：已提交上游但结果不明的任务**禁止**走此路径（否则可能重复计费）
    if (record.upstreamTaskId !== undefined) {
      throw new Error(
        `任务 ${taskId} 已提交上游（upstreamTaskId=${record.upstreamTaskId}），禁止 requeue；` +
          '结果不明时必须走 markUncertain 并由人工核对',
      );
    }

    this.store.update(taskId, { status: 'queued', progressPercent: 0, error: undefined });
  }

  async markUncertain(taskId: string, error: TaskProgress['error']): Promise<void> {
    const uncertain: TaskError = {
      code: error?.code ?? 'UNCERTAIN_RESULT',
      message: error?.message ?? '结果不明：已提交上游但无法确认执行结果',
      disposition: 'uncertain',
    };
    this.store.update(taskId, { status: 'failed', error: uncertain });
  }
}
