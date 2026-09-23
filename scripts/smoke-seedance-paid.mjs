#!/usr/bin/env node
/**
 * 云端轨**真实出片**冒烟（Step 2-AC2 / Step 4-AC1 的共同工具）—— ⚠️ **这一步真的花钱**。
 *
 * ## 为什么它必须存在，且必须"花钱"
 * 其余所有测试都在证明"我们的代码自洽"：假上游桩（`registry.cloud.test.ts`）钉的是**我们的**不变量，
 * 夹具 provider 钉的是**无外网**的那条路。而"上游到底认不认我们发的请求体、`--` 参数生不生效、
 * `content.video_url` 在不在那个位置"——**只有真机一次出片能回答**。
 * 这些字段在 `providers/seedanceProtocol.ts` 里长期标着【待验证】，本脚本就是让它们落地的那个动作。
 *
 * ## 它走的是产品真实路径（不是直连上游）
 * 起本地后端 → `POST /api/generate`（凭据经 **`X-Provider-Key` 请求头**，这是 AC2 的硬要求：
 * 用 env 兜底 Key 绕开等于没验 BYOK）→ 2s 轮询 → 服务端下载成片 + 抽封面。
 * 于是它顺带验证了：206 Range、`/media` 直链、封面抽帧、入参快照。
 *
 * ## 用法
 * ```bash
 * # 先备好 Key（不要写进仓库；用环境变量或本地 gitignore 文件）
 * export ARK_API_KEY=ark-xxxx
 * node scripts/smoke-seedance-paid.mjs --confirm-spend            # T2V，用内置的灯具广告提示词
 * node scripts/smoke-seedance-paid.mjs --confirm-spend --i2v shot.jpg   # I2V（首帧图）
 * node scripts/smoke-seedance-paid.mjs --confirm-spend --prompt "..."  # 自定义提示词
 * ```
 * `--confirm-spend` 是**刻意**的：没有它脚本只打印将要发生的事并退出 ——
 * 免得它被误挂进 CI 或某个 `--all` 脚本里，一夜之间烧掉一笔钱。
 *
 * ## 本次实测（2026-09-23，doubao-seedance-2-0-mini-260615 / 720p / 5s）
 * 提交→终态 **86.5s**；成片 5.09s / 1280×720 / 24fps / h264 + **AAC 2ch 32kHz**（上游自带音轨）；
 * 2.23MB；`/media` 206 Range 正常；封面抽帧成功；画面无水印（`--watermark false` 生效）。
 */
