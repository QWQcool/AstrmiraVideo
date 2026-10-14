import type { AspectRatio, GenerationMode, VideoGenerateRequest } from '@astrmira/shared';

/**
 * ComfyUI 对接协议（CONTRACT §19；台账 A1 片 B；形态 = 决策 **D53**）。
 *
 * ## 这一层只做纯的事
 * 模板构造 / 占位符替换 / 参数映射 / 产物解析 / 错误映射 —— 全是可测的纯函数；
 * 网络（`/prompt`、`/history`、`/view`）在 `ComfyUiProvider` 里，靠注入 fetch 被假服务覆盖。
 * 分开的理由与 `canvasPlanRunner` 同一条：**正确性都在纯逻辑里**，网络只是最后一步。
 *
 * ## 参数从哪来（不许猜）
 * 全部来自 2026-10-13 的真机实测（PLAN V8.34/V8.35）：
 * - 节点与参数名：`GET /object_info`（958 个节点的真实字段）
 * - 默认采样档：官方模板 `video_wan2_2_5B_ti2v.json`（20 步 / cfg 5 / `uni_pc` / `simple` / shift 8 / fps 24）
 * - 解码必须用 `VAEDecodeTiled`（10GB 卡上整段 `VAEDecode` 会退化成 CPU 解码，实测 >14 分钟未完成）
 * - 权重精度默认 `fp8_e4m3fn`（fp16 的 9.3GB 在 10GB 显存里放不下：同一条工作流 753s → 119s）
 */

export const COMFYUI_DEFAULT_BASE_URL = 'http://127.0.0.1:8188';

/**
 * 产物落在这个**子目录**里（`SaveVideo.filename_prefix` 的前缀）。
 *
 * 为什么必须有（实测踩到）：那台 ComfyUI 的 `output/` 目录**与别的项目共用**
 * （里面躺着 WebLockShot 的历史产物）。不带自己的前缀，两个项目的素材会混在一起 ——
 * 而"哪条片是谁下的"在共享目录里根本分不出来。
 */
export const COMFY_OUTPUT_SUBDIR = 'astrmira';

/** 官方 Wan2.2 TI2V 5B 模板的档位（`fps` 是模板写死的 24，不是随便挑的） */
export const COMFY_FPS = 24;
export const COMFY_DEFAULT_STEPS = 20;
export const COMFY_DEFAULT_CFG = 5;
export const COMFY_DEFAULT_SHIFT = 8;
export const COMFY_SAMPLER = 'uni_pc';
export const COMFY_SCHEDULER = 'simple';

/**
 * 分块解码参数（`VAEDecodeTiled`）：默认档调小到 256/32/32/8 —— 10GB 显存的安全侧。
 * 官方模板用的是整段解码（它的目标是大显存卡），照抄会踩 V8.34 那条坑。
 */
export const COMFY_TILE = { size: 256, overlap: 32, temporalSize: 32, temporalOverlap: 8 } as const;

/**
 * 像素预算（`width × height` 的上限）的**默认值**：832×480 = 399,360。
 *
 * 依据是实测：480p / 81 帧（3.4 秒）约 98 秒 —— 这是 **10GB 档**"能等"的上限；
 * 更高分辨率会把单条耗时推到十几分钟（480×272 → 832×480 已经慢了 7 倍）。
 * 超预算时**按比例缩小并如实告警**（不静默改参数、也不硬跑）。
 *
 * ⚠️ 它只是**默认值**：换到 24GB+ 的卡（例如 5090）时用 `COMFYUI_MAX_PIXELS` 覆盖，
 * 否则明明能跑 720p 也会被这个 10GB 档的预算缩到 480p（见 `resolveComfyTuning`）。
 */
export const COMFY_MAX_PIXELS = 832 * 480;

/** 各画幅的基础尺寸（16:9 / 9:16 用 480p 实测档；1:1 取同一像素预算） */
const BASE_DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  '16:9': { width: 832, height: 480 },
  '9:16': { width: 480, height: 832 },
  '1:1': { width: 640, height: 640 },
};

/** 尺寸必须对齐 32（`Wan22ImageToVideoLatent` 的 step=32 —— 不来自猜测，来自 /object_info） */
const DIMENSION_STEP = 32;

