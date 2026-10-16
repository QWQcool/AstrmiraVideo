import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  ProviderType,
  TaskProgress,
  VideoGenerateRequest,
  VideoProvider,
} from '@astrmira/shared';
import {
  buildComfyWorkflow,
  comfyCapabilities,
  comfyViewPath,
  COMFYUI_DEFAULT_BASE_URL,
  COMFY_DEFAULT_NEGATIVE,
  COMFY_OUTPUT_SUBDIR,
  describeComfySubmissionError,
  parseComfyOutputs,
  pickComfyModels,
  pickComfyVideoArtifact,
  planComfyDimensions,
  planComfyFrames,
  resolveComfyTuning,
  type ComfyCapabilities,
  type ComfyModels,
  type ComfyTemplateDeclaration,
  type ComfyTuning,
  type WorkflowTemplate,
} from './comfyuiProtocol.js';
import { loadWorkflowTemplate, type LoadedTemplate } from './comfyuiTemplates.js';

/**
 * `host-comfyui` provider（CONTRACT §19；台账 A1 片 B；形态 = 决策 **D53**）。
 *
 * ## 它与云端 provider 的结构性差异
 * ComfyUI **本身就是异步队列**：`POST /prompt` 返回 `prompt_id`，之后它自己排期执行。
 * 所以这里天然是"`submit` 拿 id、`queryStatus` 轮询"的形态 —— 不需要像云端那样自己起轮询。
 * `prompt_id` 直接当 `taskId` 用（本仓调度器只要求"提交返回 id、可按 id 查状态"）。
 *
 * ## 三条如实边界（都来自真机实测，见 PLAN V8.34/V8.35）
 * 1. **进度百分比拿不到**：ComfyUI 的 HTTP 接口不报单任务进度（进度在 WebSocket 上）。
 *    所以 `running` 时 `progressPercent` 恒为 **0**，并用 `message` 讲清楚 ——
 *    **不编造一个会匀速上涨的假进度条**（那正是本仓"不假装可用"的反面）。
 * 2. **取消不支持**：`POST /interrupt` 会让任务**重启**、`POST /queue {delete}` 只清 pending，
 *    真要停下只能重启 ComfyUI。所以 `cancel()` 恒返回 `false`（承认做不到，而不是假装取消成功）。
 * 3. **任务记录会随重启丢失**：`/history` 与队列都在内存里 —— 查不到又有 jobs 记录时，
 *    如实回报"它可能重启过"，而不是含糊的"未知错误"。
 *
 * ## 为什么 fetch 可注入
 * 假 ComfyUI（测试里起一个实现这几个端点的 http 服务，或注入假 fetch）能让这一层的
 * **全部状态机**在没有真机、没有 GPU 的情况下被覆盖 —— 真机只用来验收"参数对不对"。
 */

