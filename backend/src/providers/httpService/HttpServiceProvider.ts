import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  parseTaskRef,
  type ErrorCode,
  type ErrorDisposition,
  type ProviderType,
  type TaskProgress,
  type VideoGenerateRequest,
  type VideoProvider,
} from '@astrmira/shared';
import { createTaskError, ProviderFailureError } from '../../errors.js';
import type { TaskVideoResolution } from '../../store/assets.js';
import type { HttpServiceEntry } from './httpServiceProfile.js';

/**
 * 配置型 HTTP 任务服务（CONTRACT §22 / V2.47）。
 *
 * 它只做“把请求按配置发出去、按 id 轮询、把产物落盘”这三件事；
 * 不做 GPU 进程管理、不做模型下载、不编造进度。
 * 提交回执 / uncertain 恢复留给 S4-R2（见 docs/INFOS-REVIEW.md）。
 */

export interface HttpServiceProviderOptions {
  id: ProviderType;
  name: string;
  profile: HttpServiceEntry;
  outputDir: string;
  /** 本仓 taskId：作为幂等键发给上游（不另生成键） */
  taskId: string;
  fetchImpl?: typeof fetch;
  resolveAssetUrl?: (assetId: string) => Promise<string | null>;
  resolveTaskVideoUrl?: (taskId: string) => Promise<TaskVideoResolution>;
}

interface JobRecord {
  request: VideoGenerateRequest;
  createdAt: number;
  delivered?: { kind: 'image' | 'video'; url: string };
}

const MAX_MEDIA_BYTES = 256 * 1024 * 1024;
const MAX_ASSET_BYTES = 100 * 1024 * 1024;
const PROBE_TIMEOUT_MS = 8_000;

/** 点路径读取；拒绝原型链键。空路径返回原值（整个响应体）。 */
export function readPath(value: unknown, pathSpec: string): unknown {
  if (pathSpec === '') return value;
  return pathSpec.split('.').reduce<unknown>((current, key) => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) {
      throw new Error('字段路径无效');
    }
    return current !== null && typeof current === 'object'
      ? (current as Record<string, unknown>)[key]
      : undefined;
  }, value);
}

