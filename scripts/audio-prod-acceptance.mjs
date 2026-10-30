#!/usr/bin/env node

/**
 * 生产环境音频验收（V2.106 / Phase 2 · B 片）。
 *
 * ## 它证明什么、不证明什么
 * **证明**：这台部署上的两个音频引擎**真的能出音频** —— 引擎状态、任务终态、产物文件
 * 三样都对得上（`GET /api/audio/engines` → `POST /api/audio` → 轮询 → ffprobe）。
 * **不证明**："两层声音混进成片" —— 混音发生在**浏览器**（Remotion/WebCodecs 导出），
 * 服务端没有混音接口。那条判据在 `pnpm smoke:audio:panel`（本地、真浏览器、真导出 + 频谱）。
 * 两个脚本合起来才是完整的：**这边证明引擎通，那边证明混音对**。
 *
 * ## 为什么不用界面点：这一步要的是"部署是否接通"，接口是**权威**，
 * 而界面还要受缓存/纸面文案影响。界面级的验收在 `smoke:audio:panel` 里做。
 *
 * ## 用法
 * ```bash
 * # 本机（后端已经起在 3000）
 * pnpm smoke:audio:prod -- --base http://127.0.0.1:3000
 * # 线上（需要有 token；回环调用可省）
 * pnpm smoke:audio:prod -- --base https://<host> --token <PUBLIC_API_TOKEN>
 * ```
 * 退出码：0 全过；1 有失败；2 跑不了（连不上 / 缺 ffprobe / 引擎未配置）。
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, '.tmp/e2e');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] !== undefined && !argv[index + 1].startsWith('--')
    ? argv[index + 1]
    : fallback;
};

const BASE = (arg('base', process.env.ASTRMIRA_BASE ?? 'http://127.0.0.1:3000')).replace(/\/+$/, '');
const TOKEN = arg('token', process.env.PUBLIC_API_TOKEN ?? '');
const TTS_TEXT = '这是生产环境音频验收，用来证明云端配音真的能出声音。';

const headers = TOKEN === '' ? {} : { authorization: `Bearer ${TOKEN}` };
let failures = 0;

function check(ok, label) {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) failures += 1;
}

function ffprobe(file) {
  const result = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels',
    '-show_entries', 'format=duration', '-of', 'json', file,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffprobe 失败：${(result.stderr ?? '').slice(-300)}`);
  return JSON.parse(result.stdout);
}

function meanVolume(file) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf8' });
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return Number(/mean_volume: (-?[\d.]+) dB/.exec(text)?.[1] ?? Number.NaN);
}

async function post(pathname, body) {
  const response = await fetch(`${BASE}${pathname}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function waitTask(taskId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = 'queued';
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const response = await fetch(`${BASE}/api/tasks/${taskId}`, { headers });
    const progress = await response.json();
    last = progress.status;
    if (last === 'succeeded' || last === 'failed' || last === 'cancelled') return progress;
  }
  return { status: last, error: { message: '轮询超时' } };
}

async function download(url, file) {
  const response = await fetch(`${BASE}${url}`, { headers });
  if (!response.ok) throw new Error(`下载产物失败：HTTP ${response.status}`);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
}

function probeTools() {
  const result = spawnSync('ffprobe', ['-version'], { encoding: 'utf8' });
  if (result.error !== undefined) {
    console.error('✗ 找不到 ffprobe（验收要用它读产物）');
    process.exit(2);
  }
}

async function main() {
  probeTools();
  mkdirSync(OUT_DIR, { recursive: true });

  console.log(`=== 生产音频验收 · ${BASE} ===`);

  // ① 引擎状态：这一步就能回答"部署有没有接通"
  const enginesResponse = await fetch(`${BASE}/api/audio/engines`, { headers });
  if (!enginesResponse.ok) {
    console.error(`✗ GET /api/audio/engines → HTTP ${enginesResponse.status}（这个部署还没有 V2.106）`);
    process.exit(2);
  }
  const { engines } = await enginesResponse.json();
  for (const entry of engines) {
    check(entry.available === true, `引擎 ${entry.engine} 可用${entry.reason === undefined ? '' : `（${entry.reason}）`}`);
  }
  if (failures > 0) {
    console.error('\n✗ 有引擎不可用，后面的端到端不跑了（会白等 5 分钟）');
    process.exit(2);
  }

  // ② 配音（云端 MiMo）
  const tts = await post('/api/audio', { mode: 'tts', engine: 'mimo-tts', text: TTS_TEXT, voice: '冰糖' });
  check(tts.status === 200, `POST /api/audio(tts) → ${tts.status}`);
  if (tts.status !== 200) process.exit(1);
  const ttsTask = await waitTask(tts.body.taskId, 180_000);
  check(ttsTask.status === 'succeeded', `配音任务终态 ${ttsTask.status}`);
  if (ttsTask.status !== 'succeeded') {
    console.error(`  失败原因：${ttsTask.error?.message ?? '未提供'}`);
    process.exit(1);
  }
  const ttsFile = path.join(OUT_DIR, 'prod-tts.wav');
  await download(ttsTask.outputAudioUrl, ttsFile);
  const ttsProbe = ffprobe(ttsFile);
  const ttsStream = ttsProbe.streams[0];
  const ttsSeconds = Number(ttsProbe.format?.duration ?? 0);
  // ⚠️ ffprobe 的 `sample_rate` / `channels` 是**字符串**（"24000"），
  // 直接和数字比会静默为 false —— 2026-10-30 第一次跑生产就栽在这上面（打印出来是对的，断言红了）。
  check(ttsSeconds > 0.5, `配音产物 ${ttsSeconds.toFixed(2)}s（${ttsStream.codec_name} ${ttsStream.sample_rate}Hz ${ttsStream.channels}ch）`);
  check(Number(ttsStream.sample_rate) === 24000, '配音是 24kHz（MiMo 的实测口径，换了引擎这里会红）');
  check(Number(ttsStream.channels) === 1, '配音是单声道（同上）');
  check(meanVolume(ttsFile) > -45, `配音不是静音（均值 ${meanVolume(ttsFile).toFixed(1)}dB）`);

  // ③ 配乐（本机 Stable Audio）
  const bgm = await post('/api/audio', {
    mode: 'bgm',
    engine: 'host-stable-audio',
    prompt: 'warm cinematic piano, soft strings, no drums',
    seconds: 10,
  });
  check(bgm.status === 200, `POST /api/audio(bgm) → ${bgm.status}`);
  if (bgm.status !== 200) process.exit(1);
  const bgmTask = await waitTask(bgm.body.taskId, 300_000);
  check(bgmTask.status === 'succeeded', `配乐任务终态 ${bgmTask.status}`);
  if (bgmTask.status !== 'succeeded') {
    console.error(`  失败原因：${bgmTask.error?.message ?? '未提供'}`);
    process.exit(1);
  }
  const bgmFile = path.join(OUT_DIR, 'prod-bgm.wav');
  await download(bgmTask.outputAudioUrl, bgmFile);
  const bgmProbe = ffprobe(bgmFile);
  const bgmStream = bgmProbe.streams[0];
  const bgmSeconds = Number(bgmProbe.format?.duration ?? 0);
  check(bgmSeconds > 9, `配乐产物 ${bgmSeconds.toFixed(2)}s（要 10s —— V2.105 之前这里会拿回 5s 的缓存）`);
  check(Number(bgmStream.sample_rate) === 44100, '配乐是 44.1kHz（Stable Audio 的口径）');
  check(Number(bgmStream.channels) === 2, '配乐是立体声');

  writeFileSync(
    path.join(OUT_DIR, 'prod-audio-acceptance.json'),
    `${JSON.stringify({
      at: new Date().toISOString(),
      base: BASE,
      engines,
      tts: { taskId: tts.body.taskId, url: ttsTask.outputAudioUrl, seconds: ttsSeconds, stream: ttsStream },
      bgm: { taskId: bgm.body.taskId, url: bgmTask.outputAudioUrl, seconds: bgmSeconds, stream: bgmStream },
      failures,
    }, null, 2)}\n`,
  );

  console.log(`\n${failures === 0 ? '✓' : '✗'} 生产音频验收：${failures === 0 ? '通过' : `${failures} 项失败`}`);
  console.log(`产物目录：${OUT_DIR}`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