/** 帧数必须是 `4n+1`（Wan 的时序压缩要求；官方模板 121 = 4×30+1，本仓实测用过 33 / 81） */
const FRAME_STEP = 4;

export interface ComfyNodeInputs {
  [key: string]: unknown;
}

export interface ComfyWorkflow {
  [nodeId: string]: { class_type: string; inputs: ComfyNodeInputs };
}

export interface ComfyModels {
  unet: string;
  clip: string;
  /** `CLIPLoader.type`（Wan 系是 `wan`） */
  clipType: string;
  vae: string;
}

export interface ComfyCapabilities {
  /** 该实例**实际能跑**的模式（按模型文件名判定，不是"节点存在就算支持"） */
  modes: GenerationMode[];
  hasTiledDecode: boolean;
  hasLatentNode: boolean;
  unetCandidates: string[];
  clipCandidates: string[];
  vaeCandidates: string[];
  /** 为什么某些模式不可用（给人看的；空数组 = 全都可用） */
  unavailableReasons: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 从 `/object_info` 里取某个节点的必填输入枚举（第一项就是候选数组 —— 实测过这个形状） */
function enumCandidate(objectInfo: unknown, node: string, field: string): string[] {
  const info = asRecord(asRecord(objectInfo)?.[node]);
  const required = asRecord(asRecord(info?.input)?.required);
  const spec = required?.[field];
  if (!Array.isArray(spec)) return [];
  const first = spec[0];
  return Array.isArray(first) ? first.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * 挑模型：**优先文件名带关键词的那个**（`ti2v` > `wan`），否则退回第一个。
 *
 * 为什么不是"让用户在界面上选"：D53 的形态是"用户把模型放进 ComfyUI 的 models/ 就完事" ——
 * 他只装一套时不该被迫做多余的选择；装了多套时（将来）再加选择入口也不影响这里的契约。
 */
export function pickComfyModels(objectInfo: unknown, preferred?: Partial<ComfyModels>): ComfyModels {
  const unets = enumCandidate(objectInfo, 'UNETLoader', 'unet_name');
  const clips = enumCandidate(objectInfo, 'CLIPLoader', 'clip_name');
  const vaes = enumCandidate(objectInfo, 'VAELoader', 'vae_name');
  const clipTypes = enumCandidate(objectInfo, 'CLIPLoader', 'type');

  const pick = (candidates: string[], keyword: string): string => {
    const hit = candidates.find((name) => name.toLowerCase().includes(keyword));
    return hit ?? candidates[0] ?? '';
  };

  return {
    unet: preferred?.unet ?? pick(unets, 'ti2v'),
    clip: preferred?.clip ?? pick(clips, 'umt5'),
    clipType: preferred?.clipType ?? (clipTypes.includes('wan') ? 'wan' : (clipTypes[0] ?? 'wan')),
    vae: preferred?.vae ?? pick(vaes, 'wan'),
  };
}

/**
 * 能力位：**按"模型 + 关键节点"判定**，而不是"节点存在就算支持"。
 *
 * 判定依据（都是实测事实）：
 * - `VAEDecodeTiled` 与 `Wan22ImageToVideoLatent` 缺一个就不能跑（前者是 10GB 卡的硬要求）；
 * - TI2V 模型（文件名含 `ti2v`）= 文生视频 + 图生视频**同一个模型两种用法** → 支持 t2v / i2v；
 * - 纯 I2V 模型（含 `i2v` 但不含 `ti2v`）→ 只支持 i2v；
 * - **fl2v / v2v 一律不支持**（需要 FLF2V / VACE 系列模型，本机未装；有模型才亮，没有就如实说）。
 */
export function comfyCapabilities(
  objectInfo: unknown,
  models: ComfyModels,
  template: WorkflowTemplate = WAN22_TI2V_5B_TEMPLATE,
): ComfyCapabilities {
  const info = asRecord(objectInfo);
  const hasTiledDecode = info?.VAEDecodeTiled !== undefined;
  const hasLatentNode = info?.Wan22ImageToVideoLatent !== undefined;
  const unetCandidates = enumCandidate(objectInfo, 'UNETLoader', 'unet_name');
  const clipCandidates = enumCandidate(objectInfo, 'CLIPLoader', 'clip_name');
  const vaeCandidates = enumCandidate(objectInfo, 'VAELoader', 'vae_name');

  const modes: GenerationMode[] = [];
  const unavailableReasons: string[] = [];
  const unetName = models.unet.toLowerCase();

  // V2.33：**按模板引用的节点判定**（不再硬编码两个节点名）——
  // 换模板（别的模型 / 别的节点图）时，缺什么就报什么，判定逻辑不用跟着改。
  const missingNodes = templateNodeTypes(template).filter((type) => info?.[type] === undefined);
  if (missingNodes.length > 0) {
    unavailableReasons.push(
      `这套工作流模板需要的节点缺失：${missingNodes.join('、')}` +
        (missingNodes.includes('VAEDecodeTiled')
          ? '（缺 VAEDecodeTiled 时整段解码会退化成 CPU 解码，所以**不许回退**到 VAEDecode）'
          : ''),
    );
  }
  if (models.unet === '') {
    unavailableReasons.push('models/diffusion_models 里没有模型文件');
  }

  if (missingNodes.length === 0 && models.unet !== '') {
    if (unetName.includes('ti2v')) {
      modes.push('t2v', 'i2v');
    } else if (unetName.includes('i2v')) {
      modes.push('i2v');
      unavailableReasons.push('这套模型只做图生视频（文件名不含 ti2v）—— 文生视频需要 TI2V 或 T2V 模型');
    } else {
      modes.push('t2v');
      unavailableReasons.push('这套模型按文生视频使用（文件名既不含 ti2v 也不含 i2v）—— 需要确认');
    }
  }

  unavailableReasons.push('fl2v / v2v 需要另外的模型（FLF2V / VACE 系列），本机未安装');
  return { modes, hasTiledDecode, hasLatentNode, unetCandidates, clipCandidates, vaeCandidates, unavailableReasons };
}

/** 对齐到 32 的倍数（且不小于 32） */
export function alignDimension(value: number): number {
  const rounded = Math.round(value / DIMENSION_STEP) * DIMENSION_STEP;
  return Math.max(DIMENSION_STEP, rounded);
}

/**
 * 帧数对齐到 `4n+1`（Wan 的时序要求）。
 *
 * **取最近**，不是向下取整 —— 这是一次实测发现的纠正：5 秒 @24fps = 120 帧，
 * 向下取整会是 117（4.875s，**比用户要的短**），而官方模板用的是 **121**（5.042s）。
 * 等距时向上（宁可略长，也不让成片比请求的时长少一截）。
 */
export function alignFrames(value: number): number {
  const clamped = Math.max(1, Math.round(value));
  const blocks = Math.round((clamped - 1) / FRAME_STEP);
  return Math.max(FRAME_STEP + 1, blocks * FRAME_STEP + 1);
}

/**
 * 可调档位（V2.32）—— 这些值**默认按 10GB 卡实测**定，但都不该写死在代码里：
 * 换一张 24GB+ 的卡（5090 之类）时，用户只该改 env，不该等我们发版。
 *
 * 每个字段的 env 与默认值见 `resolveComfyTuning`。
 */
export interface ComfyTuning {
  /** 像素预算上限（`width × height`） */
  maxPixels: number;
  steps: number;
  cfg: number;
  shift: number;
  fps: number;
  dtype: string;
}

export const COMFY_DEFAULT_TUNING: ComfyTuning = {
  maxPixels: COMFY_MAX_PIXELS,
  steps: COMFY_DEFAULT_STEPS,
  cfg: COMFY_DEFAULT_CFG,
  shift: COMFY_DEFAULT_SHIFT,
  fps: COMFY_FPS,
  dtype: 'fp8_e4m3fn',
};

/** 读一个正整数 env（非法 / 缺失 → 用默认值；**不猜、不报错**，但也不静默改成别的数） */
function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw.trim());
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** 读一个正浮点 env（cfg / shift 可以带小数） */
function readPositiveFloat(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw.trim());
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * 从 env 解析档位（V2.32）。**这是"换硬件/换机器只改 env"的落点。**
 *
 * | env | 默认 | 说明 |
 * |---|---|---|
 * | `COMFYUI_MAX_PIXELS` | 832×480 | 像素预算；24GB+ 的卡可调到 1280×704（约 90 万）等 |
 * | `COMFYUI_STEPS` | 20 | 采样步数（画质 vs 时间的旋钮） |
 * | `COMFYUI_CFG` | 5 | 官方模板值 |
 * | `COMFYUI_SHIFT` | 8 | `ModelSamplingSD3.shift`（官方模板值） |
 * | `COMFYUI_FPS` | 24 | 与官方模板一致；帧数由它换算（并取 `4n+1`） |
 * | `COMFYUI_WEIGHT_DTYPE` | `fp8_e4m3fn` | 显存紧张时别用 `default`（fp16 在 10GB 上慢 6.3 倍） |
 *
 * 非法值一律**回落到默认**（不抛错、也不悄悄取一半）—— 档位是"能用"的旋钮，
 * 不是"配错就起不来"的开关；真的配错了，用户会在提交后的耗时上看见。
 */
export function resolveComfyTuning(env: NodeJS.ProcessEnv = process.env): ComfyTuning {
  const dtype = env.COMFYUI_WEIGHT_DTYPE?.trim();
  return {
    maxPixels: readPositiveInt(env.COMFYUI_MAX_PIXELS, COMFY_DEFAULT_TUNING.maxPixels),
    steps: readPositiveInt(env.COMFYUI_STEPS, COMFY_DEFAULT_TUNING.steps),
    cfg: readPositiveFloat(env.COMFYUI_CFG, COMFY_DEFAULT_TUNING.cfg),
    shift: readPositiveFloat(env.COMFYUI_SHIFT, COMFY_DEFAULT_TUNING.shift),
    fps: readPositiveInt(env.COMFYUI_FPS, COMFY_DEFAULT_TUNING.fps),
    dtype: dtype === undefined || dtype === '' ? COMFY_DEFAULT_TUNING.dtype : dtype,
  };
}

export interface ComfyDimensionPlan {
  width: number;
  height: number;
  /** 因为超过像素预算而被缩小时给出的说明（**如实告警**，不静默改） */
  warnings: string[];
}

/**
 * 请求的画幅/分辨率 → ComfyUI 的 `width × height`。
 *
 * 三条规则：
 * 1. 有 `request.resolution` 就用它（用户明确要的尺寸优先）；
 * 2. 否则按 `aspectRatio` 取实测基础档；
 * 3. 超出像素预算（`COMFY_MAX_PIXELS`）→ **等比缩小**并如实告警。
 * 两种情况最后都对齐 32。
 */
export function planComfyDimensions(
  request: VideoGenerateRequest,
  maxPixels: number = COMFY_DEFAULT_TUNING.maxPixels,
): ComfyDimensionPlan {
  const warnings: string[] = [];
  const base =
    request.resolution === undefined
      ? (BASE_DIMENSIONS[request.aspectRatio] ?? BASE_DIMENSIONS['16:9'])
      : { width: request.resolution.width, height: request.resolution.height };

  const pixels = base.width * base.height;
  let scale = 1;
  if (pixels > maxPixels) {
    scale = Math.sqrt(maxPixels / pixels);
    warnings.push(
      `请求尺寸 ${base.width}×${base.height}（${Math.round(pixels / 1000)}K 像素）超过本地档上限 ` +
        `${Math.round(maxPixels / 1000)}K 像素 —— 已等比缩小到 ${Math.round(base.width * scale)}×${Math.round(base.height * scale)}` +
        '（这个上限可用 COMFYUI_MAX_PIXELS 调 —— 默认值是 10GB 档的实测上限）',
    );
  }

  return {
    width: alignDimension(base.width * scale),
    height: alignDimension(base.height * scale),
    warnings,
  };
}

/** 时长 → 帧数（`fps` 固定 24，与官方模板一致；帧数再对齐 `4n+1`） */
export function planComfyFrames(durationSec: number | undefined, fps = COMFY_FPS): number {
  const seconds = durationSec ?? 5;
  return alignFrames(seconds * fps);
}

/**
 * 工作流模板（V2.33 外置）：**API 格式**的节点图 + 占位符。
 *
 * ## 为什么要外置
 * 此前节点图**写死在 `buildComfyWorkflow` 里** —— 换一个"节点图不同"的模型
 * （LTX / Hunyuan / 新 Wan 结构）必须改代码、发版。而 ComfyUI 世界里换模型**就等于换一张图**，
 * 所以模板必须是**数据**：放一份 JSON 就能多支持一套模型（契约 §19-3）。
 *
 * ## 占位符约定（三条，够用且好懂）
 * 1. `"{{KEY}}"` **独占整个字符串**时 → 替换为**任意 JSON 值**（数字 / 数组 / 字符串都行）；
 * 2. 该值**未提供**（`undefined`）→ **删掉这个键** —— 这是"可选输入"的表达方式
 *    （例如 t2v 不接 `start_image`）；
 * 3. 节点上的 `_dropWhenMissing: ["KEY"]` → 这些键任一未提供时，**整个节点删掉**
 *    （例如 t2v 不该出现 `LoadImage` 节点）。下划线开头的键都是**元数据**，渲染时剔除。
 *
 * 模板里的常量（节点 id / 图结构 / tile 参数）保持原样 —— 它们是"这套模型怎么跑"的知识，
 * 该留在模板里；而数值型旋钮（步数 / cfg / shift…）走占位符，由 `ComfyTuning` 决定。
 */
export type WorkflowTemplate = Record<string, Record<string, unknown>>;
export type WorkflowValues = Record<string, unknown>;

const PLACEHOLDER_ONLY = /^\{\{([A-Z0-9_]+)\}\}$/;

function renderValue(value: unknown, values: WorkflowValues): unknown {
  if (typeof value === 'string') {
    const match = PLACEHOLDER_ONLY.exec(value);
    // 只有"整个字符串就是一个占位符"时才做类型化替换；字符串内嵌的占位符不做
    // （内嵌替换会引出一个"值是数字时怎么拼"的坑，而我们并不需要它）
    return match === null ? value : values[match[1]];
  }
  if (Array.isArray(value)) return value.map((item) => renderValue(item, values));
  if (typeof value === 'object' && value !== null) {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(source)) {
      const rendered = renderValue(item, values);
      if (rendered !== undefined) output[key] = rendered; // 规则 2：未提供的键直接删
    }
    return output;
  }
  return value;
}

