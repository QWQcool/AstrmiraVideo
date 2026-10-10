#!/usr/bin/env node
/**
 * README / docs 用的**真实界面截图**（PLAN §9 台账 **B59**）。
 *
 * ## 为什么需要它（而不是"再生成一张概念图"）
 * README 之前挂的是 AI 生成的概念稿（`docs/assets/01_main_workspace.jpg`）—— 那张图里有
 * **ComfyUI / MiniMax / Kling** 这些本项目并不存在的上游名，界面语言是英文，布局也和 V9 后的真实壳不同。
 * 概念稿可以用来"定方向"，但**不能当产品说明**：访客会把它当成产品实际长相。
 * 本脚本做的事只有一件：**把服务真跑起来、造真数据、截真图**。
 *
 * ## 三条口径
 * 1. **截图是证据，不是设计**：不修图、不摆拍、不加注释；界面什么样就截什么样；
 * 2. **数据来自夹具 provider**（`ENABLE_FIXTURE_PROVIDER=1`，零外网零配额，ffmpeg 现场合成），
 *    与 UI 冒烟同一套 —— 所以"截图里的片子"是真跑出来的产物，不是占位图；
 * 3. **桌面 + 手机各一组**：手机那组是**现状记录**（当前只做到"能看"，见 docs/FRONTEND-REVIEW.md），
 *    刻意不做美化 —— 它是"移动端适配到什么程度"的证据，不是宣传图。
 *
 * ## 前置与用法
 * ```bash
 * pnpm build                                  # 需要 backend/dist + frontend/dist
 * node scripts/make-fixture-clips.mjs         # 夹具片段（缺了会自动提示）
 * node scripts/capture-docs-shots.mjs         # → docs/assets/ui/*.png（用夹具片段，任何人可复现）
 * node scripts/capture-docs-shots.mjs --clip <某段 mp4>   # 换成自己的片段（只为看效果，片不入库）
 * node scripts/capture-docs-shots.mjs --tasks 3           # 造几条任务（生成有 60s 冷却，条数越多越慢）
 * ```
 * ⚠️ 生成路由有 **60s 防抖冷却**（防线 5），本脚本会读 `retryAfterMs` **等够再提交**，
 * 不绕过任何防线（截图不值得为它开一个后门）。
 *
 * `--clip` 走的是夹具 provider **本来就支持**的选片覆盖（`options.fixtureClip`，见
 * `backend/src/providers/fixture/FixtureLocalProvider.ts` 的 `resolveClip`）——
 * 它把片段临时拷进夹具目录（`tests/fixtures/clips/`，**gitignored**）并在结束时删掉，
 * 因此默认路径仍然"零外部依赖、人人可复现"。
 */

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND_ENTRY = path.join(ROOT, 'backend', 'dist', 'index.js');
const FRONTEND_DIST = path.join(ROOT, 'frontend', 'dist');
const CLIPS_DIR = path.join(ROOT, 'tests', 'fixtures', 'clips');
const SHOT_DIR = path.join(ROOT, 'docs', 'assets', 'ui');

const flags = new Set(process.argv.slice(2));
const readFlag = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
};
const TASK_COUNT = Math.max(1, Number(readFlag('tasks', '3')));
const HEADED = flags.has('--headed');
/** 可选：用自己的片段当演示素材（临时拷进夹具目录，结束时删） */
const CLIP_SOURCE = readFlag('clip');
const DEMO_CLIP_NAME = 'base-shots-demo.mp4';
const DEMO_CLIP_PATH = path.join(CLIPS_DIR, DEMO_CLIP_NAME);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function waitForHealth(baseUrl, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return true;
    } catch {
      /* 未就绪 */
    }
    await sleep(200);
  }
  return false;
}

/** 造一条真实成功任务；遇到 60s 冷却就**等够再提交**（不绕过防线 5） */
async function submitFixtureTask(base, prompt, fixtureClip) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt,
        mode: 't2v',
        aspectRatio: '16:9',
        provider: 'fixture-local',
        // 夹具 provider 本来就支持的选片覆盖（见 resolveClip）；不传就用目录里的默认片段
        ...(fixtureClip === undefined ? {} : { options: { fixtureClip } }),
        params: { durationSec: 2 },
      }),
    });
    if (response.status === 429) {
      const body = await response.json().catch(() => ({}));
      const waitMs = Number(body?.retryAfterMs ?? 60_000) + 1_000;
      console.log(`  · 冷却中（防线 5）→ 等 ${Math.round(waitMs / 1000)}s 再试`);
      await sleep(waitMs);
      continue;
    }
    if (!response.ok) throw new Error(`造任务失败：HTTP ${response.status} ${await response.text()}`);

    const { taskId } = await response.json();
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const progress = await (await fetch(`${base}/api/tasks/${taskId}`)).json();
      if (progress.status === 'succeeded') return progress;
      if (['failed', 'cancelled'].includes(progress.status)) {
        throw new Error(`夹具任务未成功：${JSON.stringify(progress.error ?? progress)}`);
      }
      await sleep(300);
    }
    throw new Error(`夹具任务未在 60s 内结束（taskId=${taskId}）`);
  }
  throw new Error('冷却等待次数用尽（仍被限流）');
}

