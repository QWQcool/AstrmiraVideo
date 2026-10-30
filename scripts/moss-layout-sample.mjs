#!/usr/bin/env node

/**
 * MOSS-Image 的 **JSON 布局提示词**长什么样、边界框管不管用（Phase 3-10 的一次性探针）。
 *
 * 这不是产品能力，是"拍板前先看样例"用的。若要把它做成能力（画布框 → 布局提示词 → 直出），
 * 要改的是契约 + provider，不是这个脚本。
 *
 * ## 格式从哪来
 * 不是猜的 —— ComfyUI 0.43 的 `comfy_extras/nodes_moss_image.py` 里
 * `MOSSImageLayoutPrompt.execute()` 做的就是把这个 dict `json.dumps` 后喂给 `CLIPTextEncode`：
 * ```json
 * { "summary": {"caption": "..."},
 *   "items": [{"label": "object", "caption": "...", "bbox": [y0, x0, y1, x1]}],
 *   "bbox_coord_space": "abs_centralized", "bbox_format": "yxyx" }
 * ```
 * 入参是 **0–1000 归一化 `[y0,x0,y1,x1]`**，节点内部换成"**以画布中心为原点**的像素"。
 *
 * ## 判据（可复算，不看"感觉对不对"）
 * 左框区与右框区各压成 1 像素求均值：**左区偏红（R 明显大于 B）、右区偏蓝**。
 * 两个都成立 = 框被遵守；只成立一个 = 只摆对了一半。
 *
 * ## 用法
 * ```bash
 * node scripts/moss-layout-sample.mjs --base http://127.0.0.1:18188
 * ```
 * 前置：一台装了 MOSS 三件套（`moss_image_sft_bf16` / `qwen3.5_9b_bf16` / `flux2-vae`）的 ComfyUI。
 * 产物：`.tmp/e2e/moss-layout.png` + `.tmp/e2e/moss-layout.json`（证据）。
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

const BASE = (arg('base', process.env.COMFYUI_BASE_URL ?? 'http://127.0.0.1:8188')).replace(/\/+$/, '');
const WIDTH = Number(arg('width', '1024'));
const HEIGHT = Number(arg('height', '576'));

const template = JSON.parse(
  readFileSync(path.join(ROOT, 'deploy/comfyui-templates/moss-image-t2i-full.api.json'), 'utf8'),
);

/** 与 `MOSSImageLayoutPrompt.execute()` 逐行同构（0-1000 [y0,x0,y1,x1] → 中心原点的像素） */
export function buildLayoutJson(prompt, elements, width, height) {
  const items = elements.map((element) => {
    const item = { label: element.label, caption: element.caption };
    if (element.label === 'text') item.text = element.text;
    const [y0, x0, y1, x1] = element.bbox;
    item.bbox = [
      Math.floor(Math.round((y0 * height) / 1000, 9)) - Math.floor(height / 2),
      Math.floor(Math.round((x0 * width) / 1000, 9)) - Math.floor(width / 2),
      Math.ceil(Math.round((y1 * height) / 1000, 9)) - Math.floor(height / 2),
      Math.ceil(Math.round((x1 * width) / 1000, 9)) - Math.floor(width / 2),
    ];
    return item;
  });
  return JSON.stringify({
    summary: { caption: prompt.trim() },
    items,
    bbox_coord_space: 'abs_centralized',
    bbox_format: 'yxyx',
  });
}

const SUMMARY =
  'A clean studio product photo on a seamless white table: a glossy red sphere on the left, ' +
  'a matte blue cube on the right, soft key light, no text.';
const ELEMENTS = [
  { label: 'object', caption: 'a glossy red sphere', bbox: [300, 40, 800, 380] },
  { label: 'object', caption: 'a matte blue cube', bbox: [300, 620, 800, 960] },
];

const layoutText = buildLayoutJson(SUMMARY, ELEMENTS, WIDTH, HEIGHT);
console.log('=== 发给 CLIPTextEncode 的文本 ===');
console.log(JSON.stringify(JSON.parse(layoutText), null, 2));

const values = {
  UNET_NAME: arg('unet', 'moss_image_sft_bf16.safetensors'),
  CLIP_NAME: arg('clip', 'qwen3.5_9b_bf16.safetensors'),
  CLIP_TYPE: arg('clip-type', 'moss_image'),
  VAE_NAME: arg('vae', 'flux2-vae.safetensors'),
  PROMPT: layoutText,
  WIDTH,
  HEIGHT,
  SEED: Number(arg('seed', '20261030')),
  OUTPUT_PREFIX: 'astrmira/moss-layout-sample',
};

