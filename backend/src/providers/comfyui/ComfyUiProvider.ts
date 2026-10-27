import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  GenerationMode,
  ProviderType,
  TaskProgress,
  VideoGenerateRequest,
  VideoProvider,
} from '@astrmira/shared';
import type { TaskVideoResolution } from '../../store/assets.js';
import type { ComfyProgressSource } from './comfyuiProgress.js';
import { parseTaskRef } from '@astrmira/shared';
import {
  buildComfyWorkflow,
  comfyCapabilities,
  comfyViewPath,
  COMFYUI_DEFAULT_BASE_URL,
  COMFY_DEFAULT_NEGATIVE,
  COMFY_OUTPUT_SUBDIR,
  countTemplateReferenceSlots,
  describeComfySubmissionError,
  parseComfyOutputs,
  pickComfyImageArtifact,
  pickComfyModels,
  pickComfyVideoArtifact,
  planComfyDimensions,
  planComfyFrames,
  resolveComfyTuning,
  WAN22_TI2V_5B_TEMPLATE,
  type ComfyCapabilities,
  type ComfyModels,
  type ComfyTemplateDeclaration,
  type ComfyTuning,
  type WorkflowTemplate,
} from './comfyuiProtocol.js';
import {
  loadWorkflowTemplates,
  type LoadedTemplate,
  type LoadedTemplates,
} from './comfyuiTemplates.js';

/**
 * 收尾宽限期：「已出队、history 还没写入」的窗口有多长。
 *
 * 2026-10-19 实测：FLUX.2 Klein 出图约 15s，轮询正好落在收尾窗口里，
 * 任务被误判成"记录丢失"（产物文件其实已经落盘）。给 30s 足够覆盖本地出图，
 * 又不会让真正丢失的任务无限等待。
 */
const FINALIZE_GRACE_MS = 30_000;

/**
 * `host-comfyui` provider（CONTRACT §19；台账 A1 片 B；形态 = 决策 **D53**）。
 *
 * ## 它与云端 provider 的结构性差异
 * ComfyUI **本身就是异步队列**：`POST /prompt` 返回 `prompt_id`，之后它自己排期执行。
 * 所以这里天然是"`submit` 拿 id、`queryStatus` 轮询"的形态 —— 不需要像云端那样自己起轮询。
 * `prompt_id` 直接当 `taskId` 用（本仓调度器只要求"提交返回 id、可按 id 查状态"）。
 *
 * ## 三条如实边界（都来自真机实测，见 PLAN V8.34/V8.35）
 * 1. **进度只能从 WebSocket 拿**（V2.82 起）：HTTP 接口不报单任务进度，所以进度走
 *    `ComfyProgressTracker`（`/ws` 的 `progress` 事件）。**拿不到就还是 0 + 一句说明** ——
 *    绝不编造一个匀速上涨的假进度条（那正是本仓"不假装可用"的反面）。
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
   * V2.82：实时进度来源（WebSocket 侧）。
   *
   * 不传 = 没有进度（行为与 V2.81 一致：`progressPercent` 恒 0 + 一句说明）。
   * 生产由 registry 注入进程级共享的 `ComfyProgressTracker`；测试想钉进度就注入假实现。
   */
  progress?: ComfyProgressSource;
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
  /** S9 修正：`task:<taskId>` 引用 → 上游可访问地址（t2i 任务产物作 i2v 首帧；V2.6 通道补 ComfyUI 侧） */
  resolveTaskVideoUrl?: (taskId: string) => Promise<TaskVideoResolution>;
  /** `/object_info` 的缓存时长（测试可设 0 强制每次重探） */
  inventoryTtlMs?: number;
}

interface JobRecord {
  request: VideoGenerateRequest;
  outputPrefix: string;
  createdAt: number;
  /**
   * 已下载的产物（幂等：`queryStatus` 被调多次不会重复下载）。
   * V2.40 起带**类型** —— 早先只有一个 `deliveredUrl: string`，幂等分支会把它写进
   * `outputVideoUrl`（图片任务就成了"指向 png 的 video 字段"）。
   */
  delivered?: { kind: 'video' | 'image'; url: string };
}

/**
 * 一份模板 + 它在**当前** `/object_info` 下的判定结果（V2.40）。
 *
 * 为什么按模板各存一份 `models`：不同模板要的是**不同模型**
 * （视频模板挑 Wan、图片模板挑 Klein）—— 用一份全局的 `models` 会把它们搅在一起。
 */
