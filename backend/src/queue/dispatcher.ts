import { setTimeout as sleep } from 'node:timers/promises';
import type { ProviderType, TaskProgress, VideoProvider } from '@astrmira/shared';
import { ProviderFailureError, resolveTaskError } from '../errors.js';
import type { TrackId } from '../store/taskStore.js';
import type { JobQueue, QueueJob } from './JobQueue.js';

/**
 * 最小调度器（PLAN §1「双轨调度器」）：周期性向 `JobQueue` 领取任务并驱动 provider。
 *
 * 并发语义：
 * - `local` 轨：**Concurrency = 1**（防线 1）——由 `SqliteJobQueue.claim` 的 running 计数保证；
 * - `cloud` 轨：每个 tick 最多领 1 条，不设硬上限（MVP 单用户场景足够；限流属 S4）。
 *
 * 错误映射（S3 起**唯一入口**是 `errors.resolveTaskError`，本文件不再自行判 code）：
 * - 三态归类规则见 CONTRACT §6，映射表在 `backend/src/errors.ts`；
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
  /** 上游轮询间隔（默认 2000ms；测试注入极小值） */
  pollIntervalMs?: number;
  /** 上游轮询超时（默认 10 分钟）——**超时归 `UNCERTAIN_RESULT`**（CONTRACT §6 硬规则 2） */
  pollTimeoutMs?: number;
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

    /**
     * 是否**已进入提交阶段**（CONTRACT §5 的 `submitting` 语义）。
     * 置位时机是「即将调用 provider.submit」，而不是「拿到 upstreamTaskId」：
     * 提交动作发出但响应丢失时拿不到 upstreamTaskId，却无法排除上游已受理。
     */
    let submissionAttempted = false;

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

      // ── 进入提交阶段：此后任何未知失败的语义都是「结果不确定」──
      submissionAttempted = true;
      const { taskId: upstreamTaskId } = await provider.submit(job.request);
      // 写回上游 taskId：此后该任务不可 requeue（防线 7）
      await this.options.markUpstreamAccepted?.(job.taskId, upstreamTaskId);

      const progress = await this.pollUntilTerminal(job, provider, upstreamTaskId);

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
        return;
      }

      if (progress.status === 'cancelled') {
        // 在 provider 侧被取消：不是失败，落 cancelled 终态
        await this.options.queue.heartbeat(job.taskId, {
          taskId: job.taskId,
          status: 'cancelled',
          progressPercent: progress.progressPercent,
          requestSnapshot: job.request,
          message: progress.message ?? '任务已取消',
        });
        return;
      }

      await this.options.queue.fail(job.taskId, progress.error);
    } catch (err) {
      const error = resolveTaskError(err, { submissionAttempted });

      // uncertain 走专门的 markUncertain 路径（防线 7 在接口层的落点）；
      // 其余走 fail。两者最终都落库为 failed + disposition，区别在语义与审计意图。
      if (error.disposition === 'uncertain') {
        await this.options.queue.markUncertain(job.taskId, error);
      } else {
        await this.options.queue.fail(job.taskId, error);
      }

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

  /**
   * 轮询 provider 直到终态。
   *
   * 两个必须点：
   * 1. 每次轮询把进度 heartbeat 落库（防线 2：刷新可重挂载；也是 `slow_progress` 注入的验证对象）；
   * 2. **超时归 `UNCERTAIN_RESULT`**（CONTRACT §6 硬规则 2：任务型上游无响应即结果不明）。
   */
  private async pollUntilTerminal(
    job: QueueJob,
    provider: VideoProvider,
    upstreamTaskId: string,
  ): Promise<TaskProgress> {
    const intervalMs = this.options.pollIntervalMs ?? 2000;
    const timeoutMs = this.options.pollTimeoutMs ?? 10 * 60_000;
    const deadline = Date.now() + timeoutMs;

    let progress = await provider.queryStatus(upstreamTaskId);

    while (progress.status === 'queued' || progress.status === 'running') {
      if (Date.now() >= deadline) {
        throw new ProviderFailureError(
          'UNCERTAIN_RESULT',
          `轮询超时（${timeoutMs}ms）且无法确认上游结果`,
        );
      }

      await sleep(intervalMs);
      await this.options.queue.heartbeat(job.taskId, {
        taskId: job.taskId,
        status: 'running',
        progressPercent: progress.progressPercent,
        requestSnapshot: job.request,
        message: progress.message,
        warnings: progress.warnings,
      });

      progress = await provider.queryStatus(upstreamTaskId);
    }

    return progress;
  }
}
