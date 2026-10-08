import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HistoryResponse, LogListResponse } from '@astrmira/shared';
import { buildApp } from '../index.js';
import { openDatabase } from '../store/db.js';
import { TaskStore } from '../store/taskStore.js';

/**
 * 容量淘汰的**集成层**证据（V2.8 / 台账 B22；Step 9 · P1 的 AC1 + AC2）。
 *
 * 单测（`server/storageEvict.test.ts`）证明的是"策略函数"；这里证明**装配后的真实链路**：
 * ① 启动扫描真的删了最旧成片与封面（且留下记录）；
 * ② `GET /api/history` 对"文件已不在"的任务**省略直链**（不给必然 404 的 URL）；
 * ③ 操作日志出现 `storage.evict`（用户问"片子怎么没了"时有据可查）。
 *
 * 不走上游：淘汰规则只关心"任务记录 + 落盘文件"这两个事实，直接造它们最忠实。
 */

const TMP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-evict-ac-data-'));
const TMP_OUTPUTS_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-evict-ac-out-'));
const MB = 1024 * 1024;

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;

/**
 * 三条各 1MB 的成片（另有 64B 封面）：阈值 **2.8MB** / 目标 80% = 2.24MB
 * → 触发（3.0018MB > 2.8MB），删最旧一条后 2.0MB ≤ 2.24MB 停手 —— **只淘汰一条**。
 * （阈值之所以不取 2.5MB：那会让"删一条后 2.0009MB"恰好压线，连带淘汰第二条——
 *  首版就是这么写错的，教训：水位断言要留余量，别让标题数字刚好相等。）
 */
const OLDEST = 'evict-oldest';
const MID = 'evict-mid';
const NEWEST = 'evict-newest';

beforeAll(async () => {
  process.env.DATA_DIR = TMP_DATA_DIR;
  process.env.OUTPUT_DIR = TMP_OUTPUTS_DIR;
  process.env.OUTPUTS_MAX_BYTES = String(Math.floor(2.8 * MB));
  mkdirSync(path.join(TMP_OUTPUTS_DIR, 'thumbs'), { recursive: true });

  const db = openDatabase(path.join(TMP_DATA_DIR, 'app.db'));
  const store = new TaskStore(db);
  for (const [index, taskId] of [OLDEST, MID, NEWEST].entries()) {
    store.insert({
      taskId,
      track: 'cloud',
      provider: 'fixture-local',
      status: 'succeeded',
      progressPercent: 100,
      requestSnapshot: {
        prompt: `淘汰集成用例 ${taskId}`,
        mode: 't2v',
        aspectRatio: '16:9',
        provider: 'fixture-local',
      },
      warnings: [],
      submitting: false,
      outputVideoUrl: `/media/${taskId}.mp4`,
      thumbnailUrl: `/media/thumbs/${taskId}.jpg`,
      createdAt: index + 1, // 顺序固定：OLDEST 最旧
    });
    writeFileSync(path.join(TMP_OUTPUTS_DIR, `${taskId}.mp4`), Buffer.alloc(MB));
    writeFileSync(path.join(TMP_OUTPUTS_DIR, 'thumbs', `${taskId}.jpg`), Buffer.alloc(64));
  }
  db.close(); // 与 server/storageEvict.test.ts 同一条踩点：关库再交给 app 新连接

  app = await buildApp(); // 装配即启动淘汰器（index.ts 里"启动先跑一次"）
  await app.ready();
});

afterAll(async () => {
  await app.close();
  for (const dir of [TMP_DATA_DIR, TMP_OUTPUTS_DIR]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* 临时目录残留无碍 */
    }
  }
});

/** 等启动扫描收尾（它不阻塞 `app.ready()`：扫描与请求路径刻意解耦） */
async function waitForOldestEvicted(timeoutMs = 5_000): Promise<void> {
  const target = path.join(TMP_OUTPUTS_DIR, `${OLDEST}.mp4`);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!existsSync(target)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`等待容量淘汰超时：${target} 仍在`);
}

describe('容量淘汰 · 集成链路（B22 / AC1 + AC2）', () => {
  it('启动扫描淘汰最旧的成片与封面；任务记录与血缘保留', async () => {
    await waitForOldestEvicted();

    expect(existsSync(path.join(TMP_OUTPUTS_DIR, `${OLDEST}.mp4`))).toBe(false);
    expect(existsSync(path.join(TMP_OUTPUTS_DIR, 'thumbs', `${OLDEST}.jpg`))).toBe(false);
    // 降到目标水位即停：另外两条**不许**被误删
    expect(existsSync(path.join(TMP_OUTPUTS_DIR, `${MID}.mp4`))).toBe(true);
    expect(existsSync(path.join(TMP_OUTPUTS_DIR, `${NEWEST}.mp4`))).toBe(true);

    // 记录仍在（画廊显示"成片已清理"、画布显示 ghost 的前提）
    const detail = await app.inject({ method: 'GET', url: `/api/tasks/${OLDEST}` });
    expect(detail.statusCode).toBe(200);
  });

  it('GET /api/history：被淘汰的任务省略直链与封面（不给必然 404 的 URL），其它任务不受影响', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/history' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as HistoryResponse;

    const evicted = body.items.find((item) => item.taskId === OLDEST);
    expect(evicted, '被淘汰的任务仍应出现在历史里（只删文件、不删记录）').toBeDefined();
    expect(evicted?.status).toBe('succeeded');
    expect(evicted?.outputVideoUrl).toBeUndefined();
    expect(evicted?.thumbnailUrl).toBeUndefined();

    const kept = body.items.find((item) => item.taskId === NEWEST);
    expect(kept?.outputVideoUrl).toBe(`/media/${NEWEST}.mp4`);
    expect(kept?.outputSizeBytes).toBe(MB);
  });

  it('操作日志留下 storage.evict（含释放字节数与被淘汰的 taskId）', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/logs?action=storage.evict' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as LogListResponse;

    expect(body.items).toHaveLength(1);
    const entry = body.items[0]!;
    expect(entry.method).toBe('STORAGE');
    expect(entry.path).toBe('/api/storage/evict');
    const detail = entry.detail as { freedBytes?: number; evictedTaskIds?: string[] };
    expect(detail.freedBytes).toBeGreaterThanOrEqual(MB);
    expect(detail.evictedTaskIds).toContain(OLDEST);
  });
});