interface TemplateRuntime {
  loaded: LoadedTemplate;
  models: ComfyModels;
  capabilities: ComfyCapabilities;
}

/** 宽松地当对象看（ComfyUI 的响应里到处是 `unknown` 结构；调用方只读几个已知键） */
function asRecordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** 图片产物的落盘扩展名（只认图片容器；异常值收敛到 `.png` —— 不拿不可信后缀去拼路径） */
function imageExtensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const extension = dot < 0 ? '' : filename.slice(dot).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.webp'].includes(extension) ? extension : '.png';
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

/**
 * V2.77：`options.scale`（`'2' | '2x' | '4' | '4x'`，也接受数字）→ 4x 模型的降采样系数。
 *
 * 为什么统一跑 4x 再降采样：模板只挂一份 4x 模型，2x 只需 `ImageScaleBy 0.5`；
 * 为 2x 单独训/挂一份模型不值当，而且"先吃满模型再降采样"的质量通常好于直接 2x 模型。
 * 越界一律夹紧（>4 拿不到更多细节，<0.05 没有意义），**不报错但也不假装**。
 */
export function readUpscaleScaleBy(request: VideoGenerateRequest): number {
  const raw = request.options?.['scale'];
  const parsed =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
        ? Number.parseFloat(raw.replace(/[^0-9.]/g, ''))
        : 4;
  const scale = Number.isFinite(parsed) && parsed > 0 ? parsed : 4;
  return Math.min(1, Math.max(0.05, scale / 4));
}

export interface OutpaintPad {
  left: number;
  top: number;
  right: number;
  bottom: number;
  feathering: number;
}

/** 单边外扩上限（像素）。超过这个数基本等于"重新画一张"，不该算扩图 */
const MAX_PAD_PIXELS = 2048;
/** 外扩后的画布上限（像素）。10GB 卡上再大就只剩换页了 */
const MAX_OUTPAINT_DIMENSION = 4096;

/**
 * V2.79：`options.expand` → 四边外扩像素。
 *
 * 三条硬规则（都**报错**，不静默改数）：
 * 1. 必须是 **8 的整数倍**（VAE 的潜空间步长；差几个像素就被下采样吃掉，蒙版会对不齐）；
 * 2. 至少有一边 > 0（四边全 0 的"扩图"没有意义，直接拒）；
 * 3. 外扩后的画布不超过 `MAX_OUTPAINT_DIMENSION`。
 */
