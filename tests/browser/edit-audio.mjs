#!/usr/bin/env node

/**
 * 剪辑台**音效轨**的真实闭环（2026-10-29）。
 *
 * 为什么要有它：音频链路上有两件事**从来没有被验证过**——
 * 1. 服务端 `POST /api/edits` 的 EditScript **没有"混入外部音频"这个操作**（只有
 *    trim / concat / xfade / volume / speed / extractFrame），所以"给成片加一条 BGM"
 *    不是服务端 ffmpeg 干的，而是**浏览器端 Remotion 时间轴**渲染出来的；
 * 2. 于是"音频真的进了成片"只存在于「浏览器渲染 + `POST /api/edits/renders` 入库」这条链上，
 *    而这条链此前一条自动化都没有（剪辑台 P2/P3 全无浏览器验收）。
 *
 * 判据（不是"界面上多了个块"，而是**频谱证据**）：
 * - 用一段 **1000Hz 正弦**当 BGM（夹具视频自带音轨是 440Hz，故意错开频率）；
 * - 导出后量窄带能量：**1000Hz 必须显著高于 3000Hz（无信号对照带）** —— 这证明混进去的
 *   就是**这一段**音频，而不是"随便有点声音"；
 * - 同时量 440Hz：源片音轨还在（BGM 是叠加，不是替换）。
 *
 * 用法：`node tests/browser/edit-audio.mjs [--headed] [--keep]`
 * 前置：`pnpm build` + 本机 ffmpeg + `node scripts/make-fixture-clips.mjs`（夹具片段）。
 * 全程零外网、零 GPU：源片由内置夹具 provider 现场合成。
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
const flags = new Set(process.argv.slice(2));
const HEADED = flags.has('--headed');
const KEEP = flags.has('--keep');

const TONE_HZ = 1000;
const CONTROL_HZ = 3000;
const WORK = mkdtempSync(path.join(tmpdir(), 'astrmira-edit-audio-'));

const failures = [];
function check(ok, message) {
  console.log(`${ok ? '✓' : '✗'} ${message}`);
  if (!ok) failures.push(message);
  return ok;
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

/** 某段窄带（±40Hz）的平均电平（dB）；无信号时约 -91dB。 */
function bandVolumeDb(file, hz) {
  const result = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-i', file, '-af', `bandpass=f=${hz}:width_type=h:w=40,volumedetect`, '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(text)?.[1];
  if (mean === undefined) throw new Error(`读不出 ${hz}Hz 电平：${text.slice(-300)}`);
  return Number(mean);
}

async function uploadTo(baseUrl, file, mime) {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(file)], { type: mime }), path.basename(file));
  const payload = await (await fetch(`${baseUrl}/api/upload`, { method: 'POST', body: form })).json();
  const assetId = payload?.assets?.[0]?.assetId;
  if (assetId === undefined) throw new Error(`上传失败：${JSON.stringify(payload).slice(0, 300)}`);
  return assetId;
}

/** 夹具 provider 造一条**真实**带音轨的成片（440Hz），60s 内必须完成 */
async function generateFixtureVideo(baseUrl) {
  const submit = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: '音效轨验收：夹具源片',
      mode: 't2v',
      aspectRatio: '16:9',
      provider: 'fixture-local',
      params: { durationSec: 5 },
    }),
  });
  if (!submit.ok) {
    throw new Error(`夹具任务提交失败：HTTP ${submit.status} ${(await submit.text()).slice(0, 200)}`);
  }
  const { taskId } = await submit.json();
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const progress = await (await fetch(`${baseUrl}/api/tasks/${taskId}`)).json();
    if (progress.status === 'succeeded') return progress;
    if (progress.status === 'failed') throw new Error('夹具视频生成失败');
    await sleep(250);
  }
  throw new Error('夹具视频未在 60s 内完成');
}

if (!existsSync(path.join(CLIPS_DIR, 'base-720p-landscape-5s-audio.mp4'))) {
  console.error('✗ 夹具片段缺失：先执行 `node scripts/make-fixture-clips.mjs`');
  process.exit(1);
}

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-ea-data-'));
const OUTPUTS_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-ea-out-'));
const PORT = await freePort();
const baseUrl = `http://127.0.0.1:${PORT}`;

console.log('\n=== 剪辑台音效轨：BGM 是否真的进了成片 ===');
console.log(`实例：${baseUrl}（源片=夹具 provider 合成，BGM=${TONE_HZ}Hz 正弦）`);

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
    PUBLIC_API_TOKEN: 'edit-audio-loopback-only',
    VOLCANO_API_KEY: '',
    ENABLE_FIXTURE_PROVIDER: '1',
  },
  stdio: 'ignore',
});