export function renderWorkflow(template: WorkflowTemplate, values: WorkflowValues): ComfyWorkflow {
  const workflow: ComfyWorkflow = {};
  for (const [nodeId, node] of Object.entries(template)) {
    const dropWhenMissing = node['_dropWhenMissing'];
    if (
      Array.isArray(dropWhenMissing) &&
      dropWhenMissing.some((key) => values[String(key)] === undefined)
    ) {
      continue; // 规则 3：条件节点
    }
    const classType = node['class_type'];
    if (typeof classType !== 'string') continue; // 模板写坏了不至于抛错
    const inputs = renderValue(node['inputs'], values);
    if (typeof inputs !== 'object' || inputs === null) continue;
    workflow[nodeId] = { class_type: classType, inputs: inputs as ComfyNodeInputs };
  }
  return workflow;
}

/** 模板引用了哪些节点类型（能力位按它判定"这台机器能不能跑这套模板"） */
export function templateNodeTypes(template: WorkflowTemplate): string[] {
  const types = new Set<string>();
  for (const node of Object.values(template)) {
    const classType = node['class_type'];
    if (typeof classType === 'string') types.add(classType);
  }
  return [...types];
}

/**
 * 内置模板：Wan2.2 TI2V-5B（与官方 `video_wan2_2_5B_ti2v.json` 同构，三处刻意差异见下）。
 *
 * ⚠️ 它**不是"唯一真理"**：用户可以用 `COMFYUI_TEMPLATE_DIR` + `COMFYUI_TEMPLATE` 指向自己的模板
 * （见 `ComfyUiProvider`）—— 那正是"换模型不改代码"的入口。
 */
