import {
  GenerationModeSchema,
  type AspectRatio,
  type GenerationMode,
  type VideoGenerateRequest,
} from '@astrmira/shared';

/**
 * ComfyUI 对接协议（CONTRACT §19；台账 A1 片 B；形态 = 决策 **D53**）。
 *
 * ## 这一层只做纯的事
 * 模板构造 / 占位符替换 / 参数映射 / 产物解析 / 错误映射 —— 全是可测的纯函数；
 * 网络（`/prompt`、`/history`、`/view`）在 `ComfyUiProvider` 里，靠注入 fetch 被假服务覆盖。
 * 分开的理由与 `canvasPlanRunner` 同一条：**正确性都在纯逻辑里**，网络只是最后一步。
 *
 * ## 参数从哪来（不许猜）
 * 全部来自 2026-10-13 的真机实测（LOCAL-GPU-DEPLOY.md 的 V8.34/V8.35）：
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

/**
 * **图片模式**（`t2i`）的画幅基础尺寸（V2.40）。
 *
 * 为什么与视频档分开：480p 那档（832×480）是"**10GB 卡跑视频**"的实测上限，
 * 而对文生图来说太小（Flux 系原生 1024，缩到 480 会明显糊）。
 * 实测 10GB 卡跑 1024×1024 / 4 步没问题（PLAN §8）。
 */
const IMAGE_BASE_DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  '16:9': { width: 1024, height: 576 },
  '9:16': { width: 576, height: 1024 },
  '1:1': { width: 1024, height: 1024 },
};

/** 图片模式的像素预算默认值（`COMFYUI_IMAGE_MAX_PIXELS` 可覆盖） */
export const COMFY_IMAGE_MAX_PIXELS = 1024 * 1024;

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

/**
 * 本仓**已经接好输入通道**的生成模式（V2.39）。
 *
 * 为什么需要它：模板的 sidecar 可以声明任意模式（"这套工作流理论上做得了这件事"），
 * 但**我们这一侧**还得有把输入塞进去的通道 —— t2v 不需要输入图、i2v 需要 `{{START_IMAGE}}`，
 * 而 fl2v / v2v 的**首尾帧 / 参考视频我们还没接**（契约 §19-8 明写不做）。
 * 两者取交集才是"真的能用"：声明了却没接线的模式会被**剔除并说明**，不报成可用。
 */
export const COMFY_WIRED_MODES: readonly GenerationMode[] = [
  't2v',
  'i2v',
  // V2.104：首尾帧接线 —— 真机查过 `MiniMaxH3ImageToVideo` 有**可选** `last_frame` 输入口
  // （`GET /object_info/MiniMaxH3ImageToVideo` → required 有 clip/vae/prompt/width/height/length，
  //  optional 是 `first_frame` + `last_frame`）。所以"塞得进去"是事实，不是声明。
  'fl2v',
  't2i',
  'upscale',
  'inpaint',
  'outpaint',
];

/** sidecar 里"挑哪个模型文件"的关键词（大小写不敏感的子串匹配） */
export interface ComfyModelMatch {
  unet?: string;
  clip?: string;
  vae?: string;
  /** `CLIPLoader.type` 的期望值（如 Wan 系是 `wan`）；缺省按 /object_info 的候选回落 */
  clipType?: string;
}

/**
 * 模板 sidecar 声明（`<name>.meta.json`；CONTRACT §19-3 的 V2.39 增补）。
 *
 * ## 为什么要有它（真机事实）
 * `comfyCapabilities()` 原先**按模型文件名猜**模式（含 `ti2v` → t2v+i2v、含 `i2v` → 只 i2v、
 * 都没有 → "按 t2v 用，需要确认"）。这对 MiniMax H3 会**判错**：H3 一个模型同时支持
 * t2v / i2v / 首尾帧 / 多参考 / 音频，而文件名里既没有 `ti2v` 也不含 `i2v`。
 * 让**模板自己声明**能力，判定就不再依赖"作者怎么给文件命名"。
 *
 * ## 判定优先级（V2.39）
 * `sidecar 声明` > 文件名启发式（缺声明时才用）—— 缺声明**不是错误**（老模板照旧可用）。
 */
/**
 * 帧数对齐规则：`length % mod === offset`（V2.101 / 2026-10-30 真机）。
 *
 * 为什么要有它：`4n+1` 是 **Wan 的时序要求**，不是所有模型的。MiniMax H3 的官方模板里
 * 帧数是 `max(5, round(sec*24)) + (5 - n % 17) % 17` —— 也就是 **17n+5**。
 * 以前这个对齐写死在 `alignFrames()` 里，换模型就只能改代码（而 D53 的原则是"换模型不改代码"）。
 */
export interface FrameAlign {
  /** 模数（H3 = 17） */
  mod: number;
  /** 余数（H3 = 5） */
  offset: number;
}

export interface ComfyTemplateDeclaration {
  /** 这套模板能做哪些模式（会与 `COMFY_WIRED_MODES` 取交集，交集外**如实剔除**） */
  modes: GenerationMode[];
  /** 帧数对齐（缺省 = Wan 的 `4n+1`，即老行为一字不变） */
  frameAlign?: FrameAlign;
  /** 挑模型文件的关键词（缺省 = 内置关键词 `ti2v` / `umt5` / `wan`） */
  modelMatch?: ComfyModelMatch;
  /** 给人看的名字（进自检结论） */
  label?: string;
  /** 给操作者的说明（进自检结论） */
  notes?: string;
  /**
   * V2.68（S9-A1）：该 t2i 模板**消费参考图**（提交需带 `assets.firstFrameImage`）。
   * provider 在"t2i + 带参考"时优先选它；纯文生图优先选**没**有此标志的模板。
   */
  referenceImage?: boolean;
}

/**
 * 解析 sidecar 声明。**形状不对就抛错**（与"模板读不出来就抛错"同一条铁律）：
 * 静默忽略会让用户以为自己的声明生效了，而实际跑的还是文件名启发式 —— 那正是最糟的形态。
 */
