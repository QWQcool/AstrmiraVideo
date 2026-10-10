import {
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_DELIVERY_MAX_ATTEMPTS,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_EVENT_TASK_TERMINAL,
  WEBHOOK_RETRY_BACKOFF_MS,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_SWEEP_BATCH,
  WEBHOOK_SWEEP_INTERVAL_MS,
  WEBHOOK_SWEEP_LOOKBACK_MS,
  WEBHOOK_TIMEOUT_MS,
  type TaskTerminalPayload,
} from '@astrmira/shared';
import type { TaskRecord } from '../store/taskStore.js';
import type { TaskStore } from '../store/taskStore.js';
import type { WebhookDeliveryRecord, WebhookStore } from '../store/webhooks.js';
import { signPayload } from './signature.js';

/**
 * Webhook 投递循环（V2.15 / 台账 B51，契约 §15）。
 *
 * 一轮 = **补投扫描** + **投递到期批次**。为什么是一次扫描而不是"终态时立刻推"：
 * 见 `store/webhooks.ts` 的文件头（内联触发要改三处终态写入点，且漏掉"终态时进程重启"）。
 *
 * ## 投递语义（对齐各家 webhook 的常识，但只做我们真需要的那部分）
 * - **2xx = 成功**；其它状态码、网络错误、超时**都算失败并重试**；
 * - 重试上限 3 次（首次 + 2 次重试），退避 5s / 25s，用尽后 `status='failed'`，
 *   **不再自动重试**（客户系统长时间宕机时应自己拉历史补，而不是让我们无限重试）；
 * - 每次投递都带 `X-Astrmira-Delivery`（投递 id，客户可用它做幂等键）+ `X-Astrmira-Event` +
 *   `X-Astrmira-Signature`（HMAC-SHA256，见 signature.ts）；
 * - 投递失败**不抛**：客户系统会宕机，这是常态，它只该留痕（流水 + 扫描器 onError 日志）。
 */

export interface WebhookDispatcherOptions {
  webhooks: WebhookStore;
  tasks: TaskStore;
  /** 公网基址（`PUBLIC_BASE_URL`）：有它时载荷里的成片给**绝对 URL** */
  publicBaseUrl?: string;
  intervalMs?: number;
  lookbackMs?: number;
  batch?: number;
  timeoutMs?: number;
  /** 注入点（测试用）：默认全局 fetch / Date.now */
  fetchImpl?: typeof fetch;
  now?: () => number;
  onError?: (error: unknown) => void;
  /** 每轮结束的回调（测试用它等一轮跑完，不必 sleep） */
  onTick?: (created: number, delivered: number, failed: number) => void;
}

/**
 * 载荷（纯函数）：字段与 `TaskProgress` 同名同义 —— 客户拿到它就能和自己轮询到的对象对账。
 * `costYuan` 缺省不出现（**未结算 ≠ 0**，与 §13 同一口径）。
 */
export function buildTerminalPayload(input: {
  delivery: WebhookDeliveryRecord;
  /** 存储层的任务记录（含 `projectId`；`TaskProgress` 是它的对外投影，两者字段同义） */
  task: TaskRecord;
  publicBaseUrl?: string;
  now: number;
}): TaskTerminalPayload {
  const { delivery, task } = input;
  const absolute = (url: string | undefined): string | undefined => {
    if (url === undefined) return undefined;
    if (input.publicBaseUrl === undefined) return url; // 未配基址 → 给相对路径（文档里写明）
    return `${input.publicBaseUrl.replace(/\/$/, '')}${url}`;
  };

  return {
    event: WEBHOOK_EVENT_TASK_TERMINAL,
    deliveryId: delivery.deliveryId,
    taskId: task.taskId,
    projectId: task.projectId ?? 'default',
    status: task.status,
    ...(task.error === undefined
      ? {}
      : {
          disposition: task.error.disposition,
          errorCode: task.error.code,
          message: task.error.message,
        }),
    ...(absolute(task.outputVideoUrl) === undefined
      ? {}
      : { outputVideoUrl: absolute(task.outputVideoUrl) as string }),
    ...(absolute(task.thumbnailUrl) === undefined
      ? {}
      : { thumbnailUrl: absolute(task.thumbnailUrl) as string }),
    progressPercent: task.progressPercent,
    ...(task.cost === undefined ? {} : { costYuan: task.cost.yuan }),
    createdAt: task.createdAt,
    terminatedAt: input.now,
  };
}

