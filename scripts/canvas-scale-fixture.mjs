#!/usr/bin/env node

/**
 * S5-C 画布规模夹具（100/300 节点）。
 *
 * 为什么单独写：仓库此前没有规模夹具；B44 只有静态断言和一次手工注入。
 * 本脚本走真实 `/api/canvas/docs`，生成可复用的画布 + 唯一媒体文件，
 * 并写一份 manifest 到 `.tmp/s5c-fixtures/`，供 Playwright 基线/回归和清理使用。
 *
 * 用法：
 *   node scripts/canvas-scale-fixture.mjs --nodes 100
 *   node scripts/canvas-scale-fixture.mjs --nodes 300 --project s5c-300-manual
 *   node scripts/canvas-scale-fixture.mjs --cleanup s5c-scale-...
 *   node scripts/canvas-scale-fixture.mjs --cleanup-all
 *
 * 纪律：
 * - 只创建 `backend/outputs/s5c-fixture-*` 这一层新目录；不碰已有媒体文件；
 * - 拒绝操作 B2 的 `f096506a-...`；
 * - 清理时先 DELETE 文档，再删本次唯一目录；manifest 记录对应关系。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createCanvasNode, createEmptyCanvasDoc } from '../packages/shared/dist/canvasDoc.js';

const require = createRequire(import.meta.url);
const sharp = require(path.resolve('backend/node_modules/sharp'));

const ROOT = process.cwd();
const MANIFEST_DIR = path.join(ROOT, '.tmp', 's5c-fixtures');
const OUTPUT_DIR = path.join(ROOT, 'backend', 'outputs');
const PROTECTED_PROJECT = 'f096506a-6a1a-4581-905c-58fd27547bff';

const args = process.argv.slice(2);
const option = (name, fallback = null) => {
  const prefix = `--${name}=`;
  const hit = args.find((item) => item.startsWith(prefix));
  if (hit !== undefined) return hit.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  const next = index === -1 ? undefined : args[index + 1];
  return next === undefined || next.startsWith('--') ? fallback : next;
};
const flag = (name) => args.includes(`--${name}`);
const base = option('base', 'http://127.0.0.1:3000').replace(/\/$/, '');
const nodesCount = Number(option('nodes', '100'));
const edgesRequested = Number(option('edges', '0'));
const columns = Number(option('columns', '10'));
const projectArg = option('project');
const cleanupId = option('cleanup');

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function assertSafeProject(projectId) {
  if (projectId === PROTECTED_PROJECT) fail('拒绝操作 B2 用户画布');
}

function manifestPath(projectId) {
  return path.join(MANIFEST_DIR, `${projectId}.json`);
}

function readManifest(projectId) {
  const file = manifestPath(projectId);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function deleteProject(projectId) {
  assertSafeProject(projectId);
  const response = await fetch(`${base}/api/canvas/docs/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
  });
  if (!response.ok && response.status !== 404) {
    fail(`DELETE ${projectId} 失败：HTTP ${response.status} ${await response.text()}`);
  }
}

async function cleanupOne(projectId) {
  assertSafeProject(projectId);
  const manifest = readManifest(projectId);
  await deleteProject(projectId);
  if (manifest?.mediaDir !== undefined) {
    fs.rmSync(manifest.mediaDir, { recursive: true, force: true });
  }
  const file = manifestPath(projectId);
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  console.log(`✓ cleaned ${projectId}${manifest?.mediaDir ? ` + ${path.basename(manifest.mediaDir)}` : ''}`);
}

if (cleanupId !== null) {
  await cleanupOne(cleanupId);
  process.exit(0);
}

if (flag('cleanup-all')) {
  if (!fs.existsSync(MANIFEST_DIR)) {
    console.log('没有 manifest，无需清理');
    process.exit(0);
  }
  for (const name of fs.readdirSync(MANIFEST_DIR)) {
    if (!name.endsWith('.json')) continue;
    const manifest = JSON.parse(fs.readFileSync(path.join(MANIFEST_DIR, name), 'utf8'));
    if (manifest.projectId !== undefined) await cleanupOne(manifest.projectId);
  }
  process.exit(0);
}

if (!Number.isInteger(nodesCount) || nodesCount < 1 || nodesCount > 400) {
  fail('--nodes 必须是 1~400 的整数');
}
if (!Number.isInteger(columns) || columns < 1) fail('--columns 必须是正整数');

const token = crypto.randomBytes(4).toString('hex');
const projectId = projectArg ?? `s5c-scale-${nodesCount}-${Date.now()}-${token}`;
assertSafeProject(projectId);
const mediaDirName = `s5c-fixture-${token}`;
const mediaDir = path.join(OUTPUT_DIR, mediaDirName);
fs.mkdirSync(mediaDir, { recursive: true });

console.log(`projectId=${projectId}`);
console.log(`nodes=${nodesCount} columns=${columns}`);
console.log(`mediaDir=${path.relative(ROOT, mediaDir)}`);

const now = Date.now();
const doc = createEmptyCanvasDoc(projectId, `S5C 规模夹具 · ${nodesCount} 节点`, now);

for (let index = 0; index < nodesCount; index += 1) {
  // 每个节点一张独立文件：避免浏览器按同一 URL 缓存后只解码一次。
  // 尺寸循环 64/512/2048，既覆盖大图解码，也不让 300 张 2048 占满盘（纯色 PNG 很小）。
  const size = index % 17 === 0 ? 2048 : index % 7 === 0 ? 512 : 64;
  const hue = Math.round((index * 137.508) % 360);
  const fileName = `img-${index}.png`;
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: { r: Math.round((hue * 255) / 360), g: 64, b: 160 },
    },
  })
    .png({ compressionLevel: 9 })
    .toFile(path.join(mediaDir, fileName));

  const node = createCanvasNode({
    id: `n${index}`,
    type: 'image',
    x: (index % columns) * 360,
    y: Math.floor(index / columns) * 380,
    title: `S5C fixture ${index}`,
    source: 'model_generated',
    createdFrom: 'toolbar',
    now,
  });
  node.data.batches = [
    {
      id: `batch-${index}`,
      createdAt: now,
      status: 'succeeded',
      outputs: [
        {
          assetId: `fixture-${index}`,
          kind: 'image',
          url: `/media/${mediaDirName}/${fileName}`,
          width: size,
          height: size,
        },
      ],
    },
  ];
  node.data.selectedBatchId = `batch-${index}`;
  doc.nodes.push(node);
}

// 默认不造边：S5-C 的规模口径是节点数；需要边时用 --edges=N 显式加。
const edgeCount = Math.min(Math.max(0, Number.isInteger(edgesRequested) ? edgesRequested : 0), nodesCount - 1);
for (let index = 1; index <= edgeCount; index += 1) {
  doc.edges.push({
    id: `edge-${index}`,
    from: `n${index - 1}`,
    to: `n${index}`,
    kind: 'lineage',
  });
}

const response = await fetch(`${base}/api/canvas/docs/${encodeURIComponent(projectId)}`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(doc),
});
if (!response.ok) {
  fs.rmSync(mediaDir, { recursive: true, force: true });
  fail(`PUT ${projectId} 失败：HTTP ${response.status} ${await response.text()}`);
}
const saved = await response.json();

fs.mkdirSync(MANIFEST_DIR, { recursive: true });
const manifest = {
  projectId,
  nodes: nodesCount,
  edges: edgeCount,
  mediaDir,
  mediaDirName,
  createdAt: now,
  revision: saved.revision,
};
fs.writeFileSync(manifestPath(projectId), JSON.stringify(manifest, null, 2));
console.log(`✓ created ${projectId} (${doc.nodes.length} nodes, ${doc.edges.length} edges)`);
console.log(`manifest=${path.relative(ROOT, manifestPath(projectId))}`);
console.log(`canvasUrl=${base.replace(':3000', ':5173')}/#/canvas?project=${projectId}`);