export function parseTemplateDeclaration(
  value: unknown,
  source = '模板 sidecar（<name>.meta.json）',
): ComfyTemplateDeclaration {
  const record = asRecord(value);
  if (record === null) throw new Error(`${source} 必须是一个 JSON 对象`);

  const modesRaw = record['modes'];
  if (!Array.isArray(modesRaw)) {
    throw new Error(`${source} 缺少 modes 数组（例：{"modes":["t2v","i2v"]}）`);
  }
  const known = GenerationModeSchema.options as readonly string[];
  const modes: GenerationMode[] = [];
  for (const item of modesRaw) {
    if (typeof item !== 'string' || !known.includes(item)) {
      throw new Error(
        `${source} 的 modes 里有不认识的值 ${JSON.stringify(item)}（只支持 ${known.join(' / ')}）`,
      );
    }
    // 去重但保序（重复声明不报错 —— 它不是"配错"，只是冗余）
    if (!modes.includes(item as GenerationMode)) modes.push(item as GenerationMode);
  }

  const matchRaw = asRecord(record['modelMatch']);
  const modelMatch: ComfyModelMatch = {};
  if (matchRaw !== null) {
    // V2.76 修：`clipType` 之前**没被解析**（接口里有、parser 不读），
    // 结果是声明了 `clipType: "flux2"` 的模板仍按 /object_info 的候选回落成 `wan`，
    // 实测报错 `mat1 and mat2 shapes cannot be multiplied`。四个键一起读。
    for (const key of ['unet', 'clip', 'vae', 'clipType'] as const) {
      const raw = matchRaw[key];
      if (raw === undefined) continue;
      if (typeof raw !== 'string' || raw.trim() === '') {
        throw new Error(`${source} 的 modelMatch.${key} 必须是非空字符串`);
      }
      modelMatch[key] = raw.trim();
    }
  }

  const declaration: ComfyTemplateDeclaration = { modes };
  if (Object.keys(modelMatch).length > 0) declaration.modelMatch = modelMatch;
  const label = record['label'];
  if (typeof label === 'string' && label.trim() !== '') declaration.label = label.trim();
  const notes = record['notes'];
  if (typeof notes === 'string' && notes.trim() !== '') declaration.notes = notes.trim();
  // V2.68（S9-A1）：t2i 模板是否消费参考图
  const referenceImage = record['referenceImage'];
  if (referenceImage !== undefined) {
    if (typeof referenceImage !== 'boolean') {
      throw new Error(`${source} 的 referenceImage 必须是布尔值`);
    }
    if (referenceImage) declaration.referenceImage = true;
  }
  // V2.101：帧数对齐（H3 是 17n+5，不是 Wan 的 4n+1）—— 写错就提交不上去，所以形状必须严格
  const frameAlignRaw = asRecord(record['frameAlign']);
  if (record['frameAlign'] !== undefined && frameAlignRaw === null) {
    throw new Error(`${source} 的 frameAlign 必须是对象（例：{"mod":17,"offset":5}）`);
  }
  if (frameAlignRaw !== null) {
    const mod = frameAlignRaw['mod'];
    const offset = frameAlignRaw['offset'];
    if (typeof mod !== 'number' || !Number.isInteger(mod) || mod < 2) {
      throw new Error(`${source} 的 frameAlign.mod 必须是 ≥2 的整数`);
    }
    if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset >= mod) {
      throw new Error(`${source} 的 frameAlign.offset 必须是 0..${mod - 1} 的整数`);
    }
    declaration.frameAlign = { mod, offset };
  }
  return declaration;
}

/**
 * 内置模板（Wan2.2 TI2V-5B）的声明 —— 它把**现状**写实：
 * 那张节点图确实只有 t2v / i2v 两种用法（区别只在有没有 `{{START_IMAGE}}`）。
 * 有了它，"声明优先"的代码路径在**零配置**下也走一遍（不只是靠启发式兜着）。
 */
export const WAN22_TI2V_5B_DECLARATION: ComfyTemplateDeclaration = {
  modes: ['t2v', 'i2v'],
  modelMatch: { unet: 'ti2v', clip: 'umt5', vae: 'wan' },
  label: 'Wan2.2 TI2V-5B（内置模板）',
};

