import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  AudioEngine,
  ProviderType,
  TaskProgress,
  VideoGenerateRequest,
  VideoProvider,
} from '@astrmira/shared';
import { DEFAULT_AUDIO_VOICE } from '@astrmira/shared';
import { runMediaTool } from '../../lib/ffmpeg.js';

/**
 * 音频 provider（V2.103 / Phase 2 ·「声音」）。
 *
 * ## 一个 provider 覆盖两条引擎
 * 它们的产品形状完全一样（`/media/<taskId>.wav` + `outputAudioUrl`），区别只在"谁在算"：
 * - `mimo-tts`：第三方云（文本离开这台机器）；
 * - `host-stable-audio`：本机 ComfyUI（数据不出机器）。
 *
 * 拆成两个类只会复制粘贴两份"写文件 + 置终态"，所以按 `engine` 分支。
 *
 * ## 三条如实边界
 * 1. **进度不编**：MiMo 是一次同步 HTTP（没有中间进度），Stable Audio 的 ComfyUI
 *    进度事件与视频模板的节点 id 不同、复用它只会给出错的百分比 —— 所以 `progressPercent`
 *    在终态之前**恒为 0**，只给一句人话。假进度条比没有进度条更糟（用户会以为它在跑）。
 * 2. **取消做不到**：MiMo 请求已发出、ComfyUI 的重启语义同视频轨（§19-6）——
 *    `cancel()` 恒返回 `false`，不让界面显示"已取消"而钱已经花了。
 * 3. **配置缺失就是没这个能力**：没有 Key / 连不上 ComfyUI → 注册表返回 null，
 *    上层报 `503 PROVIDER_UNAVAILABLE`（`checkHealth` 也给同样的话）；
 * 4. **"连得上" ≠ "有模型"**（2026-10-30 生产踩到）：视频轨那台 ComfyUI 的
 *    `models/checkpoints` 是空的（H3/MOSS 走 `diffusion_models`），只探 `/system_stats`
 *    会把"没装 Stable Audio"报成可用。所以 `checkHealth` 会查
 *    `/object_info/CheckpointLoaderSimple` 的候选清单，提交前也会再查一次。
 */

/** 一次生成的上限（Stable Audio 5s 配乐冷态实测 39–47s；给足加载余量） */
const DEFAULT_MAX_WAIT_MS = 10 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 1000;
/** MiMo 单次调用超时（实测 3.5s 音频约 3.6s；给到 120s 足够慢网） */
const MIMO_TIMEOUT_MS = 120_000;

const MIMO_DEFAULT_BASE_URL = 'https://api.xiaomimimo.com/v1/chat/completions';
const MIMO_DEFAULT_MODEL = 'mimo-v2.5-tts';
const SA3_DEFAULT_CLIP = 't5gemma_b_b_ul2.safetensors';
const SA3_DEFAULT_MUSIC = 'stable_audio_3_small_music.safetensors';
const SA3_DEFAULT_SFX = 'stable_audio_3_small_sfx.safetensors';

export interface AudioProviderOptions {
  id: ProviderType;
  name: string;
  engine: AudioEngine;
  outputDir: string;
  /** MiMo 的 Key（`MIMO_API_KEY`）；缺省 = 这个引擎不可用 */
  mimoKey?: string | null;
  /** 本机 ComfyUI 地址（`COMFYUI_AUDIO_BASE` / `COMFYUI_BASE_URL`）；缺省 = 不可用 */
  comfyBaseUrl?: string | null;
  /** 测试注入 */
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  maxWaitMs?: number;
}

interface PendingAudio {
  progress: TaskProgress;
}

/** MiMo 的响应里我们只需要这三样（其余字段不读、不落库） */
interface MimoPayload {
  choices?: { message?: { audio?: { data?: string } } }[];
  usage?: { total_tokens?: number; prompt_tokens?: number };
}

export class AudioProvider implements VideoProvider {
  readonly id: ProviderType;
  readonly name: string;

  private readonly engine: AudioEngine;
  private readonly outputDir: string;
  private readonly mimoKey: string | null;
  private readonly comfyBaseUrl: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly pollIntervalMs: number;
  private readonly maxWaitMs: number;
  private readonly tasks = new Map<string, PendingAudio>();

  constructor(options: AudioProviderOptions) {
    this.id = options.id;
    this.name = options.name;
    this.engine = options.engine;
    this.outputDir = options.outputDir;
    this.mimoKey = options.mimoKey ?? null;
    this.comfyBaseUrl = options.comfyBaseUrl ?? null;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  }

