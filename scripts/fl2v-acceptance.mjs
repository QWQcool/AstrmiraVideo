#!/usr/bin/env node

/**
 * 首尾帧（`fl2v`）真机验收（V2.104 / Phase 3）。
 *
 * ## 它证明什么
 * 1. **接线成立**：工作流里真的有两个 `LoadImage`（首帧 + 尾帧），
 *    `MiniMaxH3ImageToVideo.last_frame` 指向尾帧那个节点 —— 由**仓库自己的**
 *    `buildComfyWorkflow` + `deploy/comfyui-templates/*.api.json` 装配，不是另写一份；
 * 2. **上游接受**：ComfyUI 不报 `validating inner node`（说明连线没有指向已删节点）；
 * 3. **两张图都被吃进去**：用**相对 SSIM** 判归属 ——
 *    `ssim(首帧, 图A) > ssim(首帧, 图B)` 且 `ssim(尾帧, 图B) > ssim(尾帧, 图A)`。
 *
 * ## 为什么是"相对"而不是阈值
 * 合成视频的尾帧是**模型生成的中间态**，它与目标图的绝对相似度本来就不高
 * （2026-10-30 实测：尾帧 vs 目标 0.264 vs 另一张 0.148）。绝对阈值在这条流水线上不可靠
 * —— 与 B103 片 C 人脸相似度的结论同源：**只看排序，不看绝对值**。
 *
 * ## 用法
 * ```bash
 * pnpm smoke:fl2v -- --base http://127.0.0.1:18188 --first A.png --last B.png
 * ```
 * 前置：`pnpm build`（脚本读 `backend/dist` 的协议实现）+ 一台带 H3 权重与
 * `deploy/comfyui-templates/minimax-h3-t2v.*` 的 ComfyUI。
 *
 * 退出码：0 = 两个相对判据都成立；1 = 有一条不成立（或上游报错）；2 = 跑不了（缺参数/连不上/没 build）。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROTOCOL_ENTRY = path.join(ROOT, 'backend/dist/providers/comfyui/comfyuiProtocol.js');
const TEMPLATE_PATH = path.join(ROOT, 'deploy/comfyui-templates/minimax-h3-t2v.api.json');
const OUT_DIR = path.join(ROOT, '.tmp/e2e');

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] !== undefined && !argv[index + 1].startsWith('--')
    ? argv[index + 1]
    : fallback;
}

const fail = (message) => {
  console.error(`\n✗ 跑不了：${message}`);
  process.exit(2);
};

const BASE = (arg('base', process.env.COMFYUI_BASE_URL ?? 'http://127.0.0.1:8188')).replace(/\/+$/, '');
const FIRST = arg('first', null);
const LAST = arg('last', null);
const FRAMES = Number(arg('frames', '124')); // 17n+5 → 124 = 5.17s @24fps
const WIDTH = Number(arg('width', '608'));
const HEIGHT = Number(arg('height', '352'));
const PROMPT = arg('prompt', '镜头从第一帧平稳过渡到最后一帧，主体不变，运镜连续');
const SEED = Number(arg('seed', '4242'));

if (FIRST === null || LAST === null) {
  fail('要给两张图：--first <首帧.png> --last <尾帧.png>');
}
for (const file of [FIRST, LAST]) {
  if (!existsSync(file)) fail(`图片不存在：${file}`);
}
if (!existsSync(PROTOCOL_ENTRY)) fail('backend/dist 不存在 —— 先跑 `pnpm build`');
if (!existsSync(TEMPLATE_PATH)) fail(`模板不存在：${TEMPLATE_PATH}`);

for (const tool of ['ffmpeg', 'ffprobe']) {
  if (spawnSync(tool, ['-version'], { encoding: 'utf8' }).error !== undefined) fail(`找不到 ${tool}`);
}

// 用**仓库自己的**协议实现装配工作流（dist 是 ESM？——按需动态 import 两种形态都试）
async function loadBuilder() {
  try {
    const module = await import(new URL(`file://${PROTOCOL_ENTRY.replace(/\\/g, '/')}`).href);
    if (typeof module.buildComfyWorkflow === 'function') return module.buildComfyWorkflow;
  } catch {
    /* 落回 require */
  }
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  return require(PROTOCOL_ENTRY).buildComfyWorkflow;
}

