import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../index.js';

/**
 * 引擎**配了但连不上**时的行为（V2.107）。
 *
 * 2026-11-02 GPU 关机时在生产上实测到的：`POST /api/audio(bgm)` 照样返回 **200 + taskId**，
 * 任务 0.1s 后 `failed / PROVIDER_UNAVAILABLE` —— 接口像是接了单，用户得靠轮询才知道没做成，
 * 任务表里还多一条脏记录。这组断言钉住"不可用就当场 503，任务不建"。
 *
 * 手法：把 `COMFYUI_AUDIO_BASE` 指到一个**必然连不上**的回环端口（`127.0.0.1:1`）。
 * 它仍然是合法地址（过白名单），所以 provider 会被注册 —— 这正是"配了但不通"的场景。
 */

const TMP_DATA = mkdtempSync(path.join(tmpdir(), 'astrmira-audio-down-data-'));
const TMP_OUT = mkdtempSync(path.join(tmpdir(), 'astrmira-audio-down-out-'));
const DEAD_BASE = 'http://127.0.0.1:1';
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  process.env.DATA_DIR = TMP_DATA;
  process.env.OUTPUT_DIR = TMP_OUT;
  delete process.env.MIMO_API_KEY;
  delete process.env.MiMo_API_Key;
  delete process.env.COMFYUI_BASE_URL;
  process.env.COMFYUI_AUDIO_BASE = DEAD_BASE;

  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  delete process.env.COMFYUI_AUDIO_BASE;
  for (const dir of [TMP_DATA, TMP_OUT]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* 临时目录残留无碍 */
    }
  }
});

describe('引擎配了但连不上（V2.107 · 停机姿态）', () => {
  it('GET /api/audio/engines：如实不可用，且原因里带**地址**与最可能的两种原因', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/audio/engines' });
    expect(response.statusCode).toBe(200);
    const entry = response
      .json()
      .engines.find((item: { engine: string }) => item.engine === 'host-stable-audio');
    expect(entry.available).toBe(false);
    // 地址必须在：只写 "fetch failed" 的话，看日志的人还得翻 env 才知道连的是哪台
    expect(entry.reason).toContain('127.0.0.1:1');
    expect(entry.reason).toContain('GPU 机可能已关机');
  });

  it('POST /api/audio(bgm)：**当场 503**，不建任务（V2.107 之前是 200 + 一条注定失败的脏任务）', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/audio',
      payload: { mode: 'bgm', engine: 'host-stable-audio', prompt: 'soft piano', seconds: 5 },
    });
    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.code).toBe('PROVIDER_UNAVAILABLE');
    expect(body.taskId).toBeUndefined();
    expect(body.message).toContain('127.0.0.1:1');
  });

  it('配音没有 Key 时同样是 503（不是建任务后失败）', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/audio',
      payload: { mode: 'tts', engine: 'mimo-tts', text: '你好' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('PROVIDER_UNAVAILABLE');
  });
});