  async checkHealth(): Promise<{ available: boolean; reason?: string }> {
    if (this.engine === 'mimo-tts') {
      return this.mimoKey === null || this.mimoKey === ''
        ? { available: false, reason: '没有配置 MIMO_API_KEY：配音走第三方云，必须有 Key' }
        : { available: true };
    }
    if (this.comfyBaseUrl === null || this.comfyBaseUrl === '') {
      return {
        available: false,
        reason: '没有配置 COMFYUI_AUDIO_BASE：配乐/音效在本机 ComfyUI 上跑（刻意**不**复用 COMFYUI_BASE_URL，见文件头）',
      };
    }
    try {
      const response = await this.fetchImpl(`${this.comfyBaseUrl}/system_stats`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) {
        return { available: false, reason: `本机 ComfyUI 返回 HTTP ${response.status}` };
      }
      // 光"连得上"不算可用：这台 ComfyUI 上必须**真的装了** Stable Audio 权重。
      // 实测踩过：视频轨的 ComfyUI（H3/MOSS，只有 UNETLoader + diffusion_models）与音频轨
      // 常常不是同一台；只看 /system_stats 会报"可用"，用户点了才发现没模型。
      const missing = await this.missingCheckpoints();
      if (missing.length > 0) {
        return {
          available: false,
          reason: `这台 ComfyUI 没装 ${missing.join(' / ')}（Stable Audio 权重要放进 models/checkpoints）`,
        };
      }
      return { available: true };
    } catch (error) {
      return { available: false, reason: `连不上本机 ComfyUI：${(error as Error).message}` };
    }
  }

  /** 本实例需要的 checkpoint 里，这台 ComfyUI 缺哪几个（探测失败按"缺"处理 —— 宁可少报可用） */
  private async missingCheckpoints(): Promise<string[]> {
    const wanted = [this.musicCkpt(), this.sfxCkpt()];
    try {
      const response = await this.fetchImpl(
        `${this.comfyBaseUrl}/object_info/CheckpointLoaderSimple`,
        { signal: AbortSignal.timeout(6000) },
      );
      if (!response.ok) return wanted;
      const payload = (await response.json()) as {
        CheckpointLoaderSimple?: { input?: { required?: { ckpt_name?: unknown } } };
      };
      const raw = payload.CheckpointLoaderSimple?.input?.required?.ckpt_name;
      const candidates = Array.isArray(raw) && Array.isArray(raw[0]) ? (raw[0] as string[]) : [];
      return wanted.filter((name) => !candidates.includes(name));
    } catch {
      return wanted;
    }
  }

  private musicCkpt(): string {
    return process.env.SA3_CKPT_MUSIC?.trim() || SA3_DEFAULT_MUSIC;
  }

  private sfxCkpt(): string {
    return process.env.SA3_CKPT_SFX?.trim() || SA3_DEFAULT_SFX;
  }

  /**
   * 提交：立刻返回 taskId，真正的活干在后台。
   *
   * 为什么不 await：`/api/generate` 的语义是"入队并立刻返回 taskId"
   * （`FixtureLocalProvider` 那个 await 是开发期夹具的简化）；音频要 4–47s，
   * 阻塞提交会把 HTTP 超时风险搬进产品路径。
   */
  async submit(request: VideoGenerateRequest): Promise<{ taskId: string }> {
    const taskId = randomUUID();
    this.tasks.set(taskId, {
      progress: {
        taskId,
        status: 'running',
        progressPercent: 0,
        requestSnapshot: request,
        message: this.engine === 'mimo-tts' ? '云端合成中' : '本机渲染中（这个模型不上报进度）',
        createdAt: Date.now(),
      },
    });

    // 不 await：错误在 run 内部自己落成 failed，绝不冒泡到调用方
    void this.run(taskId, request).catch(() => {
      /* run 内部已把异常写成 failed；这里只防止 unhandledRejection */
    });

    return { taskId };
  }

  async queryStatus(taskId: string): Promise<TaskProgress> {
    const pending = this.tasks.get(taskId);
    if (pending === undefined) {
      // 与视频轨同口径：进程重启后内存里的任务就没了，如实抛错（上层归 failed）
      throw new Error(`音频 provider 未持有该任务：${taskId}（可能重启过）`);
    }
    return pending.progress;
  }

  async cancel(_taskId: string): Promise<boolean> {
    // 见文件头第 2 条：做不到就说做不到
    return false;
  }