async function uploadImage(file) {
  const form = new FormData();
  form.append('image', new Blob([readFileSync(file)], { type: 'image/png' }), path.basename(file));
  const response = await fetch(`${BASE}/upload/image`, { method: 'POST', body: form });
  if (!response.ok) throw new Error(`上传 ${file} 失败：HTTP ${response.status}`);
  const uploaded = await response.json();
  if (typeof uploaded?.name !== 'string') throw new Error(`上传响应里没有 name：${JSON.stringify(uploaded)}`);
  return uploaded.subfolder === undefined || uploaded.subfolder === ''
    ? uploaded.name
    : `${uploaded.subfolder}/${uploaded.name}`;
}

/** 窄带 SSIM（两个输入都压到 320×180，避免宽高不一致直接失败） */
function ssim(a, b) {
  const result = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-i', a, '-i', b, '-lavfi',
      '[0:v]scale=320:180[a];[1:v]scale=320:180[b];[a][b]ssim', '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const value = Number(/All:([\d.]+)/.exec(text)?.[1] ?? Number.NaN);
  if (Number.isNaN(value)) throw new Error(`读不出 SSIM：${text.slice(-300)}`);
  return value;
}

// ── 主流程 ──────────────────────────────────────────────────────────────

try {
  const stats = await fetch(`${BASE}/system_stats`, { signal: AbortSignal.timeout(5000) });
  if (!stats.ok) fail(`ComfyUI 返回 HTTP ${stats.status}（${BASE}）`);
} catch {
  fail(`连不上 ComfyUI（${BASE}）`);
}

const buildComfyWorkflow = await loadBuilder();
const template = JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8'));
const inventory = await (await fetch(`${BASE}/object_info/UNETLoader`)).json();
const unetNames = inventory?.UNETLoader?.input?.required?.unet_name?.[0] ?? [];
const h3 = unetNames.find((name) => String(name).includes('minimax_h3'));
if (h3 === undefined) fail(`这台 ComfyUI 没有 H3 权重（UNETLoader 候选：${unetNames.join(' / ')}）`);
const clipInfo = await (await fetch(`${BASE}/object_info/CLIPLoader`)).json();
const clipNames = clipInfo?.CLIPLoader?.input?.required?.clip_name?.[0] ?? [];
const clip = clipNames.find((name) => String(name).includes('minimax_h3'));
const vaeInfo = await (await fetch(`${BASE}/object_info/VAELoader`)).json();
const vaeNames = vaeInfo?.VAELoader?.input?.required?.vae_name?.[0] ?? [];
const vae = vaeNames.find((name) => String(name).includes('minimax_h3_video_vae'));
if (clip === undefined || vae === undefined) {
  fail(`H3 的 CLIP / VAE 不齐：clip=${clipNames.join('/')} vae=${vaeNames.join('/')}`);
}

const started = Date.now();
const first = await uploadImage(FIRST);
const last = await uploadImage(LAST);
console.log(`已上传：first=${first} last=${last}`);

const workflow = buildComfyWorkflow(
  {
    models: { unet: h3, clip, clipType: 'minimax', vae },
    prompt: PROMPT,
    negativePrompt: '',
    mode: 'fl2v',
    width: WIDTH,
    height: HEIGHT,
    frames: FRAMES,
    frameAlign: { mod: 17, offset: 5 },
    fps: 24,
    seed: SEED,
    dtype: 'default',
    startImageName: first,
    lastImageName: last,
    outputPrefix: 'astrmira/fl2v-acceptance',
  },
  template,
);

// ① 接线自检（在提交前就能看出来的那部分）
const loadImages = Object.entries(workflow).filter(([, node]) => node.class_type === 'LoadImage');
const lastLink = workflow['5']?.inputs?.last_frame;
const wiringOk =
  loadImages.length === 2 && Array.isArray(lastLink) && workflow[lastLink[0]]?.inputs?.image === last;
console.log(
  `${wiringOk ? '✓' : '✗'} 接线：${loadImages.length} 个 LoadImage，last_frame = ${JSON.stringify(lastLink)}` +
    ` → ${lastLink === undefined ? '（缺失）' : String(workflow[lastLink[0]]?.inputs?.image)}`,
);

const submit = await fetch(`${BASE}/prompt`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: workflow, client_id: 'astrmira-fl2v-acceptance' }),
});
const submitted = await submit.json();
if (!submit.ok) {
  console.error(`✗ 提交被拒：${JSON.stringify(submitted).slice(0, 1200)}`);
  process.exit(1);
}
const promptId = submitted.prompt_id;
console.log(`已提交 ${promptId}（${WIDTH}×${HEIGHT} × ${FRAMES} 帧，等 GPU）`);

