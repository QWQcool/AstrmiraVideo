import { describe, expect, it } from 'vitest';
import {
  AUDIO_ENGINES,
  AUDIO_VOICES,
  AudioGenerateRequestSchema,
  TaskProgressSchema,
  audioEngineSupports,
  audioEnginesFor,
  audioRequestToGenerateRequest,
  resolveExecutedBy,
  taskOutput,
} from '@astrmira/shared';

/**
 * 音频契约（V2.103 / CONTRACT §30）的**纯函数判据**。
 *
 * 这些断言存在的意义是"改坏了会红"：引擎表决定界面能选什么、隐私文案写什么、
 * 请求怎么翻译成队列认识的信封 —— 三处各写一遍必然漂移。
 */

describe('AUDIO_ENGINES（引擎事实表）', () => {
  it('配音只有云端一条路，配乐/音效只有本机一条路', () => {
    expect(audioEnginesFor('tts')).toEqual(['mimo-tts']);
    expect(audioEnginesFor('bgm')).toEqual(['host-stable-audio']);
    expect(audioEnginesFor('sfx')).toEqual(['host-stable-audio']);
  });

  it('能力判定与表一致（不支持的就是不支持，不靠猜）', () => {
    expect(audioEngineSupports('mimo-tts', 'tts')).toBe(true);
    expect(audioEngineSupports('mimo-tts', 'bgm')).toBe(false);
    expect(audioEngineSupports('host-stable-audio', 'sfx')).toBe(true);
    expect(audioEngineSupports('host-stable-audio', 'tts')).toBe(false);
  });

  it('每个引擎都写清隐私与许可（界面要原文照抄，缺一项就是少一句告知）', () => {
    for (const info of Object.values(AUDIO_ENGINES)) {
      expect(info.privacy.length).toBeGreaterThan(10);
      expect(info.license.length).toBeGreaterThan(5);
      expect(info.env.length).toBeGreaterThan(3);
    }
    // 云端与本地必须能被区分 —— 这是"文本会不会离开这台机器"的唯一判据
    expect(AUDIO_ENGINES['mimo-tts'].executedBy).toBe('cloud');
    expect(AUDIO_ENGINES['host-stable-audio'].executedBy).toBe('host-local');
  });

  it('音色表非空且 id 唯一（界面按它渲染下拉）', () => {
    expect(AUDIO_VOICES.length).toBeGreaterThan(0);
    const ids = AUDIO_VOICES.map((voice) => voice.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('AudioGenerateRequestSchema', () => {
  it('合法的配音请求通过', () => {
    const parsed = AudioGenerateRequestSchema.safeParse({
      mode: 'tts',
      engine: 'mimo-tts',
      text: '雪停以后，院子里只剩那枚红苹果。',
      voice: '冰糖',
    });
    expect(parsed.success).toBe(true);
  });

  it('合法配乐请求通过（prompt + seconds）', () => {
    const parsed = AudioGenerateRequestSchema.safeParse({
      mode: 'bgm',
      engine: 'host-stable-audio',
      prompt: 'warm cinematic piano',
      seconds: 8,
    });
    expect(parsed.success).toBe(true);
  });

  it('字段互斥：tts 不接受 prompt/seconds，配乐不接受 text/voice', () => {
    expect(
      AudioGenerateRequestSchema.safeParse({ mode: 'tts', engine: 'mimo-tts', text: 'a', seconds: 3 })
        .success,
    ).toBe(false);
    expect(
      AudioGenerateRequestSchema.safeParse({
        mode: 'bgm',
        engine: 'host-stable-audio',
        prompt: 'a',
        voice: '冰糖',
      }).success,
    ).toBe(false);
  });

  it('引擎与模式不匹配 → 拒（Stable Audio 不做配音）', () => {
    expect(
      AudioGenerateRequestSchema.safeParse({ mode: 'tts', engine: 'host-stable-audio', text: 'a' })
        .success,
    ).toBe(false);
  });

  it('秒数越界 → 拒（1~30）', () => {
    expect(
      AudioGenerateRequestSchema.safeParse({
        mode: 'sfx',
        engine: 'host-stable-audio',
        prompt: 'a',
        seconds: 31,
      }).success,
    ).toBe(false);
    expect(
      AudioGenerateRequestSchema.safeParse({
        mode: 'sfx',
        engine: 'host-stable-audio',
        prompt: 'a',
        seconds: 0,
      }).success,
    ).toBe(false);
  });
});

describe('audioRequestToGenerateRequest（翻译成队列信封）', () => {
  it('tts：prompt = 台词，音色/情绪走 options，画面字段固定 16:9（且没人读它）', () => {
    const envelope = audioRequestToGenerateRequest({
      mode: 'tts',
      engine: 'mimo-tts',
      text: '雪停以后。',
      voice: '茉莉',
      style: '低沉克制',
    });
    expect(envelope.mode).toBe('tts');
    expect(envelope.prompt).toBe('雪停以后。');
    expect(envelope.provider).toBe('mimo-tts');
    expect(envelope.aspectRatio).toBe('16:9');
    expect(envelope.options).toEqual({ voice: '茉莉', style: '低沉克制' });
  });

  it('bgm：prompt = 描述，秒数走 options；不给的项目一个都不多写', () => {
    const envelope = audioRequestToGenerateRequest({
      mode: 'bgm',
      engine: 'host-stable-audio',
      prompt: 'soft piano',
      seconds: 9,
    });
    expect(envelope.prompt).toBe('soft piano');
    expect(envelope.options).toEqual({ seconds: 9 });
  });

  it('同一个请求翻译两次结果相同（幂等指纹才靠得住）', () => {
    const input = { mode: 'sfx' as const, engine: 'host-stable-audio' as const, prompt: 'wind', seconds: 4 };
    expect(audioRequestToGenerateRequest(input)).toEqual(audioRequestToGenerateRequest(input));
  });
});

describe('产物读取（taskOutput 的音频分支）', () => {
  it('只有 outputAudioUrl 时读成 audio，而不是 none', () => {
    expect(taskOutput({ outputAudioUrl: '/media/a.wav' })).toEqual({
      kind: 'audio',
      url: '/media/a.wav',
    });
  });

  it('三种产物同时存在（脏数据）时按视频 > 图片 > 音频读', () => {
    expect(
      taskOutput({
        outputVideoUrl: '/media/a.mp4',
        outputImageUrl: '/media/b.png',
        outputAudioUrl: '/media/c.wav',
      }),
    ).toEqual({ kind: 'video', url: '/media/a.mp4' });
    expect(taskOutput({ outputImageUrl: '/media/b.png', outputAudioUrl: '/media/c.wav' })).toEqual({
      kind: 'image',
      url: '/media/b.png',
    });
  });

  it('空串不算产物（老数据 / 被清理的串）', () => {
    expect(taskOutput({ outputAudioUrl: '' })).toEqual({ kind: 'none' });
  });
});

describe('执行位置（谁在算 = 数据去了哪）', () => {
  it('mimo-tts 是云端，本机 Stable Audio 是 host-local', () => {
    expect(resolveExecutedBy('mimo-tts')).toBe('cloud');
    expect(resolveExecutedBy('host-stable-audio')).toBe('host-local');
  });
});

describe('TaskProgressSchema 接受音频产物字段', () => {
  it('带 outputAudioUrl 的任务记录能通过 schema', () => {
    const parsed = TaskProgressSchema.safeParse({
      taskId: 't-1',
      status: 'succeeded',
      progressPercent: 100,
      outputAudioUrl: '/media/t-1.wav',
      requestSnapshot: {
        prompt: '雪停以后。',
        mode: 'tts',
        aspectRatio: '16:9',
        provider: 'mimo-tts',
      },
      createdAt: 1_700_000_000_000,
    });
    expect(parsed.success).toBe(true);
  });
});
