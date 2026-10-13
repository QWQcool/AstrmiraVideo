#!/usr/bin/env node
/**
 * 本地 ComfyUI 验收脚本（台账 A1 片 B；形态见 PLAN §6-**D53**）。
 *
 * ## 它是干什么的（以及不是什么）
 * 这是**验收工具**，不是产品代码：产品那条路是 `ComfyUiProvider`（还没写，与契约 §19 一起）。
 * 这里的作用是让"这台机器到底行不行、跑一条要多久"变成**可复跑的数字** ——
 * 每次改参数（精度 / 分辨率 / 帧数）都能重新量一遍，而不是凭印象说"好像快了点"。
 *
 * ## 三条设计纪律
 * 1. **模型名不硬编码**：从 `/object_info` 的枚举里挑（`diffusion_models` / `text_encoders` / `vae`），
 *    并在有多个候选项时给出一条**说明我选了哪个、为什么**的日志 —— D53 定的是"模型由用户决定"，
 *    脚本硬编码模型名就等于替用户做了选择。
 * 2. **只用真机有的节点**：`VAEDecodeTiled` 是硬要求（2026-10-13 实测：10GB 卡上整段 `VAEDecode`
 *    会在 CPU 上退化到 14 分钟以上）；缺节点时**直接失败并说明**，不悄悄换回 `VAEDecode`。
 * 3. **耗时如实报**：总耗时 + ComfyUI 侧的 `Prompt executed in`（能从 `/history` 的 messages 里算），
 *    **不四舍五入成"很快"**。
 *
 * ## 用法
 * ```
 * node scripts/comfyui-acceptance.mjs probe
 * node scripts/comfyui-acceptance.mjs t2v  [--dtype fp8_e4m3fn] [--width 480] [--height 272] [--frames 33] [--steps 20]
 * node scripts/comfyui-acceptance.mjs i2v  --image <图片路径>  [同样的参数]
 * ```
 * 环境变量：`COMFYUI_BASE_URL`（默认 `http://127.0.0.1:8188`）。
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const BASE = (process.env.COMFYUI_BASE_URL ?? 'http://127.0.0.1:8188').replace(/\/$/, '');
/** 产物落本地（**不写进 ComfyUI 的 output 目录**：那里与别的项目共用，见 PLAN V8.34） */
const ARTIFACT_DIR = resolve('.tmp/comfyui-acceptance');

