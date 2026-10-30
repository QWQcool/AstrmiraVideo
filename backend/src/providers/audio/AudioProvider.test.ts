import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AudioProvider, buildStableAudioWorkflow } from './AudioProvider.js';
import type { VideoGenerateRequest } from '@astrmira/shared';

/**
 * 音频 provider（V2.103）：**用假 fetch 把两条引擎的分支钉住**。
 *
 * 真机验收（真 MiMo / 真 ComfyUI）不进 CI —— 那是 `pnpm smoke:audio` 与 Phase 2 的
 * 端到端脚本的事。这里只保证三件事不会退化：
 * 1. 没 Key / 连不上 → `checkHealth` 如实不可用（不是"假装能用"）；
 * 2. 上游报错 → **failed + terminal**（不是 uncertain：重投同一条只会再花一次钱）；
 * 3. 成功 → 文件真的落盘 + `outputAudioUrl` 指向 `/media/<taskId>.wav`。
 */

const TMP_OUT = mkdtempSync(path.join(tmpdir(), 'astrmira-audio-provider-'));

afterAll(() => {
  try {
    rmSync(TMP_OUT, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    /* 临时目录残留无碍 */
  }
});

const TTS_REQUEST: VideoGenerateRequest = {
  prompt: '雪停以后，院子里只剩那枚红苹果。',
  mode: 'tts',
  aspectRatio: '16:9',
  provider: 'mimo-tts',
  options: { voice: '冰糖', style: '纪录片旁白' },
};

/** 一个最小的 wav 头 + 静音数据（provider 只写字节，不解码） */
function fakeWavBase64(): string {
  const data = Buffer.alloc(256, 0);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]).toString('base64');
}

function mimoOk(): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { audio: { data: fakeWavBase64() } } }],
        usage: { total_tokens: 120 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch;
}

