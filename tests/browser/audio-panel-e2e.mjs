#!/usr/bin/env node

/**
 * Phase 2 · **一条龙**：文本 → 音频 → 自动进音效轨 → 导出 → ffprobe（2026-10-30）。
 *
 * 与 Phase 1 的 `smoke:audio` 的分工：
 * - Phase 1 证明"模型出的 wav **能**进成片"（上传 + 手拖 + 导出）；
 * - 这一条证明"**不用手拖**"—— 走产品自己的 `POST /api/audio` + 剪辑台的配音/配乐面板，
 *   生成完自动落到音效轨（起点 0、超出裁到片长、带淡入淡出），再导出验证声音真的在成片里。
 *
 * ## 判据（每条都能复算）
 * 1. 面板产出的任务是**真任务**：`GET /api/tasks/:id` 终态 `succeeded` 且带 `outputAudioUrl`
 *    （不是把 wav 直接塞进 DOM）；
 * 2. **落轨是自动的**：面板点完按钮，时间轴上出现音频片段且 `data-start-frame=0`，
 *    并且**配乐与配音各占一条音效轨**（V2.102 的叠加语义）；
 * 3. **声音真的在成片里**：ffprobe 看到音轨；1kHz（人声）比 6kHz 对照带高 ≥6dB；
 *    人声结束后的窗口里 B 比「只有配乐」那次高 —— 这次用**两条独立证据**：
 *    导出成片的总时长被裁到片长（没被 5s 配乐撑长），且低频（100Hz）在场；
 * 4. **隐私文案在界面上**：配音模式显示"第三方云"，配乐模式显示"本机"（原文来自引擎表）。
 *
 * ## 用法
 * ```bash
 * pnpm smoke:audio:panel            # 要 MiMo Key + 本机 ComfyUI（带 Stable Audio）
 * ```
 * 退出码：0 = 全过；1 = 有断言失败；2 = **跑不了**（缺 Key / 缺 ComfyUI / 缺 ffmpeg / 没 build）。
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
const HEADED = argv.includes('--headed');
const KEEP = argv.includes('--keep');
function arg(name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] !== undefined && !argv[index + 1].startsWith('--')
    ? argv[index + 1]
    : fallback;
}

const SEGMENT_SEC = Number(arg('seconds', '5'));
const NARRATION_TEXT = arg('text', '雪停以后，院子里只剩那枚红苹果。');
const BGM_PROMPT = arg('bgm-prompt', 'warm cinematic ambient score, soft piano, no vocals');

const fail = (message) => {
  console.error(`\n✗ 跑不了：${message}`);
  process.exit(2);
};

// ── 预检 ────────────────────────────────────────────────────────────────

for (const tool of ['ffmpeg', 'ffprobe']) {
  if (spawnSync(tool, ['-version'], { encoding: 'utf8' }).error !== undefined) {
    fail(`找不到 ${tool}`);
  }
}
if (!existsSync(BACKEND_ENTRY)) fail('backend/dist 不存在 —— 先跑 `pnpm build`');
if (!existsSync(FRONTEND_DIST)) fail('frontend/dist 不存在 —— 先跑 `pnpm build`');
if (!existsSync(path.join(CLIPS_DIR, 'base-720p-landscape-5s-audio.mp4'))) {
  fail('夹具片段缺失 —— 先跑 `node scripts/make-fixture-clips.mjs`');
}

/** MiMo 的 Key 在用户级环境变量里（见 docs/LOCAL-GPU-DEPLOY.md）；不打印 */
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

const MIMO_KEY = resolveMimoKey();
if (MIMO_KEY === null) {
  fail(
    '没有 MiMo_API_Key（这条脚本要验"配音"那条路）。设置后再跑：' +
      "$env:MiMo_API_Key = [Environment]::GetEnvironmentVariable('MiMo_API_Key','User')",
  );
}

const COMFY_AUDIO_BASE = process.env.COMFYUI_AUDIO_BASE ?? process.env.COMFY ?? 'http://127.0.0.1:8190';
try {
  const stats = await fetch(`${COMFY_AUDIO_BASE}/system_stats`, { signal: AbortSignal.timeout(4000) });
  if (!stats.ok) fail(`本机 ComfyUI 返回 HTTP ${stats.status}（${COMFY_AUDIO_BASE}）`);
} catch {
  fail(`连不上本机 ComfyUI（${COMFY_AUDIO_BASE}）—— Stable Audio 要在它上面跑`);
}

