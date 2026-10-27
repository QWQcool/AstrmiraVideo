#!/usr/bin/env node
/**
 * P1-1 / B111 前置实验：**两张参考图到底有没有同时生效**。
 *
 * 为什么单独一个脚本、而不是走 `/api/generate`：
 * provider 目前只上传**一张**参考图（`{{START_IMAGE_NAME}}`），双图通道属于 P1-2 的改动。
 * 本脚本直接对 ComfyUI 的 `/prompt` 发请求，用同一份模板跑三组对照，
 * 目的是先回答"模型吃不吃第二张、吃了有什么用"，而不是先做产品接线。
 *
 * 做法（固定 seed / 固定提示词 / 固定尺寸，只改参考图）：
 *   run1  A            —— 单参考基线
 *   run2  A + B        —— 两张参考
 *   run3  A + B2       —— 把第二张换成另一张（若背景跟着换，说明第二张真被消费）
 *
 * 用法：
 *   node scripts/multiref-experiment.mjs \
 *     --base http://127.0.0.1:8190 \
 *     --ref-a <人物图> --ref-b <场景图> --ref-b2 <另一场景图> \
 *     --prompt "电影感剧照，人物站在画面中央…" --seed 12345 --out .tmp/multiref
 *
 * 边界：
 * - 只调本机 /prompt 与 /view，不碰云端、不花钱；
 * - 不做"两张图 = 支持多参考"的结论：本脚本只产出可人工比对的证据；
 * - 输出目录里保留每组的 workflow JSON 与耗时，便于复跑。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = path.join(
  ROOT,
  'deploy',
  'comfyui-templates',
  'experiments',
  'flux2-klein-t2i-ref2.api.json',
);

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
};

const base = flag('base', 'http://127.0.0.1:8190').replace(/\/$/, '');
const refA = flag('ref-a');
const refB = flag('ref-b');
const refB2 = flag('ref-b2');
const prompt = flag(
  'prompt',
  '电影感剧照，人物站在画面中央，全身入画，实拍质感，自然光，浅景深',
);
const seed = Number(flag('seed', '12345'));
const width = Number(flag('width', '1024'));
const height = Number(flag('height', '576'));
const outDir = path.resolve(ROOT, flag('out', '.tmp/multiref'));

if (args.includes('--stress')) {
  if (flag('refs', '') === '') {
    console.error('压测模式需要 --refs a,b,c,…（逗号分隔的本地图片路径）');
    process.exit(2);
  }
} else if (!refA || !refB || !refB2) {
  console.error('需要 --ref-a / --ref-b / --ref-b2（或用 --stress --refs 做张数压测）');
  process.exit(2);
}

const MODELS = {
  UNET_NAME: flag('unet', 'flux-2-klein-4b.safetensors'),
  CLIP_NAME: flag('clip', 'qwen_3_4b.safetensors'),
  CLIP_TYPE: flag('clip-type', 'flux2'),
  VAE_NAME: flag('vae', 'flux2-vae.safetensors'),
  WEIGHT_DTYPE: flag('weight-dtype', 'default'),
};

const PLACEHOLDER = /^\{\{([A-Z0-9_]+)\}\}$/;

/** 整值占位符替换：`"{{KEY}}"` 换成任意 JSON 值（沿用 provider 的口径） */
function fill(template, values) {
  const walk = (value) => {
    if (typeof value === 'string') {
      const match = PLACEHOLDER.exec(value);
      if (match === null) return value;
      const key = match[1];
      if (!(key in values)) throw new Error(`模板占位符 ${key} 没有取值`);
      return values[key];
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === 'object') {
      const out = {};
      for (const [key, inner] of Object.entries(value)) out[key] = walk(inner);
      return out;
    }
    return value;
  };
  return walk(template);
}

/** 单参考变体：去掉第二张的 57/79/80，guider 直接吃第一条 ReferenceLatent */
function singleRefVariant(workflow) {
  const copy = JSON.parse(JSON.stringify(workflow));
  delete copy['57'];
  delete copy['79'];
  delete copy['80'];
  copy['63'].inputs.positive = ['78', 0];
  return copy;
}

/**
 * 按 N 张图拼 `ReferenceLatent` 链（模板只自带 2 条，第 3 张起动态追加）。
 *
 * 这条链的形状就是 P1-2b 里 provider 要生成的东西：cond → ref1 → ref2 → … → refN。
 * 先在这里验证，再接进后端，避免"先写产品代码再发现跑不动"。
 */
function buildChain(workflow, names) {
  const wf = JSON.parse(JSON.stringify(workflow));
  wf['56'].inputs.image = names[0];
  let tail = ['78', 0];
  if (names.length < 2) {
    return singleRefVariant(wf);
  }
  wf['57'].inputs.image = names[1];
  tail = ['80', 0];
  for (let index = 2; index < names.length; index += 1) {
    const img = `r${index}img`;
    const enc = `r${index}enc`;
    const ref = `r${index}ref`;
    wf[img] = { class_type: 'LoadImage', inputs: { image: names[index] } };
    wf[enc] = { class_type: 'VAEEncode', inputs: { pixels: [img, 0], vae: ['72', 0] } };
    wf[ref] = { class_type: 'ReferenceLatent', inputs: { conditioning: [tail[0], 0], latent: [enc, 0] } };
    tail = [ref, 0];
  }
  wf['63'].inputs.positive = tail;
  return wf;
}

