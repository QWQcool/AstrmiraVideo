#!/usr/bin/env node

/**
 * 画布保存链路（V2.108 / 台账 B85 片 A）：**打开不白写、第一次修改一定落盘、刷新还在**。
 *
 * ## 为什么这条要真浏览器
 * 保存判断原来写在 `CanvasStudioView` 的内联条件里，而视图在本仓**没有渲染测试**（不引 jsdom）。
 * 判断写错时的症状是"某次修改没落盘"，单测看不见、界面也不报错 —— 只有真浏览器 + 真服务端
 * 才能把"点了按钮之后有没有 PUT"钉死。判断本身现在也有纯函数单测
 * （`frontend/src/lib/canvasSaveDecision.test.ts`），两边合起来才算覆盖。
 *
 * ## 判据（都能复算）
 * 1. **打开画布不会立刻白写一次**：进入画布后 1.5 秒内没有 `PUT /api/canvas/docs/*`
 *    （刚读回来的那份不该被写回去）；
 * 2. **打开后的第一次修改一定落盘**：点一次「＋ 节点」→ 必须出现 PUT（旧的一次性闸门
 *    在竞态下会把这次修改吞掉，而且顶栏还显示"已保存"）；
 * 3. **刷新后节点还在**：重新加载页面，节点数 > 0（证明落的是服务端，不是内存）。
 *
 * ## 用法
 * ```bash
 * pnpm build && node tests/browser/canvas-save-e2e.mjs [--headed]
 * ```
 * 退出码：0 全过；1 有失败；2 跑不了（没 build / 后端没起来）。
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
// 用构建产物而不是包名：`tests/` 不在 workspace 依赖里，包名解不到（root node_modules 没有这个链接）
import { createEmptyCanvasDoc } from '../../packages/shared/dist/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BACKEND_ENTRY = path.join(ROOT, 'backend/dist/index.js');
const FRONTEND_DIST = path.join(ROOT, 'frontend/dist');
const EVIDENCE_DIR = path.join(ROOT, '.tmp/e2e');
const HEADED = process.argv.includes('--headed');

const fail = (message) => {
  console.error(`\n✗ 跑不了：${message}`);
  process.exit(2);
};

if (!existsSync(BACKEND_ENTRY)) fail('backend/dist 不存在 —— 先跑 `pnpm build`');
if (!existsSync(FRONTEND_DIST)) fail('frontend/dist 不存在 —— 先跑 `pnpm build`');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
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

const failures = [];
function check(ok, message) {
  console.log(`${ok ? '✓' : '✗'} ${message}`);
  if (!ok) failures.push(message);
  return ok;
}

mkdirSync(EVIDENCE_DIR, { recursive: true });
const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-cs-data-'));
const OUTPUTS_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-cs-out-'));
const PORT = await freePort();
const baseUrl = `http://127.0.0.1:${PORT}`;

console.log('\n=== 画布保存链路（V2.108）===');
console.log(`实例：${baseUrl}`);

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
    PUBLIC_API_TOKEN: 'canvas-save-loopback-only',
    VOLCANO_API_KEY: '',
    EXPOSE_HOST_LOCAL_TRACK: '1',
  },
  stdio: 'ignore',
});

let browser = null;
let exitCode = 0;
try {
  if (!(await waitForHealth(baseUrl))) throw new Error('后端未在 40s 内就绪');

  browser = await chromium.launch({ headless: !HEADED });
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  /** 记录所有画布保存请求（PUT /api/canvas/docs/<id>） */
  const puts = [];
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().includes('/api/canvas/docs/')) {
      puts.push({ at: Date.now(), url: request.url() });
    }
  });

  // 先**用接口造一块画布**（这样"打开"与"新建"分得清，不会被自动建画布的那次 PUT 混进来）
  const projectId = 'canvas-save-e2e';
  const seed = await fetch(`${baseUrl}/api/canvas/docs/${projectId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(createEmptyCanvasDoc(projectId, '保存链路验收')),
  });
  check(seed.ok, `建出测试画布（PUT → HTTP ${seed.status}）`);

  await page.goto(`${baseUrl}/#/canvas?project=${projectId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cs-page', { timeout: 60_000 });
  const loadedAt = Date.now();
  await page.waitForTimeout(2500);

  const putsOnLoad = puts.filter((entry) => entry.at >= loadedAt);
  check(putsOnLoad.length === 0, `打开画布没有白写一次（${putsOnLoad.length} 次 PUT，期望 0）`);

  // ① 打开后的**第一次**修改：点左栏第一个"加节点"按钮（`.cs-rail-btn`，顺序 = ADDABLE）
  const addButton = page.locator('.cs-rail-btn').first();
  await addButton.waitFor({ state: 'visible', timeout: 30_000 });
  await addButton.click({ timeout: 20_000 });

  let firstPut = null;
  for (let index = 0; index < 120 && firstPut === null; index += 1) {
    await page.waitForTimeout(250);
    firstPut = puts.find((entry) => entry.at > loadedAt + 1000) ?? null;
  }
  check(firstPut !== null, '打开后的第一次修改落盘了（出现 PUT）');

  // 等保存完成（顶栏 `data-state=saved`）再刷新
  await page
    .waitForSelector('.cs-save[data-state=saved]', { timeout: 30_000 })
    .catch(() => undefined);
  const savedState = await page.locator('.cs-save').getAttribute('data-state');
  check(savedState === 'saved', `顶栏回到"已保存"（实际 ${savedState}）`);

  const nodesBefore = await page.locator('.react-flow__node').count();
  check(nodesBefore > 0, `画布上有节点（实际 ${nodesBefore}）`);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cs-page', { timeout: 60_000 });
  await page.waitForTimeout(2000);
  const nodesAfter = await page.locator('.react-flow__node').count();
  check(nodesAfter === nodesBefore, `刷新后节点还在（刷新前 ${nodesBefore} → 刷新后 ${nodesAfter}）`);

  check(pageErrors.length === 0, `零 pageerror（${pageErrors.length} 条${pageErrors[0] ? `：${pageErrors[0]}` : ''}）`);

  if (failures.length > 0) exitCode = 1;
  console.log(
    `\n${failures.length === 0 ? '✓ 画布保存链路通过' : `✗ 失败 ${failures.length} 项：\n  · ${failures.join('\n  · ')}`}`,
  );
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

spawnSync('node', ['-e', '0']);
process.exit(exitCode);
