#!/usr/bin/env node
/**
 * 端到端真机冒烟：**从本服务的 API 提交 → 落到用户本机的 ComfyUI → 出片回到本服务**（台账 A1 片 C）。
 *
 * ## 它与 `comfyui-acceptance.mjs` 的分工（两条都要有，不是二选一）
 * - `comfyui-acceptance.mjs` 直接跟 ComfyUI 说话：证明"**参数对不对、要多少时间**"；
 * - 这个脚本走**我们自己的服务**：证明"**整条链对不对**" ——
 *   能力位（`/api/providers/status`）→ 提交（`/api/generate`）→ 调度与状态（`/api/tasks/:id`）
 *   → 产物落盘 → **`executedBy: 'host-local'` 如实标注**（V2.27 那个字段第一次跑在真链路上）。
 *
 * ## 前置
 * - `pnpm build`（需要 `backend/dist/index.js`）；
 * - 本机 ComfyUI 在跑（默认 `http://127.0.0.1:8188`，可用 `COMFYUI_BASE_URL` 覆盖）。
 *   缺任何一条都**明确失败**，不静默跳过 —— 静默跳过等于这条防线不存在。
 *
 * ## 用法
 * `node scripts/smoke-comfyui-e2e.mjs [--duration 5] [--timeout 25] [--prompt "..."]`
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND_ENTRY = path.join(ROOT, 'backend', 'dist', 'index.js');
const COMFY_BASE = (process.env.COMFYUI_BASE_URL ?? 'http://127.0.0.1:8188').replace(/\/$/, '');
const KEEP = process.argv.includes('--keep');

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value === undefined || value.startsWith('--') ? fallback : value;
}

const DURATION_SEC = Number(flag('duration', '5'));
const TIMEOUT_MIN = Number(flag('timeout', '25'));
const PROMPT = flag('prompt', 'A neon-lit rainy street at night, reflections on wet asphalt, cinematic');

const failures = [];
function assert(condition, message) {
  if (condition) {
    console.log(`✓ ${message}`);
  } else {
    console.error(`✗ ${message}`);
    failures.push(message);
  }
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

/** 前置 1：构建产物 */
try {
  statSync(BACKEND_ENTRY);
} catch {
  console.error(`✗ 缺构建产物：${BACKEND_ENTRY}\n  先执行 \`pnpm build\`。`);
  process.exit(1);
}

/** 前置 2：ComfyUI 可达（连不上就说清怎么起，不静默跳过） */
try {
  const stats = await (await fetch(`${COMFY_BASE}/system_stats`, { signal: AbortSignal.timeout(5000) })).json();
  const device = stats.devices?.[0] ?? {};
  console.log(
    `ComfyUI ${stats.system?.comfyui_version ?? '?'} @ ${COMFY_BASE} · ${device.name ?? '未知设备'} · ` +
      `显存空闲 ${(device.vram_free / 1024 ** 3).toFixed(2)} GB`,
  );
} catch (error) {
  console.error(
    `✗ 连不上 ComfyUI（${COMFY_BASE}）：${error instanceof Error ? error.message : String(error)}\n` +
      '  本机便携版启动方式见 docs/PLAN.md 的 V8.34 段（run_nvidia_gpu.bat）。',
  );
  process.exit(1);
}

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-comfy-data-'));
const OUTPUTS_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-comfy-out-'));
const PORT = await freePort();
const baseUrl = `http://127.0.0.1:${PORT}`;
console.log(`\n=== AstrmiraVideo × 本地 ComfyUI 端到端冒烟 ===\n实例：${baseUrl}（临时 DATA_DIR / OUTPUT_DIR）`);

