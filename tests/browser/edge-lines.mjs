#!/usr/bin/env node
/**
 * B109 / S10-U1：细白引用线的**真实浏览器**验收。
 *
 * ## 覆盖（每条都读真实 DOM / 真实鼠标）
 * 1. 事实边 = 1–1.5px 白色实线、无箭头；计划边 = 灰白虚线；
 * 2. 默认**没有**常驻标签；悬停 / 选中 / 键盘焦点才显示来源、目标、用途、版本；
 * 3. 旧边没有 `assetId` 时如实写"版本未记录"，不编版本；
 * 4. 拖动源/目标节点、平移、50% / 100% / 200% 缩放下，端点与连接柄**逐像素贴合**（容差 2px）；
 * 5. 删边只删边、不删节点/素材；撤销恢复；保存后刷新关系数与说明不变；
 * 6. 全程 0 生成 / 0 LLM 请求。
 *
 * ## 为什么缩放用"三个画布"
 * 视图缩放来自画布文档的 `viewport.zoom`（打开时恢复）。直接点缩放按钮只能得到 1.2^n，
 * 拿不到精确的 50% / 200%；种子三张只有 viewport 不同的画布，才是**真实**的 0.5 / 1 / 2。
 *
 * 用法：`node tests/browser/edge-lines.mjs [--headed] [--keep]`
 * 前置：`pnpm build`。
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
const SHOT_DIR = path.join(ROOT, '.tmp/b109');
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

/** 图片节点能当上游（有右侧出口）——参考文献里 linege 边的源必须是图片/视频 */
function imageNode(id, x, title, prompt) {
  return {
    id,
    type: 'image',
    layout: { x, y: 0, width: 320, height: 320 },
    data: {
      title,
      source: 'model_generated',
      draft: { kind: 'image', prompt, settings: {}, references: [] },
      batches: [],
      tags: [],
    },
    meta: { createdAt: 1, createdFrom: 'menu' },
  };
}

function videoNode(id, x, title) {
  return {
    id,
    type: 'video',
    layout: { x, y: 0, width: 420, height: 300 },
    data: {
      title,
      source: 'model_generated',
      draft: { kind: 'video', prompt: '', settings: {}, references: [] },
      batches: [],
      tags: [],
    },
    meta: { createdAt: 1, createdFrom: 'menu' },
  };
}

function canvasDoc(projectId, name, zoom, rawEdge = false) {
  const now = Date.now();
  return {
    version: 1,
    projectId,
    name,
    createdAt: now,
    updatedAt: now,
    viewport: { x: zoom >= 2 ? -120 : 40, y: 60, zoom },
    nodes: [
      imageNode('n1', 0, '首帧图', '雨夜街口的橘猫'),
      videoNode('n2', 420, '成片'),
      videoNode('n3', 880, '第二镜'),
    ],
    edges: [
      rawEdge
        ? // B109：旧边没有 assetId → 说明必须写"版本未记录"
          { id: 'e-line', from: 'n1', to: 'n2', kind: 'lineage', role: 'reference-image' }
        : {
            id: 'e-line',
            from: 'n1',
            to: 'n2',
            kind: 'lineage',
            role: 'reference-image',
            assetId: 'task:t-0123456789abcdef',
          },
      { id: 'e-plan', from: 'n2', to: 'n3', kind: 'dependency' },
    ],
    revision: 1,
  };
}

