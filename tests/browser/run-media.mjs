#!/usr/bin/env node
/**
 * B96：会话详情的**真实媒体闭环**（真实浏览器 + 本地 fixture 媒体）。
 *
 * ## 覆盖
 * 1. 首帧图**完成解码**（`img.decode()` + naturalWidth>0），不是"img 元素存在"；
 * 2. 显式重出后展示**新图**；旧 taskId 的迟到响应不能把新图回滚；
 * 3. 成功后成片：单镜取视频步骤、多镜取拼接产物；`<video>` 加载元数据并可播放；
 * 4. 下载链接返回**实际媒体字节**；
 * 5. 关闭详情跨 ≥2 个轮询周期仍保持关闭；
 * 6. 375px 窄屏 + 长标题 + 多步骤无横向溢出；
 * 7. 媒体缺失（任务成功但没有产物）如实显示"产物不可用"，不显示假图。
 *
 * ## 受控边界（如实）
 * 会话与任务的 JSON 是**受控响应**（route.fulfill）；媒体文件是**真实本地 fixture**：
 * 视频由内置夹具 provider 现场生成、图片是测试写进 OUTPUT_DIR 的真实 PNG。
 * 因此这里证明的是"界面如何处理真实媒体 + 受控状态"，不是模型质量。
 *
 * 用法：`node tests/browser/run-media.mjs [--headed] [--keep]`
 * 前置：`pnpm build`。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BACKEND_ENTRY = path.join(ROOT, 'backend/dist/index.js');
const FRONTEND_DIST = path.join(ROOT, 'frontend/dist');
const CLIPS_DIR = path.join(ROOT, 'tests/fixtures/clips');
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

/** 真实可解码的 2×2 PNG（两种颜色，用来区分"重出前/后"） */
const PNG_A = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z8DAwMDAxMDAwMAAAAwBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);
const PNG_B = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFUlEQVR4nGNkYPjPwMDAxMDAwMAAAA0BAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);

async function generateFixtureVideo(baseUrl) {
  const clips = existsSync(CLIPS_DIR)
    ? readdirSync(CLIPS_DIR).filter((name) => name.endsWith('.mp4'))
    : [];
  if (clips.length === 0) throw new Error('缺夹具片段：先跑 node scripts/make-fixture-clips.mjs');
  const submit = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: 'B96 媒体夹具',
      mode: 't2v',
      aspectRatio: '16:9',
      provider: 'fixture-local',
      params: { durationSec: 2 },
    }),
  });
  if (!submit.ok) throw new Error(`夹具任务提交失败：HTTP ${submit.status}`);
  const { taskId } = await submit.json();
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const progress = await (await fetch(`${baseUrl}/api/tasks/${taskId}`)).json();
    if (progress.status === 'succeeded') return progress;
    if (progress.status === 'failed') throw new Error('夹具视频生成失败');
    await sleep(250);
  }
  throw new Error('夹具视频未在 60s 内完成');
}

const now = Date.now();
const runSummary = (overrides = {}) => ({
  id: 'run-1',
  title: 'B96 长标题：雨夜霓虹下的橘猫与它的九个影子（多步骤媒体验收用例）',
  projectId: 'default',
  mode: 'first-frame-confirm',
  provider: 'fixture-local',
  state: 'awaiting-confirmation',
  videoStepCount: 2,
  totalStepCount: 4,
  succeededCount: 2,
  failedCount: 0,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const step = (id, kind, overrides = {}) => ({
  id,
  kind,
  prompt: `${id} 提示词`,
  aspectRatio: '16:9',
  resolutionTier: '480p',
  referenceAssetIds: [],
  dependsOn: [],
  status: 'succeeded',
  attempt: 0,
  taskId: `${id}-task`,
  outputAssetId: `task:${id}-task`,
  ...overrides,
});

const detailAwaiting = () => ({
  version: 1,
  id: 'run-1',
  title: runSummary().title,
  projectId: 'default',
  mode: 'first-frame-confirm',
  provider: 'fixture-local',
  steps: [
    step('img-1', 'image'),
    step('shot-1', 'video', { status: 'pending', taskId: undefined, outputAssetId: undefined }),
    step('img-2', 'image'),
    step('shot-2', 'video', { status: 'pending', taskId: undefined, outputAssetId: undefined }),
  ],
  state: 'awaiting-confirmation',
  createdAt: now,
  updatedAt: now,
});

const detailRedone = () => {
  const base = detailAwaiting();
  return {
    ...base,
    steps: base.steps.map((item) =>
      item.id === 'img-1'
        ? { ...item, taskId: 'img-1-task-b', outputAssetId: 'task:img-1-task-b', attempt: 1 }
        : item,
    ),
    updatedAt: now + 1000,
  };
};

const detailSucceeded = (assembled) => ({
  version: 1,
  id: 'run-1',
  title: runSummary().title,
  projectId: 'default',
  mode: 'first-frame-confirm',
  provider: 'fixture-local',
  steps: [
    step('img-1', 'image'),
    step('shot-1', 'video'),
    step('img-2', 'image'),
    step('shot-2', 'video'),
  ],
  state: 'succeeded',
  createdAt: now,
  updatedAt: now + 2000,
  ...(assembled === undefined ? {} : { assembledTaskId: assembled }),
});

const taskJson = (overrides) => ({
  taskId: 'x',
  status: 'succeeded',
  progressPercent: 100,
  requestSnapshot: { prompt: 'fixture', mode: 't2v', aspectRatio: '16:9', provider: 'fixture-local' },
  createdAt: now,
  warnings: [],
  ...overrides,
});

if (!existsSync(BACKEND_ENTRY) || !existsSync(path.join(FRONTEND_DIST, 'index.html'))) {
  console.error('✗ 缺构建产物：请先执行 `pnpm build`');
  process.exit(1);
}

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-b96-data-'));
const OUTPUTS_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-b96-out-'));
const PORT = await freePort();
const baseUrl = `http://127.0.0.1:${PORT}`;

console.log('\n=== B96：会话详情的首帧 / 成片媒体闭环 ===');
console.log(`实例：${baseUrl}（会话 JSON 受控；媒体为真实本地 fixture）`);

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
    PUBLIC_API_TOKEN: 'b96-loopback-only',
    VOLCANO_API_KEY: '',
    ENABLE_FIXTURE_PROVIDER: '1',
  },
  stdio: 'ignore',
});