const failures = [];
function check(ok, message) {
  console.log(`${ok ? '✓' : '✗'} ${message}`);
  if (!ok) failures.push(message);
  return ok;
}

// ── 测量 ────────────────────────────────────────────────────────────────

function probe(file) {
  const raw = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'stream=codec_type', '-show_entries', 'format=duration',
      '-of', 'json', file],
    { encoding: 'utf8' },
  );
  return JSON.parse(raw);
}

function bandDb(file, hz, window = null) {
  const args = ['-hide_banner', '-vn'];
  if (window !== null) args.push('-ss', String(window[0]), '-t', String(window[1]));
  args.push('-i', file, '-af', `bandpass=f=${hz}:width_type=h:w=${Math.round(Math.max(40, hz * 0.15))},volumedetect`,
    '-f', 'null', '-');
  const text = `${spawnSync('ffmpeg', args, { encoding: 'utf8' }).stderr ?? ''}`;
  const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(text)?.[1];
  if (mean === undefined) throw new Error(`读不出 ${hz}Hz 电平`);
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

async function generateFixtureVideo(baseUrl) {
  const submit = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: '声音面板验收：夹具源片（音轨将被静音）',
      mode: 't2v',
      aspectRatio: '16:9',
      provider: 'fixture-local',
      params: { durationSec: SEGMENT_SEC },
    }),
  });
  if (!submit.ok) throw new Error(`夹具任务提交失败：HTTP ${submit.status}`);
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

// ── 主流程 ──────────────────────────────────────────────────────────────

mkdirSync(EVIDENCE_DIR, { recursive: true });
const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-ap-data-'));
const OUTPUTS_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-ap-out-'));
const PORT = await freePort();
const baseUrl = `http://127.0.0.1:${PORT}`;

console.log('\n=== Phase 2 · 文本 → 音频 → 自动落轨 → 导出 ===');
console.log(`实例：${baseUrl}（MiMo 配音 + 本机 Stable Audio 配乐）`);

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
    PUBLIC_API_TOKEN: 'audio-panel-loopback-only',
    VOLCANO_API_KEY: '',
    ENABLE_FIXTURE_PROVIDER: '1',
    MIMO_API_KEY: MIMO_KEY,
    COMFYUI_AUDIO_BASE: COMFY_AUDIO_BASE,
  },
  stdio: 'ignore',
});