const NEGATIVE = 'blurry, low quality, watermark, text, subtitles, static, jitter';
const DEFAULT_PROMPT =
  'A neon-lit rainy street at night, reflections on wet asphalt, slow camera push-in, cinematic';

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item.startsWith('--')) {
      const key = item.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = 'true';
      }
    } else {
      positional.push(item);
    }
  }
  return { flags, positional };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jsonOrThrow(path, init) {
  const response = await fetch(`${BASE}${path}`, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${path} → HTTP ${response.status} ${text.slice(0, 300)}`);
  }
  return response.json();
}

/** 连不上时给中文指引（本仓纪律：缺依赖要讲清怎么补，而不是抛一段英文栈） */
async function ensureReachable() {
  try {
    return await jsonOrThrow('/system_stats');
  } catch (error) {
    console.error(
      `\n✗ 连不上 ComfyUI（${BASE}）：${error instanceof Error ? error.message : String(error)}\n` +
        '  先启动它（本机便携版路径与启动方式见 docs/PLAN.md 的 V8.34 段）：\n' +
        '    D:\\ComfyUI\\ComfyUI_windows_portable\\run_nvidia_gpu.bat\n' +
        '  或设 COMFYUI_BASE_URL 指向别处的实例。\n',
    );
    process.exit(1);
  }
}

/** 从枚举里挑模型：**优先含关键词**，挑不到就用第一个（并说清挑了哪个） */
function pickModel(candidates, keyword) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const hit = candidates.find((name) => name.includes(keyword));
  return hit ?? candidates[0];
}

async function readInventory() {
  const all = await jsonOrThrow('/object_info');
  const unetNames = all.UNETLoader?.input?.required?.unet_name?.[0] ?? [];
  const clipNames = all.CLIPLoader?.input?.required?.clip_name?.[0] ?? [];
  const vaeNames = all.VAELoader?.input?.required?.vae_name?.[0] ?? [];
  const clipTypes = all.CLIPLoader?.input?.required?.type?.[0] ?? [];
  // 枚举就写在 spec[0]（spec[1] 是 {advanced:true} 这类元信息）—— 第一版读成 spec[1].options，
  // 结果只报出一个 `default`，差点让我以为这台机器没有 fp8 档
  const dtypes = all.UNETLoader?.input?.required?.weight_dtype?.[0] ?? ['default'];

  return {
    nodeCount: Object.keys(all).length,
    unet: pickModel(unetNames, 'ti2v') ?? pickModel(unetNames, 'wan'),
    clip: pickModel(clipNames, 'umt5') ?? clipNames[0],
    vae: pickModel(vaeNames, 'wan'),
    clipType: clipTypes.includes('wan') ? 'wan' : clipTypes[0],
    dtypes,
    hasTiledDecode: all.VAEDecodeTiled !== undefined,
    hasLatentNode: all.Wan22ImageToVideoLatent !== undefined,
  };
}

function buildWorkflow({
  inventory,
  width,
  height,
  frames,
  steps,
  cfg,
  shift,
  fps,
  seed,
  dtype,
  prompt,
  prefix,
  startImage,
}) {
  const workflow = {
    37: {
      class_type: 'UNETLoader',
      inputs: { unet_name: inventory.unet, weight_dtype: dtype },
    },
    38: { class_type: 'CLIPLoader', inputs: { clip_name: inventory.clip, type: inventory.clipType } },
    39: { class_type: 'VAELoader', inputs: { vae_name: inventory.vae } },
    48: { class_type: 'ModelSamplingSD3', inputs: { model: ['37', 0], shift } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['38', 0] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: NEGATIVE, clip: ['38', 0] } },
    55: {
      class_type: 'Wan22ImageToVideoLatent',
      inputs: {
        vae: ['39', 0],
        width,
        height,
        length: frames,
        batch_size: 1,
        // 首帧：**只有 i2v 才接**（t2v 留空 = 纯文生视频，这就是 TI2V 的同一个模型两种用法）
        ...(startImage === undefined ? {} : { start_image: ['56', 0] }),
      },
    },
    3: {
      class_type: 'KSampler',
      inputs: {
        model: ['48', 0],
        seed,
        steps,
        cfg,
        sampler_name: 'uni_pc',
        scheduler: 'simple',
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['55', 0],
        denoise: 1,
      },
    },
    8: {
      class_type: 'VAEDecodeTiled',
      inputs: {
        samples: ['3', 0],
        vae: ['39', 0],
        tile_size: 256,
        overlap: 32,
        temporal_size: 32,
        temporal_overlap: 8,
      },
    },
    57: { class_type: 'CreateVideo', inputs: { images: ['8', 0], fps } },
    58: {
      class_type: 'SaveVideo',
      inputs: { video: ['57', 0], filename_prefix: prefix, format: 'auto', codec: 'auto' },
    },
  };
  if (startImage !== undefined) {
    workflow[56] = { class_type: 'LoadImage', inputs: { image: startImage } };
  }
  return workflow;
}

/** 上传首帧（`POST /upload/image`）—— provider 的 i2v 路径必须走这一步 */
async function uploadImage(filePath) {
  const buffer = readFileSync(filePath);
  const form = new FormData();
  form.append('image', new Blob([buffer], { type: 'image/png' }), basename(filePath));
  form.append('subfolder', 'astrmira');
  form.append('overwrite', 'true');
  const response = await fetch(`${BASE}/upload/image`, { method: 'POST', body: form });
  if (!response.ok) throw new Error(`上传失败：HTTP ${response.status}`);
  const uploaded = await response.json();
  return uploaded.subfolder === undefined || uploaded.subfolder === ''
    ? uploaded.name
    : `${uploaded.subfolder}/${uploaded.name}`;
}

async function runOne({ label, workflow, timeoutMs }) {
  const t0 = Date.now();
  const submitted = await fetch(`${BASE}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: 'astrmira-acceptance' }),
  });
  const body = await submitted.json();
  if (!submitted.ok) {
    // 提交被拒时 ComfyUI 会把**每个节点的错**列在 node_errors 里 —— 原样打出来，别吞
    console.error(`${label}：提交被拒 HTTP ${submitted.status}`);
    console.error(JSON.stringify(body.node_errors ?? body.error ?? body).slice(0, 2500));
    return null;
  }
  const promptId = body.prompt_id;
  console.log(`${label}：已受理 prompt_id=${promptId}`);

  for (;;) {
    await sleep(5000);
    const elapsed = (Date.now() - t0) / 1000;
    if (Date.now() - t0 > timeoutMs) {
      console.error(`${label}：超时（${Math.round(elapsed)}s）`);
      return null;
    }
    const history = await jsonOrThrow(`/history/${promptId}`);
    const entry = history[promptId];
    if (entry === undefined) {
      console.log(`${label}：运行中… ${Math.round(elapsed)}s`);
      continue;
    }
    const seconds = (Date.now() - t0) / 1000;
    const outputs = entry.outputs ?? {};
    const produced = [];
    for (const node of Object.values(outputs)) {
      for (const item of node.images ?? []) {
        produced.push(item);
      }
    }
    if (produced.length === 0) {
      console.error(`${label}：结束了但没有产物：${JSON.stringify(entry.status ?? {})}`);
      return null;
    }
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    const saved = [];
    for (const item of produced) {
      const query = new URLSearchParams({
        filename: item.filename,
        subfolder: item.subfolder ?? '',
        type: item.type ?? 'output',
      });
      const media = await fetch(`${BASE}/view?${query}`);
      const target = join(ARTIFACT_DIR, `${label.replace(/[\s]+/g, '-')}-${item.filename}`);
      writeFileSync(target, Buffer.from(await media.arrayBuffer()));
      saved.push({ target, bytes: statSync(target).size });
    }
    // ComfyUI 自己也有耗时（execution_start → execution_success）—— 两者之差就是**排队**时间，
    // 报出来才能分清"模型慢"与"队列里有别的任务"（该 ComfyUI 与别的项目共用，这条很实际）。
    const messages = entry.status?.messages ?? [];
    const started = messages.find((item) => item[0] === 'execution_start')?.[1]?.timestamp;
    const finished = messages.find((item) => item[0] === 'execution_success')?.[1]?.timestamp;
    const comfySeconds =
      typeof started === 'number' && typeof finished === 'number'
        ? ((finished - started) / 1000).toFixed(1)
        : '未知';
    console.log(
      `${label}：完成，**总耗时 ${seconds.toFixed(1)}s**（ComfyUI 侧执行 ${comfySeconds}s）`,
    );
    for (const file of saved) {
      console.log(`  → ${file.target}（${(file.bytes / 1024).toFixed(1)} KB）`);
    }
    return { seconds, saved };
  }
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const mode = positional[0] ?? 'probe';
  const stats = await ensureReachable();
  const device = stats.devices?.[0] ?? {};
  console.log(
    `ComfyUI ${stats.system?.comfyui_version} @ ${BASE} · ${device.name ?? '未知设备'} · ` +
      `显存 ${(device.vram_free / 1024 ** 3).toFixed(2)} / ${(device.vram_total / 1024 ** 3).toFixed(2)} GB 空闲`,
  );

  const inventory = await readInventory();
  console.log(
    `节点 ${inventory.nodeCount} 个 · 选定模型：UNET=${inventory.unet} / CLIP=${inventory.clip}(${inventory.clipType}) / VAE=${inventory.vae}`,
  );
  console.log(`可用精度：${inventory.dtypes.join(' / ')}`);
  if (!inventory.hasTiledDecode || !inventory.hasLatentNode) {
    console.error(
      `✗ 缺关键节点：VAEDecodeTiled=${inventory.hasTiledDecode} / Wan22ImageToVideoLatent=${inventory.hasLatentNode}\n` +
        '  10GB 显存上整段 VAEDecode 会退化成 CPU 解码（实测 14 分钟以上），所以这里**直接失败**，不悄悄换节点。',
    );
    process.exit(1);
  }
  if (mode === 'probe') {
    console.log('\n✓ 探测完成（未提交任务）。跑一条用：t2v / i2v --image <路径>');
    return;
  }

  const width = Number(flags.width ?? 480);
  const height = Number(flags.height ?? 272);
  const frames = Number(flags.frames ?? 33);
  const steps = Number(flags.steps ?? 20);
  const dtype = String(flags.dtype ?? 'default');
  if (!inventory.dtypes.includes(dtype)) {
    console.error(`✗ 精度 ${dtype} 不在可用列表里：${inventory.dtypes.join(' / ')}`);
    process.exit(1);
  }

  let startImage;
  if (mode === 'i2v') {
    const image = flags.image;
    if (typeof image !== 'string' || image === '') {
      console.error('✗ i2v 需要 --image <图片路径>');
      process.exit(1);
    }
    startImage = await uploadImage(resolve(image));
    console.log(`首帧已上传：${startImage}`);
  } else if (mode !== 't2v') {
    console.error(`✗ 不认识的模式：${mode}（可选 probe / t2v / i2v）`);
    process.exit(1);
  }

  const label = `${mode}-${dtype}-${width}x${height}-${frames}f`;
  const workflow = buildWorkflow({
    inventory,
    width,
    height,
    frames,
    steps,
    cfg: Number(flags.cfg ?? 5),
    shift: Number(flags.shift ?? 8),
    fps: Number(flags.fps ?? 24),
    seed: Number(flags.seed ?? 42),
    dtype,
    prompt: typeof flags.prompt === 'string' ? flags.prompt : DEFAULT_PROMPT,
    prefix: `astrmira/${label}`,
    startImage,
  });
  console.log(`\n提交 ${label}（${steps} 步 / cfg ${flags.cfg ?? 5} / shift ${flags.shift ?? 8}）`);
  const result = await runOne({ label, workflow, timeoutMs: Number(flags.timeout ?? 40 * 60) * 1000 });
  if (result === null) process.exit(1);
  console.log(`\n✓ ${label} 出片，总耗时 ${result.seconds.toFixed(1)}s`);
}

await main();