let entry = null;
for (let index = 0; index < 900; index += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const history = await (await fetch(`${BASE}/history/${promptId}`)).json();
  if (history[promptId] !== undefined) {
    entry = history[promptId];
    break;
  }
}
if (entry === null) {
  console.error('✗ 15 分钟没出结果');
  process.exit(1);
}
if (entry.status?.status_str === 'error') {
  console.error(`✗ 执行出错：${JSON.stringify(entry.status.messages ?? entry.status).slice(0, 1500)}`);
  process.exit(1);
}

const files = Object.values(entry.outputs ?? {}).flatMap((node) => node.images ?? node.gifs ?? []);
const video = files.find((item) => /\.(mp4|webm|mkv|mov)$/i.test(String(item.filename ?? '')));
if (video === undefined) {
  console.error(`✗ 没有视频产物：${JSON.stringify(files).slice(0, 600)}`);
  process.exit(1);
}

if (!existsSync(OUT_DIR)) {
  const { mkdirSync } = await import('node:fs');
  mkdirSync(OUT_DIR, { recursive: true });
}
const outFile = path.join(OUT_DIR, 'fl2v-acceptance.mp4');
const viewUrl = `${BASE}/view?filename=${encodeURIComponent(video.filename)}&subfolder=${encodeURIComponent(video.subfolder ?? '')}&type=${video.type ?? 'output'}`;
writeFileSync(outFile, Buffer.from(await (await fetch(viewUrl)).arrayBuffer()));
const elapsedSec = (Date.now() - started) / 1000;

const probe = JSON.parse(
  spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,nb_frames',
    '-show_entries', 'format=duration', '-of', 'json', outFile], { encoding: 'utf8' }).stdout,
);
const videoStream = probe.streams.find((stream) => stream.codec_type === 'video');
const durationSec = Number(probe.format?.duration ?? 0);
console.log(
  `✓ 出片 ${elapsedSec.toFixed(1)}s：${videoStream?.width}×${videoStream?.height} / ${videoStream?.nb_frames} 帧 / ${durationSec.toFixed(2)}s`,
);

// ② 首尾帧归属（相对 SSIM）
const frameCount = Number(videoStream?.nb_frames ?? 0);
const firstFrame = path.join(OUT_DIR, 'fl2v-first.png');
const lastFrame = path.join(OUT_DIR, 'fl2v-last.png');
spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', outFile, '-vf', 'select=eq(n\\,0)',
  '-vframes', '1', firstFrame]);
spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-sseof', '-0.15', '-i', outFile,
  '-vframes', '1', lastFrame]);

const firstVsFirst = ssim(firstFrame, FIRST);
const firstVsLast = ssim(firstFrame, LAST);
const lastVsLast = ssim(lastFrame, LAST);
const lastVsFirst = ssim(lastFrame, FIRST);
console.log(`  首帧 vs 图A=${firstVsFirst.toFixed(4)}  vs 图B=${firstVsLast.toFixed(4)}`);
console.log(`  尾帧 vs 图A=${lastVsFirst.toFixed(4)}  vs 图B=${lastVsLast.toFixed(4)}`);
const firstOk = firstVsFirst > firstVsLast;
const lastOk = lastVsLast > lastVsFirst;
console.log(`${firstOk ? '✓' : '✗'} 首帧更像图A`);
console.log(`${lastOk ? '✓' : '✗'} 尾帧更像图B`);

const evidence = {
  at: new Date().toISOString(),
  base: BASE,
  promptId,
  elapsedSec: Number(elapsedSec.toFixed(1)),
  size: { width: videoStream?.width, height: videoStream?.height, frames: frameCount },
  durationSec: Number(durationSec.toFixed(3)),
  ssim: {
    firstFrameVsFirstImage: Number(firstVsFirst.toFixed(4)),
    firstFrameVsLastImage: Number(firstVsLast.toFixed(4)),
    lastFrameVsFirstImage: Number(lastVsFirst.toFixed(4)),
    lastFrameVsLastImage: Number(lastVsLast.toFixed(4)),
  },
  verdict: firstOk && lastOk && wiringOk ? 'pass' : 'fail',
};
writeFileSync(path.join(OUT_DIR, 'fl2v-acceptance.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`\n证据：${path.join(OUT_DIR, 'fl2v-acceptance.json')}`);

process.exit(firstOk && lastOk && wiringOk ? 0 : 1);
