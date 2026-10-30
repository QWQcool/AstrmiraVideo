#!/usr/bin/env node
/**
 * 上机第一天：**一条命令问清这台机器能不能开始干活**（2026-10-29）。
 *
 * 为什么要它：租来的机器上现场最耗时的不是装东西，而是**判断**——显存到底多少（商品页经常写错）、
 * ComfyUI 版本带不带 H3 节点、权重下齐没有、模板该放哪。这些信息分散在 nvidia-smi、
 * `/object_info` 和目录里，靠记忆逐条查容易漏，而且漏了的代价是"跑起来才发现模型少一个"。
 *
 * 它**只读**：不下载、不改配置、不建目录。判据全部来自现场事实（命令输出 / 接口返回），
 * 任何一条查不到就报"查不到"，不拿默认值假装。
 *
 * 用法：
 *   node scripts/gpu-day-one.mjs [--base http://127.0.0.1:8188] [--dir D:\] [--json out.json]
 *
 * 退出码：
 *   0 = 关键项齐（能开始跑 H3 的 t2v / i2v）
 *   1 = 有缺口（下面会逐条列出缺什么、放到哪）
 *   2 = 连现场都探不到（没有 nvidia-smi / ComfyUI 没起来）—— 这不等于失败，是"还没到那一步"
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statfsSync, writeFileSync } from 'node:fs';
import { totalmem } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};

const BASE = (flag('base', process.env.COMFYUI_BASE_URL ?? 'http://127.0.0.1:8188')).replace(/\/$/, '');
const DISK_DIR = flag('dir', process.cwd());
const JSON_OUT = flag('json', '');

const gaps = [];
const notes = [];
const report = { gpu: null, system: null, comfyui: null, models: null, templates: null, verdict: null };

function say(line) {
  console.log(line);
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function fail(what, how) {
  gaps.push({ what, how });
  say(`✗ ${what}`);
  if (how) say(`   → ${how}`);
}

function ok(what) {
  say(`✓ ${what}`);
}

// ── ① GPU ────────────────────────────────────────────────────────────────
section('[1] 显卡（只信 nvidia-smi，不信商品页）');
let smiText = '';
try {
  smiText = execFileSync(
    'nvidia-smi',
    ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'],
    { encoding: 'utf8', timeout: 10_000 },
  ).trim();
} catch (error) {
  console.error(`✗ 读不到 nvidia-smi：${error.message}`);
  console.error('  到机器上先确认驱动装好；这一步过不去，后面都不用看。');
  process.exit(2);
}

const firstGpu = smiText.split('\n')[0] ?? '';
const [gpuName, vramText, driverVersion] = firstGpu.split(',').map((part) => part.trim());
const vramGb = Number((vramText ?? '').replace(/[^\d.]/g, '')) / 1024;
report.gpu = { gpuName, vramGb: Number(vramGb.toFixed(1)), driverVersion, gpuCount: smiText.split('\n').length };

say(`型号：${gpuName} ｜ 显存：${report.gpu.vramGb} GB ｜ 驱动：${driverVersion} ｜ 卡数：${report.gpu.gpuCount}`);
if (smiText.split('\n').length > 1) say('（多卡：本仓调度按"本地互斥 1"，多卡只提升吞吐，不会让单条更好）');

/**
 * H3 的显存档位是**社区实测口径**，官方没给表（docs/LOCAL-GPU-DEPLOY.md §2.3）。
 * 这里只做"该下哪个量化档"的建议，不用它做任何自动禁用 —— 与 D22（不替用户假定硬件）一致。
 */
if (vramGb >= 40) {
  ok('显存 ≥40GB：可以上 bf16 全量（画质上限最高，权重约 124GB）');
} else if (vramGb >= 24) {
  ok('显存 24–39GB：H3 的现实基线档（剪枝 INT8 + NVFP4 编码器，权重约 42.5GB）');
} else if (vramGb >= 12) {
  notes.push('显存 12–23GB：只能剪枝 INT8 + 分层 offload，慢且吃内存（建议 64GB+ 内存）');
  say(`⚠ ${notes.at(-1)}`);
} else {
  fail(
    `显存 ${report.gpu.vramGb}GB 低于 H3 的 12GB 下限`,
    '这台机器适合跑图/音频与管线验证；H3 请换卡或走云端 API',
  );
}

// ── ② 系统 ───────────────────────────────────────────────────────────────
section('[2] 系统内存与磁盘');
const ramGb = Number((totalmem() / 1024 ** 3).toFixed(1));
report.system = { ramGb };
if (ramGb >= 60) ok(`内存 ${ramGb}GB（分层 offload 建议 64GB+；本条按物理 64GB 档算）`);
else if (ramGb >= 32) say(`⚠ 内存 ${ramGb}GB：能跑但 offload 会紧（建议 64GB+）`);
else fail(`内存 ${ramGb}GB 偏小`, 'H3 分层 offload 吃系统内存，32GB 以下会频繁换页');