async function seed(baseUrl, doc) {
  const response = await fetch(`${baseUrl}/api/canvas/docs/${encodeURIComponent(doc.projectId)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-canvas-revision': '1' },
    body: JSON.stringify(doc),
  });
  if (!response.ok) throw new Error(`种子画布失败：HTTP ${response.status} ${await response.text()}`);
}

/** 读完一条边的几何：路径起止点的屏幕坐标 + 两端连接柄中心（都用 DOM 真实布局算） */
async function edgeGeometry(page, edgeId) {
  return page.evaluate((id) => {
    const group = document.querySelector(`.react-flow__edge[data-id="${id}"]`);
    const path2d = group?.querySelector('.react-flow__edge-path');
    if (group === undefined || path2d === null || path2d === undefined) return null;
    const start = path2d.getPointAtLength(0);
    const end = path2d.getPointAtLength(path2d.getTotalLength());
    const matrix = path2d.getScreenCTM();
    if (matrix === null) return null;
    const screen = (point) => ({
      x: point.x * matrix.a + point.y * matrix.c + matrix.e,
      y: point.x * matrix.b + point.y * matrix.d + matrix.f,
    });
    const center = (element) => {
      if (element === null) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    /**
     * 端点必须落在**连接柄**上（1px 的线不能悬在半空）：
     * 用连接柄的真实包围盒判定，而不是去猜 React Flow 内部按哪条边算锚点。
     */
    const rectOf = (selector) => {
      const element = document.querySelector(selector);
      if (element === null) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    };
    return {
      start: screen(start),
      end: screen(end),
      sourceHandle: rectOf('.react-flow__node[data-id="n1"] .react-flow__handle-right'),
      targetHandle: rectOf('.react-flow__node[data-id="n2"] .react-flow__handle-left'),
      d: path2d.getAttribute('d'),
    };
  }, edgeId);
}

/** 点到连接柄包围盒的偏差（0 = 落在柄内） */
function handleOffset(point, rect, pad = 2) {
  if (point === null || rect === null) return Number.POSITIVE_INFINITY;
  const dx = Math.max(rect.left - pad - point.x, 0, point.x - (rect.right + pad));
  const dy = Math.max(rect.top - pad - point.y, 0, point.y - (rect.bottom + pad));
  return Math.hypot(dx, dy);
}

/** 两端相对连接柄的最大偏差 */
function edgeOffset(geometry) {
  if (geometry === null) return Number.POSITIVE_INFINITY;
  return Math.max(
    handleOffset(geometry.start, geometry.sourceHandle),
    handleOffset(geometry.end, geometry.targetHandle),
  );
}

function distance(a, b) {
  if (a === null || b === null) return Number.POSITIVE_INFINITY;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

if (!existsSync(BACKEND_ENTRY) || !existsSync(path.join(FRONTEND_DIST, 'index.html'))) {
  console.error('✗ 缺构建产物：请先执行 `pnpm build`');
  process.exit(1);
}

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-b109-data-'));
const OUTPUTS_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-b109-out-'));
const PORT = await freePort();
const baseUrl = `http://127.0.0.1:${PORT}`;
mkdirSync(SHOT_DIR, { recursive: true });

console.log('\n=== B109：细白引用线（真实鼠标 / 真实几何） ===');
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
    PUBLIC_API_TOKEN: 'b109-loopback-only',
    VOLCANO_API_KEY: '',
  },
  stdio: 'ignore',
});