export const WAN22_TI2V_5B_TEMPLATE: WorkflowTemplate = {
  '37': {
    class_type: 'UNETLoader',
    inputs: { unet_name: '{{UNET_NAME}}', weight_dtype: '{{WEIGHT_DTYPE}}' },
  },
  '38': {
    class_type: 'CLIPLoader',
    inputs: { clip_name: '{{CLIP_NAME}}', type: '{{CLIP_TYPE}}' },
  },
  '39': { class_type: 'VAELoader', inputs: { vae_name: '{{VAE_NAME}}' } },
  '48': { class_type: 'ModelSamplingSD3', inputs: { model: ['37', 0], shift: '{{SHIFT}}' } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: '{{PROMPT}}', clip: ['38', 0] } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: '{{NEGATIVE_PROMPT}}', clip: ['38', 0] } },
  // t2v 时整个节点消失（start_image 也不接）—— 同一个模型两种用法，区别只在这里
  '56': {
    _dropWhenMissing: ['START_IMAGE_NAME'],
    class_type: 'LoadImage',
    inputs: { image: '{{START_IMAGE_NAME}}' },
  },
  '55': {
    class_type: 'Wan22ImageToVideoLatent',
    inputs: {
      vae: ['39', 0],
      width: '{{WIDTH}}',
      height: '{{HEIGHT}}',
      length: '{{FRAMES}}',
      batch_size: 1,
      start_image: '{{START_IMAGE}}',
    },
  },
  '3': {
    class_type: 'KSampler',
    inputs: {
      model: ['48', 0],
      seed: '{{SEED}}',
      steps: '{{STEPS}}',
      cfg: '{{CFG}}',
      sampler_name: COMFY_SAMPLER,
      scheduler: COMFY_SCHEDULER,
      positive: ['6', 0],
      negative: ['7', 0],
      latent_image: ['55', 0],
      denoise: 1,
    },
  },
  // 与官方模板的刻意差异①：分块解码（10GB 卡上整段 VAEDecode 会退化成 CPU，实测 >14 分钟）
  '8': {
    class_type: 'VAEDecodeTiled',
    inputs: {
      samples: ['3', 0],
      vae: ['39', 0],
      tile_size: COMFY_TILE.size,
      overlap: COMFY_TILE.overlap,
      temporal_size: COMFY_TILE.temporalSize,
      temporal_overlap: COMFY_TILE.temporalOverlap,
    },
  },
  '57': { class_type: 'CreateVideo', inputs: { images: ['8', 0], fps: '{{FPS}}' } },
  '58': {
    class_type: 'SaveVideo',
    inputs: {
      video: ['57', 0],
      filename_prefix: '{{OUTPUT_PREFIX}}',
      format: 'auto',
      codec: 'auto',
    },
  },
};