export class WebhookDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private inFlight: Promise<void> | null = null;

  constructor(private readonly options: WebhookDispatcherOptions) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.options.intervalMs ?? WEBHOOK_SWEEP_INTERVAL_MS);
    // 定时器不该拖住进程退出（与 storageEvict 同一纪律）
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 等在飞的一轮结束（关库前必须调 —— 否则会压在已关闭的连接上） */
  async drain(): Promise<void> {
    if (this.inFlight !== null) await this.inFlight;
  }

  /** 跑一轮（幂等重入保护：定时器与手动调用可能撞上） */
  async tick(): Promise<void> {
    if (this.running) return this.drain();
    this.running = true;
    this.inFlight = this.runOnce().finally(() => {
      this.running = false;
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runOnce(): Promise<void> {
    const now = this.now();
    let created = 0;
    let delivered = 0;
    let failed = 0;

    try {
      created = this.options.webhooks.enqueueMissing({
        now,
        lookbackMs: this.options.lookbackMs ?? WEBHOOK_SWEEP_LOOKBACK_MS,
        batch: this.options.batch ?? WEBHOOK_SWEEP_BATCH,
      });

      const due = this.options.webhooks.listDue(now, this.options.batch ?? WEBHOOK_SWEEP_BATCH);
      for (const delivery of due) {
        const outcome = await this.deliver(delivery);
        if (outcome === 'delivered') delivered += 1;
        else if (outcome === 'failed-permanently') failed += 1;
      }
    } catch (error) {
      this.options.onError?.(error);
    }

    this.options.onTick?.(created, delivered, failed);
  }

  private async deliver(delivery: WebhookDeliveryRecord): Promise<'delivered' | 'failed' | 'failed-permanently'> {
    const now = this.now();
    const webhook = this.options.webhooks.get(delivery.webhookId);
    if (webhook === null) {
      // 订阅被删了：这条流水不可能再成功 —— 如实记死，而不是挂着 pending 骗人
      this.options.webhooks.markAttemptFailed({
        deliveryId: delivery.deliveryId,
        statusCode: null,
        error: '订阅已删除',
        now,
        nextAttemptAt: null,
      });
      return 'failed-permanently';
    }

    const task = this.options.tasks.get(delivery.taskId);
    if (task === null) {
      this.options.webhooks.markAttemptFailed({
        deliveryId: delivery.deliveryId,
        statusCode: null,
        error: '任务记录不存在',
        now,
        nextAttemptAt: null,
      });
      return 'failed-permanently';
    }

    const payload = buildTerminalPayload({
      delivery,
      task,
      ...(this.options.publicBaseUrl === undefined ? {} : { publicBaseUrl: this.options.publicBaseUrl }),
      now,
    });
    // ⚠️ 签的是**这段字节**：序列化只做一次，签名与请求体必须同源
    const body = JSON.stringify(payload);

    const fetchImpl = this.options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? WEBHOOK_TIMEOUT_MS);

    try {
      const response = await fetchImpl(webhook.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [WEBHOOK_EVENT_HEADER]: payload.event,
          [WEBHOOK_DELIVERY_HEADER]: delivery.deliveryId,
          [WEBHOOK_SIGNATURE_HEADER]: signPayload(webhook.secret, body),
        },
        body,
        signal: controller.signal,
      });

      if (response.ok) {
        this.options.webhooks.markDelivered(delivery.deliveryId, response.status, this.now());
        return 'delivered';
      }

      const attempts = delivery.attempts + 1;
      const nextAttemptAt = this.nextAttemptAt(attempts, this.now());
      this.options.webhooks.markAttemptFailed({
        deliveryId: delivery.deliveryId,
        statusCode: response.status,
        error: `HTTP ${response.status}`,
        now: this.now(),
        nextAttemptAt,
      });
      return nextAttemptAt === null ? 'failed-permanently' : 'failed';
    } catch (error) {
      const attempts = delivery.attempts + 1;
      const nextAttemptAt = this.nextAttemptAt(attempts, this.now());
      this.options.webhooks.markAttemptFailed({
        deliveryId: delivery.deliveryId,
        statusCode: null,
        error: error instanceof Error ? error.message : String(error),
        now: this.now(),
        nextAttemptAt,
      });
      return nextAttemptAt === null ? 'failed-permanently' : 'failed';
    } finally {
      clearTimeout(timeout);
    }
  }

  /** 第 `attempts` 次失败之后还排不排下一次（null = 用尽了） */
  private nextAttemptAt(attempts: number, now: number): number | null {
    if (attempts >= WEBHOOK_DELIVERY_MAX_ATTEMPTS) return null;
    const backoff = WEBHOOK_RETRY_BACKOFF_MS[attempts - 1];
    if (backoff === undefined) return null;
    return now + backoff;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}