  // ── 内部 ────────────────────────────────────────────────────────────────

  private async run(taskId: string, request: VideoGenerateRequest): Promise<void> {
    try {
      await mkdir(this.outputDir, { recursive: true });
      const outputName = `${taskId}.wav`;
      const outputPath = path.join(this.outputDir, outputName);

      if (request.mode === 'tts') {
        await this.synthesizeSpeech(request, outputPath);
      } else {
        await this.synthesizeMusic(taskId, request, outputPath);
      }

      const createdAt = this.tasks.get(taskId)?.progress.createdAt ?? Date.now();
      this.tasks.set(taskId, {
        progress: {
          taskId,
          status: 'succeeded',
          progressPercent: 100,
          requestSnapshot: request,
          outputAudioUrl: `/media/${outputName}`,
          message: request.mode === 'tts' ? '配音完成' : '配乐完成',
          createdAt,
        },
      });
    } catch (error) {
      const createdAt = this.tasks.get(taskId)?.progress.createdAt ?? Date.now();
      this.tasks.set(taskId, {
        progress: {
          taskId,
          status: 'failed',
          progressPercent: 0,
          requestSnapshot: request,
          createdAt,
          error: {
            code: 'UPSTREAM_ERROR',
            message: `音频生成失败：${(error as Error).message}`,
            // 终态：同一条请求重投不会变好（Key 错 / 模型缺 / 描述被拒），只会再花一次时间或钱
            disposition: 'terminal',
          },
        },
      });
    }
  }

  /** MiMo：一次 chat/completions，音频以 base64 回包 */
  private async synthesizeSpeech(request: VideoGenerateRequest, target: string): Promise<void> {
    if (this.mimoKey === null || this.mimoKey === '') {
      throw new Error('没有配置 MIMO_API_KEY');
    }
    const voice = readOptionString(request.options, 'voice') ?? DEFAULT_AUDIO_VOICE;
    const style = readOptionString(request.options, 'style') ?? '';
    const baseUrl = process.env.MIMO_TTS_BASE_URL?.trim() || MIMO_DEFAULT_BASE_URL;
    const model = process.env.MIMO_TTS_MODEL?.trim() || MIMO_DEFAULT_MODEL;

    const response = await this.fetchImpl(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.mimoKey}` },
      body: JSON.stringify({
        model,
        messages: [
          // 第一条是**风格指令**（用户的情绪要求），第二条才是要念的字 —— 这是 MiMo 的用法
          { role: 'user', content: style === '' ? '自然、克制地朗读' : style },
          { role: 'assistant', content: request.prompt },
        ],
        audio: { format: 'wav', voice },
      }),
      signal: AbortSignal.timeout(MIMO_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`MiMo HTTP ${response.status}：${text.slice(0, 300)}`);
    }
    let payload: MimoPayload;
    try {
      payload = JSON.parse(text) as MimoPayload;
    } catch {
      throw new Error(`MiMo 返回的不是 JSON：${text.slice(0, 200)}`);
    }
    const base64 = payload.choices?.[0]?.message?.audio?.data;
    if (typeof base64 !== 'string' || base64 === '') {
      throw new Error(`MiMo 响应里没有音频：${text.slice(0, 200)}`);
    }
    await writeFile(target, Buffer.from(base64, 'base64'));
  }

  /** Stable Audio 3（本机 ComfyUI）：提交 → 轮询 history → 取产物 → 转成 wav */
  private async synthesizeMusic(
    taskId: string,
    request: VideoGenerateRequest,
    target: string,
  ): Promise<void> {
    const base = this.comfyBaseUrl;
    if (base === null || base === '') throw new Error('没有配置 COMFYUI_AUDIO_BASE');

    const seconds = readOptionNumber(request.options, 'seconds') ?? 5;
    const isSfx = request.mode === 'sfx';
    const ckpt = isSfx ? this.sfxCkpt() : this.musicCkpt();
    const clip = process.env.SA3_CLIP?.trim() || SA3_DEFAULT_CLIP;

    // 提交前把"这台机器上没这个模型"说清楚 —— 让 ComfyUI 去报 node_errors 是在让用户猜
    const missing = await this.missingCheckpoints();
    if (missing.includes(ckpt)) {
      throw new Error(
        `这台 ComfyUI 没装 ${ckpt}（Stable Audio 权重要放进 models/checkpoints）` +
          (missing.length > 1 ? `；当前缺：${missing.join(' / ')}` : ''),
      );
    }

    const submit = await this.fetchImpl(`${base}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: buildStableAudioWorkflow({
          prompt: request.prompt,
          seconds,
          ckpt,
          clip,
          prefix: `astrmira/${taskId}`,
        }),
        client_id: 'astrmira-audio',
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const submitted = (await submit.json()) as {
      prompt_id?: string;
      error?: unknown;
      node_errors?: unknown;
    };
    if (!submit.ok || typeof submitted.prompt_id !== 'string') {
      throw new Error(`ComfyUI 提交被拒：${JSON.stringify(submitted).slice(0, 400)}`);
    }
    const promptId = submitted.prompt_id;

    const deadline = Date.now() + this.maxWaitMs;
    let entry: ComfyHistoryEntry | null = null;
    while (Date.now() < deadline) {
      await sleep(this.pollIntervalMs);
      const history = (await (
        await this.fetchImpl(`${base}/history/${promptId}`, { signal: AbortSignal.timeout(10_000) })
      ).json()) as Record<string, ComfyHistoryEntry>;
      const found = history[promptId];
      if (found !== undefined) {
        entry = found;
        break;
      }
    }
    if (entry === null) {
      throw new Error(`${Math.round(this.maxWaitMs / 1000)}s 内没有出结果（ComfyUI 可能还在跑）`);
    }
    if (entry.status?.status_str === 'error') {
      throw new Error(
        `ComfyUI 执行出错：${JSON.stringify(entry.status.messages ?? entry.status).slice(0, 400)}`,
      );
    }

    const files = Object.values(entry.outputs ?? {}).flatMap(
      (node) => node.audio ?? node.files ?? [],
    );
    const file = files.find((item) => typeof item.filename === 'string');
    const filename = file?.filename;
    if (filename === undefined) throw new Error('ComfyUI 没有产出音频文件');

    const viewUrl = `${base}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(file?.subfolder ?? '')}&type=${file?.type ?? 'output'}`;
    const download = await this.fetchImpl(viewUrl, { signal: AbortSignal.timeout(60_000) });
    if (!download.ok) throw new Error(`取产物失败 HTTP ${download.status}`);
    const raw = Buffer.from(await download.arrayBuffer());

    // ⚠️ SaveAudio 给的是 flac（实测），一律按**文件事实**转码 —— 不信扩展名
    const rawPath = `${target}.src`;
    await writeFile(rawPath, raw);
    await runMediaTool(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-i', rawPath, '-t', String(seconds),
        '-c:a', 'pcm_s16le', '-ar', '44100', '-ac', '2', target],
      { timeoutMs: 120_000 },
    );
  }
}