export interface ComfyWorkflowInput {
  models: ComfyModels;
  prompt: string;
  negativePrompt: string;
  mode: GenerationMode;
  width: number;
  height: number;
  frames: number;
  fps?: number;
  seed: number;
  steps?: number;
  cfg?: number;
  shift?: number;
  dtype: string;
  /** i2v 的首帧在 ComfyUI 里的名字（`LoadImage.image`；由上传接口返回） */
  startImageName?: string;
  /** 产物前缀（默认带 `astrmira/` 子目录） */
  outputPrefix: string;
}

/**
 * 组装 **API 格式**工作流（节点 id → `class_type` + `inputs`；连线写成 `[上游 id, 输出槽序号]`）。
 *
 * 节点图与官方模板 `video_wan2_2_5B_ti2v.json` 一致，只有三处刻意的差异：
 * - **`VAEDecode` → `VAEDecodeTiled`**（10GB 卡必须，见 V8.34 实测）；
 * - `UNETLoader.weight_dtype` 走参数（默认 `fp8_e4m3fn`，见 V8.35 实测）；
 * - `SaveVideo.filename_prefix` 带 `astrmira/` 子目录（output 目录与别的项目共用）。
 */
export function buildComfyWorkflow(
  input: ComfyWorkflowInput,
  template: WorkflowTemplate = WAN22_TI2V_5B_TEMPLATE,
): ComfyWorkflow {
  return renderWorkflow(template, {
    UNET_NAME: input.models.unet,
    CLIP_NAME: input.models.clip,
    CLIP_TYPE: input.models.clipType,
    VAE_NAME: input.models.vae,
    WEIGHT_DTYPE: input.dtype,
    PROMPT: input.prompt,
    NEGATIVE_PROMPT: input.negativePrompt,
    WIDTH: alignDimension(input.width),
    HEIGHT: alignDimension(input.height),
    FRAMES: alignFrames(input.frames),
    FPS: input.fps ?? COMFY_FPS,
    SEED: input.seed,
    STEPS: input.steps ?? COMFY_DEFAULT_STEPS,
    CFG: input.cfg ?? COMFY_DEFAULT_CFG,
    SHIFT: input.shift ?? COMFY_DEFAULT_SHIFT,
    OUTPUT_PREFIX: input.outputPrefix,
    // t2v 时这两个都是 undefined → 键被删、`LoadImage` 节点也被删（模板里的 _dropWhenMissing）
    START_IMAGE_NAME: input.startImageName,
    // ⚠️ `56` 是**内置模板里 LoadImage 的节点 id** —— 写自定义模板的人只要保证"有一个输入图节点"
    // 并把它的连接写进模板（本行只在 i2v 时给内置模板用）
    START_IMAGE: input.startImageName === undefined ? undefined : ['56', 0],
  });
}

