import type { ProviderType, VideoProvider } from '@astrmira/shared';
import { MediaProbeError } from '../lib/ffmpeg.js';
import type { TrackId } from '../store/taskStore.js';
import type { JobQueue, QueueJob } from './JobQueue.js';

/**
 * 最小调度器（PLAN §1「双轨调度器」）：周期性向 `JobQueue` 领取任务并驱动 provider。
 *
 * 并发语义：
 * - `local` 轨：**Concurrency = 1**（防线 1）——由 `SqliteJobQueue.claim` 的 running 计数保证；
 * - `cloud` 轨：每个 tick 最多领 1 条，不设硬上限（MVP 单用户场景足够；限流属 S4）。
 *
 * 错误映射（S3 会做完整穷举，此处只保证"付费不确定性"不误判）：
 * - 媒体探测失败 → `INVALID_ASSET`（terminal）
 * - 其余异常 → `UPSTREAM_ERROR`（retryable）
 * - **绝不在异常时调用 `requeue`**：是否可重跑由 `submitting` 标记与上游结果决定，
 *   自动重试付费上游 = 重复计费（防线 7）。
 */
export interface JobDispatcherOptions {
  queue: JobQueue;
  resolveProvider: (id: ProviderType) => VideoProvider | null;
  cleanup?: (taskId: string) => Promise<void>;
  /**
   * 上游接受了提交（拿到了上游 taskId）时的写回钩子。
   * 它是防线 7 的落账点：写回之后该任务**不可**再走 `requeue`，只能 `markUncertain`。
   */
  markUpstreamAccepted?: (taskId: string, upstreamTaskId: string) => Promise<void>;
  intervalMs?: number;
  onError?: (err: unknown) => void;
}

export class JobDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private readonly inFlight = new Set<string>();
  private readonly intervalMs: number;

  constructor(private readonly options: JobDispatcherOptions) {
    this.intervalMs = options.intervalMs ?? 200;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    // 不阻止进程退出（测试里便于收尾）
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 供测试同步驱动：领一轮任务 */
  async tick(): Promise<void> {
    for (const track of ['cloud', 'local'] as const satisfies readonly TrackId[]) {
      const job = await this.options.queue.claim(track);
      if (job === null) continue;
      void this.run(job);
    }
  }

  /** 等待所有在途任务结束（测试用） */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  private async run(job: QueueJob): Promise<void> {
    this.inFlight.add(job.taskId);

    try {
      const provider = this.options.resolveProvider(job.request.provider);
      if (provider === null) {
        await this.options.queue.fail(job.taskId, {
          code: 'PROVIDER_UNAVAILABLE',
          message: `provider 未实现或未启用：${job.request.provider}`,
          disposition: 'terminal',
        });
        return;
      }

      const health = await provider.checkHealth();
      if (!health.available) {
        await this.options.queue.fail(job.taskId, {
          code: 'PROVIDER_UNAVAILABLE',
          message: health.reason ?? 'provider 健康检查未通过',
          disposition: 'terminal',
        });
        return;
      }

      await this.options.queue.heartbeat(job.taskId, {
        taskId: job.taskId,
        status: 'running',
        progressPercent: 0,
        requestSnapshot: job.request,
        message: '已开始执行',
      });

      const { taskId: upstreamTaskId } = await provider.submit(job.request);
      // 写回上游 taskId：此后该任务不可 requeue（防线 7）
      await this.options.markUpstreamAccepted?.(job.taskId, upstreamTaskId);

      const progress = await provider.queryStatus(upstreamTaskId);

      if (progress.status === 'succeeded') {
        // 顺序要点：**先**落 warnings（heartbeat），**再**置终态。
        // 若反过来，heartbeat 会把 succeeded 覆写回 running（已实测踩到）。
        if (progress.warnings !== undefined && progress.warnings.length > 0) {
          await this.options.queue.heartbeat(job.taskId, {
            taskId: job.taskId,
            status: 'running',
            progressPercent: 100,
            requestSnapshot: job.request,
            warnings: progress.warnings,
          });
        }
        await this.options.queue.complete(job.taskId, {
          videoUrl: progress.outputVideoUrl ?? '',
        });
      } else {
        await this.options.queue.fail(job.taskId, progress.error);
      }
    } catch (err) {
      const error =
        err instanceof MediaProbeError
          ? { code: 'INVALID_ASSET' as const, message: err.message, disposition: 'terminal' as const }
          : {
              code: 'UPSTREAM_ERROR' as const,
              message: (err as Error).message,
              disposition: 'retryable' as const,
            };
      await this.options.queue.fail(job.taskId, error);
      this.options.onError?.(err);
    } finally {
      // 防线 3：无论成败，合成结束后清理该任务的临时目录
      try {
        await this.options.cleanup?.(job.taskId);
      } catch {
        /* 清理失败不改变任务终态，但会留痕在调用方日志 */
      }
      this.inFlight.delete(job.taskId);
    }
  }
}