if (!existsSync(BACKEND_ENTRY) || !existsSync(path.join(FRONTEND_DIST, 'index.html'))) {
  console.error('缺构建产物：先 `pnpm build`（需要 backend/dist 与 frontend/dist）。');
  process.exit(1);
}
// 自定义演示片段（可选）：临时拷进夹具目录并在结束时删除 —— 夹具目录本身是 gitignored 的
let demoClipName;
if (CLIP_SOURCE !== undefined) {
  if (!existsSync(CLIP_SOURCE)) {
    console.error(`--clip 指向的文件不存在：${CLIP_SOURCE}`);
    process.exit(1);
  }
  mkdirSync(CLIPS_DIR, { recursive: true });
  copyFileSync(CLIP_SOURCE, DEMO_CLIP_PATH);
  demoClipName = DEMO_CLIP_NAME;
  console.log(`演示片段：${path.basename(CLIP_SOURCE)} → ${DEMO_CLIP_PATH}（结束时删除）`);
}
const clips = existsSync(CLIPS_DIR)
  ? readdirSync(CLIPS_DIR).filter((name) => name.endsWith('.mp4'))
  : [];
if (clips.length === 0) {
  console.error(
    `夹具片段目录为空：${CLIPS_DIR}\n  先执行：node scripts/make-fixture-clips.mjs（或用 --clip 指定一段 mp4）`,
  );
  process.exit(1);
}

const DATA_DIR = path.join(tmpdir(), `astrmira-shots-data-${Date.now()}`);
const OUTPUTS_DIR = path.join(tmpdir(), `astrmira-shots-out-${Date.now()}`);
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(OUTPUTS_DIR, { recursive: true });
mkdirSync(SHOT_DIR, { recursive: true });

const PORT = await freePort();
const baseUrl = `http://127.0.0.1:${PORT}`;
console.log(`\n=== 抓取真实界面截图 ===\n实例：${baseUrl}（NODE_ENV=production，回环免鉴权）`);
console.log(`输出：${SHOT_DIR}\n造 ${TASK_COUNT} 条夹具任务（含冷却等待，可能 1~3 分钟，请稍等）`);

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
    PUBLIC_API_TOKEN: 'docs-shots-loopback',
    VOLCANO_API_KEY: '',
    ENABLE_FIXTURE_PROVIDER: '1',
  },
  stdio: 'ignore',
});

const PROMPTS = [
  '晨雾中的老木屋，壁炉火光透过窗户（夹具合成，零外网）',
  '雨夜街头霓虹倒影，湿漉漉的柏油路面（夹具合成）',
  '午后咖啡馆窗边，光影缓慢移动（夹具合成）',
  '海边日落，浪花缓慢拍打礁石（夹具合成）',
];

let browser;
try {
  if (!(await waitForHealth(baseUrl))) throw new Error('后端未就绪');
  const tasks = [];
  for (let index = 0; index < TASK_COUNT; index += 1) {
    const task = await submitFixtureTask(
      baseUrl,
      PROMPTS[index % PROMPTS.length],
      demoClipName,
    );
    tasks.push(task);
    console.log(`  ✓ 任务 ${index + 1}/${TASK_COUNT}：${task.taskId.slice(0, 8)}`);
  }

  browser = await chromium.launch({ headless: !HEADED });

  /** 截图公共环境：暗色 + 关动效（截图可复现，也顺带确认 reduced-motion 降级不坏布局） */
  const shoot = async (name, hash, viewport) => {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
      colorScheme: 'dark',
    });
    const page = await context.newPage();
    await page.goto(`${baseUrl}/${hash}`, { waitUntil: 'load' });
    await page.waitForSelector('.wb-shell', { timeout: 20_000 });
    // 等首屏数据到位：画廊/日志/画布都是异步拉的，等到"载体元素"出现再截，否则截到骨架屏
    await page.waitForTimeout(2_500);
    const file = path.join(SHOT_DIR, `${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`  ✓ ${name}.png`);
    await context.close();
  };

  const DESKTOP = { width: 1440, height: 900 };
  const MOBILE = { width: 390, height: 844 };
  const editHash = `#/edit?task=${encodeURIComponent(tasks[0].taskId)}`;

  // ── 桌面（README 主图用）──
  await shoot('desktop-01-create', '#/create', DESKTOP);
  await shoot('desktop-02-workbench', '#/workbench', DESKTOP);
  await shoot('desktop-03-overview', '#/overview', DESKTOP);
  await shoot('desktop-04-library', '#/library', DESKTOP);
  await shoot('desktop-05-edit', editHash, DESKTOP);
  await shoot('desktop-06-canvas', '#/canvas', DESKTOP);
  await shoot('desktop-07-logs', '#/logs', DESKTOP);

  // ── 手机（现状记录：适配到什么程度，见 docs/FRONTEND-REVIEW.md）──
  await shoot('mobile-01-create', '#/create', MOBILE);
  await shoot('mobile-02-workbench', '#/workbench', MOBILE);
  await shoot('mobile-03-library', '#/library', MOBILE);

  console.log(`\n✓ 完成：${SHOT_DIR} 共 10 张`);
  console.log('  说明：手机那三张是**现状记录**（当前只做到"能看"），不是宣传图。');
} finally {
  await browser?.close();
  child.kill();
  // 自定义演示片段是**临时**的：夹具目录不该因为截了几张图就多出一个文件
  if (demoClipName !== undefined) rmSync(DEMO_CLIP_PATH, { force: true });
}