export interface ComfyUiProviderOptions {
  baseUrl?: string;
  outputDir: string;
  /** provider id（V2.36：具名实例 `host-comfyui:<name>`；缺省 = 默认实例 `host-comfyui`） */
  id?: ProviderType;
  /** 显示名（V2.36：带上实例 label —— 日志与界面里要能分清是**哪一台**） */
  name?: string;
  /**
   * **实例级**模板名（V2.36；缺省 = 全局 `COMFYUI_TEMPLATE`）。
   * 多台引擎可能跑不同模型（= 不同节点图），见 §19-1 / §19-3。
   */
  templateName?: string;
  /** 注入 fetch（测试用；默认全局 fetch） */
  fetchImpl?: typeof fetch;
  /**
   * 档位**显式覆盖**（V2.32）。
   *
   * 默认值来自 `resolveComfyTuning()`（读 env）—— 这里传进来的只用于**覆盖**它，
   * 所以生产路径一个都不用传（换硬件改 env 就够了），测试才好钉住具体数值。
   */
  tuning?: Partial<ComfyTuning>;
  /**
   * 工作流模板**显式注入**（V2.33；测试用）。
   *
   * 生产路径不传 —— 它由 `COMFYUI_TEMPLATE_DIR` / `COMFYUI_TEMPLATE` 决定（见 `comfyuiTemplates.ts`），
   * 那才是"换模型不改代码"的入口。
   */
  template?: WorkflowTemplate;
  /**
   * 模板**声明的能力**（V2.39；与 `template` 配对使用，测试用）。
   *
   * 生产路径不传 —— sidecar `<name>.meta.json` 由 `loadWorkflowTemplate` 读（见 `comfyuiTemplates.ts`）。
   * 这里能传是为了让注入路径与生产路径**能力对等**：否则"声明生效"这条链在单测里覆盖不到。
   */
  declaration?: ComfyTemplateDeclaration;
  /** 产物前缀（`SaveVideo.filename_prefix`）；默认带 `astrmira/` 子目录 */
  outputPrefix?: string;
  /** 资产 id → 可下载地址（i2v 的首帧要先下载再上传给 ComfyUI） */
  resolveAssetUrl?: (assetId: string) => Promise<string | null>;
  /** `/object_info` 的缓存时长（测试可设 0 强制每次重探） */
  inventoryTtlMs?: number;
}

interface JobRecord {
  request: VideoGenerateRequest;
  outputPrefix: string;
  createdAt: number;
  /** 已下载的产物（幂等：queryStatus 被调多次不会重复下载） */
  deliveredUrl?: string;
}

const DEFAULT_INVENTORY_TTL_MS = 10 * 60 * 1000;

/**
 * 探测类请求的硬超时（V2.34）。
 *
 * 为什么必须有：地址可能**连得上但不响应**（端口开着、ComfyUI 卡住），
 * 那种情况下 `fetch` 会一直挂着 —— 而"检测本地引擎"是个用户会盯着看的按钮。
 * 8s 的依据：`/system_stats` 是毫秒级、`/object_info` 约 10MB 在本地读 1s 内（实测）。
 * 注意**只管探测**：提交与取产物是任务路径，由调度器的语义与用户预期决定，不用这个值。
 */
const PROBE_TIMEOUT_MS = 8_000;

export class ComfyUiProvider implements VideoProvider {
  /**
   * V2.36：具名实例时是 `host-comfyui:<name>` —— 任务的 `provider` 字段据此能回答
   * "**这条在哪台机器上跑的**"（追溯 / 成本 / 排错都靠它，见 §1 的 ProviderType 说明）。
   */
  readonly id: ProviderType;
  readonly name: string;

  private readonly baseUrl: string;
  /** 实例级模板名（V2.36；缺省 = 全局 `COMFYUI_TEMPLATE`） */
  private readonly templateName?: string;
  private readonly outputDir: string;
  private readonly fetchImpl: typeof fetch;
  private readonly tuning: ComfyTuning;
  private readonly outputPrefix: string;
  private readonly resolveAssetUrl?: (assetId: string) => Promise<string | null>;
  private readonly inventoryTtlMs: number;

  private inventory: { models: ComfyModels; capabilities: ComfyCapabilities; at: number } | null = null;
  private readonly jobs = new Map<string, JobRecord>();
  private readonly injectedTemplate?: WorkflowTemplate;
  /** 注入路径的模板声明（V2.39；与 `injectedTemplate` 配对） */
  private readonly injectedDeclaration?: ComfyTemplateDeclaration;
  /** 懒加载的工作流模板（配错路径时**每次调用都会抛**，所以不缓存错误态 —— 用户改好即可用） */
  private loadedTemplate: LoadedTemplate | null = null;