interface ComfyHistoryEntry {
  status?: { status_str?: string; messages?: unknown };
  outputs?: Record<string, { audio?: ComfyFileRef[]; files?: ComfyFileRef[] }>;
}

interface ComfyFileRef {
  filename?: string;
  subfolder?: string;
  type?: string;
}

/**
 * Stable Audio 3 的最小工作流（与 `D:\ComfyUI\audio-tools\sa3-cli.mjs` 同构）。
 *
 * 导出成函数而不是常量：prompt / 时长 / 模型名都是参数，写死一份常量会变成"改一处漏一处"。
 */
export function buildStableAudioWorkflow(input: {
  prompt: string;
  seconds: number;
  ckpt: string;
  clip: string;
  prefix: string;
}): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  return {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: input.ckpt } },
    2: {
      class_type: 'CLIPLoader',
      inputs: { clip_name: input.clip, type: 'stable_audio', device: 'default' },
    },
    3: { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['2', 0] } },
    4: { class_type: 'CLIPTextEncode', inputs: { text: input.prompt, clip: ['2', 0] } },
    5: { class_type: 'EmptyLatentAudio', inputs: { seconds: input.seconds, batch_size: 1 } },
    6: {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['4', 0],
        negative: ['3', 0],
        latent_image: ['5', 0],
        seed: 12345,
        steps: 8,
        cfg: 1,
        sampler_name: 'lcm',
        scheduler: 'simple',
        denoise: 1,
      },
    },
    7: { class_type: 'VAEDecodeAudio', inputs: { samples: ['6', 0], vae: ['1', 2] } },
    8: {
      class_type: 'SaveAudio',
      inputs: { audio: ['7', 0], filename_prefix: input.prefix },
    },
  };
}

function readOptionString(options: Record<string, unknown> | undefined, key: string): string | null {
  const value = options?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function readOptionNumber(options: Record<string, unknown> | undefined, key: string): number | null {
  const value = options?.[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
