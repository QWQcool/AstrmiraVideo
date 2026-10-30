#!/usr/bin/env node

/**
 * Phase 1 · **模型出 wav → 进成片**（2026-10-30）。
 *
 * 这条脚本回答的问题是"声音能不能变成产品能力"，而**不是**"界面多了一个块"：
 * 1. 旁白来自**真实 TTS**（MiMo 云端 / 或 `--narration` 给现成 wav）；
 * 2. 配乐来自**真实音乐模型**（本机 ComfyUI 的 Stable Audio 3 Small / 或 `--bgm`）；
 * 3. 两者都走**现有** `POST /api/upload` 变成音频素材（零新路由）；
 * 4. 在**真实浏览器**里落进剪辑台音效轨 → WebCodecs 导出 → `POST /api/edits/renders` 入库；
 * 5. 用 ffprobe + 窄带频谱证明**两层声音真的都在成片里**。
 *
 * ## 判据（全部可复算，不接受"看起来对"）
 *
 * 导出**两次**，只差一条音效轨：
 * - **A** = 源片（静音）+ 旁白；**B** = 源片（静音）+ 旁白 + 配乐。
 * - 源片是夹具 provider 合成的 440Hz 音轨，**先把它的音量设成 0**：否则它是一条宽带底噪，
 *   会把"配乐进没进成片"淹没掉（实测它在 250Hz 处 −36.7dB，与配乐同量级）。
 *   这同时是真实做法——给人声让位的片子本来就会压掉原声。
 * - ① **旁白在 A 里**：1kHz 窄带比 6kHz 对照带高 ≥ 6dB（两处都不是 440Hz 的位置）。
 * - ② **旁白在 B 里**：同上（叠了配乐之后仍成立）。
 * - ③ **配乐在 B 里**：旁白结束后（`narrationDuration + 0.3s` → 片尾）的窗口里，
 *   B 的全带电平比 A 高 ≥ 10dB —— A 那段是**数字静音**（人声与源片都结束了）。
 * - ④ **配乐在人声底下也垫着**：人声还没结束的窗口里，100Hz 窄带（配乐比人声强的频段）
 *   B 比 A 高 ≥ 3dB —— 这条区分"垫底配乐"与"只在结尾响一下"。
 *   不用"全片电平"做这条判据：人声本来就比配乐响，加一层 ±0dB 的音乐只抬高约 1.6dB，
 *   拿 3dB 去卡它是在卡混音比例，不是在判"有没有"。
 * - ⑤ 两次导出产物**字节不同**（防"第二次其实没重渲"）。
 *
 * ## 为什么是两次导出而不是一次
 *
 * 一次导出只能证明"有声音"，证明不了"这层声音来自哪个模型"。两次导出（差分）才能把
 * **每一层的贡献**单独归因 —— 这是判据，不是流程偏好。
 *
 * ## 用法
 *
 * ```bash
 * # 全自动（要 MiMo Key + 本机 ComfyUI 带 Stable Audio）
 * pnpm smoke:audio
 *
 * # 用现成素材（不需要 Key / GPU）
 * pnpm smoke:audio -- --narration D:/x/narr.wav --bgm D:/x/bgm.wav
 * ```
 *
 * 前置：`pnpm build`（脚本跑 dist 产物）+ 本机 ffmpeg/ffprobe + 夹具片段
 * （`node scripts/make-fixture-clips.mjs`，仓库已带）。
 *
 * 退出码：0 = 全过；1 = 有断言失败；2 = **跑不了**（缺 Key / 缺 ComfyUI / 缺 ffmpeg），
 * 这时不打印任何"通过"（铁律：没测 ≠ 通过）。
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BACKEND_ENTRY = path.join(ROOT, 'backend/dist/index.js');
const FRONTEND_DIST = path.join(ROOT, 'frontend/dist');
const CLIPS_DIR = path.join(ROOT, 'tests/fixtures/clips');
const EVIDENCE_DIR = path.join(ROOT, '.tmp/e2e');

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((item) => item.startsWith('--') && !item.includes('=')));
const HEADED = flags.has('--headed');
const KEEP = flags.has('--keep');
function arg(name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] !== undefined && !argv[index + 1].startsWith('--')
    ? argv[index + 1]
    : fallback;
}

const NARRATION_TEXT = arg('text', '雪停以后，院子里只剩那枚红苹果。');
const NARRATION_STYLE = arg('style', '纪录片旁白，低沉克制');
const VOICE = arg('voice', '冰糖');
const BGM_PROMPT = arg(
  'bgm-prompt',
  'warm cinematic ambient score, soft piano, low strings pad, gentle, cold winter, no vocals',
);
const SEGMENT_SEC = Number(arg('seconds', '5'));
const FPS = 30;

/** 判据阈值（写死在这里，改它就是改判据） */
const NARRATION_MIN_OVER_CONTROL = 6;
/**
 * 人声结束后"配乐还在响"的门槛：A 那段是**数字静音**（实测 −91.0dB），B 里只要有音乐
 * 就不止 +10dB。用 10 而不是 30，是因为门槛要能容纳"音乐自己也有安静段"。
 */