export interface ComfyArtifact {
  filename: string;
  subfolder: string;
  type: string;
}

/**
 * 解析 `/history/{id}` 的 `outputs`。
 *
 * 形状是实测的（`SaveVideo` 把视频放在 `images` 数组里，另有 `animated: [true]`）：
 * `{"58": {"images": [{"filename": "...", "subfolder": "astrmira", "type": "output"}], "animated": [true]}}`。
 * 这里**不假设节点 id**（用户换模板会变），把任何带 `filename` 的项都收进来。
 */
export function parseComfyOutputs(outputs: unknown): ComfyArtifact[] {
  const root = asRecord(outputs);
  if (root === null) return [];

  const artifacts: ComfyArtifact[] = [];
  for (const node of Object.values(root)) {
    const record = asRecord(node);
    if (record === null) continue;
    for (const value of Object.values(record)) {
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        const entry = asRecord(item);
        const filename = entry?.filename;
        if (typeof filename !== 'string' || filename === '') continue;
        artifacts.push({
          filename,
          subfolder: typeof entry?.subfolder === 'string' ? entry.subfolder : '',
          type: typeof entry?.type === 'string' ? entry.type : 'output',
        });
      }
    }
  }
  return artifacts;
}

/** `/view` 的下载地址（按实测的形状拼：filename + subfolder + type 三个都要带） */
export function comfyViewPath(artifact: ComfyArtifact): string {
  const query = new URLSearchParams({
    filename: artifact.filename,
    subfolder: artifact.subfolder,
    type: artifact.type,
  });
  return `/view?${query.toString()}`;
}

