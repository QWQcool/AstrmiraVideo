#!/usr/bin/env node
/**
 * CDP 截图小工具（即梦页面观察；配合 --remote-debugging-port=9223 的 Edge）。
 * 用法：node scripts/cdp-shot.mjs [url] [输出名] [等待ms]
 * 不读页面内容、不抓凭据；只导航 + 截图（PNG 落 .tmp/jimeng-shots/）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const CDP = 'http://127.0.0.1:9223';
const url = process.argv[2] ?? '';
const name = process.argv[3] ?? `shot-${Date.now()}`;
const waitMs = Number(process.argv[4] ?? 4000);
const outDir = path.join(process.cwd(), '.tmp', 'jimeng-shots');
mkdirSync(outDir, { recursive: true });

// 拿一个可导航的 page target
const targets = await fetch(`${CDP}/json/list`).then((r) => r.json());
const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
if (page === undefined) throw new Error('没有可用的 page target');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id !== undefined && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error === undefined ? resolve(msg.result) : reject(new Error(msg.error.message));
  }
};

await new Promise((resolve) => { ws.onopen = resolve; });
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false,
});
if (url !== '') {
  await send('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, waitMs));
}
const shot = await send('Page.captureScreenshot', { format: 'png' });
const file = path.join(outDir, `${name}.png`);
writeFileSync(file, Buffer.from(shot.data, 'base64'));
console.log(`OK ${file} (${Math.round(shot.data.length / 1024)}KB) · title: ${page.title ?? ''}`);
ws.close();
