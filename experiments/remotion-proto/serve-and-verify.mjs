/**
 * P0 验证：起静态服务（public/）→ Playwright 真实浏览器打开 → 点导出 → 验证产物。
 * 用法：node serve-and-verify.mjs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = 5198;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.mp4': 'video/mp4',
  '.aac': 'audio/aac',
  '.png': 'image/png',
};

const server = createServer(async (req, res) => {
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const rel = urlPath === '/' ? '/web-export.html' : urlPath;
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !existsSync(file)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const ext = path.extname(file).toLowerCase();
  const data = await readFile(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    // web-renderer 的内部渲染上下文要 fetch 视频源 → 必须允许跨源
    'access-control-allow-origin': '*',
  });
  res.end(data);
});

await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
console.log(`静态服务：http://127.0.0.1:${PORT}/web-export.html`);

// ── Playwright 真实浏览器验证 ──
const { chromium } = await import('playwright');
const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-features=WebCodecs'],
});
const page = await browser.newPage();

page.on('console', (msg) => {
  const text = msg.text();
  if (msg.type() === 'error' || msg.type() === 'warning') console.log(`  [console.${msg.type()}] ${text.slice(0, 200)}`);
});
page.on('pageerror', (err) => console.log(`  [pageerror] ${err.message.slice(0, 200)}`));

// 遥测观测：记录所有发到 remotion 域名的请求（验证 patch 前后）
const telemetryCalls = [];
page.on('request', (req) => {
  const url = req.url();
  if (/remotion\.(dev|com|org)/i.test(url) || /register-usage|telemetry|\/api\/track/i.test(url)) {
    telemetryCalls.push(url);
    console.log(`  [遥测请求] ${req.method()} ${url}`);
  }
});

await page.goto(`http://127.0.0.1:${PORT}/web-export.html`, { waitUntil: 'load' });
console.log('✓ 页面已加载');

// WebCodecs 支持性
const support = await page.evaluate(() => ({
  videoEncoder: typeof VideoEncoder !== 'undefined',
  videoDecoder: typeof VideoDecoder !== 'undefined',
}));
console.log(`WebCodecs: VideoEncoder=${support.videoEncoder} VideoDecoder=${support.videoDecoder}`);

// 勾选"含视频轨"，点导出按钮，等导出完成（__P0_DONE__ 标志）
const WITH_VIDEO = process.env.WITH_VIDEO !== '0';
if (WITH_VIDEO) {
  await page.check('#withVideo');
  console.log('点击导出（**含视频轨**：读成片 input.mp4 裁剪 1~4s + 中文字幕）…');
} else {
  console.log('点击导出（纯字幕）…');
}
await page.click('#go');
await page.waitForFunction(() => window.__P0_DONE__ !== undefined, { timeout: 180_000 });

const done = await page.evaluate(() => window.__P0_DONE__);
const logText = await page.evaluate(() => document.getElementById('log').textContent);
console.log('\n── 页面日志 ──');
console.log(logText);

// 把导出的视频 blob 存盘验证
const videoSrc = await page.evaluate(() => document.getElementById('out')?.src ?? null);
if (videoSrc && videoSrc.startsWith('blob:')) {
  const bytes = await page.evaluate(async (src) => {
    const res = await fetch(src);
    const buf = await res.arrayBuffer();
    return Array.from(new Uint8Array(buf));
  }, videoSrc);
  writeFileSync('out/web-export-result.mp4', Buffer.from(bytes));
  console.log(`✓ 导出产物已存盘：out/web-export-result.mp4（${(bytes.length / 1024 / 1024).toFixed(2)}MB）`);
}

console.log(`\n遥测请求数：${telemetryCalls.length}`);
console.log(`P0 结果标志：${done}`);

await browser.close();
server.close();
