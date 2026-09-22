import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GenerateResponse, TaskProgress, VideoGenerateRequest } from '@astrmira/shared';
import { buildApp } from '../index.js';
import { probeMedia } from '../lib/ffmpeg.js';
import { cropToAspect, isAlignedTo32 } from '../pipeline/smartCrop.js';

/**
 * 端到端固化（PLAN §9 台账 **B9 第 1 项**；同时也是 Step 4-AC4 的 CI 半边）。
 *
 * 与既有集成测试的分工（不是重复）：
 * - `routes/*.integration.test.ts` 走 `app.inject()` + **注入桩 provider**，验路由与队列的契约；
 * - 本文件走**真实 TCP**（`listen` + `fetch`）+ **真实 `fixture-local` provider**（ffmpeg 现渲染），
 *   验「HTTP → 调度 → 渲染 → 落盘 → `/media` 206 → 画廊 → 删除」这一整条链**真的连得起来**。
 *
 * 为什么必须有它：`inject` 不经过 socket、也不经过 `@fastify/static` 的 Range 实现，
 * 而「任务 succeeded 但播放器 404 / 黑屏」这类缺陷恰恰只在这一层暴露
 * （历史先例：`vite.config.ts` 缺 `/media` 代理 → 播放器黑屏而接口全绿）。
 *
 * 零外网、零配额、确定性：全部输入来自 `scripts/make-fixture-clips.mjs` 现场合成的夹具片。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const TMP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-e2e-data-'));
const TMP_OUTPUTS_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-e2e-out-'));
const TMP_DOWNLOAD_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-e2e-dl-'));

/** 请求 2s（夹具基线片 5s → 走「长于请求 → 裁切」，音轨保留，不产生告警） */
const REQUEST: VideoGenerateRequest = {
  prompt: '端到端夹具：雨夜街头的中景镜头',
  mode: 't2v',
  aspectRatio: '16:9',
  provider: 'fixture-local',
  params: { durationSec: 2 },
};

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let baseUrl = '';

/**
 * 断言响应状态码，并在不符时把响应体带进失败信息。
 *
 * 注意：**不能**写成 `expect(res.status, await res.text())` —— 消息参数是**先求值**的，
 * 即使断言通过也已经把 body 读掉，后续 `res.json()` 会抛 "Body is unusable"。
 */
async function assertStatus(response: Response, expected: number): Promise<void> {
  if (response.status !== expected) {
    expect.fail(`期望 HTTP ${expected}，实际 ${response.status}：${await response.text()}`);
  }
}

