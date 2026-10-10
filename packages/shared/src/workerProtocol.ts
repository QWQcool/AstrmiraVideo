import { z } from 'zod';
import { AspectRatioSchema, DurationSecSchema, GenerationModeSchema } from './request.js';

/**
 * 本地 worker 协议 `astrmira-worker/v1`（台账 A1 片 A / B1；口径见 PLAN §6-D26 与 §6-D49）。
 *
 * ## 它是什么
 * **用户自己机器上的一个本地 HTTP 服务**：浏览器**直连**它（服务端不参与调度），
 * 于是"数据不出域"对**推理**也成立（云端 BYOK 下提示词与参考图仍会发到上游 —— 那是 D49 的由来）。
 *
 * ## 为什么协议要先于实现（片 A 的意义）
 * 协议是**两端共同签的字**：worker 作者（可能是用户自己、或我们将来发的装机包）按它实现，
 * 浏览器适配器按它调用。先把它写进契约，双方才能各自开发、各自被测试 ——
 * 而**假 worker**（测试里起一个实现协议的本地服务）让适配器在**没有真机**的情况下也能被完整验证。
 *
 * ## 边界（片 A 如实不做）
 * 1. **不做"结果回传归档"**：片 A 的产物由**浏览器收下**（下载 / 预览）；
 *    把它登记成系统里的一条任务需要服务端入口（新路由 + 契约），与真机验证一起做（片 B/C）。
 * 2. **不做凭据**：worker 在用户自己的机器上，它不需要我们的 BYOK Key；
 *    协议里因此没有任何凭据字段（这是与云端轨最大的结构差异）。
 * 3. **不返回硬件型号**：`health` 只报能力位与可执行原因（型号之类由 worker 自己的界面展示 ——
 *    与 D27"硬件细节只给部署者"同一条纪律）。
 */

/** 协议标识（双方握手用；不匹配 = 明确拒绝，不尝试兼容） */
export const WORKER_PROTOCOL_VERSION = 'astrmira-worker/v1';

/**
 * 默认端口 8765（B14 登记的"端口冲突实测"属片 B）：
 * 浏览器直连 `http://127.0.0.1:8765` —— **127.0.0.1 是"潜在可信来源"**，
 * 因此 HTTPS 页面调它不触发混合内容拦截（但 Chrome 的 Private Network Access 预检仍可能拦，见 `workerBlockedReason`）。
 */
export const WORKER_DEFAULT_PORT = 8765;

export const WorkerHealthSchema = z.object({
  protocol: z.literal(WORKER_PROTOCOL_VERSION),
  /** 人话的引擎名（如 `MiniMax H3`）—— 刻意不含型号 / 显存 */
  engine: z.string(),
  available: z.boolean(),
  /** `available: false` 时的**可执行**原因（"模型文件没找到：…"） */
  reason: z.string().optional(),
  /** 正在跑一条（本地单卡互斥是防线 1 的落点，这里只需如实告诉调用方） */
  busy: z.boolean().optional(),
});

export const WorkerJobRequestSchema = z.object({
  prompt: z.string(),
  mode: GenerationModeSchema,
  aspectRatio: AspectRatioSchema,
  durationSec: DurationSecSchema.optional(),
  seed: z.number().int().optional(),
  /**
   * 参考图 / 参考视频：**data URL**（自包含）。
   *
   * 为什么不用本地文件路径：那是"任意文件读取面"（worker 在本机运行，路径遍历能读用户任何文件）。
   * data URL 由浏览器从用户选择的文件读出，worker 不需要碰文件系统。
   */
  firstFrameImage: z.string().optional(),
  referenceVideo: z.string().optional(),
});

export const WorkerJobBalanceSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);

export const WorkerJobStatusSchema = z.object({
  jobId: z.string(),
  status: WorkerJobBalanceSchema,
  progressPercent: z.number().min(0).max(100),
  message: z.string().optional(),
  /** worker 侧的错误（码是 worker 自定的字符串 —— 由适配器映射成契约错误码） */
  error: z.object({ code: z.string(), message: z.string() }).optional(),
  /** 成功时：worker 本地的产物直链（`/v1/jobs/<id>/result`）；浏览器据此下载/预览 */
  resultPath: z.string().optional(),
});

export const WorkerJobCreatedSchema = z.object({ jobId: z.string() });
export const WorkerCancelResultSchema = z.object({ cancelled: z.boolean() });

export type WorkerHealth = z.infer<typeof WorkerHealthSchema>;
export type WorkerJobRequest = z.infer<typeof WorkerJobRequestSchema>;
export type WorkerJobStatus = z.infer<typeof WorkerJobStatusSchema>;

export interface WorkerLinkCheck {
  /** 非 null = **静态阻塞**（页面上就该拦住并给可执行指引，而不是让用户看一条没有解释的失败） */
  blocked: string | null;
  /** 提醒（不阻塞）：可能被 PNA 预检拦 —— 需要在 worker 侧应对 */
  notice: string | null;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === '127.0.0.1' ||
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

/**
 * "这个页面能不能直连这个 worker 地址"的静态判定（**纯函数、不联网**）。
 *
 * 两件真实会拦人的事（D49 已登记为"实测级问题"，片 A 先给**可执行的诊断文案**）：
 * 1. **混合内容**：HTTPS 页面连 `http://` —— 但 **127.0.0.1 是"潜在可信来源"**，
 *    Chromium 系对回环地址放行；而用**局域网 IP**（如 `http://192.168.x.x`）会被直接拦掉。
 *    所以引导必须是"把 worker 地址改成 `http://127.0.0.1:8765`"，而不是"给 worker 配 HTTPS 证书"。
 * 2. **Private Network Access 预检**：Chrome 对"公网页面 → 本地网络"会先发预检，
 *    worker 需要回 `Access-Control-Allow-Private-Network: true`（协议对 worker 的要求），
 *    这里只把它写成提醒（否则用户只会看到一条没有解释的失败）。
 */
export function checkWorkerLink(input: { pageProtocol: string; workerUrl: string }): WorkerLinkCheck {
  const pageIsHttps = input.pageProtocol === 'https:';

  let worker: URL;
  try {
    worker = new URL(input.workerUrl);
  } catch {
    return { blocked: `worker 地址不是合法 URL：${input.workerUrl}`, notice: null };
  }

  if (pageIsHttps && !isLoopbackHost(worker.hostname)) {
    return {
      blocked:
        `当前页面是 HTTPS，而 worker 地址（${worker.origin}）不是回环地址 —— 浏览器会按混合内容把它拦掉。` +
        '把 worker 地址改成 http://127.0.0.1:8765（回环地址是潜在可信来源，不会被拦）。',
      notice: null,
    };
  }

  if (pageIsHttps && isLoopbackHost(worker.hostname)) {
    return {
      blocked: null,
      notice:
        '若浏览器提示"本地网络访问被拦"：这是 Chrome 的 Private Network Access 预检 —— ' +
        'worker 需要在响应里带上 Access-Control-Allow-Private-Network: true。',
    };
  }

  return { blocked: null, notice: null };
}
