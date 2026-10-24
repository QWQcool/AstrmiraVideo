#!/usr/bin/env node
/**
 * CDP 点击 + 截图（观察即梦画布交互；只点击坐标，不读凭据）。
 * 用法：node scripts/cdp-click.mjs <x> <y> <输出名> [等待ms] [再点击坐标 "x2,y2"]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const CDP = 'http://127.0.0.1:9223';
const [x, y, name, waitMs = '2500', extra] = process.argv.slice(2);
const outDir = path.join(process.cwd(), '.tmp', 'jimeng-shots');
mkdirSync(outDir, { recursive: true });

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

const click = async (cx, cy) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 });
};
await click(Number(x), Number(y));
if (extra !== undefined) {
  await new Promise((r) => setTimeout(r, 600));
  const [ex, ey] = extra.split(',').map(Number);
  await click(ex, ey);
}
await new Promise((r) => setTimeout(r, Number(waitMs)));

const shot = await send('Page.captureScreenshot', { format: 'png' });
const file = path.join(outDir, `${name}.png`);
writeFileSync(file, Buffer.from(shot.data, 'base64'));
console.log(`OK ${file}`);
ws.close();
