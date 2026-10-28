#!/usr/bin/env node
/**
 * 图片编辑三项的**真机验收**：超清 / 蒙版重绘 / 扩图（B102）。
 *
 * 为什么要有这个脚本：这三项都属于"几何对了但内容没生成"那一类**没有运行期症状**的失败
 * —— 2026-10-28 扩图就是这样：尺寸、条数、状态全对，只有新画区域是纯灰。
 * 因此判据必须看**像素**，并且固化成可重复执行的一条命令：
 *
 *   pnpm smoke:image --asset <已有的图片 assetId>
 *
 * 判据（任一不过就 exit 1）：
 * 1. 超清：产物宽高 = 源 × 2，且内容与源不同（不是原图复制）；
 * 2. 蒙版重绘：产物尺寸不变；**蒙版外**PSNR ≥ 40dB（原样保留）；**蒙版内**PSNR ≤ 30dB（真重画）；
 * 3. 扩图：产物宽高 = 源 + 四边 expand；内部原图区 PSNR ≥ 40dB；
 *    **新画区域的标准差 ≥ 8**（纯灰 ≈ 0，有内容才会大）—— 这条专门盯"灰边"回归。
 *
 * 依赖：本机 ffmpeg/ffprobe；站点已配 EXPOSE_HOST_LOCAL_TRACK + COMFYUI_*（否则跑不了）。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};

const BASE = (flag('base', process.env.PUBLIC_BASE_URL ?? 'http://127.0.0.1:3000')).replace(/\/$/, '');
const ASSET = flag('asset', '');
const EXPAND = Number(flag('expand', '64'));
const WORK = mkdtempSync(path.join(tmpdir(), 'astrmira-image-accept-'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (ASSET === '') {
  console.error('✗ 需要 --asset <图片资产 id>（在视频库/素材面板里挑一张真实照片）');
  process.exit(1);
}

function run(bin, argv) {
  return execFileSync(bin, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function dimensionOf(file) {
  const out = run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file,
  ]).trim();
  const [width, height] = out.split(',').map(Number);
  return { width, height };
}

/**
 * 两块图**各自区域**的 PSNR（ffmpeg 把结果写 **stderr**，成功时也要读 stderr）。
 *
 * `rightCrop` 缺省与 `leftCrop` 相同；扩图那种"同一块内容在两图里坐标不同"的场景要分开给。
 */
function psnrOfRegion(left, right, leftCrop, rightCrop = leftCrop) {
  // 注意：不能用 execFileSync 的返回值 —— 它只给 stdout，而 psnr 的结论在 stderr 上。
  // 2026-10-28 在这里踩过一次：拿不到数字就退化成 0dB，结论全反。
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner', '-i', left, '-i', right,
      '-filter_complex', `[0]${leftCrop}[a];[1]${rightCrop}[b];[a][b]psnr`,
      '-f', 'null', '-',
    ],
    { encoding: 'utf8' },
  );
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const average = /average:([0-9.]+|inf)/.exec(text)?.[1];
  if (average === undefined) throw new Error(`读不出 PSNR（ffmpeg stderr）：${text.slice(-300)}`);
  return average === 'inf' ? Number.POSITIVE_INFINITY : Number(average);
}

/**
 * 某区域灰度的标准差（纯灰 ≈ 0，有内容才大）。
 *
 * 实现：把该区域解成原始 8bit 灰度像素再自己算 —— 不依赖 signalstats 的日志格式，
 * 也不受"日志写 stderr 还是 stdout"影响。
 */
function stdDevOfRegion(file, crop) {
  const buffer = execFileSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', crop, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  let sum = 0;
  for (const value of buffer) sum += value;
  const mean = sum / buffer.length;
  let variance = 0;
  for (const value of buffer) variance += (value - mean) ** 2;
  return Math.sqrt(variance / buffer.length);
}

const failures = [];
function check(ok, message) {
  console.log(`${ok ? '✓' : '✗'} ${message}`);
  if (!ok) failures.push(message);
}