export interface ComfyCapabilities {
  /** 该实例**实际能跑**的模式（声明优先；缺声明按模型文件名判定 —— 都不是"节点存在就算支持"） */
  modes: GenerationMode[];
  /**
   * 判定依据（V2.39；只在**走声明**时有值）。
   *
   * 为什么单独一个字段而不是塞进 `unavailableReasons`：后者是"**不支持**什么"，
   * 而"这个判断是从哪来的"既不是支持也不是不支持 —— 混进去会让自检结论变成
   * "支持 A；不支持 能力位按模板声明判定"（语义变形，实测踩到过）。
   */
  declarationNote?: string;
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
export function pickComfyModels(
  objectInfo: unknown,
  preferred?: Partial<ComfyModels>,
  declaration?: ComfyTemplateDeclaration,
): ComfyModels {
  const unets = enumCandidate(objectInfo, 'UNETLoader', 'unet_name');
  const clips = enumCandidate(objectInfo, 'CLIPLoader', 'clip_name');
  const vaes = enumCandidate(objectInfo, 'VAELoader', 'vae_name');
  const clipTypes = enumCandidate(objectInfo, 'CLIPLoader', 'type');

  /** 关键词优先级：**声明 > 内置**（H3 那类文件名不含 ti2v 的模型靠它挑对文件） */
  const keyword = (site: keyof ComfyModelMatch, fallback: string): string =>
    declaration?.modelMatch?.[site] ?? fallback;
  const pick = (candidates: string[], kw: string): string => {
    const lowered = kw.toLowerCase();
    const hit = candidates.find((name) => name.toLowerCase().includes(lowered));
    return hit ?? candidates[0] ?? '';
  };

  return {
    unet: preferred?.unet ?? pick(unets, keyword('unet', 'ti2v')),
    clip: preferred?.clip ?? pick(clips, keyword('clip', 'umt5')),
    clipType:
      preferred?.clipType ??
      keyword('clipType', clipTypes.includes('wan') ? 'wan' : (clipTypes[0] ?? 'wan')),
    vae: preferred?.vae ?? pick(vaes, keyword('vae', 'wan')),
  };
}

/**
 * 能力位：**按"模型 + 关键节点"判定**，而不是"节点存在就算支持"。
 *
 * ## 判定来源（V2.39 起两级）
 * 1. **模板声明**（`declaration`）—— sidecar `<name>.meta.json` 或内置模板自带的声明。
 *    这是首选：换模型（H3 那类文件名不含 `ti2v` 的）不必等我们发版，也不靠"作者怎么命名文件"；
 * 2. **文件名启发式**（缺声明时才用，行为与 V2.38 一字不改）：
 *    - `ti2v` → t2v + i2v（同一个模型两种用法）；
 *    - `i2v`（不含 ti2v）→ 只 i2v；
 *    - 都不含 → 按 t2v 用并标注"需要确认"；
 *    - **fl2v / v2v 一律不支持**（需要 FLF2V / VACE 系列模型，本机未装）。
 *
 * 硬前置（两级都适用）：模板引用的节点必须都在 /object_info 里（缺 `VAEDecodeTiled` 就是致命 ——
 * 10GB 卡上整段解码会退化成 CPU，实测 >14 分钟未完成）；`diffusion_models` 不能为空。
 *
 * ⚠️ **声明不等于可用**：声明只表示"这套工作流理论上做得了这件事"，
 * 还要与本仓**已接线的输入通道**（`COMFY_WIRED_MODES`）取交集 —— 见 `resolveDeclaredModes`。
 */
export function comfyCapabilities(
  objectInfo: unknown,
  models: ComfyModels,
  template: WorkflowTemplate = WAN22_TI2V_5B_TEMPLATE,
  declaration?: ComfyTemplateDeclaration,
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

  /**
   * V2.40：**声明的模型关键词要真的命中**才算这套模板可用。
   *
   * 为什么必须有：`pickComfyModels` 在候选里挑不到关键词时会**回落到第一个**候选 ——
   * 那意味着"用户装了 LTX、系统却拿内置的 Flux 模板去跑它"。旧版视频轨靠"只有一个模型"侥幸避开，
   * 而图片模板（Flux 系）与视频模板（Wan 系）共存时，这种错配一定会发生。
   * 命中不了就**如实不可用**，不假装能跑。
   */
  const unetKeyword = declaration?.modelMatch?.unet;
  const modelMismatch =
    unetKeyword !== undefined &&
    models.unet !== '' &&
    !models.unet.toLowerCase().includes(unetKeyword.toLowerCase());
  if (modelMismatch) {
    unavailableReasons.push(
      `当前挑到的模型 ${models.unet} 与这套模板的声明不匹配（需要文件名含 "${unetKeyword}"）`,
    );
  }

  let declarationNote: string | undefined;
  if (missingNodes.length === 0 && models.unet !== '' && !modelMismatch) {
    if (declaration !== undefined) {
      // V2.39：**声明优先**（换模型/换工作流不必改代码，也不靠文件命名）
      const resolved = resolveDeclaredModes(declaration, template, unavailableReasons);
      modes.push(...resolved.modes);
      declarationNote = resolved.note;
    } else if (unetName.includes('ti2v')) {
      modes.push('t2v', 'i2v');
    } else if (unetName.includes('i2v')) {
      modes.push('i2v');
      unavailableReasons.push('这套模型只做图生视频（文件名不含 ti2v）—— 文生视频需要 TI2V 或 T2V 模型');
    } else {
      modes.push('t2v');
      unavailableReasons.push('这套模型按文生视频使用（文件名既不含 ti2v 也不含 i2v）—— 需要确认');
    }
  }

  if (declaration === undefined) {
    // 只有"缺声明"这条路径才说这句 —— 有声明时"不支持什么"由声明的差集回答（见 resolveDeclaredModes）
    unavailableReasons.push('fl2v / v2v 需要另外的模型（FLF2V / VACE 系列），本机未安装');
  }
  return {
    modes,
    ...(declarationNote === undefined ? {} : { declarationNote }),
    hasTiledDecode,
    hasLatentNode,
    unetCandidates,
    clipCandidates,
    vaeCandidates,
    unavailableReasons,
  };
}

/**
 * 把**模板声明**落成能力位（V2.39）。三条规则：
 * 1. 只有**本仓已接线**的模式才可能拿下（`COMFY_WIRED_MODES`）——
 *    声明是"工作流做得了"，接线是"我们塞得进输入"，两者缺一不可；
 * 2. 声明 `i2v` / `fl2v` / `v2v` 时，模板里必须有首帧占位（`{{START_IMAGE}}` 或 `{{START_IMAGE_NAME}}`）——
 *    没有占位就说明**我们没地方塞那张图**，那种情况下报"支持 i2v"是假的；
 * 3. 被剔除的每一条都写进 `unavailableReasons`（**不静默剔除**）；
 *    而"这个判断是从哪来的"走**单独的 `note`**（它不是"不支持什么"，混进 reasons 会让
 *    自检结论读成"支持 A；不支持 能力位按模板声明判定"—— 实测踩过）。
 */
function resolveDeclaredModes(
  declaration: ComfyTemplateDeclaration,
  template: WorkflowTemplate,
  unavailableReasons: string[],
): { modes: GenerationMode[]; note: string } {
  const placeholders = templatePlaceholders(template);
  const usable: GenerationMode[] = [];
  const rejected: string[] = [];

  for (const mode of declaration.modes) {
    // 未接线的模式不在这里单独说 —— 由下面的 `unwired` 统一回答（避免同一件事说两遍）
    if (!COMFY_WIRED_MODES.includes(mode)) continue;
    // V2.77：`upscale` 也要一张输入图（模板里必须有 START_IMAGE_NAME 才塞得进去）
    const needsFirstFrame =
      mode === 'i2v' ||
      mode === 'fl2v' ||
      mode === 'v2v' ||
      mode === 'upscale' ||
      mode === 'inpaint';
    if (needsFirstFrame && !placeholders.has('START_IMAGE') && !placeholders.has('START_IMAGE_NAME')) {
      rejected.push(`${mode}（模板里没有 START_IMAGE / START_IMAGE_NAME 占位，我们没有地方塞首帧）`);
      continue;
    }
    // V2.104：首尾帧还要**尾帧槽**（有首帧没尾帧 = 只能做 i2v，那不是 fl2v）
    if (mode === 'fl2v' && !placeholders.has('LAST_IMAGE') && !placeholders.has('LAST_IMAGE_NAME')) {
      rejected.push('fl2v（模板里没有 LAST_IMAGE / LAST_IMAGE_NAME 占位，我们没有地方塞尾帧）');
      continue;
    }
    // V2.78：局部重绘还要一份蒙版（没有 MASK_IMAGE_NAME 就没地方塞蒙版）
    if (mode === 'inpaint' && !placeholders.has('MASK_IMAGE_NAME')) {
      rejected.push('inpaint（模板里没有 MASK_IMAGE_NAME 占位，蒙版塞不进去）');
      continue;
    }
    // V2.79：扩图要有四边外扩的旋钮（没有 PAD_LEFT 说明这套图不是按扩图搭的）
    if (mode === 'outpaint' && !placeholders.has('PAD_LEFT')) {
      rejected.push('outpaint（模板里没有 PAD_LEFT 等外扩占位，画布撑不开）');
      continue;
    }
    usable.push(mode);
  }

  // 契约 §19-2 要求"同时说出支持什么与不支持什么"——下面是两种"不支持"：
  // ① **本仓未接线**的模式（与模板无关，永远不可用）；② 已接线但**这份模板没声明**的模式。
  const unwired = (GenerationModeSchema.options as readonly string[]).filter(
    (mode) => !(COMFY_WIRED_MODES as readonly string[]).includes(mode),
  );
  if (unwired.length > 0) {
    unavailableReasons.push(
      `${unwired.join(' / ')}：本仓还没把它们的输入接进工作流（见 CONTRACT §19-8）`,
    );
  }
  const declared = new Set<GenerationMode>(declaration.modes);
  const notDeclared = COMFY_WIRED_MODES.filter((mode) => !declared.has(mode));
  if (notDeclared.length > 0) {
    unavailableReasons.push(`这套模板没有声明 ${notDeclared.join(' / ')}`);
  }
  if (rejected.length > 0) {
    unavailableReasons.push(`模板声明里有 ${rejected.join('、')} —— 已如实不提供`);
  }

  const label = declaration.label === undefined ? '' : ` · ${declaration.label}`;
  const note =
    `判定依据：模板声明「${declaration.modes.join(' / ')}${label}」` +
    (declaration.notes === undefined ? '' : ` —— ${declaration.notes}`);
  return { modes: usable, note };
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
 * 按**模板声明**对齐帧数（V2.101）：给了 `frameAlign` 就按它的 `mod/offset`，没给就走 Wan 的 `4n+1`。
 *
 * 与 `alignFrames` 一样**向上取到最近的合法值**（宁可略长，也不让成片比请求短一截）：
 * H3 的合法序列是 5 / 22 / 39 / 56 / 73 / 90 / 107 / 124 …，
 * 5 秒 @24fps = 120 → **124**（5.17s），对齐结果再喂一次也不会变（幂等）。
 */
export function alignFramesTo(value: number, align?: FrameAlign): number {
  if (align === undefined) return alignFrames(value);
  const { mod, offset } = align;
  const target = Math.max(offset, Math.ceil(value));
  const delta = (offset - (target % mod) + mod) % mod;
  return target + delta;
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
  /**
   * 单次提交最多消费几张参考图（V2.76 / B 路线）。
   *
   * 这是**实例能力**，不是产品上限：10GB 卡实测 2 张 12s、4 张 21s、9 张 56s、12 张 130s，
   * 所以默认 4；租到 24GB+ 的机器再用 `COMFYUI_MAX_REFERENCES` 调高（封顶 12）。
   */
  maxReferences: number;
  /**
   * V2.77：放大模型文件名（`models/upscale_models/` 下）。
   * 换模型只改 env，不用发版 —— 与其它档位同一取向。
   */
  upscaleModel: string;
}

export const COMFY_DEFAULT_TUNING: ComfyTuning = {
  maxPixels: COMFY_MAX_PIXELS,
  steps: COMFY_DEFAULT_STEPS,
  cfg: COMFY_DEFAULT_CFG,
  shift: COMFY_DEFAULT_SHIFT,
  fps: COMFY_FPS,
  dtype: 'fp8_e4m3fn',
  maxReferences: 4,
  upscaleModel: '4x-UltraSharp.pth',
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
    // 封顶 12（产品结构上限），避免 env 写成 999 之后用户连满 999 张再失败
    maxReferences: Math.min(
      12,
      readPositiveInt(env.COMFYUI_MAX_REFERENCES, COMFY_DEFAULT_TUNING.maxReferences),
    ),
    upscaleModel:
      env.COMFYUI_UPSCALE_MODEL?.trim() === undefined ||
      env.COMFYUI_UPSCALE_MODEL?.trim() === ''
        ? COMFY_DEFAULT_TUNING.upscaleModel
        : env.COMFYUI_UPSCALE_MODEL.trim(),
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
 * 四条规则：
 * 1. 有 `request.resolution` 就用它（用户明确要的尺寸优先）；
 * 2. 否则按 `aspectRatio` 取实测基础档（**图片模式走图片档**，V2.40）；
 * 3. 超出像素预算 → **等比缩小**并如实告警（图片档与视频档预算各自独立）；
 * 4. 最后一律对齐 32。
 *
 * ⚠️ 告警里的数字是**对齐之后**的值 —— 早先写的是未对齐值（实测：告警说"缩到 632×632"，
 * 而实际提交/落盘的是 640×640），用户看到的数字与事实对不上，2026-10-16 顺手修掉。
 */
export function planComfyDimensions(
  request: VideoGenerateRequest,
  maxPixels: number = COMFY_DEFAULT_TUNING.maxPixels,
  imageMaxPixels: number = COMFY_IMAGE_MAX_PIXELS,
): ComfyDimensionPlan {
  const warnings: string[] = [];
  const isImage = request.mode === 't2i';
  const budget = isImage ? imageMaxPixels : maxPixels;
  const table = isImage ? IMAGE_BASE_DIMENSIONS : BASE_DIMENSIONS;
  const base =
    request.resolution === undefined
      ? (table[request.aspectRatio] ?? table['16:9'])
      : { width: request.resolution.width, height: request.resolution.height };

  const pixels = base.width * base.height;
  let scale = 1;
  if (pixels > budget) scale = Math.sqrt(budget / pixels);

  const width = alignDimension(base.width * scale);
  const height = alignDimension(base.height * scale);

  if (pixels > budget) {
    warnings.push(
      `请求尺寸 ${base.width}×${base.height}（${Math.round(pixels / 1000)}K 像素）超过本地${isImage ? '图片' : ''}档上限 ` +
        `${Math.round(budget / 1000)}K 像素 —— 已等比缩小到 ${width}×${height}` +
        `（这个上限可用 ${isImage ? 'COMFYUI_IMAGE_MAX_PIXELS' : 'COMFYUI_MAX_PIXELS'} 调 —— 默认值是 10GB 档的实测上限）`,
    );
  }

  return { width, height, warnings };
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

/**
 * V2.88（D-1 实测发现）：**参考张数少于模板静态槽位时，把整条断掉的参考链接剪掉**。
 *
 * ## 症状
 * 用户模板 `flux2-klein-t2i-ref2` 有两个静态参考槽（`56` / `57` + `77/78` + `79/80` 两级
 * `ReferenceLatent`）。只给 **1 张**参考时，第二槽的 `LoadImage.image` 没有值 →
 * `renderWorkflow` 按规则 2 删掉这个键 → ComfyUI 报
 * `节点 57：Exception when validating inner node`，整条任务失败。
 * 这条路径不是边角：**画布单参考派生编辑**与**编排图片链的第一个下游**都是"只给 1 张"。
 *
 * ## 为什么不是"把同一张图填两次"
 * 那会悄悄把同一份参考的权重翻倍（等于改了用户的参数），而且换模板就失效。
 *
 * ## 做法（图手术，可判定）
 * 1. `LoadImage` 没有 `image` → 无效；
 * 2. 引用了无效节点的 → 也无效（传播到不动点）；
 * 3. 删掉无效节点后，**`ReferenceLatent` 的上游把它的 `conditioning` 接回去**
 *    （跳过这一级参考，链自然短路）；其余找不到替代的引用 → **抛错**（不交一份坏图给上游）。
 *
 * 用到的都是 ComfyUI 图的基本形状（`[nodeId, slot]`），不引入模板新语法。
 */
export function pruneDanglingNodes(workflow: ComfyWorkflow): ComfyWorkflow {
  const work = JSON.parse(JSON.stringify(workflow)) as ComfyWorkflow;
  const invalid = new Set<string>();
  for (const [id, node] of Object.entries(work)) {
    if (node.class_type === 'LoadImage' && typeof node.inputs['image'] !== 'string') {
      invalid.add(id);
    }
  }
  if (invalid.size === 0) return work;

  const canBypass = (id: string): boolean => work[id]?.class_type === 'ReferenceLatent';

  for (let changed = true; changed; ) {
    changed = false;
    for (const [id, node] of Object.entries(work)) {
      if (invalid.has(id)) continue;
      // 引用了一个**可短路**的 ReferenceLatent 不算坏：它会在改写阶段接到上一级
      const broken = Object.values(node.inputs).some((value) => {
        const link = asNodeLink(value);
        return link !== null && invalid.has(link[0]) && !canBypass(link[0]);
      });
      if (broken) {
        invalid.add(id);
        changed = true;
      }
    }
  }

  const bypass = (id: string): [string, number] | null => {
    const node = work[id];
    if (node === undefined) return null;
    // 参考级联：跳过这一级 ReferenceLatent，接到它的条件输入上
    if (node.class_type === 'ReferenceLatent') return asNodeLink(node.inputs['conditioning']);
    return null;
  };

  const resolve = (link: [string, number], depth = 0): [string, number] => {
    if (depth > 16) throw new Error('参考链过深，无法重建工作流');
    if (!invalid.has(link[0])) return link;
    const fallback = bypass(link[0]);
    if (fallback === null) {
      throw new Error(`模板节点 ${link[0]} 缺少输入且没有可替代的上游 —— 请检查模板或减少参考张数`);
    }
    return resolve(fallback, depth + 1);
  };

  const pruned: ComfyWorkflow = {};
  for (const [id, node] of Object.entries(work)) {
    if (invalid.has(id)) continue;
    const inputs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node.inputs)) {
      const link = asNodeLink(value);
      inputs[key] = link === null ? value : resolve(link);
    }
    pruned[id] = { class_type: node.class_type, inputs };
  }
  // 剪空了说明整条链都靠那张缺失的图 —— 交空图给上游只会得到一句更难懂的报错
  if (Object.keys(pruned).length === 0) {
    throw new Error('工作流被剪空：模板节点缺少必要输入且没有可替代的上游 —— 请检查模板或减少参考张数');
  }
  return pruned;
}

/** `[nodeId, slot]` 形状的引用（ComfyUI API 格式里唯一的一种连接写法） */
function asNodeLink(value: unknown): [string, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [id, slot] = value;
  return typeof id === 'string' && typeof slot === 'number' ? [id, slot] : null;
}

export function renderWorkflow(template: WorkflowTemplate, values: WorkflowValues): ComfyWorkflow {
  const workflow: ComfyWorkflow = {};
  /** 被 `_dropWhenMissing` 丢掉的节点 —— 指向它们的输入也要一起消失，否则上游报 "validating inner node: '6'" */
  const dropped = new Set<string>();

  for (const [nodeId, node] of Object.entries(template)) {
    const dropWhenMissing = node['_dropWhenMissing'];
    if (
      Array.isArray(dropWhenMissing) &&
      dropWhenMissing.some((key) => values[String(key)] === undefined)
    ) {
      dropped.add(nodeId);
      continue; // 规则 3：条件节点
    }
    const classType = node['class_type'];
    if (typeof classType !== 'string') continue; // 模板写坏了不至于抛错
    const inputs = renderValue(node['inputs'], values);
    if (typeof inputs !== 'object' || inputs === null) continue;
    workflow[nodeId] = { class_type: classType, inputs: inputs as ComfyNodeInputs };
  }

  // 规则 3 的补完（V2.101 / 2026-10-30 真机）：条件节点消失后，**下游指向它的输入必须一起删掉**。
  // 踩过的实际症状：H3 模板里 t2v 丢掉 LoadImage(6)，但 MiniMaxH3ImageToVideo 还写着
  // `first_frame: ["6",0]`，ComfyUI 直接拒收 —— `Exception when validating inner node: '6'`。
  if (dropped.size > 0) {
    for (const node of Object.values(workflow)) {
      for (const [key, value] of Object.entries(node.inputs)) {
        const link = asNodeLink(value);
        if (link !== null && dropped.has(link[0])) delete node.inputs[key];
      }
    }
  }
  return workflow;
}

/**
 * 模板里用到的**全部占位符名**（含嵌在数组 / 对象里的那些）。
 *
 * 用途：能力位判定时回答"这套模板**有没有**放首帧的位置"——
 * 声明了 `i2v` 却没有任何 `{{START_IMAGE}}` / `{{START_IMAGE_NAME}}` 占位时，
 * 我们**没地方塞那张图**，那种"支持 i2v"是假的（V2.39）。
 */
export function templatePlaceholders(template: WorkflowTemplate): Set<string> {
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      const match = PLACEHOLDER_ONLY.exec(value);
      if (match !== null) found.add(match[1]);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    const record = asRecord(value);
    if (record !== null) for (const item of Object.values(record)) walk(item);
  };
  walk(template);
  return found;
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

/**
 * 内置模板②：**FLUX.2 Klein 4B（distilled）· 文生图**（V2.40）。
 *
 * 与官方 `image_flux2_klein_text_to_image.json` 的子图
 * "Text to Image (Flux.2 Klein 4B Distilled)" **同构**；节点与字段名都取自
 * `GET /object_info`（实测过，不是猜的）。三处刻意的写法：
 * - **`steps: 4` / `cfg: 1` 写死在模板里** —— 那是"蒸馏版"的参数特征（换 base 版模型 = 换模板）；
 * - **不用负向提示词**：蒸馏版 CFG=1，负向走 `ConditioningZeroOut`（给它负向词没有意义，
 *   这一点写在声明 notes 里，而不是让用户填了以后**静默无效**）；
 * - 产物交给 `SaveImage`（→ 图片产物走 `outputImageUrl`，不是视频）。
 */
export const FLUX2_KLEIN_T2I_TEMPLATE: WorkflowTemplate = {
  '70': {
    class_type: 'UNETLoader',
    inputs: { unet_name: '{{UNET_NAME}}', weight_dtype: '{{WEIGHT_DTYPE}}' },
  },
  '71': {
    class_type: 'CLIPLoader',
    inputs: { clip_name: '{{CLIP_NAME}}', type: '{{CLIP_TYPE}}' },
  },
  '72': { class_type: 'VAELoader', inputs: { vae_name: '{{VAE_NAME}}' } },
  '74': { class_type: 'CLIPTextEncode', inputs: { text: '{{PROMPT}}', clip: ['71', 0] } },
  '76': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['74', 0] } },
  '63': {
    class_type: 'CFGGuider',
    inputs: { model: ['70', 0], positive: ['74', 0], negative: ['76', 0], cfg: 1 },
  },
  '62': {
    class_type: 'Flux2Scheduler',
    inputs: { steps: 4, width: '{{WIDTH}}', height: '{{HEIGHT}}' },
  },
  '61': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
  '73': { class_type: 'RandomNoise', inputs: { noise_seed: '{{SEED}}' } },
  '66': {
    class_type: 'EmptyFlux2LatentImage',
    inputs: { width: '{{WIDTH}}', height: '{{HEIGHT}}', batch_size: 1 },
  },
  '64': {
    class_type: 'SamplerCustomAdvanced',
    inputs: {
      noise: ['73', 0],
      guider: ['63', 0],
      sampler: ['61', 0],
      sigmas: ['62', 0],
      latent_image: ['66', 0],
    },
  },
  '65': { class_type: 'VAEDecode', inputs: { samples: ['64', 0], vae: ['72', 0] } },
  '9': {
    class_type: 'SaveImage',
    inputs: { images: ['65', 0], filename_prefix: '{{OUTPUT_PREFIX}}' },
  },
};