let browser = null;
let exitCode = 0;
try {
  if (!(await waitForHealth(baseUrl))) throw new Error('后端未在 40s 内就绪');

  // ① BGM（1000Hz 5s）→ 上传成音频素材
  const toneFile = path.join(WORK, 'bgm-1000hz.wav');
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `sine=frequency=${TONE_HZ}:duration=5`,
    '-c:a', 'pcm_s16le', toneFile,
  ]);
  const bgmAssetId = await uploadTo(baseUrl, toneFile, 'audio/wav');
  console.log(`BGM 已上传：${bgmAssetId}`);

  // ② 源片
  const source = await generateFixtureVideo(baseUrl);
  console.log(`源片：${source.taskId.slice(0, 8)}（${source.outputVideoUrl}）`);

  // ③ 浏览器：剪辑台 → 加音效 → 导出 → 入库
  browser = await chromium.launch({ headless: !HEADED });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(`${baseUrl}/#/edit?task=${encodeURIComponent(source.taskId)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ed-tl-pick', { timeout: 60_000 });

  await page.selectOption('.ed-tl-pick', `asset:${bgmAssetId}`);
  await page.getByRole('button', { name: '＋音效' }).click({ timeout: 20_000 });
  await sleep(500);

  await page.getByRole('button', { name: /导出成片/ }).click({ timeout: 20_000 });
  console.log('… 浏览器渲染中（WebCodecs，5s/720p）');
  await page.waitForSelector('a[download]', { timeout: 300_000 });
  const summary = await page.locator('.ed-export-result .wb-note').first().innerText();
  console.log(`导出完成：${summary}`);

  const archiveSaw = page.waitForResponse(
    (response) => response.url().includes('/api/edits/renders') && response.request().method() === 'POST',
    { timeout: 180_000 },
  );
  await page.getByRole('button', { name: /入库/ }).click({ timeout: 20_000 });
  const archived = await archiveSaw;
  check(archived.ok(), `入库接口成功（HTTP ${archived.status()}）`);
  const archivedTaskId = (await archived.json())?.taskId;

  // ④ 取回成片 → 频谱判据
  const detail = await (await fetch(`${baseUrl}/api/tasks/${archivedTaskId}`)).json();
  check(typeof detail.outputVideoUrl === 'string', `剪辑产物有输出文件（${detail.outputVideoUrl}）`);
  const localFile = path.join(WORK, 'export.mp4');
  const bytes = await (await fetch(`${baseUrl}${detail.outputVideoUrl}`)).arrayBuffer();
  writeFileSync(localFile, Buffer.from(bytes));
  check(statSync(localFile).size > 100_000, `成片字节数合理（${(statSync(localFile).size / 1024).toFixed(0)} KB）`);

  const streams = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', localFile],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter((line) => line !== '');
  check(streams.includes('audio'), `成片里有音轨（${streams.join('/')}）`);

  const tone = bandVolumeDb(localFile, TONE_HZ);
  const control = bandVolumeDb(localFile, CONTROL_HZ);
  const sourceTone = bandVolumeDb(localFile, 440);
  console.log(
    `  窄带电平：${TONE_HZ}Hz=${tone.toFixed(1)}dB（BGM）  对照 ${CONTROL_HZ}Hz=${control.toFixed(1)}dB  源片 440Hz=${sourceTone.toFixed(1)}dB`,
  );
  check(tone > control + 6, `BGM 真的混进去了（${TONE_HZ}Hz 比对照带高 ${(tone - control).toFixed(1)}dB ≥ 6）`);
  check(sourceTone > control + 6, `源片自带音轨还在（440Hz 比对照带高 ${(sourceTone - control).toFixed(1)}dB）`);
  check(pageErrors.length === 0, `零 pageerror（${pageErrors.length} 条）`);

  console.log(`\n产物：${localFile}`);
} catch (error) {
  console.error(`\n✗ 执行中断：${error.message}`);
  failures.push(error.message);
} finally {
  if (browser !== null) await browser.close();
  if (child.exitCode === null) child.kill();
  if (!KEEP) {
    for (const dir of [DATA_DIR, OUTPUTS_DIR]) rmSync(dir, { recursive: true, force: true });
  } else {
    console.log(`--keep：临时目录保留在 ${DATA_DIR} / ${OUTPUTS_DIR} / ${WORK}`);
  }
}

if (failures.length > 0) {
  console.error(`\n✗ 音效轨验收失败 ${failures.length} 项：`);
  for (const failure of failures) console.error(`  · ${failure}`);
  exitCode = 1;
} else {
  console.log('\n✓ 音效轨验收通过：加进去的那段 BGM 真的进了成片');
}
process.exit(exitCode);