async function submit(body, key) {
  // 防线 5 的 60s 冷却是真的会拦人：脚本自己等，而不是把 429 当失败（否则这条验收不可重复执行）
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${BASE}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': `${key}-${attempt}` },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (response.ok) return payload.taskId;
    if (response.status === 429) {
      const waitMs = /(\d+)\s*s/.exec(payload.message ?? '')?.[1];
      const seconds = waitMs === undefined ? 61 : Number(waitMs) + 2;
      console.log(`… 冷却中，等 ${seconds}s 再提交`);
      await sleep(seconds * 1000);
      continue;
    }
    throw new Error(`提交失败 ${response.status}：${JSON.stringify(payload).slice(0, 200)}`);
  }
  throw new Error('连续撞冷却 3 次，放弃（确认没有别的任务在跑？）');
}

async function waitDone(taskId) {
  for (let i = 0; i < 300; i += 1) {
    await sleep(1000);
    const task = await (await fetch(`${BASE}/api/tasks/${taskId}`)).json();
    if (!['succeeded', 'failed', 'cancelled'].includes(task.status)) continue;
    if (task.status !== 'succeeded') {
      throw new Error(`任务 ${taskId} ${task.status}：${task.error?.message ?? '无错误信息'}`);
    }
    return task;
  }
  throw new Error(`任务 ${taskId} 超时`);
}

async function download(url, file) {
  const response = await fetch(`${BASE}${url}`);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  return file;
}

// ── 源图信息（直接量资产文件，不猜） ──────────────────────────────────────
const assets = await (await fetch(`${BASE}/api/assets?limit=200`)).json();
const asset = (assets.assets ?? []).find((item) => item.assetId === ASSET);
if (asset === undefined) {
  console.error(`✗ 找不到资产 ${ASSET}（用 /api/assets 列一下可用 id）`);
  process.exit(1);
}
const sourceFile = await download(asset.url, path.join(WORK, 'source.bin'));
const sourceDim = dimensionOf(sourceFile);
console.log(`源图 ${sourceDim.width}×${sourceDim.height}（${asset.url}）`);

// ── 1. 超清 2× ────────────────────────────────────────────────────────────
const upscaleTask = await waitDone(
  await submit(
    {
      prompt: '',
      mode: 'upscale',
      assets: { firstFrameImage: ASSET },
      aspectRatio: '16:9',
      resolution: sourceDim,
      options: { scale: '2' },
      provider: 'host-comfyui',
    },
    `accept-upscale-${Date.now()}`,
  ),
);
const upscaleFile = await download(upscaleTask.outputImageUrl, path.join(WORK, 'upscale.png'));
const upscaleDim = dimensionOf(upscaleFile);
check(
  upscaleDim.width === sourceDim.width * 2 && upscaleDim.height === sourceDim.height * 2,
  `超清 2×：${sourceDim.width}×${sourceDim.height} → ${upscaleDim.width}×${upscaleDim.height}`,
);

await sleep(62_000);

// ── 2. 蒙版重绘 ──────────────────────────────────────────────────────────
const maskFile = path.join(WORK, 'mask.png');
const maskWidth = 400;
const maskHeight = 280;
run('ffmpeg', [
  '-y',
  '-f', 'lavfi', '-i', `color=c=black:s=${sourceDim.width}x${sourceDim.height}`,
  '-f', 'lavfi', '-i', `color=c=white:s=${maskWidth}x${maskHeight}`,
  '-filter_complex', '[0][1]overlay=(W-w)/2:(H-h)/2',
  '-frames:v', '1', maskFile,
]);
const form = new FormData();
form.append('file', new Blob([readFileSync(maskFile)], { type: 'image/png' }), 'mask.png');
const uploaded = await (await fetch(`${BASE}/api/upload`, { method: 'POST', body: form })).json();
const maskId = uploaded?.assets?.[0]?.assetId;
if (maskId === undefined) throw new Error('蒙版上传失败：服务端没有返回 assetId');