import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function flagValue(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

const CONFIRM = args.includes('--confirm-spend');
const MODEL = flagValue('--model') ?? 'doubao-seedance-2-0-mini-260615';
const BASE_URL = flagValue('--base-url') ?? 'https://ark.cn-beijing.volces.com/api/v3';
const DURATION_SEC = Number(flagValue('--duration') ?? 5);
const I2V_IMAGE = flagValue('--i2v');
/** FL2V：尾帧（与 `--i2v` 的首帧配对使用） */
const LAST_IMAGE = flagValue('--last');
/** V2V：参考视频（`assets.referenceVideo` → 上游 `reference_image` 角色） */
const REFERENCE_VIDEO = flagValue('--video');
const OUT_DIR = path.join(ROOT, '.tmp', 'paid-smoke');
const DATA_DIR = path.join(ROOT, '.tmp', 'paid-smoke-data');

/**
 * `--server <https://host>`：**打已部署的实例**而不是起本地后端。
 *
 * 为什么需要它：V2V 要求资产是**公网可抓的 URL**，而本机 `PUBLIC_BASE_URL` 为空时只能给
 * data URL（上游明确拒绝）。也就是说"视频参考"这条路**只存在于线上**，要验证就必须打线上。
 * 线上有站点登录，于是凭据走 `--creds-file <user:pass>`（Basic），请求头里再带 BYOK Key。
 */
const SERVER = flagValue('--server');
const CREDS_FILE = flagValue('--creds-file');
const BASIC_AUTH =
  CREDS_FILE === undefined ? undefined : `Basic ${Buffer.from(readFileSync(CREDS_FILE, 'utf8').trim()).toString('base64')}`;

/**
 * `--insecure`：跳过 TLS 证书校验。**只用于 IP 档部署**（Caddy 用本地 CA 自签，
 * 浏览器里手工信任一次即可，Node 的 `fetch` 没有这个"信任一次"的口子）。
 * 显式开关而不是默认跳过 —— 默认跳过等于把"证书校验"这件事从工程里删掉。
 */
if (args.includes('--insecure')) {
  process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
  console.warn('⚠️  --insecure：本次不校验证书（自签 IP 档专用；不要对公网域名这么做）\n');
}

/**
 * Key 只从**环境变量**或**本地 gitignore 文件**读；`--key-file` 传的是路径而不是 Key 本身
 * —— 把 Key 直接写进命令行会让它进入 shell history 与进程列表。
 */
const KEY_FILE = flagValue('--key-file');
const API_KEY = (
  process.env['ARK_API_KEY'] ?? (KEY_FILE === undefined ? '' : readFileSync(KEY_FILE, 'utf8'))
).trim();

const DEFAULT_PROMPT = [
  '广告片：一盏现代极简风台灯的产品广告。',
  '镜头一（0-1.5s）：漆黑的卧室书桌，只有窗外城市霓虹的冷蓝余光；台灯静置在桌面，金属灯臂反射出微弱光点。',
  '镜头二（1.5-3s）：手指轻触灯座开关，暖金色灯光从灯罩内向外层层铺开，照亮书桌木纹、翻开的书页与一杯冒着热气的茶，桌面影子向四周缓缓拉开（丁达尔光束可见）。',
  '镜头三（3-5s）：低角度缓慢环绕推近，掠过灯罩的柔光扩散纹理与磨砂金属质感，背景暖光虚化成温柔光斑，画面定格在灯与暖光构成的舒适角落。',
  '质感：广告大片，2700K 暖光与冷蓝环境光的对比，浅景深，微距质感，画面干净稳定，无文字无字幕。',
].join('\n');

// `--prompt-file` 是为了避开在命令行里传中文长文本：Windows 的 shell 编码很容易把它弄坏
const PROMPT_FILE = flagValue('--prompt-file');
const PROMPT =
  PROMPT_FILE === undefined ? (flagValue('--prompt') ?? DEFAULT_PROMPT) : readFileSync(PROMPT_FILE, 'utf8').trim();
/**
 * 模式由**给了什么输入**推出来（而不是让用户另外传一个 `--mode`，那样会出现
 * "传了 `--mode fl2v` 却只给一张图"的自相矛盾输入）：
 * `--video` → v2v；`--last` → fl2v；`--i2v` → i2v；都没有 → t2v。
 */
const MODE =
  REFERENCE_VIDEO !== undefined ? 'v2v' : LAST_IMAGE !== undefined ? 'fl2v' : I2V_IMAGE !== undefined ? 'i2v' : 't2v';

const INPUT_SUMMARY = [
  I2V_IMAGE === undefined ? '' : `首帧 ${I2V_IMAGE}`,
  LAST_IMAGE === undefined ? '' : `尾帧 ${LAST_IMAGE}`,
  REFERENCE_VIDEO === undefined ? '' : `参考视频 ${REFERENCE_VIDEO}`,
]
  .filter((item) => item !== '')
  .join(' · ');

console.log('── 将要发生的事 ─────────────────────────────');
console.log(`  模型        ${MODEL}`);
console.log(`  端点        ${BASE_URL}`);
console.log(`  模式        ${MODE}${INPUT_SUMMARY === '' ? '' : `（${INPUT_SUMMARY}）`}`);
console.log(`  时长/分辨率 ${DURATION_SEC}s / 1280×720`);
console.log(`  产物目录    ${path.relative(ROOT, OUT_DIR)}`);
console.log(`  凭据来源    ${API_KEY === undefined ? '(未提供：ARK_API_KEY 或 --key-file)' : '已提供（不回显）'}`);
console.log('─────────────────────────────────────────────\n');

if (!CONFIRM) {
  console.log('⚠️  这是**付费**冒烟：一次 5s/720p 出片按官方口径约 1~2.5 元（以方舟账单为准）。');
  console.log('   确认要跑，请在命令末尾加 `--confirm-spend`。\n');
  process.exit(0);
}

if (API_KEY === undefined || API_KEY.trim() === '') {
  console.error('✗ 缺少 Key：请设置 ARK_API_KEY，或用 --key-file <路径>（该文件不应入库）');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(DATA_DIR, { recursive: true });

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

const port = SERVER === undefined ? await freePort() : 0;
const base = SERVER?.replace(/\/+$/, '') ?? `http://127.0.0.1:${port}`;
const API_TOKEN = randomUUID().replace(/-/g, '');
/** 本地：后端只认 Bearer；线上：Caddy 用站点登录（Basic）换 Bearer，所以带 Basic */
const AUTH =
  SERVER === undefined
    ? { authorization: `Bearer ${API_TOKEN}` }
    : { ...(BASIC_AUTH === undefined ? {} : { authorization: BASIC_AUTH }) };

let backend;
if (SERVER === undefined) {
  console.log(`=== 起本地后端（生产形态 + Bearer 鉴权，端口 ${port}）===`);
  backend = spawn(process.execPath, [path.join(ROOT, 'backend', 'dist', 'index.js')], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      DATA_DIR,
      OUTPUT_DIR: OUT_DIR,
      PUBLIC_API_TOKEN: API_TOKEN,
      // 刻意不设 VOLCANO_MODEL_NAME / VOLCANO_API_KEY：本次要验的就是"凭据与模型都来自请求"
      ENABLE_FIXTURE_PROVIDER: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} else {
  console.log(`=== 打已部署实例 ${base}（站点登录 + 请求头 BYOK）===`);
  if (BASIC_AUTH === undefined) {
    console.warn('⚠️  未提供 --creds-file：若该实例要求站点登录，后续请求会 401');
  }
}
const backendLog = [];
backend?.stdout.on('data', (chunk) => backendLog.push(String(chunk)));
backend?.stderr.on('data', (chunk) => backendLog.push(String(chunk)));

async function waitForHealth(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/health`, { headers: AUTH });
      if (response.ok) return;
    } catch {
      /* 还没起来 / 还不通 */
    }
    await sleep(300);
  }
  throw new Error(`服务未在 ${timeoutMs}ms 内就绪（${base}）：\n${backendLog.join('')}`);
}

async function finish(code) {
  backend?.kill('SIGTERM');
  await sleep(300);
  process.exit(code);
}

await waitForHealth();
console.log(`就绪：${base}`);

/**
 * 参考资产一律走**产品路径**上传（`/api/upload` → 防线 4 清洗网关 → `assets/`），
 * 这一步顺带把上传链路也验了。返回 assetId 供请求体的 `assets` 使用。
 */
async function uploadAsset(filePath) {
  const bytes = readFileSync(filePath);
  const isVideo = /\.(mp4|mov)$/i.test(filePath);
  const form = new FormData();
  form.append(
    'files',
    new Blob([bytes], { type: isVideo ? 'video/mp4' : 'image/jpeg' }),
    path.basename(filePath),
  );

  const uploaded = await fetch(`${base}/api/upload`, { method: 'POST', headers: AUTH, body: form });
  const payload = await uploaded.json();
  console.log(
    `上传 ${path.basename(filePath)}（${(bytes.length / 1024 / 1024).toFixed(2)} MB）→ HTTP ${uploaded.status}`,
    JSON.stringify(payload),
  );

  const assetId = payload.assets?.[0]?.assetId;
  if (uploaded.status !== 200 || assetId === undefined) {
    console.error('上传失败，终止。');
    await finish(1);
  }
  return assetId;
}

let assets;
if (I2V_IMAGE !== undefined || LAST_IMAGE !== undefined || REFERENCE_VIDEO !== undefined) {
  assets = {
    ...(I2V_IMAGE === undefined ? {} : { firstFrameImage: await uploadAsset(I2V_IMAGE) }),
    ...(LAST_IMAGE === undefined ? {} : { lastFrameImage: await uploadAsset(LAST_IMAGE) }),
    ...(REFERENCE_VIDEO === undefined ? {} : { referenceVideo: await uploadAsset(REFERENCE_VIDEO) }),
  };
}

const body = {
  prompt: PROMPT,
  mode: MODE,
  aspectRatio: '16:9',
  resolution: { width: 1280, height: 720 },
  params: { durationSec: DURATION_SEC },
  provider: 'cloud-volcano-seedance',
  options: { model: MODEL, baseUrl: BASE_URL, seedanceWatermark: false },
  ...(assets === undefined ? {} : { assets }),
};

console.log('\n=== 提交（凭据经 X-Provider-Key）===');
const startedAt = Date.now();
const submit = await fetch(`${base}/api/generate`, {
  method: 'POST',
  headers: {
    ...AUTH,
    'content-type': 'application/json',
    'x-provider-key': API_KEY.trim(),
    'idempotency-key': `paid-smoke-${Date.now()}`,
  },
  body: JSON.stringify(body),
});
const submitPayload = await submit.json();
console.log(`HTTP ${submit.status}`, JSON.stringify(submitPayload));
if (submit.status !== 200) {
  console.error('提交失败；后端日志：\n' + backendLog.join(''));
  await finish(1);
}

const { taskId } = submitPayload;
console.log(`taskId=${taskId}`);

console.log('\n=== 轮询（2s，最长 10 分钟）===');
let progress = null;
const deadline = Date.now() + 10 * 60_000;
let lastLine = '';
while (Date.now() < deadline) {
  progress = await (await fetch(`${base}/api/tasks/${taskId}`, { headers: AUTH })).json();
  const line = `${progress.status} ${progress.progressPercent}% ${progress.message ?? ''}`;
  if (line !== lastLine) {
    console.log(`  [${((Date.now() - startedAt) / 1000).toFixed(0)}s] ${line}`);
    lastLine = line;
  }
  if (['succeeded', 'failed', 'cancelled'].includes(progress.status)) break;
  await sleep(2000);
}

console.log(`\n=== 终态：${progress?.status}（提交→终态 ${((Date.now() - startedAt) / 1000).toFixed(1)}s）===`);
console.log(JSON.stringify(progress, null, 2));

if (progress?.status !== 'succeeded') {
  console.log('\n失败/未完成详情：', JSON.stringify(progress?.error ?? progress, null, 2));
  console.log('\n后端日志尾部：\n' + backendLog.join('').split('\n').slice(-25).join('\n'));
  await finish(1);
}

const mediaUrl = progress.outputVideoUrl;
const local = path.join(OUT_DIR, path.basename(mediaUrl));

console.log('\n=== 产物核验 ===');

/**
 * `--server` 模式下成片在**服务器**上（只有本机后端才会写进我们指定的 OUTPUT_DIR），
 * 所以这里先把整片拉回来再 ffprobe —— 既完成了"产物可下载"的验证，也让画面核对成为可能。
 */
if (SERVER !== undefined) {
  const full = await fetch(`${base}${mediaUrl}`, { headers: AUTH });
  if (full.status !== 200 || full.body === null) {
    console.error(`✗ 成片下载失败：HTTP ${full.status}`);
    await finish(1);
  }
  await pipeline(Readable.fromWeb(full.body), createWriteStream(local));
  console.log(`成片已从线上取回：${path.basename(local)}（${(statSync(local).size / 1024 / 1024).toFixed(2)} MB）`);
}

const exists = existsSync(local);
console.log(
  `成片落盘：${exists ? '✓' : '✗'} ${path.basename(local)}${exists ? `（${(statSync(local).size / 1024 / 1024).toFixed(2)} MB）` : '（缺失）'}`,
);

const ranged = await fetch(`${base}${mediaUrl}`, { headers: { ...AUTH, range: 'bytes=0-1023' } });
console.log(
  `/media 片段请求：HTTP ${ranged.status}（期望 206）content-range=${ranged.headers.get('content-range')}`,
);
await pipeline(Readable.fromWeb(ranged.body), createWriteStream(path.join(OUT_DIR, 'range-check.bin')));

const info = JSON.parse(
  execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', local]).toString(),
);
const video = info.streams.find((stream) => stream.codec_type === 'video');
const audio = info.streams.find((stream) => stream.codec_type === 'audio');
console.log(
  JSON.stringify(
    {
      durationSec: Number(info.format.duration).toFixed(2),
      sizeMB: (Number(info.format.size) / 1024 / 1024).toFixed(2),
      video: video === undefined ? null : `${video.codec_name} ${video.width}x${video.height} ${video.r_frame_rate}`,
      audio: audio === undefined ? '无音轨' : `${audio.codec_name} ${audio.channels}ch ${audio.sample_rate}Hz`,
    },
    null,
    2,
  ),
);

const thumb = path.join(OUT_DIR, 'thumbs', `${taskId}.jpg`);
console.log(`封面抽帧：${existsSync(thumb) ? '✓' : '✗'}`);
console.log(`入参快照（确认用的就是请求下发的模型）：${JSON.stringify(progress.requestSnapshot?.options)}`);
console.log(`\n产物：${local}`);
console.log('（费用请到方舟控制台账单核对：token ≈ 时长 × 宽 × 高 × 帧率 ÷ 1024）');

await finish(0);
