#!/usr/bin/env node
/**
 * 本地性能基准（PLAN §9 台账 **B9** 的第 4 项：性能基准）。
 *
 * ## 为什么**不进 CI**
 * 共享 runner 的绝对耗时噪声极大（同代码两次跑差 2~3 倍是常态），把阈值放进 CI
 * 只会把流水线变成随机红灯；而"宽松到不会红的阈值"又没有任何约束力。
 * 所以这里只提供**可复跑的测量方式**：在你自己的机器上跑，把数字与测量条件一起登记。
 *
 * ## 用法
 *   node scripts/bench.mjs              # 完整基准（含夹具出片，需要 ffmpeg）
 *   node scripts/bench.mjs --no-fixture # 只测接口往返与媒体 Range（不需要 ffmpeg）
 *
 * 输出：接口 p50/p95、夹具出片墙钟、206 首字节、下载吞吐。
 * 说明：本脚本自起一个后端实例（临时 DATA_DIR / OUTPUT_DIR），跑完即退出，不碰仓库数据。
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = path.join(ROOT, 'backend');
const TSX_CLI = path.join(BACKEND, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const args = new Set(process.argv.slice(2));
const WITH_FIXTURE = !args.has('--no-fixture');

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-bench-data-'));
const OUTPUTS_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-bench-out-'));

/** 取一个当前空闲的端口（先监听 0 再释放；bench 不是并发场景，竞态可忽略） */
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

function percentile(sorted, ratio) {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return {
    count: sorted.length,
    mean,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

async function measure(label, times, fn) {
  const samples = [];
  for (let index = 0; index < times; index += 1) {
    const startedAt = performance.now();
    const response = await fn(index);
    if (response !== undefined && response.ok === false) {
      throw new Error(`${label} 第 ${index + 1} 次请求失败：HTTP ${response.status}`);
    }
    samples.push(performance.now() - startedAt);
  }
  const result = stats(samples);
  console.log(
    `${label.padEnd(46)} n=${String(result.count).padStart(3)}  ` +
      `mean ${result.mean.toFixed(1).padStart(7)}ms  p50 ${result.p50.toFixed(1).padStart(7)}ms  ` +
      `p95 ${result.p95.toFixed(1).padStart(7)}ms  max ${result.max.toFixed(1).padStart(7)}ms`,
  );
  return result;
}

async function waitForHealth(baseUrl, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      /* 未就绪 */
    }
    await sleep(200);
  }
  throw new Error(`后端在 ${timeoutMs}ms 内未就绪`);
}

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;

const child = spawn(process.execPath, [TSX_CLI, 'src/index.ts'], {
  cwd: BACKEND,
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    DATA_DIR,
    OUTPUT_DIR: OUTPUTS_DIR,
    ENABLE_FIXTURE_PROVIDER: WITH_FIXTURE ? '1' : '',
    VOLCANO_API_KEY: '',
    PUBLIC_API_TOKEN: '',
  },
  stdio: 'ignore',
});

console.log(`\n=== AstrmiraVideo 本地基准 ===`);
console.log(`node ${process.version} · ${process.platform}/${process.arch} · ${new Date().toISOString()}`);
console.log(`后端实例：${baseUrl}（临时 DATA_DIR / OUTPUT_DIR，跑完即删）\n`);

try {
  await waitForHealth(baseUrl);

  await measure('GET /api/health', 50, () => fetch(`${baseUrl}/api/health`));
  await measure('GET /api/providers/status', 50, () => fetch(`${baseUrl}/api/providers/status`));
  await measure('GET /api/history（空画廊）', 20, () => fetch(`${baseUrl}/api/history`));

  if (WITH_FIXTURE) {
    const request = {
      prompt: '基准：雨夜街头的中景镜头',
      mode: 't2v',
      aspectRatio: '16:9',
      provider: 'fixture-local',
      params: { durationSec: 2 },
    };

    const startedAt = performance.now();
    const submit = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!submit.ok) throw new Error(`提交失败：HTTP ${submit.status} ${await submit.text()}`);
    const { taskId } = await submit.json();

    let terminal;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const response = await fetch(`${baseUrl}/api/tasks/${taskId}`);
      terminal = await response.json();
      if (['succeeded', 'failed', 'cancelled'].includes(terminal.status)) break;
      await sleep(100);
    }
    const wallMs = performance.now() - startedAt;
    console.log(
      `\n夹具出片（2s 片，含 ffmpeg 转码 + 队列 + 轮询）: ${wallMs.toFixed(0)}ms · 终态=${terminal?.status}`,
    );

    if (terminal?.status === 'succeeded') {
      const mediaUrl = terminal.outputVideoUrl;

      await measure(`GET /media Range 0-1023（首字节）`, 10, () =>
        fetch(`${baseUrl}${mediaUrl}`, { headers: { range: 'bytes=0-1023' } }),
      );

      const downloadStart = performance.now();
      const full = await fetch(`${baseUrl}${mediaUrl}`);
      const bytes = (await full.arrayBuffer()).byteLength;
      const downloadMs = performance.now() - downloadStart;
      console.log(
        `完整下载（本地回环）: ${(bytes / 1024 / 1024).toFixed(2)}MB / ${downloadMs.toFixed(0)}ms ` +
          `= ${(bytes / 1024 / 1024 / (downloadMs / 1000)).toFixed(1)}MB/s`,
      );

      await fetch(`${baseUrl}/api/history/${taskId}`, { method: 'DELETE' });
    }
  } else {
    console.log('\n（--no-fixture：已跳过夹具出片与媒体测量）');
  }

  console.log(
    '\n提示：把上面数字与**测量条件**（机器 / node 版本 / 是否插桩）一起登记，' +
      '不要只贴一个数——脱离条件的耗时没有可比性。CI 不设性能门限（理由见本脚本头注释）。\n',
  );
} finally {
  child.kill();
  await sleep(300);
  for (const dir of [DATA_DIR, OUTPUTS_DIR]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* 临时目录残留无碍 */
    }
  }
}
