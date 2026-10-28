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

import type { ComfyLinkStats } from '@astrmira/shared';

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
  /** 浏览器/undici 的 WebSocket 默认把二进制给成 Blob —— 必须显式要求 ArrayBuffer */
  binaryType?: string;
}

/**
 * ComfyUI 的**二进制预览帧**（V2.95 / B104）。
 *
 * 协议（ComfyUI `server.py` 的 `send_sync`）：每帧前 4 字节是事件类型（big-endian uint32），
 * 类型 `1` = 预览图，紧跟 4 字节图片格式（`1` = JPEG、`2` = PNG），之后才是图片字节。
 * 其它类型（`3` = 文本、`2` = 旧版未压缩预览）一律忽略 —— 我们只认能直接当图片显示的那一种。
 *
 * **为什么值得解析**：采样过程中 ComfyUI 会推 latent 预览（模糊但形状正确），
 * 这是"片子正在长成什么样"的唯一真实信号；不给它，用户只能盯着一个百分比。
 */
export type ComfyBinaryReduction =
  | { kind: 'preview'; mime: 'image/jpeg' | 'image/png'; bytes: Uint8Array }
  | { kind: 'ignore' };

export function parseComfyBinaryFrame(raw: unknown): ComfyBinaryReduction {
  const bytes = toBytes(raw);
  if (bytes === null || bytes.length < 8) return { kind: 'ignore' };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eventType = view.getUint32(0, false);
  if (eventType !== 1) return { kind: 'ignore' };
  const format = view.getUint32(4, false);
  const mime = format === 1 ? 'image/jpeg' : format === 2 ? 'image/png' : null;
  if (mime === null) return { kind: 'ignore' };
  const payload = bytes.subarray(8);
  if (payload.length === 0) return { kind: 'ignore' };
  return { kind: 'preview', mime, bytes: payload };
}

