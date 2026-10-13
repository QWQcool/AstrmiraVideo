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
 * 像素预算（`width × height` 的上限）：832×480 = 399,360。
 *
 * 依据是实测：480p / 81 帧（3.4 秒）约 98 秒 —— 这是 10GB 档"能等"的上限；
 * 更高分辨率会把单条耗时推到十几分钟（480×272 → 832×480 已经慢了 7 倍）。
 * 超预算时**按比例缩小并如实告警**（不静默改参数、也不硬跑）。
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
export function comfyCapabilities(objectInfo: unknown, models: ComfyModels): ComfyCapabilities {
  const hasTiledDecode = asRecord(objectInfo)?.VAEDecodeTiled !== undefined;
  const hasLatentNode = asRecord(objectInfo)?.Wan22ImageToVideoLatent !== undefined;
  const unetCandidates = enumCandidate(objectInfo, 'UNETLoader', 'unet_name');
  const clipCandidates = enumCandidate(objectInfo, 'CLIPLoader', 'clip_name');
  const vaeCandidates = enumCandidate(objectInfo, 'VAELoader', 'vae_name');

  const modes: GenerationMode[] = [];
  const unavailableReasons: string[] = [];
  const unetName = models.unet.toLowerCase();

  if (!hasTiledDecode) {
    unavailableReasons.push('缺少 VAEDecodeTiled（10GB 显存上整段解码会退化成 CPU 解码）');
  }
  if (!hasLatentNode) {
    unavailableReasons.push('缺少 Wan22ImageToVideoLatent（Wan 2.2 的潜空间节点）');
  }
  if (models.unet === '') {
    unavailableReasons.push('models/diffusion_models 里没有模型文件');
  }

  if (hasTiledDecode && hasLatentNode && models.unet !== '') {
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
export function planComfyDimensions(request: VideoGenerateRequest): ComfyDimensionPlan {
  const warnings: string[] = [];
  const base =
    request.resolution === undefined
      ? (BASE_DIMENSIONS[request.aspectRatio] ?? BASE_DIMENSIONS['16:9'])
      : { width: request.resolution.width, height: request.resolution.height };

  const pixels = base.width * base.height;
  let scale = 1;
  if (pixels > COMFY_MAX_PIXELS) {
    scale = Math.sqrt(COMFY_MAX_PIXELS / pixels);
    warnings.push(
      `请求尺寸 ${base.width}×${base.height}（${Math.round(pixels / 1000)}K 像素）超过本地档上限 ` +
        `${COMFY_MAX_PIXELS / 1000}K 像素 —— 已等比缩小到 ${Math.round(base.width * scale)}×${Math.round(base.height * scale)}` +
        '（这是 10GB 显存档的实测上限，不是随手定的）',
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
export function buildComfyWorkflow(input: ComfyWorkflowInput): ComfyWorkflow {
  const frames = alignFrames(input.frames);
  const width = alignDimension(input.width);
  const height = alignDimension(input.height);

  const workflow: ComfyWorkflow = {
    '37': {
      class_type: 'UNETLoader',
      inputs: { unet_name: input.models.unet, weight_dtype: input.dtype },
    },
    '38': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: input.models.clip, type: input.models.clipType },
    },
    '39': { class_type: 'VAELoader', inputs: { vae_name: input.models.vae } },
    '48': { class_type: 'ModelSamplingSD3', inputs: { model: ['37', 0], shift: input.shift ?? COMFY_DEFAULT_SHIFT } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: input.prompt, clip: ['38', 0] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: input.negativePrompt, clip: ['38', 0] } },
    '55': {
      class_type: 'Wan22ImageToVideoLatent',
      inputs: {
        vae: ['39', 0],
        width,
        height,
        length: frames,
        batch_size: 1,
        ...(input.startImageName === undefined ? {} : { start_image: ['56', 0] }),
      },
    },
    '3': {
      class_type: 'KSampler',
      inputs: {
        model: ['48', 0],
        seed: input.seed,
        steps: input.steps ?? COMFY_DEFAULT_STEPS,
        cfg: input.cfg ?? COMFY_DEFAULT_CFG,
        sampler_name: COMFY_SAMPLER,
        scheduler: COMFY_SCHEDULER,
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['55', 0],
        denoise: 1,
      },
    },
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
    '57': { class_type: 'CreateVideo', inputs: { images: ['8', 0], fps: input.fps ?? COMFY_FPS } },
    '58': {
      class_type: 'SaveVideo',
      inputs: {
        video: ['57', 0],
        filename_prefix: input.outputPrefix,
        format: 'auto',
        codec: 'auto',
      },
    },
  };

  // i2v 才挂首帧节点（t2v 不挂 —— 同一个模型两种用法，区别只在有没有 start_image）
  if (input.startImageName !== undefined) {
    workflow['56'] = { class_type: 'LoadImage', inputs: { image: input.startImageName } };
  }
  return workflow;
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