async function uploadImage(filePath) {
  const buffer = readFileSync(filePath);
  const form = new FormData();
  form.append('image', new Blob([buffer]), path.basename(filePath));
  form.append('overwrite', 'true');
  const res = await fetch(`${base}/upload/image`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`上传失败 ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const name = json.subfolder ? `${json.subfolder}/${json.name}` : json.name;
  console.log(`  上传 ${path.basename(filePath)} -> ${name}`);
  return name;
}

async function submit(workflow, clientId) {
  const res = await fetch(`${base}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`/prompt 失败 ${res.status}: ${JSON.stringify(json).slice(0, 600)}`);
  }
  return json.prompt_id;
}

async function waitFor(promptId, timeoutMs = 900_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const history = await fetch(`${base}/history/${promptId}`).then((r) => r.json());
    const entry = history[promptId];
    if (entry !== undefined && entry.status?.completed === true) return entry;
    if (entry !== undefined && entry.status?.status_str === 'error') {
      throw new Error(`任务失败: ${JSON.stringify(entry.status).slice(0, 400)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error('等待超时');
}

async function download(image) {
  // Windows 版 ComfyUI 返回的 subfolder 是反斜杠，/view 只认正斜杠
  const subfolder = (image.subfolder ?? '').replace(/\\/g, '/');
  const url = `${base}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(
    subfolder,
  )}&type=${image.type ?? 'output'}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`取图失败 ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const main = async () => {
  mkdirSync(outDir, { recursive: true });
  const template = JSON.parse(readFileSync(TEMPLATE, 'utf8'));
  const clientId = `multiref-${Date.now()}`;

  console.log(`ComfyUI: ${base}\n模板: ${path.relative(ROOT, TEMPLATE)}\n`);

  // 两种用途：三组对照（默认）或 N 张压测（--stress + --refs）
  const stressRefs = (flag('refs', '') ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const stress = args.includes('--stress');

  const imageNames = stress
    ? await Promise.all(stressRefs.map((file) => uploadImage(path.resolve(file))))
    : [];
  const uploaded = stress
    ? {}
    : {
        A: await uploadImage(refA),
        B: await uploadImage(refB),
        B2: await uploadImage(refB2),
      };

  const runs = stress
    ? [
        { id: 'stress-4refs', refs: imageNames.slice(0, 4), variant: 'chain' },
        { id: 'stress-9refs', refs: imageNames.slice(0, 9), variant: 'chain' },
        { id: 'stress-12refs', refs: imageNames.slice(0, 12), variant: 'chain' },
      ].filter((run) => run.refs.length > 0)
    : [
        { id: 'run1-A', refs: [uploaded.A], variant: 'single' },
        { id: 'run2-AB', refs: [uploaded.A, uploaded.B], variant: 'dual' },
        { id: 'run3-AB2', refs: [uploaded.A, uploaded.B2], variant: 'dual' },
      ];

  const records = [];
  for (const run of runs) {
    const started = Date.now();
    const values = {
      ...MODELS,
      PROMPT: prompt,
      WIDTH: width,
      HEIGHT: height,
      SEED: seed,
      OUTPUT_PREFIX: `astrmira/multiref/${run.id}`,
      START_IMAGE_NAME: run.refs[0] ?? '',
      REFERENCE_IMAGE_NAME: run.refs[1] ?? run.refs[0] ?? '',
    };
    const workflow = buildChain(fill(template, values), run.refs);

    writeFileSync(path.join(outDir, `${run.id}.workflow.json`), JSON.stringify(workflow, null, 2));
    console.log(`\n[${run.id}] 参考=${run.refs.length} 张 seed=${seed} ${width}x${height}`);
    const promptId = await submit(workflow, clientId);
    console.log(`  prompt_id=${promptId}`);
    const entry = await waitFor(promptId);
    const images = Object.values(entry.outputs ?? {}).flatMap((output) => output.images ?? []);
    if (images.length === 0) throw new Error(`${run.id} 没有产出图片`);
    const buffer = await download(images[0]);
    const file = path.join(outDir, `${run.id}.png`);
    writeFileSync(file, buffer);
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    console.log(`  完成 ${file} (${(buffer.length / 1024).toFixed(0)}KB, ${seconds}s)`);
    records.push({ ...run, promptId, file, bytes: buffer.length, seconds, seed, prompt });
  }

  writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ base, prompt, seed, width, height, records }, null, 2));
  console.log(`\n结果写入 ${path.join(outDir, 'results.json')}`);
};

await main();