export function readOutpaintPad(
  request: VideoGenerateRequest,
): { ok: true; pad: OutpaintPad } | { ok: false; reason: string } {
  const raw = request.options?.['expand'];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: '扩图需要 options.expand：{ left, top, right, bottom }（像素，8 的整数倍）' };
  }
  const record = raw as Record<string, unknown>;
  const readSide = (key: string): number | string => {
    const value = record[key];
    if (value === undefined) return 0;
    if (typeof value !== 'number' || !Number.isInteger(value)) return `${key} 必须是整数`;
    if (value < 0) return `${key} 不能是负数`;
    if (value > MAX_PAD_PIXELS) return `${key} 最大 ${MAX_PAD_PIXELS} 像素`;
    if (value % 8 !== 0) return `${key} 必须是 8 的整数倍（VAE 潜空间步长），收到 ${value}`;
    return value;
  };

  const sides: Record<'left' | 'top' | 'right' | 'bottom', number> = {
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
  };
  for (const key of ['left', 'top', 'right', 'bottom'] as const) {
    const value = readSide(key);
    if (typeof value === 'string') return { ok: false, reason: `options.expand.${value}` };
    sides[key] = value;
  }
  if (sides.left + sides.top + sides.right + sides.bottom === 0) {
    return { ok: false, reason: 'options.expand 四边都是 0：这不是扩图' };
  }

  const base = request.resolution;
  if (base === undefined) return { ok: false, reason: '扩图需要 resolution（底图真实宽高）' };
  const width = base.width + sides.left + sides.right;
  const height = base.height + sides.top + sides.bottom;
  if (width > MAX_OUTPAINT_DIMENSION || height > MAX_OUTPAINT_DIMENSION) {
    return {
      ok: false,
      reason:
        `外扩后画布 ${width}×${height} 超过上限 ${MAX_OUTPAINT_DIMENSION}（10GB 卡的实际能力），` +
        '请减小外扩像素或先缩小底图',
    };
  }

  const featheringRaw = record['feathering'];
  const feathering =
    typeof featheringRaw === 'number' && Number.isInteger(featheringRaw) && featheringRaw >= 0
      ? Math.min(256, featheringRaw)
      : 40;

  return { ok: true, pad: { ...sides, feathering } };
}

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
  private readonly resolveTaskVideoUrl?: (taskId: string) => Promise<TaskVideoResolution>;
  /** V2.82：实时进度（WS）；缺省 = 没有进度，`progressPercent` 恒 0 */
  private readonly progress?: ComfyProgressSource;
  private readonly inventoryTtlMs: number;

  /** 每份模板各自挑到的模型与判定出的能力位（V2.40：清单式） */
  private inventory: { runtimes: TemplateRuntime[]; at: number } | null = null;
  private readonly jobs = new Map<string, JobRecord>();
  private readonly injectedTemplate?: WorkflowTemplate;
  /** 注入路径的模板声明（V2.39；与 `injectedTemplate` 配对） */
  private readonly injectedDeclaration?: ComfyTemplateDeclaration;
  /** 懒加载的工作流模板清单（配错路径时**每次调用都会抛**，所以不缓存错误态 —— 用户改好即可用） */
  private loadedTemplates: LoadedTemplates | null = null;

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
    if (options.resolveTaskVideoUrl !== undefined) {
      this.resolveTaskVideoUrl = options.resolveTaskVideoUrl;
    }
    if (options.template !== undefined) this.injectedTemplate = options.template;
    if (options.declaration !== undefined) this.injectedDeclaration = options.declaration;
    if (options.progress !== undefined) this.progress = options.progress;
  }

  /**
   * 取工作流模板（懒加载 + 缓存）。
   *
   * **为什么不放在构造函数里**：`COMFYUI_TEMPLATE_DIR` 配错时应当"**提交时报一句人话**"，
   * 而不是让整个服务起不来（其它 provider 还得能用）。错误态刻意不缓存 —— 用户改好路径就该立刻生效。
   */
  private templates(): LoadedTemplates {
    if (this.loadedTemplates !== null) return this.loadedTemplates;
    // 注入路径：**只要给了 template 或 declaration 之一就走这里** ——
    // 早先只在 `injectedTemplate !== undefined` 时才用注入值，于是"只注入声明"会被**静默忽略**
    // （走 env 那一路，声明失效）；这是 2026-10-16 加"模型关键词命中校验"时露出来的。
    if (this.injectedTemplate !== undefined || this.injectedDeclaration !== undefined) {
      this.loadedTemplates = {
        templates: [
          {
            name: this.templateName ?? 'injected',
            template: this.injectedTemplate ?? WAN22_TI2V_5B_TEMPLATE,
            source: '注入（测试 / 调用方指定）',
            ...(this.injectedDeclaration === undefined
              ? {}
              : { declaration: this.injectedDeclaration }),
          },
        ],
        defaultIndex: 0,
      };
      return this.loadedTemplates;
    }
    this.loadedTemplates = loadWorkflowTemplates(process.env, this.templateName);
    return this.loadedTemplates;
  }

  /**
   * 按模式挑模板（V2.40）：能跑该模式的模板里，优先 `defaultIndex` 指的那份。
   * S9-A1：`wantsReference`（t2i 提交带了首帧参考）时优先 `referenceImage` 声明的模板，
   * 未带时优先**没有**该声明的模板——普通文生图不被参考图版劫持，反之亦然。
   */
  private pickTemplateForMode(
    runtimes: TemplateRuntime[],
    mode: GenerationMode,
    wantsReference = false,
    minReferenceSlots = 0,
  ): TemplateRuntime | undefined {
    const candidates = runtimes.filter((item) => item.capabilities.modes.includes(mode));
    if (candidates.length === 0) return undefined;
    if (wantsReference) {
      // B93/F2：带参考图时必须命中声明 referenceImage 的模板。
      // 绝不能回退普通 t2i —— 那会上传成功、/prompt 成功，但参考图被静默丢弃。
      const referenceCandidates = candidates.filter(
        (item) =>
          item.loaded.declaration?.referenceImage === true &&
          // V2.76：多参考要求模板至少有足够的静态槽位（2 张以内）；3 张以上由追加链补齐
          countTemplateReferenceSlots(item.loaded.template) >= minReferenceSlots,
      );
      if (referenceCandidates.length === 0) return undefined;
      const loaded = this.templates();
      const preferredName = loaded.templates[loaded.defaultIndex]?.name;
      return (
        referenceCandidates.find((item) => item.loaded.name === preferredName) ??
        referenceCandidates[0]
      );
    }
    const plainCandidates = candidates.filter(
      (item) => item.loaded.declaration?.referenceImage !== true,
    );
    const pool = plainCandidates.length > 0 ? plainCandidates : candidates;
    const loaded = this.templates();
    const preferredName = loaded.templates[loaded.defaultIndex]?.name;
    return pool.find((item) => item.loaded.name === preferredName) ?? pool[0];
  }

  // ── 探测与自检 ─────────────────────────────────────────────────────────────

  /**
   * 读 `/object_info`（**很大**，所以缓存）。
   *
   * `force` 用于"用户显式点自检"这种场合：他多半是刚换了模型，
   * 拿 10 分钟前的清单回答他就没意义了（见 `routes/providers.ts` 的 `RefreshableHealth`）。
   */
  private async readInventory(force = false): Promise<TemplateRuntime[]> {
    const now = Date.now();
    if (!force && this.inventory !== null && now - this.inventory.at < this.inventoryTtlMs) {
      return this.inventory.runtimes;
    }
    const response = await this.fetchImpl(`${this.baseUrl}/object_info`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`ComfyUI /object_info → HTTP ${response.status}`);
    const objectInfo: unknown = await response.json();

    // V2.40：**每份模板各判一次**（挑模型与能力位都按它自己的声明走）——
    // 单份时结果与 V2.39 完全一致；多份时才能回答"这台机器分别能出什么"。
    const runtimes: TemplateRuntime[] = this.templates().templates.map((item) => {
      const models = pickComfyModels(objectInfo, undefined, item.declaration);
      return {
        loaded: item,
        models,
        // V2.33：能力位**按该模板引用的节点**判定（换了模板，缺什么就报什么）
        capabilities: comfyCapabilities(objectInfo, models, item.template, item.declaration),
      };
    });

    this.inventory = { runtimes, at: now };
    return runtimes;
  }

  async checkHealth(options?: { refresh?: boolean }): Promise<{ available: boolean; reason?: string }> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/system_stats`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!response.ok) {
        return { available: false, reason: `ComfyUI 可达但 /system_stats 返回 HTTP ${response.status}` };
      }
      const runtimes = await this.readInventory(options?.refresh === true);
      const usable = runtimes.filter((item) => item.capabilities.modes.length > 0);
      const multi = runtimes.length > 1;
      /** 多份模板时给原因加模板名前缀 —— 否则"缺 VAEDecodeTiled"分不清是哪张图的问题 */
      const withName = (item: TemplateRuntime, reason: string): string =>
        multi ? `${item.loaded.name}：${reason}` : reason;

      if (usable.length === 0) {
        return {
          available: false,
          reason:
            'ComfyUI 可达但**没有可用的模板**：' +
            runtimes
              .map((item) => withName(item, item.capabilities.unavailableReasons.join('；')))
              .join(' · '),
        };
      }

      // 可用：把"能跑什么（哪份模板）/ 不能跑什么（为什么）"一并说清（界面照实展示，不藏）
      const supported = usable
        .map(
          (item) =>
            `${item.capabilities.modes.join(' / ')}（模板 ${item.loaded.name} → ${item.models.unet}）`,
        )
        .join(' · ');
      // 去重：多个模板会对同一件事说同一句话（"fl2v / v2v 本仓没接线"），
      // 复读一遍读起来像出错 —— 同一句话只说一次，第一次出现时带上模板名。
      const seen = new Set<string>();
      const unsupported: string[] = [];
      for (const item of runtimes) {
        for (const reason of item.capabilities.unavailableReasons) {
          if (seen.has(reason)) continue;
          seen.add(reason);
          unsupported.push(withName(item, reason));
        }
      }
      const notes = runtimes
        .map((item) => item.capabilities.declarationNote)
        .filter((note): note is string => note !== undefined)
        .map((note, index) =>
          multi ? `${runtimes[index]?.loaded.name ?? ''} ${note}`.trim() : note,
        );

      return {
        available: true,
        reason:
          `支持 ${supported}` +
          (notes.length === 0 ? '' : `（${notes.join(' · ')}）`) +
          `；不支持 ${unsupported.join('；')}`,
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

  /**
   * V2.51：最近一次探测（/selfcheck 或提交前健康检查）判出的**可用模式**。
   *
   * 只读内存里的 inventory，不发请求；没探测过返回空数组 ——
   * 调用方必须把“空”当成“未检测”，不能当成“不支持”。
   */
  capabilityModes(): GenerationMode[] {
    const modes = new Set<GenerationMode>();
    for (const item of this.inventory?.runtimes ?? []) {
      for (const mode of item.capabilities.modes) modes.add(mode);
    }
    return [...modes];
  }

  // ── 提交 ───────────────────────────────────────────────────────────────────

  async submit(request: VideoGenerateRequest): Promise<{ taskId: string }> {
    const runtimes = await this.readInventory();
    // V2.76（B 路线）：`assets.references[]` 与首帧参考走同一条上传通道（二者互斥由 schema 保证）
    const referenceAssets = [...(request.assets?.references ?? [])]
      .sort((left, right) => left.order - right.order)
      .map((reference) => reference.assetId);
    const wantsReference =
      request.mode === 't2i' &&
      (referenceAssets.length > 0 || request.assets?.firstFrameImage !== undefined);
    const referenceCount =
      referenceAssets.length > 0 ? referenceAssets.length : wantsReference ? 1 : 0;
    if (referenceCount > this.tuning.maxReferences) {
      // 不静默截断：连满 12 张再失败比"这里就说清楚"更贵
      throw new Error(
        `这个本地实例最多消费 ${this.tuning.maxReferences} 张参考图（收到 ${referenceCount} 张）。` +
          `10GB 卡实测 2 张 12s / 4 张 21s / 9 张 56s / 12 张 130s —— ` +
          `确需更多请调 COMFYUI_MAX_REFERENCES（封顶 12）。`,
      );
    }
    // i2v / upscale 缺输入图：在提交前就说清（比"上传时 assetId 为空"更可执行）
    if (request.mode === 'i2v' && (request.assets?.firstFrameImage ?? '') === '') {
      throw new Error('i2v（图生视频）需要首帧：请在参考素材里选一张图片');
    }
    if (request.mode === 'upscale' && (request.assets?.firstFrameImage ?? '') === '') {
      throw new Error('放大需要一张输入图：请选一张图片（或对一个已有产物的节点点"超清"）');
    }
    // V2.78：局部重绘要底图 + 蒙版，缺一个都不许提交
    if (request.mode === 'inpaint') {
      if ((request.assets?.firstFrameImage ?? '') === '') {
        throw new Error('局部重绘需要底图：assets.firstFrameImage');
      }
      if ((request.assets?.maskImage ?? '') === '') {
        throw new Error('局部重绘需要蒙版：assets.maskImage（白=重画区、黑=保留）');
      }
    }
    // V2.79：扩图要底图 + 四边外扩像素（规则见 readOutpaintPad）
    let pad: OutpaintPad | undefined;
    if (request.mode === 'outpaint') {
      if ((request.assets?.firstFrameImage ?? '') === '') {
        throw new Error('扩图需要底图：assets.firstFrameImage');
      }
      const parsed = readOutpaintPad(request);
      if (!parsed.ok) throw new Error(parsed.reason);
      pad = parsed.pad;
    }
    const target = this.pickTemplateForMode(
      runtimes,
      request.mode,
      wantsReference,
      // 放大/重绘/扩图都要一个输入槽；t2i 参考按张数要 1~2 个静态槽（>2 张由追加链补齐）
      request.mode === 'upscale' || request.mode === 'inpaint' || request.mode === 'outpaint'
        ? 1
        : Math.min(2, referenceCount),
    );

    if (target === undefined) {
      // **不假装可用**：没有模板能跑这个模式就直说，而不是提交上去等上游 400
      const supported = [...new Set(runtimes.flatMap((item) => item.capabilities.modes))];
      const multi = runtimes.length > 1;
      const reasons = runtimes.flatMap((item) =>
        item.capabilities.unavailableReasons.map((reason) =>
          multi ? `${item.loaded.name}：${reason}` : reason,
        ),
      );
      if (wantsReference) {
        // B93/F2：参考图请求没有 referenceImage 模板时，明确拒绝；
        // 这里发生在 upload 和 /prompt 之前，不允许静默降级成普通文生图。
        throw new Error(
          `本地 ComfyUI 没有声明 referenceImage 的 ${request.mode} 模板，` +
            `无法消费参考图；已拒绝提交，不会回退普通文生图。` +
            `当前支持：${supported.join(' / ') || '无'}；原因：${reasons.join('；')}`,
        );
      }
      throw new Error(
        `本地 ComfyUI 当前不支持 ${request.mode}（支持：${supported.join(' / ') || '无'}）。` +
          `原因：${reasons.join('；')}`,
      );
    }

    const { models, loaded } = target;
    /**
     * V2.78：局部重绘**不许缩放**。
     *
     * 蒙版是按底图尺寸画的；一旦这里的宽高被像素预算或 32 对齐改掉，
     * `SetLatentNoiseMask` 的潜空间与蒙版就对不上（要么崩，要么糊到别处）。
     * 所以重绘直接用请求里的 `resolution`（前面 schema 已保证它有值）。
     */
    const baseWidth = request.resolution?.width ?? 0;
    const baseHeight = request.resolution?.height ?? 0;
    const dimensions =
      request.mode === 'inpaint'
        ? { width: baseWidth, height: baseHeight, warnings: [] }
        : request.mode === 'outpaint'
          ? {
              // 外扩后的画布 = 底图 + 四边（与 ImagePadForOutpaint 的入参严格一致）
              width: baseWidth + (pad?.left ?? 0) + (pad?.right ?? 0),
              height: baseHeight + (pad?.top ?? 0) + (pad?.bottom ?? 0),
              warnings: [],
            }
          : planComfyDimensions(request, this.tuning.maxPixels);
    if (request.mode === 'inpaint' && (dimensions.width <= 0 || dimensions.height <= 0)) {
      throw new Error('局部重绘需要有效的 resolution（底图真实宽高）：蒙版必须与底图同尺寸');
    }
    if (request.mode === 'outpaint' && (baseWidth <= 0 || baseHeight <= 0)) {
      throw new Error('扩图需要有效的 resolution（底图真实宽高）');
    }
    const frames = planComfyFrames(request.params?.durationSec, this.tuning.fps);
    // 参考图逐个下载再上传给 ComfyUI（它只认自己 input 目录里的文件）
    // V2.77：`upscale` 也走这条通道（输入是一张图，不是 prompt）
    const imageNames =
      referenceAssets.length > 0
        ? await Promise.all(referenceAssets.map((assetId) => this.uploadReferenceImage(assetId)))
        : request.mode === 'i2v' ||
            request.mode === 'upscale' ||
            request.mode === 'inpaint' ||
            request.mode === 'outpaint' ||
            wantsReference
          ? [await this.uploadReferenceImage(request.assets?.firstFrameImage ?? '')]
          : [];
    const startImageName = imageNames[0];
    // V2.78：蒙版与底图同一条上传通道（同一份 input 目录，ComfyUI 才读得到）
    const maskImageName =
      request.mode === 'inpaint'
        ? await this.uploadReferenceImage(request.assets?.maskImage ?? '')
        : undefined;

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
      ...(imageNames.length === 0 ? {} : { referenceImageNames: imageNames }),
      // V2.77：放大模板的两个旋钮（其它模板没有这两个占位符，传了也不影响）
      ...(request.mode === 'upscale'
        ? { upscaleModel: this.tuning.upscaleModel, upscaleScaleBy: readUpscaleScaleBy(request) }
        : {}),
      ...(maskImageName === undefined ? {} : { maskImageName }),
      ...(pad === undefined ? {} : { pad }),
    }, loaded.template);

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

  /**
   * 把参考图**下载下来再上传**给 ComfyUI（它只认自己 input 目录里的文件）。
   *
   * V2.76：从"只传首帧"扩成"传任意一张参考图"—— 多参考时逐张调用（顺序由 `order` 决定）。
   */
  private async uploadReferenceImage(assetId: string): Promise<string> {
    if (assetId === '') {
      throw new Error('参考图缺少 assetId：请在参考素材里选一张图片');
    }
    if (this.resolveAssetUrl === undefined) {
      throw new Error('i2v 需要解析首帧地址，但本 provider 没有拿到 resolveAssetUrl（装配问题）');
    }
    // S9 修正：`task:<taskId>` 引用（图片任务产物作首帧）走 V2.6 的 task 通道——
    // 会话引擎的图片步产物就是 `task:<id>`，只查 assets 目录必然落空。
    const taskRef = parseTaskRef(assetId);
    let url: string | null = null;
    if (taskRef !== null) {
      if (this.resolveTaskVideoUrl === undefined) {
        throw new Error('i2v 需要 task: 引用通道，但本 provider 没有拿到 resolveTaskVideoUrl（装配问题）');
      }
      const resolution = await this.resolveTaskVideoUrl(taskRef);
      if (!resolution.ok) {
        const REASONS: Record<Exclude<TaskVideoResolution, { ok: true }>['reason'], string> = {
          not_found: '任务不存在',
          no_output: '任务没有可用产物（或尚未成功）',
          no_public_base: '服务未配置 PUBLIC_BASE_URL，无法给 ComfyUI 提供可下载地址',
        };
        throw new Error(`首帧引用的任务不可用：${taskRef}（${REASONS[resolution.reason]}）`);
      }
      url = resolution.url;
    } else {
      url = await this.resolveAssetUrl(assetId);
    }
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
    if (job?.delivered !== undefined) {
      return {
        taskId,
        status: 'succeeded',
        progressPercent: 100,
        requestSnapshot,
        // V2.40：按**产物类型**填对应的字段（图片任务不能写进 outputVideoUrl）
        ...(job.delivered.kind === 'image'
          ? { outputImageUrl: job.delivered.url }
          : { outputVideoUrl: job.delivered.url }),
        createdAt,
        ...(warnings.length === 0 ? {} : { warnings }),
        message: job.delivered.kind === 'image' ? '本地 ComfyUI 已出图' : '本地 ComfyUI 已出片',
      };
    }

    try {
      const historyResponse = await this.fetchImpl(`${this.baseUrl}/history/${taskId}`);
      if (!historyResponse.ok) {
        return this.fail(taskId, requestSnapshot, createdAt, `ComfyUI /history 返回 HTTP ${historyResponse.status}`);
      }
      const history = (await historyResponse.json()) as Record<string, unknown>;
      let entry = history[taskId];

      if (entry === undefined) {
        // ② 还没进历史 → 在队列里就是在跑（ComfyUI 不报进度，如实说明）
        const queued = await this.isQueued(taskId);
        if (queued) {
          /**
           * V2.82：进度只从 WS 拿（HTTP 不报）。
           * 拿不到就仍然写 0 并说明原因 —— **不编造一个匀速上涨的假进度条**。
           */
          const live = this.progress?.progress(taskId) ?? null;
          return {
            taskId,
            status: 'running',
            progressPercent: live?.percent ?? 0,
            requestSnapshot,
            createdAt,
            ...(warnings.length === 0 ? {} : { warnings }),
            message:
              live === null
                ? 'ComfyUI 正在执行（拿不到进度百分比 —— 本地轨以出片为准）'
                : live.percent >= 100
                  ? // 采样跑完还要解码/落盘：这时报"100% 但仍在执行"会让人以为卡住了
                    'ComfyUI 采样已完成，正在收尾（解码/保存）'
                  : `ComfyUI 正在执行：${live.percent}%（采样进度，仍以出片为准）`,
          };
        }

        /**
         * ③ **收尾竞态**：任务跑完的瞬间会先出队、再把结果写进 `/history`。
         * 轮询恰好落在两者之间时，"不在队列也不在历史"并不等于记录丢了 ——
         * 2026-10-19 实测：FLUX 出图 15s，任务因此被误判成失败（产物文件其实已经落盘）。
         *
         * 处理：宽限期内先补查一次 history；仍没有就报"收尾中"，把判断留给下一次轮询。
         * 超过宽限期才认定记录丢失（真丢失时也不会让用户无限等）。
         */
        const ageMs = Date.now() - createdAt;
        if (ageMs <= FINALIZE_GRACE_MS) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          const retry = await this.fetchImpl(`${this.baseUrl}/history/${taskId}`);
          if (retry.ok) {
            const retryHistory = (await retry.json()) as Record<string, unknown>;
            entry = retryHistory[taskId];
          }
          if (entry === undefined) {
            return {
              taskId,
              status: 'running',
              progressPercent: 0,
              requestSnapshot,
              createdAt,
              ...(warnings.length === 0 ? {} : { warnings }),
              message: 'ComfyUI 正在收尾（结果还没写入历史，稍候会自动更新）',
            };
          }
        }
      }

      if (entry === undefined) {
        // ④ 超出宽限期仍不在历史也不在队列 → 记录丢了（ComfyUI 重启过），如实说
        return this.fail(
          taskId,
          requestSnapshot,
          createdAt,
          'ComfyUI 里找不到这条任务：它可能重启过（/history 与队列都在内存里，重启即丢）',
        );
      }

      const entryRecord = asRecordOf(entry);
      const outputs = parseComfyOutputs(entryRecord['outputs']);
      if (outputs.length === 0) {
        // ⚠️ **兼容层可能在任务还没跑完时就写一条 history**（`status.completed === false`）——
        // 例如 `comfyui_lb`（V2.40 接它时实测：入队就写了 `queued`，被旧逻辑判成"执行结束但没有产物"的**假失败**）。
        // 原生 ComfyUI 只在完成时才写 history，所以这条分支对原生路径不会走到；对兼容层是必需的。
        // "执行结束"的两条判据：跑完了（`completed === true`）**或**报错了（`status_str === 'error'`）
        const statusRecord = asRecordOf(entryRecord['status']);
        const completed = statusRecord['completed'] === true || statusRecord['status_str'] === 'error';
        if (!completed) {
          return {
            taskId,
            status: 'running',
            progressPercent: 0,
            requestSnapshot,
            createdAt,
            ...(warnings.length === 0 ? {} : { warnings }),
            message: 'ComfyUI 正在执行（它不上报进度百分比 —— 本地轨以出片为准）',
          };
        }
        return this.fail(
          taskId,
          requestSnapshot,
          createdAt,
          `ComfyUI 执行结束但没有产物：${describeComfyExecutionStatus(entry)}`,
        );
      }

      // V2.39 / V2.40：**按产物类型挑**而不是"取第一个"（顺序取决于节点 id）。
      // 视频模式挑视频（H3 这类模板可能视频 + 音频同时输出，取到音频会把音频字节写成 .mp4）；
      // 图片模式（`t2i`）挑图片。
      // V2.77/78：放大与局部重绘产出的都是图片
      const isImage =
        requestSnapshot.mode === 't2i' ||
        requestSnapshot.mode === 'upscale' ||
        requestSnapshot.mode === 'inpaint' ||
        requestSnapshot.mode === 'outpaint';
      const artifact = isImage ? pickComfyImageArtifact(outputs) : pickComfyVideoArtifact(outputs);
      if (artifact === undefined) {
        const names = outputs.map((item) => item.filename).join('、');
        return this.fail(
          taskId,
          requestSnapshot,
          createdAt,
          isImage
            ? `ComfyUI 执行结束但产物里没有图片（产物：${names}）`
            : `ComfyUI 执行结束但产物里没有视频（产物：${names}）——` +
                ' 本仓只接视频产物（音频随视频封装可以，独立音频文件不接，见 CONTRACT §19-5）',
        );
      }
      const mediaResponse = await this.fetchImpl(`${this.baseUrl}${comfyViewPath(artifact)}`);
      if (!mediaResponse.ok) {
        return this.fail(taskId, requestSnapshot, createdAt, `取产物失败：HTTP ${mediaResponse.status}`);
      }

      // 落盘名：视频统一 `.mp4`（既有约定）；图片沿用产物的图片扩展名（`<img>` 靠它拿对 content-type）
      const outputName = `${taskId}${isImage ? imageExtensionOf(artifact.filename) : '.mp4'}`;
      await mkdir(this.outputDir, { recursive: true });
      await writeFile(path.join(this.outputDir, outputName), Buffer.from(await mediaResponse.arrayBuffer()));

      const url = `/media/${outputName}`;
      if (job !== undefined) job.delivered = { kind: isImage ? 'image' : 'video', url };
      return {
        taskId,
        status: 'succeeded',
        progressPercent: 100,
        requestSnapshot,
        // V2.40：**恰好一个**产物字段（写侧保证 —— 见 shared 的 outputImageUrl 注释）
        ...(isImage ? { outputImageUrl: url } : { outputVideoUrl: url }),
        createdAt,
        ...(warnings.length === 0 ? {} : { warnings }),
        message: isImage ? '本地 ComfyUI 已出图' : '本地 ComfyUI 已出片',
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