const child = spawn(process.execPath, [BACKEND_ENTRY], {
  cwd: ROOT,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(PORT),
    DATA_DIR,
    OUTPUT_DIR: OUTPUTS_DIR,
    PUBLIC_API_TOKEN: 'smoke-loopback-only',
    // 这三行就是"本地 ComfyUI 这一档怎么开"（CONTRACT §19-1）：地址 + 开放本地轨
    COMFYUI_BASE_URL: COMFY_BASE,
    EXPOSE_HOST_LOCAL_TRACK: '1',
    VOLCANO_API_KEY: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', () => {});
child.stderr.on('data', () => {});

let exitCode = 0;
try {
  // 等就绪
  let ready = false;
  for (let i = 0; i < 60; i += 1) {
    await sleep(500);
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* 还没起来 */
    }
  }
  if (!ready) throw new Error('后端未在 30s 内就绪');
  assert(true, '后端起来了（回环免鉴权）');

  // ① 能力位：配置事实（不是硬件判断）
  const status = await (await fetch(`${baseUrl}/api/providers/status`)).json();
  assert(
    status.comfyui?.available === true,
    `能力位如实：comfyui.available=true（reason：${status.comfyui?.reason ?? '—'}）`,
  );

  // ①.b V2.34（台账 B4 / CONTRACT §20）：**运行时自检**要在真机上给出"能跑什么" ——
  // 它比 /status 强的地方就在这里：`available` 是"真的连了一次"的结论，
  // 而不是"env 里有个合规地址"。
  const selfCheck = await (await fetch(`${baseUrl}/api/providers/selfcheck`)).json();
  const comfyEntry = (selfCheck.entries ?? []).find((entry) => entry.provider === 'host-comfyui');
  assert(
    comfyEntry?.available === true,
    `自检真的连上了 ComfyUI 并给出结论（${comfyEntry?.reason ?? '没有这一项'}）`,
  );
  assert(
    typeof comfyEntry?.reason === 'string' && /模型：/.test(comfyEntry.reason),
    '自检结论里带着"用的哪个模型 / 能跑哪些模式"（不是一句空泛的"可用"）',
  );

  // ② 提交（走真实路由；provider = host-comfyui）
  const submitAt = Date.now();
  const submit = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: PROMPT,
      mode: 't2v',
      aspectRatio: '16:9',
      provider: 'host-comfyui',
      params: { durationSec: DURATION_SEC },
    }),
  });
  if (!submit.ok) {
    throw new Error(`提交失败：HTTP ${submit.status} ${(await submit.text()).slice(0, 400)}`);
  }
  const { taskId } = await submit.json();
  assert(true, `已提交（taskId=${taskId}，${DURATION_SEC}s / 16:9 → ComfyUI 480p 档）`);

  // ③ 轮询到终态（本地轨首次会加载 ~9GB 模型，给足时间）
  const deadline = Date.now() + TIMEOUT_MIN * 60 * 1000;
  let progress = null;
  let lastMessage = '';
  while (Date.now() < deadline) {
    progress = await (await fetch(`${baseUrl}/api/tasks/${taskId}`)).json();
    if (progress.message !== lastMessage) {
      lastMessage = progress.message ?? '';
      console.log(`  · [${((Date.now() - submitAt) / 1000).toFixed(0)}s] ${progress.status} · ${lastMessage}`);
    }
    if (['succeeded', 'failed', 'cancelled'].includes(progress.status)) break;
    await sleep(3000);
  }
  if (progress === null || !['succeeded', 'failed', 'cancelled'].includes(progress.status)) {
    throw new Error(`任务未在 ${TIMEOUT_MIN} 分钟内到终态`);
  }

  const elapsedSec = (Date.now() - submitAt) / 1000;
  assert(progress.status === 'succeeded', `任务终态 = succeeded（耗时 ${elapsedSec.toFixed(0)}s）`);
  if (progress.status !== 'succeeded') {
    console.error(`  失败详情：${JSON.stringify(progress.error ?? {}, null, 1)}`);
  }

  // ④ executedBy：**这条是本地轨的核心承诺**，必须如实标注
  assert(
    progress.executedBy === 'host-local',
    `executedBy 如实标注为 host-local（实际 ${progress.executedBy ?? '缺省'}）—— ` +
      '这是"数据不出这台机器"能被验证的那个字段（V2.27）',
  );

  // ⑤ 产物：真的落盘、真的能播
  const url = progress.outputVideoUrl;
  assert(typeof url === 'string' && url.startsWith('/media/'), `成片地址存在（${url}）`);
  if (typeof url === 'string') {
    const head = await fetch(`${baseUrl}${url}`, { headers: { range: 'bytes=0-1023' } });
    assert(head.status === 206 || head.status === 200, `/media 可读（HTTP ${head.status}）`);
    const fileName = url.replace('/media/', '');
    const filePath = path.join(OUTPUTS_DIR, fileName);
    const size = statSync(filePath).size;
    assert(size > 10_000, `产物落盘且不是空壳（${fileName} · ${(size / 1024).toFixed(1)} KB）`);
    try {
      const probe = execFileSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_name,width,height,nb_frames,r_frame_rate,duration',
          '-of',
          'default=noprint_wrappers=1',
          filePath,
        ],
        { encoding: 'utf8' },
      );
      console.log(`  · ffprobe：\n${probe.trim()}`);
      assert(/codec_name=h264/.test(probe), '是 h264 视频（本地轨产物格式与云端一致）');
    } catch (error) {
      assert(false, `ffprobe 读不出来：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ⑥ 视频库能看到它（"出片 → 进画廊"的最后一跳）
  const history = await (await fetch(`${baseUrl}/api/history?limit=10`)).json();
  const found = (history.items ?? []).some((item) => item.taskId === taskId);
  assert(found, '视频库（/api/history）里能找到这条任务');
} catch (error) {
  console.error(`\n✗ 冒烟执行异常：${error instanceof Error ? error.message : String(error)}`);
  failures.push('冒烟执行异常');
} finally {
  child.kill();
  await sleep(300);
  if (!KEEP) {
    for (const dir of [DATA_DIR, OUTPUTS_DIR]) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        /* 临时目录残留无碍 */
      }
    }
  } else {
    console.log(`--keep：临时目录保留在 ${DATA_DIR} / ${OUTPUTS_DIR}`);
  }
}

if (failures.length > 0) {
  console.error(`\n✗ 端到端冒烟失败（${failures.length} 项）：\n${failures.map((item) => `  · ${item}`).join('\n')}`);
  exitCode = 1;
} else {
  console.log('\n✓ 端到端冒烟通过：能力位 → 提交 → 本地 ComfyUI 出片 → 落盘 → executedBy 如实标注');
}

process.exit(exitCode);
