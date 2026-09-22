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
 * 5. **控制台零 error / 零未捕获异常**（这条曾经抓到生产 CSP 与外部字体的冲突）。
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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
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

  browser = await chromium.launch({ headless: !HEADED });
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
  assert(
    (await page.locator('.wb-drawer select.wb-input').count()) === 1,
    '文本轨提供预设下拉（清单来自 packages/shared 的 LLM_PRESETS，前端不写第二份）',
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
  const durationButtons = page.locator('.wb-segment', { hasText: /^\d+s$/ });
  assert((await durationButtons.count()) >= 3, `时长选项 ≥ 3 个（实际 ${await durationButtons.count()}）`);
  assert(
    (await page.locator('.wb-segment[aria-pressed="true"]', { hasText: /^\d+s$/ }).count()) === 1,
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
    (await page.locator('.wb-segment[aria-pressed="true"]', { hasText: '10s' }).count()) === 1,
    '时长可以切到 10s 且选中态正确',
  );

  console.log('\n[5] 主题（V8.3 批次 2：默认跟随系统 + 可覆盖，日间为"现代简洁·蔚蓝"）');
  const themeAttr = () =>
    page.evaluate(() => document.documentElement.getAttribute('data-theme'));

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

  await page.screenshot({ path: path.join(SHOT_DIR, 'gallery.png'), fullPage: false });
  note('画廊截图留档：artifacts/ui-smoke/gallery.png');

  console.log('\n[7] 控制台卫生');
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
  '\n✓ UI 冒烟通过：三栏渲染 + 首屏连通 + 抽屉可交互 + 参数/主题联动 + 素材槽与画廊封面 + 控制台零 error\n',
);
