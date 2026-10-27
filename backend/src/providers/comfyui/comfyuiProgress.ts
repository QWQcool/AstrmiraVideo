/**
 * V2.82：ComfyUI 的**真实**执行进度（WebSocket）。
 *
 * ## 为什么需要这一层
 * ComfyUI 的 HTTP 接口**不报单任务进度**（`/history` 只有"完成/未完成"），
 * 进度只从 `/ws` 推：`{type:'progress', data:{value, max, prompt_id, node}}`。
 * 在此之前本地轨的 `progressPercent` 恒为 0，前端只能说"以出片为准"。
 *
 * ## 三条纪律
 * 1. **拿不到就不显示**：WS 连不上 / 没收到该 prompt 的事件 → 返回 null，
 *    调用方继续按"没有百分比"处理 —— 绝不匀速造一个假进度条；
 * 2. **进度会过期**：超过 `ttlMs` 没更新就不认（ComfyUI 重启后 prompt_id 会重来，
 *    旧值留着会让界面永远停在 60%）；
 * 3. **单例按地址共享**：provider 是每请求新建的，WS 必须挂在进程级（`getComfyProgressTracker`）。
 */

/** 一次进度事件的语义化结果（纯函数产出，便于单测） */
export type ComfyEventReduction =
  | { kind: 'progress'; promptId: string; percent: number }
  | { kind: 'done'; promptId: string }
  | { kind: 'ignore' };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * 把 ComfyUI 的 WS 消息收敛成"进度 / 完成 / 无关"。
 *
 * 只认两种：`progress`（有 value/max）与 `executing` 且 `node === null`（这是 ComfyUI 的完成信号）。
 * `execution_cached`、`status`、`executed` 等一律忽略 —— 它们不携带"做到百分之几"。
 */
export function reduceComfyEvent(raw: unknown): ComfyEventReduction {
  const message = asRecord(raw);
  if (message === null) return { kind: 'ignore' };
  const data = asRecord(message['data']);
  if (data === null) return { kind: 'ignore' };
  const promptId = typeof data['prompt_id'] === 'string' ? data['prompt_id'] : '';
  if (promptId === '') return { kind: 'ignore' };

  if (message['type'] === 'progress') {
    const value = data['value'];
    const max = data['max'];
    if (typeof value !== 'number' || typeof max !== 'number' || max <= 0) return { kind: 'ignore' };
    const percent = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
    return { kind: 'progress', promptId, percent };
  }

  // ComfyUI 在队列里跑完一条时会推 `executing` 且 node 为 null
  if (message['type'] === 'executing' && data['node'] === null) {
    return { kind: 'done', promptId };
  }

  return { kind: 'ignore' };
}

/** 最小 WS 形状（只用到这两个方法，方便测试注入假 socket） */
export interface ComfySocket {
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
  close(): void;
}

export type ComfySocketFactory = (url: string) => ComfySocket | null;

export interface ComfyProgressSource {
  /** 该 prompt 的实时进度；没有/过期/连不上 → null */
  progress(promptId: string): { percent: number } | null;
}

export interface ComfyProgressTrackerOptions {
  baseUrl: string;
  /** 测试注入；缺省用 Node 内置 WebSocket */
  createSocket?: ComfySocketFactory;
  now?: () => number;
  /** 进度多久没更新就作废（默认 90s：ComfyUI 一条 12 步视频任务也就几十秒） */
  ttlMs?: number;
  /** 断线重连间隔（默认 5s） */
  reconnectMs?: number;
}

/** 默认 socket 工厂：Node ≥22 自带 WebSocket；没有就返回 null（如实降级，不装） */
function defaultSocketFactory(url: string): ComfySocket | null {
  const ctor = (globalThis as { WebSocket?: new (target: string) => ComfySocket }).WebSocket;
  if (ctor === undefined) return null;
  try {
    return new ctor(url);
  } catch {
    return null;
  }
}

/** http(s) → ws(s) 并带上 clientId（ComfyUI 用它区分连接，不需要登录态） */
export function comfyWsUrl(baseUrl: string, clientId: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  const ws = trimmed.startsWith('https://')
    ? `wss://${trimmed.slice('https://'.length)}`
    : `ws://${trimmed.replace(/^http:\/\//, '')}`;
  return `${ws}/ws?clientId=${encodeURIComponent(clientId)}`;
}

export class ComfyProgressTracker implements ComfyProgressSource {
  private readonly options: Required<Omit<ComfyProgressTrackerOptions, 'createSocket'>> & {
    createSocket: ComfySocketFactory;
  };
  private socket: ComfySocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly entries = new Map<string, { percent: number; updatedAt: number }>();
  private stopped = false;

  constructor(options: ComfyProgressTrackerOptions) {
    this.options = {
      baseUrl: options.baseUrl,
      createSocket: options.createSocket ?? defaultSocketFactory,
      now: options.now ?? (() => Date.now()),
      ttlMs: options.ttlMs ?? 90_000,
      reconnectMs: options.reconnectMs ?? 5_000,
    };
  }

  /** 幂等：多次调用只连一次（provider 每请求都调，不能每次都建连） */
  start(): void {
    if (this.stopped || this.socket !== null) return;
    const socket = this.options.createSocket(comfyWsUrl(this.options.baseUrl, 'astrmira'));
    if (socket === null) return; // 环境不支持 WS：静默降级（进度恒为 null）

    socket.addEventListener('message', (event) => {
      const raw = event.data;
      if (typeof raw !== 'string') return; // 二进制是预览图，不是进度
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      const reduction = reduceComfyEvent(parsed);
      if (reduction.kind === 'progress') {
        this.entries.set(reduction.promptId, {
          percent: reduction.percent,
          updatedAt: this.options.now(),
        });
        // 防泄漏：长跑进程里 prompt 越积越多
        if (this.entries.size > 200) {
          const oldest = [...this.entries.entries()].sort(
            (left, right) => left[1].updatedAt - right[1].updatedAt,
          )[0];
          if (oldest !== undefined) this.entries.delete(oldest[0]);
        }
        return;
      }
      if (reduction.kind === 'done') this.entries.delete(reduction.promptId);
    });

    const reconnect = () => {
      this.socket = null;
      if (this.stopped || this.timer !== null) return;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.start();
      }, this.options.reconnectMs);
      // 别让重连定时器把进程钉住（测试里尤其明显）
      this.timer.unref?.();
    };
    socket.addEventListener('close', reconnect);
    socket.addEventListener('error', reconnect);

    this.socket = socket;
  }

  progress(promptId: string): { percent: number } | null {
    const entry = this.entries.get(promptId);
    if (entry === undefined) return null;
    if (this.options.now() - entry.updatedAt > this.options.ttlMs) {
      this.entries.delete(promptId);
      return null;
    }
    return { percent: entry.percent };
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.entries.clear();
  }
}

/** 进程级共享表：按 baseUrl 一台一个（provider 是每请求新建的，WS 不能挂在实例上） */
const trackers = new Map<string, ComfyProgressTracker>();

export function getComfyProgressTracker(baseUrl: string): ComfyProgressTracker {
  const existing = trackers.get(baseUrl);
  if (existing !== undefined) return existing;
  const tracker = new ComfyProgressTracker({ baseUrl });
  trackers.set(baseUrl, tracker);
  tracker.start();
  return tracker;
}