let freeGb = null;
try {
  const stat = statfsSync(DISK_DIR);
  freeGb = Number(((stat.bavail * stat.bsize) / 1024 ** 3).toFixed(1));
  report.system.diskDir = DISK_DIR;
  report.system.freeGb = freeGb;
  if (freeGb >= 120) ok(`磁盘 ${DISK_DIR} 可用 ${freeGb}GB（H3 42.5GB + MOSS 16GB + 素材，宽裕）`);
  else if (freeGb >= 60) say(`⚠ 磁盘 ${DISK_DIR} 可用 ${freeGb}GB：够 H3 量化版，但素材与输出会很快见底`);
  else fail(`磁盘 ${DISK_DIR} 可用 ${freeGb}GB 不够`, 'H3 量化权重 42.5GB 起，建议 ≥120GB 空余');
} catch (error) {
  say(`⚠ 读不出 ${DISK_DIR} 的可用空间：${error.message}`);
}

// ── ③ ComfyUI 节点 ───────────────────────────────────────────────────────
section(`[3] ComfyUI（${BASE}）`);
let objectInfo = null;
try {
  const response = await fetch(`${BASE}/object_info`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  objectInfo = await response.json();
} catch (error) {
  console.error(`✗ 连不上 ComfyUI：${error.message}`);
  console.error('  先把 ComfyUI 起来（端口默认 8188），或传 --base 指到实际地址。');
  process.exit(2);
}

const nodeNames = Object.keys(objectInfo);
const has = (name) => nodeNames.includes(name);
/** 某个枚举型输入的候选值（`/object_info` 里是 `[ [...], {...} ]` 的形状） */
const enumOf = (node, field) => {
  const required = objectInfo[node]?.input?.required?.[field];
  return Array.isArray(required?.[0]) ? required[0] : [];
};
say(`节点总数：${nodeNames.length}`);

const REQUIRED_CORE = ['UNETLoader', 'CLIPLoader', 'VAELoader', 'KSampler', 'VAEDecodeTiled'];
const missingCore = REQUIRED_CORE.filter((name) => !has(name));
if (missingCore.length === 0) ok(`视频轨必需节点齐（${REQUIRED_CORE.join(' / ')}）`);
else fail(`缺节点：${missingCore.join('、')}`, 'VAEDecodeTiled 缺失会让 10GB 卡整段解码退化成 CPU，不要回退到 VAEDecode');

/**
 * 按**节点家族**判，不按精确名 —— 2026-10-30 的教训：本机 0.36.0 与云机 0.43.0 的节点集合
 * 都不止"模板里出现的那些"，写死名单会把"有但改名"误报成"缺"。
 * 判据是"这套工作流至少需要哪一个"，而不是"必须一个不多一个不少"。
 */
const H3_REQUIRED = ['MiniMaxH3ImageToVideo', 'EmptyMiniMaxH3LatentAV'];
const h3Family = nodeNames.filter((name) => /^MiniMaxH3/.test(name) && !/^ComfyCloud/.test(name));
const missingH3 = H3_REQUIRED.filter((name) => !has(name));
if (missingH3.length === 0) {
  ok(`H3 本地节点齐（家族 ${h3Family.length} 个：${h3Family.slice(0, 6).join(' / ')}${h3Family.length > 6 ? ' …' : ''}）`);
} else {
  fail(
    `ComfyUI 缺 H3 关键节点：${missingH3.join('、')}（现有 MiniMaxH3 家族：${h3Family.join(' / ') || '无'}）`,
    '把 ComfyUI 更新到带 H3 支持的版本（0.36 起已有；云端节点 ComfyCloud* 不算）',
  );
}

const mossFamily = nodeNames.filter((name) => /^MOSSImage|^TextEncodeMOSSImage|^ModelMergeMOSSImage/.test(name));
const clipTypes = enumOf('CLIPLoader', 'type');
const mossClipType = clipTypes.includes('moss_image');
if (mossFamily.length > 0 || mossClipType) {
  ok(
    `MOSS-Image 可用（专用节点 ${mossFamily.length} 个${mossFamily.length > 0 ? `：${mossFamily.slice(0, 4).join(' / ')}` : ''}` +
      `${mossClipType ? '；CLIPLoader 支持 type=moss_image' : ''}）—— 实际出图走 UNETLoader + CLIPLoader + EmptyFlux2LatentImage，不需要专用节点`,
  );
} else {
  say('· 没有 MOSS-Image 支持：把 ComfyUI 更新到含该支持的构建（该支持晚于 0.36 的 release tag 合并）');
}

// ── ④ 模型清单 ───────────────────────────────────────────────────────────
section('[4] 模型文件（按文件名匹配，缺哪个就说哪个）');
const unets = enumOf('UNETLoader', 'unet_name');
const clips = enumOf('CLIPLoader', 'clip_name');
const vaes = enumOf('VAELoader', 'vae_name');
const ckpts = enumOf('CheckpointLoaderSimple', 'ckpt_name');
report.models = { unets, clips, vaes, ckpts };
say(`可见模型：diffusion_models ${unets.length} 个 / text_encoders ${clips.length} 个 / vae ${vaes.length} 个 / checkpoints ${ckpts.length} 个`);

const pick = (list, patterns) => list.find((name) => patterns.some((pattern) => pattern.test(name)));

/** H3 最小组合（docs/LOCAL-GPU-DEPLOY.md §2.2）：三个文件缺一不可，音频 VAE 单独一项 */
const H3_NEEDS = [
  { label: 'H3 扩散模型（fl2va 或 ref2va，剪枝 INT8）', list: unets, patterns: [/minimax_h3/i], where: 'models/diffusion_models/' },
  { label: 'H3 文本编码器（qwen3vl_32b_minimax_h3）', list: clips, patterns: [/qwen3vl_32b_minimax_h3/i], where: 'models/text_encoders/' },
  { label: 'H3 视频 VAE', list: vaes, patterns: [/minimax_h3_video_vae/i], where: 'models/vae/' },
  { label: 'H3 音频 VAE（立体声）', list: vaes, patterns: [/minimax_h3_audio_vae/i], where: 'models/vae/' },
];
for (const need of H3_NEEDS) {
  const found = pick(need.list, need.patterns);
  if (found) ok(`${need.label}：${found}`);
  else fail(`缺 ${need.label}`, `放到 ${need.where}（Comfy-Org/MiniMax-H3 或 hf-mirror）`);
}

const MOSS_NEEDS = [
  { label: 'MOSS-Image 扩散模型', list: [...ckpts, ...unets], patterns: [/moss_image/i], where: 'models/checkpoints/' },
  { label: 'MOSS 文本编码器（qwen3.5-9b）', list: clips, patterns: [/qwen3\.5_9b/i], where: 'models/text_encoders/' },
  { label: 'MOSS VAE（flux2-vae，和 FLUX.2 共用）', list: vaes, patterns: [/flux2.?vae/i], where: 'models/vae/' },
];
say('');
const mossMissing = [];
for (const need of MOSS_NEEDS) {
  const found = pick(need.list, need.patterns);
  if (found) ok(`（MOSS）${need.label}：${found}`);
  else {
    mossMissing.push(need.label);
    say(`· （MOSS）缺 ${need.label} → ${need.where}`);
  }
}
if (mossMissing.length === 0) ok('MOSS-Image 三件套齐（整图生成可跑）');
else notes.push(`MOSS-Image 还缺 ${mossMissing.length} 项（不影响 H3）`);

// ── ⑤ 模板与 sidecar ─────────────────────────────────────────────────────
section('[5] 模板与 sidecar（本仓约定）');
const sample = path.resolve(import.meta.dirname, '..', 'docs', 'templates', 'minimax-h3-t2v.meta.json');
let sampleOk = false;
try {
  const declaration = JSON.parse(readFileSync(sample, 'utf8'));
  const modes = Array.isArray(declaration.modes) ? declaration.modes : [];
  const WIRED = ['t2v', 'i2v', 't2i', 'upscale', 'inpaint', 'outpaint'];
  const invalid = modes.filter((mode) => !WIRED.includes(mode));
  if (modes.length === 0) throw new Error('modes 为空');
  if (invalid.length > 0) throw new Error(`声明了本仓没接线的模式：${invalid.join(' / ')}`);
  sampleOk = true;
  ok(`sidecar 样例可解析：${path.basename(sample)}（modes=${modes.join('/')}）`);
} catch (error) {
  fail(`sidecar 样例不可用：${error.message}`, '检查 docs/templates/minimax-h3-t2v.meta.json');
}
report.templates = { sample, sampleOk };

say('  现场要做的事：');
say('   1) 模板目录放两个同名文件：<name>.api.json（ComfyUI 里"导出（API）"得到）+ <name>.meta.json（拷样例改 label）');
say('   2) 服务端 env 指过去：COMFYUI_TEMPLATE_DIR=<目录> COMFYUI_TEMPLATE=<name>');
say('   3) ⚠️ 模板包自带的 api_minimax_h3_*.json 是**前端图格式**，不能直接用');

// ── ⑥ 结论 ───────────────────────────────────────────────────────────────
section('[6] 结论');
if (gaps.length === 0) {
  ok('关键项齐：可以开始跑 H3 的 t2v / i2v');
  say('   下一步：起服务 → 画布提交一条 5s 片 → 记下耗时（真实数字回填 docs/LOCAL-GPU-DEPLOY.md）');
} else {
  say(`还差 ${gaps.length} 项：`);
  for (const gap of gaps) say(`  · ${gap.what}${gap.how ? ` —— ${gap.how}` : ''}`);
}
if (notes.length > 0) {
  say('提醒（不算失败）：');
  for (const note of notes) say(`  · ${note}`);
}
say('   注意：H3 的首尾帧(fl2v)/多参考(v2v)本仓未接线，声明了也会被如实剔除 —— 只出 t2v/i2v 是正确行为');

report.verdict = { gaps, notes, ready: gaps.length === 0 };
if (JSON_OUT !== '') {
  writeFileSync(JSON_OUT, `${JSON.stringify(report, null, 2)}\n`);
  say(`\n已写 ${JSON_OUT}`);
}

process.exit(gaps.length === 0 ? 0 : 1);
