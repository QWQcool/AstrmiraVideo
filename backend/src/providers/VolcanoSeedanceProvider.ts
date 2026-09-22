import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { TaskProgress, VideoGenerateRequest, VideoProvider } from '@astrmira/shared';
import { ProviderFailureError } from '../errors.js';
import {
  SEEDANCE_DEFAULT_BASE_URL,
  SEEDANCE_DEFAULT_MODEL,
  SEEDANCE_TASKS_PATH,
  buildSeedanceSubmitBody,
  classifyHttpFailure,
  parseSeedanceTask,
  readUpstreamTaskId,
} from './seedanceProtocol.js';
import type { SeedanceImageRole } from './seedanceProtocol.js';

/**
 * 云端轨：火山方舟 Seedance（BYOK）。
 *
 * ## 凭据模型（PLAN §6-D23 · B 方案，用户裁定）
 * Key **只从构造参数进来**：调度器按任务从 `security/keyVault` 取出后注入。
 * 本类**不得**读取任何模块级变量 / env / 全局缓存来"顺手拿到" Key ——
 * 那会把"零留存"变成立刻失效的口号。
 *
 * ## 无凭据时的两条分支（都必须显式，不许静默）
 * - `submit()` 时无 Key → `KEY_MISSING`（terminal）：根本还没提交，谈不上不确定；
 * - `queryStatus()` 时无 Key → `UNCERTAIN_RESULT`：**已经提交过了**，只是无法确认结果
 *   （进程重启会丢掉 vault 里的一切，这是 B 方案的已知代价）→ 必须人工核对，禁止自动重提。
 *
 * ## 成片落地
 * 上游给的是**有时效的临时地址**（官方口径 24h 内），因此成功后立刻流式下载到 `outputs/`，
 * 对外只暴露 `/media/<我们的 taskId>.mp4`（同源直链，浏览器原生 Range）。
 * 这样刷新页面、隔天回看画廊都不会遇到"上游链接过期"。
 */
export interface VolcanoSeedanceOptions {
  /** 本任务自己的 taskId（落盘文件名与 `/media/` 直链都以它为准） */
  taskId: string;
  /** B 方案注入的凭据；`null` = 本次调用没有凭据 */
  providerKey: string | null;
  model?: string;
  baseUrl?: string;
  /** 资产 id → 上游可访问地址（公网 URL 或 data URL） */
  resolveAssetUrl?: (assetId: string) => Promise<string | null>;
  fetchImpl?: typeof fetch;
  outputDir?: string;
  /** 单次 HTTP 请求超时（默认 30s）；轮询间隔由调度器控制，不在这里 */
  requestTimeoutMs?: number;
}

/** 上游模型名的兜底：env（部署者配置）→ 协议层常量。测试可显式传 `model` 覆盖。 */
function resolveDefaultModel(): string {
  const fromEnv = process.env.VOLCANO_MODEL_NAME?.trim();
  return fromEnv === undefined || fromEnv === '' ? SEEDANCE_DEFAULT_MODEL : fromEnv;
}

export class VolcanoSeedanceProvider implements VideoProvider {
  readonly id = 'cloud-volcano-seedance' as const;
  readonly name = '火山方舟 Seedance（BYOK）';

  private readonly taskId: string;
  private readonly providerKey: string | null;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly outputDir: string;
  private readonly requestTimeoutMs: number;
  private readonly resolveAssetUrl: (assetId: string) => Promise<string | null>;

  /** 上游 taskId → 请求快照（用于把 `TaskProgress.requestSnapshot` 填成真值，而不是编一个） */
  private readonly requests = new Map<string, VideoGenerateRequest>();