/** 把 WS 的 `event.data` 收敛成字节视图（支持 ArrayBuffer / TypedArray / Buffer） */
function toBytes(raw: unknown): Uint8Array | null {
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  // Node 的 Buffer 是 Uint8Array 子类，上面已覆盖；这里兜住跨 realm 的 ArrayBufferView
  if (ArrayBuffer.isView(raw)) {
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  return null;
}

export type ComfySocketFactory = (url: string) => ComfySocket | null;

export interface ComfyProgressSource {
  /** 该 prompt 的实时进度；没有/过期/连不上 → null */
  progress(promptId: string): { percent: number } | null;
  /** V2.95（B104）：该 prompt 是否已有预览帧（没有 → null）。**只有拿到才算有**，不占位 */
  previewSeq?(promptId: string): number | null;
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
    const socket = new ctor(url);
    /**
     * V2.95（B104）：**必须**显式要求 ArrayBuffer。
     *
     * undici（Node ≥22 的全局 WebSocket）默认 `binaryType = 'blob'`，二进制预览帧会以
     * Blob 形式到达 —— 位置不对就拿不到字节，表现为"预览一直没有"。
     * 这条是 2026-10-28 真机跑出来的：解析函数没错，是数据根本没到手。
     */
    try {
      socket.binaryType = 'arraybuffer';
    } catch {
      /* 某些实现只读 —— 下面还有 Blob 兜底 */
    }
    return socket;
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
  /**
   * V2.90（D-8）：连接事实。只做**计数**，不影响任何行为 ——
   * 观测不该改变被观测对象的时序（例如为统计而提前/延后重连）。
   */
  private state: ComfyLinkStats['state'] = 'connecting';
  private opens = 0;
  private reconnects = 0;
  /**
   * V2.95（B104）：每个 prompt 的**最新一帧采样预览**。
   *
   * 只留最新一帧（不攒历史）：它是"正在长成什么样"的当下状态，攒起来既没用又费内存。
   * `seq` 递增用于让前端判断"要不要重新拉图"，避免每次轮询都重下一遍 base64。
   */
  private readonly previews = new Map<
    string,
    { bytes: Uint8Array; mime: string; seq: number; updatedAt: number }
  >();
  private previewSeqCounter = 0;
  /**
   * 二进制预览帧**不带 prompt_id**（ComfyUI 协议如此）—— 只能归属到"最近在跑的那条"。
   * 本地轨并发恒为 1（防线 1），所以这个近似是成立的；并发 >1 时宁可少给也不张冠李戴。
   */
  private currentPromptId: string | null = null;

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
      if (typeof raw !== 'string') {
        // V2.95（B104）：二进制帧 = 采样预览图（不是进度）
        const reduceBinary = (data: unknown) => {
          const reduction = parseComfyBinaryFrame(data);
          if (reduction.kind !== 'preview') return;
          const promptId = this.currentPromptId;
          if (promptId === null) return; // 还不知道这帧属于谁 —— 宁可不给，也不张冠李戴
          this.previewSeqCounter += 1;
          this.previews.set(promptId, {
            bytes: reduction.bytes,
            mime: reduction.mime,
            seq: this.previewSeqCounter,
            updatedAt: this.options.now(),
          });
        };
        // Blob 兜底：万一 binaryType 设不上（实现只读），也别把预览直接丢掉
        const maybeBlob = raw as { arrayBuffer?: () => Promise<ArrayBuffer> };
        if (typeof maybeBlob.arrayBuffer === 'function' && !ArrayBuffer.isView(raw)) {
          void maybeBlob
            .arrayBuffer()
            .then((buffer) => reduceBinary(buffer))
            .catch(() => undefined);
          return;
        }
        reduceBinary(raw);
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      const reduction = reduceComfyEvent(parsed);
      if (reduction.kind === 'progress') {
        this.currentPromptId = reduction.promptId;
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
      if (reduction.kind === 'done') {
        this.entries.delete(reduction.promptId);
        // 跑完就把预览丢掉：界面该看的是成片，不是最后一帧模糊图
        this.previews.delete(reduction.promptId);
        if (this.currentPromptId === reduction.promptId) this.currentPromptId = null;
      }
    });

    const reconnect = () => {
      this.socket = null;
      if (this.stopped || this.timer !== null) return;
      this.state = 'closed';
      // 只有**真的排了一次重连**才 +1（error 与 close 可能先后到达，不能各算一次）
      this.reconnects += 1;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.start();
      }, this.options.reconnectMs);
      // 别让重连定时器把进程钉住（测试里尤其明显）
      this.timer.unref?.();
    };
    // `open` 只有真连上才会触发（构造出不等于连上）—— 计数只认它
    socket.addEventListener('open', () => {
      this.opens += 1;
      this.state = 'connected';
    });
    socket.addEventListener('close', reconnect);
    socket.addEventListener('error', reconnect);

    this.socket = socket;
  }

  /** V2.90（D-8）：连接事实快照（`/api/stats/summary` 用） */
  stats(): ComfyLinkStats {
    return {
      baseUrl: this.options.baseUrl,
      state: this.stopped ? 'closed' : this.state,
      opens: this.opens,
      reconnects: this.reconnects,
    };
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

  /**
   * V2.95（B104）：该 prompt 是否有预览帧。返回 `seq`（递增序号）而不是布尔 ——
   * 前端靠"序号变了"决定要不要重新拉图，而不是每次轮询都下一遍。
   * 过期规则与进度一致：太久没更新就不认（ComfyUI 重启后 prompt_id 会重来）。
   */
  previewSeq(promptId: string): number | null {
    const entry = this.previews.get(promptId);
    if (entry === undefined) return null;
    if (this.options.now() - entry.updatedAt > this.options.ttlMs) {
      this.previews.delete(promptId);
      return null;
    }
    return entry.seq;
  }

  /** 该 prompt 的最新预览帧（路由按需取；没有就 null —— 不返回占位图） */
  preview(promptId: string): { bytes: Uint8Array; mime: string; seq: number } | null {
    const entry = this.previews.get(promptId);
    if (entry === undefined) return null;
    if (this.options.now() - entry.updatedAt > this.options.ttlMs) {
      this.previews.delete(promptId);
      return null;
    }
    return { bytes: entry.bytes, mime: entry.mime, seq: entry.seq };
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

/**
 * V2.90（D-8）：已建立的 ComfyUI 进度通道快照。
 *
 * 没有实例 → 空数组（**不造一条"已连接"** —— 那会让运维以为通道正常）。
 */
export function comfyProgressStats(): ComfyLinkStats[] {
  return [...trackers.values()].map((tracker) => tracker.stats());
}

/**
 * V2.95（B104）：按 promptId 找预览帧（**跨实例查找**）。
 *
 * 为什么不在路由里按 baseUrl 找：任务记录里只存 provider 名（`host-comfyui:<name>`），
 * 不存 baseUrl（那是部署配置，写进任务会让换机后的历史任务指向错的机器）。
 * 预览帧是内存里的瞬时数据、promptId 全局唯一（ComfyUI 的 uuid），所以扫一遍实例表即可；
 * 实例数是个位数。
 */
export function findComfyPreview(
  promptId: string,
): { bytes: Uint8Array; mime: string; seq: number } | null {
  for (const tracker of trackers.values()) {
    const found = tracker.preview(promptId);
    if (found !== null) return found;
  }
  return null;
}
