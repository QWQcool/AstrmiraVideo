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
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
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
    (await page.locator('.sidebar .nav-item').count()) === 7,
    `侧栏有七个一级视图入口（创作/工作台/总览/视频库/画布/配方库/日志；剪辑台不进侧栏；实际 ${await page.locator('.sidebar .nav-item').count()}）`,
  );

  // 七个一级视图可切换，且侧栏 aria-current 跟随（剪辑台是 hidden 视图，单独验）
  for (const hash of ['#/create', '#/overview', '#/library', '#/canvas', '#/recipes', '#/logs', '#/workbench']) {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForFunction(
      (h) => document.querySelector('.nav-item[aria-current="page"]')?.getAttribute('href') === h,
      hash,
      { timeout: 5_000 },
    );
  }
  assert(true, '五个一级视图可切换，侧栏 aria-current 跟随');

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

  console.log('\n[7c] 移动端（V9 · B7：390×844，Step 6-AC7 的第二档）');
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
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

  await mobile.screenshot({ path: path.join(SHOT_DIR, 'mobile.png'), fullPage: false });
  note('移动端截图留档：artifacts/ui-smoke/mobile.png');
  await mobileContext.close();

  console.log('\n[7d] 创作入口（V2.7 / B41：@ 提及 + 素材 chips + 模式摘要 + 更多设置收起）');
  // 重载一次保证素材池拿到 [6] 段造的夹具成片（创作入口是 keepalive 常驻视图，不随导航重挂载）
  await page.goto(`${baseUrl}/#/create`, { waitUntil: 'load' });
  await page.waitForSelector('.cr-panel', { timeout: 10_000 });
  assert(true, '创作入口渲染（#/create 落地即「造梦盒」）');

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
  await page.screenshot({ path: path.join(SHOT_DIR, 'create.png'), fullPage: false });
  note('创作入口截图留档：artifacts/ui-smoke/create.png');

  console.log('\n[7e] 血缘画布（P4 / B42：L2 只读 DAG）');
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

  // 点节点 → 详情抽屉（动作按钮指向既有 hash 参数）
  await canvasNodes.first().click();
  await page.waitForSelector('.cv-drawer', { timeout: 5_000 });
  assert(true, '点节点弹出详情抽屉');
  assert(
    (await page.locator('.cv-drawer-actions .wb-btn').count()) >= 1,
    '抽屉里有动作入口（复用参数 / 送剪辑台 / 设为视频参考…）',
  );

  // 只读断言②：Delete 键不删除节点（deleteKeyCode=null）
  const beforeDelete = await canvasNodes.count();
  await page.keyboard.press('Delete');
  await sleep(250);
  assert((await canvasNodes.count()) === beforeDelete, 'Delete 键不删除节点（只读视图）');

  await page.screenshot({ path: path.join(SHOT_DIR, 'canvas.png'), fullPage: false });
  note('画布截图留档：artifacts/ui-smoke/canvas.png');

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