/**
 * `/prompt` 被拒时的原因提取（**原样带出节点级错误**）。
 *
 * ComfyUI 的 400 响应形如 `{"error": {...}, "node_errors": {"38": {"errors": [{"message": ...}]}}}` ——
 * 只报一句"提交失败"会让用户完全不知道该改什么，所以把节点 id 与消息拼出来。
 */
export function describeComfySubmissionError(body: unknown): string {
  const record = asRecord(body);
  const nodeErrors = asRecord(record?.node_errors);
  const parts: string[] = [];

  if (nodeErrors !== null) {
    for (const [nodeId, value] of Object.entries(nodeErrors)) {
      const errors = asRecord(value)?.errors;
      if (!Array.isArray(errors)) continue;
      for (const item of errors) {
        const message = asRecord(item)?.message;
        if (typeof message === 'string') parts.push(`节点 ${nodeId}：${message}`);
      }
    }
  }

  const error = asRecord(record?.error);
  if (parts.length === 0 && typeof error?.message === 'string') parts.push(error.message);
  if (typeof record?.error === 'string') parts.push(record.error);

  return parts.length === 0 ? 'ComfyUI 拒绝了这次提交（未给出细节）' : parts.join('；');
}

/**
 * 本仓的负向提示词默认值。
 *
 * 官方模板给的是中文负向词，本仓的产物面向中文用户，所以照用同一套方向
 * （"字幕 / 文字 / 水印 / 低质量"这些是视频生成里最影响观感的一类）；
 * 用户显式传的负向词在 `request.options.negativePrompt` 里，优先于它。
 */
export const COMFY_DEFAULT_NEGATIVE =
  '色调艳丽，过曝，静态，细节模糊不清，字幕，文字，水印，logo，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量';