/** 内置图片模板的声明（`modelMatch` 是**错配防护**：装了别的图片模型时如实不可用，不硬跑） */
export const FLUX2_KLEIN_T2I_DECLARATION: ComfyTemplateDeclaration = {
  modes: ['t2i'],
  modelMatch: { unet: 'klein', clip: 'qwen_3', vae: 'flux2', clipType: 'flux2' },
  label: 'FLUX.2 Klein 4B（distilled · 文生图）',
  notes:
    '4 步 / CFG 1（蒸馏版参数写死在模板里）；不使用负向提示词；' +
    '需要 diffusion_models 里有 flux-2-klein-4b、text_encoders 里有 qwen_3_4b、vae 里有 flux2-vae',
};

/**
 * S9-A1：带**参考图**的 Klein 变体（ReferenceLatent 机制）——跨镜角色一致性的生成侧基础。
 *
 * 与普通 t2i 的差异：参考图经 `LoadImage → VAEEncode → ReferenceLatent` 注入 conditioning
 * （FLUX.2 edit 的标准做法：参考图进条件而不是替换初始 latent），模型是同一套 Klein 权重。
 * `referenceImage: true` 让 provider 在"t2i + 带首帧参考"的提交时**优先选它**，
 * 纯文生图仍走普通模板（参考图版不该被无图提交劫持）。
 */