/** 与仓库 `renderWorkflow` 同规则：整值占位符做类型化替换，字符串内嵌只做文本替换 */
function render(node, table) {
  if (typeof node === 'string') {
    const only = /^\{\{([A-Z0-9_]+)\}\}$/.exec(node);
    if (only !== null) return table[only[1]];
    return node.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key) => String(table[key] ?? ''));
  }
  if (Array.isArray(node)) return node.map((item) => render(item, table));
  if (node !== null && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, render(value, table)]));
  }
  return node;
}

const started = Date.now();
const submit = await fetch(`${BASE}/prompt`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: render(template, values), client_id: 'astrmira-moss-layout' }),
});
const submitted = await submit.json();
if (!submit.ok) {
  console.error(`✗ 提交被拒：${JSON.stringify(submitted).slice(0, 1500)}`);
  process.exit(2);
}
console.log(`\n已提交 ${submitted.prompt_id}（${WIDTH}×${HEIGHT}，50 步），等 GPU…`);

let entry = null;
for (let index = 0; index < 1200; index += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const history = await (await fetch(`${BASE}/history/${submitted.prompt_id}`)).json();
  if (history[submitted.prompt_id] !== undefined) {
    entry = history[submitted.prompt_id];
    break;
  }
}
if (entry === null) {
  console.error('✗ 20 分钟没出结果');
  process.exit(1);
}
if (entry.status?.status_str === 'error') {
  console.error(`✗ 执行出错：${JSON.stringify(entry.status.messages ?? entry.status).slice(0, 1800)}`);
  process.exit(1);
}

const images = Object.values(entry.outputs ?? {}).flatMap((node) => node.images ?? []);
if (images.length === 0) {
  console.error('✗ 没有图片产物');
  process.exit(1);
}
mkdirSync(OUT_DIR, { recursive: true });
const file = path.join(OUT_DIR, 'moss-layout.png');
const viewUrl =
  `${BASE}/view?filename=${encodeURIComponent(images[0].filename)}` +
  `&subfolder=${encodeURIComponent(images[0].subfolder ?? '')}&type=${images[0].type ?? 'output'}`;
writeFileSync(file, Buffer.from(await (await fetch(viewUrl)).arrayBuffer()));
const elapsedSec = (Date.now() - started) / 1000;
console.log(`✓ 出图 ${elapsedSec.toFixed(1)}s → ${file}`);

const size = JSON.parse(
  execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', file],
    { encoding: 'utf8' }),
).streams[0];

/** 区域均值 RGB：裁框 → 压成 1×1 → 读 3 字节 */
function meanRgb(target, box) {
  const [x, y, w, h] = box;
  const buffer = execFileSync('ffmpeg', ['-v', 'error', '-i', target, '-vf',
    `crop=${w}:${h}:${x}:${y},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { encoding: 'buffer' });
  return [buffer[0], buffer[1], buffer[2]];
}

const toPixels = ([y0, x0, y1, x1]) => [
  Math.round((x0 / 1000) * size.width),
  Math.round((y0 / 1000) * size.height),
  Math.round(((x1 - x0) / 1000) * size.width),
  Math.round(((y1 - y0) / 1000) * size.height),
];

const leftBox = toPixels(ELEMENTS[0].bbox);
const rightBox = toPixels(ELEMENTS[1].bbox);
const left = meanRgb(file, leftBox);
const right = meanRgb(file, rightBox);
const global = meanRgb(file, [0, 0, size.width, size.height]);

console.log(`分辨率 ${size.width}×${size.height}`);
console.log(`左框 ${leftBox.join(',')} 均值 rgb(${left.join(',')})`);
console.log(`右框 ${rightBox.join(',')} 均值 rgb(${right.join(',')})`);
console.log(`全图均值 rgb(${global.join(',')})`);

const margin = 15; // 与"肉眼能看出偏色"的量级相当：R-B 差 15/255 以上才算"偏"
const leftOk = left[0] > left[2] + margin;
const rightOk = right[2] > right[0] + margin;
console.log(`${leftOk ? '✓' : '✗'} 左框偏红（R=${left[0]} vs B=${left[2]}）`);
console.log(`${rightOk ? '✓' : '✗'} 右框偏蓝（B=${right[2]} vs R=${right[0]}）`);

writeFileSync(
  path.join(OUT_DIR, 'moss-layout.json'),
  `${JSON.stringify({
    at: new Date().toISOString(),
    base: BASE,
    elapsedSec: Number(elapsedSec.toFixed(1)),
    layoutText: JSON.parse(layoutText),
    size,
    regions: { left: { box: leftBox, rgb: left }, right: { box: rightBox, rgb: right }, global },
    verdict: leftOk && rightOk ? 'boxes-honored' : 'boxes-not-honored',
  }, null, 2)}\n`,
);
console.log(`\n证据：${path.join(OUT_DIR, 'moss-layout.json')}`);
process.exit(leftOk && rightOk ? 0 : 1);