/** 轮询到终态（provider 在后台跑，submit 立刻返回） */
async function waitTerminal(provider: AudioProvider, taskId: string): Promise<Awaited<ReturnType<AudioProvider['queryStatus']>>> {
  for (let index = 0; index < 100; index += 1) {
    const progress = await provider.queryStatus(taskId);
    if (progress.status === 'succeeded' || progress.status === 'failed') return progress;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('音频任务没有在 1s 内到终态');
}

describe('AudioProvider · 能力位', () => {
  it('没有 Key 的 MiMo → 不可用，理由直说缺什么', async () => {
    const provider = new AudioProvider({
      id: 'mimo-tts',
      name: 'MiMo',
      engine: 'mimo-tts',
      outputDir: TMP_OUT,
      mimoKey: null,
    });
    const health = await provider.checkHealth();
    expect(health.available).toBe(false);
    expect(health.reason).toContain('MIMO_API_KEY');
  });

  it('没有 ComfyUI 地址的 Stable Audio → 不可用', async () => {
    const provider = new AudioProvider({
      id: 'host-stable-audio',
      name: 'SA3',
      engine: 'host-stable-audio',
      outputDir: TMP_OUT,
      comfyBaseUrl: null,
    });
    const health = await provider.checkHealth();
    expect(health.available).toBe(false);
    expect(health.reason).toContain('COMFYUI_AUDIO_BASE');
  });
});

describe('AudioProvider · MiMo 配音', () => {
  it('成功：写 /media/<taskId>.wav 并给出 outputAudioUrl', async () => {
    const provider = new AudioProvider({
      id: 'mimo-tts',
      name: 'MiMo',
      engine: 'mimo-tts',
      outputDir: TMP_OUT,
      mimoKey: 'test-key',
      fetchImpl: mimoOk(),
    });
    const { taskId } = await provider.submit(TTS_REQUEST);
    const progress = await waitTerminal(provider, taskId);
    expect(progress.status).toBe('succeeded');
    expect(progress.outputAudioUrl).toBe(`/media/${taskId}.wav`);
    // 绝不写到 outputVideoUrl 去（那会变成"任务成功但拿到一个播不了的 mp4"）
    expect(progress.outputVideoUrl).toBeUndefined();
    const bytes = readFileSync(path.join(TMP_OUT, `${taskId}.wav`));
    expect(bytes.length).toBeGreaterThan(44);
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
  });

  it('上游报错 → failed + terminal（重投不会变好）', async () => {
    const provider = new AudioProvider({
      id: 'mimo-tts',
      name: 'MiMo',
      engine: 'mimo-tts',
      outputDir: TMP_OUT,
      mimoKey: 'bad-key',
      fetchImpl: (async () => new Response('unauthorized', { status: 401 })) as unknown as typeof fetch,
    });
    const { taskId } = await provider.submit(TTS_REQUEST);
    const progress = await waitTerminal(provider, taskId);
    expect(progress.status).toBe('failed');
    expect(progress.error?.code).toBe('UPSTREAM_ERROR');
    expect(progress.error?.disposition).toBe('terminal');
    expect(progress.error?.message).toContain('401');
  });

  it('响应里没有音频 → failed（不把空文件当成功）', async () => {
    const provider = new AudioProvider({
      id: 'mimo-tts',
      name: 'MiMo',
      engine: 'mimo-tts',
      outputDir: TMP_OUT,
      mimoKey: 'test-key',
      fetchImpl: (async () =>
        new Response(JSON.stringify({ choices: [{ message: {} }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    });
    const { taskId } = await provider.submit(TTS_REQUEST);
    const progress = await waitTerminal(provider, taskId);
    expect(progress.status).toBe('failed');
  });

  it('cancel 恒 false：音频轨做不到取消，就不许说取消成功', async () => {
    const provider = new AudioProvider({
      id: 'mimo-tts',
      name: 'MiMo',
      engine: 'mimo-tts',
      outputDir: TMP_OUT,
      mimoKey: 'test-key',
      fetchImpl: mimoOk(),
    });
    expect(await provider.cancel('whatever')).toBe(false);
  });
});

describe('AudioProvider · Stable Audio 工作流', () => {
  it('工作流把 prompt / 时长 / 模型 / 前缀都写进去（不写死一份常量）', () => {
    const workflow = buildStableAudioWorkflow({
      prompt: 'warm cinematic piano',
      seconds: 9,
      ckpt: 'music.safetensors',
      clip: 'clip.safetensors',
      prefix: 'astrmira/task-1',
    });
    expect(workflow['1']?.inputs['ckpt_name']).toBe('music.safetensors');
    expect(workflow['2']?.inputs['clip_name']).toBe('clip.safetensors');
    expect(workflow['4']?.inputs['text']).toBe('warm cinematic piano');
    expect(workflow['5']?.inputs['seconds']).toBe(9);
    expect(workflow['8']?.inputs['filename_prefix']).toBe('astrmira/task-1');
  });

  it('ComfyUI 没产出音频文件 → failed（不编一个成功）', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/object_info/CheckpointLoaderSimple')) {
        return new Response(
          JSON.stringify({
            CheckpointLoaderSimple: {
              input: {
                required: {
                  ckpt_name: [['stable_audio_3_small_music.safetensors', 'stable_audio_3_small_sfx.safetensors'], {}],
                },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/prompt')) {
        return new Response(JSON.stringify({ prompt_id: 'p-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/history/')) {
        return new Response(JSON.stringify({ 'p-1': { status: { status_str: 'success' }, outputs: {} } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const provider = new AudioProvider({
      id: 'host-stable-audio',
      name: 'SA3',
      engine: 'host-stable-audio',
      outputDir: TMP_OUT,
      comfyBaseUrl: 'http://127.0.0.1:8190',
      fetchImpl,
      pollIntervalMs: 5,
      maxWaitMs: 500,
    });
    const { taskId } = await provider.submit({
      prompt: 'soft piano',
      mode: 'bgm',
      aspectRatio: '16:9',
      provider: 'host-stable-audio',
      options: { seconds: 5 },
    });
    const progress = await waitTerminal(provider, taskId);
    expect(progress.status).toBe('failed');
    expect(progress.error?.message).toContain('没有产出音频');
  });

  /**
   * 2026-10-30 生产踩到的：视频轨那台 ComfyUI 的 `models/checkpoints` 是空的
   * （H3/MOSS 走 diffusion_models），只看 `/system_stats` 会把"没装 Stable Audio"报成可用。
   */
  it('连得上但没装权重 → 能力位如实不可用（不是"点了才失败"）', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/object_info/CheckpointLoaderSimple')) {
        return new Response(
          JSON.stringify({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [[], {}] } } } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const provider = new AudioProvider({
      id: 'host-stable-audio',
      name: 'SA3',
      engine: 'host-stable-audio',
      outputDir: TMP_OUT,
      comfyBaseUrl: 'http://127.0.0.1:8190',
      fetchImpl,
    });
    const health = await provider.checkHealth();
    expect(health.available).toBe(false);
    expect(health.reason).toContain('stable_audio_3_small_music');
  });

  it('提交前也拦：没装权重 → failed 且说清缺哪个文件（不让上游报 node_errors）', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/object_info/CheckpointLoaderSimple')) {
        return new Response(
          JSON.stringify({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [[], {}] } } } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/prompt')) throw new Error('不该走到提交：应该在校验阶段就失败');
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new AudioProvider({
      id: 'host-stable-audio',
      name: 'SA3',
      engine: 'host-stable-audio',
      outputDir: TMP_OUT,
      comfyBaseUrl: 'http://127.0.0.1:8190',
      fetchImpl,
      pollIntervalMs: 5,
      maxWaitMs: 500,
    });
    const { taskId } = await provider.submit({
      prompt: 'soft piano',
      mode: 'bgm',
      aspectRatio: '16:9',
      provider: 'host-stable-audio',
      options: { seconds: 5 },
    });
    const progress = await waitTerminal(provider, taskId);
    expect(progress.status).toBe('failed');
    expect(progress.error?.message).toContain('models/checkpoints');
  });
});
