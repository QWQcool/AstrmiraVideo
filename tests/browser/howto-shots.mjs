#!/usr/bin/env node

/**
 * 生成上手指南（docs/GUIDE.md）用的截图（V2.112）。
 *
 * 为什么要有脚本而不是手截：截图会**过期**，而过期截图比没有截图更糟（它教人点一个不存在的按钮）。
 * 这里是可复跑的：起一个隔离实例（夹具 provider 造源片，不碰真实数据、不花钱），
 * 打开三个界面各截一张。
 *
 * ## 用法
 * ```bash
 * pnpm build && node tests/browser/howto-shots.mjs
 * ```
 * 产物：`docs/assets/howto/*.png`（会被提交，供 GUIDE.md 引用）。
 *
 * 有 `MiMo_API_Key`（用户级环境变量）时，声音面板会显示"云端配音可用"的真实状态；
 * 没有时会如实显示"不可用" —— 截图里看到什么就是什么，不做假。
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createCanvasNode, createEmptyCanvasDoc } from '../../packages/shared/dist/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BACKEND_ENTRY = path.join(ROOT, 'backend/dist/index.js');
const FRONTEND_DIST = path.join(ROOT, 'frontend/dist');
const OUT_DIR = path.join(ROOT, 'docs/assets/howto');

const fail = (message) => {
  console.error(`\n✗ 跑不了：${message}`);
  process.exit(2);
};

if (!existsSync(BACKEND_ENTRY)) fail('backend/dist 不存在 —— 先跑 `pnpm build`');
if (!existsSync(FRONTEND_DIST)) fail('frontend/dist 不存在 —— 先跑 `pnpm build`');

/** MiMo 的 Key 在用户级环境变量里；只用于让"配音可用"的截图是真实状态，不提交任务 */
function resolveMimoKey() {
  const direct = process.env.MiMo_API_Key ?? process.env.MIMO_API_KEY;
  if (typeof direct === 'string' && direct !== '') return direct;
  if (process.platform !== 'win32') return null;
  const probe = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('MiMo_API_Key','User')"],
    { encoding: 'utf8' },
  );
  const value = (probe.stdout ?? '').trim();
  return value === '' ? null : value;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address !== null ? address.port : 0));
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

const MIMO_KEY = resolveMimoKey();
mkdirSync(OUT_DIR, { recursive: true });
const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-howto-data-'));
const OUTPUTS_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-howto-out-'));
const PORT = await freePort();
const baseUrl = `http://127.0.0.1:${PORT}`;

console.log(`\n=== 生成上手指南截图 · ${baseUrl} ===`);
console.log(
  `配音引擎：${MIMO_KEY === null ? '未配置（截图会如实显示不可用）' : '已配置（不提交任务，只影响面板状态）'}`,
);

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
    PUBLIC_API_TOKEN: 'howto-loopback-only',
    VOLCANO_API_KEY: '',
    ENABLE_FIXTURE_PROVIDER: '1',
    EXPOSE_HOST_LOCAL_TRACK: '1',
    ...(MIMO_KEY === null ? {} : { MIMO_API_KEY: MIMO_KEY }),
  },
  stdio: 'ignore',
});

let browser = null;
let exitCode = 0;
try {
  if (!(await waitForHealth(baseUrl))) throw new Error('后端未在 40s 内就绪');

  // 夹具源片（剪辑台要有东西可剪）
  const submit = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: '上手指南截图：夹具源片',
      mode: 't2v',
      aspectRatio: '16:9',
      provider: 'fixture-local',
      params: { durationSec: 5 },
    }),
  });
  if (!submit.ok) throw new Error(`夹具任务提交失败：HTTP ${submit.status}`);
  const { taskId } = await submit.json();
  for (let index = 0; index < 360; index += 1) {
    const progress = await (await fetch(`${baseUrl}/api/tasks/${taskId}`)).json();
    if (progress.status === 'succeeded') break;
    if (progress.status === 'failed') throw new Error('夹具视频生成失败');
    await sleep(250);
  }

  // 一块有内容的画布（三个节点 + 一条"丢回执"批次，好让顶栏的待核对徽章出现在图里）
  const projectId = 'howto-canvas';
  const doc = createEmptyCanvasDoc(projectId, '示例画布：一支 5 秒短片');
  const make = (id, type, x, y, title, prompt) => {
    const node = createCanvasNode({ id, type, x, y, title, now: Date.now() });
    node.data.draft = { ...node.data.draft, prompt };
    return node;
  };
  doc.nodes = [
    make('n-brief', 'text', 40, 40, '简报', '雪停后的院子，一只猫走过'),
    make('n-image', 'image', 380, 40, '画面', '雪地院子，清晨侧光'),
    make('n-video', 'video', 720, 40, '成片', '缓慢横移，5 秒'),
  ];
  doc.nodes[2].data.batches = [
    {
      id: 'batch-lost',
      createdAt: Date.now() - 120_000,
      status: 'queued',
      outputs: [],
      request: {
        prompt: '缓慢横移，5 秒',
        mode: 't2v',
        aspectRatio: '16:9',
        provider: 'host-comfyui',
      },
    },
  ];
  const seeded = await fetch(`${baseUrl}/api/canvas/docs/${projectId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(doc),
  });
  if (!seeded.ok) throw new Error(`画布种子失败：HTTP ${seeded.status}`);

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const shoot = async (file, prepare) => {
    if (prepare !== undefined) await prepare();
    await sleep(900); // 等动效落定
    const target = path.join(OUT_DIR, file);
    await page.screenshot({ path: target, fullPage: false });
    console.log(`✓ ${file}（${Math.round(statSync(target).size / 1024)} KB）`);
  };

  // ① 创作入口（默认落地页）
  await page.goto(`${baseUrl}/#/create`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.wb-shell', { timeout: 60_000 });
  await page.waitForTimeout(1200);
  await shoot('01_create.png');

  // ② 画布（三个节点 + 待核对徽章）
  await page.goto(`${baseUrl}/#/canvas?project=${projectId}`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cs-page', { timeout: 60_000 });
  await page.waitForTimeout(1500);
  await shoot('02_canvas.png');

  // ③ 剪辑台 + 声音面板（配音 tab：只切 tab，不提交任务）
  await page.goto(`${baseUrl}/#/edit?task=${encodeURIComponent(taskId)}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('[data-testid=ed-audio-panel]', { timeout: 60_000 });
  await page.waitForTimeout(1200);
  await shoot('03_edit_timeline.png');

  // 面板要单独出一张"整块"的图：先把视口拉高，否则右栏是内部滚动，元素截图会被裁掉半截
  await page.setViewportSize({ width: 1200, height: 1500 });
  const panel = page.locator('[data-testid=ed-audio-panel]');
  await panel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await panel.screenshot({ path: path.join(OUT_DIR, '04_audio_panel.png') });
  console.log(
    `✓ 04_audio_panel.png（${Math.round(statSync(path.join(OUT_DIR, '04_audio_panel.png')).size / 1024)} KB）`,
  );

  if (pageErrors.length > 0) {
    console.error(`✗ 出现 ${pageErrors.length} 条 pageerror：${pageErrors[0]}`);
    exitCode = 1;
  } else {
    console.log('\n✓ 四张截图已生成（零 pageerror）');
  }
} catch (error) {
  console.error(`\n✗ 执行出错：${error.message}`);
  exitCode = 1;
} finally {
  if (browser !== null) await browser.close();
  child.kill();
  await sleep(300);
  for (const dir of [DATA_DIR, OUTPUTS_DIR]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* 临时目录残留无碍 */
    }
  }
}

process.exit(exitCode);