let browser = null;
let exitCode = 0;
try {
  if (!(await waitForHealth(baseUrl))) throw new Error('后端未在 40s 内就绪');
  const source = await generateFixtureVideo(baseUrl);
  console.log(`源片：${source.taskId.slice(0, 8)}`);

  browser = await chromium.launch({ headless: !HEADED });
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(`${baseUrl}/#/edit?task=${encodeURIComponent(source.taskId)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid=ed-audio-panel]', { timeout: 60_000 });

  // 静音源片（夹具声是宽带底噪，留着会淹掉判据 —— 与 Phase 1 同一条理由）
  await page.locator('.ed-clip-video').first().click({ timeout: 20_000 });
  const volume = page.locator('[data-testid=ed-inspector] input.ed-field-number').nth(1);
  await volume.fill('0');
  await volume.dispatchEvent('change');
  await sleep(200);

  const panel = page.locator('[data-testid=ed-audio-panel]');

  // ① 配乐：本机 Stable Audio（隐私文案必须是"本机"）
  await panel.getByRole('button', { name: '配乐' }).click();
  const bgmPrivacy = await panel.locator('[data-testid=ed-audio-privacy]').innerText();
  check(bgmPrivacy.includes('本机'), '配乐模式如实标注"本机"（数据不出机器）');

  await panel.locator('#ed-audio-prompt').fill(BGM_PROMPT);
  await panel.locator('#ed-audio-seconds').fill(String(SEGMENT_SEC));
  await panel.getByRole('button', { name: /生成并落到音效轨/ }).click({ timeout: 20_000 });
  console.log('… 本机 Stable Audio 生成中（冷态实测 39–47s）');
  await page.waitForSelector('[data-testid=ed-audio-done]', { timeout: 300_000 });
  check(true, `配乐已自动落轨：${await panel.locator('[data-testid=ed-audio-done]').innerText()}`);

  const audioClips = page.locator('.ed-clip-audio');
  check((await audioClips.count()) === 1, `时间轴上有一条音频片段（实际 ${await audioClips.count()}）`);
  check(
    Number(await audioClips.first().getAttribute('data-start-frame')) === 0,
    '配乐落在 0 帧（不用手拖）',
  );

  // ② 配音：MiMo（第三方云 —— 隐私必须写在按钮旁边）
  await panel.getByRole('button', { name: '配音' }).click();
  const ttsPrivacy = await panel.locator('[data-testid=ed-audio-privacy]').innerText();
  check(ttsPrivacy.includes('第三方云'), '配音模式如实标注"第三方云"（文本会离开这台机器）');

  await panel.locator('#ed-audio-text').fill(NARRATION_TEXT);
  await panel.getByRole('button', { name: /生成并落到音效轨/ }).click({ timeout: 20_000 });
  console.log('… MiMo 配音中（实测 2–3.5× 实时）');
  await page.waitForFunction(
    () => document.querySelectorAll('.ed-clip-audio').length === 2,
    { timeout: 300_000 },
  );
  await sleep(500);
  check((await audioClips.count()) === 2, '配音也落到时间轴上（两条音频片段）');
  check(
    Number(await audioClips.last().getAttribute('data-start-frame')) === 0,
    '配音同样从 0 帧开始（与配乐叠加，不是排队）',
  );
  const audioTracks = await page.locator('.ed-track-row[data-track-kind=audio]').count();
  check(audioTracks === 2, `两条音效轨（配乐一条、配音一条；实际 ${audioTracks}）`);

  // ③ 导出 → 入库 → 取回
  await page.getByRole('button', { name: /导出成片/ }).click({ timeout: 30_000 });
  await page.waitForSelector('a[download]', { timeout: 300_000 });
  const summary = await page.locator('.ed-export-result .wb-note').first().innerText();
  console.log(`  导出完成：${summary}`);

  const sawArchive = page.waitForResponse(
    (response) => response.url().includes('/api/edits/renders') && response.request().method() === 'POST',
    { timeout: 180_000 },
  );
  await page.getByRole('button', { name: /入库/ }).click({ timeout: 30_000 });
  const archived = await sawArchive;
  check(archived.ok(), `入库成功（HTTP ${archived.status()}）`);
  const renderTaskId = (await archived.json())?.taskId;

  const detail = await (await fetch(`${baseUrl}/api/tasks/${renderTaskId}`)).json();
  const localFile = path.join(EVIDENCE_DIR, 'phase2-audio-panel.mp4');
  writeFileSync(localFile, Buffer.from(await (await fetch(`${baseUrl}${detail.outputVideoUrl}`)).arrayBuffer()));

  // ④ ffprobe + 频谱
  const info = probe(localFile);
  const kinds = info.streams.map((stream) => stream.codec_type);
  const duration = Number(info.format?.duration ?? 0);
  check(kinds.includes('audio'), `成片里有音轨（${kinds.join('/')}）`);
  check(
    Math.abs(duration - SEGMENT_SEC) < 0.5,
    `成片时长 ${duration.toFixed(2)}s ≈ ${SEGMENT_SEC}s（配乐没把片子撑长）`,
  );

  const speech = bandDb(localFile, 1000);
  const control = bandDb(localFile, 6000);
  console.log(`  窄带：1kHz=${speech.toFixed(1)}dB 对照 6kHz=${control.toFixed(1)}dB`);
  check(speech > control + 6, `旁白真的在成片里（1kHz 高出对照带 ${(speech - control).toFixed(1)}dB ≥ 6）`);

  /**
   * ⑤ 归因：**去掉配乐再导一次**（与 Phase 1 同法）。
   *
   * 只量混合成片是证明不了"配乐在里面"的 —— 旁白自己也有低频。
   * 两次导出只差配乐，100Hz 的落差才是配乐的贡献。
   */
  await audioClips.first().click({ timeout: 20_000 });
  await page.getByRole('button', { name: /删除片段/ }).click({ timeout: 20_000 });
  await sleep(400);
  check((await audioClips.count()) === 1, '配乐片段已移除（只剩旁白）');

  await page.getByRole('button', { name: /导出成片/ }).click({ timeout: 30_000 });
  await page.waitForSelector('a[download]', { timeout: 300_000 });
  const sawSecond = page.waitForResponse(
    (response) => response.url().includes('/api/edits/renders') && response.request().method() === 'POST',
    { timeout: 180_000 },
  );
  await page.getByRole('button', { name: /入库/ }).click({ timeout: 30_000 });
  const archivedSecond = await sawSecond;
  const secondTaskId = (await archivedSecond.json())?.taskId;
  const secondDetail = await (await fetch(`${baseUrl}/api/tasks/${secondTaskId}`)).json();
  const narrationOnlyFile = path.join(EVIDENCE_DIR, 'phase2-narration-only.mp4');
  writeFileSync(
    narrationOnlyFile,
    Buffer.from(await (await fetch(`${baseUrl}${secondDetail.outputVideoUrl}`)).arrayBuffer()),
  );

  const bassMix = bandDb(localFile, 100);
  const bassNarration = bandDb(narrationOnlyFile, 100);
  const speechNarration = bandDb(narrationOnlyFile, 1000);
  const controlNarration = bandDb(narrationOnlyFile, 6000);
  console.log(
    `  100Hz：混合=${bassMix.toFixed(1)}dB 旁白独奏=${bassNarration.toFixed(1)}dB` +
      ` · 旁白独奏 1kHz=${speechNarration.toFixed(1)}dB 6kHz=${controlNarration.toFixed(1)}dB`,
  );
  check(
    bassMix > bassNarration + 3,
    `配乐真的在成片里（100Hz 比"只有旁白"高 ${(bassMix - bassNarration).toFixed(1)}dB ≥ 3）`,
  );
  check(
    speechNarration > controlNarration + 6,
    `旁白独奏里人声仍在（1kHz 高 ${(speechNarration - controlNarration).toFixed(1)}dB）`,
  );

  check(pageErrors.length === 0, `零 pageerror（${pageErrors.length} 条）`);

  const evidence = {
    at: new Date().toISOString(),
    segmentSec: SEGMENT_SEC,
    sourceTaskId: source.taskId,
    narration: { text: NARRATION_TEXT, engine: 'mimo-tts' },
    bgm: { prompt: BGM_PROMPT, engine: 'host-stable-audio' },
    render: {
      taskId: renderTaskId,
      bytes: statSync(localFile).size,
      durationSec: Number(duration.toFixed(3)),
      speechDb: speech,
      controlDb: control,
      bass100HzDb: bassMix,
    },
    narrationOnly: {
      taskId: secondTaskId,
      bytes: statSync(narrationOnlyFile).size,
      speechDb: speechNarration,
      controlDb: controlNarration,
      bass100HzDb: bassNarration,
    },
    verdict: failures.length === 0 ? 'pass' : 'fail',
    failures,
  };
  writeFileSync(
    path.join(EVIDENCE_DIR, 'phase2-audio-panel.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  console.log(`\n产物：${localFile}`);
} catch (error) {
  console.error(`\n✗ 执行中断：${error.message}`);
  failures.push(error.message);
} finally {
  if (browser !== null) await browser.close();
  if (child.exitCode === null) {
    child.kill();
    await sleep(800);
  }
  if (!KEEP) {
    for (const dir of [DATA_DIR, OUTPUTS_DIR]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* 临时目录残留无碍 */
      }
    }
  } else {
    console.log(`--keep：临时目录保留在 ${DATA_DIR} / ${OUTPUTS_DIR}`);
  }
}

if (failures.length > 0) {
  console.error(`\n✗ Phase 2 端到端失败 ${failures.length} 项：`);
  for (const item of failures) console.error(`  · ${item}`);
  exitCode = 1;
} else {
  console.log('\n✓ Phase 2 通过：文本 → 音频 → 自动落轨 → 导出，两层声音都在成片里');
}
process.exit(exitCode);
