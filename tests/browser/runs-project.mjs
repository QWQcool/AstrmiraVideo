#!/usr/bin/env node
/**
 * B97：创作会话列表 / 详情的**业务项目隔离**（真实浏览器）。
 *
 * ## 它证明什么
 * 会话属于业务项目，不属于画布。项目 A→B→A 时：
 * - 列表只显示当前项目的会话；
 * - 详情跟随当前项目（切走后清空），不属于当前项目的详情不显示；
 * - A 的**迟到**列表/详情响应不能覆盖默认项目的界面。
 *
 * ## 受控边界
 * 会话是**真实后端**创建的计划态（planned）夹具：本脚本不 start、不生成，
 * 所以不存在模型调用或算力消耗；只验证 UI 的取数与异步边界。
 *
 * 用法：`node tests/browser/runs-project.mjs [--headed] [--keep]`
 * 前置：`pnpm build`。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BACKEND_ENTRY = path.join(ROOT, 'backend/dist/index.js');
const FRONTEND_DIST = path.join(ROOT, 'frontend/dist');
const flags = new Set(process.argv.slice(2));
const HEADED = flags.has('--headed');
const KEEP = flags.has('--keep');

const failures = [];
function assert(condition, message) {
  if (condition) {
    console.log(`✓ ${message}`);
    return true;
  }
  console.log(`✗ ${message}`);
  failures.push(message);
  return false;
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

async function createProject(baseUrl, name) {
  const response = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error(`建项目失败：HTTP ${response.status}`);
  return (await response.json()).project.projectId;
}

async function createRun(baseUrl, title, projectId, shots) {
  const response = await fetch(`${baseUrl}/api/agent/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title,
      mode: 'unattended',
      provider: 'fixture-local',
      ...(projectId === undefined ? {} : { projectId }),
      steps: Array.from({ length: shots }, (_, index) => ({
        id: `shot-${index + 1}`,
        kind: 'video',
        prompt: `${title} 镜头 ${index + 1}`,
        aspectRatio: '16:9',
        durationSec: 2,
      })),
    }),
  });
  if (!response.ok) throw new Error(`建会话失败：HTTP ${response.status} ${await response.text()}`);
  return (await response.json()).run.id;
}

if (!existsSync(BACKEND_ENTRY) || !existsSync(path.join(FRONTEND_DIST, 'index.html'))) {
  console.error('✗ 缺构建产物：请先执行 `pnpm build`');
  process.exit(1);
}

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-b97-data-'));
const OUTPUTS_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-b97-out-'));
const PORT = await freePort();
const baseUrl = `http://127.0.0.1:${PORT}`;

console.log('\n=== B97：会话列表 / 详情的业务项目隔离 ===');
console.log(`实例：${baseUrl}（会话是 planned 夹具，不 start、不生成）`);

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
    PUBLIC_API_TOKEN: 'b97-loopback-only',
    VOLCANO_API_KEY: '',
    ENABLE_FIXTURE_PROVIDER: '1',
  },
  stdio: 'ignore',
});

/** 响应闸门：key = projectId（列表）或 `run:<id>`（详情） */
const gates = new Map();
function arm(key) {
  gates.set(key, { armed: true, held: false });
}
async function waitHeld(key, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (gates.get(key)?.held === true) return true;
    await sleep(40);
  }
  return false;
}
function release(key) {
  const gate = gates.get(key);
  gate.armed = false;
  gate.release?.();
}

