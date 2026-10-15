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
 * 它只钉**语义**上确定的事：
 * 1. 三栏骨架渲染出来了（`.wb-panel` × 3、品牌、页脚水印）；
 * 2. 首屏真的与后端通了（头部徽章从"探测中"变成"服务在线"）；
 * 3. 生成参数控件与主题切换真的联动（时长 / 清晰度 → 目标尺寸；日间 ↔ 星尘）；
 * 4. **参考素材三槽与画廊封面**（V8.3 批次 3-④/⑤）：四种模式入口、按模式出现的槽、
 *    以及"造一条真实任务后封面由 `<img>` 渲染且被浏览器解码成功"
 *    —— 这条是本脚本里唯一需要真数据的一段（夹具 provider，零外网零配额）；
 * 5. **操作日志留痕**（V2.1，CONTRACT §10）：界面上真的提交一条任务后，
 *    日志页里必须能看到它（把"界面动作 → 服务端留痕"整条链钉住），
 *    且日志页自身的轮询**不得**被记进日志（否则功能自我增殖）；
 * 6. **控制台零 error / 零未捕获异常**（这条曾经抓到生产 CSP 与外部字体的冲突）。
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
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const execFileAsync = promisify(execFile);

/** ffprobe 一个文件 / http 地址 → JSON（流与容器信息） */
async function ffprobeJson(target) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-show_streams',
    '-show_format',
    '-of',
    'json',
    target,
  ]);
  return JSON.parse(stdout);
}

/**
 * 取某时刻的一帧，返回亮度标准差：≈0 = 纯色/黑屏，画面越花越大。
 * 用途：证明导出产物里**真的有画面内容**（而不是一个只有头的空容器）。
 */
async function frameLumaStdDev(file, atSec) {
  const { stdout } = await execFileAsync(
    'ffmpeg',
    ['-v', 'error', '-ss', String(atSec), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
  );
  const bytes = stdout;
  if (bytes.length === 0) return 0;
  let sum = 0;
  for (const value of bytes) sum += value;
  const mean = sum / bytes.length;
  let variance = 0;
  for (const value of bytes) variance += (value - mean) ** 2;
  return Math.sqrt(variance / bytes.length);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** 用于按显式路径加载后端依赖（`better-sqlite3` 只在 backend 的 node_modules 里） */
const require = createRequire(import.meta.url);
const BACKEND_ENTRY = path.join(ROOT, 'backend', 'dist', 'index.js');
const FRONTEND_DIST = path.join(ROOT, 'frontend', 'dist');
const SHOT_DIR = path.join(ROOT, 'artifacts', 'ui-smoke');
const CLIPS_DIR = path.join(ROOT, 'tests', 'fixtures', 'clips');

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
    // 夹具 provider：本脚本要**真的造一条任务**才能验到画廊封面（见下面的 [7] 段）。
    // 生产形态下它默认关闭，因此必须显式打开；它零外网、零配额，纯 ffmpeg 合成。
    ENABLE_FIXTURE_PROVIDER: '1',
  },
  stdio: 'ignore',
});

/**
 * 用夹具 provider 造一条**真实**的成功任务（HTTP 级，与浏览器无关）。
 *
 * 为什么需要：画廊封面（V8.3 批次 3-④）只有"画廊里真有卡片"时才可见 ——
 * 空画廊下按钮、骨架都能验，唯独新的 `<img>` 封面路径验不到。
 */
