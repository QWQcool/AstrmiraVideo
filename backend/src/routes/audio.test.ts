import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../index.js';

/**
 * `POST /api/audio`（V2.103 / CONTRACT §30）。
 *
 * 这里钉的是**入口判据**：能在入队前拒掉的，一律 400/503 说清原因
 * —— 让用户看到"缺 MIMO_API_KEY"，而不是 40 秒后看到一句上游报错。
 *
 * 成功路径不在这里（它会真的调 MiMo / ComfyUI）：那是 `pnpm smoke:audio` 与
 * Phase 2 端到端脚本的事；provider 侧的行为在 `providers/audio/AudioProvider.test.ts`。
 */

const TMP_DATA = mkdtempSync(path.join(tmpdir(), 'astrmira-audio-data-'));
const TMP_OUT = mkdtempSync(path.join(tmpdir(), 'astrmira-audio-out-'));
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  process.env.DATA_DIR = TMP_DATA;
  process.env.OUTPUT_DIR = TMP_OUT;
  // 明确清掉两条音频引擎的配置：本文件要验"没配就是 503"
  delete process.env.MIMO_API_KEY;
  delete process.env.MiMo_API_Key;
  delete process.env.COMFYUI_AUDIO_BASE;
  delete process.env.COMFYUI_BASE_URL;

  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  for (const dir of [TMP_DATA, TMP_OUT]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* 临时目录残留无碍 */
    }
  }
});

async function postAudio(payload: unknown): Promise<Awaited<ReturnType<typeof app.inject>>> {
  return await app.inject({ method: 'POST', url: '/api/audio', payload: payload as object });
}

describe('POST /api/audio · 入口判据', () => {
  it('配音缺 text → 400（不让上游去报错）', async () => {
    const response = await postAudio({ mode: 'tts', engine: 'mimo-tts', voice: '冰糖' });
    expect(response.statusCode).toBe(400);
  });

  it('tts 带了 seconds / prompt → 400（字段互斥，入口就拒）', async () => {
    const withSeconds = await postAudio({
      mode: 'tts',
      engine: 'mimo-tts',
      text: '你好',
      seconds: 5,
    });
    expect(withSeconds.statusCode).toBe(400);

    const withPrompt = await postAudio({
      mode: 'tts',
      engine: 'mimo-tts',
      text: '你好',
      prompt: 'soft piano',
    });
    expect(withPrompt.statusCode).toBe(400);
  });

  it('配乐缺 prompt → 400；配乐带 voice → 400', async () => {
    const noPrompt = await postAudio({ mode: 'bgm', engine: 'host-stable-audio', seconds: 5 });
    expect(noPrompt.statusCode).toBe(400);

    const withVoice = await postAudio({
      mode: 'bgm',
      engine: 'host-stable-audio',
      prompt: 'soft piano',
      voice: '冰糖',
    });
    expect(withVoice.statusCode).toBe(400);
  });

  it('引擎不支持该模式 → 400（Stable Audio 不做配音）', async () => {
    const response = await postAudio({
      mode: 'tts',
      engine: 'host-stable-audio',
      text: '你好',
    });
    expect(response.statusCode).toBe(400);
  });

  it('没配 Key / 没配 ComfyUI → 503 PROVIDER_UNAVAILABLE，且理由说清缺哪个 env', async () => {
    const mimo = await postAudio({ mode: 'tts', engine: 'mimo-tts', text: '你好' });
    expect(mimo.statusCode).toBe(503);
    expect(mimo.json().code).toBe('PROVIDER_UNAVAILABLE');
    expect(mimo.json().message).toContain('MIMO_API_KEY');

    const sa3 = await postAudio({
      mode: 'bgm',
      engine: 'host-stable-audio',
      prompt: 'soft piano',
      seconds: 5,
    });
    expect(sa3.statusCode).toBe(503);
    expect(sa3.json().code).toBe('PROVIDER_UNAVAILABLE');
    expect(sa3.json().message).toContain('COMFYUI_AUDIO_BASE');
  });

  it('项目不存在 → 404 PROJECT_NOT_FOUND（不静默落到默认项目）', async () => {
    const response = await postAudio({
      mode: 'tts',
      engine: 'mimo-tts',
      text: '你好',
      projectId: 'no-such-project',
    });
    // 没配 Key 时 503 先返回还是 404？口径是**先校验项目**（与 /api/generate 一致）
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('PROJECT_NOT_FOUND');
  });
});