const BGM_MIN_TAIL_DELTA = 10;
/**
 * 人声期间"配乐垫在底下"的门槛：实测配乐在 100Hz 比人声高约 5dB，
 * 相加后 B 比 A 高约 6dB；取 3dB 留给混音/编码损耗。
 */
const BGM_MIN_UNDER_VOICE_DELTA = 3;

const fail = (message) => {
  console.error(`\n✗ 跑不了：${message}`);
  process.exit(2);
};

// ── 环境预检（跑不了就 exit 2，不伪造结论） ────────────────────────────────

function requireTool(name) {
  const probe = spawnSync(name, ['-version'], { encoding: 'utf8' });
  if (probe.error !== undefined) fail(`找不到 ${name}（PATH 里没有）`);
}

requireTool('ffmpeg');
requireTool('ffprobe');
if (!existsSync(BACKEND_ENTRY)) fail('backend/dist 不存在 —— 先跑 `pnpm build`');
if (!existsSync(FRONTEND_DIST)) fail('frontend/dist 不存在 —— 先跑 `pnpm build`');
if (!existsSync(path.join(CLIPS_DIR, 'base-720p-landscape-5s-audio.mp4'))) {
  fail('夹具片段缺失 —— 先跑 `node scripts/make-fixture-clips.mjs`');
}

const failures = [];
function check(ok, message) {
  console.log(`${ok ? '✓' : '✗'} ${message}`);
  if (!ok) failures.push(message);
  return ok;
}

// ── 素材：旁白与配乐 ──────────────────────────────────────────────────────

/**
 * MiMo 的 Key 在**用户级环境变量**里（`[Environment]::GetEnvironmentVariable('MiMo_API_Key','User')`），
 * 它不会自动出现在新进程的 `process.env` 里。Windows 上读一次注册表以内的正规途径就是
 * 问 PowerShell —— 不打印、不落盘。
 */
function resolveMimoKey() {
  const direct = process.env.MiMo_API_Key ?? process.env.MIMO_API_KEY;
  if (typeof direct === 'string' && direct !== '') return direct;
  if (process.platform !== 'win32') return null;
  const probe = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('MiMo_API_Key','User')"],
    { encoding: 'utf8' },
  );
  const value = (probe.stdout ?? '').trim();
  return value === '' ? null : value;
}

async function synthesizeNarration(target) {
  const key = resolveMimoKey();
  if (key === null) {
    fail(
      '没有 MiMo_API_Key（用户环境变量或进程环境）。' +
        '要么先 `$env:MiMo_API_Key = [Environment]::GetEnvironmentVariable(\'MiMo_API_Key\',\'User\')`，' +
        '要么用 `--narration <wav>` 给现成旁白',
    );
  }
  const started = Date.now();
  const response = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'mimo-v2.5-tts',
      messages: [
        { role: 'user', content: NARRATION_STYLE },
        { role: 'assistant', content: NARRATION_TEXT },
      ],
      audio: { format: 'wav', voice: VOICE },
    }),
  });
  const body = await response.text();
  if (!response.ok) fail(`MiMo TTS HTTP ${response.status}：${body.slice(0, 300)}`);
  const payload = JSON.parse(body);
  const base64 = payload?.choices?.[0]?.message?.audio?.data;
  if (typeof base64 !== 'string') fail(`MiMo 响应里没有音频：${body.slice(0, 300)}`);
  writeFileSync(target, Buffer.from(base64, 'base64'));
  const elapsed = (Date.now() - started) / 1000;
  const usage = payload?.usage ?? {};
  console.log(
    `旁白（MiMo TTS · ${VOICE}）：${elapsed.toFixed(1)}s / ${usage.total_tokens ?? '?'} tokens（prompt ${usage.prompt_tokens ?? '?'}）`,
  );
  return { source: `MiMo TTS ${VOICE}`, tokens: usage.total_tokens ?? null, elapsedSec: elapsed };
}

