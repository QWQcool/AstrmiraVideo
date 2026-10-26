import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CreationRun, TaskProgress } from '@astrmira/shared';
import { buildApp } from '../index.js';

/**
 * S8-E · J6：创作会话端到端（真实 TCP + 真实 fixture provider + 真实 ffmpeg 拼接）。
 *
 * 覆盖 §29 的完整链路：创建 → start → 服务端 tick（定时器）→ 两个视频步提交与终态 →
 * 自动拼接（concat 走真实 edit 执行器）→ succeeded + assembledTaskId 可播放。
 *
 * 边界（如实）：
 * - fixture 是**视频**夹具（t2i 语义不真），图步/首帧确认暂停分支由引擎与路由单测覆盖，
 *   真实 t2i 链路待 ComfyUI 验收（PLAN §9）；
 * - 失败即停/提交被拒/断点重提/取消等护栏已由单测钉住（creationRunEngine.test / runs.test），
 *   e2e 不重复注入（fixture 无不依赖 options 的确定性失败注入点）。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TMP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-runs-data-'));
const TMP_OUTPUTS_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-runs-out-'));

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let baseUrl = '';

async function pollRun(id: string, until: (run: CreationRun) => boolean, timeoutMs: number): Promise<CreationRun> {
  const deadline = Date.now() + timeoutMs;
  let last: CreationRun | undefined;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/agent/runs/${id}`);
    expect(response.status).toBe(200);
    last = ((await response.json()) as { run: CreationRun }).run;
    if (until(last)) return last;
    await sleep(500);
  }
  throw new Error(`会话在 ${timeoutMs}ms 内未达期望状态（最后：${last?.state ?? 'unknown'}）`);
}

beforeAll(async () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'make-fixture-clips.mjs')], {
    stdio: 'pipe',
  });
  process.env.DATA_DIR = TMP_DATA_DIR;
  process.env.OUTPUT_DIR = TMP_OUTPUTS_DIR;
  process.env.ENABLE_FIXTURE_PROVIDER = '1';
  app = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('未取到监听端口');
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 180_000);

afterAll(async () => {
  await app.close();
  for (const dir of [TMP_DATA_DIR, TMP_OUTPUTS_DIR]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* Windows 上 WAL 句柄延迟释放无碍 */
    }
  }
}, 60_000);