let browser;
try {
  if (!(await waitForHealth(baseUrl))) throw new Error('后端未就绪');

  const projectA = await createProject(baseUrl, 'B97 项目 A');
  const runDefault = await createRun(baseUrl, '默认项目会话', undefined, 2);
  const runA = await createRun(baseUrl, '项目 A 会话', projectA, 2);

  browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  });
  await context.addInitScript(() => {
    window.localStorage.setItem('astrmira.lang', 'zh');
  });
  const page = await context.newPage();

  const postCounts = { generate: 0, runs: 0, start: 0 };
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() !== 'POST') return;
    if (url.pathname === '/api/generate') postCounts.generate += 1;
    if (url.pathname === '/api/agent/runs') postCounts.runs += 1;
    if (/^\/api\/agent\/runs\/[^/]+\/start$/.test(url.pathname)) postCounts.start += 1;
  });

  await page.route(
    (url) => url.pathname === '/api/agent/runs' && url.searchParams.get('project') !== null,
    async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const project = new URL(route.request().url()).searchParams.get('project');
      const gate = gates.get(project);
      if (gate === undefined || gate.armed !== true) return route.continue();
      gate.armed = false;
      const response = await route.fetch();
      const body = await response.text();
      await new Promise((resolve) => {
        gate.held = true;
        gate.release = resolve;
      });
      await route.fulfill({ status: response.status(), headers: response.headers(), body });
    },
  );
  await page.route(
    (url) => /^\/api\/agent\/runs\/[^/]+$/.test(url.pathname),
    async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const id = route.request().url().split('/').pop();
      const gate = gates.get(`run:${id}`);
      if (gate === undefined || gate.armed !== true) return route.continue();
      gate.armed = false;
      const response = await route.fetch();
      const body = await response.text();
      await new Promise((resolve) => {
        gate.held = true;
        gate.release = resolve;
      });
      await route.fulfill({ status: response.status(), headers: response.headers(), body });
    },
  );

  async function listTitles() {
    await page.waitForSelector('[data-testid="runs-list"]', { timeout: 15_000 });
    return page.$$eval('[data-testid="runs-list"] tbody tr td:first-child', (cells) =>
      cells.map((cell) => cell.textContent?.trim() ?? ''),
    );
  }

  async function openRuns() {
    await page.goto(`${baseUrl}/#/runs`, { waitUntil: 'load' });
  }

  await openRuns();
  let titles = await listTitles();
  assert(titles.includes('默认项目会话'), '默认项目列表里有默认会话');
  assert(!titles.includes('项目 A 会话'), '默认项目列表里看不到项目 A 的会话');

  // ── 切到 A：列表与详情跟随 ─────────────────────────────────────────────
  await page.selectOption('select.proj-select', projectA);
  await page.waitForFunction(
    () => document.querySelector('select.proj-select')?.value !== 'default',
    { timeout: 10_000 },
  );
  await page.waitForFunction(() => !document.body.innerText.includes('默认项目会话'), {
    timeout: 15_000,
  });
  titles = await listTitles();
  assert(titles.includes('项目 A 会话'), '切到 A 后列表显示 A 的会话');
  assert(!titles.includes('默认项目会话'), '切到 A 后看不到默认项目的会话');

  await page.click('[data-testid="runs-list"] tbody tr:has-text("项目 A 会话")');
  await page.waitForSelector('[data-testid="runs-detail"]', { timeout: 10_000 });
  assert(
    (await page.textContent('[data-testid="runs-detail"]')).includes('项目 A 会话'),
    '详情显示 A 的会话',
  );

  // ── 切回默认项目：详情必须清空 ─────────────────────────────────────────
  await page.selectOption('select.proj-select', 'default');
  await page.waitForFunction(() => document.querySelector('select.proj-select')?.value === 'default', {
    timeout: 10_000,
  });
  await page.waitForSelector('[data-testid="runs-detail"]', { state: 'detached', timeout: 10_000 });
  assert(true, '切回默认项目后详情关闭（不把 A 的数据带过来）');
  titles = await listTitles();
  assert(titles.includes('默认项目会话') && !titles.includes('项目 A 会话'), '切回后列表回到默认项目');

  // ── 迟到列表响应：A 的慢响应在切回默认项目后到达，不能覆盖 ──────────────
  arm(projectA);
  await page.selectOption('select.proj-select', projectA);
  assert(await waitHeld(projectA), 'A 的列表响应被压住');
  await page.selectOption('select.proj-select', 'default');
  await page.waitForFunction(() => document.querySelector('select.proj-select')?.value === 'default');
  await page.waitForFunction(() => !document.body.innerText.includes('项目 A 会话'), {
    timeout: 15_000,
  });
  release(projectA);
  await sleep(800);
  titles = await listTitles();
  assert(
    titles.includes('默认项目会话') && !titles.includes('项目 A 会话'),
    'A 的迟到列表响应没有覆盖默认项目的列表',
  );

  // ── 迟到详情响应：A 的详情慢响应在切走后到达，不能把详情重新打开 ────────
  await page.selectOption('select.proj-select', projectA);
  await page.waitForFunction(() => document.querySelector('select.proj-select')?.value !== 'default');
  await page.waitForFunction(() => document.body.innerText.includes('项目 A 会话'), {
    timeout: 15_000,
  });
  arm(`run:${runA}`);
  await page.click('[data-testid="runs-list"] tbody tr:has-text("项目 A 会话")');
  assert(await waitHeld(`run:${runA}`), 'A 的详情响应被压住');
  await page.selectOption('select.proj-select', 'default');
  await page.waitForFunction(() => document.querySelector('select.proj-select')?.value === 'default');
  await page.waitForSelector('[data-testid="runs-detail"]', { state: 'detached', timeout: 10_000 });
  release(`run:${runA}`);
  await sleep(800);
  assert(
    (await page.locator('[data-testid="runs-detail"]').count()) === 0,
    'A 的迟到详情响应没有把详情重新打开',
  );

  assert(
    postCounts.generate === 0 && postCounts.runs === 0 && postCounts.start === 0,
    `项目切换全程 0 生成 / 0 建会话 / 0 启动（实际 ${JSON.stringify(postCounts)}）`,
  );
  assert(
    true,
    `夹具会话：默认 ${runDefault.slice(0, 8)} · A ${runA.slice(0, 8)}（均保持 planned，未 start）`,
  );

  console.log('\n结果：' + (failures.length === 0 ? '全部通过' : `${failures.length} 项失败`));
} catch (error) {
  console.error(`\n✗ 脚本异常：${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  failures.push('脚本异常');
} finally {
  await browser?.close();
  child.kill();
  await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    setTimeout(resolve, 5000);
  });
  if (!KEEP) {
    for (const dir of [DATA_DIR, OUTPUTS_DIR]) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        console.log(`（清理临时目录失败，可忽略：${dir}）`);
      }
    }
  } else {
    console.log(`--keep：${DATA_DIR} / ${OUTPUTS_DIR}`);
  }
}

for (const failure of failures) console.log(`  - ${failure}`);
process.exitCode = failures.length === 0 ? 0 : 1;
