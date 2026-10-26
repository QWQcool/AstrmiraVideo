#!/usr/bin/env node
/**
 * B95 / CONTRACT §17：画布纳入备份、校验与恢复的**跨进程**验收。
 *
 * ## 为什么不是纯单测
 * 单测证明 `createBackup` / `verifyBackup` / `applyRestore` 的函数语义；这里要证明的是
 * **实际部署形态**：真实服务写出的 `data/canvas`、真实 CLI、真实恢复、再由**应用 HTTP 接口**
 * 读回来。只有这条链路能回答"换机之后画布还在不在"。
 *
 * ## 流程
 * 1. 起服务 A（独立 DATA_DIR）→ 用 HTTP 建两张画布（含节点与来源边）+ 建一张再删（墓碑）；
 * 2. 停服务 → CLI `backup --no-outputs`（**证明媒体开关不影响画布**）→ CLI `verify`；
 * 3. CLI `restore` 到**另一个** DATA_DIR（不碰原目录）；
 * 4. 起服务 B（新目录）→ 经 `/api/canvas/projects` 与 `/api/canvas/docs/:id` 核对：
 *    两张画布都在、节点/边一致、已删画布仍是 404（墓碑生效）。
 *
 * 只操作临时目录，不对用户现有数据执行恢复或清理。
 *
 * 用法：`node tests/integration/backup-canvas.mjs [--keep]`
 * 前置：`pnpm build`。
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BACKEND_ENTRY = path.join(ROOT, 'backend/dist/index.js');
const OPS_CLI = path.join(ROOT, 'backend/dist/ops/cli.js');
const FRONTEND_DIST = path.join(ROOT, 'frontend/dist');
const KEEP = process.argv.includes('--keep');

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

async function runCli(args, env) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [OPS_CLI, ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      encoding: 'utf8',
    });
    return { code: 0, output: `${stdout}${stderr}` };
  } catch (error) {
    return {
      code: typeof error.code === 'number' ? error.code : 1,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    };
  }
}

function spawnServer(dataDir, outputsDir, port) {
  return spawn(process.execPath, [BACKEND_ENTRY], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATA_DIR: dataDir,
      OUTPUT_DIR: outputsDir,
      FRONTEND_DIST,
      PUBLIC_API_TOKEN: 'b95-loopback-only',
      VOLCANO_API_KEY: '',
    },
    stdio: 'ignore',
  });
}

async function stopServer(child) {
  if (child === undefined) return;
  child.kill();
  await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    setTimeout(resolve, 5000);
  });
}

function canvasDoc(projectId, name, nodes, edges) {
  const now = Date.now();
  return {
    version: 1,
    projectId,
    name,
    createdAt: now,
    updatedAt: now,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes,
    edges,
    revision: 1,
  };
}

function node(id, type, x, title) {
  return {
    id,
    type,
    layout: {
      x,
      y: 0,
      width: type === 'video' ? 420 : 320,
      height: type === 'video' ? 300 : 160,
    },
    data: {
      title,
      source: 'uploaded',
      draft: { kind: type, prompt: '', settings: {}, references: [] },
      batches: [],
      tags: [],
    },
    meta: { createdAt: Date.now(), createdFrom: 'menu' },
  };
}

async function putDoc(baseUrl, doc) {
  const response = await fetch(`${baseUrl}/api/canvas/docs/${encodeURIComponent(doc.projectId)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-canvas-revision': '1' },
    body: JSON.stringify(doc),
  });
  if (!response.ok) throw new Error(`PUT ${doc.projectId} → HTTP ${response.status} ${await response.text()}`);
  return response.json();
}

if (!existsSync(BACKEND_ENTRY) || !existsSync(OPS_CLI)) {
  console.error('✗ 缺构建产物：请先执行 `pnpm build`（backend/dist/index.js 与 dist/ops/cli.js）');
  process.exit(1);
}

const root = mkdtempSync(path.join(tmpdir(), 'astrmira-b95-'));
const dataA = path.join(root, 'data-a');
const outA = path.join(root, 'out-a');
const dataB = path.join(root, 'data-b');
const outB = path.join(root, 'out-b');
const backupDir = path.join(root, 'backup');

console.log('\n=== B95：画布纳入备份 / 校验 / 恢复（跨进程 + 应用接口复核）===');
console.log(`临时根目录：${root}`);

let server;
try {
  // ── 1. 服务 A：真实 HTTP 写出两张画布（含节点与来源边）+ 一张删除墓碑 ──
  const portA = await freePort();
  const baseA = `http://127.0.0.1:${portA}`;
  server = await spawnServer(dataA, outA, portA);
  if (!(await waitForHealth(baseA))) throw new Error('服务 A 未就绪');

  const docA = canvasDoc(
    'canvas-a',
    '画布 A（雨夜）',
    [node('n1', 'image', 0, '首帧'), node('n2', 'video', 480, '成片')],
    [{ id: 'e1', from: 'n1', to: 'n2', kind: 'lineage', role: 'first-frame', assetId: 'task:t-1' }],
  );
  const docB = canvasDoc('canvas-b', '画布 B（日光）', [node('n3', 'text', 0, '提示词')], []);
  const docGone = canvasDoc('canvas-gone', '将被删除的画布', [node('n4', 'text', 0, 'x')], []);
  await putDoc(baseA, docA);
  await putDoc(baseA, docB);
  await putDoc(baseA, docGone);
  const deleted = await fetch(`${baseA}/api/canvas/docs/canvas-gone`, { method: 'DELETE' });
  assert(deleted.ok, '服务 A：第三张画布已删除（写入墓碑）');

  const before = await (await fetch(`${baseA}/api/canvas/projects`)).json();
  assert(before.projects.length === 2, `服务 A：索引里有 2 张画布（实际 ${before.projects.length}）`);

  await stopServer(server);
  server = undefined;

  // ── 2. 停服后备份（--no-outputs 只影响媒体）与校验 ──
  const envA = { DATA_DIR: dataA, OUTPUT_DIR: outA };
  const backup = await runCli(['backup', '--out', backupDir, '--no-outputs'], envA);
  assert(backup.code === 0, `CLI backup 成功（exit=${backup.code}）`);
  assert(backup.output.includes('画布：2 张'), '备份输出如实报告画布数（2 张）');
  assert(backup.output.includes('墓碑 1 个'), '备份输出如实报告墓碑数（1 个）');

  const manifest = JSON.parse(readFileSync(path.join(backupDir, 'manifest.json'), 'utf8'));
  assert(manifest.backupVersion === 2, `manifest 版本为 2（实际 ${manifest.backupVersion}）`);
  assert(manifest.includeCanvas === true, 'manifest 标记 includeCanvas=true');
  assert(manifest.includeOutputs === false, '--no-outputs 只关媒体（includeOutputs=false）');
  assert(manifest.counts.canvases === 2, `manifest.counts.canvases=2（实际 ${manifest.counts.canvases}）`);
  const canvasFiles = readdirSync(path.join(backupDir, 'canvas'));
  assert(
    canvasFiles.includes('canvas-a.doc.json') &&
      canvasFiles.includes('canvas-b.doc.json') &&
      canvasFiles.includes('canvas-gone.deleted') &&
      canvasFiles.includes('index.json'),
    `备份目录含两文档 + 索引 + 墓碑（${canvasFiles.join(', ')}）`,
  );

  const verify = await runCli(['verify', backupDir], envA);
  assert(verify.code === 0 && verify.output.includes('校验通过'), 'CLI verify 通过（含画布 sha256 与引用关系）');
  assert(verify.output.includes('画布 2 张'), 'verify 输出如实报告画布数');

  // ── 3. 恢复到**另一个**数据目录（不碰 A）──
  const restore = await runCli(['restore', backupDir, '--yes'], { DATA_DIR: dataB, OUTPUT_DIR: outB });
  assert(restore.code === 0, `CLI restore 到新目录成功（exit=${restore.code}）`);
  assert(restore.output.includes('已恢复 4 个文件'), '恢复输出报告画布文件数（2 文档 + 索引 + 墓碑 = 4）');
  assert(existsSync(path.join(dataB, 'canvas', 'canvas-a.doc.json')), '新目录里存在 canvas-a 文档');

  // ── 4. 服务 B：由**应用接口**读回，而不是直接读文件 ──
  const portB = await freePort();
  const baseB = `http://127.0.0.1:${portB}`;
  server = await spawnServer(dataB, outB, portB);
  if (!(await waitForHealth(baseB))) throw new Error('服务 B 未就绪');

  const after = await (await fetch(`${baseB}/api/canvas/projects`)).json();
  const ids = after.projects.map((item) => item.projectId).sort();
  assert(
    ids.length === 2 && ids[0] === 'canvas-a' && ids[1] === 'canvas-b',
    `恢复后接口只列出 2 张画布（实际 ${ids.join(', ')}）`,
  );
  assert(!ids.includes('canvas-gone'), '已删除画布没有被恢复成"活着的"（墓碑生效）');

  const docResponse = await fetch(`${baseB}/api/canvas/docs/canvas-a`);
  assert(docResponse.ok, '恢复后 GET canvas-a → 200');
  const restoredDoc = await docResponse.json();
  assert(restoredDoc.name === '画布 A（雨夜）', '画布名称一致');
  assert(restoredDoc.nodes.length === 2, `节点数一致（实际 ${restoredDoc.nodes.length}）`);
  assert(
    restoredDoc.edges.length === 1 &&
      restoredDoc.edges[0].from === 'n1' &&
      restoredDoc.edges[0].to === 'n2' &&
      restoredDoc.edges[0].role === 'first-frame' &&
      restoredDoc.edges[0].assetId === 'task:t-1',
    '来源边（方向/用途/引用版本）逐字段一致',
  );
  const goneResponse = await fetch(`${baseB}/api/canvas/docs/canvas-gone`);
  assert(goneResponse.status === 404, '已删除画布仍为 404（墓碑被恢复）');

  // 恢复后的服务要能正常接受新保存（修订号从备份里的值继续）
  const revised = await fetch(`${baseB}/api/canvas/docs/canvas-a`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-canvas-revision': String(restoredDoc.revision) },
    body: JSON.stringify({ ...restoredDoc, name: '画布 A（恢复后改名）' }),
  });
  assert(revised.ok, `恢复后的画布可以继续保存（HTTP ${revised.status}）`);

  console.log('\n结果：' + (failures.length === 0 ? '全部通过' : `${failures.length} 项失败`));
} catch (error) {
  console.error(`\n✗ 脚本异常：${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  failures.push('脚本异常');
} finally {
  await stopServer(server);
  if (!KEEP) {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      console.log(`（清理临时目录失败，可忽略：${root}）`);
    }
  } else {
    console.log(`--keep：${root}`);
  }
}

for (const failure of failures) console.log(`  - ${failure}`);
process.exitCode = failures.length === 0 ? 0 : 1;
