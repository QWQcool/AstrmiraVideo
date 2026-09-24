import type { TaskError, TaskProgress } from '@astrmira/shared';
import type { TaskStore, TrackId } from '../store/taskStore.js';
import type { JobQueue, QueueJob, TaskProgressUpdate } from './JobQueue.js';

/**
 * `JobQueue` 的 SQLite 实现（PLAN §6-D20）：调度器只面向接口，
 * 多实例部署时可整体替换为 BullMQ 适配器而不动调度逻辑。
 *
 * 两条硬护栏（防线 7）：
 * 1. `claim` 必须排除 `uncertain` / 终态任务（由 TaskStore.claimOne 的 SQL 条件保证）；
 * 2. `requeue` 仅允许**尚未提交上游**的任务（凭 `upstreamTaskId` 判定）。
 */
/**
 * 任务终态事件（V9 修复：剪辑失败不进操作日志的缺口）。
 *
 * 为什么加它：`POST /api/edits` 返回 200 只代表"任务入队成功"，**执行是异步的** ——
 * 终态（complete / fail / uncertain）不产生新的 HTTP 请求，于是操作日志里无迹可查
 * （用户在剪辑台看到失败，翻日志却全是 200）。这里把终态作为**事件**抛给调用方
 * （`index.ts` 注入写 `EventLogStore`），让"任务跑完了 / 跑砸了 / 结果待核对"在日志里可见。
 */
export interface TaskTerminalEvent {
  taskId: string;
  action: 'task.complete' | 'task.fail' | 'task.uncertain';
  provider: string;
  /** 剪辑任务 = 'edit'（由 edit_script 列派生）；缺省 = 生成任务 */
  kind?: 'edit';
  errorCode?: string;
  disposition?: string;
  message?: string;
}

export class SqliteJobQueue implements JobQueue {
  constructor(
    private readonly store: TaskStore,
    private readonly onTaskTerminal?: (event: TaskTerminalEvent) => void,
  ) {}

  /** 终态上报：失败不抛（日志丢了不该让任务状态也丢） */
  private emitTerminal(event: TaskTerminalEvent): void {
    try {
      this.onTaskTerminal?.(event);
    } catch {
      /* 日志写失败不改变任务终态 */
    }
  }

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
      // V9 · B9：剪辑任务的 EDL 随任务落库 —— 它同时是"这条任务是不是剪辑产物"的判据
      ...(job.editScript === undefined ? {} : { editScript: job.editScript }),
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
      // V9 · B9：任务类别由 `edit_script` 列派生（有 EDL = 剪辑任务）
      ...(record.editScript === undefined
        ? {}
        : { kind: 'edit' as const, editScript: record.editScript }),
    };
  }

  async heartbeat(taskId: string, progress: TaskProgressUpdate): Promise<void> {
    this.store.update(taskId, {
      status: progress.status,
      progressPercent: progress.progressPercent,
      message: progress.message,
      warnings: progress.warnings ?? this.store.get(taskId)?.warnings ?? [],
    });
  }

  async complete(
    taskId: string,
    output: { videoUrl: string; thumbnailUrl?: string; message?: string },
  ): Promise<void> {
    const before = this.store.get(taskId);
    this.store.update(taskId, {
      status: 'succeeded',
      progressPercent: 100,
      outputVideoUrl: output.videoUrl,
      ...(output.thumbnailUrl === undefined ? {} : { thumbnailUrl: output.thumbnailUrl }),
      submitting: false,
      // 终态文案：不传则回落到中性文案。
      // 关键是不能沿用上一阶段（轮询 heartbeat 写下的"上游生成中"）——
      // 那会让界面出现"succeeded + 上游生成中"的矛盾组合。
      message: output.message ?? '生成完成',
    });
    if (before !== null) {
      this.emitTerminal({
        taskId,
        action: 'task.complete',
        provider: before.provider,
        ...(before.editScript === undefined ? {} : { kind: 'edit' }),
        ...(output.message === undefined ? {} : { message: output.message }),
      });
    }
  }

  async fail(taskId: string, error: TaskProgress['error']): Promise<void> {
    const before = this.store.get(taskId);
    const finalError = error ?? {
      code: 'UPSTREAM_ERROR',
      message: '未知失败（provider 未给出错误详情）',
      disposition: 'retryable' as const,
    };
    this.store.update(taskId, {
      status: 'failed',
      submitting: false,
      error: finalError,
    });
    if (before !== null) {
      this.emitTerminal({
        taskId,
        action: 'task.fail',
        provider: before.provider,
        ...(before.editScript === undefined ? {} : { kind: 'edit' }),
        errorCode: finalError.code,
        disposition: finalError.disposition,
        message: finalError.message,
      });
    }
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
    const before = this.store.get(taskId);
    const uncertain: TaskError = {
      code: error?.code ?? 'UNCERTAIN_RESULT',
      message: error?.message ?? '结果不明：已提交上游但无法确认执行结果',
      disposition: 'uncertain',
    };
    this.store.update(taskId, { status: 'failed', error: uncertain });
    if (before !== null) {
      this.emitTerminal({
        taskId,
        action: 'task.uncertain',
        provider: before.provider,
        ...(before.editScript === undefined ? {} : { kind: 'edit' }),
        errorCode: uncertain.code,
        disposition: uncertain.disposition,
        message: uncertain.message,
      });
    }
  }
}