/** 点路径写入；拒绝原型链键。 */
export function assignPath(target: Record<string, unknown>, pathSpec: string, value: unknown): void {
  const keys = pathSpec.split('.');
  if (keys.some((key) => key === '' || ['__proto__', 'constructor', 'prototype'].includes(key))) {
    throw new Error('请求字段路径无效');
  }
  let current = target;
  for (const key of keys.slice(0, -1)) {
    if (current[key] === undefined) current[key] = {};
    if (current[key] === null || typeof current[key] !== 'object') {
      throw new Error('请求字段路径冲突');
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys.at(-1)!] = value;
}

function requestInputs(request: VideoGenerateRequest): Record<string, unknown> {
  return {
    prompt: request.prompt,
    mode: request.mode,
    aspectRatio: request.aspectRatio,
    width: request.resolution?.width,
    height: request.resolution?.height,
    durationSec: request.params?.durationSec,
    frames: request.params?.frames,
    steps: request.params?.steps,
    seed: request.params?.seed,
    assets: request.assets,
    firstFrameImage: request.assets?.firstFrameImage,
    lastFrameImage: request.assets?.lastFrameImage,
    referenceVideo: request.assets?.referenceVideo,
    options: request.options,
  };
}

function extensionOf(contentType: string, kind: 'image' | 'video'): string {
  if (kind === 'video') return '.mp4';
  if (contentType.includes('jpeg')) return '.jpg';
  if (contentType.includes('webp')) return '.webp';
  return '.png';
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || randomUUID();
}

export class HttpServiceProvider implements VideoProvider {
  readonly id: ProviderType;
  readonly name: string;

  private readonly profile: HttpServiceEntry;
  private readonly outputDir: string;
  private readonly taskId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly resolveAssetUrl?: (assetId: string) => Promise<string | null>;
  private readonly resolveTaskVideoUrl?: (taskId: string) => Promise<TaskVideoResolution>;
  private readonly token?: string;
  private readonly jobs = new Map<string, JobRecord>();

  constructor(options: HttpServiceProviderOptions) {
    this.id = options.id;
    this.name = options.name;
    this.profile = options.profile;
    this.outputDir = options.outputDir;
    this.taskId = options.taskId;
    this.fetchImpl = options.fetchImpl ?? fetch;
    if (options.resolveAssetUrl !== undefined) this.resolveAssetUrl = options.resolveAssetUrl;
    if (options.resolveTaskVideoUrl !== undefined) {
      this.resolveTaskVideoUrl = options.resolveTaskVideoUrl;
    }
    if (options.profile.tokenEnv !== undefined) {
      this.token = process.env[options.profile.tokenEnv]?.trim();
    }
  }

  async checkHealth(): Promise<{ available: boolean; reason?: string }> {
    if (this.profile.health === undefined) {
      return { available: true };
    }
    try {
      const response = await this.fetchImpl(this.serviceUrl(this.profile.health.path), {
        method: 'GET',
        headers: this.authHeaders(),
        redirect: 'error',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      await response.body?.cancel();
      return response.ok
        ? { available: true }
        : { available: false, reason: `健康检查返回 HTTP ${response.status}` };
    } catch {
      return { available: false, reason: '健康检查请求失败（服务未启动或网络不通）' };
    }
  }

  async submit(request: VideoGenerateRequest): Promise<{ taskId: string }> {
    if (!this.profile.modes.includes(request.mode)) {
      throw new ProviderFailureError(
        'PROVIDER_UNAVAILABLE',
        `该 HTTP 服务未声明支持 ${request.mode} 模式（已声明：${this.profile.modes.join('、')}）`,
      );
    }

    const inputs = requestInputs(request);
    const body = structuredClone(this.profile.submit.body) as Record<string, unknown>;
    const form = this.profile.submit.bodyFormat === 'multipart' ? new FormData() : undefined;
    if (form !== undefined) {
      for (const [key, value] of Object.entries(body)) {
        form.append(key, typeof value === 'string' ? value : JSON.stringify(value));
      }
    }

    let uploadedBytes = 0;
    for (const [destination, mapping] of Object.entries(this.profile.submit.fields)) {
      const raw = readPath(inputs, mapping.from);
      if (raw === undefined || raw === null || raw === '') continue;
      if (mapping.format === 'file') {
        if (form === undefined) {
          throw new ProviderFailureError('INVALID_REQUEST', 'file 字段需要 multipart 请求');
        }
        const source = await this.loadSource(raw.toString());
        uploadedBytes += source.bytes.byteLength;
        if (uploadedBytes > MAX_ASSET_BYTES) {
          throw new ProviderFailureError('INVALID_ASSET', '提交素材超过 100 MB 上限');
        }
        form.append(
          destination,
          new Blob([new Uint8Array(source.bytes)], { type: source.contentType }),
          `${safeName(destination)}${extensionOf(
            source.contentType,
            source.contentType.startsWith('video/') ? 'video' : 'image',
          )}`,
        );
        continue;
      }
      if (mapping.format === 'data_url') {
        const source = await this.loadSource(raw.toString());
        uploadedBytes += source.bytes.byteLength;
        if (uploadedBytes > MAX_ASSET_BYTES) {
          throw new ProviderFailureError('INVALID_ASSET', '提交素材超过 100 MB 上限');
        }
        const dataUrl = `data:${source.contentType};base64,${source.bytes.toString('base64')}`;
        if (form !== undefined) form.append(destination, dataUrl);
        else assignPath(body, destination, dataUrl);
        continue;
      }
      const value = mapping.format === 'text' ? String(raw) : raw;
      if (form !== undefined) form.append(destination, typeof value === 'string' ? value : JSON.stringify(value));
      else assignPath(body, destination, value);
    }

    const url = this.serviceUrl(this.profile.submit.path);
    const headers = new Headers(this.profile.headers);
    if (this.token !== undefined && this.token !== '') {
      headers.set(this.profile.authHeader, `${this.profile.authPrefix}${this.token}`);
    }
    if (this.profile.idempotencyHeader !== undefined) {
      headers.set(this.profile.idempotencyHeader, this.taskId);
    }
    if (form === undefined) headers.set('content-type', 'application/json');
    // FormData 必须让 fetch 自己带 boundary；配置里的 content-type 不能盖掉它
    else headers.delete('content-type');

    const response = await this.fetchWithTimeout(url, {
      method: this.profile.submit.method,
      headers,
      ...(form === undefined ? { body: JSON.stringify(body) } : { body: form }),
    });
    if (!response.ok) await this.throwUpstream(response);

    const payload = await this.readJsonOrBytes(response);
    const job: JobRecord = { request, createdAt: Date.now() };

    if (this.profile.submit.taskIdField !== undefined) {
      const remoteId = readPath(payload.json, this.profile.submit.taskIdField);
      if (typeof remoteId !== 'string' || remoteId === '') {
        throw new ProviderFailureError(
          'UNCERTAIN_RESULT',
          '上游没有返回任务 ID：请求可能已提交，请先核验远程任务，不要直接重提',
        );
      }
      // dispatcher 之后用**上游 id** 调 queryStatus；job 必须按它索引，
      // 否则会丢 requestSnapshot/createdAt（超时判断与 t2i 产物选择都要它们）。
      this.jobs.set(remoteId, job);
      this.jobs.set(this.taskId, job);
      return { taskId: remoteId };
    }

    // 同步服务：submit 响应就是结果
    const delivered = await this.saveOutputs(payload, request, this.taskId);
    job.delivered = delivered;
    this.jobs.set(this.taskId, job);
    return { taskId: this.taskId };
  }

  async queryStatus(taskId: string): Promise<TaskProgress> {
    const job = this.jobs.get(taskId);
    const createdAt = job?.createdAt ?? Date.now();
    const requestSnapshot = job?.request ?? {
      prompt: '',
      mode: 't2v' as const,
      aspectRatio: '16:9' as const,
      provider: this.id,
    };

    if (job?.delivered !== undefined) {
      return this.succeeded(taskId, requestSnapshot, createdAt, job.delivered);
    }
    if (this.profile.poll === undefined) {
      return this.failed(
        taskId,
        requestSnapshot,
        createdAt,
        '同步服务没有返回可用的产物',
        'UPSTREAM_ERROR',
        'terminal',
      );
    }

    if (Date.now() - createdAt > this.profile.timeoutMs) {
      return {
        ...this.base(taskId, requestSnapshot, createdAt),
        status: 'failed',
        error: createTaskError(
          'UNCERTAIN_RESULT',
          '远程任务超过 timeoutMs 仍未完成：任务可能仍在运行，请先核验远程状态',
        ),
        message: '远程服务超时，未自动重提',
      };
    }

    const poll = this.profile.poll;
    const url = this.serviceUrl(poll.path.replaceAll('{id}', encodeURIComponent(taskId)));
    let response: Response;
    try {
      response = await this.fetchWithTimeout(url, {
        method: poll.method,
        headers: this.authHeaders(),
      });
    } catch {
      return this.running(taskId, requestSnapshot, createdAt, '远程查询暂时失败，任务保留，稍后自动重试');
    }

    if (response.status === 404) {
      return this.failed(taskId, requestSnapshot, createdAt, '远程服务找不到这条任务', 'TASK_NOT_FOUND');
    }
    if (response.status === 401 || response.status === 403) {
      return this.failed(
        taskId,
        requestSnapshot,
        createdAt,
        '远程服务拒绝凭据（请检查 tokenEnv）',
        'KEY_INVALID',
      );
    }
    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      return this.running(taskId, requestSnapshot, createdAt, '远程服务暂时不可用，任务保留，稍后自动重试');
    }
    if (!response.ok) {
      await response.body?.cancel();
      return this.failed(
        taskId,
        requestSnapshot,
        createdAt,
        `远程查询返回 HTTP ${response.status}`,
        'UPSTREAM_ERROR',
        'terminal',
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return this.running(taskId, requestSnapshot, createdAt, '远程响应不是合法 JSON，任务保留，稍后重试');
    }

    const state = readPath(payload, poll.stateField);
    const stateText = typeof state === 'string' ? state : String(state ?? '');
    if (poll.failed.includes(stateText)) {
      return this.failed(
        taskId,
        requestSnapshot,
        createdAt,
        `远程任务失败（状态：${stateText}）`,
        'UPSTREAM_ERROR',
        'terminal',
      );
    }
    if (!poll.success.includes(stateText)) {
      return this.running(taskId, requestSnapshot, createdAt, `远程任务状态：${stateText}`);
    }

    const delivered = await this.saveOutputs(
      { json: payload, bytes: undefined, contentType: '' },
      requestSnapshot as VideoGenerateRequest,
      taskId,
    );
    if (job !== undefined) job.delivered = delivered;
    return this.succeeded(taskId, requestSnapshot, createdAt, delivered);
  }

  async cancel(taskId: string): Promise<boolean> {
    if (this.profile.cancel === undefined) return false;
    try {
      const response = await this.fetchWithTimeout(
        this.serviceUrl(this.profile.cancel.path.replaceAll('{id}', encodeURIComponent(taskId))),
        { method: this.profile.cancel.method, headers: this.authHeaders() },
      );
      await response.body?.cancel();
      return response.ok;
    } catch {
      return false;
    }
  }

  private serviceUrl(pathSpec: string): string {
    const base = new URL(this.profile.baseUrl.endsWith('/') ? this.profile.baseUrl : `${this.profile.baseUrl}/`);
    const url = new URL(pathSpec, base);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== base.origin ||
      url.username !== '' ||
      url.password !== ''
    ) {
      throw new ProviderFailureError('PROVIDER_UNAVAILABLE', '请求地址必须属于已配置的服务');
    }
    return url.toString();
  }

  private authHeaders(): Headers {
    const headers = new Headers(this.profile.headers);
    if (this.token !== undefined && this.token !== '') {
      headers.set(this.profile.authHeader, `${this.profile.authPrefix}${this.token}`);
    }
    return headers;
  }

  private fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    return this.fetchImpl(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(this.profile.requestTimeoutMs),
    });
  }

  private async throwUpstream(response: Response): Promise<never> {
    const text = (await response.text().catch(() => '')).slice(0, 300);
    const redacted = this.token ? text.replaceAll(this.token, '***') : text;
    const detail = redacted === '' ? '' : `：${redacted}`;
    if (response.status === 401 || response.status === 403) {
      throw new ProviderFailureError('KEY_INVALID', `远程服务拒绝凭据（HTTP ${response.status}）${detail}`);
    }
    if (response.status === 429) {
      throw new ProviderFailureError('RATE_LIMITED', `远程服务限流（HTTP 429）${detail}`);
    }
    if (response.status === 408 || response.status === 425 || response.status >= 500) {
      throw new ProviderFailureError('UPSTREAM_ERROR', `远程服务暂时不可用（HTTP ${response.status}）${detail}`);
    }
    throw new ProviderFailureError(
      'UPSTREAM_ERROR',
      `远程服务拒绝请求（HTTP ${response.status}）${detail}`,
      'terminal',
    );
  }

  private async readJsonOrBytes(
    response: Response,
  ): Promise<{ json?: unknown; bytes?: Buffer; contentType: string }> {
    const contentType = response.headers.get('content-type') ?? '';
    const wantsJson =
      contentType.includes('json') ||
      this.profile.submit.taskIdField !== undefined ||
      Object.values(this.profile.outputs).some((output) => output.path !== '');
    if (!wantsJson) {
      return { bytes: await this.readBounded(response, MAX_MEDIA_BYTES), contentType };
    }
    const text = (await this.readBounded(response, 24 * 1024 * 1024)).toString('utf8');
    try {
      return { json: JSON.parse(text) as unknown, contentType };
    } catch {
      throw new ProviderFailureError('UPSTREAM_ERROR', '远程服务返回的不是合法 JSON', 'terminal');
    }
  }

  private async saveOutputs(
    payload: { json?: unknown; bytes?: Buffer; contentType: string },
    request: VideoGenerateRequest,
    taskId: string,
  ): Promise<{ kind: 'image' | 'video'; url: string }> {
    const desired: 'image' | 'video' = request.mode === 't2i' ? 'image' : 'video';
    const entries = Object.entries(this.profile.outputs);
    const ordered = [
      ...entries.filter(([, output]) => output.kind === desired),
      ...entries.filter(([, output]) => output.kind !== desired),
    ];

    for (const [, output] of ordered) {
      const value =
        output.path === ''
          ? undefined
          : readPath(payload.json, output.path);
      if (output.path === '') {
        if (payload.bytes === undefined) continue;
        return this.saveMedia(payload.bytes, payload.contentType, output.kind, taskId);
      }
      if (typeof value !== 'string' || value === '') continue;
      return this.saveRemoteMedia(value, output.kind, taskId);
    }
    throw new ProviderFailureError('UPSTREAM_ERROR', '远程任务完成但没有可用的图片/视频产物', 'terminal');
  }

  private async saveRemoteMedia(
    value: string,
    kind: 'image' | 'video',
    taskId: string,
  ): Promise<{ kind: 'image' | 'video'; url: string }> {
    if (value.startsWith('data:')) {
      const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(value);
      if (match === null) {
        throw new ProviderFailureError('UPSTREAM_ERROR', '远程产物 data URL 格式无效', 'terminal');
      }
      const contentType = match[1] ?? (kind === 'video' ? 'video/mp4' : 'image/png');
      const bytes = match[2] === ';base64'
        ? Buffer.from(match[3]!, 'base64')
        : Buffer.from(decodeURIComponent(match[3]!), 'utf8');
      if (bytes.byteLength > MAX_MEDIA_BYTES) {
        throw new ProviderFailureError('UPSTREAM_ERROR', '远程产物超过 256 MB 上限', 'terminal');
      }
      return this.saveMedia(bytes, contentType, kind, taskId);
    }

    const base = new URL(this.profile.baseUrl.endsWith('/') ? this.profile.baseUrl : `${this.profile.baseUrl}/`);
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new ProviderFailureError('UPSTREAM_ERROR', '远程产物地址不是 http/https', 'terminal');
    }
    const response = await this.fetchImpl(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(this.profile.requestTimeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProviderFailureError('UPSTREAM_ERROR', `下载远程产物失败（HTTP ${response.status}）`);
    }
    const bytes = await this.readBounded(response, MAX_MEDIA_BYTES);
    return this.saveMedia(
      bytes,
      response.headers.get('content-type') ?? (kind === 'video' ? 'video/mp4' : 'image/png'),
      kind,
      taskId,
    );
  }

  private async saveMedia(
    bytes: Buffer,
    contentType: string,
    kind: 'image' | 'video',
    taskId: string,
  ): Promise<{ kind: 'image' | 'video'; url: string }> {
    const filename = `${safeName(taskId)}${extensionOf(contentType, kind)}`;
    await mkdir(this.outputDir, { recursive: true });
    await writeFile(path.join(this.outputDir, filename), bytes);
    return { kind, url: `/media/${filename}` };
  }

  private async loadSource(source: string): Promise<{ bytes: Buffer; contentType: string }> {
    let url: string | null = null;
    if (source.startsWith('task:')) {
      const taskId = parseTaskRef(source);
      if (taskId === null || this.resolveTaskVideoUrl === undefined) {
        throw new ProviderFailureError('INVALID_ASSET', '无法解析 task: 参考视频');
      }
      const resolved = await this.resolveTaskVideoUrl(taskId);
      if (!resolved.ok) {
        throw new ProviderFailureError('INVALID_ASSET', '参考任务的产物不可用');
      }
      url = resolved.url;
    } else {
      url = this.resolveAssetUrl === undefined ? null : await this.resolveAssetUrl(source);
    }
    if (url === null) {
      throw new ProviderFailureError('INVALID_ASSET', '素材地址不可用');
    }

    const response = await this.fetchImpl(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProviderFailureError('INVALID_ASSET', `读取素材失败（HTTP ${response.status}）`);
    }
    const bytes = await this.readBounded(response, MAX_MEDIA_BYTES);
    if (bytes.byteLength > MAX_ASSET_BYTES) {
      throw new ProviderFailureError('INVALID_ASSET', '单份素材超过 100 MB 上限');
    }
    return {
      bytes,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  private async readBounded(response: Response, maximum: number): Promise<Buffer> {
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > maximum) {
      await response.body?.cancel();
      throw new ProviderFailureError('UPSTREAM_ERROR', `响应超过 ${maximum} 字节上限`, 'terminal');
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > maximum) {
      throw new ProviderFailureError('UPSTREAM_ERROR', `响应超过 ${maximum} 字节上限`, 'terminal');
    }
    return bytes;
  }

  private base(taskId: string, requestSnapshot: VideoGenerateRequest, createdAt: number): TaskProgress {
    return { taskId, status: 'running', progressPercent: 0, requestSnapshot, createdAt };
  }

  private running(
    taskId: string,
    requestSnapshot: VideoGenerateRequest,
    createdAt: number,
    message: string,
  ): TaskProgress {
    return { ...this.base(taskId, requestSnapshot, createdAt), status: 'running', message };
  }

  private failed(
    taskId: string,
    requestSnapshot: VideoGenerateRequest,
    createdAt: number,
    message: string,
    code: ErrorCode = 'UPSTREAM_ERROR',
    disposition?: ErrorDisposition,
  ): TaskProgress {
    const error =
      code === 'UPSTREAM_ERROR'
        ? {
            code,
            message,
            // 明确 4xx 的失败不该被调度器当“可重试”；默认保留既有 UPSTREAM_ERROR 语义
            disposition: disposition ?? 'retryable',
          }
        : createTaskError(code, message);
    return {
      ...this.base(taskId, requestSnapshot, createdAt),
      status: 'failed',
      error,
    };
  }

  private succeeded(
    taskId: string,
    requestSnapshot: VideoGenerateRequest,
    createdAt: number,
    delivered: { kind: 'image' | 'video'; url: string },
  ): TaskProgress {
    return {
      ...this.base(taskId, requestSnapshot, createdAt),
      status: 'succeeded',
      progressPercent: 100,
      ...(delivered.kind === 'image'
        ? { outputImageUrl: delivered.url }
        : { outputVideoUrl: delivered.url }),
      message: '远程 HTTP 服务已完成',
    };
  }
}