/** Stable Audio 3 Small 的最小工作流（与 `D:\ComfyUI\audio-tools\sa3-cli.mjs` 同构） */
function stableAudioWorkflow(prompt, seconds, ckpt) {
  return {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    2: {
      class_type: 'CLIPLoader',
      inputs: { clip_name: 't5gemma_b_b_ul2.safetensors', type: 'stable_audio', device: 'default' },
    },
    3: { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['2', 0] } },
    4: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['2', 0] } },
    5: { class_type: 'EmptyLatentAudio', inputs: { seconds, batch_size: 1 } },
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
    8: { class_type: 'SaveAudio', inputs: { audio: ['7', 0], filename_prefix: 'astrmira/smoke-audio' } },
  };
}

async function synthesizeBgm(target) {
  const base = process.env.COMFYUI_AUDIO_BASE ?? 'http://127.0.0.1:8190';
  const ckpt = process.env.SA3_CKPT ?? 'stable_audio_3_small_music.safetensors';
  let reachable = false;
  try {
    const stats = await fetch(`${base}/system_stats`, { signal: AbortSignal.timeout(4000) });
    reachable = stats.ok;
  } catch {
    reachable = false;
  }
  if (!reachable) {
    fail(
      `连不上本机 ComfyUI（${base}）。要么起 ComfyUI 并装 Stable Audio 3 Small，` +
        '要么用 `--bgm <wav>` 给现成配乐（`COMFYUI_AUDIO_BASE` 可换地址）',
    );
  }
  const started = Date.now();
  const submit = await fetch(`${base}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: stableAudioWorkflow(BGM_PROMPT, SEGMENT_SEC, ckpt), client_id: 'astrmira-smoke-audio' }),
  });
  const submitted = await submit.json();
  if (!submit.ok) fail(`Stable Audio 提交被拒 HTTP ${submit.status}：${JSON.stringify(submitted).slice(0, 400)}`);
  const promptId = submitted.prompt_id;

  let entry = null;
  for (let index = 0; index < 600; index += 1) {
    await sleep(1000);
    const history = await (await fetch(`${base}/history/${promptId}`)).json();
    if (history[promptId] !== undefined) {
      entry = history[promptId];
      break;
    }
  }
  if (entry === null) fail('Stable Audio 10 分钟没出结果');
  if (entry.status?.status_str === 'error') {
    fail(`Stable Audio 执行出错：${JSON.stringify(entry.status.messages ?? entry.status).slice(0, 500)}`);
  }
  const files = Object.values(entry.outputs ?? {}).flatMap((node) => node.audio ?? node.files ?? []);
  if (files.length === 0) fail('Stable Audio 没有产物');
  // ⚠️ 保存节点给的是 flac（只是被我们改了扩展名）—— 一律按**文件事实**转码，不信扩展名
  const first = files[0];
  const url = `${base}/view?filename=${encodeURIComponent(first.filename)}&subfolder=${encodeURIComponent(first.subfolder ?? '')}&type=${first.type ?? 'output'}`;
  const raw = Buffer.from(await (await fetch(url)).arrayBuffer());
  const rawPath = `${target}.raw`;
  writeFileSync(rawPath, raw);
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', rawPath,
    '-t', String(SEGMENT_SEC),
    '-c:a', 'pcm_s16le', '-ar', '44100', '-ac', '2',
    target,
  ]);
  rmSync(rawPath, { force: true });
  const elapsed = (Date.now() - started) / 1000;
  console.log(`配乐（Stable Audio 3 Small · ${ckpt}）：${elapsed.toFixed(1)}s → ${path.basename(target)}`);
  return { source: `Stable Audio 3 Small (${ckpt})`, elapsedSec: elapsed };
}

// ── 测量 ──────────────────────────────────────────────────────────────────

function probeAudio(file) {
  const raw = execFileSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,sample_rate,channels',
      '-show_entries', 'format=duration', '-of', 'json', file],
    { encoding: 'utf8' },
  );
  return JSON.parse(raw);
}

function streamTypes(file) {
  return execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter((line) => line !== '');
}

/**
 * 某窄带的平均电平（dB）。
 * `window` 给 `[ss, durationSec]` 时只量那一段（判定"旁白结束之后还有没有声音"）。
 */
function bandDb(file, hz, { widthHz = Math.max(40, hz * 0.15), window = null } = {}) {
  const args = ['-hide_banner', '-vn'];
  if (window !== null) args.push('-ss', String(window[0]), '-t', String(window[1]));
  args.push('-i', file, '-af', `bandpass=f=${hz}:width_type=h:w=${Math.round(widthHz)},volumedetect`, '-f', 'null', '-');
  const result = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(text)?.[1];
  if (mean === undefined) throw new Error(`读不出 ${hz}Hz 电平：${text.slice(-300)}`);
  return Number(mean);
}

/** 全带电平（dB） */
function fullDb(file, window = null) {
  const args = ['-hide_banner', '-vn'];
  if (window !== null) args.push('-ss', String(window[0]), '-t', String(window[1]));
  args.push('-i', file, '-af', 'volumedetect', '-f', 'null', '-');
  const result = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(text)?.[1];
  if (mean === undefined) throw new Error(`读不出全带电平：${text.slice(-300)}`);
  return Number(mean);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return true;
    } catch {
      /* 还没起来 */
    }
    await sleep(200);
  }
  return false;
}

async function uploadTo(baseUrl, file, mime) {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(file)], { type: mime }), path.basename(file));
  const response = await fetch(`${baseUrl}/api/upload`, { method: 'POST', body: form });
  const payload = await response.json();
  const assetId = payload?.assets?.[0]?.assetId;
  if (assetId === undefined) throw new Error(`上传失败 HTTP ${response.status}：${JSON.stringify(payload).slice(0, 300)}`);
  return assetId;
}

/** 夹具 provider 造一条带音轨的 5s 源片 */
async function generateFixtureVideo(baseUrl) {
  const submit = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: '声音分层验收：夹具源片（音轨将被静音）',
      mode: 't2v',
      aspectRatio: '16:9',
      provider: 'fixture-local',
      params: { durationSec: SEGMENT_SEC },
    }),
  });
  if (!submit.ok) throw new Error(`夹具任务提交失败：HTTP ${submit.status} ${(await submit.text()).slice(0, 200)}`);
  const { taskId } = await submit.json();
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const progress = await (await fetch(`${baseUrl}/api/tasks/${taskId}`)).json();
    if (progress.status === 'succeeded') return progress;
    if (progress.status === 'failed') throw new Error('夹具视频生成失败');
    await sleep(250);
  }
  throw new Error('夹具视频未在 90s 内完成');
}

/** 浏览器侧：导出一次并入库，返回入库的 taskId */
async function exportOnce(page, baseUrl, label) {
  await page.getByRole('button', { name: /导出成片/ }).click({ timeout: 30_000 });
  await page.waitForSelector('a[download]', { timeout: 300_000 });
  const summary = await page.locator('.ed-export-result .wb-note').first().innerText();
  console.log(`  ${label} 导出完成：${summary}`);

  const saw = page.waitForResponse(
    (response) => response.url().includes('/api/edits/renders') && response.request().method() === 'POST',
    { timeout: 180_000 },
  );
  await page.getByRole('button', { name: /入库/ }).click({ timeout: 30_000 });
  const archived = await saw;
  if (!archived.ok()) throw new Error(`${label} 入库失败 HTTP ${archived.status()}`);
  const taskId = (await archived.json())?.taskId;
  if (typeof taskId !== 'string') throw new Error(`${label} 入库响应里没有 taskId`);
  return taskId;
}

/** 从入库任务取回成片到本地文件 */
async function fetchOutput(baseUrl, taskId, target) {
  const detail = await (await fetch(`${baseUrl}/api/tasks/${taskId}`)).json();
  const url = detail.outputVideoUrl;
  if (typeof url !== 'string') throw new Error(`任务 ${taskId} 没有输出文件`);
  const bytes = await (await fetch(`${baseUrl}${url}`)).arrayBuffer();
  writeFileSync(target, Buffer.from(bytes));
  return statSync(target).size;
}

// ── 主流程 ────────────────────────────────────────────────────────────────

const WORK = mkdtempSync(path.join(tmpdir(), 'astrmira-audio-layers-'));
mkdirSync(EVIDENCE_DIR, { recursive: true });

const narrationPath = arg('narration', path.join(WORK, 'narration.wav'));
const bgmPath = arg('bgm', path.join(WORK, 'bgm.wav'));
const narrationProducer = { source: '--narration（外部给定）', elapsedSec: null, tokens: null };
const bgmProducer = { source: '--bgm（外部给定）', elapsedSec: null };

console.log('\n=== Phase 1 · 模型出 wav → 进成片（旁白 + 配乐两层） ===');

if (arg('narration', null) === null) {
  const produced = await synthesizeNarration(narrationPath);
  Object.assign(narrationProducer, produced);
} else if (!existsSync(narrationPath)) {
  fail(`--narration 指向的文件不存在：${narrationPath}`);
}
if (arg('bgm', null) === null) {
  Object.assign(bgmProducer, await synthesizeBgm(bgmPath));
} else if (!existsSync(bgmPath)) {
  fail(`--bgm 指向的文件不存在：${bgmPath}`);
}

const narrationProbe = probeAudio(narrationPath);
const bgmProbe = probeAudio(bgmPath);
const narrationSec = Number(narrationProbe.format?.duration ?? 0);
const bgmSec = Number(bgmProbe.format?.duration ?? 0);
console.log(
  `旁白 ${narrationSec.toFixed(2)}s（${narrationProbe.streams?.[0]?.sample_rate}Hz/${narrationProbe.streams?.[0]?.channels}ch）` +
    ` · 配乐 ${bgmSec.toFixed(2)}s（${bgmProbe.streams?.[0]?.sample_rate}Hz/${bgmProbe.streams?.[0]?.channels}ch）`,
);
if (narrationSec >= SEGMENT_SEC) {
  fail(`旁白 ${narrationSec.toFixed(2)}s 不短于片子 ${SEGMENT_SEC}s —— 没有"人声结束后"的窗口可判，换一句更短的话`);
}

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-al-data-'));
const OUTPUTS_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-al-out-'));
const PORT = await freePort();
const baseUrl = `http://127.0.0.1:${PORT}`;
console.log(`实例：${baseUrl}`);

const child = spawn(process.execPath, [BACKEND_ENTRY], {
  cwd: ROOT,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(PORT),
    DATA_DIR,
    OUTPUT_DIR: OUTPUTS_DIR,
    FRONTEND_DIST,
    PUBLIC_API_TOKEN: 'audio-layers-loopback-only',
    VOLCANO_API_KEY: '',
    ENABLE_FIXTURE_PROVIDER: '1',
  },
  stdio: 'ignore',
});

let browser = null;
let exitCode = 0;
try {
  if (!(await waitForHealth(baseUrl))) throw new Error('后端未在 40s 内就绪');

  // ① 两条素材走**现有**上传路由
  const narrationAssetId = await uploadTo(baseUrl, narrationPath, 'audio/wav');
  const bgmAssetId = await uploadTo(baseUrl, bgmPath, 'audio/wav');
  console.log(`素材已上传：旁白 ${narrationAssetId} / 配乐 ${bgmAssetId}`);

  // ② 源片
  const source = await generateFixtureVideo(baseUrl);
  console.log(`源片：${source.taskId.slice(0, 8)}（${source.outputVideoUrl}）`);

  // ③ 浏览器：静音源片 → 落旁白 → 导出 A → 落配乐（拖到 0 帧）→ 导出 B
  browser = await chromium.launch({ headless: !HEADED });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(`${baseUrl}/#/edit?task=${encodeURIComponent(source.taskId)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ed-tl-pick', { timeout: 60_000 });

  // 静音源片：它的音轨是夹具合成的宽带信号，留着会把配乐判据淹掉
  const videoClip = page.locator('.ed-clip-video').first();
  await videoClip.click({ timeout: 20_000 });
  // 视频片段的数值字段顺序 = [速度, 音量]（`CLIP_FIELD_SCHEMA.video`），音量是第 2 个
  const volumeInput = page.locator('[data-testid=ed-inspector] input.ed-field-number').nth(1);
  await volumeInput.fill('0');
  await volumeInput.dispatchEvent('change');
  await sleep(300);
  check(
    (await videoClip.getAttribute('data-clip-kind')) === 'video',
    '源片已选中并静音（音轨置 0）',
  );

  // 加旁白
  await page.selectOption('.ed-tl-pick', `asset:${narrationAssetId}`);
  await page.getByRole('button', { name: '＋音效' }).click({ timeout: 20_000 });
  await sleep(600);

  const taskA = await exportOnce(page, baseUrl, 'A（旁白）');
  const fileA = path.join(WORK, 'A-narration-only.mp4');
  const sizeA = await fetchOutput(baseUrl, taskA, fileA);

  // 加配乐：音效轨是**顺序轨**，新片段默认接在旁白之后 —— 必须拖到 0 帧才是"叠在一起"
  await page.selectOption('.ed-tl-pick', `asset:${bgmAssetId}`);
  await page.getByRole('button', { name: '＋音效' }).click({ timeout: 20_000 });
  await sleep(600);

  const audioClips = page.locator('.ed-clip-audio');
  check((await audioClips.count()) === 2, `音效轨上有两条片段（实际 ${await audioClips.count()}）`);
  const bgmClip = audioClips.last();
  await bgmClip.scrollIntoViewIfNeeded();
  await sleep(200);
  const box = await bgmClip.boundingBox();
  if (box === null) throw new Error('找不到配乐片段');
  const grabX = box.x + Math.min(box.width / 2, 40);
  const grabY = box.y + box.height / 2;
  console.log(`  拖拽：从 (${Math.round(grabX)}, ${Math.round(grabY)}) 往左（片段盒 ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}）`);
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await sleep(120);
  // 往左拖到画布左侧（模型里对 0 点做 max 夹取，拖过头也停在 0）
  await page.mouse.move(grabX - 200, grabY, { steps: 10 });
  await page.mouse.move(2, grabY, { steps: 24 });
  await page.mouse.up();
  await sleep(400);

  // 用 data-start-frame 确认它真的落在 0（不是"拖了一下就算"）
  const bgmStart = Number(await audioClips.last().getAttribute('data-start-frame'));
  check(bgmStart === 0, `配乐被拖到 0 帧与旁白叠加（data-start-frame=${bgmStart}）`);

  const taskB = await exportOnce(page, baseUrl, 'B（旁白 + 配乐）');
  const fileB = path.join(WORK, 'B-narration-bgm.mp4');
  const sizeB = await fetchOutput(baseUrl, taskB, fileB);

  // ④ 判据
  for (const [label, file] of [['A', fileA], ['B', fileB]]) {
    const streams = streamTypes(file);
    check(streams.includes('audio'), `${label} 成片里有音轨（${streams.join('/')}）`);
    const probe = probeAudio(file);
    const duration = Number(probe.format?.duration ?? 0);
    check(Math.abs(duration - SEGMENT_SEC) < 0.5, `${label} 时长 ${duration.toFixed(2)}s ≈ ${SEGMENT_SEC}s`);
  }
  check(sizeA > 0 && sizeB > 0, `两段产物都有字节（A ${(sizeA / 1024).toFixed(0)}KB / B ${(sizeB / 1024).toFixed(0)}KB）`);
  check(sizeA !== sizeB, '两次导出不是同一个文件（第二次确实重渲了）');

  const aSpeech = bandDb(fileA, 1000);
  const aControl = bandDb(fileA, 6000);
  console.log(`  A：1kHz=${aSpeech.toFixed(1)}dB 对照 6kHz=${aControl.toFixed(1)}dB`);
  check(
    aSpeech > aControl + NARRATION_MIN_OVER_CONTROL,
    `旁白真的进了 A（1kHz 比 6kHz 对照带高 ${(aSpeech - aControl).toFixed(1)}dB ≥ ${NARRATION_MIN_OVER_CONTROL}）`,
  );

  const bSpeech = bandDb(fileB, 1000);
  const bControl = bandDb(fileB, 6000);
  console.log(`  B：1kHz=${bSpeech.toFixed(1)}dB 对照 6kHz=${bControl.toFixed(1)}dB`);
  check(
    bSpeech > bControl + NARRATION_MIN_OVER_CONTROL,
    `叠上配乐后旁白仍在（1kHz 比 6kHz 高 ${(bSpeech - bControl).toFixed(1)}dB）`,
  );

  const tailStart = Number((narrationSec + 0.3).toFixed(2));
  const tailLength = Number((SEGMENT_SEC - 0.15 - tailStart).toFixed(2));
  const aTail = fullDb(fileA, [tailStart, tailLength]);
  const bTail = fullDb(fileB, [tailStart, tailLength]);
  console.log(`  人声结束后 ${tailStart}s~${(tailStart + tailLength).toFixed(2)}s：A=${aTail.toFixed(1)}dB B=${bTail.toFixed(1)}dB`);
  check(
    bTail > aTail + BGM_MIN_TAIL_DELTA,
    `配乐真的进了 B（人声结束后 B 比 A 高 ${(bTail - aTail).toFixed(1)}dB ≥ ${BGM_MIN_TAIL_DELTA}）`,
  );

  // 配乐在人声**之下**也在响：低频（100Hz）是配乐比人声强的少数频段，
  // 在人声还没结束的窗口里比，就能把"垫底"和"只在结尾响一下"区分开
  const underStart = 0.2;
  const underLength = Number((narrationSec - 0.5).toFixed(2));
  const aUnder = bandDb(fileA, 100, { window: [underStart, underLength] });
  const bUnder = bandDb(fileB, 100, { window: [underStart, underLength] });
  console.log(`  人声期间 ${underStart}s~${(underStart + underLength).toFixed(2)}s @100Hz：A=${aUnder.toFixed(1)}dB B=${bUnder.toFixed(1)}dB`);
  check(
    bUnder > aUnder + BGM_MIN_UNDER_VOICE_DELTA,
    `配乐在人声底下也垫着（100Hz 上 B 比 A 高 ${(bUnder - aUnder).toFixed(1)}dB ≥ ${BGM_MIN_UNDER_VOICE_DELTA}）`,
  );

  const aWhole = fullDb(fileA);
  const bWhole = fullDb(fileB);
  console.log(`  全片：A=${aWhole.toFixed(1)}dB B=${bWhole.toFixed(1)}dB`);

  check(pageErrors.length === 0, `零 pageerror（${pageErrors.length} 条）`);

  // ⑤ 证据留档
  const evidence = {
    at: new Date().toISOString(),
    segmentSec: SEGMENT_SEC,
    narration: {
      producer: narrationProducer,
      durationSec: Number(narrationSec.toFixed(3)),
      assetId: narrationAssetId,
      text: NARRATION_TEXT,
    },
    bgm: {
      producer: bgmProducer,
      durationSec: Number(bgmSec.toFixed(3)),
      assetId: bgmAssetId,
      prompt: BGM_PROMPT,
    },
    renders: {
      a: {
        taskId: taskA,
        bytes: sizeA,
        speechDb: aSpeech,
        controlDb: aControl,
        tailDb: aTail,
        underVoice100HzDb: aUnder,
        wholeDb: aWhole,
      },
      b: {
        taskId: taskB,
        bytes: sizeB,
        speechDb: bSpeech,
        controlDb: bControl,
        tailDb: bTail,
        underVoice100HzDb: bUnder,
        wholeDb: bWhole,
      },
    },
    verdict: failures.length === 0 ? 'pass' : 'fail',
    failures,
  };
  const evidencePath = path.join(EVIDENCE_DIR, 'phase1-audio-layers.json');
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`\n证据：${evidencePath}`);
} catch (error) {
  console.error(`\n✗ 执行中断：${error.message}`);
  failures.push(error.message);
} finally {
  if (browser !== null) await browser.close();
  if (child.exitCode === null) {
    child.kill();
    // 进程退出是异步的：立刻删目录会 EPERM（Windows 独占句柄），等一下再删
    await sleep(800);
  }
  if (!KEEP) {
    for (const dir of [DATA_DIR, OUTPUTS_DIR]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // 清不掉只是留了点临时文件，不影响验收结论
      }
    }
  } else {
    console.log(`--keep：临时目录保留在 ${DATA_DIR} / ${OUTPUTS_DIR} / ${WORK}`);
  }
}

if (failures.length > 0) {
  console.error(`\n✗ 声音分层验收失败 ${failures.length} 项：`);
  for (const item of failures) console.error(`  · ${item}`);
  exitCode = 1;
} else {
  console.log('\n✓ 声音分层验收通过：旁白与配乐都真的在成片里，且各自可归因');
}
process.exit(exitCode);
