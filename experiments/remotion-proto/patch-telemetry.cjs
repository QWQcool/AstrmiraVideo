/**
 * 原型验证：短路 @remotion/web-renderer 的 sendUsageEvent（遥测），验证遥测请求归零。
 *
 * 原理：遥测的 5 个调用点全是 fire-and-forget（返回值不被渲染流程使用），
 * 所以把 sendUsageEvent 变成 no-op 即可让遥测全部失效，渲染零影响。
 *
 * 正式引入主项目时用 pnpm 的 patchedDependencies 落地（可逆补丁）；此脚本只在原型里验证效果。
 */
const fs = require('node:fs');
const path = require('node:path');

const target = path.join(
  __dirname,
  'node_modules',
  '@remotion',
  'web-renderer',
  'dist',
  'esm',
  'index.mjs',
);

const source = fs.readFileSync(target, 'utf8');

const START = 'var sendUsageEvent = async ({';
const END = '// src/take-screenshot.ts';

const startIdx = source.indexOf(START);
const endIdx = source.indexOf(END);
if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
  console.error('锚点未找到（版本可能变了）', { startIdx, endIdx });
  process.exit(1);
}

const patched =
  source.slice(0, startIdx) +
  'var sendUsageEvent = async () => Promise.resolve(undefined); // [astrmira] 遥测已短路（见 docs/UPSTREAM.md）\n\n' +
  source.slice(endIdx);

fs.writeFileSync(target, patched, 'utf8');
console.log('✓ sendUsageEvent 已短路为 no-op');
console.log('  原长度:', source.length, '→ 新长度:', patched.length);