  constructor(options: ComfyUiProviderOptions) {
    this.id = options.id ?? 'host-comfyui';
    this.name = options.name ?? '本地 ComfyUI（自备引擎与模型）';
    this.templateName = options.templateName;
    this.baseUrl = (options.baseUrl ?? COMFYUI_DEFAULT_BASE_URL).replace(/\/$/, '');
    this.outputDir = options.outputDir;
    this.fetchImpl = options.fetchImpl ?? fetch;
    // 档位：env（resolveComfyTuning）→ 显式覆盖（测试）。生产路径不传就是 env 说了算 ——
    // "换卡只改 env"这条承诺的落点就在这一行。
    this.tuning = { ...resolveComfyTuning(), ...options.tuning };
    this.outputPrefix = options.outputPrefix ?? `${COMFY_OUTPUT_SUBDIR}/comfy`;
    this.inventoryTtlMs = options.inventoryTtlMs ?? DEFAULT_INVENTORY_TTL_MS;
    if (options.resolveAssetUrl !== undefined) this.resolveAssetUrl = options.resolveAssetUrl;
    if (options.template !== undefined) this.injectedTemplate = options.template;
    if (options.declaration !== undefined) this.injectedDeclaration = options.declaration;
  }

  /**
   * 取工作流模板（懒加载 + 缓存）。
   *
   * **为什么不放在构造函数里**：`COMFYUI_TEMPLATE_DIR` 配错时应当"**提交时报一句人话**"，
   * 而不是让整个服务起不来（其它 provider 还得能用）。错误态刻意不缓存 —— 用户改好路径就该立刻生效。
   */
  private template(): LoadedTemplate {
    if (this.loadedTemplate !== null) return this.loadedTemplate;
    this.loadedTemplate =
      this.injectedTemplate === undefined
        ? loadWorkflowTemplate(process.env, this.templateName)
        : {
            template: this.injectedTemplate,
            source: '注入（测试 / 调用方指定）',
            ...(this.injectedDeclaration === undefined
              ? {}
              : { declaration: this.injectedDeclaration }),
          };
    return this.loadedTemplate;
  }

  // ── 探测与自检 ─────────────────────────────────────────────────────────────

  /**
   * 读 `/object_info`（**很大**，所以缓存）。
   *
   * `force` 用于"用户显式点自检"这种场合：他多半是刚换了模型，
   * 拿 10 分钟前的清单回答他就没意义了（见 `routes/providers.ts` 的 `RefreshableHealth`）。
   */
  private async readInventory(
    force = false,
  ): Promise<{ models: ComfyModels; capabilities: ComfyCapabilities }> {
    const now = Date.now();
    if (!force && this.inventory !== null && now - this.inventory.at < this.inventoryTtlMs) {
      return { models: this.inventory.models, capabilities: this.inventory.capabilities };
    }
    const response = await this.fetchImpl(`${this.baseUrl}/object_info`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`ComfyUI /object_info → HTTP ${response.status}`);
    const objectInfo: unknown = await response.json();
    // V2.39：模板声明（sidecar / 内置）**优先**决定"挑哪个模型文件"与"能做哪些模式" ——
    // 缺声明时才回落文件名启发式（老模板行为一字不变）
    const loaded = this.template();
    const models = pickComfyModels(objectInfo, undefined, loaded.declaration);
    // V2.33：能力位**按当前模板引用的节点**判定（换了模板，缺什么就报什么）
    const capabilities = comfyCapabilities(objectInfo, models, loaded.template, loaded.declaration);
    this.inventory = { models, capabilities, at: now };
    return { models, capabilities };
  }

