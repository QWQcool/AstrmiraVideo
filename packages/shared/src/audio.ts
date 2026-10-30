import { z } from 'zod';
import { AUDIO_MODES, AspectRatioSchema, type AudioMode, type VideoGenerateRequest } from './request.js';

/**
 * 音频产物（V2.103 / Phase 2 · 「声音」）。
 *
 * ## 为什么音频要挤进 `VideoGenerateRequest` 的信封
 * 产物要**走既有队列与画廊**：排队、本地单卡互斥、终态通知、历史分页、成本口径全都复用，
 * 一条音频任务和一条视频任务在库里长得一样（`tasks` 表、同样的状态机）。
 * 代价是信封里的画面字段对音频没有意义 —— `aspectRatio` 由路由固定填 `'16:9'`，
 * **服务端与音频 provider 都不读它**（读了才是错）。
 *
 * ## 隐私必须如实写进界面
 * 三个引擎里**只有 MiMo 是第三方云**：文本会离开这台机器。UI 不是"提一句"，
 * 而是把 `privacy` 原文贴在生成按钮下方 —— 用户有权在点之前知道。
 */

/** 一个音频引擎的**事实**（能力、数据去向、许可）。前端直接读这张表，不各写一份。 */
export interface AudioEngineInfo {
  readonly label: string;
  /** 支持哪些音频模式 */
  readonly modes: readonly AudioMode[];
  /** 数据去哪：与 `ExecutedBySchema` 同口径（cloud = 文本发到上游） */
  readonly executedBy: 'cloud' | 'host-local';
  /** 给用户看的一句话：这段文本/提示词会离开这台机器吗 */
  readonly privacy: string;
  /** 模型/服务许可（**只写能核实的**，自用与商用的差别见 docs/LOCAL-GPU-DEPLOY.md §2.5） */
  readonly license: string;
  /** 配哪个环境变量才会启用（缺省配置时能力位如实不可用，不假装能跑） */
  readonly env: string;
  /** 这条路已验证过的**真实**能力边界（例如"H3 的音频与画面联合生成，不能单独出 BGM"） */
  readonly notes?: string;
}

/**
 * 引擎表（唯一一份）。
 *
 * ⚠️ 这张表是**能力位与文案的事实源**：前端据此显示引擎选项与隐私提示，
 * 后端据此判定"这个引擎支不支持这个模式"。两处各写一遍必然漂移。
 */
export const AUDIO_ENGINES = {
  'mimo-tts': {
    label: 'MiMo TTS（小米 · 第三方云）',
    modes: ['tts'],
    executedBy: 'cloud',
    privacy: '文本会发送到 api.xiaomimimo.com（第三方云）。要"不出网"请选本机的 GPT-SoVITS。',
    license: '受服务商条款约束（本仓不分发模型权重）；自用与商用前请自行核对最新条款',
    env: 'MIMO_API_KEY',
    notes: '24kHz 单声道；实测 2–3.5× 实时（3.5s 音频约 3.6s）；音色见 AUDIO_VOICES',
  },
  'host-stable-audio': {
    label: 'Stable Audio 3 Small（本机 ComfyUI）',
    modes: ['bgm', 'sfx'],
    executedBy: 'host-local',
    privacy: '在本机 ComfyUI 上生成，提示词与音频都不离开这台机器。',
    license: 'Stability AI Community License（自用可以；卖成品前逐条读协议）',
    env: 'COMFYUI_AUDIO_BASE',
    notes: '44.1kHz 立体声；5s 配乐冷态约 39–47s（含加载），热态更快；单次最长 30s',
  },
} as const satisfies Record<string, AudioEngineInfo>;

export const AudioEngineSchema = z.enum(['mimo-tts', 'host-stable-audio']);
export type AudioEngine = z.infer<typeof AudioEngineSchema>;

/** 全部音频引擎（顺序 = 表的书写顺序；`GET /api/audio/engines` 按它逐条答"此刻能不能用"） */
export const AUDIO_ENGINE_IDS = AudioEngineSchema.options;

/**
 * 一个引擎**此刻**能不能用（V2.106 / `GET /api/audio/engines`）。
 *
 * ⚠️ 与"配了没配"不同：配了 Key 不等于能出音频，`COMFYUI_AUDIO_BASE` 指过去的那台
 * 也不一定装了 Stable Audio 权重。`reason` 就是**缺什么**的原话，界面直接显示。
 */
export const AudioEngineStatusSchema = z.object({
  engine: AudioEngineSchema,
  available: z.boolean(),
  reason: z.string().optional(),
});
export type AudioEngineStatus = z.infer<typeof AudioEngineStatusSchema>;

export const AudioEnginesResponseSchema = z.object({
  engines: z.array(AudioEngineStatusSchema),
});
export type AudioEnginesResponse = z.infer<typeof AudioEnginesResponseSchema>;

/** 引擎支不支持这个模式（表驱动，不猜） */
export function audioEngineSupports(engine: AudioEngine, mode: AudioMode): boolean {
  return (AUDIO_ENGINES[engine].modes as readonly AudioMode[]).includes(mode);
}

/** 某个模式有哪些引擎可用（界面按它渲染下拉，顺序 = 表的书写顺序） */
export function audioEnginesFor(mode: AudioMode): AudioEngine[] {
  return (Object.keys(AUDIO_ENGINES) as AudioEngine[]).filter((engine) =>
    audioEngineSupports(engine, mode),
  );
}