describe('J6：剧本 → 会话 → 拼接 → 成片（全链路 fixture）', () => {
  it('无人值守双镜头：两个视频步成功后自动 concat，成片可取且为视频', async () => {
    // ① 创建（首尾两个 t2v 镜头，无图步——fixture 无真 t2i，见文件头边界）
    const created = await fetch(`${baseUrl}/api/agent/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'J6 · 无人值守双镜头',
        mode: 'unattended',
        provider: 'fixture-local',
        steps: [
          {
            id: 'shot-1',
            kind: 'video',
            prompt: 'J6 镜头一：雨夜街头的夹具镜头',
            aspectRatio: '16:9',
            durationSec: 2,
          },
          {
            id: 'shot-2',
            kind: 'video',
            prompt: 'J6 镜头二：同一街景的另一夹具镜头',
            aspectRatio: '16:9',
            durationSec: 2,
          },
        ],
      }),
    });
    expect(created.status).toBe(201);
    const runId = ((await created.json()) as { run: CreationRun }).run.id;

    // ② 列表能看到 planned
    const list = await fetch(`${baseUrl}/api/agent/runs`);
    expect(list.status).toBe(200);
    expect(((await list.json()) as { runs: Array<{ id: string }> }).runs.some((r) => r.id === runId)).toBe(true);

    // ③ start → 服务端 tick 定时器接手（5s 一轮；夹具渲染是同步的，1~2 轮内应推进）
    const started = await fetch(`${baseUrl}/api/agent/runs/${runId}/start`, { method: 'POST' });
    expect(started.status).toBe(200);

    const done = await pollRun(runId, (run) => run.state === 'succeeded' || run.state === 'failed', 120_000);
    expect(done.state).toBe('succeeded');
    expect(done.steps.map((step) => step.status)).toEqual(['succeeded', 'succeeded']);
    expect(done.steps.every((step) => step.taskId !== undefined && step.outputAssetId === `task:${step.taskId}`)).toBe(true);

    // ④ 自动拼接产物：普通 edit 任务，成片可读
    expect(done.assembledTaskId).toBeDefined();
    const assembly = await fetch(`${baseUrl}/api/tasks/${done.assembledTaskId}`);
    expect(assembly.status).toBe(200);
    const progress = (await assembly.json()) as TaskProgress;
    expect(progress.status).toBe('succeeded');
    expect(progress.outputVideoUrl).toBeDefined();
    const media = await fetch(`${baseUrl}${progress.outputVideoUrl}`);
    expect(media.status).toBe(200);
    expect((await media.arrayBuffer()).byteLength).toBeGreaterThan(10_000);
  }, 180_000);

  it('B97：非默认业务项目——会话、镜头任务与拼接产物同属该项目', async () => {
    // ① 建一个非默认业务项目（不是画布 id）
    const createdProject = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `B97-${Date.now()}` }),
    });
    expect(createdProject.status).toBe(200);
    const projectId = ((await createdProject.json()) as { project: { projectId: string } }).project
      .projectId;
    expect(projectId).not.toBe('default');

    // ② 两镜会话显式归属该项目
    const created = await fetch(`${baseUrl}/api/agent/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'B97 · 非默认项目双镜头',
        projectId,
        mode: 'unattended',
        provider: 'fixture-local',
        steps: [
          {
            id: 'shot-1',
            kind: 'video',
            prompt: 'B97 镜头一',
            aspectRatio: '16:9',
            durationSec: 2,
          },
          {
            id: 'shot-2',
            kind: 'video',
            prompt: 'B97 镜头二',
            aspectRatio: '16:9',
            durationSec: 2,
          },
        ],
      }),
    });
    expect(created.status).toBe(201);
    const runId = ((await created.json()) as { run: CreationRun }).run.id;

    await fetch(`${baseUrl}/api/agent/runs/${runId}/start`, { method: 'POST' });
    const done = await pollRun(runId, (run) => run.state === 'succeeded' || run.state === 'failed', 120_000);
    expect(done.state).toBe('succeeded');
    expect(done.projectId).toBe(projectId);
    expect(done.assembledTaskId).toBeDefined();

    // ③ 列表按业务项目过滤（默认项目看不到它）
    const listed = await fetch(`${baseUrl}/api/agent/runs?project=${encodeURIComponent(projectId)}`);
    expect(((await listed.json()) as { runs: Array<{ id: string }> }).runs.some((r) => r.id === runId)).toBe(true);
    const defaultList = await fetch(`${baseUrl}/api/agent/runs?project=default`);
    expect(((await defaultList.json()) as { runs: Array<{ id: string }> }).runs.some((r) => r.id === runId)).toBe(false);

    // ④ 每条镜头任务的请求快照都带同一个业务项目
    for (const step of done.steps) {
      expect(step.taskId).toBeDefined();
      const task = await fetch(`${baseUrl}/api/tasks/${step.taskId}`);
      const progress = (await task.json()) as TaskProgress;
      expect(progress.requestSnapshot.projectId).toBe(projectId);
    }

    // ⑤ 拼接任务：任务记录（按项目筛选可见）+ 请求快照都在同一项目
    const assembly = await fetch(`${baseUrl}/api/tasks/${done.assembledTaskId}`);
    expect(assembly.status).toBe(200);
    const assemblyProgress = (await assembly.json()) as TaskProgress;
    expect(assemblyProgress.status).toBe('succeeded');
    expect(assemblyProgress.outputVideoUrl).toBeDefined();
    expect(assemblyProgress.requestSnapshot.projectId).toBe(projectId);

    // 生成任务的默认 history 只列生成产物；剪辑任务要 ?kind=edit（§5 路由口径）
    const projectHistory = await fetch(
      `${baseUrl}/api/history?project=${encodeURIComponent(projectId)}&limit=50`,
    );
    const projectItems = ((await projectHistory.json()) as { items: TaskProgress[] }).items.map(
      (item) => item.taskId,
    );
    for (const step of done.steps) expect(projectItems).toContain(step.taskId);

    const projectEdits = await fetch(
      `${baseUrl}/api/history?kind=edit&project=${encodeURIComponent(projectId)}&limit=50`,
    );
    const projectEditItems = ((await projectEdits.json()) as { items: TaskProgress[] }).items.map(
      (item) => item.taskId,
    );
    expect(projectEditItems).toContain(done.assembledTaskId);

    const defaultHistory = await fetch(`${baseUrl}/api/history?project=default&limit=50`);
    const defaultItems = ((await defaultHistory.json()) as { items: TaskProgress[] }).items.map(
      (item) => item.taskId,
    );
    for (const step of done.steps) expect(defaultItems).not.toContain(step.taskId);

    const defaultEdits = await fetch(`${baseUrl}/api/history?kind=edit&project=default&limit=50`);
    const defaultEditItems = ((await defaultEdits.json()) as { items: TaskProgress[] }).items.map(
      (item) => item.taskId,
    );
    expect(defaultEditItems).not.toContain(done.assembledTaskId);
  }, 180_000);
});