  async checkHealth(options?: { refresh?: boolean }): Promise<{ available: boolean; reason?: string }> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/system_stats`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!response.ok) {
        return { available: false, reason: `ComfyUI 可达但 /system_stats 返回 HTTP ${response.status}` };
      }
      const { capabilities, models } = await this.readInventory(options?.refresh === true);
      // 模板来源也报出来（V2.33）：出问题时第一件事是搞清"跑的是哪张图"
      const templateSource = this.template().source;
      if (capabilities.modes.length === 0) {
        return {
          available: false,
          reason:
            `ComfyUI 可达但当前不能跑视频：${capabilities.unavailableReasons.join('；')}` +
            `（模板：${templateSource}）`,
        };
      }
      return {
        // 可用，但把"能跑什么 / 不能跑什么"一并说清（界面照实展示，不藏）
        available: true,
        reason:
          `模型：${models.unet} · 模板：${templateSource} · 支持 ${capabilities.modes.join(' / ')}；` +
          `不支持 ${capabilities.unavailableReasons.join('；')}`,
      };
    } catch (error) {
      // 这里可能失败在两处：连不上 ComfyUI，或**模板读不出来**（COMFYUI_TEMPLATE_DIR 配错）——
      // 两种情况都要说清是哪种，所以文案不写死成"连不上"
      return {
        available: false,
        reason: `本地 ComfyUI 不可用（${this.baseUrl}）：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // ── 提交 ───────────────────────────────────────────────────────────────────

