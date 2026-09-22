#!/usr/bin/env node
/**
 * 生产形态 UI 冒烟（PLAN §9 台账 **B9** 的视觉固化项）。
 *
 * ## 为什么需要它（已有 HTTP 测试还不够）
 * `pnpm test` 里的端到端是 **HTTP 级**的：它证明接口、206、落盘都对，
 * 但证明不了"浏览器真的把页面渲染出来了"。历史先例：`vite.config.ts` 缺 `/media` 代理时，
 * 接口全绿而播放器黑屏 —— 那类缺陷只有真的开一次浏览器才会暴露。
 *
 * ## 与"截图基线比对"的区别（刻意的取舍）
 * 本脚本**不做像素比对**：跨平台字体渲染差异会让像素基线长期 flaky。
 * 它只钉三件**语义**上确定的事：
 * 1. 三栏骨架渲染出来了（`.wb-panel` × 3、品牌、页脚水印）；
 * 2. 首屏真的与后端通了（头部徽章从"探测中"变成"服务在线"）；
 * 3. **控制台零 error / 零未捕获异常**（这条曾经抓到生产 CSP 与外部字体的冲突）。
 * 截图只作为 artifact 留档供人看，不参与判定。
 *
 * ## 为什么以 `NODE_ENV=production` 起后端
 * 生产的 CSP 只在 `NODE_ENV=production` 时启用（见 `backend/src/server/securityHeaders.ts`）。
 * 若用开发模式跑，就永远测不到"策略把页面自己的资源拦掉"这类事故。
 * 鉴权侧无碍：CSP 之外的入场券是回环免鉴权（PLAN §7-4），本脚本恰好跑在回环上。
 *
 * ## 前置
 * 必须先 `pnpm build`（需要 `backend/dist` 与 `frontend/dist`）；缺失时本脚本**明确失败**，
 * 不静默跳过 —— 静默跳过等于这条防线不存在。
 *
 * 用法：`pnpm smoke:ui`（可选 `--headed` 观察浏览器、`--keep` 保留临时目录）
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND_ENTRY = path.join(ROOT, 'backend', 'dist', 'index.js');
const FRONTEND_DIST = path.join(ROOT, 'frontend', 'dist');
const SHOT_DIR = path.join(ROOT, 'artifacts', 'ui-smoke');

const flags = new Set(process.argv.slice(2));
const HEADED = flags.has('--headed');
const KEEP = flags.has('--keep');

const failures = [];
const note = (message) => console.log(`  · ${message}`);

function assert(condition, message) {
  if (condition) {
    console.log(`✓ ${message}`);
    return true;
  }
  console.log(`✗ ${message}`);
  failures.push(message);
  return false;
}

/** favicon 缺失不影响功能，Chromium 会把它记成一条 404 —— 只放行这一条，其余一律算失败 */
const IGNORED_CONSOLE = [/favicon\.ico/i];

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
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return true;
    } catch {
      /* 未就绪 */
    }
    await sleep(200);
  }
  return false;
}

if (!existsSync(BACKEND_ENTRY) || !existsSync(path.join(FRONTEND_DIST, 'index.html'))) {
  console.error(
    '✗ 缺构建产物：请先执行 `pnpm build`（需要 backend/dist/index.js 与 frontend/dist/index.html）。\n' +
      `  backend/dist/index.js 存在？${existsSync(BACKEND_ENTRY)}\n` +
      `  frontend/dist/index.html 存在？${existsSync(path.join(FRONTEND_DIST, 'index.html'))}`,
  );
  process.exit(1);
}

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-smoke-data-'));
const OUTPUTS_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-smoke-out-'));
const PORT = await freePort();
const baseUrl = `http://127.0.0.1:${PORT}`;

console.log('\n=== AstrmiraVideo 生产形态 UI 冒烟 ===');
console.log(`node ${process.version} · ${process.platform}/${process.arch}`);
console.log(`实例：${baseUrl}（NODE_ENV=production → CSP 生效；回环免鉴权）`);

// 生产形态必须配访问令牌（否则后端拒绝启动）；回环来源免鉴权，浏览器照样能访问接口
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
    PUBLIC_API_TOKEN: 'smoke-loopback-only',
    VOLCANO_API_KEY: '',
  },
  stdio: 'ignore',
});

let browser;
const consoleErrors = [];
const pageErrors = [];
const consoleWarnings = [];