let browser;
try {
  if (!(await waitForHealth(baseUrl))) throw new Error('后端未就绪');
  await seed(baseUrl, canvasDoc('edge-100', '引用线 100%', 1));
  await seed(baseUrl, canvasDoc('edge-50', '引用线 50%', 0.5));
  await seed(baseUrl, canvasDoc('edge-200', '引用线 200%', 2));
  await seed(baseUrl, canvasDoc('edge-legacy', '旧边（无版本）', 1, true));

  browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  });
  await context.addInitScript(() => window.localStorage.setItem('astrmira.lang', 'zh'));
  const page = await context.newPage();

  const requests = { generate: 0, agent: 0 };
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() !== 'POST') return;
    if (url.pathname === '/api/generate') requests.generate += 1;
    if (url.pathname.startsWith('/api/agent/')) requests.agent += 1;
  });

  async function open(projectId) {
    await page.goto(`${baseUrl}/#/canvas?project=${projectId}`, { waitUntil: 'load' });
    await page.waitForSelector('.react-flow__edge', { timeout: 15_000 });
    await sleep(400);
  }

  // ── ① 线型：白实线 / 灰白虚线 / 无箭头 ─────────────────────────────────
  await open('edge-100');
  const styles = await page.evaluate(() => {
    const read = (selector) => {
      const element = document.querySelector(selector);
      if (element === null) return null;
      const computed = getComputedStyle(element);
      return {
        stroke: computed.stroke,
        width: Number.parseFloat(computed.strokeWidth),
        dash: computed.strokeDasharray,
        markerEnd: computed.markerEnd,
      };
    };
    return {
      lineage: read('.react-flow__edge.cs-edge--lineage .react-flow__edge-path'),
      plan: read('.react-flow__edge.cs-edge--dependency .react-flow__edge-path'),
      edgeCount: document.querySelectorAll('.react-flow__edge').length,
    };
  });
  assert(styles.edgeCount === 2, `两条边都渲染出来了（${styles.edgeCount}）`);
  assert(
    styles.lineage !== null && styles.lineage.width >= 1 && styles.lineage.width <= 1.5,
    `事实边线宽在 1–1.5px（${styles.lineage?.width}px）`,
  );
  const white = /rgba?\(255,\s*255,\s*255/.test(styles.lineage?.stroke ?? '');
  assert(white, `事实边是白色（${styles.lineage?.stroke}）`);
  assert(styles.lineage?.dash === 'none' || styles.lineage?.dash === '', '事实边是实线');
  assert(
    styles.lineage?.markerEnd === 'none' || styles.lineage?.markerEnd === '',
    `默认无箭头（${styles.lineage?.markerEnd}）`,
  );
  assert(
    styles.plan !== null && styles.plan.dash !== 'none' && styles.plan.dash !== '',
    `计划边是虚线（${styles.plan?.dash}）`,
  );

  // ── ② 标签默认隐藏；悬停 / 焦点 / 选中才显示 ────────────────────────────
  const labelOpacity = () =>
    page.evaluate(() => {
      const wrapper = document.querySelector(
        '.react-flow__edge[data-id="e-line"] .react-flow__edge-textwrapper',
      );
      return wrapper === null ? null : getComputedStyle(wrapper).opacity;
    });
  assert((await labelOpacity()) === '0', '默认不显示常驻标签');
  const labelText = await page.textContent(
    '.react-flow__edge[data-id="e-line"] .react-flow__edge-textwrapper',
  );
  assert(
    labelText !== null &&
      labelText.includes('首帧图') &&
      labelText.includes('成片') &&
      labelText.includes('参考图') &&
      labelText.includes('task:t-0123456789'),
    `说明含来源/目标/用途/版本（${labelText}）`,
  );

  // 悬停：把鼠标移到路径**中点**（真实坐标，不是元素包围盒中心）
  const midpoint = await page.evaluate(() => {
    const path2d = document.querySelector('.react-flow__edge[data-id="e-line"] .react-flow__edge-path');
    const point = path2d.getPointAtLength(path2d.getTotalLength() / 2);
    const matrix = path2d.getScreenCTM();
    return { x: point.x * matrix.a + point.y * matrix.c + matrix.e, y: point.x * matrix.b + point.y * matrix.d + matrix.f };
  });
  await page.mouse.move(midpoint.x, midpoint.y);
  await sleep(250);
  assert((await labelOpacity()) === '1', '悬停显示说明');

  await page.mouse.move(10, 10);
  await sleep(250);
  await page.evaluate(() => document.querySelector('.react-flow__edge[data-id="e-line"]')?.focus());
  await sleep(250);
  assert((await labelOpacity()) === '1', '键盘焦点显示说明');

  // 点击选中
  await page.mouse.click(midpoint.x, midpoint.y);
  await sleep(250);
  const selectedInfo = await page.evaluate(() => {
    const element = document.querySelector('.react-flow__edge[data-id="e-line"]');
    return { className: element?.getAttribute('class'), element: element !== null };
  });
  assert(selectedInfo.className?.includes('selected') === true, `点击选中边（${selectedInfo.className}）`);
  assert((await labelOpacity()) === '1', '选中时说明保持可见');

  // ── ③ 旧边没有版本 → 如实写"版本未记录" ────────────────────────────────
  await open('edge-legacy');
  const legacyLabel = await page.textContent(
    '.react-flow__edge[data-id="e-line"] .react-flow__edge-textwrapper',
  );
  assert(
    legacyLabel !== null && legacyLabel.includes('版本未记录') && !legacyLabel.includes('task:'),
    `旧边如实显示"版本未记录"（${legacyLabel}）`,
  );

  // ── ④ 拖动两端节点：端点跟随 ────────────────────────────────────────────
  await open('edge-100');
  const beforeDrag = await edgeGeometry(page, 'e-line');
  // 拖节点标题栏（连接柄本身不可拖）
  const nodeRect = await page.evaluate(() => {
    const rect = document.querySelector('.react-flow__node[data-id="n1"]')?.getBoundingClientRect();
    return rect === undefined ? null : { x: rect.x, y: rect.y };
  });
  await page.mouse.move(nodeRect.x + 40, nodeRect.y + 20);
  await page.mouse.down();
  await page.mouse.move(nodeRect.x + 140, nodeRect.y + 120, { steps: 12 });
  await page.mouse.up();
  await sleep(400);
  const afterDrag = await edgeGeometry(page, 'e-line');
  assert(afterDrag.d !== beforeDrag.d, '拖动节点后边的路径真的变了（不是静态线）');
  assert(
    edgeOffset(afterDrag) <= 2,
    `拖动源节点后两端仍锚定节点边缘（最大偏差 ${edgeOffset(afterDrag).toFixed(1)}px）`,
  );

  // 拖动目标节点
  const targetRect = await page.evaluate(() => {
    const rect = document.querySelector('.react-flow__node[data-id="n2"]')?.getBoundingClientRect();
    return rect === undefined ? null : { x: rect.x, y: rect.y };
  });
  await page.mouse.move(targetRect.x + 60, targetRect.y + 20);
  await page.mouse.down();
  await page.mouse.move(targetRect.x + 60, targetRect.y + 220, { steps: 12 });
  await page.mouse.up();
  await sleep(400);
  const afterTargetDrag = await edgeGeometry(page, 'e-line');
  assert(
    edgeOffset(afterTargetDrag) <= 2,
    `拖动目标节点后两端仍锚定节点边缘（最大偏差 ${edgeOffset(afterTargetDrag).toFixed(1)}px）`,
  );

  // ── ⑤ 平移：端点随视口移动且仍贴合 ──────────────────────────────────────
  const viewportBefore = await page.evaluate(
    () => document.querySelector('.react-flow__viewport')?.style.transform ?? '',
  );
  await page.mouse.move(700, 700);
  await page.mouse.down();
  await page.mouse.move(820, 760, { steps: 12 });
  await page.mouse.up();
  await sleep(400);
  const viewportAfter = await page.evaluate(
    () => document.querySelector('.react-flow__viewport')?.style.transform ?? '',
  );
  assert(viewportAfter !== viewportBefore, '画布真的平移了（viewport transform 变化）');
  const afterPan = await edgeGeometry(page, 'e-line');
  assert(
    edgeOffset(afterPan) <= 2,
    `平移后两端仍锚定节点边缘（最大偏差 ${edgeOffset(afterPan).toFixed(1)}px）`,
  );

  // ── ⑥ 50% / 100% / 200% 缩放：端点仍贴合 ───────────────────────────────
  for (const [projectId, expectedZoom] of [
    ['edge-50', 0.5],
    ['edge-100', 1],
    ['edge-200', 2],
  ]) {
    await open(projectId);
    const zoom = await page.evaluate(() => {
      const transform = document.querySelector('.react-flow__viewport')?.style.transform ?? '';
      const match = /scale\(([-\d.]+)\)/.exec(transform);
      return match === null ? null : Number.parseFloat(match[1]);
    });
    assert(
      zoom !== null && Math.abs(zoom - expectedZoom) < 0.01,
      `${projectId} 的视图缩放为 ${expectedZoom}（实际 ${zoom}）`,
    );
    const geometry = await edgeGeometry(page, 'e-line');
    assert(
      edgeOffset(geometry) <= 2,
      `${Math.round(expectedZoom * 100)}% 缩放下端点仍锚定节点边缘（最大偏差 ${edgeOffset(geometry).toFixed(1)}px）`,
    );
  }

  // ── ⑦ 删边不误删节点；撤销恢复 ─────────────────────────────────────────
  await open('edge-100');
  const countsBefore = await page.evaluate(() => ({
    edges: document.querySelectorAll('.react-flow__edge').length,
    nodes: document.querySelectorAll('.react-flow__node').length,
  }));
  const edgeBox = await page.evaluate(() => {
    const path2d = document.querySelector('.react-flow__edge[data-id="e-line"] .react-flow__edge-path');
    const point = path2d.getPointAtLength(path2d.getTotalLength() / 2);
    const matrix = path2d.getScreenCTM();
    return { x: point.x * matrix.a + point.y * matrix.c + matrix.e, y: point.y * matrix.b + point.y * matrix.d + matrix.f };
  });
  await page.mouse.click(edgeBox.x, edgeBox.y, { button: 'right' });
  await page.waitForSelector('.cs-menu', { timeout: 5_000 });
  await page.click('.cs-menu-item:has-text("删除来源边")');
  await sleep(500);
  const countsAfterDelete = await page.evaluate(() => ({
    edges: document.querySelectorAll('.react-flow__edge').length,
    nodes: document.querySelectorAll('.react-flow__node').length,
  }));
  assert(
    countsAfterDelete.edges === countsBefore.edges - 1,
    `删边只删这一条（${countsBefore.edges} → ${countsAfterDelete.edges}）`,
  );
  assert(
    countsAfterDelete.nodes === countsBefore.nodes,
    `删边没有误删节点（仍是 ${countsAfterDelete.nodes} 个）`,
  );

  await page.keyboard.press('Control+z');
  await sleep(600);
  const countsAfterUndo = await page.evaluate(() => ({
    edges: document.querySelectorAll('.react-flow__edge').length,
    nodes: document.querySelectorAll('.react-flow__node').length,
  }));
  assert(
    countsAfterUndo.edges === countsBefore.edges && countsAfterUndo.nodes === countsBefore.nodes,
    '撤销后关系数量与节点数都恢复',
  );

  // ── ⑧ 保存后刷新：关系数、说明、线型都不变 ──────────────────────────────
  await page.waitForFunction(
    () => document.querySelector('.cs-save')?.getAttribute('data-state') === 'saved',
    { timeout: 15_000 },
  );
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.react-flow__edge', { timeout: 15_000 });
  await sleep(400);
  const afterReload = await page.evaluate(() => ({
    edges: document.querySelectorAll('.react-flow__edge').length,
    label:
      document.querySelector(
        '.react-flow__edge[data-id="e-line"] .react-flow__edge-textwrapper',
      )?.textContent ?? '',
  }));
  assert(afterReload.edges === 2, `刷新后关系数不变（${afterReload.edges}）`);
  assert(
    afterReload.label.includes('首帧图') && afterReload.label.includes('task:t-0123456789'),
    '刷新后说明（来源/目标/版本）不变',
  );

  await page.screenshot({ path: path.join(SHOT_DIR, 'edge-lines-100.png') });
  assert(true, `截图留存：${path.join(SHOT_DIR, 'edge-lines-100.png')}`);

  assert(
    requests.generate === 0 && requests.agent === 0,
    `整组操作 0 生成 / 0 LLM（实际 ${JSON.stringify(requests)}）`,
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