  constructor(options: VolcanoSeedanceOptions) {
    this.taskId = options.taskId;
    this.providerKey = options.providerKey;
    this.model = (options.model ?? resolveDefaultModel()).trim();
    this.baseUrl = (options.baseUrl ?? SEEDANCE_DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.outputDir = options.outputDir ?? path.resolve(process.cwd(), 'outputs');
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.resolveAssetUrl =
      options.resolveAssetUrl ?? (async () => null);
  }

  /**
   * 引擎级健康检查：只回答"本服务是否具备调用该上游的配置"。
   * **凭据缺失不算引擎不可用** —— 凭据是"每次请求"的事，缺失由 `submit()` 报 `KEY_MISSING`，
   * 报成 `PROVIDER_UNAVAILABLE` 会把用户引向错误的方向（去查服务配置而不是去填 Key）。
   */
  async checkHealth(): Promise<{ available: boolean; reason?: string }> {
    if (this.model === '') {
      return { available: false, reason: '未配置上游模型名（BYOK 抽屉或环境变量 SEEDANCE_MODEL）' };
    }
    return { available: true };
  }

  async submit(request: VideoGenerateRequest): Promise<{ taskId: string }> {
    if (this.providerKey === null) {
      throw new ProviderFailureError(
        'KEY_MISSING',
        '缺少凭据：请求未携带 X-Provider-Key，服务端也未配置兜底 Key（可在 BYOK 抽屉填写）',
      );
    }

    const imageUrls = await this.collectImageUrls(request);

    const body = buildSeedanceSubmitBody(request, {
      model: this.model,
      imageUrls,
      resolutionOverride: readStringOption(request, 'seedanceResolution'),
      watermark: readBooleanOption(request, 'seedanceWatermark'),
    });

    const response = await this.request(SEEDANCE_TASKS_PATH, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    // 提交成功却读不到 id：**不能**当成功继续（否则后面无从轮询，反而更难查）
    const payload = await this.readJson(response, '提交任务');
    const upstreamTaskId = readUpstreamTaskId(payload);
    if (upstreamTaskId === undefined) {
      throw new ProviderFailureError(
        'UPSTREAM_ERROR',
        '上游接受了提交但响应中没有任务 id（协议字段可能已变更，见 providers/seedanceProtocol.ts）',
      );
    }

    this.requests.set(upstreamTaskId, request);
    return { taskId: upstreamTaskId };
  }

  async queryStatus(upstreamTaskId: string): Promise<TaskProgress> {
    if (this.providerKey === null) {
      // 已提交但查不了 → 结果不明（**绝不能**降级成"失败"或"可重试"）
      throw new ProviderFailureError(
        'UNCERTAIN_RESULT',
        '凭据已不可用（进程重启会清空内存中的 BYOK Key），无法向上游确认该任务结果',
      );
    }

    const response = await this.request(`${SEEDANCE_TASKS_PATH}/${encodeURIComponent(upstreamTaskId)}`, {
      method: 'GET',
    });

    const payload = await this.readJson(response, '查询任务');
    const parsed = parseSeedanceTask(payload);

    const request = this.requests.get(upstreamTaskId);
    const snapshot: VideoGenerateRequest = request ?? {
      // 走到这里说明进程重启过：请求快照只存在于上游侧，我们手里没有。
      // 这里给一个**空壳**仅为了满足契约形状，绝不伪造用户参数；
      // 该分支只可能出现在"重启后人工核对"的场景，任务本身已归 uncertain。
      prompt: '',
      mode: 't2v',
      aspectRatio: '16:9',
      provider: 'cloud-volcano-seedance',
    };

    if (parsed.status === 'succeeded' && parsed.videoUrl !== undefined) {
      const localUrl = await this.downloadToOutputs(parsed.videoUrl);
      return {
        taskId: upstreamTaskId,
        status: 'succeeded',
        progressPercent: 100,
        requestSnapshot: snapshot,
        outputVideoUrl: localUrl,
        message: parsed.message ?? '上游生成完成',
      };
    }

    return {
      taskId: upstreamTaskId,
      status: parsed.status,
      progressPercent: parsed.progressPercent,
      requestSnapshot: snapshot,
      ...(parsed.message === undefined ? {} : { message: parsed.message }),
      ...(parsed.error === undefined ? {} : { error: parsed.error }),
    };
  }

  async cancel(upstreamTaskId: string): Promise<boolean> {
    if (this.providerKey === null) return false;

    try {
      const response = await this.request(
        `${SEEDANCE_TASKS_PATH}/${encodeURIComponent(upstreamTaskId)}`,
        { method: 'DELETE' },
      );
      return response.ok || response.status === 404;
    } catch {
      // 取消失败不改写任务状态：由调度器按轮询结果决定终态
      return false;
    }
  }

  // ── 内部实现 ───────────────────────────────────────────────────────────────

  /** 资产 → 上游可访问地址；解析不出来就**显式报错**（不静默丢掉参考图，那会产出完全不同的视频） */
  private async collectImageUrls(
    request: VideoGenerateRequest,
  ): Promise<Partial<Record<SeedanceImageRole, string>>> {
    const mapping: Array<[SeedanceImageRole, string | undefined]> = [
      ['first_frame', request.assets?.firstFrameImage],
      ['last_frame', request.assets?.lastFrameImage],
      ['reference_image', request.assets?.referenceVideo],
    ];

    const resolved: Partial<Record<SeedanceImageRole, string>> = {};
    for (const [role, assetId] of mapping) {
      if (assetId === undefined) continue;

      const url = await this.resolveAssetUrl(assetId);
      if (url === null) {
        throw new ProviderFailureError(
          'INVALID_ASSET',
          `参考资产 ${assetId} 无法解析为上游可访问地址（资产可能已被清理）`,
        );
      }
      resolved[role] = url;
    }
    return resolved;
  }

  private async request(pathname: string, init: { method: string; body?: string }): Promise<Response> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.providerKey ?? ''}`,
    };
    if (init.body !== undefined) headers['content-type'] = 'application/json';

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
        method: init.method,
        headers,
        ...(init.body === undefined ? {} : { body: init.body }),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (err) {
      // 网络层失败（超时 / 断连 / DNS）：**不在这里归类** ——
      // 交给 resolveTaskError 按"是否已进入提交阶段"决定 UPSTREAM_ERROR 还是 UNCERTAIN_RESULT。
      throw new Error(`上游请求失败（${init.method} ${pathname}）：${(err as Error).message}`);
    }

    if (!response.ok) {
      const payload = await this.readJsonQuietly(response);
      const classified = classifyHttpFailure(response.status, payload);
      throw new ProviderFailureError(classified.code, classified.message, classified.dispositionOverride);
    }

    return response;
  }

  private async readJson(response: Response, action: string): Promise<unknown> {
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new Error(`${action}：上游返回的不是合法 JSON（响应不可解析，结果无法确认）`);
    }
  }

  private async readJsonQuietly(response: Response): Promise<unknown> {
    try {
      return (await response.json()) as unknown;
    } catch {
      return undefined;
    }
  }

  /**
   * 流式下载到 `outputs/<我们的 taskId>.mp4`，返回同源直链 `/media/...`。
   * 磁盘满（ENOSPC）→ `DISK_FULL`（terminal），与 CONTRACT §6 一致。
   */
  private async downloadToOutputs(remoteUrl: string): Promise<string> {
    const fileName = `${this.taskId}.mp4`;
    const target = path.join(this.outputDir, fileName);

    await mkdir(this.outputDir, { recursive: true });

    let response: Response;
    try {
      response = await this.fetchImpl(remoteUrl, { signal: AbortSignal.timeout(this.requestTimeoutMs) });
    } catch (err) {
      throw new ProviderFailureError(
        'UPSTREAM_ERROR',
        `成片下载失败（上游地址不可达）：${(err as Error).message}`,
      );
    }

    if (!response.ok || response.body === null) {
      throw new ProviderFailureError(
        'UPSTREAM_ERROR',
        `成片下载失败：HTTP ${response.status}（上游临时地址可能已过期）`,
      );
    }

    try {
      // `response.body` 在这里一定是 Web ReadableStream（undici 实现）；
      // 一次性断言掉类型差异，避免把整个文件拖进 DOM/Node 两套流的类型纠缠里。
      await pipeline(Readable.fromWeb(response.body as never), createWriteStream(target));
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'ENOSPC') {
        throw new ProviderFailureError('DISK_FULL', '输出目录磁盘空间不足，成片写入失败');
      }
      throw new ProviderFailureError('UPSTREAM_ERROR', `成片写入失败：${(err as Error).message}`);
    }

    return `/media/${fileName}`;
  }
}

/** 仅供测试：构造一个"无凭据"的实例（模拟进程重启后 vault 已空） */
export function createSeedanceWithoutKey(
  options: Omit<VolcanoSeedanceOptions, 'providerKey' | 'taskId'> = {},
): VolcanoSeedanceProvider {
  return new VolcanoSeedanceProvider({ ...options, providerKey: null, taskId: randomUUID() });
}

function readStringOption(request: VideoGenerateRequest, key: string): string | undefined {
  const value = request.options?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function readBooleanOption(request: VideoGenerateRequest, key: string): boolean | undefined {
  const value = request.options?.[key];
  return typeof value === 'boolean' ? value : undefined;
}