let browser;
try {
  if (!(await waitForHealth(baseUrl))) throw new Error('后端未就绪');
  mkdirSync(OUTPUTS_DIR, { recursive: true });
  writeFileSync(path.join(OUTPUTS_DIR, 'b96-a.png'), PNG_A);
  writeFileSync(path.join(OUTPUTS_DIR, 'b96-b.png'), PNG_B);
  const fixtureVideo = await generateFixtureVideo(baseUrl);

  browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  });
  await context.addInitScript(() => window.localStorage.setItem('astrmira.lang', 'zh'));
  const page = await context.newPage();

  /** 受控会话状态：awaiting → redone → succeeded；`mode` 由测试切换 */
  const state = { detail: detailAwaiting() };
  /**
   * 旧图片（img-1 的第一版）的响应闸门：**从第一次请求起就压住**，
   * 等重出（新 taskId）并渲染出新图之后再释放 —— 这才真的构造出"旧响应迟到"。
   */
  let releaseOldImage;
  const holdOldImage = new Promise((resolve) => {
    releaseOldImage = resolve;
  });

  async function fulfillJson(route, body) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  }

  await page.route(
    (url) => url.pathname === '/api/agent/runs',
    async (route) => {
      if (route.request().method() === 'GET') {
        // 列表恒为 live：让详情轮询持续（本脚本要连续切换受控状态）
        return fulfillJson(route, { runs: [runSummary({ state: 'running' })] });
      }
      return route.continue();
    },
  );
  await page.route(
    (url) => /^\/api\/agent\/runs\/[^/]+$/.test(url.pathname),
    async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      return fulfillJson(route, { run: state.detail });
    },
  );
  await page.route(
    (url) => /^\/api\/agent\/runs\/[^/]+\/steps\/[^/]+\/retry$/.test(url.pathname),
    async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      if (route.request().url().endsWith('/steps/assembly/retry')) {
        // B99：重试拼接 → 回到 assembling；生成步骤与产物一个都不动
        state.detail = {
          ...state.detail,
          state: 'assembling',
          assemblyAttempt: (state.detail.assemblyAttempt ?? 0) + 1,
          updatedAt: now + 3000,
        };
        delete state.detail.failure;
        delete state.detail.finishedAt;
        delete state.detail.assembledTaskId;
        return fulfillJson(route, { run: state.detail });
      }
      state.detail = detailRedone();
      return fulfillJson(route, { run: state.detail });
    },
  );
  await page.route(
    (url) => /^\/api\/tasks\/[^/]+$/.test(url.pathname),
    async (route) => {
      const id = decodeURIComponent(route.request().url().split('/').pop());
      if (id === 'img-1-task') {
        // 旧图片的迟到响应：一直压到重出并显示新图之后
        await holdOldImage;
        return fulfillJson(route, taskJson({ taskId: id, outputImageUrl: '/media/b96-a.png' }));
      }
      if (id === 'img-1-task-b') {
        return fulfillJson(route, taskJson({ taskId: id, outputImageUrl: '/media/b96-b.png' }));
      }
      if (id === 'img-2-task') {
        return fulfillJson(route, taskJson({ taskId: id, outputImageUrl: '/media/b96-a.png' }));
      }
      if (id === 'assembly-failed-task') {
        return fulfillJson(route, taskJson({ taskId: id, status: 'failed' }));
      }
      if (id === 'shot-1-task' || id === 'shot-2-task' || id === 'assembly-task') {
        return fulfillJson(
          route,
          taskJson({
            taskId: id,
            outputVideoUrl: fixtureVideo.outputVideoUrl,
            thumbnailUrl: fixtureVideo.thumbnailUrl,
          }),
        );
      }
      return fulfillJson(route, taskJson({ taskId: id }));
    },
  );
  // 取消 / 确认等动作不改变本脚本的受控状态（只测媒体路径，不测状态机）
  await page.route(
    (url) => /^\/api\/agent\/runs\/[^/]+\/(confirm|cancel|start)$/.test(url.pathname),
    async (route) => fulfillJson(route, { run: state.detail }),
  );

  await page.goto(`${baseUrl}/#/runs`, { waitUntil: 'load' });
  await page.click('[data-testid="runs-list"] tbody tr');
  await page.waitForSelector('[data-testid="runs-detail"]', { timeout: 10_000 });

  // ── ① 首帧图真的解码成功（用未被压住的 img-2 验证解码能力）──────────────
  const secondImage = page.locator('[data-testid="runs-step-media-img-2"]');
  await secondImage.waitFor({ timeout: 10_000 });
  const decoded = await secondImage.evaluate(async (img) => {
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight, src: img.getAttribute('src') };
  });
  assert(decoded.width > 0 && decoded.height > 0, `首帧图完成解码（${decoded.width}×${decoded.height}）`);
  assert(decoded.src === '/media/b96-a.png', `首帧图地址来自任务接口（${decoded.src}）`);

  // ── ② 重出：旧请求迟到也不回滚 ──────────────────────────────────────────
  await page.locator('[data-testid="runs-detail"] button:has-text("重出这张首帧")').first().click();
  const firstImage = page.locator('[data-testid="runs-step-media-img-1"]');
  await page.waitForFunction(
    () => {
      const element = document.querySelector('[data-testid="runs-step-media-img-1"]');
      return (
        element !== null &&
        element.tagName === 'IMG' &&
        element.getAttribute('src') === '/media/b96-b.png'
      );
    },
    { timeout: 15_000 },
  );
  const redone = await firstImage.evaluate(async (img) => {
    await img.decode();
    return { width: img.naturalWidth, src: img.getAttribute('src') };
  });
  assert(
    redone.src === '/media/b96-b.png' && redone.width > 0,
    '重出后展示新图并完成解码（/media/b96-b.png）',
  );
  releaseOldImage();
  await sleep(1200);
  assert(
    (await firstImage.getAttribute('src')) === '/media/b96-b.png',
    '旧图片的迟到响应没有把新图回滚成旧图',
  );

  // ── ③ 成功会话：单镜取视频步骤 / 多镜取拼接产物 ─────────────────────────
  // 单镜：只保留一个图片步 + 一个视频步（会话至少一个视频步）
  state.detail = {
    ...detailSucceeded(),
    steps: detailSucceeded().steps.filter(
      (item) => item.id === 'img-1' || item.id === 'shot-1',
    ),
  };
  await page.waitForFunction(
    () => document.querySelector('[data-testid="runs-final-video"]') !== null,
    { timeout: 15_000 },
  );
  const singleSrc = await page.getAttribute('[data-testid="runs-final-video"]', 'src');
  assert(
    singleSrc === fixtureVideo.outputVideoUrl,
    `单镜成功会话从视频步骤取成片（${singleSrc}）`,
  );

  state.detail = detailSucceeded('assembly-task');
  let multiSrc = null;
  for (let i = 0; i < 60; i += 1) {
    multiSrc = await page.getAttribute('[data-testid="runs-final-video"]', 'src');
    if (multiSrc === fixtureVideo.outputVideoUrl) break;
    await sleep(200);
  }
  assert(multiSrc === fixtureVideo.outputVideoUrl, `多镜成功会话从拼接产物取成片（${multiSrc}）`);

  const playback = await page.evaluate(async () => {
    const video = document.querySelector('[data-testid="runs-final-video"]');
    if (!video) return { ok: false, reason: 'no video' };
    if (video.readyState < 1) {
      await new Promise((resolve) => {
        video.addEventListener('loadedmetadata', resolve, { once: true });
        setTimeout(resolve, 8000);
      });
    }
    const meta = { readyState: video.readyState, width: video.videoWidth, height: video.videoHeight, duration: video.duration };
    video.muted = true;
    try {
      await video.play();
    } catch {
      /* 播放策略可能拒绝，下面用 currentTime 判定 */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { ok: true, ...meta, currentTime: video.currentTime, paused: video.paused };
  });
  assert(
    playback.ok && playback.readyState >= 2 && playback.width > 0 && playback.height > 0,
    `成片加载媒体元数据（${playback.width}×${playback.height}，readyState=${playback.readyState}）`,
  );
  assert(
    typeof playback.currentTime === 'number' && playback.currentTime > 0,
    `成片实际开始播放（currentTime=${Number(playback.currentTime).toFixed(2)}s）`,
  );

  const downloadHref = await page.getAttribute('[data-testid="runs-final-download"]', 'href');
  const downloadResponse = await page.request.get(`${baseUrl}${downloadHref}`);
  const downloadBytes = (await downloadResponse.body()).length;
  assert(
    downloadResponse.ok() && downloadBytes > 10_000,
    `下载链接返回实际媒体（HTTP ${downloadResponse.status()}，${downloadBytes} bytes）`,
  );
  const downloadName = await page.getAttribute('[data-testid="runs-final-download"]', 'download');
  assert(
    downloadName !== null && downloadName.endsWith('.mp4'),
    `下载文件名可用（${downloadName}）`,
  );

  // ── ④ 媒体缺失如实显示（不拿假图冒充）──────────────────────────────────
  state.detail = {
    ...detailSucceeded(),
    steps: detailSucceeded().steps.map((item) =>
      item.id === 'img-1' ? { ...item, taskId: 'missing-task', outputAssetId: 'task:missing-task' } : item,
    ),
  };
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="runs-step-media-img-1"]')
        ?.textContent?.includes('产物不可用') === true,
    { timeout: 15_000 },
  );
  assert(true, '任务成功但无产物时如实显示「产物不可用」');

  // ── ④b B99：拼接失败 → 只重拼 → 成功成片 ───────────────────────────────
  state.detail = {
    ...detailSucceeded('assembly-failed-task'),
    state: 'failed',
    failure: { stepId: 'assembly', message: '注入：ffmpeg 拼接失败' },
    finishedAt: now + 4000,
  };
  await page.waitForSelector('[data-testid="runs-assembly-retry"]', { timeout: 15_000 });
  assert(true, '拼接失败时显示「重试拼接」入口');
  const retryHint = await page.textContent('[data-testid="runs-detail"]');
  assert(retryHint.includes('只会重新执行拼接'), '失败提示写明只重拼、不重新生成');
  assert(
    (await page.locator('[data-testid="runs-final-video"]').count()) === 0,
    '失败会话不拿镜头视频冒充成片',
  );

  await page.click('[data-testid="runs-assembly-retry"]');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="runs-assembly-retry"]') === null,
    { timeout: 15_000 },
  );
  assert(true, '点「重试拼接」后会话回到拼接中（按钮消失）');

  state.detail = detailSucceeded('assembly-task');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="runs-final-video"]') !== null,
    { timeout: 15_000 },
  );
  assert(true, '重试成功后成片播放器重新出现');

  // ── ⑤ 关闭详情跨两次轮询仍保持关闭 ──────────────────────────────────────
  await page.click('[data-testid="runs-detail-close"]');
  await page.waitForSelector('[data-testid="runs-detail"]', { state: 'detached', timeout: 10_000 });
  await sleep(7000); // > 2 × 3s 轮询
  assert(
    (await page.locator('[data-testid="runs-detail"]').count()) === 0,
    '关闭详情后跨两次轮询仍保持关闭（不会被自动重新打开）',
  );

  // ── ⑥ 375px + 长标题 + 多步骤：无横向溢出 ───────────────────────────────
  await page.setViewportSize({ width: 375, height: 760 });
  await page.click('[data-testid="runs-list"] tbody tr');
  await page.waitForSelector('[data-testid="runs-detail"]', { timeout: 10_000 });
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const detail = document.querySelector('[data-testid="runs-detail"]');
    return {
      doc: doc.scrollWidth - doc.clientWidth,
      detail: detail === null ? 0 : detail.scrollWidth - detail.clientWidth,
    };
  });
  assert(overflow.doc <= 1, `375px 页面无横向溢出（差值 ${overflow.doc}px）`);
  assert(overflow.detail <= 1, `375px 详情无横向溢出（差值 ${overflow.detail}px）`);
  assert(
    (await page.locator('[data-testid="runs-step-media-img-1"]').count()) === 1,
    '375px 下首帧缩略图仍可见',
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
