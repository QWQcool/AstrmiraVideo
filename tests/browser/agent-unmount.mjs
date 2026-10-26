#!/usr/bin/env node
/**
 * B94 前置收口：画布助手卸载后的**迟到创建响应**回归（真实浏览器）。
 *
 * ## 它证明什么
 * `CanvasStudioView` 用 `key={doc.projectId}` 让助手面板随画布重挂载，但旧组件实例里的
 * `projectIdRef` / `requestVersionRef` 不会因为卸载而改变。若创建会话的响应在卸载后才到达，
 * 旧闭包会**继续调用 `/start`** —— 服务端已经接受的 planned 会话被悄悄启动（消耗算力），
 * 而用户此刻在另一块画布上，看不到任何提示。
 *
 * 因此本脚本用**真的服务器 + 真的浏览器**，只拦截两处 LLM 响应（分镜表 / 展开），
 * 创建会话请求走真实后端并**延迟交付响应**，在挂起期间执行四种失效动作：
 *   ① 切到另一块画布（A→B 卸载）  ② 关闭助手  ③ 切走当前视图  ④ 新会话
 * 每种都断言：`/start` 0 次、URL 不跳走、B 的历史存储键不变、服务端会话仍是 planned。
 * 另有一条正向用例：留在 A 释放响应 → `/start` 恰好 1 次、`startedAt` 落盘。
 *
 * ## 为什么不用纯单测
 * 要证明的是"组件卸载后旧闭包不再生效"，只有真实 React 生命周期能给出这个事实；
 * 存储键隔离的单测证明不了卸载，`requestVersionRef` 的自增也证明不了父组件 key 重挂载。
 *
 * ## 受控边界（如实）
 * 分镜/展开响应是**受控 fixture**，不代表真实模型质量；创建会话是真实 HTTP 请求，
 * 会被后端真的落库（planned）。生成步骤不会执行：本地轨没有真 ComfyUI，`/start` 之后
 * 提交会失败——本脚本只关心"有没有调用 start"，不关心生成结果。
 *
 * 用法：`node tests/browser/agent-unmount.mjs [--headed] [--keep]`
 * 前置：`pnpm build`（需要 backend/dist 与 frontend/dist）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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

const STORYBOARD_PLAN = {
  version: 1,
  title: 'B94 卸载回归夹具',
  aspectRatio: '16:9',
  durationSec: 4,
  shots: [
    {
      index: 1,
      time: '0-2s',
      shotSize: '中景',
      camera: '固定',
      visual: '雨夜街口的橘猫',
      transition: '叠化',
    },
    {
      index: 2,
      time: '2-4s',
      shotSize: '特写',
      camera: '缓推',
      visual: '猫眼反射霓虹',
    },
  ],
  openQuestions: [],
  warnings: [],
};

const EXPANSION = {
  plan: {
    version: 1,
    shots: [
      {
        index: 1,
        title: '镜头 1 · 雨夜街口',
        imagePrompt: '雨夜街口的橘猫，霓虹倒影，16:9',
        videoPrompt: '橘猫在雨夜街口抬头，镜头固定',
        aspectRatio: '16:9',
        resolutionTier: '480p',
        durationSec: 2,
        referenceAssetIds: [],
        warnings: [],
      },
      {
        index: 2,
        title: '镜头 2 · 猫眼特写',
        videoPrompt: '猫眼特写，霓虹在瞳孔里流动',
        aspectRatio: '16:9',
        resolutionTier: '480p',
        durationSec: 2,
        referenceAssetIds: [],
        warnings: [],
      },
    ],
  },
  engine: 'llm',
  model: 'fixture-controlled',
};

const EMPTY_DOC = (projectId, name) => ({
  version: 1,
  projectId,
  name,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [],
  edges: [],
  revision: 1,
});

async function seedCanvas(baseUrl, projectId, name) {
  const response = await fetch(`${baseUrl}/api/canvas/docs/${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-canvas-revision': '1' },
    body: JSON.stringify(EMPTY_DOC(projectId, name)),
  });
  if (!response.ok) throw new Error(`种子画布 ${projectId} 失败：HTTP ${response.status}`);
}

if (!existsSync(BACKEND_ENTRY) || !existsSync(path.join(FRONTEND_DIST, 'index.html'))) {
  console.error('✗ 缺构建产物：请先执行 `pnpm build`（backend/dist/index.js 与 frontend/dist/index.html）');
  process.exit(1);
}

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-b94-data-'));
const OUTPUTS_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-b94-out-'));
const PORT = await freePort();
const baseUrl = `http://127.0.0.1:${PORT}`;

console.log('\n=== B94 前置收口：助手卸载后的迟到创建响应 ===');
console.log(`实例：${baseUrl}（NODE_ENV=production；模型响应受控；创建会话走真实后端）`);

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
    PUBLIC_API_TOKEN: 'b94-loopback-only',
    VOLCANO_API_KEY: '',
    // 让 /status 报告一台"已配置"的本地引擎 —— 会话提交区才会出现可选引擎（不真的连它）
    EXPOSE_HOST_LOCAL_TRACK: '1',
    COMFYUI_BASE_URL: 'http://127.0.0.1:8188',
  },
  stdio: 'ignore',
});

let browser;
const consoleErrors = [];
const pageErrors = [];

try {
  if (!(await waitForHealth(baseUrl))) throw new Error(`后端未就绪（${baseUrl}/api/health）`);
  await seedCanvas(baseUrl, 'canvas-a', '画布 A');
  await seedCanvas(baseUrl, 'canvas-b', '画布 B');

  browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  });
  // 语言固定中文（V2.38 起默认跟随浏览器语言，Playwright 是 en-US）
  await context.addInitScript(() => {
    window.localStorage.setItem('astrmira.lang', 'zh');
    window.localStorage.setItem('astrmira.byokPersist', 'true');
    window.localStorage.setItem(
      'astrmira.byok',
      JSON.stringify({
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        key: '',
        model: 'seedance-2-0-mini-260615',
        llmPreset: 'deepseek',
        llmBaseUrl: 'https://api.deepseek.com/v1',
        llmModel: 'deepseek-chat',
        llmKey: 'b94-controlled-llm-key',
      }),
    );
  });

  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  let storyboardCalls = 0;
  let expandCalls = 0;
  let startCalls = 0;
  /** 当前挂起的创建响应：{ body, release() } */
  let pendingCreate = null;

  // 只拦两处 LLM 响应（受控），其余全部走真实后端
  await page.route(
    (url) => url.pathname === '/api/agent/storyboard',
    async (route) => {
      storyboardCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ plan: STORYBOARD_PLAN, engine: 'llm', model: 'fixture-controlled' }),
      });
    },
  );
  await page.route(
    (url) => url.pathname === '/api/agent/storyboard/expand',
    async (route) => {
      expandCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(EXPANSION),
      });
    },
  );
  // 创建会话：**真的发到后端**（真实落库），但把响应压住直到测试放行
  await page.route(
    (url) => url.pathname === '/api/agent/runs' && url.search === '',
    async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch();
      const body = await response.text();
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      pendingCreate = { body, release };
      await gate;
      await route.fulfill({
        status: response.status(),
        headers: response.headers(),
        body,
      });
    },
  );
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && /^\/api\/agent\/runs\/[^/]+\/start$/.test(url.pathname)) {
      startCalls += 1;
    }
  });

  async function gotoCanvas(projectId) {
    await page.goto(`${baseUrl}/#/canvas?project=${projectId}`, { waitUntil: 'load' });
    // 只有 hash 变化时浏览器不会重载文档 —— 每个场景都要从**全新组件实例**开始
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.cs-canvas', { timeout: 15_000 });
    await page.waitForFunction(() => {
      const select = document.querySelector('select.cs-select');
      return select !== null && select.options.length >= 2;
    });
  }

  /** A 画布：打开助手 → 分镜 → 展开 → 打开会话提交区 → 点提交（创建请求被压住） */
  async function startCreateFromCanvasA(label) {
    await page.click('[data-testid="canvas-agent-toggle"]');
    await page.click('[data-testid="canvas-agent-mode-storyboard"]');
    await page.fill('[data-testid="canvas-agent-input"]', `B94 回归：${label}`);
    await page.click('[data-testid="canvas-agent-send"]');
    await page.waitForSelector('[data-testid="canvas-storyboard"]', { timeout: 15_000 });
    await page.click('[data-testid="canvas-storyboard-expand"]');
    await page.waitForSelector('[data-testid="canvas-storyboard-expansion"]', { timeout: 15_000 });
    await page.click('[data-testid="canvas-storyboard-run-toggle"]');
    await page.waitForSelector('[data-testid="canvas-storyboard-run-submit"]', { timeout: 10_000 });
    const before = startCalls;
    await page.click('[data-testid="canvas-storyboard-run-submit"]');
    // 等创建请求真的到达后端（route.fetch 已完成）——不是等 UI 状态
    const deadline = Date.now() + 15_000;
    while (pendingCreate === null && Date.now() < deadline) await sleep(50);
    if (pendingCreate === null) throw new Error('创建会话请求没有到达（pendingCreate 为空）');
    return { runId: JSON.parse(pendingCreate.body).run.id, startBefore: before };
  }

  async function serverRun(runId) {
    const response = await fetch(`${baseUrl}/api/agent/runs/${runId}`);
    if (!response.ok) throw new Error(`读会话失败：HTTP ${response.status}`);
    return (await response.json()).run;
  }

  async function assertNoStart(runId, startBefore, label) {
    await sleep(700);
    const run = await serverRun(runId);
    assert(startCalls === startBefore, `${label}：旧创建响应没有调用 /start（计数 ${startCalls - startBefore}）`);
    assert(run.state === 'planned', `${label}：服务端会话仍是 planned（实际 ${run.state}）`);
    assert(run.startedAt === undefined, `${label}：startedAt 未落盘`);
  }

  function releaseCreate() {
    const current = pendingCreate;
    pendingCreate = null;
    current.release();
    return current;
  }

  async function historyKey(projectId) {
    return page.evaluate(
      (key) => window.localStorage.getItem(`astrmira.canvasAgentSession.${key}`),
      projectId,
    );
  }

  // ── ① A→B：切换画布卸载旧助手 ───────────────────────────────────────────
  await gotoCanvas('canvas-a');
  let scenario = await startCreateFromCanvasA('A→B');
  await page.selectOption('select.cs-select', 'canvas-b');
  await page.waitForFunction(
    () => document.querySelector('select.cs-select')?.value === 'canvas-b',
    { timeout: 15_000 },
  );
  // 被压住的请求不因 SPA 切画布而中断；放行后旧闭包若仍有效就会 start
  const bHistoryBefore = await historyKey('canvas-b');
  releaseCreate();
  await assertNoStart(scenario.runId, scenario.startBefore, 'A→B');
  assert(page.url().includes('project=canvas-b'), 'A→B：停留在 B 画布，没有被旧响应导航回 A');
  assert(
    (await historyKey('canvas-b')) === bHistoryBefore,
    'A→B：B 的助手历史存储键未被旧请求写入',
  );
  // 面板"是否打开"是父组件状态（跟人走），但 B 的内容必须是 B 自己的
  await page.waitForSelector('[data-testid="canvas-agent-panel"]', { timeout: 10_000 });
  assert(
    (await page.inputValue('[data-testid="canvas-agent-input"]')) === '',
    'A→B：B 的助手输入框为空（未继承 A 的草稿）',
  );

  // ── ② 关闭助手（同一画布内卸载面板）─────────────────────────────────────
  await gotoCanvas('canvas-a');
  scenario = await startCreateFromCanvasA('关闭助手');
  await page.click('[data-testid="canvas-agent-close"]');
  await page.waitForSelector('[data-testid="canvas-agent-panel"]', { state: 'detached' });
  releaseCreate();
  await assertNoStart(scenario.runId, scenario.startBefore, '关闭助手');
  assert(page.url().includes('project=canvas-a'), '关闭助手：URL 未被旧响应改写');

  // ── ③ 切走当前视图（整页视图卸载）───────────────────────────────────────
  await gotoCanvas('canvas-a');
  scenario = await startCreateFromCanvasA('切走视图');
  await page.evaluate(() => {
    window.location.hash = '#/library';
  });
  await page.waitForFunction(() => !window.location.hash.startsWith('#/canvas'));
  releaseCreate();
  await assertNoStart(scenario.runId, scenario.startBefore, '切走视图');

  // ── ④ 新会话（会话代次失效）────────────────────────────────────────────
  await gotoCanvas('canvas-a');
  scenario = await startCreateFromCanvasA('新会话');
  await page.click('[data-testid="canvas-agent-new-session"]');
  releaseCreate();
  await assertNoStart(scenario.runId, scenario.startBefore, '新会话');

  // ── ⑤ 正向：留在 A，创建响应应继续启动且只启动一次 ──────────────────────
  await gotoCanvas('canvas-a');
  scenario = await startCreateFromCanvasA('正向');
  releaseCreate();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="canvas-storyboard-run"]') === null,
    { timeout: 15_000 },
  );
  await sleep(1200);
  const started = await serverRun(scenario.runId);
  assert(startCalls - scenario.startBefore === 1, `正向：/start 恰好 1 次（实际 ${startCalls - scenario.startBefore}）`);
  assert(started.startedAt !== undefined, '正向：startedAt 已落盘（服务端承认开始）');

  // ── ⑥ 既有隔离回归：A→B→A 的历史与输入不串 ──────────────────────────────
  await gotoCanvas('canvas-a');
  await page.evaluate(() => {
    window.localStorage.setItem(
      'astrmira.canvasAgentSession.canvas-a',
      JSON.stringify([{ role: 'user', text: 'A 历史' }]),
    );
    window.localStorage.setItem(
      'astrmira.canvasAgentSession.canvas-b',
      JSON.stringify([{ role: 'user', text: 'B 历史' }]),
    );
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.cs-canvas');
  await page.click('[data-testid="canvas-agent-toggle"]');
  const aLog = await page.textContent('[data-testid="canvas-agent-log"]');
  assert(aLog.includes('A 历史') && !aLog.includes('B 历史'), 'A→B→A：A 只加载 A 的历史');
  await page.fill('[data-testid="canvas-agent-input"]', 'A 的草稿');
  await page.selectOption('select.cs-select', 'canvas-b');
  await page.waitForFunction(() => document.querySelector('select.cs-select')?.value === 'canvas-b');
  await page.waitForSelector('[data-testid="canvas-agent-panel"]', { timeout: 10_000 });
  const bLog = await page.textContent('[data-testid="canvas-agent-log"]');
  const bInput = await page.inputValue('[data-testid="canvas-agent-input"]');
  assert(bLog.includes('B 历史') && !bLog.includes('A 历史'), 'A→B：B 只加载 B 的历史（不显示 A 的消息）');
  assert(bInput === '', 'A→B：B 的输入框为空（不继承 A 的草稿）');
  await page.selectOption('select.cs-select', 'canvas-a');
  await page.waitForFunction(() => document.querySelector('select.cs-select')?.value === 'canvas-a');
  await page.waitForSelector('[data-testid="canvas-agent-panel"]', { timeout: 10_000 });
  const aLogBack = await page.textContent('[data-testid="canvas-agent-log"]');
  assert(aLogBack.includes('A 历史') && !aLogBack.includes('B 历史'), 'B→A：回到 A 仍是 A 的历史');
  assert(
    (await page.inputValue('[data-testid="canvas-agent-input"]')) === '',
    'B→A：A 重挂载后输入框为初始空态（草稿不跨实例回填）',
  );

  console.log(`\n受控调用计数：storyboard=${storyboardCalls} expand=${expandCalls} start=${startCalls}`);
  const unexpectedConsole = consoleErrors.filter((line) => !/favicon\.ico/i.test(line));
  assert(unexpectedConsole.length === 0, `控制台零意外 error（实际 ${unexpectedConsole.length}）`);
  if (unexpectedConsole.length > 0) console.log(unexpectedConsole.join('\n'));
  assert(pageErrors.length === 0, `未捕获异常 0（实际 ${pageErrors.length}）`);
  if (pageErrors.length > 0) console.log(pageErrors.join('\n'));
} catch (error) {
  console.error(`\n✗ 脚本异常：${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  failures.push('脚本异常');
} finally {
  await browser?.close();
  child.kill();
  // 等进程真的退出再清理（Windows 上文件仍被占用时 rm 会 EPERM）
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
    console.log(`--keep：数据目录 ${DATA_DIR} / ${OUTPUTS_DIR}`);
  }
}

console.log(`\n结果：${failures.length === 0 ? '全部通过' : `${failures.length} 项失败`}`);
for (const failure of failures) console.log(`  - ${failure}`);
process.exitCode = failures.length === 0 ? 0 : 1;