  async submit(request: VideoGenerateRequest): Promise<{ taskId: string }> {
    const { models, capabilities } = await this.readInventory();

    if (!capabilities.modes.includes(request.mode)) {
      // **不假装可用**：模式不在能力位里就直说，而不是提交上去等上游 400
      throw new Error(
        `本地 ComfyUI 当前不支持 ${request.mode}（支持：${capabilities.modes.join(' / ')}）。` +
          `原因：${capabilities.unavailableReasons.join('；')}`,
      );
    }

    const dimensions = planComfyDimensions(request, this.tuning.maxPixels);
    const frames = planComfyFrames(request.params?.durationSec, this.tuning.fps);
    const startImageName =
      request.mode === 'i2v' ? await this.uploadFirstFrame(request) : undefined;

    const workflow = buildComfyWorkflow({
      models,
      prompt: request.prompt,
      negativePrompt: readNegativePrompt(request),
      mode: request.mode,
      width: dimensions.width,
      height: dimensions.height,
      frames,
      fps: this.tuning.fps,
      steps: this.tuning.steps,
      cfg: this.tuning.cfg,
      shift: this.tuning.shift,
      seed: readSeed(request),
      dtype: this.tuning.dtype,
      outputPrefix: this.outputPrefix,
      ...(startImageName === undefined ? {} : { startImageName }),
    }, this.template().template);

    const response = await this.fetchImpl(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: 'astrmira' }),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      // 节点级错误原样带出（用户 / 我们都要知道是哪个节点、哪句话说错了）
      throw new Error(`ComfyUI 拒绝提交：${describeComfySubmissionError(body)}`);
    }
    const promptId = (body as { prompt_id?: unknown } | null)?.prompt_id;
    if (typeof promptId !== 'string' || promptId === '') {
      throw new Error('ComfyUI 接受了提交但没有返回 prompt_id（响应形状变了？）');
    }

    this.jobs.set(promptId, {
      request,
      outputPrefix: this.outputPrefix,
      createdAt: Date.now(),
    });
    // 尺寸被缩小过就如实告警（走 taskStore 的 warnings，与本仓"改了什么要说清"一致）
    for (const warning of dimensions.warnings) {
      this.pendingWarnings.set(promptId, [...(this.pendingWarnings.get(promptId) ?? []), warning]);
    }
    return { taskId: promptId };
  }

  /** 提交时攒下的告警（`queryStatus` 里随结果一起交出去） */
  private readonly pendingWarnings = new Map<string, string[]>();

  /** i2v：把首帧**下载下来再上传**给 ComfyUI（它只认自己 input 目录里的文件） */
  private async uploadFirstFrame(request: VideoGenerateRequest): Promise<string> {
    const assetId = request.assets?.firstFrameImage;
    if (assetId === undefined || assetId === '') {
      throw new Error('i2v（图生视频）需要首帧：请在参考素材里选一张图片');
    }
    if (this.resolveAssetUrl === undefined) {
      throw new Error('i2v 需要解析首帧地址，但本 provider 没有拿到 resolveAssetUrl（装配问题）');
    }
    const url = await this.resolveAssetUrl(assetId);
    if (url === null) throw new Error(`首帧资产不存在或不可读：${assetId}`);

    const media = await this.fetchImpl(url);
    if (!media.ok) throw new Error(`下载首帧失败：${url} → HTTP ${media.status}`);
    const buffer = Buffer.from(await media.arrayBuffer());

    const form = new FormData();
    form.append('image', new Blob([buffer], { type: 'image/png' }), `${randomUUID()}.png`);
    form.append('subfolder', COMFY_OUTPUT_SUBDIR);
    form.append('overwrite', 'true');
    const uploaded = await this.fetchImpl(`${this.baseUrl}/upload/image`, {
      method: 'POST',
      body: form,
    });
    if (!uploaded.ok) throw new Error(`上传首帧到 ComfyUI 失败：HTTP ${uploaded.status}`);
    const payload = (await uploaded.json()) as { name?: unknown; subfolder?: unknown };
    const name = typeof payload.name === 'string' ? payload.name : '';
    if (name === '') throw new Error('ComfyUI 上传接口没有返回文件名');
    const subfolder = typeof payload.subfolder === 'string' ? payload.subfolder : '';
    return subfolder === '' ? name : `${subfolder}/${name}`;
  }

  // ── 查状态 ─────────────────────────────────────────────────────────────────

  async queryStatus(taskId: string): Promise<TaskProgress> {
    const job = this.jobs.get(taskId);
    const createdAt = job?.createdAt ?? Date.now();
    const requestSnapshot = job?.request ?? { prompt: '', mode: 't2v', aspectRatio: '16:9', provider: this.id };
    const warnings = this.pendingWarnings.get(taskId) ?? [];

    // ① 已交付过（幂等：调度器可能再查一次）
    if (job?.deliveredUrl !== undefined) {
      return {
        taskId,
        status: 'succeeded',
        progressPercent: 100,
        requestSnapshot,
        outputVideoUrl: job.deliveredUrl,
        createdAt,
        ...(warnings.length === 0 ? {} : { warnings }),
        message: '本地 ComfyUI 已出片',
      };
    }

    try {
      const historyResponse = await this.fetchImpl(`${this.baseUrl}/history/${taskId}`);
      if (!historyResponse.ok) {
        return this.fail(taskId, requestSnapshot, createdAt, `ComfyUI /history 返回 HTTP ${historyResponse.status}`);
      }
      const history = (await historyResponse.json()) as Record<string, unknown>;
      const entry = history[taskId];

      if (entry === undefined) {
        // ② 还没进历史 → 在队列里就是在跑（ComfyUI 不报进度，如实说明）
        const queued = await this.isQueued(taskId);
        if (queued) {
          return {
            taskId,
            status: 'running',
            // **不编造进度**：ComfyUI 的 HTTP 接口不提供单任务进度（它在 WebSocket 上）
            progressPercent: 0,
            requestSnapshot,
            createdAt,
            ...(warnings.length === 0 ? {} : { warnings }),
            message: 'ComfyUI 正在执行（它不上报进度百分比 —— 本地轨以出片为准）',
          };
        }
        // ③ 既不在历史也不在队列 → 记录丢了（ComfyUI 重启过），如实说
        return this.fail(
          taskId,
          requestSnapshot,
          createdAt,
          'ComfyUI 里找不到这条任务：它可能重启过（/history 与队列都在内存里，重启即丢）',
        );
      }

      const outputs = parseComfyOutputs((entry as { outputs?: unknown }).outputs);
      if (outputs.length === 0) {
        return this.fail(
          taskId,
          requestSnapshot,
          createdAt,
          `ComfyUI 执行结束但没有产物：${describeComfyExecutionStatus(entry)}`,
        );
      }

      // V2.39：**挑视频**而不是"取第一个" —— H3 这类模板可能同时输出视频 + 音频两个文件，
      // 而产物顺序取决于节点 id；取到音频会把音频字节写成 <taskId>.mp4（静默出错）。
      const artifact = pickComfyVideoArtifact(outputs);
      if (artifact === undefined) {
        return this.fail(
          taskId,
          requestSnapshot,
          createdAt,
          `ComfyUI 执行结束但产物里没有视频（产物：${outputs.map((item) => item.filename).join('、')}）——` +
            ' 本仓只接视频产物（音频随视频封装可以，独立音频文件不接，见 CONTRACT §19-5）',
        );
      }
      const mediaResponse = await this.fetchImpl(`${this.baseUrl}${comfyViewPath(artifact)}`);
      if (!mediaResponse.ok) {
        return this.fail(taskId, requestSnapshot, createdAt, `取产物失败：HTTP ${mediaResponse.status}`);
      }
      const outputName = `${taskId}.mp4`;
      await mkdir(this.outputDir, { recursive: true });
      await writeFile(path.join(this.outputDir, outputName), Buffer.from(await mediaResponse.arrayBuffer()));

      const url = `/media/${outputName}`;
      if (job !== undefined) job.deliveredUrl = url;
      return {
        taskId,
        status: 'succeeded',
        progressPercent: 100,
        requestSnapshot,
        outputVideoUrl: url,
        createdAt,
        ...(warnings.length === 0 ? {} : { warnings }),
        message: '本地 ComfyUI 已出片',
      };
    } catch (error) {
      return this.fail(
        taskId,
        requestSnapshot,
        createdAt,
        `查 ComfyUI 状态失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async isQueued(taskId: string): Promise<boolean> {
    const response = await this.fetchImpl(`${this.baseUrl}/queue`);
    if (!response.ok) return false;
    const queue = (await response.json()) as { queue_running?: unknown; queue_pending?: unknown };
    const list = [...(asArray(queue.queue_running) ?? []), ...(asArray(queue.queue_pending) ?? [])];
    return list.some((item) => Array.isArray(item) && item[1] === taskId);
  }

  private fail(
    taskId: string,
    requestSnapshot: VideoGenerateRequest,
    createdAt: number,
    message: string,
  ): TaskProgress {
    return {
      taskId,
      status: 'failed',
      progressPercent: 0,
      requestSnapshot,
      createdAt,
      // `terminal`：本地引擎的这类失败（连不上 / 记录丢了 / 报错结束）重试同一条不会变好 ——
      // 用户该做的是看一眼原因再决定，而不是让调度器自动重投（那只会再占一次 GPU）
      error: { code: 'UPSTREAM_ERROR', message, disposition: 'terminal' },
    };
  }

  async cancel(_taskId: string): Promise<boolean> {
    // **如实**：ComfyUI 的 interrupt 会让任务重启、queue {delete} 只清 pending —— 做不到取消。
    // 返回 false 是承认这件事；假装"取消成功"会让界面显示"已取消"而 GPU 还在跑。
    return false;
  }
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function readSeed(request: VideoGenerateRequest): number {
  const seed = request.params?.seed;
  return typeof seed === 'number' && Number.isFinite(seed) ? Math.floor(seed) : Math.floor(Math.random() * 1e9);
}

function readNegativePrompt(request: VideoGenerateRequest): string {
  const custom = request.options?.['negativePrompt'];
  return typeof custom === 'string' && custom.trim() !== '' ? custom : COMFY_DEFAULT_NEGATIVE;
}

function describeComfyExecutionStatus(entry: unknown): string {
  const status = (entry as { status?: unknown }).status;
  if (typeof status === 'string') return status;
  if (typeof status === 'object' && status !== null) {
    const record = status as { status_str?: unknown; messages?: unknown };
    const text = typeof record.status_str === 'string' ? record.status_str : '未知';
    const messages = Array.isArray(record.messages) ? record.messages : [];
    const failed = messages.find(
      (item) => Array.isArray(item) && item[0] === 'execution_error',
    ) as [string, { exception_message?: string }] | undefined;
    const detail = failed?.[1]?.exception_message;
    return typeof detail === 'string' ? `${text}：${detail}` : text;
  }
  return '未知';
}