export const FLUX2_KLEIN_T2I_REF_TEMPLATE: WorkflowTemplate = {
  '70': {
    class_type: 'UNETLoader',
    inputs: { unet_name: '{{UNET_NAME}}', weight_dtype: '{{WEIGHT_DTYPE}}' },
  },
  '71': {
    class_type: 'CLIPLoader',
    inputs: { clip_name: '{{CLIP_NAME}}', type: '{{CLIP_TYPE}}' },
  },
  '72': { class_type: 'VAELoader', inputs: { vae_name: '{{VAE_NAME}}' } },
  '56': { class_type: 'LoadImage', inputs: { image: '{{START_IMAGE_NAME}}' } },
  '77': { class_type: 'VAEEncode', inputs: { pixels: ['56', 0], vae: ['72', 0] } },
  '74': { class_type: 'CLIPTextEncode', inputs: { text: '{{PROMPT}}', clip: ['71', 0] } },
  '78': { class_type: 'ReferenceLatent', inputs: { conditioning: ['74', 0], latent: ['77', 0] } },
  '76': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['74', 0] } },
  '63': {
    class_type: 'CFGGuider',
    inputs: { model: ['70', 0], positive: ['78', 0], negative: ['76', 0], cfg: 1 },
  },
  '62': {
    class_type: 'Flux2Scheduler',
    inputs: { steps: 4, width: '{{WIDTH}}', height: '{{HEIGHT}}' },
  },
  '61': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
  '73': { class_type: 'RandomNoise', inputs: { noise_seed: '{{SEED}}' } },
  '66': {
    class_type: 'EmptyFlux2LatentImage',
    inputs: { width: '{{WIDTH}}', height: '{{HEIGHT}}', batch_size: 1 },
  },
  '64': {
    class_type: 'SamplerCustomAdvanced',
    inputs: {
      noise: ['73', 0],
      guider: ['63', 0],
      sampler: ['61', 0],
      sigmas: ['62', 0],
      latent_image: ['66', 0],
    },
  },
  '65': { class_type: 'VAEDecode', inputs: { samples: ['64', 0], vae: ['72', 0] } },
  '9': {
    class_type: 'SaveImage',
    inputs: { images: ['65', 0], filename_prefix: '{{OUTPUT_PREFIX}}' },
  },
};