try {
  if (!(await waitForHealth(baseUrl))) throw new Error(`后端未在超时内就绪（${baseUrl}/api/health）`);

  browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    // 关动效：截图可复现，顺带确认 AC5 的 reduced-motion 降级不会把布局弄坏
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
    else if (message.type() === 'warning') consoleWarnings.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const startedAt = Date.now();
  const response = await page.goto(baseUrl, { waitUntil: 'load' });
  console.log(`\n[1] 打开首页：HTTP ${response?.status()} · ${Date.now() - startedAt}ms`);

  assert(response?.status() === 200, '首页返回 200');
  await page.waitForSelector('.wb-shell', { timeout: 10_000 });
  assert(true, 'React 已挂载（.wb-shell 出现）');
  assert(
    (await page.locator('.wb-brand-title').innerText()).includes('AstrmiraVideo'),
    '品牌标题渲染正确',
  );
  const panelCount = await page.locator('.wb-panel').count();
  assert(panelCount === 3, `三栏骨架齐全（.wb-panel × 3，实际 ${panelCount}）`);
  assert(
    await page.locator('.wb-watermark').first().isVisible(),
    '页脚水印渲染（AC5 的视觉收口位）',
  );

  // 字体自托管是否真的生效（2026-09-22 之前外链 Google Fonts，被生产 CSP 拦掉且无人发现）
  const cinzelLoaded = await page.evaluate(async () => {
    const faces = await document.fonts.load('500 12px Cinzel', 'ASTRMIRA');
    return faces.length > 0 && faces.every((face) => face.status === 'loaded');
  });
  assert(cinzelLoaded, 'Cinzel（--serif-caps）自托管加载成功，不依赖外部 CDN');

  console.log('\n[2] 首屏与后端真的通了（同源 /api/providers/status）');
  await page.getByText('服务在线').waitFor({ timeout: 10_000 });
  assert(true, '头部徽章进入「服务在线」（说明 /api 请求成功了：CSP + 鉴权都没拦）');
  assert(
    await page.getByText('等待生成任务下发').isVisible(),
    '中栏空态文案可见（未误报错误态）',
  );

  console.log('\n[3] 交互：打开 BYOK 抽屉');
  await page.getByRole('button', { name: /配置云端凭据/ }).click();
  await page.locator('.wb-drawer-backdrop').waitFor({ timeout: 5_000 });
  assert(true, 'BYOK 抽屉打开（背板出现）');
  const keyInputVisible = await page.locator('input[type="password"]').first().isVisible();
  assert(keyInputVisible, '抽屉内存在凭据输入框');

  mkdirSync(SHOT_DIR, { recursive: true });
  const homeShot = path.join(SHOT_DIR, 'home.png');
  const drawerShot = path.join(SHOT_DIR, 'byok-drawer.png');
  await page.screenshot({ path: drawerShot, fullPage: false });
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.screenshot({ path: homeShot, fullPage: false });
  note(`截图留档（仅 artifact，不参与判定）：${path.relative(ROOT, homeShot)} · ${path.relative(ROOT, drawerShot)}`);

  console.log('\n[4] 控制台卫生');
  const realConsoleErrors = consoleErrors.filter(
    (text) => !IGNORED_CONSOLE.some((pattern) => pattern.test(text)),
  );
  assert(pageErrors.length === 0, `无未捕获异常（pageerror，实际 ${pageErrors.length}）`);
  assert(
    realConsoleErrors.length === 0,
    `控制台零 error（实际 ${realConsoleErrors.length}）`,
  );

  for (const text of realConsoleErrors) note(`console.error: ${text.slice(0, 300)}`);
  for (const text of pageErrors) note(`pageerror: ${text.slice(0, 300)}`);
  if (consoleWarnings.length > 0) {
    note(`（提示）console.warning ${consoleWarnings.length} 条，不参与判定：${consoleWarnings[0]?.slice(0, 160)}`);
  }
} catch (error) {
  failures.push(`冒烟执行异常：${error.message}`);
  console.error(`\n✗ ${error.message}`);
} finally {
  await browser?.close().catch(() => {});
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
    note(`--keep：临时目录保留在 ${DATA_DIR} / ${OUTPUTS_DIR}`);
  }
}

if (failures.length > 0) {
  console.error(`\n✗ UI 冒烟失败（${failures.length} 项）：`);
  for (const item of failures) console.error(`  · ${item}`);
  process.exit(1);
}

console.log('\n✓ UI 冒烟通过：三栏渲染 + 首屏连通 + 抽屉可交互 + 控制台零 error\n');