const inpaintTask = await waitDone(
  await submit(
    {
      prompt: '画面中央出现一个红苹果',
      mode: 'inpaint',
      assets: { firstFrameImage: ASSET, maskImage: maskId },
      aspectRatio: '16:9',
      resolution: sourceDim,
      provider: 'host-comfyui',
    },
    `accept-inpaint-${Date.now()}`,
  ),
);
const inpaintFile = await download(inpaintTask.outputImageUrl, path.join(WORK, 'inpaint.png'));
const inpaintDim = dimensionOf(inpaintFile);
const outside = psnrOfRegion(sourceFile, inpaintFile, `crop=300:${sourceDim.height}:0:0`);
const inside = psnrOfRegion(
  sourceFile,
  inpaintFile,
  `crop=${maskWidth}:${maskHeight}:${Math.round((sourceDim.width - maskWidth) / 2)}:${Math.round((sourceDim.height - maskHeight) / 2)}`,
);
check(inpaintDim.width === sourceDim.width && inpaintDim.height === sourceDim.height, '重绘：尺寸不变');
check(outside >= 40, `重绘：蒙版外保留（PSNR ${outside.toFixed(1)}dB ≥ 40）`);
check(inside <= 30, `重绘：蒙版内真重画（PSNR ${inside.toFixed(1)}dB ≤ 30）`);

await sleep(62_000);

// ── 3. 扩图 ──────────────────────────────────────────────────────────────
const outpaintTask = await waitDone(
  await submit(
    {
      prompt: '把画面向四周延展，院子与光线继续长出来，写实质感',
      mode: 'outpaint',
      assets: { firstFrameImage: ASSET },
      aspectRatio: '16:9',
      resolution: sourceDim,
      options: { expand: { left: EXPAND, top: EXPAND, right: EXPAND, bottom: EXPAND } },
      provider: 'host-comfyui',
    },
    `accept-outpaint-${Date.now()}`,
  ),
);
const outpaintFile = await download(outpaintTask.outputImageUrl, path.join(WORK, 'outpaint.png'));
const outpaintDim = dimensionOf(outpaintFile);
// 内部区判据要**躲开接缝羽化带**（模板 feathering=40，羽化会把接缝附近几十像素混掉）：
// 只量"离接缝至少 SEAM_INSET 像素"的核心区，否则一条正常结果也会被判不达标。
const SEAM_INSET = 48;
const coreCrop = `crop=${sourceDim.width - SEAM_INSET * 2}:${sourceDim.height - SEAM_INSET * 2}`;
const inner = psnrOfRegion(
  sourceFile,
  outpaintFile,
  `${coreCrop}:${SEAM_INSET}:${SEAM_INSET}`,
  `${coreCrop}:${EXPAND + SEAM_INSET}:${EXPAND + SEAM_INSET}`,
);
const ringStdDev = stdDevOfRegion(outpaintFile, `crop=48:${outpaintDim.height}:0:0`);
check(
  outpaintDim.width === sourceDim.width + EXPAND * 2 && outpaintDim.height === sourceDim.height + EXPAND * 2,
  `扩图：几何 ${sourceDim.width}×${sourceDim.height} → ${outpaintDim.width}×${outpaintDim.height}`,
);
check(inner >= 40, `扩图：内部核心区保留（离接缝 ≥${SEAM_INSET}px，PSNR ${inner.toFixed(1)}dB ≥ 40）`);
check(ringStdDev >= 8, `扩图：新区域有内容（标准差 ${ringStdDev.toFixed(1)} ≥ 8，纯灰≈0）`);

console.log(`\n产物目录：${WORK}`);
if (failures.length > 0) {
  console.error(`\n✗ 图片编辑验收失败 ${failures.length} 项：`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}
console.log('\n✓ 图片编辑验收通过（超清 / 蒙版重绘 / 扩图）');