export const FLUX2_KLEIN_T2I_REF_DECLARATION: ComfyTemplateDeclaration = {
  modes: ['t2i'],
  modelMatch: { unet: 'klein', clip: 'qwen_3', vae: 'flux2', clipType: 'flux2' },
  referenceImage: true,
  label: 'FLUX.2 Klein 4B（distilled · 参考图出图）',
  notes:
    '与文生图同一套权重；参考图经 ReferenceLatent 注入 conditioning（FLUX.2 edit 语义）。' +
    '用于"以首镜定妆图为准继续出后续镜头"的跨镜一致性；提交必须带 assets.firstFrameImage',
};

export interface ComfyWorkflowInput {
  models: ComfyModels;
  prompt: string;
  negativePrompt: string;
  mode: GenerationMode;
  width: number;
  height: number;
  frames: number;
  /** 模板声明的帧数对齐规则（V2.101；缺省 = Wan 的 `4n+1`） */
  frameAlign?: FrameAlign;
  fps?: number;
  seed: number;
  steps?: number;
  cfg?: number;
  shift?: number;
  dtype: string;
  /** i2v 的首帧在 ComfyUI 里的名字（`LoadImage.image`；由上传接口返回） */
  startImageName?: string;
  /**
   * V2.104：**尾帧**在 ComfyUI 里的名字（`fl2v` 用）。
   *
   * 与 `startImageName` 走同一条上传通道，但落进**另一个** LoadImage 节点 ——
   * 尾帧槽没有被填时那个节点整个消失，`last_frame` 这个键也随之删掉（模板占位符规则 2），
   * 于是同一份模板既能做 i2v 也能做 fl2v。
   */
  lastImageName?: string;
  /**
   * 多参考（V2.76 / B 路线）：按 `order` 排好的图片名。
   *
   * - 1 张：只用 `{{START_IMAGE_NAME}}`；
   * - 2 张：`{{START_IMAGE_NAME}}` + `{{REFERENCE_IMAGE_NAME}}`（模板自带两个槽）；
   * - 3 张以上：前两张同上，其余由 `appendReferenceChain` **动态追加**（模板不必预置槽位）。
   */
  referenceImageNames?: readonly string[];
  /**
   * V2.77：放大用的模型文件名（`models/upscale_models/` 下）。
   * 只有 `upscale` 模式会用到；缺省由 provider 的档位（`COMFYUI_UPSCALE_MODEL`）给。
   */
  upscaleModel?: string;
  /**
   * V2.77：放大后再缩放到的倍率（相对**原图**）。
   * 4x 模型跑完之后：4x → 1、2x → 0.5（先吃满模型再降采样，比直接要 2x 干净）。
   */
  upscaleScaleBy?: number;
  /**
   * V2.78：局部重绘的蒙版在 ComfyUI 里的名字（`LoadImageMask.image`）。
   * 只有 `inpaint` 模式会用到；缺省 = 模板里的 `LoadImageMask` 会被删掉（t2v/t2i 不该出现它）。
   */
  maskImageName?: string;
  /** V2.78：蒙版向外扩张的像素（默认 0，给"边缘太硬"留个旋钮） */
  maskGrow?: number;
  /**
   * V2.79：扩图的四边外扩像素（8 的整数倍）。
   * 只对 `outpaint` 有意义；缺省时模板里的 `ImagePadForOutpaint` 会拿到 0（等于不扩）。
   */
  pad?: { left: number; top: number; right: number; bottom: number; feathering: number };
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
  const references = input.referenceImageNames ?? [];
  const startName = references[0] ?? input.startImageName;
  const lastName = input.lastImageName;
  const rendered = renderWorkflow(template, {
    UNET_NAME: input.models.unet,
    CLIP_NAME: input.models.clip,
    CLIP_TYPE: input.models.clipType,
    VAE_NAME: input.models.vae,
    WEIGHT_DTYPE: input.dtype,
    PROMPT: input.prompt,
    NEGATIVE_PROMPT: input.negativePrompt,
    WIDTH: alignDimension(input.width),
    HEIGHT: alignDimension(input.height),
    FRAMES: alignFramesTo(input.frames, input.frameAlign),
    FPS: input.fps ?? COMFY_FPS,
    SEED: input.seed,
    STEPS: input.steps ?? COMFY_DEFAULT_STEPS,
    CFG: input.cfg ?? COMFY_DEFAULT_CFG,
    SHIFT: input.shift ?? COMFY_DEFAULT_SHIFT,
    OUTPUT_PREFIX: input.outputPrefix,
    // t2v 时这两个都是 undefined → 键被删、`LoadImage` 节点也被删（模板里的 _dropWhenMissing）
    START_IMAGE_NAME: startName,
    // V2.104：尾帧（fl2v）—— 缺省时键被删、尾帧 LoadImage 节点也被删，模板退回 i2v/t2v 形态
    LAST_IMAGE_NAME: lastName,
    // V2.76：第二张参考（模板只有两个槽时用；>2 张的其余由 appendReferenceChain 追加）
    REFERENCE_IMAGE_NAME: references[1],
    // V2.77：放大模板的两个旋钮（别的模板里没有这两个占位符，值会被忽略）
    UPSCALE_MODEL: input.upscaleModel,
    UPSCALE_SCALE_BY: input.upscaleScaleBy,
    // V2.78：局部重绘的两张输入（底图走 START_IMAGE_NAME，蒙版走这里）
    MASK_IMAGE_NAME: input.maskImageName,
    MASK_GROW: input.maskGrow ?? 0,
    // V2.79：扩图的四边外扩
    PAD_LEFT: input.pad?.left ?? 0,
    PAD_TOP: input.pad?.top ?? 0,
    PAD_RIGHT: input.pad?.right ?? 0,
    PAD_BOTTOM: input.pad?.bottom ?? 0,
    PAD_FEATHERING: input.pad?.feathering ?? 40,
    // 连接目标按**模板自己的节点 id** 找（V2.104 起不再写死 `56`）：
    // 自定义模板只要有一个 `LoadImage.image = "{{START_IMAGE_NAME}}"` 的节点就会被认出来。
    START_IMAGE: startName === undefined ? undefined : [loadImageNodeIdFor(template, 'START_IMAGE_NAME') ?? '56', 0],
    // V2.104：尾帧同理（找不到节点就给 undefined → 键被删 —— 宁可退化成 i2v，也不给一条坏连线）
    LAST_IMAGE:
      lastName === undefined
        ? undefined
        : (() => {
            const id = loadImageNodeIdFor(template, 'LAST_IMAGE_NAME');
            return id === null ? undefined : [id, 0];
          })(),
  });
  // 追加链只新增 `{class_type, inputs}` 形状的节点，结果仍是 ComfyWorkflow
  return (references.length > 2 ? appendReferenceChain(rendered, references) : rendered) as ComfyWorkflow;
}

