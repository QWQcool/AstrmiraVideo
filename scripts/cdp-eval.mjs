#!/usr/bin/env node
/** CDP eval：在页面里执行 JS（只读 DOM 查询/点击按钮；不读凭据、不发请求）。
 * 用法：node scripts/cdp-eval.mjs "JS 表达式" */
import { writeFileSync } from 'node:fs';

const CDP = 'http://127.0.0.1:9223';
const expr = process.argv[2] ?? 'document.title';
const targets = await fetch(`${CDP}/json/list`).then((r) => r.json());
const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
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
const result = await send('Runtime.evaluate', {
  expression: expr,
  returnByValue: true,
  awaitPromise: true,
});
writeFileSync('.tmp/jimeng-shots/eval-last.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result.result?.value ?? result, null, 2).slice(0, 3000));
ws.close();