/**
 * MiMo 的音色（**实测可用**的 8 个；不列"可能支持"的）。
 * 中文四个 / 英文四个 —— 界面按语言分组显示。
 */
export const AUDIO_VOICES = [
  { id: '冰糖', label: '冰糖（中文 · 女声）', language: 'zh' },
  { id: '茉莉', label: '茉莉（中文 · 女声）', language: 'zh' },
  { id: '苏打', label: '苏打（中文 · 男声）', language: 'zh' },
  { id: '白桦', label: '白桦（中文 · 男声）', language: 'zh' },
  { id: 'Mia', label: 'Mia（英文 · 女声）', language: 'en' },
  { id: 'Chloe', label: 'Chloe（英文 · 女声）', language: 'en' },
  { id: 'Milo', label: 'Milo（英文 · 男声）', language: 'en' },
  { id: 'Dean', label: 'Dean（英文 · 男声）', language: 'en' },
] as const;

export const DEFAULT_AUDIO_VOICE = '冰糖';
/** 配音文本上限（一句旁白不该是一篇文章；超了在入口就拒，不让上游报错） */
export const MAX_AUDIO_TEXT_CHARS = 1000;
/** 配乐/音效时长（秒）：下限 1s、上限 30s（Stable Audio 单次窗口，实测 15–20s 正常） */
export const MIN_AUDIO_SECONDS = 1;
export const MAX_AUDIO_SECONDS = 30;

/**
 * `POST /api/audio` 的请求体（CONTRACT §30）。
 *
 * `text` 与 `prompt` 分开而不是合成一个字段：`tts` 要的是**念出来的字**（有标点、有断句），
 * `bgm`/`sfx` 要的是**给模型的描述**（"warm cinematic piano, no vocals"）。两者的写法完全不同，
 * 塞进同一个字段会让界面只能给出一个语焉不详的输入框。
 */
export const AudioGenerateRequestSchema = z
  .object({
    mode: z.enum(AUDIO_MODES),
    engine: AudioEngineSchema,
    /** tts 必填：要念的文本 */
    text: z.string().max(MAX_AUDIO_TEXT_CHARS).optional(),
    /** bgm / sfx 必填：给模型的描述 */
    prompt: z.string().max(500).optional(),
    /** tts 的音色（缺省用 DEFAULT_AUDIO_VOICE；本机引擎忽略它） */
    voice: z.string().min(1).max(32).optional(),
    /** tts 的情绪/风格指令（一句话） */
    style: z.string().max(200).optional(),
    /** bgm / sfx 的时长（秒）；tts 忽略它（时长由文本决定） */
    seconds: z.number().min(MIN_AUDIO_SECONDS).max(MAX_AUDIO_SECONDS).optional(),
    projectId: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (!audioEngineSupports(value.engine, value.mode)) {
      ctx.addIssue({
        code: 'custom',
        path: ['engine'],
        message: `引擎 ${value.engine} 不做 ${value.mode}（它支持：${AUDIO_ENGINES[value.engine].modes.join('、')}）`,
      });
    }
    if (value.mode === 'tts') {
      const text = (value.text ?? '').trim();
      if (text === '') {
        ctx.addIssue({ code: 'custom', path: ['text'], message: '配音需要 text（要念的文本）' });
      }
      if (value.prompt !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['prompt'], message: 'tts 不用 prompt，请填 text' });
      }
      if (value.seconds !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['seconds'],
          message: 'tts 的时长由文本决定，不接受 seconds',
        });
      }
      return;
    }
    const prompt = (value.prompt ?? '').trim();
    if (prompt === '') {
      ctx.addIssue({ code: 'custom', path: ['prompt'], message: '配乐/音效需要 prompt（描述）' });
    }
    if (value.text !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['text'], message: '配乐/音效用 prompt，不用 text' });
    }
    if (value.voice !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['voice'], message: '配乐/音效没有音色，请去掉 voice' });
    }
  });

export type AudioGenerateRequest = z.infer<typeof AudioGenerateRequestSchema>;

/**
 * 把音频请求**翻译**成队列认识的信封（纯函数，单测钉住）。
 *
 * 三条口径：
 * 1. `prompt` = `text`（tts）或 `prompt`（bgm/sfx）—— 信封里那个字段的语义是"给模型的输入"，
 *    音频恰好就是这两样之一，不做二次编码；
 * 2. `aspectRatio` 固定 `'16:9'`：**音频没有画面**，这个值不被任何代码读取（见文件头）；
 * 3. 引擎私有参数（音色 / 情绪 / 秒数）走 `options` —— 那是契约里"provider 私有参数"的位置。
 */
export function audioRequestToGenerateRequest(input: AudioGenerateRequest): VideoGenerateRequest {
  const prompt = input.mode === 'tts' ? (input.text ?? '') : (input.prompt ?? '');
  return {
    prompt,
    mode: input.mode,
    aspectRatio: AspectRatioSchema.parse('16:9'),
    provider: input.engine,
    options: {
      ...(input.voice === undefined ? {} : { voice: input.voice }),
      ...(input.style === undefined ? {} : { style: input.style }),
      ...(input.seconds === undefined ? {} : { seconds: input.seconds }),
    },
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
  };
}