/**
 * 模板里"负责某张图"的 `LoadImage` 节点 id（V2.104）。
 *
 * 为什么不能像以前那样写死 `'56'`：那是**内置 Wan 模板**的节点号。用户换一份模板
 * （H3 的首帧是节点 6、尾帧是新加的 16）时，写死的连线会把"尾帧"接到一个不存在的节点上 ——
 * 提交被拒，报的还是一句 node_errors。按占位符反查节点号，模板就能自己决定编号。
 */
export function loadImageNodeIdFor(
  template: WorkflowTemplate,
  imagePlaceholder: 'START_IMAGE_NAME' | 'LAST_IMAGE_NAME' | 'REFERENCE_IMAGE_NAME' | 'MASK_IMAGE_NAME',
): string | null {
  const wanted = `{{${imagePlaceholder}}}`;
  for (const [id, node] of Object.entries(template)) {
    if (node['class_type'] !== 'LoadImage' && node['class_type'] !== 'LoadImageMask') continue;
    const inputs = node['inputs'];
    if (typeof inputs !== 'object' || inputs === null) continue;
    if ((inputs as Record<string, unknown>)['image'] === wanted) return id;
  }
  return null;
}

/** 模板能静态吃几张参考图（0 = 没有输入槽） */
export function countTemplateReferenceSlots(template: WorkflowTemplate): number {
  const placeholders = templatePlaceholders(template);
  if (placeholders.has('REFERENCE_IMAGE_NAME')) return 2;
  if (placeholders.has('START_IMAGE_NAME') || placeholders.has('START_IMAGE')) return 1;
  return 0;
}