async function pollUntilTerminal(taskId: string, timeoutMs = 90_000): Promise<TaskProgress> {
  const deadline = Date.now() + timeoutMs;
  let last: TaskProgress | undefined;

  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/tasks/${taskId}`);
    await assertStatus(response, 200);
    last = (await response.json()) as TaskProgress;

    if (last.status === 'succeeded' || last.status === 'failed' || last.status === 'cancelled') {
      return last;
    }
    await sleep(200);
  }

  throw new Error(`任务在 ${timeoutMs}ms 内未到终态（最后状态：${last?.status ?? 'unknown'}）`);
}

beforeAll(async () => {
  // 夹具片段是测试的**输入**且不入库（`.gitignore`），现场合成（幂等）
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'make-fixture-clips.mjs')], {
    stdio: 'pipe',
  });

  // 存储与分析目录都指向临时目录：这条用例不碰仓库里的 data/ 与 outputs/
  process.env.DATA_DIR = TMP_DATA_DIR;
  process.env.OUTPUT_DIR = TMP_OUTPUTS_DIR;
  process.env.ENABLE_FIXTURE_PROVIDER = '1';

  app = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });

  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('未能取到监听端口（真实 TCP 是本用例的前提）');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 180_000);

afterAll(async () => {
  await app.close();

  for (const dir of [TMP_DATA_DIR, TMP_OUTPUTS_DIR, TMP_DOWNLOAD_DIR]) {
    // Windows 上 SQLite 的 WAL 句柄可能延迟释放：清理失败不应让测试失败
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* 临时目录残留无碍 */
    }
  }
});

describe('端到端：真实 HTTP → 调度器 → 夹具 provider → 落盘 → /media 206 → 画廊 → 删除', () => {
  it('提交 → 轮询至 succeeded → Range 206 → ffprobe 校验可播 → 画廊可见 → 删除释放磁盘', async () => {
    // ── ① 提交（真实 socket，不是 inject）──
    const submit = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(REQUEST),
    });
    await assertStatus(submit, 200);

    const { taskId } = (await submit.json()) as GenerateResponse;
    expect(taskId).toMatch(/^[0-9a-f-]{36}$/);

    // ── ② 轮询到终态（调度器 200ms 一 tick；夹具在 submit 内同步渲染）──
    const progress = await pollUntilTerminal(taskId);
    expect(progress.status, JSON.stringify(progress.error)).toBe('succeeded');
    expect(progress.progressPercent).toBe(100);
    // 5s 源片裁到 2s：音轨保留、不产生"循环拉伸 / 静音"告警
    expect(progress.warnings ?? []).toHaveLength(0);

    const mediaUrl = progress.outputVideoUrl as string;
    expect(mediaUrl).toMatch(/^\/media\/[0-9a-f-]{36}\.mp4$/);

    // ── ③ 产物必须落在 OUTPUT_DIR 内 ──
    // 回归钉子：夹具实例曾忽略 OUTPUT_DIR（写死 `<repo>/outputs`），
    // 而 `/media/*` 服务的是 `resolveOutputsDir()` —— 两者分叉时这里必红。
    const producedPath = path.join(TMP_OUTPUTS_DIR, path.basename(mediaUrl));
    expect(existsSync(producedPath), `产物不在 OUTPUT_DIR 内：${producedPath}`).toBe(true);
    expect(statSync(producedPath).size).toBeGreaterThan(10_000);

    // ── ④ Range 206（播放器拖动进度 / 断点续播的载体）──
    const ranged = await fetch(`${baseUrl}${mediaUrl}`, { headers: { range: 'bytes=0-1023' } });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toMatch(/^bytes 0-1023\/\d+$/);
    expect(ranged.headers.get('accept-ranges')).toBe('bytes');
    expect(Buffer.from(await ranged.arrayBuffer()).byteLength).toBe(1024);

    // ── ⑤ 全量下载 + ffprobe：证明是**真的可播**成片（不是空文件、不是 HTML）──
    const full = await fetch(`${baseUrl}${mediaUrl}`);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toContain('video/mp4');

    const downloadPath = path.join(TMP_DOWNLOAD_DIR, 'downloaded.mp4');
    writeFileSync(downloadPath, Buffer.from(await full.arrayBuffer()));

    const probe = await probeMedia(downloadPath);
    expect(probe.hasVideo).toBe(true);
    expect(probe.hasAudio).toBe(true);
    expect(probe.durationSec).toBeGreaterThan(1.8);
    expect(probe.durationSec).toBeLessThan(2.3);

    // 尺寸：与 `cropToAspect` 的判定对齐（1280×720 源片按 16:9 裁切后规整到 32 倍数 → 1280×704，
    // 因为 720 不是 32 的倍数）。用同一个纯函数算期望值，避免把"测试里的手写数字"当成事实。
    const expected = cropToAspect(1280, 720, '16:9');
    expect(probe.width).toBe(expected.width);
    expect(probe.height).toBe(expected.height);
    expect(isAlignedTo32(probe.width as number)).toBe(true);
    expect(isAlignedTo32(probe.height as number)).toBe(true);

    // ── ⑥ 防线 3：合成结束即清中间帧目录（断言"目录不存在"，不看日志）──
    expect(existsSync(path.join(TMP_OUTPUTS_DIR, '.tmp', taskId))).toBe(false);

    // ── ⑦ 画廊可见且带参数快照（一键回填的数据源）──
    const history = await fetch(`${baseUrl}/api/history`);
    expect(history.status).toBe(200);
    const items = ((await history.json()) as { items: TaskProgress[] }).items;
    const found = items.find((item) => item.taskId === taskId);
    expect(found?.requestSnapshot.prompt).toBe(REQUEST.prompt);
    expect(found?.requestSnapshot.provider).toBe('fixture-local');

    // ── ⑧ 删除：接口成功 + 成片文件**真的**消失（磁盘释放，防线 3 的另一半）──
    const removed = await fetch(`${baseUrl}/api/history/${taskId}`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect(existsSync(producedPath)).toBe(false);

    const afterDelete = await fetch(`${baseUrl}${mediaUrl}`);
    expect(afterDelete.status).toBe(404);
  }, 120_000);
});