async function seedFixtureTask(base) {
  const clips = existsSync(CLIPS_DIR)
    ? readdirSync(CLIPS_DIR).filter((name) => name.endsWith('.mp4'))
    : [];
  if (clips.length === 0) {
    throw new Error(
      `夹具片段目录为空：${CLIPS_DIR}\n  先执行 \`node scripts/make-fixture-clips.mjs\`（CI 中由工作流的同名步骤负责）。`,
    );
  }

  const submit = await fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: '冒烟：雨夜街头，霓虹倒影（夹具 provider 合成，零外网）',
      mode: 't2v',
      aspectRatio: '16:9',
      provider: 'fixture-local',
      params: { durationSec: 2 },
    }),
  });
  if (!submit.ok) throw new Error(`造任务失败：HTTP ${submit.status} ${await submit.text()}`);

  const { taskId } = await submit.json();
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${base}/api/tasks/${taskId}`);
    const progress = await response.json();
    if (progress.status === 'succeeded') return progress;
    if (['failed', 'cancelled'].includes(progress.status)) {
      throw new Error(`夹具任务未成功：${JSON.stringify(progress.error ?? progress)}`);
    }
    await sleep(300);
  }
  throw new Error(`夹具任务未在 60s 内结束（taskId=${taskId}）`);
}

let browser;
const consoleErrors = [];
const pageErrors = [];
const consoleWarnings = [];

try {
  if (!(await waitForHealth(baseUrl))) throw new Error(`后端未在超时内就绪（${baseUrl}/api/health）`);

  // 浏览器渠道：默认 Playwright 自带的 Chromium；CI 传 `SMOKE_CHANNEL=chrome` 用 **Chrome for Testing**。
  //
  // 为什么需要这个开关（2026-09-24 起 CI 一直红在 [6f] 的根因）：浏览器端导出依赖 WebCodecs 的
  // **H.264 编码**，而开源 Chromium 构建**不含**专有编解码器（Linux 上实测：导出永远不出结果）。
  // 真实用户用的是 Chrome / Edge（含编解码器），所以 CI 用 Chrome 跑才是"对着真实环境验"。
  const BROWSER_CHANNEL = process.env.SMOKE_CHANNEL?.trim();
  browser = await chromium.launch({
    headless: !HEADED,
    ...(BROWSER_CHANNEL === undefined || BROWSER_CHANNEL === ''
      ? {}
      : { channel: BROWSER_CHANNEL }),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    // 关动效：截图可复现，顺带确认 AC5 的 reduced-motion 降级不会把布局弄坏
    reducedMotion: 'reduce',
    // 固定系统主题偏好为 dark：主题默认是"跟随系统"，不固定的话截图会随 runner 的环境漂移。
    // 顺带把"跟随系统"这条路径也验了——系统是暗色时不应打 data-theme（暗色是 :root 默认值）。
    colorScheme: 'dark',
  });
  const page = await context.newPage();

  /**
   * **预期内的 429 窗口**（V2.26 / 台账 A5 片 A）。
   *
   * 编排段的第一次提交会照常受防线 5 的 60s 冷却约束，撞上时界面把它当正常错误展示
   * （"请在 Xs 后重试"），冒烟按提示等待重试 —— 浏览器会对那条 429 打 console.error。
   * 它是**被断言覆盖的预期行为**，不是缺陷；但只在编排段那个窗口里豁免
   * （其它任何时刻出现 429 仍然会红 —— 不留"全局宽恕"的口子）。
   */
  let allowExpected429 = false;
  /**
   * **预期内的运行期错误窗口**（V2.29 / 台账 B61 片 B）。
   *
   * [7f] 段要验的正是"未被捕获的错误会不会变成一条提示条" —— 所以它必须**真的抛一个错**。
   * 那个错同时会出现在 pageerror 与 console.error 里，而 [8] 段要求两者都为 0。
   * 这里的做法不是"宽恕"，是**收走并计数**：命中的条目进 `expectedRuntimeErrors`，
   * 段内再用断言核对条数（抛了几次就该收几条）。它只在 [7f] 段开着 ——
   * 窗口外的任何异常、以及窗口内**不匹配**的异常，都照样会红。
   */
  let runtimeErrorWindow = false;
  const expectedRuntimeErrors = [];
  /**
   * 被兜底层**筛掉的浏览器良性噪声**（`ResizeObserver loop …` 之类）。
   *
   * 它不是缺陷（浏览器自己的通知丢失，对功能无害），但兜底层仍会**留一条控制台记录** ——
   * 所以这里既不放它去污染"控制台零 error"，也不把它藏起来：单独收走并在 [8] 段**如实报数**。
   * 这是 2026-10-13 上线当天就撞到的真实情况（见 PLAN §5 的「B61 · 片 B」）。
   */
  const runtimeNoise = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const text = message.text();
      if (allowExpected429 && /429 \(Too Many Requests\)/.test(text)) return;
      if (text.includes('[运行期噪声·已忽略，不提示]')) {
        runtimeNoise.push(text);
        return;
      }
      if (runtimeErrorWindow && text.includes('[运行期错误]')) {
        expectedRuntimeErrors.push(`console: ${text}`);
        return;
      }
      consoleErrors.push(text);
    } else if (message.type() === 'warning') {
      consoleWarnings.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    /**
     * **浏览器良性噪声**：与前端 `BENIGN_RUNTIME_NOISE` 同一口径（产品不会为它提示用户，
     * 冒烟也就不该因它失败）—— 但它**仍被如实报数**（`runtimeNoise`），不藏起来。
     *
     * 注意这条不放在 `runtimeErrorWindow` 里：浏览器自身的 `ResizeObserver loop` 通知丢失
     * **不产生 pageerror**（实测），会产生 pageerror 的是"[7f] 段里主动抛出的一句话"——
     * 两者都该按噪声处理，所以这里只看消息。
     */
    if (/ResizeObserver loop/.test(error.message)) {
      runtimeNoise.push(`pageerror: ${error.message}`);
      return;
    }
    // 同时认两种：同步抛错（smoke-runtime-error）与未处理的 Promise 拒绝（…-rejection，
    // Playwright 在 Chromium 下会把它报成 "Uncaught (in promise) …" 的 pageerror）
    if (runtimeErrorWindow && /smoke-runtime-(error|rejection)/.test(error.message)) {
      expectedRuntimeErrors.push(`pageerror: ${error.message}`);
      return;
    }
    pageErrors.push(error.message);
  });

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
  // 默认落地（V2.7 / B41 / D39）：无 hash 打开时落到 #/create（one-for-all 创作入口）。
  // 三栏骨架与页脚水印住在工作台里，随后切过去检查（工作台是 keepalive 常驻视图，切换不卸载）。
  assert(page.url().includes('#/create'), `默认落地到创作入口 #/create（实际 ${page.url()}）`);
  await page.evaluate(() => { location.hash = '#/workbench'; });
  await page.waitForSelector('.wb-panel', { timeout: 10_000 });
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

  console.log('\n[1b] 应用壳（V9 · B2：侧栏 + 自写 hash 路由 + 数据化视图注册表）');
  // 默认视图 = #/create（已在 [1] 断言）；此处从工作台开始检查壳本身，且工作台/创作都默认收起侧栏
  assert(page.url().includes('#/workbench'), `已切到工作台（实际 ${page.url()}）`);
  assert(await page.locator('.sidebar').isVisible(), '侧栏渲染出来了');
  const bootRail = await page.locator('.sidebar').getAttribute('data-rail');
  assert(bootRail === '1', `工作台默认收起侧栏（data-rail=${bootRail}，期望 1）`);
  assert(
    (await page.locator('.sidebar .nav-item').count()) === 8,
    `侧栏有八个一级视图入口（创作/工作台/总览/视频库/画布/成本台账/配方库/日志；剪辑台不进侧栏；实际 ${await page.locator('.sidebar .nav-item').count()}）`,
  );

  // 八个一级视图可切换，且侧栏 aria-current 跟随（剪辑台是 hidden 视图，单独验）
  for (const hash of ['#/create', '#/overview', '#/library', '#/canvas', '#/costs', '#/recipes', '#/logs', '#/workbench']) {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForFunction(
      (h) => document.querySelector('.nav-item[aria-current="page"]')?.getAttribute('href') === h,
      hash,
      { timeout: 5_000 },
    );
  }
  assert(true, '八个一级视图可切换，侧栏 aria-current 跟随');

  // 前进后退可用（hash 变化产生历史条目）
  await page.evaluate(() => { location.hash = '#/overview'; });
  await sleep(150);
  await page.evaluate(() => { location.hash = '#/library'; });
  await sleep(150);
  await page.goBack();
  await page.waitForFunction(() => location.hash === '#/overview', { timeout: 5_000 });
  assert(true, '浏览器后退可用（#/library → #/overview）');
  await page.goForward();
  await page.waitForFunction(() => location.hash === '#/library', { timeout: 5_000 });
  assert(true, '浏览器前进可用（#/overview → #/library）');

  // 刷新保持当前视图
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.wb-shell', { timeout: 10_000 });
  assert(page.url().includes('#/library'), `刷新后保持当前视图（期望 #/library，实际 ${page.url()}）`);

  // 剪辑台（hidden 视图）可直达；无 task 时是空态引导
  await page.evaluate(() => { location.hash = '#/edit'; });
  await page.waitForSelector('.wb-placeholder', { timeout: 5_000 });
  assert(true, '剪辑台 #/edit 可直达（无源片时空态引导；不进侧栏）');

  // 未知 hash 落兜底（不白屏、不静默重定向）—— 这也是 B2 破坏性验证的固化
  await page.evaluate(() => { location.hash = '#/definitely-not-a-view'; });
  await page.waitForSelector('.wb-unknown', { timeout: 5_000 });
  assert(await page.getByText('这个视图不存在').isVisible(), '未知 hash 落到兜底页（不白屏）');
  await page.getByRole('button', { name: '回到首页' }).click();
  // 兜底页按钮走 DEFAULT_VIEW = #/create（D39）；随后的检查都在工作台，先切过去
  await page.waitForFunction(() => location.hash === '#/create', { timeout: 5_000 });
  await page.waitForSelector('.cr-panel', { timeout: 5_000 });
  assert(page.url().includes('#/create'), '兜底页可回到首页（DEFAULT_VIEW = #/create）');
  await page.evaluate(() => { location.hash = '#/workbench'; });
  await page.waitForSelector('.wb-main', { timeout: 5_000 });

  console.log('\n[1c] 项目切换器（V2.11 / 台账 B47：单库内多项目）');
  await page.waitForSelector('.proj-switch .proj-select', { timeout: 10_000 });
  assert(true, '顶栏渲染项目切换器（"我在哪个项目里"在第一屏被回答）');

  const defaultLabel = await page.evaluate(
    () => document.querySelector('.proj-select option[value="default"]')?.textContent ?? '',
  );
  assert(
    defaultLabel.includes('默认项目') && defaultLabel.includes('默认'),
    `默认项目在列表里并标注「默认」（实际「${defaultLabel}」）`,
  );

  // 默认项目不可删：按钮置灰 **且写明原因**（灰而无提示等于没解释）
  await page.locator('.proj-manage').click();
  await page.waitForSelector('.proj-pop', { timeout: 5_000 });
  assert(
    await page.getByRole('button', { name: '删除当前项目' }).isDisabled(),
    '默认项目的「删除当前项目」置灰（与后端同一套护栏）',
  );
  assert(
    (await page.locator('.proj-pop').innerText()).includes('默认项目不可删'),
    '置灰同时给出原因（默认项目是老数据与未指定项目的落点）',
  );

  // 新建 → 自动切过去（用户的意图就是"到新项目里干活"）
  await page.locator('.proj-pop input[placeholder^="新项目名"]').fill('冒烟项目');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.proj-select')?.value !== 'default',
    null,
    { timeout: 10_000 },
  );
  const smokeProjectId = await page.locator('.proj-select').inputValue();
  assert(
    /^[0-9a-f-]{36}$/.test(smokeProjectId),
    `新建后立即切到新项目（id=${smokeProjectId.slice(0, 8)}…）`,
  );
  const newLabel = await page.evaluate(
    (id) => document.querySelector(`.proj-select option[value="${id}"]`)?.textContent ?? '',
    smokeProjectId,
  );
  assert(newLabel.includes('冒烟项目'), `下拉显示新项目名（实际「${newLabel}」）`);

  // 刷新后仍停在新项目：记忆 + 清单收敛（缺了任一半都会掉回默认项目）
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(
    (id) => document.querySelector('.proj-select')?.value === id,
    smokeProjectId,
    { timeout: 10_000 },
  );
  assert(
    (await page.evaluate(() => localStorage.getItem('astrmira.activeProjectId'))) === smokeProjectId,
    '刷新后当前项目保持（记忆的 id 在清单里真实存在 → 不被收敛回默认项目）',
  );

  // 隔离（真实 API，同源同路由）：新项目是干净的，默认项目不受影响
  const isolation = await page.evaluate(async (id) => {
    const [newTasks, defaultTasks, newAssets, defaultAssets] = await Promise.all([
      (await fetch(`/api/history?project=${id}`)).json(),
      (await fetch('/api/history')).json(),
      (await fetch(`/api/assets?project=${id}`)).json(),
      (await fetch('/api/assets')).json(),
    ]);
    return {
      newTasks: newTasks.items.length,
      defaultTasks: defaultTasks.items.length,
      newAssets: newAssets.assets.length,
      defaultAssets: defaultAssets.assets.length,
    };
  }, smokeProjectId);
  assert(
    isolation.newTasks === 0 && isolation.newAssets === 0,
    `新项目是干净的（${isolation.newTasks} 片 / ${isolation.newAssets} 素材）`,
  );
  assert(
    isolation.defaultTasks >= 0 && isolation.defaultAssets >= 0,
    `默认项目仍可独立枚举（${isolation.defaultTasks} 片 / ${isolation.defaultAssets} 素材）——「省略 = 默认项目」`,
  );

  // 删除（两步确认，不用原生对话框）：删空项目成功 → 当前项目回到默认项目
  await page.locator('.proj-manage').click();
  await page.waitForSelector('.proj-pop', { timeout: 5_000 });
  assert(
    await page.getByRole('button', { name: '删除当前项目' }).isEnabled(),
    '空项目的「删除当前项目」可用（只有空项目可删）',
  );
  await page.getByRole('button', { name: '删除当前项目' }).click();
  await page.getByRole('button', { name: '确认删除' }).click();
  await page.waitForFunction(
    () => document.querySelector('.proj-select')?.value === 'default',
    null,
    { timeout: 10_000 },
  );
  assert(true, '删除空项目成功并**自动切回默认项目**（界面不会停在一个不存在的项目上）');
  assert(
    (await page.evaluate(() => localStorage.getItem('astrmira.activeProjectId'))) === 'default',
    '删除后记忆同步回落默认项目',
  );
  const gone = await page.evaluate(
    (id) => document.querySelector(`.proj-select option[value="${id}"]`) === null,
    smokeProjectId,
  );
  assert(gone, '被删项目从下拉里消失');
  await page.locator('.proj-pop-close').click();

  // 回到工作台（后续 [2] 起的检查按原假设从工作台开始）
  await page.evaluate(() => { location.hash = '#/workbench'; });
  await page.waitForSelector('.wb-main', { timeout: 5_000 });

  console.log('\n[1d] 成本台账（V2.12 / 台账 B48：结构 + 口径说明）');
  await page.evaluate(() => { location.hash = '#/costs'; });
  await page.waitForSelector('.cost-controls', { timeout: 10_000 });
  assert(true, '成本台账可直达（#/costs，侧栏第八项）');

  const kpiLabels = await page.evaluate(() =>
    [...document.querySelectorAll('.ov-kpi .ov-kpi-label')].map((el) => el.textContent ?? ''),
  );
  assert(
    kpiLabels.length === 4 && kpiLabels.includes('未结算') && kpiLabels.includes('结果不明'),
    `四张卡齐全且把"未结算 / 结果不明"摆在明面上（${kpiLabels.join(' / ')}）`,
  );

  assert(
    (await page.locator('.cost-controls .wb-segment').count()) >= 6,
    `两个分段控件（统计范围 2 项 + 区间 4 项）可点（实际 ${await page.locator('.cost-controls .wb-segment').count()} 个按钮）`,
  );
  // ⚠️ 必须限定在 `.cost-controls` 内：工作台/创作是 keepalive 常驻视图，
  // 它们的 `.wb-segment` 仍在 DOM 里（隐藏），全局查询会先命中隐藏副本（V8.7 的教训）
  const scopePressed = await page.evaluate(
    () =>
      document
        .querySelectorAll('.cost-controls .wb-segmented')[0]
        ?.querySelector('.wb-segment[aria-pressed="true"]')?.textContent ?? '',
  );
  assert(
    scopePressed.includes('当前项目'),
    `默认统计范围 = 当前项目（与全站"我在哪个项目里"同一心智模型；实际「${scopePressed}」）`,
  );

  // 口径说明**由服务端下发**（界面不自己写一版）—— 这句话是功能的正确性边界
  const disclaimer = await page.locator('.cost-disclaimer').innerText();
  assert(
    disclaimer.includes('以火山方舟控制台账单为准') && disclaimer.includes('预估'),
    `页面显示服务端下发的口径说明（「${disclaimer.slice(0, 24)}…」）`,
  );

  // 三个分桶面板（按项目 / 按天 / 按模型）都在
  const bucketHeads = await page.evaluate(() =>
    [...document.querySelectorAll('.cost-panel .wb-eyebrow')].map((el) => el.textContent ?? ''),
  );
  assert(
    bucketHeads.length === 3,
    `按项目 / 按天 / 按模型三个分桶面板齐全（${bucketHeads.join(' / ')}）`,
  );

  // 切到"全部项目"（成本视图独有的跨项目档）
  await page.locator('.cost-controls').getByRole('button', { name: '全部项目' }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelectorAll('.cost-controls .wb-segmented')[0]
        ?.querySelector('.wb-segment[aria-pressed="true"]')?.textContent === '全部项目',
    null,
    { timeout: 5_000 },
  );
  assert(true, '可切到「全部项目」档（跨项目汇总 —— 这台机器一共花了多少）');

  // 回到工作台（[2] 起的检查都假设当前在工作台 —— 与 [1c] 末尾同一纪律）
  await page.evaluate(() => { location.hash = '#/workbench'; });
  await page.waitForSelector('.wb-main', { timeout: 5_000 });

  console.log('\n[1e] 可观测（V2.16 / 台账 B53：live / ready / metrics 三端点分工）');
  const liveRes = await fetch(`${baseUrl}/api/health/live`);
  const live = await liveRes.json();
  assert(
    liveRes.ok && live.status === 'ok' && live.uptimeSec >= 0,
    `存活探针秒回且带 uptime（uptimeSec=${live.uptimeSec}）`,
  );

  const readyRes = await fetch(`${baseUrl}/api/health/ready`);
  const ready = await readyRes.json();
  assert(
    readyRes.status === 200 && ready.status === 'ready',
    `就绪探针 200 ready（${ready.checks.length} 项检查）`,
  );
  const readyIds = ready.checks.map((item) => item.id);
  assert(
    readyIds.includes('database') && readyIds.includes('storage.writable'),
    `就绪检查含数据库可读与输出目录可写（${readyIds.join(' / ')}）`,
  );
  assert(
    ready.checks.every((item) => typeof item.required === 'boolean'),
    '每项检查都标了 required（决定"失败是否该停止导流"）',
  );

  const metricsRes = await fetch(`${baseUrl}/api/metrics`);
  const metrics = await metricsRes.json();
  assert(
    metricsRes.ok &&
      typeof metrics.tasks.byStatus.succeeded === 'number' &&
      Array.isArray(metrics.alerts),
    `指标快照可读（任务 ${metrics.tasks.byStatus.succeeded + metrics.tasks.byStatus.failed} 条终态 · 告警 ${metrics.alerts.length} 条）`,
  );
  assert(
    metrics.thresholds.storageWarnRatio > 0 && metrics.storage.maxBytes > 0,
    `快照回显生效阈值与容量上限（storageWarnRatio=${metrics.thresholds.storageWarnRatio} · maxBytes=${metrics.storage.maxBytes}）`,
  );
  assert(
    metrics.alerts.every((alert) => alert.value !== null && alert.threshold !== null),
    '每条告警都带可复核的 value / threshold',
  );

  // 探针不该拖慢：live 端点必须在极短时间内回（它零依赖，是"进程活着"的唯一判据）
  const liveStart = Date.now();
  await fetch(`${baseUrl}/api/health/live`);
  const liveMs = Date.now() - liveStart;
  assert(liveMs < 1000, `存活探针足够快（${liveMs}ms < 1000ms，零依赖）`);

  console.log('\n[1f] 运维 CLI（V2.17 / 台账 B52 片 A：备份 / 校验 / 恢复的安全闸门）');
  // 用**正在运行的服务**的数据目录跑真 CLI（backend/dist/ops/cli.js）：
  // 这正是要验证的两条语义 —— 备份允许在服务运行时做，恢复**必须**在服务停止后做。
  // 自己开一个临时目录（不要借 [6f] 的 EXPORT_DIR —— 那时还没定义，会踩 TDZ）
  const opsDir = mkdtempSync(path.join(tmpdir(), 'astrmira-smoke-ops-'));
  const opsCli = path.join(ROOT, 'backend', 'dist', 'ops', 'cli.js');
  const opsEnv = { ...process.env, DATA_DIR, OUTPUT_DIR: OUTPUTS_DIR };
  const runOps = (args) => {
    try {
      const stdout = execFileSync(process.execPath, [opsCli, ...args], {
        cwd: ROOT,
        env: opsEnv,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { code: 0, output: stdout };
    } catch (error) {
      return {
        code: typeof error.status === 'number' ? error.status : 1,
        output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
      };
    }
  };

  const backupRun = runOps(['backup', '--out', opsDir, '--no-outputs']);
  assert(backupRun.code === 0, `服务运行时可以备份（输出目录：${path.basename(opsDir)}）`);
  assert(
    existsSync(path.join(opsDir, 'manifest.json')),
    '备份产出 manifest.json（"这一份是完整的"的标记）',
  );

  const verifyRun = runOps(['verify', opsDir]);
  assert(
    verifyRun.code === 0 && verifyRun.output.includes('校验通过'),
    '校验通过（sha256 与逐文件字节数都对得上）',
  );

  // ⭐ 安全闸门：服务还在跑 → 恢复必须被拒绝（半途被写会得到一个坏库）
  const guardedRestore = runOps(['restore', opsDir, '--yes']);
  assert(
    guardedRestore.code !== 0 && guardedRestore.output.includes('服务还在跑'),
    `服务运行时恢复被拒绝（exit=${guardedRestore.code}｜${guardedRestore.output.trim().slice(0, 160)}）`,
  );
  assert(
    runOps(['restore', opsDir]).output.includes('--yes'),
    '缺少 --yes 时拒绝恢复（不可逆动作要显式确认）',
  );

  // 快照被改坏 → 校验必须失败（否则"备份能不能用"只能等真要恢复那天才知道）
  writeFileSync(
    path.join(opsDir, 'app.db'),
    Buffer.concat([readFileSync(path.join(opsDir, 'app.db')), Buffer.from('tampered')]),
  );
  const tamperedVerify = runOps(['verify', opsDir]);
  assert(
    tamperedVerify.code !== 0 && tamperedVerify.output.includes('✗'),
    '快照被改坏后校验失败（不通过就不许恢复）',
  );
  rmSync(opsDir, { recursive: true, force: true });

  console.log('\n[2] 首屏与后端真的通了（同源 /api/providers/status）');
  await page.getByText('服务在线').waitFor({ timeout: 10_000 });
  assert(true, '头部徽章进入「服务在线」（说明 /api 请求成功了：CSP + 鉴权都没拦）');
  assert(
    await page.getByText('等待生成任务下发').isVisible(),
    '中栏空态文案可见（未误报错误态）',
  );

  console.log('\n[3] 交互：BYOK 抽屉（V2.0 起含文本轨）与 ✨ 扩写门控');
  // 扩写是纯 BYOK：没填文本 Key 时按钮置灰，**并且同一屏内写明原因与去何处配置**
  // （"只置灰不解释"和"点了才说不能用"是一样的糟糕）
  const enhanceButton = page.getByRole('button', { name: /扩写/ });
  assert(await enhanceButton.isDisabled(), '未填文本 Key 时 ✨ 扩写按钮置灰');
  assert(
    (await page.getByText('未配置扩写模型').count()) > 0,
    '置灰的同时给出原因与配置入口（不是死胡同）',
  );

  await page.getByRole('button', { name: /凭据设置（BYOK）/ }).click();
  await page.locator('.wb-drawer-backdrop').waitFor({ timeout: 5_000 });
  assert(true, 'BYOK 抽屉打开（背板出现）');
  const keyInputVisible = await page.locator('input[type="password"]').first().isVisible();
  assert(keyInputVisible, '抽屉内存在凭据输入框');
  assert(
    (await page.locator('.wb-drawer input[type="password"]').count()) === 2,
    '抽屉里有**两段**凭据输入（视频轨 + 文本轨，两把 Key 相互独立）',
  );
  // V2.1 起抽屉里有**两个**下拉：视频轨模型档位（VIDEO_MODEL_PRESETS）+ 文本轨预设（LLM_PRESETS）
  assert(
    (await page.locator('.wb-drawer select.wb-input').count()) === 2,
    '抽屉里有两个下拉：视频模型档位 + 文本轨预设（清单都来自 packages/shared，前端不写第二份）',
  );

  mkdirSync(SHOT_DIR, { recursive: true });
  const homeShot = path.join(SHOT_DIR, 'home.png');
  const drawerShot = path.join(SHOT_DIR, 'byok-drawer.png');
  await page.screenshot({ path: drawerShot, fullPage: false });
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.screenshot({ path: homeShot, fullPage: false });
  note(`截图留档（仅 artifact，不参与判定）：${path.relative(ROOT, homeShot)} · ${path.relative(ROOT, drawerShot)}`);

  console.log('\n[4] 生成参数控件（V8.3 批次 1：时长 / 清晰度 → 目标尺寸联动）');
  // V2.31（A1 片 C / D53）：执行引擎多了一档「本地 ComfyUI」（用户自备引擎与模型）。
  // 只断言"入口在"，不断言可用性 —— 可用性由服务端 env 决定（冒烟起的服务没配它，那才是默认态）。
  assert(
    (await page.locator('.wb-segment:visible', { hasText: '本地 ComfyUI' }).count()) >= 1,
    '执行引擎里有「本地 ComfyUI」档（自备引擎与模型；能否跑由提交时判定）',
  );
  // V2.37（D56）：H3 那一档**已撤掉** —— 这里验的是"界面上真的没有了"。
  // 撤掉的正是一个"点了才知道不行"的按钮，所以这条断言就是那次决策的验收点。
  assert(
    (await page.locator('.wb-segment:visible', { hasText: '本地 MiniMax H3' }).count()) === 0,
    '执行引擎里**不再有**「本地 MiniMax H3」那一档（V2.37 / D56）',
  );

  // V2.34（台账 B4 / CONTRACT §20）：本地引擎**运行时自检** —— 真点一次，看它是否如实回答。
  // ⚠️ 冒烟起的服务**没有配**本地引擎，所以这里的**正确**结果是"两档都如实说不可用"。
  // 把它当成"能用"才是这个按钮最糟的失败方式（假绿比没有更坏）——
  // 所以断言盯的是"有没有说清缺哪个 env"，而不是"有没有 ✓"。
  // 限定 `:visible` —— 视图是 keepalive 常驻的，隐藏副本里也会有同一 testid（B41 起的老坑）
  const selfCheckButton = page.locator('[data-testid=wb-selfcheck]:visible').first();
  await selfCheckButton.click();
  const selfCheckResult = page.locator('[data-testid=wb-selfcheck-result]:visible').first();
  await selfCheckResult.waitFor({ state: 'visible', timeout: 15_000 });
  const selfCheckText = (await selfCheckResult.textContent()) ?? '';
  assert(
    selfCheckText.includes('本地 ComfyUI'),
    `自检列出本地档（${selfCheckText.slice(0, 60)}…）`,
  );
  assert(
    !selfCheckText.includes('MiniMax H3'),
    'V2.37（D56）：**撤掉的 H3 档不再出现在自检结果里**（它已经不是"没配"，而是"没有了"）',
  );
  assert(
    selfCheckText.includes('EXPOSE_HOST_LOCAL_TRACK'),
    '未配置时自检说清**缺哪个 env**（而不是一句"不可用"让人无从下手）',
  );
  assert(
    !selfCheckText.includes('✓'),
    '未配置时不会出现绿勾（自检不许假绿）',
  );
  // 限定 :visible —— 创作入口是 keepalive 常驻视图，隐藏副本里也有 .wb-segment（B41 起）
  const durationButtons = page.locator('.wb-segment:visible', { hasText: /^\d+s$/ });
  assert((await durationButtons.count()) >= 3, `时长选项 ≥ 3 个（实际 ${await durationButtons.count()}）`);
  assert(
    (await page.locator('.wb-segment:visible[aria-pressed="true"]', { hasText: /^\d+s$/ }).count()) === 1,
    '时长默认选中恰好一个选项',
  );

  // 清晰度切到 1080p：顶部与左栏的目标尺寸必须跟着变（这是"参数真的接进请求"的最直观证据）
  await page.getByRole('button', { name: '1080p', exact: true }).click();
  await page.getByText('1920×1056 · 32 倍数对齐').waitFor({ timeout: 5_000 });
  assert(true, '切到 1080p 后目标尺寸变为 1920×1056（与画幅 16:9 相乘，仍为 32 倍数）');
  assert(
    await page.getByText('渲染为 1920×1056').isVisible(),
    '左栏「画幅」旁的目标尺寸同步更新',
  );

  await page.getByRole('button', { name: '10s', exact: true }).click();
  assert(
    (await page.locator('.wb-segment:visible[aria-pressed="true"]', { hasText: '10s' }).count()) === 1,
    '时长可以切到 10s 且选中态正确',
  );

  console.log('\n[5] 主题（V8.3 批次 2：默认跟随系统 + 可覆盖，日间为"现代简洁·蔚蓝"）');
  const themeAttr = () =>
    page.evaluate(() => document.documentElement.getAttribute('data-theme'));

  // V9：主题分段控件移到了侧栏底部；工作台默认收起侧栏（分段在收起态隐藏）→ 先展开
  await page.getByRole('button', { name: '展开侧栏' }).click();
  await page.locator('.sidebar[data-rail="0"]').waitFor({ timeout: 5_000 });

  assert((await themeAttr()) === null, '默认（跟随系统）下不打 data-theme —— 暗色是 :root 默认值');

  await page.getByRole('button', { name: '日间', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'day', {
    timeout: 5_000,
  });
  assert(true, '切到日间后 <html data-theme="day"> 生效');

  // 颜色真的换了（不是只打了个属性）：检查落地后的计算样式。
  // ⚠️ 必须**轮询等待**：切换瞬间读到的还是过渡的起始帧（即使 reduced-motion 把过渡压到 0.01ms，
  // 仍要等一帧），直接断言会拿到旧颜色 —— 这个坑实测踩过一次。
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('.wb-shell')).backgroundColor ===
      'rgb(244, 247, 251)',
    { timeout: 5_000 },
  );
  assert(true, '日间底色生效（.wb-shell 计算样式 = rgb(244,247,251)，等过渡完成后读）');

  // 放映区在**两套主题下都是深色**，所以区内的文字必须用 `--canvas-*` 那一组。
  // 2026-09-23 用户在日间模式截图报障："放映区里的提示文字看不见"——
  // 那时区内的 `.wb-note` 取的是 `--faint`（日间=深灰），落在深色放映底上直接消失。
  // 这里按 WCAG 公式**实测计算样式**（不是查 token 表），把这类缺陷钉死在浏览器里。
  const stageContrast = await page.evaluate(() => {
    const toRgb = (value) => value.match(/\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
    const luminance = ([r, g, b]) => {
      const channel = (v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };

    const viewport = document.querySelector('.wb-viewport');
    const note = document.querySelector('.wb-viewport .wb-note');
    if (viewport === null || note === null) return null;

    const background = toRgb(getComputedStyle(viewport).backgroundColor);
    const foreground = toRgb(getComputedStyle(note).color);
    const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return {
      ratio: (light + 0.05) / (dark + 0.05),
      foreground: getComputedStyle(note).color,
      background: getComputedStyle(viewport).backgroundColor,
    };
  });

  assert(
    stageContrast !== null && stageContrast.ratio >= 4.5,
    `日间模式下放映区文字可读（对比度 ${stageContrast === null ? '读取失败' : stageContrast.ratio.toFixed(2)}:1 ≥ 4.5，${stageContrast?.foreground ?? ''} on ${stageContrast?.background ?? ''}）`,
  );
  assert(
    (await page.evaluate(() => window.localStorage.getItem('astrmira.themePref'))) === 'day',
    '主题偏好已持久化到 localStorage',
  );

  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, 'day.png'), fullPage: false });
  note(`日间截图留档：${path.relative(ROOT, path.join(SHOT_DIR, 'day.png'))}`);

  await page.getByRole('button', { name: '星尘', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === null, {
    timeout: 5_000,
  });
  assert(true, '切回星尘后属性被移除（不会留下一个永假的选择器）');

  console.log('\n[6] 参考素材三槽与画廊封面（V8.3 批次 3-④ / ⑤）');
  // 模式按钮恒可点：素材没上传就点不了模式会把用户卡在"想选首尾帧 → 按钮灰着"的循环里
  for (const label of ['文生视频', '图生视频', '首尾帧', '视频参考']) {
    assert(
      (await page.getByRole('button', { name: label, exact: true }).count()) === 1,
      `模式入口存在：${label}`,
    );
  }

  await page.getByRole('button', { name: '首尾帧', exact: true }).click();
  assert(await page.getByText('参考尾帧').first().isVisible(), '切到「首尾帧」后出现参考尾帧槽');
  assert(
    (await page.getByText('当前缺首帧').count()) > 0,
    '缺素材时把"缺哪一格"写出来（不是只把按钮置灰）',
  );

  await page.getByRole('button', { name: '视频参考', exact: true }).click();
  assert(await page.getByText('参考视频').first().isVisible(), '切到「视频参考」后出现参考视频槽');
  assert(
    (await page.locator('input[type="file"][accept*="video/mp4"]').count()) === 1,
    '参考视频槽只接受视频类型（此前唯一的入口会把 mp4 当首帧发出去）',
  );

  // 造一条真实任务再刷新：`<img>` 封面路径只有画廊里真有卡片时才可见
  const seeded = await seedFixtureTask(baseUrl);
  note(`已用夹具 provider 造出任务 ${seeded.taskId.slice(0, 8)}（status=${seeded.status}）`);
  await page.reload({ waitUntil: 'load' });

  const card = page.locator('.wb-card').first();
  await card.waitFor({ timeout: 10_000 });
  assert((await card.locator('.wb-card-thumb img').count()) === 1, '画廊卡片用 <img> 渲染封面');
  assert(
    (await card.locator('.wb-card-thumb video').count()) === 0,
    '有封面时不再挂 <video preload="metadata">（50 条历史 = 50 个媒体元素的老问题）',
  );

  // naturalWidth > 0 = 浏览器**真的解码成功**（也顺带证明 CSP 的 img-src 放行了同源缩略图）
  await page.waitForFunction(
    () => {
      const image = document.querySelector('.wb-card-thumb img');
      return image !== null && image.complete && image.naturalWidth > 0;
    },
    { timeout: 10_000 },
  );
  assert(true, '封面图已由浏览器解码（naturalWidth > 0）');

  const thumbSrc = await card.locator('.wb-card-thumb img').getAttribute('src');
  assert(
    typeof thumbSrc === 'string' && thumbSrc.startsWith('/media/thumbs/'),
    `封面 src 为同源 /media/thumbs/…（实际 ${thumbSrc}）`,
  );
  assert(await card.locator('.wb-card-play').isVisible(), '封面角标可见（静帧不会被误读成图片素材）');
  // V2.27（台账 A1 片 A / B11）：画廊**如实标注这条在哪跑的**（夹具 provider → 本机）
  assert(
    (await card.getByTestId('gallery-executed-by').count()) === 1,
    '画廊卡片标注执行位置（V2.27：本地轨的全部价值建立在"在哪跑"能被看到上）',
  );
  assert(
    (await card.getByTestId('gallery-executed-by').textContent())?.includes('本机') === true,
    '夹具任务标为「本机」（host-local —— 按 provider 判定，不是写在卡片里的常量）',
  );

  // ── B37：V2V「从成片库选择」（V2.6 `task:` 引用入口）──────────────────────
  // 此刻画廊里已有一条夹具成片 → 候选必然非空；选中后槽里应是 `task:` 引用
  await page.getByRole('button', { name: '视频参考', exact: true }).click();
  const trefPick = page.locator('.wb-tref-pick');
  await trefPick.waitFor({ timeout: 5_000 });
  const trefOptions = await trefPick.locator('option').count();
  assert(trefOptions >= 2, `「从成片库选择」出现且有候选（${trefOptions - 1} 条）`);
  await trefPick.selectOption({ index: 1 });
  await page.waitForFunction(
    // 已填态的预览渲染在 .wb-preview 里（AssetDropZone 源码事实），不是 .wb-dropzone
    () => document.querySelector('.wb-preview video') !== null,
    { timeout: 5_000 },
  );
  assert(true, '选中成片后参考视频槽就绪（/media 直链预览已挂载，槽值 = task: 引用）');
  // 不留状态残留：切回文生（`assetsForMode` 只发该模式用得到的槽，槽本身留着也无害）
  await page.getByRole('button', { name: '文生视频', exact: true }).click();

  // ── 点封面 → 中栏播放（V8.3 批次 7 / 台账 B26）────────────────────────────
  // 用户报障："其它人跑的历史成片我无法预览" —— 原因不是文件缺失（服务端 206 正常），
  // 而是画廊**根本没有播放入口**（封面上的 ▶ 曾是装饰角标）。这里钉住"点了真的能播"。
  await card.locator('.wb-card-thumb-button').click();

  await page.waitForFunction(
    () => {
      const video = document.querySelector('.wb-viewport video');
      return video !== null && video.videoWidth > 0;
    },
    { timeout: 15_000 },
  );
  assert(true, '点封面 → 中栏播放器加载到真实视频（videoWidth > 0）');

  const playing = await page.evaluate(() => {
    const video = document.querySelector('.wb-viewport video');
    return video === null ? null : { src: video.getAttribute('src'), controls: video.controls };
  });
  assert(
    typeof playing?.src === 'string' && playing.src.startsWith('/media/'),
    `播放器 src 为同源 /media/…（实际 ${playing?.src}）`,
  );

  await page.screenshot({ path: path.join(SHOT_DIR, 'playback.png'), fullPage: false });
  note('播放截图留档：artifacts/ui-smoke/playback.png');

  await page.screenshot({ path: path.join(SHOT_DIR, 'gallery.png'), fullPage: false });
  note('画廊截图留档：artifacts/ui-smoke/gallery.png');

  console.log('\n[6b] 总览（V9 · B3：四卡数字与 /api/history 逐一对账）');
  await page.evaluate(() => { location.hash = '#/overview'; });
  await page.locator('.ov-kpi').first().waitFor({ timeout: 10_000 });
  assert((await page.locator('.ov-kpi').count()) === 4, '四卡齐全（今日生成 / 成功率 / 队列中 / 存储占用）');
  assert((await page.locator('.ov-shot').count()) > 0, '最近成片九宫格有内容（[6] 段刚生成过一条）');
  assert((await page.locator('.ov-feed-row').count()) > 0, '最近操作 feed 有内容');

  // Step 6-AC2 的硬断言：界面上的数字必须与**原始 API 现算**的一致（不许出现算不出来的指标）
  const audit = await page.evaluate(async () => {
    const response = await fetch('/api/history');
    const data = await response.json();
    const items = data.items ?? [];
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);

    const settled = items.filter((item) =>
      ['succeeded', 'failed', 'cancelled'].includes(item.status),
    );
    const succeeded = settled.filter((item) => item.status === 'succeeded').length;

    return {
      expected: {
        today: items.filter((item) => item.createdAt >= dayStart.getTime()).length,
        rate: settled.length === 0 ? null : Math.round((succeeded / settled.length) * 100),
        inFlight: items.filter((item) => item.status === 'queued' || item.status === 'running')
          .length,
        totalBytes: data.storage?.totalBytes ?? 0,
        shots: Math.min(succeeded, 9),
      },
      cardText: Array.from(document.querySelectorAll('.ov-kpi')).map((el) => el.innerText),
      shotCount: document.querySelectorAll('.ov-shot').length,
    };
  });

  const [todayCard, rateCard, queueCard, storageCard] = audit.cardText;
  assert(
    todayCard.includes(String(audit.expected.today)),
    `今日生成对账：界面含 ${audit.expected.today}（原始 API 现算）`,
  );
  assert(
    rateCard.includes(audit.expected.rate === null ? '—' : String(audit.expected.rate)),
    `成功率对账：界面含 ${audit.expected.rate === null ? '—' : `${audit.expected.rate}%`}`,
  );
  assert(
    queueCard.includes(String(audit.expected.inFlight)),
    `队列中对账：界面含 ${audit.expected.inFlight}`,
  );
  assert(
    audit.expected.totalBytes === 0 ? storageCard.includes('0 B') : !storageCard.includes('0 B'),
    `存储占用对账：totalBytes=${audit.expected.totalBytes}（界面=「${storageCard.split('\n').join(' / ')}」）`,
  );
  assert(
    audit.shotCount === audit.expected.shots,
    `九宫格数量对账：界面 ${audit.shotCount} = min(成功任务数, 9) = ${audit.expected.shots}`,
  );

  await page.screenshot({ path: path.join(SHOT_DIR, 'overview.png'), fullPage: false });
  note('总览截图留档：artifacts/ui-smoke/overview.png');

  console.log('\n[6c] 视频库（V9 · B4：搜索 / 筛选 / 排序 + 详情抽屉 + 复用参数回填）');
  await page.evaluate(() => { location.hash = '#/library'; });
  await page.locator('.lib-card').first().waitFor({ timeout: 10_000 });
  const totalCards = await page.locator('.lib-card').count();
  assert(totalCards > 0, `视频库列出成片（${totalCards} 张卡片）`);
  // V2.27（A1 片 A / B11）：视频库也如实标注执行位置（与画廊同一份文案表）
  assert(
    /本机|云端|你的电脑/.test((await page.locator('.lib-meta').first().textContent()) ?? ''),
    '视频库元信息行含执行位置（V2.27）',
  );

  // 破坏性验证（固化）：搜一个不存在的词 → 必须是空态，而不是"原样显示全部卡片"
  await page.getByLabel('搜索提示词').fill('这个词一定不存在-zzz');
  await page.waitForFunction(() => document.querySelectorAll('.lib-card').length === 0, {
    timeout: 5_000,
  });
  assert(
    await page.getByText('没有匹配的成片').isVisible(),
    '搜索不存在的词 → 空态文案（而不是原样显示全部）',
  );
  await page.getByLabel('搜索提示词').fill('');
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.lib-card').length === expected,
    totalCards,
    { timeout: 5_000 },
  );
  assert(true, '清空搜索后恢复全部卡片');

  // 状态筛选与 API 现算对账（"失败"含 cancelled）
  await page.getByRole('button', { name: '失败', exact: true }).click();
  const failedCards = await page.locator('.lib-card').count();
  const expectedFailed = await page.evaluate(async () => {
    const data = await (await fetch('/api/history')).json();
    return (data.items ?? []).filter((item) => item.status === 'failed' || item.status === 'cancelled')
      .length;
  });
  if (expectedFailed === 0) {
    assert(
      failedCards === 0 && (await page.getByText('没有匹配的成片').isVisible()),
      '「失败」筛选生效（当前确无失败任务 → 空态）',
    );
  } else {
    assert(
      failedCards === expectedFailed,
      `「失败」筛选对账：界面 ${failedCards} = API 现算 ${expectedFailed}`,
    );
  }
  await page.getByRole('button', { name: '全部', exact: true }).click();

  // 排序对账：切到"旧→新"，DOM 首条必须等于 API 现算的最旧一条
  await page.getByLabel('排序方式').selectOption('time-asc');
  const orderCheck = await page.evaluate(async () => {
    const data = await (await fetch('/api/history')).json();
    const items = [...(data.items ?? [])].sort((a, b) => a.createdAt - b.createdAt);
    return {
      expectedFirst: items[0]?.taskId,
      domFirst: document.querySelector('.lib-card')?.getAttribute('data-task'),
    };
  });
  assert(
    orderCheck.expectedFirst === orderCheck.domFirst,
    `时间正序对账：DOM 首条 ${orderCheck.domFirst} = API 现算最旧 ${orderCheck.expectedFirst}`,
  );

  // AC4 硬断言：详情抽屉「复用参数」把提示词**完整回填**到生成工作台
  await page.locator('.lib-card .lib-thumb').first().click();
  await page.locator('.lib-drawer').waitFor({ timeout: 5_000 });
  assert(true, '点卡片打开详情抽屉');
  const drawerPrompt = await page.locator('.lib-kv dd').first().innerText();
  await page.locator('.lib-drawer').getByRole('button', { name: '复用参数' }).click();
  await page.waitForFunction(() => location.hash.startsWith('#/workbench?reuse='), {
    timeout: 5_000,
  });
  await page.waitForFunction(
    (expected) => {
      const box = document.querySelector('.wb-main textarea');
      return box !== null && box.value === expected;
    },
    drawerPrompt,
    { timeout: 5_000 },
  );
  assert(true, '详情抽屉「复用参数」把提示词完整回填到工作台（hash 参数通道）');

  await page.screenshot({ path: path.join(SHOT_DIR, 'library.png'), fullPage: false });
  note('视频库截图留档：artifacts/ui-smoke/library.png');

  console.log('\n[6d] 配方库（V9 · B8：≥20 张 + 插入骨架逐字 + 分类筛选）');
  await page.evaluate(() => { location.hash = '#/recipes'; });
  await page.locator('.recipe-card').first().waitFor({ timeout: 10_000 });
  const recipeCount = await page.locator('.recipe-card').count();
  assert(recipeCount >= 20, `配方卡 ≥20 张（实际 ${recipeCount}）`);

  await page.getByRole('button', { name: '运镜', exact: true }).click();
  const cameraCount = await page.locator('.recipe-card').count();
  assert(
    cameraCount >= 5 && cameraCount < recipeCount,
    `分类筛选生效（运镜 ${cameraCount} 张 / 全部 ${recipeCount} 张）`,
  );
  await page.getByRole('button', { name: '全部', exact: true }).click();

  // AC5 的硬断言：插入的骨架必须**逐字**出现在提示词框里
  const firstSkeleton = await page.locator('.recipe-card-skeleton').first().innerText();
  await page
    .locator('.recipe-card')
    .first()
    .getByRole('button', { name: '插入骨架到提示词' })
    .click();
  // ⚠️ hash 变化是同步的、React 的重渲染是异步的 —— 这里必须**等条件成立**，
  // 而不是"改完 hash 立刻读 textarea"（那样拿到的是旧值，实测踩到过一次）。
  await page.waitForFunction(
    (expected) => (document.querySelector('.wb-main textarea')?.value ?? '').includes(expected),
    firstSkeleton,
    { timeout: 10_000 },
  );
  const promptAfterInsert = await page.evaluate(
    () => document.querySelector('.wb-main textarea')?.value ?? '',
  );
  assert(
    promptAfterInsert.includes(firstSkeleton),
    `插入骨架：配方文本**逐字**出现在提示词框里（框长 ${promptAfterInsert.length} 字）`,
  );

  console.log('\n[6e] 剪辑台（B34 · P1：Remotion 时间轴 UI + ffmpeg 链路 API 级证据）');
  await page.evaluate(() => { location.hash = '#/edit'; });
  await page.waitForSelector('.wb-placeholder', { timeout: 10_000 });
  assert(true, '无 task 参数时显示空态引导（剪辑台不进侧栏）');

  const sourceTask = await page.evaluate(async () => {
    const data = await (await fetch('/api/history')).json();
    return (
      (data.items ?? []).find((item) => item.status === 'succeeded' && item.outputVideoUrl)?.taskId ??
      null
    );
  });
  assert(sourceTask !== null, `找到可用源片（${sourceTask}）`);

  // ── 新版时间轴 UI（Remotion 预览 + clip 拖动/裁剪/选中）──
  await page.evaluate((id) => { location.hash = `#/edit?task=${id}`; }, sourceTask);
  await page.waitForSelector('.ed-timeline .ed-clip', { timeout: 15_000 });
  assert(true, '剪辑台加载源片并渲染时间轴（源片 clip 已上轨）');

  // 预览舞台挂载 Remotion Player：@remotion/media 的 <Video> 在预览里渲染 canvas
  // （WebCodecs 抽帧），不是 <video> 元素 —— 断言形态以源码事实为准
  await page.waitForSelector('.ed-stage canvas', { timeout: 15_000 });
  assert(true, '预览舞台挂载 Remotion Player（canvas 在位，预览即所得链路成立）');

  // 选中：点击 clip → selected（此刻轨上只有源片一个 clip，拖动/裁剪不受邻居约束）
  const firstClip = page.locator('.ed-timeline .ed-clip').first();
  await firstClip.click();
  assert(
    (await page.locator('.ed-clip.selected').count()) === 1,
    'clip 点击后进入选中态（金描边）',
  );

  // 拖动：body 向右拖 → startFrame 变大（data-* 是渲染事实，不是内部状态）
  const startBefore = Number(await firstClip.getAttribute('data-start-frame'));
  const box = await firstClip.boundingBox();
  assert(box !== null, 'clip 有可视几何');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  const startAfter = Number(await firstClip.getAttribute('data-start-frame'));
  assert(
    startAfter > startBefore,
    `clip 可拖动（startFrame ${startBefore} → ${startAfter}）`,
  );
  // 裁剪：右缘手柄向左拖 → durationFrames 变小
  // ⚠️ 两个实测坑（2026-09-24 排查）：
  //  ① 原始 mouse.* 不走 Playwright 的 actionability 稳定等待 —— 拖拽 mouse.up 后立刻读
  //     boundingBox()/属性可能拿到「提交中途」的旧值；先用双 rAF 等 clip 几何稳定再算手柄坐标。
  //  ② 坐标用 evaluate + getBoundingClientRect（同步布局读取），不用 boundingBox() 快照。
  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        const clip = document.querySelector('.ed-timeline .ed-clip');
        if (clip === null) return resolve(false);
        const first = clip.getBoundingClientRect().x;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve(Math.abs(clip.getBoundingClientRect().x - first) < 0.5)),
        );
      }),
    null,
    { timeout: 5_000 },
  );

  const durBefore = Number(await firstClip.getAttribute('data-duration-frames'));
  const clipRect = await page.evaluate(() => {
    const clip = document.querySelector('.ed-timeline .ed-clip');
    if (clip === null) return null;
    const rect = clip.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  assert(clipRect !== null, '拖动后 clip 有可视几何');
  const trimStartX = clipRect.x + clipRect.width - 4;
  const trimStartY = clipRect.y + clipRect.height / 2;
  await page.mouse.move(trimStartX, trimStartY);
  await page.mouse.down();
  await page.mouse.move(trimStartX - 80, trimStartY, { steps: 4 });
  await page.mouse.up();
  const durAfter = Number(await firstClip.getAttribute('data-duration-frames'));
  assert(
    durAfter < durBefore && durAfter >= 2,
    `clip 可裁剪（durationFrames ${durBefore} → ${durAfter}，最短 2 帧）`,
  );

  // 添加素材：把同一源片再入轨一次（验证「探测时长 → 追加到轨尾」链路）
  await page.locator('.ed-tl-pick').selectOption(sourceTask);
  await page.getByRole('button', { name: '＋镜头' }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.ed-timeline .ed-clip').length === 2,
    { timeout: 15_000 },
  );
  assert(true, '添加素材后时间轴有 2 个 clip（追加到轨尾）');

  // Delete 删除选中片段（添加素材后新 clip 处于选中态）→ 回到 1 个 clip
  await page.keyboard.press('Delete');
  await page.waitForFunction(
    () => document.querySelectorAll('.ed-timeline .ed-clip').length === 1,
    { timeout: 5_000 },
  );
  assert(true, 'Delete 删除选中片段（时间轴回到 1 个 clip）');

  // ── ffmpeg 基础剪辑链路（决策：保留为纯后端能力，UI 入口已撤 → 走 API 级验证）──
  const editResult = await page.evaluate(async (srcTask) => {
    const submit = await fetch('/api/edits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceTaskId: srcTask,
        operations: [
          { type: 'trim', startSec: 0, endSec: 3 },
          { type: 'extractFrame', atSec: 1 },
        ],
      }),
    });
    if (!submit.ok) return { submitStatus: submit.status };
    const { taskId } = await submit.json();

    // 轮询到终态（本地 ffmpeg，5s 片的 trim+抽帧实测秒级，给足 60s 余量）
    const deadline = Date.now() + 60_000;
    let item = null;
    while (Date.now() < deadline) {
      const progress = await (await fetch(`/api/tasks/${taskId}`)).json();
      if (['succeeded', 'failed', 'cancelled'].includes(progress.status)) {
        item = progress;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    if (item === null) return { timeout: true };

    const response = await fetch(item.outputVideoUrl ?? '/api/health', {
      headers: { range: 'bytes=0-1023' },
    });
    return {
      status: item.status,
      error: item.error ?? null,
      outputVideoUrl: item.outputVideoUrl ?? null,
      extracted: item.extractedAssetIds ?? [],
      rangeStatus: response.status,
    };
  }, sourceTask);

  note(`剪辑诊断：${JSON.stringify(editResult)}`);
  assert(
    editResult.status === 'succeeded' && editResult.outputVideoUrl !== null,
    `ffmpeg 剪辑链路（API 级）产物成功（status=${editResult.status}，error=${JSON.stringify(editResult.error ?? null)}）`,
  );
  assert(
    editResult.extracted?.length === 1,
    `抽帧资产已落账（${editResult.extracted?.length ?? 0} 个，期望 1）`,
  );
  assert(
    editResult.rangeStatus === 206,
    `剪辑产物支持 Range（HTTP ${editResult.rangeStatus}）`,
  );

  // 剪辑历史（新版右栏保留位）：刷新后能看到刚才那条 API 级剪辑记录
  await page.reload();
  await page.waitForSelector('.ed-timeline .ed-clip', { timeout: 15_000 });
  const historyCount = await page.locator('.edit-history li').count();
  assert(historyCount >= 1, `本片剪辑历史可见（${historyCount} 条）`);

  console.log('\n[6f] 剪辑台导出（B34 · P2：浏览器端 web-renderer 真渲染出一个 MP4）');

  // 前置能力探针（2026-09-24 CI 教训）：浏览器端导出依赖 WebCodecs 的 H.264 编码。
  // 没有这个能力时，旧写法会**静默挂 120 秒**再报一句 "waitForSelector 超时"，看不出根因；
  // 现在一行诊断：要么通过，要么直说"当前浏览器不支持 H.264 编码"。
  const h264EncodeSupport = await page.evaluate(async () => {
    if (typeof VideoEncoder === 'undefined') return 'VideoEncoder 不存在';
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec: 'avc1.42001f',
        width: 640,
        height: 360,
        bitrate: 1_000_000,
        framerate: 30,
      });
      return support.supported === true ? 'ok' : 'H.264 编码不受支持（Chromium 开源构建不含专有编解码器；CI 请用 SMOKE_CHANNEL=chrome）';
    } catch (caught) {
      return `探测异常：${caught instanceof Error ? caught.message : String(caught)}`;
    }
  });
  assert(h264EncodeSupport === 'ok', `浏览器具备 WebCodecs H.264 编码能力（${h264EncodeSupport}）`);

  // 上一段刚 reload 过 → 工程是初始态（源片一个 clip）；预期时长 = 内容精确结束帧
  // （导出不含预览的 1s 编辑余量 —— 这是 exportDurationFrames 的刻意口径）
  const sizeText = await page.locator('.ed-transport-size').innerText();
  const projectFps = Number(sizeText.match(/(\d+)\s*fps/)?.[1] ?? 30);
  /** 内容结束帧 = 所有轨道上 clip 的最大结束（data-* 是渲染事实，与模型同源） */
  const readContentEnd = () =>
    page.evaluate(() => {
      let end = 0;
      for (const clip of document.querySelectorAll('.ed-timeline .ed-clip')) {
        end = Math.max(
          end,
          Number(clip.getAttribute('data-start-frame')) + Number(clip.getAttribute('data-duration-frames')),
        );
      }
      return end;
    });
  const expectedSec = (await readContentEnd()) / projectFps;
  note(`导出预期：${expectedSec.toFixed(3)}s（@${projectFps}fps；含草稿恢复后的既有编辑）`);

  await page.getByRole('button', { name: /导出成片/ }).click();

  // 竞态等待：下载链接出现 = 成功；出现错误框 = 失败（**立刻**给出可读原因）。
  // 旧写法只等下载链接，失败时只能看到"120s 超时"，看不出卡在哪（2026-09-24 CI 的教训）。
  const exportOutcome = await page
    .waitForFunction(
      () => {
        if (document.querySelector('.ed-export-result a[download]') !== null) return 'done';
        if (document.querySelector('.wb-uncertain') !== null) {
          return `error:${document.querySelector('.wb-uncertain')?.textContent ?? ''}`;
        }
        return false;
      },
      { timeout: 120_000, polling: 500 },
    )
    .then(async (handle) => String(await handle.jsonValue()))
    .catch(async () => {
      const progress = await page
        .locator('.ed-export-progress .wb-note')
        .first()
        .innerText()
        .catch(() => '(无进度条)');
      return `timeout:${progress}`;
    });

  if (exportOutcome !== 'done') {
    // 失败时把现场信息一并打出来：进度条文本、控制台错误、渲染期间的最后一张截图
    note(`导出未完成 → ${exportOutcome}`);
    note(`控制台错误（收集到 ${consoleErrors.length} 条）：${consoleErrors.slice(-3).join(' | ')}`);
    await page.screenshot({ path: path.join(SHOT_DIR, 'export-failed.png'), fullPage: false });
  }
  assert(exportOutcome === 'done', `浏览器端导出完成（${exportOutcome.slice(0, 200)}）`);
  if (exportOutcome === 'done') {
    note(`导出面板结果：${await page.locator('.ed-export-result .wb-note').first().innerText()}`);
  }

  const exportDownloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await page.locator('.ed-export-result a[download]').click();
  const exportDownload = await exportDownloadPromise;
  const EXPORT_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-smoke-export-'));
  const exportPath = path.join(EXPORT_DIR, 'browser-export.mp4');
  await exportDownload.saveAs(exportPath);
  if (KEEP) note(`导出产物保留：${exportPath}`);

  const exportProbe = await ffprobeJson(exportPath);
  const videoStream = exportProbe.streams.find((stream) => stream.codec_type === 'video');
  const audioStream = exportProbe.streams.find((stream) => stream.codec_type === 'audio');
  const durationSec = Number(exportProbe.format.duration);
  assert(
    videoStream !== undefined,
    `导出产物含视频流（${videoStream?.codec_name ?? '无'}，${videoStream?.width}×${videoStream?.height}）`,
  );
  assert(
    videoStream !== undefined && videoStream.r_frame_rate === `${projectFps}/1`,
    `导出的帧率 = 工程帧率（${videoStream?.r_frame_rate ?? '无'}，期望 ${projectFps}/1）`,
  );
  assert(
    Math.abs(durationSec - expectedSec) <= 0.2,
    `导出时长 = 工程内容时长（${durationSec.toFixed(3)}s vs ${expectedSec.toFixed(3)}s，容差 0.2s）`,
  );
  // 音轨以**源片事实**为准（源片有声就该有声，没有就不该凭空出现）
  const sourceProbe = await ffprobeJson(
    `${baseUrl}${await page.evaluate(async (id) => {
      const data = await (await fetch('/api/history')).json();
      const item = (data.items ?? []).find((entry) => entry.taskId === id);
      return item?.outputVideoUrl ?? '/api/health';
    }, sourceTask)}`,
  );
  const sourceHasAudio = sourceProbe.streams.some((stream) => stream.codec_type === 'audio');
  assert(
    (audioStream !== undefined) === sourceHasAudio,
    `音轨与源片一致（源片有声=${sourceHasAudio}，导出有声=${audioStream !== undefined}）`,
  );
  const lumaStdDev = await frameLumaStdDev(exportPath, Math.max(0.1, expectedSec / 2));
  assert(lumaStdDev > 8, `导出画面非空白（中点帧亮度标准差 ${lumaStdDev.toFixed(1)}，纯色为 0）`);

  console.log('\n[6g] 剪辑台多轨（B34 · P3：字幕 / 转场 / 属性面板 / 草稿）');
  // 字幕：＋字幕在播放头处加一条（默认 2s），自动选中并出现在属性面板
  await page.getByRole('button', { name: '＋字幕' }).click();
  await page.waitForSelector('.ed-clip[data-clip-kind="caption"]', { timeout: 5_000 });
  assert(true, '＋字幕：字幕轨出现 1 个字幕片段（自动选中）');

  const inspector = page.locator('[data-testid="ed-inspector"]');
  assert(
    (await inspector.innerText()).includes('字幕文本'),
    '属性面板识别选中片段为字幕（显示字幕专属字段）',
  );
  await inspector.locator('textarea').fill('雨停了，我们走吧。');
  // 用定时轮询（rab 轮询在既有结论里与页面动画/播放器 rAF 混在一起时不可靠）
  await page.waitForFunction(
    () =>
      document.querySelector('.ed-clip[data-clip-kind="caption"]')?.textContent?.includes('雨停了') ??
      false,
    null,
    { timeout: 8_000, polling: 100 },
  );
  assert(true, '属性面板改文本 → 时间轴片段标签随动（写回模型）');
  await inspector.locator('select').nth(1).selectOption('wordSlide');
  assert(
    (await page.locator('.ed-clip[data-clip-kind="caption"] .ed-badge').count()) >= 1,
    '属性面板改动效预设 → 片段显示「动效」角标',
  );

  // 转场：加第二段镜头 → 选中第一段 → ＋转场（后继片段左移 = 重叠窗口）
  await page.locator('.ed-tl-pick').selectOption(sourceTask);
  await page.getByRole('button', { name: '＋镜头' }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.ed-lane-video .ed-clip').length === 2,
    null,
    { timeout: 15_000 },
  );
  const videoClips = page.locator('.ed-lane-video .ed-clip');
  const firstStart = Number(await videoClips.nth(0).getAttribute('data-start-frame'));
  const bStartBefore = Number(await videoClips.nth(1).getAttribute('data-start-frame'));
  await videoClips.nth(0).click();
  await page.getByRole('button', { name: '＋转场' }).click();
  await page.waitForSelector('.ed-clip[data-clip-kind="transition"]', { timeout: 5_000 });
  const bStartAfter = Number(await videoClips.nth(1).getAttribute('data-start-frame'));
  assert(
    bStartAfter === bStartBefore - 15,
    `＋转场：后继片段左移 15 帧（${bStartBefore} → ${bStartAfter}），转场块落位`,
  );

  // 属性面板改转场时长 → 左移量同步变化（移除+重加）
  await page.locator('.ed-clip[data-clip-kind="transition"]').click();
  assert((await inspector.innerText()).includes('移除转场'), '属性面板识别选中片段为转场');
  await inspector.locator('input[type="number"]').fill('20');
  await page.waitForFunction(
    (expected) =>
      Number(
        document.querySelectorAll('.ed-lane-video .ed-clip')[1]?.getAttribute('data-start-frame'),
      ) === expected,
    bStartBefore - 20,
    { timeout: 8_000 },
  );
  assert(true, `转场时长改 20 帧 → 后继片段再左移 5 帧（净左移 20；起点 ${firstStart} 起算）`);

  // 草稿：刷新后多轨工程仍在（P3 的 localStorage 草稿）
  await page.reload();
  await page.waitForSelector('.ed-clip[data-clip-kind="transition"]', { timeout: 15_000 });
  assert(
    (await page.locator('.ed-clip[data-clip-kind="caption"]').count()) === 1 &&
      (await page.locator('.ed-clip[data-clip-kind="transition"]').count()) === 1,
    '刷新后草稿恢复：字幕 + 转场都在（编辑成果不丢）',
  );

  // V2.21（台账 B66）：草稿版本历史 —— 存一个版本 → 列表出现 → 恢复
  await page.getByTestId('ed-hist-toggle').click();
  await page.waitForSelector('.ed-hist-pop', { timeout: 5_000 });
  assert(true, '剪辑台页头能打开「草稿历史」浮层');
  await page.getByTestId('ed-hist-save').click();
  await page.waitForSelector('.ed-hist-list .ed-hist-item', { timeout: 5_000 });
  const draftHistoryCount = await page.locator('.ed-hist-list .ed-hist-item').count();
  assert(draftHistoryCount >= 1, `点「＋ 存一个版本」后历史里出现快照（${draftHistoryCount} 份）`);
  assert(
    (await page.getByTestId('ed-hist-feedback').innerText()).includes('已存一个版本'),
    '界面如实反馈"已存一个版本"',
  );
  await page.getByTestId('ed-hist-restore').first().click();
  assert(
    (await page.getByTestId('ed-hist-feedback').innerText()).includes('已恢复'),
    '点「恢复」有明确反馈（且恢复前会先保底存一份当前状态）',
  );
  await page.getByTestId('ed-hist-toggle').click(); // 收起来，别挡住后面的断言

  // V2.21（台账 B66）：**坏草稿不静默丢** —— 原文保留 + 界面如实说明
  //
  // ⚠️ 顺序有讲究（第一版在这里踩到）：**不能在剪辑台上直接刷新**——
  // 离开页面时 `pagehide` 兜底会把当前工程写回草稿（那是防"刚编辑完就刷新丢最后一笔"的），
  // 于是"改坏的草稿"会被立刻覆盖成合法草稿，问题面板永远不会出现。
  // 正确姿势：先离开剪辑台（切到别的视图）→ 此时改坏草稿 → 用 **hash 导航**回剪辑台（页面不卸载）。
  const badDraftKey = `astrmira.editDraft.${sourceTask}`;
  await page.evaluate(() => { location.hash = '#/library'; });
  await page.waitForTimeout(600);
  await page.evaluate((key) => localStorage.setItem(key, '{ 这不是 JSON'), badDraftKey);
  await page.evaluate((task) => { location.hash = `#/edit?task=${task}`; }, sourceTask);
  await page.waitForSelector('[data-testid="ed-draft-problem"]', { timeout: 15_000 });
  assert(true, '坏草稿 → 明确提示「草稿读不出来，已保留原文」（不再静默删）');
  const keptRaw = await page.evaluate((key) => localStorage.getItem(key), badDraftKey);
  assert(keptRaw === '{ 这不是 JSON', '坏草稿原文**仍在** localStorage（用户还有救回来的机会）');

  // 清掉坏草稿，并用**历史快照**把编辑成果找回来（顺带验"恢复真的带回了内容"）
  await page.evaluate((key) => localStorage.removeItem(key), badDraftKey);
  await page.getByTestId('ed-hist-toggle').click();
  await page.waitForSelector('.ed-hist-list .ed-hist-item', { timeout: 10_000 });
  await page.getByTestId('ed-hist-restore').first().click();
  await page.waitForSelector('.ed-clip[data-clip-kind="caption"]', { timeout: 10_000 });
  assert(
    (await page.locator('.ed-clip[data-clip-kind="caption"]').count()) >= 1,
    '从历史快照恢复 → 字幕/转场等编辑成果回来了（草稿损坏也能救）',
  );
  await page.getByTestId('ed-hist-toggle').click();

  // 含字幕与转场的工程再次导出：时长与内容一致、画面非空白（转场/字幕真的被渲染）
  const expectedSec2 = (await readContentEnd()) / projectFps;
  await page.getByRole('button', { name: /导出成片/ }).click();
  await page.waitForSelector('.ed-export-result a[download]', { timeout: 120_000 });
  const export2Promise = page.waitForEvent('download', { timeout: 30_000 });
  await page.locator('.ed-export-result a[download]').click();
  const export2 = await export2Promise;
  const exportPath2 = path.join(EXPORT_DIR, 'browser-export-multitrack.mp4');
  await export2.saveAs(exportPath2);
  const probe2 = await ffprobeJson(exportPath2);
  const duration2 = Number(probe2.format.duration);
  assert(
    Math.abs(duration2 - expectedSec2) <= 0.25,
    `多轨工程导出时长 = 内容时长（${duration2.toFixed(3)}s vs ${expectedSec2.toFixed(3)}s，含转场缩短）`,
  );
  assert(
    (await frameLumaStdDev(exportPath2, Math.max(0.1, expectedSec2 * 0.6))) > 8,
    '多轨导出画面非空白（字幕段有实际内容）',
  );

  console.log('\n[6h] 剪辑台入库与抽帧闭环（B34 · P4：浏览器渲染入库 + 抽帧 → I2V）');
  // 入库：把刚渲染的成片 + 工程 JSON 一起归档（服务端只校验 + 归档，不渲染）
  await page.getByRole('button', { name: /入库/ }).click();
  await page.waitForFunction(() => document.body.innerText.includes('已入库'), null, {
    timeout: 60_000,
    polling: 200,
  });
  assert(true, '📥 入库：面板报告已入库（请求 200）');

  const archived = await page.evaluate(async (src) => {
    const data = await (
      await fetch(`/api/history?kind=edit&source=${encodeURIComponent(src)}`)
    ).json();
    const item = (data.items ?? []).find((entry) => entry.origin?.project !== undefined);
    if (item === undefined) return null;
    const response = await fetch(item.outputVideoUrl, { headers: { range: 'bytes=0-1023' } });
    const clips = (item.origin.project.tracks ?? []).reduce(
      (sum, track) => sum + (track.clips?.length ?? 0),
      0,
    );
    return {
      taskId: item.taskId,
      status: item.status,
      rangeStatus: response.status,
      clips,
      thumbnail: item.thumbnailUrl ?? null,
    };
  }, sourceTask);
  note(`入库诊断：${JSON.stringify(archived)}`);
  assert(archived !== null && archived.status === 'succeeded', '入库产物可查（status=succeeded）');
  assert(archived?.rangeStatus === 206, `入库产物支持 Range（HTTP ${archived?.rangeStatus}）`);
  assert((archived?.clips ?? 0) >= 3, `多轨工程随任务入库（${archived?.clips} 个片段）`);
  assert(archived?.thumbnail !== null, `入库产物有封面（${archived?.thumbnail}）`);

  // 抽帧 → 参考资产 → 自动切到 I2V 首帧（D38 闭环；抽帧与预览同构图）
  await page.getByRole('button', { name: /抽帧为参考资产/ }).click();
  await page.waitForFunction(() => location.hash.startsWith('#/workbench?frameAsset='), null, {
    timeout: 60_000,
    polling: 200,
  });
  const frameAsset = await page.evaluate(
    () => new URLSearchParams(location.hash.split('?')[1] ?? '').get('frameAsset') ?? '',
  );
  assert(
    /^[0-9a-f-]{36}$/i.test(frameAsset),
    `抽帧上传得到资产（${frameAsset.slice(0, 8)}…）`,
  );
  await page.waitForSelector('img[src*="/media/assets/"]', { timeout: 10_000 });
  assert(true, '首帧槽显示抽帧预览（同源 /media/assets/…）');
  // 注意：页面上有多个分段控件（画幅/时长/清晰度/模式），必须点名"图生视频"这一个按钮
  assert(
    (await page.getByRole('button', { name: '图生视频', exact: true }).getAttribute('aria-pressed')) ===
      'true',
    '工作台已切到 I2V（首帧槽 + 图生视频模式）',
  );
  const frameLoaded = await page.evaluate(async () => {
    const img = document.querySelector('img[src*="/media/assets/"]');
    if (img === null) return 0;
    const response = await fetch(img.getAttribute('src') ?? '');
    const blob = await response.blob();
    return response.ok ? blob.size : 0;
  });
  assert(frameLoaded > 0, `抽帧资产可读（${frameLoaded} 字节）`);

  console.log('\n[6i] 音频素材与 BGM（V2.10 / B57：上传 → 资产 kind → 音效轨取材 → 淡入淡出）');

  // ① 上传一段**真实 WAV**：44 字节头由脚本自己拼（与后端单测同一夹具口径，不依赖 ffmpeg）
  const wavBgm = (() => {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(36 + 8000, 4);
    header.write('WAVE', 8, 'ascii');
    header.write('fmt ', 12, 'ascii');
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(8000, 24);
    header.writeUInt32LE(8000, 28);
    header.writeUInt16LE(1, 32);
    header.writeUInt16LE(8, 34);
    header.write('data', 36, 'ascii');
    header.writeUInt32LE(8000, 40);
    return Buffer.concat([header, Buffer.alloc(8000, 128)]);
  })();
  const audioForm = new FormData();
  audioForm.append('files', new Blob([wavBgm], { type: 'audio/wav' }), '氛围BGM.wav');
  const audioUploadRes = await fetch(`${baseUrl}/api/upload`, { method: 'POST', body: audioForm });
  assert(audioUploadRes.ok, `B57：音频上传成功（HTTP ${audioUploadRes.status}）`);
  const audioAsset = (await audioUploadRes.json()).assets[0];
  assert(
    audioAsset?.kind === 'audio',
    `B57：服务端按流类型判为音频（kind=${audioAsset?.kind}，mime=${audioAsset?.mime}）`,
  );
  const audioEntry = (await (await fetch(`${baseUrl}/api/assets`)).json()).assets.find(
    (item) => item.assetId === audioAsset.assetId,
  );
  assert(
    audioEntry?.kind === 'audio' && audioEntry?.name === '氛围BGM.wav',
    'B57：/api/assets 如实报 kind=audio + 原始文件名（sidecar 优先，不走容器兜底）',
  );

  // ② 剪辑台：音频素材出现在素材下拉的「音频素材」组；选中它时「＋镜头」置灰（音频不是画面素材）
  await page.goto(`${baseUrl}/#/edit?task=${sourceTask}`, { waitUntil: 'load' });
  await page.waitForSelector('.ed-timeline .ed-clip', { timeout: 15_000 });
  const audioOptionValue = `asset:${audioAsset.assetId}`;
  await page.waitForFunction(
    (value) => document.querySelector(`.ed-tl-pick option[value="${value}"]`) !== null,
    audioOptionValue,
    { timeout: 10_000 },
  );
  assert(true, 'B57：素材下拉出现该音频素材（value = asset:<assetId>）');
  await page.locator('.ed-tl-pick').selectOption(audioOptionValue);
  assert(
    await page.getByRole('button', { name: '＋镜头' }).isDisabled(),
    'B57：选中音频素材时「＋镜头」置灰（音频只能进音效轨）',
  );

  // ③ ＋音效：音效轨出现片段；标签 = 原始文件名（资产来源没有 taskId，不能崩在 undefined）
  await page.getByRole('button', { name: '＋音效' }).click();
  await page.waitForSelector('.ed-clip[data-clip-kind="audio"]', { timeout: 15_000 });
  const audioClipText = await page.locator('.ed-clip[data-clip-kind="audio"]').innerText();
  assert(
    audioClipText.includes('氛围BGM'),
    `B57：音效轨片段标签 = 原始文件名（实际「${audioClipText.trim().slice(0, 24)}」）`,
  );

  // ④ 淡出（广告片收尾必需）：属性面板设 15 帧 → 草稿恢复后仍是 15（写回工程的成功证据）
  await page.locator('.ed-clip[data-clip-kind="audio"]').click();
  const audioFadeOutField = page
    .locator('[data-testid="ed-inspector"] .ed-field', { hasText: '淡出' })
    .locator('input');
  await audioFadeOutField.fill('15');
  await page.waitForTimeout(700); // 草稿防抖 500ms
  await page.reload();
  await page.waitForSelector('.ed-clip[data-clip-kind="audio"]', { timeout: 15_000 });
  await page.locator('.ed-clip[data-clip-kind="audio"]').click();
  const fadeOutValue = await page
    .locator('[data-testid="ed-inspector"] .ed-field', { hasText: '淡出' })
    .locator('input')
    .inputValue();
  assert(
    fadeOutValue === '15',
    `B57：淡出写回工程并经草稿恢复（刷新后仍是 ${fadeOutValue} 帧）`,
  );

  console.log('\n[6j] 成本台账（V2.12 / 台账 B48：本地轨"记 0 元"而不是"未结算"）');
  // 夹具任务是 local 轨 → 结算为 `local-free` 0 元。这条断言正是"没花钱"与"不知道花了多少"
  // 分得开的端到端证据（如果实现里用 0 兜底未结算，这里就分不出来了）。
  const costSummary = await page.evaluate(async () => {
    const data = await (await fetch('/api/costs/summary?project=all')).json();
    return {
      taskCount: data.taskCount,
      pricedTaskCount: data.pricedTaskCount,
      unsettledCount: data.unsettledCount,
      uncertainCount: data.uncertainCount,
      totalYuan: data.totalYuan,
      truncated: data.truncated,
      modelBuckets: data.byModel.map((bucket) => bucket.label),
      disclaimer: data.disclaimer,
    };
  });
  note(`成本汇总：${JSON.stringify(costSummary)}`);
  assert(
    costSummary.taskCount >= 1 && costSummary.pricedTaskCount >= 1,
    `区间内成功任务都已结算（${costSummary.pricedTaskCount}/${costSummary.taskCount} 条有成本记录）`,
  );
  assert(
    costSummary.unsettledCount === 0,
    '未结算 = 0（本地轨任务**显式记 0 元**，不是"不知道花了多少"）',
  );
  assert(
    costSummary.totalYuan === 0,
    `预估总花费 = ¥0（本次冒烟全是本地轨：无 API 费用；实际 ${costSummary.totalYuan}）`,
  );
  assert(
    costSummary.disclaimer.includes('以火山方舟控制台账单为准'),
    '汇总响应带口径说明（服务端下发，界面不自己写一版）',
  );
  assert(costSummary.truncated === false, '未触到扫描上界（truncated=false）');

  // 界面上也看一眼：金额与条数**成组出现**
  await page.evaluate(() => { location.hash = '#/costs'; });
  await page.waitForSelector('.cost-controls', { timeout: 10_000 });
  await page.locator('.cost-controls').getByRole('button', { name: '全部', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.ov-kpi .ov-kpi-value').length === 4,
    null,
    { timeout: 10_000 },
  );
  const costHeadline = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.ov-kpi')];
    const find = (label) =>
      cards.find((card) => card.querySelector('.ov-kpi-label')?.textContent === label);
    return {
      detail: find('预估花费')?.querySelector('.ov-kpi-foot')?.textContent ?? '',
      unsettled: find('未结算')?.querySelector('.ov-kpi-value')?.textContent ?? '',
    };
  });
  assert(
    costHeadline.detail.includes('已结算'),
    `金额旁边跟着"已结算 N 条"（只给金额会被读成全量；实际「${costHeadline.detail}」）`,
  );
  assert(
    costHeadline.unsettled.startsWith('0'),
    `界面上未结算显示 0 条（实际「${costHeadline.unsettled}」）`,
  );

  console.log('\n[6k] 交付包（V2.13 / 台账 B49：多选 + 命名模板 + 规格校验 + 归档清单）');

  /** 最小 ZIP 读回（中央目录条目名）—— 与前端 zipStore 的写入口径对拍 */
  function readZipNames(buffer) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    for (let i = buffer.length - 22; i >= 0; i -= 1) {
      if (view.getUint32(i, true) !== 0x0605_4b50) continue;
      const count = view.getUint16(i + 10, true);
      let cursor = view.getUint32(i + 16, true);
      const names = [];
      for (let index = 0; index < count; index += 1) {
        if (view.getUint32(cursor, true) !== 0x0201_4b50) throw new Error('中央目录损坏');
        const length = view.getUint16(cursor + 28, true);
        names.push(new TextDecoder().decode(buffer.subarray(cursor + 46, cursor + 46 + length)));
        cursor += 46 + length;
      }
      return names;
    }
    throw new Error('不是有效的 ZIP');
  }

  await page.evaluate(() => { location.hash = '#/library'; });
  await page.waitForSelector('.lib-card', { timeout: 15_000 });
  const cardCount = await page.locator('.lib-card').count();
  assert(cardCount >= 1, `视频库有可交付的成片（${cardCount} 条）`);

  // 未勾选时入口置灰（灰按钮上写明"为什么要先勾选"）
  assert(
    await page.locator('.dl-open').isDisabled(),
    '未勾选任何成片时「📦 交付包」置灰',
  );

  const picks = page.locator('.lib-card .dl-pick');
  const pickTargets = Math.min(cardCount, 2);
  for (let index = 0; index < pickTargets; index += 1) {
    await picks.nth(index).click();
  }
  const pickedCount = await page.evaluate(
    () => document.querySelectorAll('.lib-card .dl-pick[data-picked="1"]').length,
  );
  assert(pickedCount === pickTargets, `勾选 ${pickTargets} 条（渲染事实 data-picked=1 有 ${pickedCount} 个）`);
  assert(await page.locator('.dl-open').isEnabled(), '勾选后「📦 交付包」可用');

  await page.locator('.dl-open').click();
  await page.waitForSelector('.dl-panel', { timeout: 5_000 });
  assert(true, '交付面板打开（预设 / 项目前缀 / 四项内容 / 命名示例）');
  assert(
    (await page.locator('.dl-preset option').count()) === 5,
    `平台规格预设五档齐全（实际 ${await page.locator('.dl-preset option').count()}）`,
  );
  const nameHint = await page.locator('.dl-hint').innerText();
  assert(
    nameHint.includes('命名示例') && nameHint.includes('抖音竖屏'),
    `命名示例按模板展示（「${nameHint}」）`,
  );

  const deliverDownload = page.waitForEvent('download', { timeout: 60_000 });
  await page.locator('[data-testid="dl-build"]').click();
  const deliverFile = await deliverDownload;
  const deliverPath = path.join(EXPORT_DIR, 'deliverable.zip');
  await deliverFile.saveAs(deliverPath);
  const suggested = deliverFile.suggestedFilename();
  assert(
    /^.+-\d{8}-抖音竖屏-\d+条\.zip$/.test(suggested),
    `包名符合模板（实际「${suggested}」）`,
  );

  const zipBytes = readFileSync(deliverPath);
  const zipNames = readZipNames(new Uint8Array(zipBytes));
  assert(zipNames.length >= 2, `包里有 ${zipNames.length} 个条目`);
  assert(
    zipNames.includes('交付清单.json'),
    `归档清单随包（${zipNames.slice(0, 4).join(' / ')}）`,
  );
  assert(
    zipNames.filter((name) => name.endsWith('.mp4')).length === pickTargets,
    `成片数量与勾选一致（${zipNames.filter((name) => name.endsWith('.mp4')).length} / ${pickTargets}）`,
  );
  assert(
    zipNames.some((name) => /-\d{8}-0?1-抖音竖屏-/.test(name)),
    '成片命名带日期戳与序号（交付顺序按名字排序即可读）',
  );
  await page.waitForFunction(
    () => document.body.innerText.includes('交付包已生成'),
    null,
    { timeout: 10_000 },
  );
  assert(true, '界面回报「交付包已生成」（含包名与文件数）');
  assert(
    (await page.locator('.dl-panel').count()) === 0,
    '打包成功后交付面板自动收起（界面不会停在过期计划上）',
  );

  console.log('\n[6l] 交付包 · 按预设转码（V2.14 / B49 片 B：画幅 cover 对齐，ffprobe 复核）');
  // 口径：复用剪辑台导出链路（Remotion composition → web-renderer → WebCodecs），
  // **不引新依赖、不占服务器 CPU**；这里用 ffprobe 复核产物尺寸 —— 渲染说"我转了"不算数，文件说了算。
  await page.locator('.dl-open').click();
  await page.waitForSelector('.dl-panel', { timeout: 5_000 });
  const transcodeBox = page.locator('[data-testid="dl-transcode"]');
  assert(await transcodeBox.isVisible(), '交付面板出现「按预设重新渲染」开关（默认关）');
  assert((await transcodeBox.isChecked()) === false, '转码默认关闭（它慢，客户可能只想改名打包）');
  await transcodeBox.check();

  const transcodeDownload = page.waitForEvent('download', { timeout: 240_000 });
  await page.locator('[data-testid="dl-build"]').click();
  const transcodeFile = await transcodeDownload;
  const transcodePath = path.join(EXPORT_DIR, 'deliverable-transcoded.zip');
  await transcodeFile.saveAs(transcodePath);
  assert(true, `转码交付包已下载（${transcodeFile.suggestedFilename()}）`);

  const transcodeZip = new Uint8Array(readFileSync(transcodePath));
  const transcodeNames = readZipNames(transcodeZip);
  const mp4Name = transcodeNames.find((name) => name.endsWith('.mp4'));
  assert(mp4Name !== undefined, `包里有成片（${transcodeNames.join(' / ')}）`);

  const extractEntry = (buffer, wanted) => {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const decoder = new TextDecoder();
    let cursor = 0;
    while (cursor + 30 <= buffer.length) {
      if (view.getUint32(cursor, true) !== 0x0403_4b50) break;
      const size = view.getUint32(cursor + 18, true);
      const nameLength = view.getUint16(cursor + 26, true);
      const extraLength = view.getUint16(cursor + 28, true);
      const name = decoder.decode(buffer.subarray(cursor + 30, cursor + 30 + nameLength));
      const start = cursor + 30 + nameLength + extraLength;
      if (name === wanted) return buffer.subarray(start, start + size);
      cursor = start + size;
    }
    return null;
  };

  const mp4Bytes = extractEntry(transcodeZip, mp4Name);
  assert(mp4Bytes !== null && mp4Bytes.length > 0, `从包里取出成片（${mp4Bytes?.length ?? 0} 字节）`);
  const transcodeOut = path.join(EXPORT_DIR, 'transcoded.mp4');
  writeFileSync(transcodeOut, mp4Bytes);
  const transcodeProbe = await ffprobeJson(transcodeOut);
  const videoStreamOut = transcodeProbe.streams.find((stream) => stream.codec_type === 'video');
  const sourceProbeForSize = await ffprobeJson(
    `${baseUrl}${await page.evaluate(async () => {
      const data = await (await fetch('/api/history')).json();
      return (data.items ?? [])[0]?.outputVideoUrl ?? '/api/health';
    })}`,
  );
  const sourceVideo = sourceProbeForSize.streams.find((stream) => stream.codec_type === 'video');
  assert(
    videoStreamOut?.width === 1080 && videoStreamOut?.height === 1920,
    `转码产物画幅 = 抖音竖屏（${videoStreamOut?.width}×${videoStreamOut?.height}，期望 1080×1920）`,
  );
  assert(
    videoStreamOut?.width !== sourceVideo?.width,
    `产物的确重新渲染过（源片 ${sourceVideo?.width}×${sourceVideo?.height} → ${videoStreamOut?.width}×${videoStreamOut?.height}）`,
  );
  const sourceDuration = Number(sourceProbeForSize.format.duration);
  const outDuration = Number(transcodeProbe.format.duration);
  assert(
    Math.abs(outDuration - sourceDuration) <= 0.3,
    `时长未被改动（源 ${sourceDuration.toFixed(2)}s → 产物 ${outDuration.toFixed(2)}s）`,
  );

  const manifestBytes = extractEntry(transcodeZip, '交付清单.json');
  const manifestJson = JSON.parse(new TextDecoder().decode(manifestBytes));
  assert(
    manifestJson.items.every((item) => item.transcoded === true),
    '清单逐条标了 transcoded: true（客户系统据此知道哪些是重编码产物）',
  );
  assert(
    manifestJson.notes.some((note) => note.includes('按平台规格重新渲染过')),
    '清单口径说明了转码含义（cover 裁切 / 帧率归一 / 时长未改动）',
  );

  console.log('\n[7] 操作日志（V2.1，CONTRACT §10）');
  // 上面 [6] 段用界面真的提交过一条任务 → 它必须已经躺在操作日志里。
  // 这条断言把"界面动作 → 服务端留痕"整条链钉住（也是这次故障排错最需要的能力）。
  const submitRows = await page.evaluate(async () => {
    const response = await fetch('/api/logs?action=generate.submit&limit=5');
    const payload = await response.json();
    return { total: payload.total, paths: (payload.items ?? []).map((item) => item.path) };
  });
  assert(submitRows.total > 0, `界面提交的生成任务已记入操作日志（action=generate.submit，${submitRows.total} 条）`);
  assert(submitRows.paths.includes('/api/generate'), '日志里能看到 /api/generate 这条记录');

  // V2.18（B23）/ V2.24（B73）：保留策略**默认不删任何东西**（分级阈值 正常 30 天 / 异常 180 天、
  // 20 万条都没到）→ 日志里不该出现 `log.prune`。这条断言同时证明两件事：
  // 守护流程跑过（没抛错），以及它**没有乱删**（噪声纪律：没删就不留痕）。
  const pruneRows = await page.evaluate(async () => {
    const response = await fetch('/api/logs?action=log.prune&limit=5');
    return (await response.json()).total;
  });
  assert(
    pruneRows === 0,
    `默认保留策略下没有日志被删（log.prune 记录数 = ${pruneRows}，未超分级阈值 30/180 天、20 万条）`,
  );

  // V9：日志从顶栏弹层升级为一级视图（D33）—— 从侧栏导航进入 `#/logs`
  await page.getByRole('link', { name: '操作日志' }).click();
  await page.locator('.wb-log-panel').waitFor({ timeout: 5_000 });
  assert(true, '侧栏点「操作日志」→ 日志一级视图（#/logs）');
  assert(
    (await page.locator('.wb-log-filters select').count()) >= 2,
    '筛选器含时间范围与动作下拉（按 IP / 错误码 / 关键词也能筛）',
  );
  // 列表是异步拉的：先等第一行出现，再断言（否则测的是"请求发出前"的 DOM）
  await page.locator('.wb-log-row').first().waitFor({ timeout: 10_000 });
  assert((await page.locator('.wb-log-row').count()) > 0, '日志列表渲染出了记录行');

  // 展开一条看详情：requestId / 请求体 / 诊断字段是排错时唯一能靠的东西
  await page.locator('.wb-log-row-main').first().click();
  assert((await page.locator('.wb-log-detail').count()) === 1, '点击记录可展开详情（requestId 与请求体）');

  // 噪声纪律：日志页自己每 3s 轮询一次 —— 如果把自己也记下来，这个功能等于白做
  const selfRows = await page.evaluate(async () => {
    const response = await fetch('/api/logs?limit=200');
    const payload = await response.json();
    return (payload.items ?? []).filter((item) => String(item.path).startsWith('/api/logs')).length;
  });
  assert(selfRows === 0, '日志页自身的轮询没有被记进日志（噪声纪律）');

  // V9 · B5：导出当前筛选结果为 JSON（排错时把日志交给别人的正道）
  const downloadPromise = page.waitForEvent('download', { timeout: 5_000 });
  await page.getByRole('button', { name: '导出 JSON' }).click();
  const download = await downloadPromise;
  assert(
    download.suggestedFilename().startsWith('astrmira-logs-'),
    `导出 JSON 触发下载（${download.suggestedFilename()}）`,
  );
  // B5：侧栏「操作日志」的红点。口径要说清：它是**壳挂载时的快照**（不随新错误实时更新），
  // 所以这里断言的是"没有失败请求时不伪造提醒"（可判定），而不是"一定有红点"（会变成看运气）。
  const errorRows = await page.evaluate(async () => {
    const data = await (await fetch('/api/logs?limit=100')).json();
    return (data.items ?? []).filter((item) => item.errorCode !== undefined).length;
  });
  const logBadges = await page.locator('.sidebar .nav-item[href="#/logs"] .nav-badge').count();
  if (errorRows === 0) {
    assert(logBadges === 0, '没有失败请求时不显示红点（不伪造提醒）');
  } else {
    assert(logBadges <= 1, `有失败请求时最多一个红点徽标（实际 ${logBadges}）`);
  }

  await page.screenshot({ path: path.join(SHOT_DIR, 'logs.png'), fullPage: false });
  note('日志截图留档：artifacts/ui-smoke/logs.png');

  console.log('\n[7b] 动效体系（V9 · B6：reduced-motion 双 context 对照）');
  // 先切到视频库：卡片级联的探针要挑一个真的有 `.lib-card` 的视图
  await page.evaluate(() => { location.hash = '#/library'; });
  await page.locator('.lib-card').first().waitFor({ timeout: 10_000 });

  // 本页所在的 context 是 `reducedMotion: 'reduce'`，在这里断言"归零"是顺理成章的 ——
  // 但**只有这一侧时断言可能是恒真的**（动画压根没挂上，computed 照样是 0.01ms）。
  // 所以同时开一个 normal motion 的 context：同一份产物、同一个选择器，必须给出**真实时长**。
  const pickDurations = () => {
    const pick = (selector) => {
      const el = document.querySelector(selector);
      if (el === null) return null;
      const raw = getComputedStyle(el).animationDuration;
      // ⚠️ 不要拿字符串比对：Chromium 会把 tokens.css 里的 `0.01ms` 序列化成 `1e-05s`
      // （科学计数法 + 换了单位）。统一解析成"秒"再比数量级，断言才不依赖浏览器的格式化。
      const seconds = Number.parseFloat(raw);
      return { raw, seconds: Number.isFinite(seconds) ? seconds : null };
    };
    return { view: pick('.wb-page'), card: pick('.lib-card') };
  };

  const reduceDurations = await page.evaluate(pickDurations);
  assert(
    reduceDurations.view.seconds !== null && reduceDurations.view.seconds <= 0.001,
    `reduce 档：视图入场动画被压到接近 0（实际 ${reduceDurations.view.raw}）`,
  );
  assert(
    reduceDurations.card.seconds !== null && reduceDurations.card.seconds <= 0.001,
    `reduce 档：卡片级联被压到接近 0（实际 ${reduceDurations.card.raw}）`,
  );

  const motionContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    // 刻意**不设** reducedMotion：对照组要看的就是"动效真实存在"
  });
  const motionPage = await motionContext.newPage();
  await motionPage.goto(`${baseUrl}/#/library`, { waitUntil: 'load' });
  await motionPage.waitForSelector('.lib-card', { timeout: 10_000 });
  const normalDurations = await motionPage.evaluate(pickDurations);
  assert(
    normalDurations.view.seconds !== null && normalDurations.view.seconds > 0.05,
    `normal 档：视图入场动画真实存在（${normalDurations.view.raw}）`,
  );
  assert(
    normalDurations.card.seconds !== null && normalDurations.card.seconds > 0.05,
    `normal 档：卡片级联真实存在（${normalDurations.card.raw}）`,
  );

  // 生成中微光晕（动效项④）：由 CenterPanel 的 data-status 驱动 —— 这里只验证选择器契约存在
  // （真正的呼吸效果需要跑一条 running 任务才能看到，那在 [6] 段已有覆盖；此处不做假断言）
  const glowRuleExists = await motionPage.evaluate(() => {
    const sheets = Array.from(document.styleSheets);
    for (const sheet of sheets) {
      let rules;
      try {
        rules = Array.from(sheet.cssRules);
      } catch {
        continue; // 跨源样式表（本项目没有，留个兜底）
      }
      for (const rule of rules) {
        // 不比对引号形式：CSSOM 会把 tokens/workbench 里的单引号属性选择器规范化成双引号
        if (rule.cssText?.includes('data-status') && rule.cssText.includes('breathe-glow')) {
          return true;
        }
      }
    }
    return false;
  });
  assert(glowRuleExists, '生成中微光晕的挂接规则存在（data-status=running → breathe-glow）');
  await motionContext.close();

  console.log('\n[7c] 移动端（V9 · B7：390×844，Step 6-AC7 的第二档；B60：触屏四件套）');
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    // `isMobile + hasTouch` 才会让 `(hover: none) / (pointer: coarse)` 命中（B60 的触屏断言
    // 依赖它；实测仅设 viewport 时两个媒体特性都是 false —— 桌面浏览器语义）
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await mobileContext.newPage();
  await mobile.goto(`${baseUrl}/#/workbench`, { waitUntil: 'load' });
  await mobile.waitForSelector('.wb-main', { timeout: 10_000 });

  // ① 侧栏默认被推到视口外（overlay 抽屉未打开）
  const closedBox = await mobile.locator('.sidebar').boundingBox();
  assert(
    closedBox === null || closedBox.x + closedBox.width <= 1,
    `移动端侧栏默认在视口外（right=${closedBox === null ? 'null' : Math.round(closedBox.x + closedBox.width)}）`,
  );

  // ② 汉堡 → 抽屉滑入 + 遮罩出现
  assert(await mobile.locator('.wb-burger').isVisible(), '窄屏显示汉堡按钮');
  await mobile.locator('.wb-burger').click();
  await mobile.waitForFunction(
    () => (document.querySelector('.sidebar')?.getBoundingClientRect().x ?? -999) >= 0,
    { timeout: 5_000 },
  );
  assert(true, '点汉堡后侧栏滑入视口（overlay 抽屉形态）');
  assert(await mobile.locator('.sidebar-scrim').isVisible(), '抽屉展开时有遮罩层');

  // 点导航项 → 抽屉收起（否则内容被挡着）
  await mobile.getByRole('link', { name: '视频库' }).click();
  await mobile.waitForFunction(
    () => (document.querySelector('.sidebar')?.getBoundingClientRect().x ?? 0) < 0,
    { timeout: 5_000 },
  );
  assert(true, '点导航项后抽屉自动收起');

  // ③ 三栏纵向堆叠（控制区在前）
  await mobile.evaluate(() => { location.hash = '#/workbench'; });
  await mobile.waitForSelector('.wb-main', { timeout: 5_000 });
  const stack = await mobile.evaluate(() =>
    // 限定当前可见的 keepalive 层：创作入口（B41）也是常驻视图，隐藏副本里有自己的 .wb-main
    Array.from(document.querySelectorAll('.wb-keepalive:not([hidden]) .wb-main > *')).map((el) => {
      const box = el.getBoundingClientRect();
      return { x: Math.round(box.x), y: Math.round(box.y) };
    }),
  );
  assert(stack.length === 3, `三栏数量不变（${stack.length}）`);
  assert(
    stack[0].x === stack[1].x && stack[1].x === stack[2].x,
    `三栏左对齐（x=${stack.map((item) => item.x).join('/')}）`,
  );
  assert(
    stack[0].y < stack[1].y && stack[1].y < stack[2].y,
    `三栏纵向堆叠（y=${stack.map((item) => item.y).join('/')}）`,
  );

  // ④ 画廊单列
  await mobile.evaluate(() => { location.hash = '#/library'; });
  await mobile.waitForSelector('.lib-card', { timeout: 10_000 });
  const columnCount = await mobile.evaluate(
    () => getComputedStyle(document.querySelector('.lib-grid')).gridTemplateColumns.split(' ').length,
  );
  assert(columnCount === 1, `窄屏画廊单列（实际 ${columnCount} 列）`);

  // ⑤ 触屏兜底（B60）：hover:none 命中 + hover-only 操作常显 + 点击高亮关闭 + 字号下限
  // 前提：`isMobile + hasTouch` 的 emulation 才会让 `(hover: none)` 命中（实测：仅 viewport 不命中）
  const touchFacts = await mobile.evaluate(() => {
    const acts = document.querySelector('.lib-acts');
    return {
      hoverNone: matchMedia('(hover: none)').matches,
      pointerCoarse: matchMedia('(pointer: coarse)').matches,
      actsOpacity: acts === null ? '(缺 .lib-acts)' : getComputedStyle(acts).opacity,
      tapHighlight: getComputedStyle(document.documentElement).webkitTapHighlightColor,
      fsNote: getComputedStyle(document.documentElement).getPropertyValue('--fs-note').trim(),
    };
  });
  assert(
    touchFacts.hoverNone && touchFacts.pointerCoarse,
    '移动 emulation 下 (hover: none) / (pointer: coarse) 命中（触屏兜底的前提）',
  );
  assert(
    touchFacts.actsOpacity === '1',
    `触屏下视频库操作区常显（hover-only 不再对触屏隐藏；opacity=${touchFacts.actsOpacity}）`,
  );
  assert(
    touchFacts.tapHighlight === 'rgba(0, 0, 0, 0)',
    `触屏点击高亮已关闭（实际 ${touchFacts.tapHighlight}）`,
  );
  assert(touchFacts.fsNote === '12px', `≤768 的小字号档抬到 12px（--fs-note 实际 ${touchFacts.fsNote}）`);

  // ⑥ 日志页窄屏不再横向溢出（B60：六列固定宽在 375px 必溢出，且会被全局 overflow-x:hidden 剪掉）
  await mobile.evaluate(() => { location.hash = '#/logs'; });
  await mobile.waitForSelector('.wb-log-row-main', { timeout: 10_000 });
  const logFacts = await mobile.evaluate(() => {
    const row = document.querySelector('.wb-log-row-main');
    return {
      columns: getComputedStyle(row).gridTemplateColumns.split(' ').length,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
  assert(logFacts.columns <= 2, `日志行窄屏收成两列（实际 ${logFacts.columns} 列）`);
  assert(
    logFacts.scrollWidth <= logFacts.clientWidth + 1,
    `日志页无横向溢出（scrollWidth=${logFacts.scrollWidth} ≤ clientWidth=${logFacts.clientWidth}）`,
  );

  // ⑦ 全部主要视图在 **375px** 下都不横向溢出（B61 的 ③ 项 —— B60 只覆盖了日志页）
  //
  // 为什么这条值得单独铺一遍：本仓是"高密度工作台"（六列日志表 / 三栏网格 / 画布工具条 /
  // 调试台两列），任何一处撑破视口都不会以"能横滑"的形式暴露 —— 全局 `overflow-x: hidden`
  // 会把溢出的部分**直接剪掉**，表现为"右边的按钮不见了"。所以判据取
  // scrollWidth ≤ clientWidth + 1（1px 给亚像素舍入）。
  // 375 = 最窄的主流机型宽度（iPhone SE），比 390 更严 —— 不通过就说明**内容真的丢了**。
  await mobile.setViewportSize({ width: 375, height: 812 });
  const NARROW_VIEWS = [
    ['#/workbench', '.wb-main', '创作工作台'],
    ['#/library', '.lib-card', '视频库'],
    ['#/logs', '.wb-log-row-main', '操作日志'],
    ['#/create', '.cr-panel', '创作入口'],
    ['#/canvas', '.cv-wrap', '血缘画布'],
  ];
  const narrowOverflows = [];
  for (const [hash, selector, name] of NARROW_VIEWS) {
    await mobile.evaluate((target) => {
      location.hash = target;
    }, hash);
    // 视图可能因夹具数据为空而没有该选择器 —— 那也照样要量溢出（不跳过测量）
    await mobile.waitForSelector(selector, { timeout: 10_000 }).catch(() => {});
    const fact = await mobile.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    if (fact.scrollWidth > fact.clientWidth + 1) {
      narrowOverflows.push(`${name}（${hash}）scrollWidth=${fact.scrollWidth} > ${fact.clientWidth}`);
    }
  }
  assert(
    narrowOverflows.length === 0,
    `375px 下五个主要视图都无横向溢出（${narrowOverflows.join('；') === '' ? '全部合格' : narrowOverflows.join('；')}）`,
  );

  // 截图恢复成 390×844（本段 §⑤⑥ 的口径，也是 artifacts 里 mobile.png 的一贯尺寸）
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.screenshot({ path: path.join(SHOT_DIR, 'mobile.png'), fullPage: false });
  note('移动端截图留档：artifacts/ui-smoke/mobile.png');
  await mobileContext.close();

  console.log('\n[7d] 创作入口（V2.7 / B41：@ 提及 + 素材 chips + 模式摘要 + 更多设置收起）');
  // 重载一次保证素材池拿到 [6] 段造的夹具成片（创作入口是 keepalive 常驻视图，不随导航重挂载）
  await page.goto(`${baseUrl}/#/create`, { waitUntil: 'load' });
  await page.waitForSelector('.cr-panel', { timeout: 10_000 });
  assert(true, '创作入口渲染（#/create 落地即「造梦盒」）');

  // ── B43（V2.9）：资产原始文件名 —— 只落本地，但界面要能按名字认素材 ──────────
  // 用 API 上传一张**有名字**的图（借夹具任务的封面当素材：真实 JPEG + 真实 multipart）。
  // 注意：冒烟跑的是**自己的临时 OUTPUT_DIR**（不是仓库 outputs/）——首版写错目录，实测踩点。
  const thumbDir = path.join(OUTPUTS_DIR, 'thumbs');
  const thumbNames = existsSync(thumbDir) ? readdirSync(thumbDir).filter((n) => n.endsWith('.jpg')) : [];
  assert(thumbNames.length > 0, '存在夹具封面文件（B43 上传素材的来源）');
  const uploadForm = new FormData();
  uploadForm.append(
    'files',
    new Blob([readFileSync(path.join(thumbDir, thumbNames[0]))], { type: 'image/jpeg' }),
    '海边参考图.jpg',
  );
  const uploadRes = await fetch(`${baseUrl}/api/upload`, { method: 'POST', body: uploadForm });
  assert(uploadRes.ok, `B43：上传带文件名的资产成功（HTTP ${uploadRes.status}）`);
  const uploadedAsset = (await uploadRes.json()).assets[0];
  const assetRes = await fetch(`${baseUrl}/api/assets`);
  const assetEntry = (await assetRes.json()).assets.find((a) => a.assetId === uploadedAsset.assetId);
  assert(assetEntry?.name === '海边参考图.jpg', 'B43：/api/assets 透出原始文件名（sidecar 只落本地）');

  await page.locator('.cr-hint-row .cr-recipe').click(); // 打开弹层
  await page.waitForSelector('.cr-mention', { timeout: 5_000 });
  await page.locator('.cr-mention-search').fill('海边');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.cr-mention-label')].some((el) =>
        (el.textContent ?? '').includes('海边参考图'),
      ),
    { timeout: 5_000 },
  );
  assert(true, 'B43：弹层按原始文件名过滤命中（大小写不敏感，assetId 仍可搜）');
  await page.locator('.cr-mention-item', { hasText: '海边参考图' }).first().click();
  await page.waitForSelector('.cr-chip', { timeout: 5_000 });
  // B32：加入图片素材后出现"真人素材会被上游隐私检测拒绝"的前置提示（引导，不阻断）
  await page.waitForSelector('.cr-realperson-note', { timeout: 5_000 });
  assert(true, 'B32：图片素材下出现真人素材前置提示（只做引导，不假装检测）');
  await page.locator('.cr-chip-remove').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.cr-chip').length === 0, {
    timeout: 5_000,
  });

  // @ 提及：显式按钮打开弹层 → 候选里有刚造的成片 → 选中成 chip（chip 提交制，引用不进文本）
  await page.locator('.cr-hint-row .cr-recipe').click();
  await page.waitForSelector('.cr-mention', { timeout: 5_000 });
  const mentionItems = page.locator('.cr-mention-item');
  await page.waitForFunction(
    () => document.querySelectorAll('.cr-mention-item').length >= 1,
    { timeout: 10_000 },
  );
  assert(true, `@ 弹层列出候选素材（${await mentionItems.count()} 条）`);
  await mentionItems.first().click();
  await page.waitForSelector('.cr-chip', { timeout: 5_000 });
  assert(true, '选中后生成素材 chip（引用是结构化 chips，不是文本里的 @）');
  assert(
    (await page.locator('.cr-mode-tag').innerText()).includes('视频参考'),
    '模式摘要行按素材推断为「视频参考」（素材决定模式，与三槽同一纪律）',
  );

  // 移除 chip → 模式回落文生视频（不留下悬空状态）
  await page.locator('.cr-chip-remove').first().click();
  await page.waitForFunction(
    () => (document.querySelector('.cr-mode-tag')?.textContent ?? '').includes('文生视频'),
    { timeout: 5_000 },
  );
  assert(true, '移除 chip 后模式回落到「文生视频」');

  // 更多设置默认收起（D39：控件分层），展开后出现高级项
  assert((await page.locator('.cr-more').count()) === 0, '「更多设置」默认收起（首页不是第二个工作台）');
  await page.getByRole('button', { name: /更多设置/ }).click();
  await page.waitForSelector('.cr-more', { timeout: 5_000 });
  assert(true, '展开后出现高级设置（画幅 / 时长 / 清晰度 / 引擎 / seed）');

  // 空提示词 → 提交按钮置灰（防线 6 的前端半边）
  assert(await page.locator('.cr-submit').isDisabled(), '空提示词时提交按钮置灰');

  // 造梦盒必须拿到整幅宽度（曾误用工作台三栏栅格 .wb-main → 被挤成 380px 窄条）
  const createPanelBox = await page.locator('.cr-panel').boundingBox();
  assert(
    createPanelBox !== null && createPanelBox.width >= 600,
    `造梦盒占据整幅宽度（实际 ${createPanelBox === null ? 'null' : Math.round(createPanelBox.width)}px）`,
  );
  // V2.23（台账 B71）：行业模板 —— 一键填入"起手式"（提示词 + 画幅/时长/清晰度）
  const templateChips = page.locator('.cr-templates .cr-recipe-tpl');
  const templateCount = await templateChips.count();
  assert(templateCount >= 3, `行业模板 chips 就位（${templateCount} 个行业）`);
  await page.getByTestId('cr-template-lighting-midcentury').click();
  await page.waitForTimeout(300);
  const templatedPrompt = await page.locator('textarea.cr-input').inputValue();
  assert(
    templatedPrompt.includes('logo') && templatedPrompt.length > 40,
    '点模板 → 提示词骨架被整段填入（含"不要出现文字或 logo"的纪律）',
  );
  assert(
    (await page.locator('.cr-alert').first().innerText()).includes('已套用'),
    '界面如实说明"套用了哪个模板、推荐什么参数"（不假装已切换模式）',
  );

  await page.screenshot({ path: path.join(SHOT_DIR, 'create.png'), fullPage: false });
  note('创作入口截图留档：artifacts/ui-smoke/create.png');

  console.log('\n[7e] 血缘画布（P4 / B42：L2 只读 DAG）');
  // V2.19（台账 B63）：注入一条**失败**与一条**不确定**任务，用来验"执行态与失败链"。
  //
  // 为什么直接写临时库而不是走 HTTP 提交：生成路由有 **60s 防抖冷却**（防线 5），
  // 而这里要验的是"画布怎么画异常节点"，不是生成链路 —— 再等 60s 只为了让第二个任务走同一条链路，
  // 对这条断言毫无增益。**只动本脚本自己的临时库**（`DATA_DIR` 是 mkdtemp 出来的，跑完即弃）。
  {
    const Database = require(path.join(ROOT, 'backend', 'node_modules', 'better-sqlite3'));
    const db = new Database(path.join(DATA_DIR, 'app.db'));
    const now = Date.now();
    const insert = db.prepare(
      `INSERT OR REPLACE INTO tasks (task_id, track, provider, status, progress_percent,
                                     request_snapshot, warnings, error, submitting, project_id,
                                     created_at, updated_at)
       VALUES (?, 'cloud', 'cloud-volcano-seedance', 'failed', 0, ?, ?, ?, 0, 'default', ?, ?)`,
    );
    const snapshot = JSON.stringify({
      prompt: '冒烟：这条注定失败（用于验证画布的执行态）',
      mode: 't2v',
      aspectRatio: '16:9',
      provider: 'cloud-volcano-seedance',
    });
    insert.run(
      'smoke-failed-task',
      snapshot,
      JSON.stringify(['冒烟注入：上游返回 500']),
      JSON.stringify({ code: 'UPSTREAM_ERROR', message: '上游 500（冒烟注入）', disposition: 'terminal' }),
      now,
      now,
    );
    insert.run(
      'smoke-uncertain-task',
      snapshot,
      '[]',
      // ⚠️ 错误码必须是契约 §6 字典里的值（12 个）：这里第一版写了 `UPSTREAM_TIMEOUT`，
      // 结果读路径的 schema 校验直接把它挡了（画布拿到 500 → 一个节点都画不出来）。
      // "已提交但无法确认结果"的**正确**取值是 `UNCERTAIN_RESULT`。
      JSON.stringify({
        code: 'UNCERTAIN_RESULT',
        message: '上游超时，结果不明（冒烟注入）',
        disposition: 'uncertain',
      }),
      now - 1000,
      now - 1000,
    );
    // 两条终态留痕：真实链路里 `SqliteJobQueue` 到终态**一定会写**（CONTRACT §10 V2.4），
    // 所以这里补上 —— 既是给画布检查器断言用，也是"注入了异常任务却不留痕"这种不自洽的避免
    const log = db.prepare(
      `INSERT INTO event_log (ts, method, path, action, status_code, task_id, disposition)
       VALUES (?, 'TASK', ?, ?, ?, ?, ?)`,
    );
    log.run(now, '/api/tasks/smoke-failed-task', 'task.fail', 200, 'smoke-failed-task', 'terminal');
    log.run(
      now - 1000,
      '/api/tasks/smoke-uncertain-task',
      'task.uncertain',
      200,
      'smoke-uncertain-task',
      'uncertain',
    );
    db.close();
    note('已注入 1 条失败 + 1 条不确定任务（验证执行态与失败链；只动临时库）');
  }

  await page.goto(`${baseUrl}/#/canvas`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('.cv-node').length >= 1, {
    timeout: 15_000,
  });
  const canvasNodes = page.locator('.cv-node');
  assert(true, `画布渲染节点（${await canvasNodes.count()} 个）`);
  assert(
    (await page.locator('.cv-legend-item').count()) === 4,
    '图例齐全（剪辑自 / 抽帧 / 素材参考 / 成片参考四类派生边）',
  );

  // 只读断言①：连线锚点不可交互（.cv-handle 是隐形锚点，pointer-events: none）
  const handleInert = await page.evaluate(() => {
    const handle = document.querySelector('.cv-handle');
    return handle === null ? false : getComputedStyle(handle).pointerEvents === 'none';
  });
  assert(handleInert, '只读：连线锚点不可交互（pointer-events: none）');

  // 只读断言①b（行为）：从节点边缘拖到另一节点**不产生新边**（拖拽只是挪位置）
  const edgesBefore = await page.locator('.cv-canvas .react-flow__edge').count();
  const boxA = await canvasNodes.first().boundingBox();
  const boxB = await canvasNodes.nth(1).boundingBox();
  assert(boxA !== null && boxB !== null, '至少两个节点有可视几何（画布可交互）');
  if (boxA !== null && boxB !== null) {
    await page.mouse.move(boxA.x + boxA.width - 2, boxA.y + boxA.height / 2);
    await page.mouse.down();
    await page.mouse.move(boxB.x + boxB.width / 2, boxB.y + boxB.height / 2, { steps: 8 });
    await page.mouse.up();
    assert(
      (await page.locator('.cv-canvas .react-flow__edge').count()) === edgesBefore,
      '只读：拖拽不会产生新边',
    );
  }

  // 画布容器必须拿到整幅宽度（曾误用工作台三栏栅格 .wb-main → 被挤成 380px，节点缩到 0.4 倍）
  const canvasBox = await page.locator('.cv-canvas').boundingBox();
  assert(
    canvasBox !== null && canvasBox.width >= 600,
    `画布占据整幅宽度（实际 ${canvasBox === null ? 'null' : Math.round(canvasBox.width)}px）`,
  );

  // ⚠️ 各块**自备前置**（2026-10-10：B67 的 Esc 取消选择曾让下游的"选中后按钮可用"失败）——
  // 断言不要依赖"上一段刚好留下了什么状态"（见下面 B64 段开头的那次点击）

  // 点节点 → 详情抽屉（动作按钮指向既有 hash 参数）
  await canvasNodes.first().click();
  await page.waitForSelector('.cv-drawer', { timeout: 5_000 });
  assert(true, '点节点弹出详情抽屉');
  assert(
    (await page.locator('.cv-drawer-actions .wb-btn').count()) >= 1,
    '抽屉里有动作入口（复用参数 / 送剪辑台 / 设为视频参考…）',
  );

  // V2.19（台账 B63）：执行态与失败链（上面注入的失败/不确定任务必须被画出来）
  const statusLine = page.getByTestId('cv-status');
  assert((await statusLine.count()) === 1, '状态条渲染（异常计数 + 只看异常 + 排队实况）');
  assert(
    (await statusLine.innerText()).includes('2 个节点异常'),
    `异常计数正确（实际「${(await statusLine.innerText()).replace(/\n/g, ' ')}」）`,
  );
  assert(
    (await page.locator('.cv-node[data-status="failed"]').count()) >= 1 &&
      (await page.locator('.cv-node[data-status="uncertain"]').count()) >= 1,
    '失败与不确定两类节点都如实标出（不确定 = 可能已产生费用）',
  );
  assert(
    (await page.locator('.cv-node-problem').count()) === 2,
    '异常节点带 .cv-node-problem（红边框 + 红状态点）',
  );

  // 「只看异常」：不删图，只把无关节点调暗
  const focusToggle = page.getByTestId('cv-focus-problems');
  await focusToggle.click();
  await page.waitForTimeout(250);
  assert(
    (await page.locator('.cv-canvas').getAttribute('data-focus')) === 'problems',
    '点「只看异常」→ 画布进入聚焦态（data-focus=problems）',
  );
  await focusToggle.click();
  await page.waitForTimeout(250);
  assert(
    (await page.locator('.cv-canvas').getAttribute('data-focus')) === 'all',
    '再点一次 → 回到全部（可逆，不删节点）',
  );

  // V2.19（台账 B62）：节点检查器 —— 点节点能看到"这条片子的一切"
  // ⚠️ 要点**任务**节点（资产节点只有"资产"一段：它没有提示词/成本/留痕）
  await page.locator('.cv-canvas .cv-node-task').first().click();
  await page.waitForTimeout(300);
  const inspSections = await page.locator('.cv-drawer .cv-insp-section').count();
  assert(
    inspSections >= 3,
    `检查器分区齐全（提示词 / 成本 / 留痕 / 血缘 共 ${inspSections} 段）`,
  );
  const promptText = (await page.locator('.cv-insp-prompt').first().innerText()).trim();
  assert(promptText.length > 0, `提示词快照可见（${promptText.slice(0, 20)}…）`);
  const inspKv = await page.locator('.cv-drawer .cv-insp-kv dd').count();
  assert(inspKv >= 4, `参数键值对渲染（模式/画幅/时长/产物 共 ${inspKv} 项）`);

  // ⭐ 这条同时验证了 V2.19 新增的 `?taskId=` 日志筛选（契约 §10）：留痕里必须有这条任务的事件
  await page.waitForSelector('.cv-drawer .cv-log-row', { timeout: 10_000 });
  const logRows = await page.locator('.cv-drawer .cv-log-row').count();
  assert(logRows >= 1, `该任务的留痕可见（${logRows} 条，走 /api/logs?taskId=）`);

  // 血缘跳转：有可跳的邻居时，点一下应该换到那个节点的检查器（标题变化）
  const jump = page.locator('.cv-drawer .cv-jump:enabled').first();
  if ((await jump.count()) > 0) {
    const titleBefore = await page.locator('.cv-drawer-title').innerText();
    await jump.click();
    await page.waitForTimeout(400);
    assert(
      (await page.locator('.cv-drawer-title').innerText()) !== titleBefore,
      '点血缘跳转 → 检查器切到相邻节点（沿链走）',
    );
  } else {
    note('这张图上没有可跳的相邻节点（夹具任务较少），跳过血缘跳转断言');
  }

  // V2.20（台账 B65）：导出配方包 —— **真下载、真解析、真校验内容**
  const packFile = path.join(tmpdir(), `astrmira-recipe-pack-${Date.now()}.json`);
  const [packDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('cv-export-pack').click(),
  ]);
  await packDownload.saveAs(packFile);
  const pack = JSON.parse(readFileSync(packFile, 'utf8'));
  assert(
    pack.kind === 'astrmira.recipe-pack' && typeof pack.version === 'number',
    `配方包可下载且带格式版本（kind=${pack.kind} · v${pack.version}）`,
  );
  assert(
    Array.isArray(pack.tasks) && pack.tasks.length >= 1 && typeof pack.rootTaskId === 'string',
    `配方包含根任务与链上任务（${pack.tasks.length} 条 · root=${String(pack.rootTaskId).slice(0, 8)}）`,
  );
  // 断言"字段不在"（而不是"字符串不出现"：notes 里会**说明**这件事，那是有意写给接收方的）
  assert(
    pack.tasks.every((item) => !('options' in item) && !('baseUrl' in item)),
    '配方包不含 provider 私有参数（options.baseUrl 可能是内网地址，不外泄）',
  );
  assert(
    (await page.getByTestId('cv-export-result').innerText()).includes('已导出'),
    '界面上如实反馈导出结果（多少条任务 / 多少个资产）',
  );
  rmSync(packFile, { force: true });

  // V2.22（台账 B67）：便签 + 快捷键
  await page.getByTestId('cv-add-note').click();
  await page.waitForSelector('.cv-sticky', { timeout: 5_000 });
  assert(true, '「＋ 便签」在画布上贴出一张便签');
  await page.getByTestId('cv-note-input').fill('冒烟：这是给客户 A 的广告片链');
  await page.keyboard.press('Tab'); // 失焦提交（编辑期间只存本地，失焦才写回）
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForSelector('.cv-sticky', { timeout: 15_000 });
  assert(
    (await page.locator('.cv-sticky').innerText()).includes('客户 A'),
    '便签文本写回本机存储（刷新后仍在）—— 按项目隔离，不上传服务端',
  );

  // 快捷键：Ctrl/Cmd+A 全选（配合「缩放到选区」）· Esc 取消
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  assert(
    await page.getByTestId('cv-zoom-selection').isEnabled(),
    'Ctrl/Cmd+A 全选 → 「缩放到选区」变为可用',
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert(
    await page.getByTestId('cv-zoom-selection').isDisabled(),
    'Esc 取消选择 → 按钮回到置灰（与全选对称）',
  );

  // V2.19（台账 B64）：画布导航 —— 小地图 + 「缩放到选区」（设计参考 n8n，独立实现）
  assert(
    (await page.locator('.cv-canvas .react-flow__minimap').count()) === 1,
    '小地图（MiniMap）已渲染 —— 长血缘图能一眼看出自己在哪',
  );
  const zoomSelection = page.getByTestId('cv-zoom-selection');
  // 自备前置：先明确选中一个节点（上一段 B67 以 Esc 收尾，不能依赖"残留的选中态"）
  await page.locator('.cv-canvas .react-flow__node').first().click();
  await page.waitForTimeout(250);
  const viewportBefore = await page
    .locator('.cv-canvas .react-flow__viewport')
    .getAttribute('style');
  assert(
    await zoomSelection.isEnabled(),
    '选中节点后「缩放到选区」可用（此前已点中一个节点）',
  );
  await zoomSelection.click();
  await page.waitForTimeout(700);
  const viewportAfter = await page
    .locator('.cv-canvas .react-flow__viewport')
    .getAttribute('style');
  assert(
    viewportBefore !== viewportAfter,
    '「缩放到选区」真的改变了视口（行为断言，不只看按钮存在）',
  );

  // 只读断言②：Delete 键不删除节点（deleteKeyCode=null）
  const beforeDelete = await canvasNodes.count();
  await page.keyboard.press('Delete');
  await sleep(250);
  assert((await canvasNodes.count()) === beforeDelete, 'Delete 键不删除节点（只读视图）');

  // ⑨ 画布规模与分页（V2.25 / 台账 B44）
  //
  // 分页与"视口裁剪"都只有在**超过一页（50 条）**时才成立 —— 所以先直接往临时库注入
  // 120 条"更早的任务"（同 B63 的理由：生成路由有 60s 冷却，而这里要验的是画布怎么读、怎么画）。
  // 注入的时间戳都落在既有夹具任务**之前**，保证它们排在"更早"的那几页里。
  {
    const Database = require(path.join(ROOT, 'backend', 'node_modules', 'better-sqlite3'));
    const db = new Database(path.join(DATA_DIR, 'app.db'));
    const now = Date.now();
    const insert = db.prepare(
      `INSERT OR REPLACE INTO tasks (task_id, track, provider, status, progress_percent,
                                     request_snapshot, warnings, submitting, project_id,
                                     created_at, updated_at)
       VALUES (?, 'cloud', 'cloud-volcano-seedance', 'succeeded', 100, ?, '[]', 0, 'default', ?, ?)`,
    );
    const snapshot = JSON.stringify({
      prompt: '冒烟：更早的历史任务（验证画布分页与视口裁剪）',
      mode: 't2v',
      aspectRatio: '16:9',
      provider: 'cloud-volcano-seedance',
    });
    for (let index = 0; index < 120; index += 1) {
      const at = now - (index + 30) * 24 * 60 * 60 * 1000; // 30 天前往回推
      insert.run(`smoke-bulk-${String(index).padStart(3, '0')}`, snapshot, at, at);
    }
    db.close();
    note('已注入 120 条历史任务（验证画布分页与视口裁剪；只动临时库）');
  }

  // 切走再回：画布不是 keepalive 视图，重新挂载才会重拉（第一页）
  await page.evaluate(() => { location.hash = '#/library'; });
  await page.locator('.lib-grid').waitFor({ timeout: 10_000 });
  await page.evaluate(() => { location.hash = '#/canvas'; });
  await page.waitForFunction(() => document.querySelectorAll('.cv-node').length >= 1, {
    timeout: 15_000,
  });

  /**
   * 读**数据层**的已加载节点数（`data-loaded-nodes`）。
   *
   * ⚠️ 不要数 `.cv-node`（DOM）：`onlyRenderVisibleElements` 之后 DOM 数只反映**视口覆盖** ——
   * 大图上"DOM 数不变"完全可能意味着"数据在长、只是没进视口"（第一版就是这样误判的，
   * 三次点击全读到 25，断言全部落空）。
   */
  const loadedNodeCount = () =>
    page
      .locator('[data-testid=cv-canvas]')
      .getAttribute('data-loaded-nodes')
      .then((value) => Number(value ?? '0'));

  const firstPageNodes = await loadedNodeCount();
  assert(
    firstPageNodes >= 50,
    `首屏只加载一页（数据层 ≥50 个节点；实际 ${firstPageNodes}）`,
  );
  const loadEarlier = page.getByTestId('cv-load-earlier');
  assert(await loadEarlier.isEnabled(), '「加载更早」可用（服务端 hasMore=true）');
  assert(
    (await loadEarlier.textContent())?.includes('加载更早') === true,
    '按钮文案是「加载更早」（不是"点一下看看有没有"）',
  );

  await loadEarlier.click();
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector('[data-testid=cv-canvas]');
      return canvas !== null && Number(canvas.getAttribute('data-loaded-nodes') ?? '0') >= 100;
    },
    undefined,
    { timeout: 15_000 },
  );
  const secondPageNodes = await loadedNodeCount();
  assert(
    secondPageNodes >= firstPageNodes + 50,
    `第二次加载向前翻了一整页（数据层 +${secondPageNodes - firstPageNodes} 个节点）`,
  );

  await loadEarlier.click();
  await page.waitForFunction(
    (before) => {
      const canvas = document.querySelector('[data-testid=cv-canvas]');
      return (
        canvas !== null && Number(canvas.getAttribute('data-loaded-nodes') ?? '0') > before
      );
    },
    secondPageNodes,
    { timeout: 15_000 },
  );
  const allPageNodes = await loadedNodeCount();
  assert(
    allPageNodes >= 120,
    `第三次加载仍取到了更早的任务（数据层共 ${allPageNodes} 个节点 —— 注入的 120 条都在图里了）`,
  );
  // 翻完：按钮自动置灰 + 文案如实（hasMore=false 才置灰，不是"点了没反应"）
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-testid=cv-load-earlier]');
    return button !== null && button.disabled;
  }, undefined, { timeout: 15_000 });
  assert(await loadEarlier.isDisabled(), '全部加载完 → 按钮置灰（不是点了没反应）');
  assert(
    (await loadEarlier.textContent())?.includes('已全部加载') === true,
    '按钮文案如实说明「已全部加载」',
  );
  note(
    `（说明）数据层 ${allPageNodes} 个节点 vs DOM ${await page.locator('.cv-canvas .react-flow__node').count()} 个 —— 差额即"视口外未建 DOM"的部分`,
  );

  // 视口裁剪（onlyRenderVisibleElements）：一百多个节点一列排开（高度上万像素），
  // `fitView` 会被 `minZoom=0.2` 钳住 —— **只有一部分在视口内**。判据用"DOM 数 < 数据层数"，
  // 两边都从真实来源读（不写魔法数字）。
  const domNodes = await page.locator('.cv-canvas .react-flow__node').count();
  assert(
    domNodes < allPageNodes,
    `视口裁剪生效：DOM 只建了 ${domNodes} 个节点（图里 ${allPageNodes} 个）—— 视口外不建 DOM`,
  );
  note('（说明）视口裁剪的开关是代码事实，另由视觉自检第 ⑬ 条静态钉住');

  await page.screenshot({ path: path.join(SHOT_DIR, 'canvas-paged.png'), fullPage: false });
  note('画布分页截图留档：artifacts/ui-smoke/canvas-paged.png');

  // ⑩ 编排模式：写参数 → 连线 → 运行 → **幂等复验**（V2.26 / 台账 A5 片 A）
  //
  // 这一段真提交（节点 provider 被换成夹具 —— 见下面的 localStorage 注入），
  // 它要钉住三件事：① 编排能提交出真实任务；② **依赖顺序**（v2v 下游带着 `task:` 引用上游）；
  // ③ **连点两次「运行」不产生第二条任务**（确定性幂等键 —— 本片最值钱的断言）。
  await page.evaluate(() => { location.hash = '#/canvas?mode=plan'; });
  await page.waitForSelector('.cv-canvas', { timeout: 10_000 });
  assert(await page.getByTestId('cv-plan-hint').isVisible(), '进入编排模式（顶部把"重复点不重复计费"说清）');

  // 加两个节点（自动往右下错开，不会叠在一起点不到）
  await page.getByTestId('cv-add-plan-node').click();
  await page.waitForFunction(() => document.querySelectorAll('.cv-plan-node').length === 1, undefined, {
    timeout: 10_000,
  });
  await page.getByTestId('cv-add-plan-node').click();
  await page.waitForFunction(() => document.querySelectorAll('.cv-plan-node').length === 2, undefined, {
    timeout: 10_000,
  });
  assert(true, '「＋ 节点」在编排模式下加了两个节点');

  // 第 1 个节点：写提示词（真实 UI 编辑路径）
  await page.locator('.cv-plan-node').first().click();
  await page.getByTestId('cv-plan-prompt').waitFor({ timeout: 5_000 });
  await page.getByTestId('cv-plan-prompt').fill('冒烟编排 A：雨夜街角，霓虹倒影');
  await page.waitForFunction(
    () => document.querySelector('.cv-plan-ok') !== null,
    undefined,
    { timeout: 5_000 },
  );
  assert(true, '节点 1 写好提示词后面板显示"可以跑"');

  // 第 2 个节点：切成 v2v（要接上游）
  await page.locator('.cv-plan-node').nth(1).click();
  await page.getByTestId('cv-plan-mode-v2v').click();
  await page.getByTestId('cv-plan-prompt').fill('冒烟编排 B：参考 A 的运镜，换场景重拍');
  assert(
    (await page.getByTestId('cv-plan-mode-v2v').getAttribute('aria-pressed')) === 'true',
    'v2v 模式切换生效（无上游时 v2v 本身可跑 —— 上游是"可选参考"，接上后才成为依赖）',
  );

  // 连线：节点 1 的 source 句柄 → 节点 2 的 target 句柄（真实鼠标路径）
  {
    const source = page.locator('.cv-plan-node').first().locator('.react-flow__handle.source');
    const target = page.locator('.cv-plan-node').nth(1).locator('.react-flow__handle.target');
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    assert(sourceBox !== null && targetBox !== null, '两个句柄都有可视几何（能连线）');
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
      steps: 12,
    });
    await page.mouse.up();
  }
  await page.waitForFunction(
    () => document.querySelectorAll('.cv-canvas .react-flow__edge').length === 1,
    undefined,
    { timeout: 10_000 },
  );
  assert(true, '拖出一条连线（编排边的数量 = 1）');

  // 把两个节点的 provider 换成夹具（**测试专用手段**：编排不暴露引擎下拉，而冒烟不能真花钱）
  {
    const info = await page.evaluate(() => {
      // 动态找键（不硬编码项目名）：当前项目的编排键 = 前缀 + activeProjectId（缺省 default）
      const active = localStorage.getItem('astrmira.activeProjectId') ?? '(null)';
      const keys = Object.keys(localStorage).filter((key) => key.startsWith('astrmira.canvasPlan.'));
      const key = keys[0];
      if (key === undefined) return { changed: 0, active, keys };
      const parsed = JSON.parse(localStorage.getItem(key));
      const nodes = (parsed.nodes ?? []).map((node) => ({ ...node, provider: 'fixture-local' }));
      localStorage.setItem(key, JSON.stringify({ ...parsed, nodes }));
      return { changed: nodes.length, active, keys };
    });
    note(`（诊断）activeProjectId=${info.active} planKeys=${info.keys.join(',')}`);
    assert(info.changed === 2, `编排数据已落本机存储（${info.changed} 个节点，provider 换成夹具）`);
  }
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.cv-plan-node', { timeout: 10_000 });

  const planTasks = () =>
    page.evaluate(async () => {
      const response = await fetch('/api/history?limit=20');
      const data = await response.json();
      return data.items
        .map((item) => ({
          taskId: item.taskId,
          prompt: item.requestSnapshot?.prompt ?? '',
          referenceVideo: item.requestSnapshot?.assets?.referenceVideo ?? null,
        }))
        .filter((item) => item.prompt.startsWith('冒烟编排'));
    });

  const beforeRun = await planTasks();
  assert(beforeRun.length === 0, '运行前：还没有编排任务（干净起点）');
  allowExpected429 = true; // 编排段的冷却窗口（见监听器上方的说明）

  /**
   * 点「运行编排」，撞上防线 5 时就**如实等待再试**（这正是真实用户会做的事）。
   *
   * 为什么会撞：本段之前的 [6j] 段刚提交过一条夹具任务（成本口径用的"本地轨 0 元"样本），
   * 其 60s 冷却窗口可能还没过 —— **编排的第一次提交照常受冷却约束**（"一次有意动作"的豁免
   * 只作用于同一次运行内的后续节点，见 CONTRACT §11-6）。撞上时卡片与运行条会写出
   * "请在 Xs 后重试"，本段就按它等 —— 顺带把这条**如实提示**也验了。
   */
  const runUntilAccepted = async (testid = 'cv-run-plan') => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const previous = await page
        .getByTestId('cv-plan-notice')
        .textContent()
        .catch(() => null);
      await page.getByTestId(testid).click();
      // 等"运行条出现新文本"（点击后它会先被清空）；编排还会**等上游出片**（夹具几秒）
      await page.waitForFunction(
        (before) => {
          const text = document.querySelector('[data-testid=cv-plan-notice]')?.textContent ?? '';
          return text !== '' && text !== before;
        },
        previous,
        { timeout: 120_000 },
      );
      const text = await page.getByTestId('cv-plan-notice').textContent();
      const submitted = Number(text?.match(/已提交 (\d+) 条/)?.[1] ?? '0');
      if (submitted > 0) return text;

      // 没有成功提交：原因写在**节点卡**上（运行条只说"被跳过或失败"）。
      // 若是防线 5 的冷却（卡片上有"请在 Xs 后重试"）就按它等 —— 这正是真实用户会做的事。
      const cards = (await page.locator('.cv-plan-node').allTextContents()).join(' ');
      const retryAfter = Number(cards.match(/请在 (\d+)s 后重试/)?.[1] ?? '0');
      note(
        `（如实）本次运行没有成功提交（卡片：${cards.slice(0, 160)}）—— ` +
          (retryAfter > 0 ? `等 ${retryAfter}s 冷却后重试` : '等 5s 后重试'),
      );
      await sleep((retryAfter > 0 ? retryAfter + 2 : 5) * 1000);
    }
    return null;
  };

  await runUntilAccepted();
  const notice = await page.getByTestId('cv-plan-notice').textContent();
  if (notice?.includes('已提交 2 条') !== true) {
    // 失败时把"界面上真实写着的"原因带出来（否则只剩一句"失败了"，等于没有诊断信息）
    const cards = await page.locator('.cv-plan-node').allTextContents();
    const stored = await page.evaluate(
      () => localStorage.getItem('astrmira.canvasPlan.default')?.slice(0, 500) ?? null,
    );
    note(`（诊断）运行未全成功：notice=${notice}`);
    note(`（诊断）节点卡=${JSON.stringify(cards)}`);
    note(`（诊断）本机 plan=${stored}`);
  }
  assert(notice?.includes('已提交 2 条') === true, `运行结果如实：${notice}`);

  const afterRun = await planTasks();
  assert(afterRun.length === 2, `编排提交出 2 条真实任务（实际 ${afterRun.length}）`);
  const taskA = afterRun.find((item) => item.prompt.includes('编排 A'));
  const taskB = afterRun.find((item) => item.prompt.includes('编排 B'));
  assert(taskA !== undefined && taskB !== undefined, '两条任务都能在 /api/history 里找到');
  assert(
    taskB.referenceVideo === `task:${taskA.taskId}`,
    `下游带着上游产物的 task: 引用（${taskB.referenceVideo}）—— 依赖顺序的硬证据`,
  );
  assert(
    (await page.locator('.cv-plan-node.cv-plan-submitted').count()) === 2,
    '两个节点都显示"已提交"（卡片状态跟着运行结果）',
  );

  // ⭐ 幂等复验：**等冷却窗口过去**再点一次「运行编排」——一条新任务都不该出现。
  // 为什么等：不等的话第二次点击会被 429 挡住（那验的是冷却，不是幂等）；
  // 等过去之后第二次点击会真的走到提交，命中确定性幂等键 → 返回同一批 taskId。
  note('（如实）等 60s 冷却窗口过去，再做幂等复验……');
  await sleep(63_000);
  const beforeSecondRun = await page.getByTestId('cv-plan-notice').textContent();
  await page.getByTestId('cv-run-plan').click();
  // "这一轮真的开始了"的标志：运行条先被清空（或文本立刻变了）——否则"点了没反应"也会
  // 让后面的等待立刻满足（最终文本与上一次相同），那是假绿。
  const restarted = await page.evaluate((before) => {
    const el = document.querySelector('[data-testid=cv-plan-notice]');
    return el === null || el.textContent !== before;
  }, beforeSecondRun);
  assert(restarted, '第二次点击生效（运行条被清空/刷新 —— 不是"点了没反应"）');
  await page.waitForFunction(
    () => (document.querySelector('[data-testid=cv-plan-notice]')?.textContent ?? '') !== '',
    undefined,
    { timeout: 120_000 },
  );
  const afterSecondRun = await planTasks();
  assert(
    afterSecondRun.length === 2,
    `重复点「运行编排」不产生新任务（仍是 ${afterSecondRun.length} 条 —— 确定性幂等键的硬断言）`,
  );
  const secondNotice = await page.getByTestId('cv-plan-notice').textContent();
  assert(
    secondNotice?.includes('已提交 2 条') === true,
    `第二次运行照样如实回报（命中的是同两条任务）：${secondNotice}`,
  );

  // ── V2.29（A5 片 B / B68 + B69）：**显式重跑**必须真的换键、真的新建任务 ──────────
  // 这是"重跑"与"再点一次运行"的**全部区别**，也是本片唯一会花钱的断言：
  // 幂等键不变的话，重跑只会命中上一代的任务（界面显示"已提交"，实际什么都没新建）。
  // 与第一次运行一样，它会**如实撞上 60s 冷却**（新的一轮运行 = 新的一次有意动作），
  // 所以走同一条"按提示等待重试"的路径 —— 这正是真实用户会做的事。
  await runUntilAccepted('cv-rerun-plan');
  const rerunNotice = await page.getByTestId('cv-plan-notice').textContent();
  assert(
    /第 [2-9]\d* 轮（显式重跑/.test(rerunNotice ?? '') === true,
    `重跑如实报出这是第几轮（不是悄悄再跑一遍）：${rerunNotice}`,
  );
  const afterRerun = await planTasks();
  assert(
    afterRerun.length === 4,
    `重跑真的新建了任务（2 → ${afterRerun.length} 条 —— 换键的硬证据，这一片唯一花钱的断言）`,
  );

  // ── V2.29（B68 第二批）：**固定**之后重跑，被钉住的那段绝不再提交 ──────────────
  // 这是"省钱"最硬的一条证据：任务数只 +1（另一条被钉住了），
  // 且下游照样能引用固定的那份产物（引用不上就会 skipped，断言会红）。
  await page.locator('.cv-plan-node').first().click();
  await page.getByTestId('cv-pin-node').waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByTestId('cv-pin-node').click();
  const pinState = await page.getByTestId('cv-pin-state').textContent();
  assert(pinState?.includes('已固定') === true, `固定后有明确状态（${pinState}）`);

  const beforePinRerun = await planTasks();
  await runUntilAccepted('cv-rerun-plan');
  const afterPinRerun = await planTasks();
  assert(
    afterPinRerun.length === beforePinRerun.length + 1,
    `固定之后重跑：任务数只 +1（${beforePinRerun.length} → ${afterPinRerun.length}）` +
      ' —— 被钉住的那段没有重新提交（它照样被下游引用着）',
  );

  allowExpected429 = false; // 编排段结束：429 不再豁免

  await page.screenshot({ path: path.join(SHOT_DIR, 'canvas-plan.png'), fullPage: false });
  note('编排模式截图留档：artifacts/ui-smoke/canvas-plan.png');

  await page.screenshot({ path: path.join(SHOT_DIR, 'canvas.png'), fullPage: false });
  note('画布截图留档：artifacts/ui-smoke/canvas.png');

  // ── V2.35（A5 片 B 收口）：编排的导出 / 导入文件（契约 §11-6 附）────────────────
  //
  // 这一段**不提交任务**（不花钱），它盯四件事：
  // ① 导出的是**本产品格式且保真**（kind / version / notes / 产物 ID 都在）；
  // ② 导入走**真文件上传**（file input）→ 画布上真的换成了文件里的内容；
  // ③ **非空时两步确认**（取消 = 一动不动；确认 = 新编排身份）；
  // ④ 坏文件（kind 不对 / 更高版本 / 悬挂边）→ **如实拒绝且当前编排一动不动**。
  const planFile = path.join(tmpdir(), `astrmira-canvas-plan-${Date.now()}.json`);
  const [planDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('cv-export-plan').click(),
  ]);
  await planDownload.saveAs(planFile);
  const exported = JSON.parse(readFileSync(planFile, 'utf8'));
  assert(
    exported.kind === 'astrmira.canvas-plan' && typeof exported.version === 'number',
    `编排文件可下载且带格式标识（kind=${exported.kind} · v${exported.version}）`,
  );
  assert(
    Array.isArray(exported.plan?.nodes) && exported.plan.nodes.length === 2,
    `导出的是**当前这份编排**（${exported.plan?.nodes?.length} 个节点，与画布一致）`,
  );
  assert(
    exported.plan.nodes.some((node) => typeof node.pinnedTaskId === 'string'),
    '导出**保真**：固定（pinnedTaskId）这类本机状态也在文件里（剥离等于悄悄丢信息）',
  );
  assert(
    Array.isArray(exported.notes) && exported.notes.join(' ').includes('只在本机部署有意义'),
    '文件里写明了"这份文件不含什么"（产物 ID 只在本机部署有意义）—— 接收方知道边界',
  );
  assert(
    (await page.getByTestId('cv-plan-file-notice').innerText()).includes('已导出'),
    '界面上如实反馈导出结果',
  );
  const exportedPlanId = exported.plan.id;

  // ② 导入：当前编排非空 → **先确认**；取消 = 一动不动（不静默覆盖别人的工作）
  await page.getByTestId('cv-import-plan-input').setInputFiles(planFile);
  await page.getByTestId('cv-import-confirm').waitFor({ state: 'visible', timeout: 10_000 });
  assert(true, '导入非空编排先走两步确认（没有静默覆盖当前编排）');
  await page.getByTestId('cv-import-confirm-cancel').click();
  const afterCancel = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((item) => item.startsWith('astrmira.canvasPlan.'));
    return key === undefined ? null : JSON.parse(localStorage.getItem(key)).id;
  });
  assert(afterCancel === exportedPlanId, '取消导入 → 当前编排一动不动（本机存储里的编排 id 没变）');

  // ③ 改一处能看见的地方（名字 + 提示词）再导入 → 证明"画布真的换成了文件里的内容"
  const edited = JSON.parse(readFileSync(planFile, 'utf8'));
  edited.plan.name = '冒烟导入的编排';
  edited.plan.nodes[0].prompt = '冒烟编排 A：导入之后改了提示词';
  writeFileSync(planFile, JSON.stringify(edited));

  await page.getByTestId('cv-import-plan-input').setInputFiles(planFile);
  await page.getByTestId('cv-import-confirm').waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByTestId('cv-import-confirm-yes').click();
  // 等**本机存储真的变成文件里的那份**（界面提示与落盘是同一次 state 更新，但 DOM/存储各有自己的时序）
  await page.waitForFunction(() => {
    const key = Object.keys(localStorage).find((item) => item.startsWith('astrmira.canvasPlan.'));
    if (key === undefined) return false;
    return JSON.parse(localStorage.getItem(key) ?? '{}').name === '冒烟导入的编排';
  }, undefined, { timeout: 10_000 });
  const storedPlan = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((item) => item.startsWith('astrmira.canvasPlan.'));
    return key === undefined ? null : JSON.parse(localStorage.getItem(key));
  });
  assert(storedPlan?.name === '冒烟导入的编排', '导入的内容真的落到了本机存储（文件里的名字）');
  assert(
    storedPlan?.nodes?.[0]?.prompt?.includes('导入之后改了提示词') === true,
    '画布上真的是文件里的那份内容（提示词被替换）',
  );
  assert(
    storedPlan.id !== exportedPlanId,
    '导入 = **新编排身份**（幂等键含 planId：两份同源编排不能互相命中对方的任务）',
  );
  assert(
    (await page.getByTestId('cv-plan-file-notice').innerText()).includes('新的编排身份'),
    '界面上说清了"新的编排身份 —— 首次运行会新建任务"（代价如实）',
  );

  // ④ 坏文件三种 → 如实拒绝 + 当前编排一动不动
  const badCases = [
    {
      label: 'kind 不对（误选了别种文件）',
      content: () => JSON.stringify({ kind: 'astrmira.recipe-pack', version: 1, plan: {} }),
      expect: '这不是编排文件',
    },
    {
      label: '来自更高的版本（未来格式）',
      content: () => JSON.stringify({ ...exported, version: 999 }),
      expect: '请升级',
    },
    {
      label: '图不成立（悬挂边）',
      content: () =>
        JSON.stringify({
          ...exported,
          plan: {
            ...exported.plan,
            edges: [{ id: 'pedge-ghost', from: 'ghost', to: exported.plan.nodes[0].id }],
          },
        }),
      expect: '连到不存在节点',
    },
  ];
  let badIndex = 0;
  for (const item of badCases) {
    badIndex += 1;
    const badFile = path.join(tmpdir(), `astrmira-canvas-plan-bad-${Date.now()}-${badIndex}.json`);
    writeFileSync(badFile, item.content());
    await page.getByTestId('cv-import-plan-input').setInputFiles(badFile);
    // 判据是"出现**本 case 的**原因"（不是"出现导入失败"）：否则上一条失败提示会让等待立刻满足（假绿）
    await page.waitForFunction(
      (needle) =>
        (document.querySelector('[data-testid=cv-plan-file-notice]')?.textContent ?? '').includes(needle),
      item.expect,
      { timeout: 10_000 },
    );
    const badText = await page.getByTestId('cv-plan-file-notice').innerText();
    assert(
      badText.includes(item.expect),
      `坏文件如实拒绝（${item.label}）：${badText.replaceAll('\n', ' ').slice(0, 70)}…`,
    );
    rmSync(badFile, { force: true });
  }
  const afterBad = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((item) => item.startsWith('astrmira.canvasPlan.'));
    return key === undefined ? null : JSON.parse(localStorage.getItem(key));
  });
  assert(afterBad?.name === '冒烟导入的编排', '坏文件被拒之后当前编排**一动不动**（没有半成品装进来）');
  rmSync(planFile, { force: true });

  // ── V2.36（A1 · 后续）：**多台 ComfyUI** 的引擎名单来自服务端（前端不写死一档）──────────
  //
  // 为什么不直接改服务端 env（真实的 `COMFYUI_SERVERS_FILE`）：那会把 [4] 段"**未配置**时如实说缺什么"
  // 的断言一起改掉 —— 而那条正是 B4 最值钱的地方。这里用**请求拦截**只在这一段内伪造
  // `/status`（三台实例）与 `/selfcheck`（逐台结果），验的是**前端渲染**：
  // ① 有几台就列几个按钮；② 看得出选中了哪一台；③ 自检里具名实例**不能显示成空白**
  // （裸索引查表就会 —— `CANVAS_PROVIDER_LABELS['host-comfyui:office']` 是 undefined）。
  const FAKE_SERVERS = [
    { id: 'host-comfyui', label: '默认引擎', available: true },
    { id: 'host-comfyui:office', label: '办公室的 3080', available: true },
    {
      id: 'host-comfyui:home',
      label: '家里的 5090',
      available: false,
      reason: '地址不合规：本地引擎只允许回环或内网地址（http / https）',
    },
  ];
  await page.route('**/api/providers/status', (route) =>
    route.fulfill({
      json: {
        cloud: { available: false, provider: 'volcano-seedance', acceptsClientKey: true },
        local: { available: false, provider: 'minimax-h3' },
        comfyui: {
          available: true,
          provider: 'comfyui',
          servers: FAKE_SERVERS,
          reason: '本服务已配置 3 台 ComfyUI（合规 2 台；能跑哪些模式在提交时判定）',
        },
        llm: { available: false, provider: 'openai-compatible', acceptsClientKey: true },
        defaultProvider: 'cloud-volcano-seedance',
      },
    }),
  );
  await page.route('**/api/providers/selfcheck', (route) =>
    route.fulfill({
      json: {
        checkedAt: new Date().toISOString(),
        entries: [
          {
            provider: 'local-minimax-h3',
            available: false,
            reason: '本服务没有可用的本地 MiniMax H3 后端（只有配置约定，没有可执行的推理 provider）',
          },
          { provider: 'host-comfyui', available: true, reason: '默认引擎：能跑 t2v / i2v' },
          { provider: 'host-comfyui:office', available: false, reason: '连不上（办公室那台没开机）' },
        ],
      },
    }),
  );

  await page.evaluate(() => {
    location.hash = '#/workbench';
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('[data-testid=wb-engine-host-comfyui]', { timeout: 15_000 });

  const officeButton = page.getByTestId('wb-engine-host-comfyui:office').first();
  assert(
    await officeButton.isVisible(),
    '第二台（办公室的 3080）也列出来了 —— 引擎名单来自 /status，不是写死一档',
  );
  const engineLabels = await page.locator('[data-testid^=wb-engine-]:visible').allTextContents();
  assert(engineLabels.length === 3, `三台实例 → 三个引擎按钮（实际 ${engineLabels.length}）`);
  assert(
    engineLabels.some((text) => text.includes('办公室的 3080')),
    '按钮上带实例名（否则用户分不清自己选了哪一台）',
  );

  await officeButton.click();
  await page.waitForTimeout(300);
  assert(
    (await officeButton.getAttribute('aria-pressed')) === 'true',
    '点第二台 → 它成为选中项（引擎切换落到具名实例 id 上）',
  );
  const engineNote = await page.locator('[data-testid=wb-panel-engine-note]:visible').first().innerText();
  assert(engineNote.trim().length > 0, `上方说明跟着切到那一台：${engineNote.slice(0, 40)}…`);

  await page.locator('[data-testid=wb-selfcheck]:visible').first().click();
  const fakeSelfCheck = page.locator('[data-testid=wb-selfcheck-result]:visible').first();
  await fakeSelfCheck.waitFor({ state: 'visible', timeout: 15_000 });
  const fakeSelfCheckText = (await fakeSelfCheck.textContent()) ?? '';
  assert(
    fakeSelfCheckText.includes('ComfyUI · 办公室的 3080'),
    `自检结果里具名实例显示为实例名（不是空白）：${fakeSelfCheckText.slice(0, 70)}…`,
  );
  assert(
    fakeSelfCheckText.includes('连不上'),
    '逐台结论照实：一台连不上不影响另一台的结论（多台最需要的可观测性）',
  );

  // 创作入口的引擎区在"更多设置"折叠层里（它的多实例渲染由**同一份** `comfyUiEngineOptions`
  // + 视觉自检的静态红线覆盖；这里不为了点开一个折叠层把冒烟写脆）
  await page.unroute('**/api/providers/status');
  await page.unroute('**/api/providers/selfcheck');
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('[data-testid=wb-engine-host-comfyui]', { timeout: 15_000 });
  const realEngineLabels = await page.locator('[data-testid^=wb-engine-]:visible').allTextContents();
  assert(
    realEngineLabels.length === 1 && realEngineLabels[0] === '本地 ComfyUI',
    `拦截撤销后回到真实配置（未配多台 → 只有一项「本地 ComfyUI」，实际 ${JSON.stringify(realEngineLabels)}）`,
  );

  console.log('\n[7f] window 层运行期兜底（V2.29 / B61 片 B / D52：只本地提示、不上报）');
  // 为什么必须**真抛**：这一层唯一的存在理由就是"接住没人接的错误"。直接调它的 report()
  // 只能证明函数能跑，证明不了"浏览器真会把事件送到它手上" —— 而"事件没送到"
  // （监听阶段挂错、被某个 patch 吃掉）恰恰是它最可能的失效方式。
  runtimeErrorWindow = true;

  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('smoke-runtime-error');
    }, 0);
  });
  const runtimeNotice = page.getByTestId('runtime-error-notice');
  await runtimeNotice.waitFor({ state: 'visible', timeout: 10_000 });
  assert(
    ((await runtimeNotice.textContent()) ?? '').includes('界面里有一处代码出错了'),
    '未被捕获的同步错误 → 页面上真的出现提示条（真浏览器、真未捕获异常）',
  );

  // 同一条错误再抛两次：只更新计数、**不重复弹**（循环里抛错否则会自己变成一场灾难）
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('smoke-runtime-error');
    }, 0);
    setTimeout(() => {
      throw new Error('smoke-runtime-error');
    }, 0);
  });
  const countLine = page.getByTestId('runtime-error-count');
  await countLine.waitFor({ state: 'visible', timeout: 10_000 });
  assert(
    ((await countLine.textContent()) ?? '').includes('另有 2 次同类'),
    '同一条错误重复抛 → 只弹一条提示，并如实累计"另有 N 次同类"',
  );
  assert(
    (await page.getByTestId('runtime-error-notice').count()) === 1,
    '提示条不会堆积成一片（同一条错误只有一个容器）',
  );

  const runtimeDetails = async () =>
    page.evaluate(
      () => document.querySelector('[data-testid=runtime-error-notice] pre')?.textContent ?? '',
    );
  const firstDetails = await runtimeDetails();
  assert(firstDetails.includes('smoke-runtime-error'), '技术细节里有真实错误消息（报障可复制带走）');
  assert(firstDetails.includes('没有上报到服务器'), '如实写明"只在本机提示、没有上报"（D52 的承诺）');

  // 未处理的 Promise 拒绝：**根本不会触发 error 事件**，只有 unhandledrejection 能接住它
  await page.evaluate(() => {
    Promise.reject(new Error('smoke-runtime-rejection'));
  });
  await page.waitForFunction(
    () =>
      (document.querySelector('[data-testid=runtime-error-notice] pre')?.textContent ?? '').includes(
        'smoke-runtime-rejection',
      ),
    undefined,
    { timeout: 10_000 },
  );
  assert(
    (await runtimeDetails()).includes('未处理的 Promise 拒绝'),
    'Promise 拒绝也能被兜住，且报告里写清来源（只做 window.onerror 会漏掉这一整类）',
  );

  // 关得掉（它浮在右下角，关不掉就会永久压住界面）
  await page.getByTestId('runtime-error-dismiss').click();
  await runtimeNotice.waitFor({ state: 'detached', timeout: 5_000 });
  assert(
    (await page.getByTestId('runtime-error-notice').count()) === 0,
    '点「知道了」后提示条真的消失',
  );

  // 浏览器**良性噪声**：只留控制台、**不弹提示条**。
  // 这条是 2026-10-13 上线当天真实撞到的（冒烟 [8] 段多出一条 ResizeObserver 错误）——
  // 不筛掉它，用户会收到一条"界面里有一处代码出错了"的**误报**。
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('ResizeObserver loop completed with undelivered notifications.');
    }, 0);
  });
  await sleep(800); // 给它足够的机会去弹（若筛检漏了，这里就会多出一条提示条）
  assert(
    (await page.getByTestId('runtime-error-notice').count()) === 0,
    '浏览器良性噪声（ResizeObserver loop）不弹提示条 —— 只留控制台记录',
  );
  assert(
    runtimeNoise.length >= 1,
    `良性噪声**仍然留了控制台记录**（被筛掉 ${runtimeNoise.length} 条，信息不丢）`,
  );

  runtimeErrorWindow = false;
  const consumedConsole = expectedRuntimeErrors.filter((item) => item.startsWith('console:')).length;
  const consumedPage = expectedRuntimeErrors.filter((item) => item.startsWith('pageerror:')).length;
  note(`本段预期内的运行期错误：console ${consumedConsole} 条 / pageerror ${consumedPage} 条`);
  assert(
    consumedConsole === 4,
    `每次运行期错误都会在控制台留一条原始记录（4 次错误 → 4 条，实际 ${consumedConsole}）`,
  );
  assert(consumedPage >= 3, `三次同步抛错都必须以 pageerror 形式被收走（实际 ${consumedPage}）`);

  console.log('\n[8] 控制台卫生');
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
  if (runtimeNoise.length > 0) {
    // 如实报数：被兜底层筛掉的浏览器噪声既不算失败、也不藏起来
    note(
      `（如实）整场会话里兜底层筛掉的浏览器良性噪声 ${runtimeNoise.length} 条（只留控制台、不弹提示）：` +
        `${runtimeNoise[0]?.slice(0, 160)}`,
    );
  }
  if (consoleWarnings.length > 0) {
    note(`（提示）console.warning ${consoleWarnings.length} 条，不参与判定：${consoleWarnings[0]?.slice(0, 160)}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  // 缺浏览器时的中文指引（P0-3 的同一口径：缺外部依赖要讲清楚怎么装，而不是抛一段英文栈）
  if (/Executable doesn't exist|playwright install/i.test(message)) {
    console.error(
      '\n✗ 缺 Chromium（Playwright 浏览器未安装）。先执行：\n' +
        '    pnpm exec playwright install chromium\n' +
        '  （CI 中由 .github/workflows/ci.yml 的「安装 chromium」步骤负责）',
    );
  }
  failures.push(`冒烟执行异常：${message}`);
  console.error(`\n✗ ${message}`);
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

console.log(
  '\n✓ UI 冒烟通过：三栏渲染 + 首屏连通 + 抽屉可交互 + 参数/主题联动 + 素材槽与画廊封面 + 操作日志留痕 + 控制台零 error\n',
);