/**
 * 把第 3 张起的参考接进 `ReferenceLatent` 链（V2.76 / B 路线）。
 *
 * 形状与实测一致：`cond → ref1 → ref2 → … → refN`，每级 = `LoadImage → VAEEncode → ReferenceLatent`。
 * 追加的节点 id 固定前缀 `refchain_<i>_*`（与模板 id 冲突直接抛错，不覆盖用户模板里的节点）。
 *
 * 为什么不在模板里预置 12 个槽：那会把"张数"写死进每份模板，而张数是**实例能力**（`COMFYUI_MAX_REFERENCES`）。
 */
export function appendReferenceChain(
  workflow: WorkflowTemplate,
  imageNames: readonly string[],
): WorkflowTemplate {
  if (imageNames.length <= 2) return workflow;

  const cloned = JSON.parse(JSON.stringify(workflow)) as WorkflowTemplate;
  const nodeIds = Object.keys(cloned);
  const refLatents = nodeIds.filter((id) => cloned[id]?.['class_type'] === 'ReferenceLatent');
  if (refLatents.length === 0) {
    throw new Error('模板里没有 ReferenceLatent 节点，无法接多参考（需要 FLUX.2 风格的参考工作流）');
  }

  const isRefTo = (value: unknown, id: string): boolean =>
    Array.isArray(value) && value.length === 2 && value[0] === id && value[1] === 0;
  // 链尾 = 没有被其它 ReferenceLatent 当作 conditioning 的那个
  const tails = refLatents.filter(
    (id) =>
      !refLatents.some(
        (other) => other !== id && isRefTo((cloned[other]?.['inputs'] as Record<string, unknown> | undefined)?.['conditioning'], id),
      ),
  );
  const originalTail = tails[tails.length - 1] ?? refLatents[refLatents.length - 1];
  if (originalTail === undefined) throw new Error('无法定位参考链尾节点');

  // VAE 引用从任意 VAEEncode 上取（模板自己声明用哪个 VAE）
  const encoded = nodeIds.find((id) => cloned[id]?.['class_type'] === 'VAEEncode');
  const vaeRef = encoded === undefined
    ? undefined
    : (cloned[encoded]?.['inputs'] as Record<string, unknown> | undefined)?.['vae'];
  if (!Array.isArray(vaeRef)) throw new Error('模板里没有 VAEEncode 的 vae 连接，无法追加参考链');

  const chainIds = new Set<string>();
  let tail: string = originalTail;
  for (let index = 2; index < imageNames.length; index += 1) {
    const imageId = `refchain_${index}_img`;
    const encodeId = `refchain_${index}_enc`;
    const refId = `refchain_${index}_ref`;
    for (const id of [imageId, encodeId, refId]) {
      if (cloned[id] !== undefined) throw new Error(`模板里已存在节点 id ${id}，无法追加参考链`);
    }
    cloned[imageId] = { class_type: 'LoadImage', inputs: { image: imageNames[index] } };
    cloned[encodeId] = { class_type: 'VAEEncode', inputs: { pixels: [imageId, 0], vae: vaeRef } };
    cloned[refId] = {
      class_type: 'ReferenceLatent',
      inputs: { conditioning: [tail, 0], latent: [encodeId, 0] },
    };
    chainIds.add(imageId);
    chainIds.add(encodeId);
    chainIds.add(refId);
    tail = refId;
  }

  // 把"用旧链尾的地方"改指新链尾（新链节点自己不动，否则会把链打断）
  const retarget = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      if (value.length === 2 && value[0] === originalTail && value[1] === 0) return [tail, 0];
      return value.map(retarget);
    }
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        out[key] = retarget(inner);
      }
      return out;
    }
    return value;
  };
  for (const [id, node] of Object.entries(cloned)) {
    if (chainIds.has(id) || node === undefined) continue;
    const inputs = node['inputs'];
    if (inputs === undefined || inputs === null || typeof inputs !== 'object') continue;
    node['inputs'] = retarget(inputs) as Record<string, unknown>;
  }

  return cloned;
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

/** 视频容器后缀（`SaveVideo` 的 `format: 'auto'` 实测落 mp4；webm 等一并认下） */
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mkv', '.mov', '.avi'] as const;

/**
 * 音频后缀。**它们绝不能被当成视频产物** —— 把音频字节写成 `<taskId>.mp4`
 * 是一次静默出错：任务报成功、用户拿到一个打不开的"视频"。
 */
const AUDIO_EXTENSIONS = ['.wav', '.mp3', '.flac', '.m4a', '.aac', '.opus', '.ogg'] as const;

/**
 * 从产物清单里挑**视频**（V2.39；替代原先的 `outputs[0]`）。
 *
 * ## 为什么不能直接取第一个
 * 实测形状里产物是"节点 id → 数组"的对象，`Object.values()` 的顺序**取决于节点 id**。
 * Wan 的那套模板只有一个 `SaveVideo`，取第一个没问题；但 H3 这类模型可能**同时输出
 * 视频 + 音频两个文件**（SaveVideo + SaveAudio），先遇到哪个纯看 id —— 取到音频就会
 * 把音频写进 `.mp4`（见上）。
 *
 * 规则：视频容器优先 → 其次是"非音频"的第一个（保持旧行为）→ **只有音频则返回 `undefined`**
 * （调用方据此如实报错，而不是硬塞一个音频文件当视频）。
 */
export function pickComfyVideoArtifact(artifacts: ComfyArtifact[]): ComfyArtifact | undefined {
  const video = artifacts.find((item) =>
    (VIDEO_EXTENSIONS as readonly string[]).includes(extensionOf(item.filename)),
  );
  if (video !== undefined) return video;

  const nonAudio = artifacts.filter(
    (item) => !(AUDIO_EXTENSIONS as readonly string[]).includes(extensionOf(item.filename)),
  );
  return nonAudio[0];
}

/** 图片容器后缀（`SaveImage` 落 png；webp / jpeg 一并认下） */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'] as const;

/**
 * 从产物清单里挑**图片**（V2.40）。
 *
 * 与视频挑选同一条纪律：不假设节点 id、**不把别的类型当图片**；
 * 一个都没有就返回 `undefined`（调用方据此如实报错，而不是塞一个 mp4 当图片）。
 */
export function pickComfyImageArtifact(artifacts: ComfyArtifact[]): ComfyArtifact | undefined {
  return artifacts.find((item) =>
    (IMAGE_EXTENSIONS as readonly string[]).includes(extensionOf(item.filename)),
  );
}

/** 取小写扩展名（含点）；没有点则空串 */
function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot < 0 ? '' : filename.slice(dot).toLowerCase();
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
