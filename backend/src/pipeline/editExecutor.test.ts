import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EditScript, VideoGenerateRequest } from '@astrmira/shared';
import { runMediaTool } from '../lib/ffmpeg.js';
import type { JobQueue, QueueJob, TaskProgressUpdate } from '../queue/JobQueue.js';
import { openDatabase } from '../store/db.js';
import { TaskStore } from '../store/taskStore.js';
import { createEditJobRunner } from './editExecutor.js';

/**
 * 轻剪辑台的**执行层**集成测试（V9 · B9 / Step 6-AC6）。
 *
 * 真做三件事：**真 ffmpeg 执行** + **真 SQLite 落库** + **桩队列观察终态**。
 * 这样 AC6 的"产物经 ffprobe 校验可播且时长符合预期"是真的量出来的，
 * 而不是"看我们自己的返回值"。
 *
 * 两条硬口径：
 * - **零上游调用**：本文件不 import 任何 provider，也不 stub 云端 ——
 *   这正是"结构上不可能调上游"的体现（路由层的计数断言在 edits.test.ts）；
 * - **失败要如实**：抽帧超片长必须报错且**不产空文件**（破坏性验证之一）。
 */

const TMP_OUT = mkdtempSync(path.join(tmpdir(), 'astrmira-edit-out-'));

const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';

/** 造一段 5s 的测试视频（带音轨，这样 xfade/acrossfade 才有东西可合） */
function makeClip(name: string, seconds = 5): string {
  const target = path.join(TMP_OUT, `${name}.mp4`);
  execFileSync(
    ffmpeg,
    [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc=size=320x240:rate=24:duration=${seconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-shortest',
      target,
    ],
    { stdio: 'pipe' },
  );
  return target;
}

async function probe(file: string): Promise<{ durationSec: number; hasVideo: boolean; hasAudio: boolean }> {
  const { stdout } = await runMediaTool('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type',
    '-of', 'json',
    file,
  ]);
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string }>;
  };
  return {
    durationSec: Number.parseFloat(parsed.format?.duration ?? 'NaN'),
    hasVideo: (parsed.streams ?? []).some((stream) => stream.codec_type === 'video'),
    hasAudio: (parsed.streams ?? []).some((stream) => stream.codec_type === 'audio'),
  };
}

/** 只实现被 runner 用到的那几个方法：其余一律抛（用到就说明设计变了，测试应当注意到） */
function createSpyQueue(): {
  queue: JobQueue;
  heartbeats: TaskProgressUpdate[];
  completed: Array<{ taskId: string; videoUrl: string; message?: string }>;
  failed: Array<{ taskId: string; code: string; message: string }>;
} {
  const heartbeats: TaskProgressUpdate[] = [];
  const completed: Array<{ taskId: string; videoUrl: string; message?: string }> = [];
  const failed: Array<{ taskId: string; code: string; message: string }> = [];

  const queue = {
    submit: () => Promise.reject(new Error('测试不使用 submit')),
    claim: () => Promise.resolve(null),
    heartbeat: (_taskId: string, progress: TaskProgressUpdate) => {
      heartbeats.push(progress);
      return Promise.resolve();
    },
    complete: (taskId: string, output: { videoUrl: string; message?: string }) => {
      completed.push({ taskId, videoUrl: output.videoUrl, ...(output.message === undefined ? {} : { message: output.message }) });
      return Promise.resolve();
    },
    fail: (taskId: string, error: { code: string; message: string }) => {
      failed.push({ taskId, code: error.code, message: error.message });
      return Promise.resolve();
    },
  } as unknown as JobQueue;

  return { queue, heartbeats, completed, failed };
}

const REQUEST_SNAPSHOT: VideoGenerateRequest = {
  prompt: '剪辑测试源片',
  mode: 't2v',
  aspectRatio: '16:9',
  provider: 'fixture-local',
};

function seedTask(store: TaskStore, taskId: string, videoFileName: string): void {
  store.insert({
    taskId,
    track: 'cloud',
    provider: 'fixture-local',
    status: 'succeeded',
    progressPercent: 100,
    requestSnapshot: REQUEST_SNAPSHOT,
    outputVideoUrl: `/media/${videoFileName}`,
    warnings: [],
    submitting: false,
  });
}

describe('轻剪辑台执行器（AC6：trim → concat → xfade）', () => {
  let store: TaskStore;

  beforeAll(() => {
    // ⚠️ 文件名**刻意与 taskId 不同**：provider 落盘用的是它自己的上游 id
    // （夹具与云端各有一套命名），executor 必须走记录里的 `outputVideoUrl` 去找文件。
    // 首轮实现就是拼 `<taskId>.mp4`——这个"不像真实情况"的替身会让测试放过那个 bug。
    makeClip('upstream-a');
    makeClip('upstream-b');
    // 内存库：本用例只关心"落库事实"，不需要跨进程持久化
    store = new TaskStore(openDatabase(':memory:'));
    seedTask(store, 'source-a', 'upstream-a.mp4');
    seedTask(store, 'source-b', 'upstream-b.mp4');
  });

  afterAll(() => {
    try {
      rmSync(TMP_OUT, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* 临时目录残留无碍 */
    }
  });

  it('trims 3s → concat 另一段 5s → 0.5s 转场：产物可播、时长 ≈ 7.5s（±0.2s）', async () => {
    const taskId = 'edit-case-1';
    const script: EditScript = {
      sourceTaskId: 'source-a',
      operations: [
        { type: 'trim', startSec: 0, endSec: 3 },
        { type: 'concat', taskIds: ['source-b'] },
        { type: 'xfade', transition: 'fade', durationSec: 0.5 },
      ],
    };

    store.insert({
      taskId,
      track: 'local',
      provider: 'fixture-local',
      status: 'queued',
      progressPercent: 0,
      requestSnapshot: REQUEST_SNAPSHOT,
      warnings: [],
      submitting: false,
      editScript: script,
    });

    const spy = createSpyQueue();
    const job: QueueJob = {
      taskId,
      track: 'local',
      request: REQUEST_SNAPSHOT,
      idempotencyKey: `edit:${taskId}`,
      submitting: false,
      kind: 'edit',
      editScript: script,
    };

    await createEditJobRunner({ store, queue: spy.queue, outputsDir: TMP_OUT })(job);

    expect(spy.failed).toHaveLength(0);
    expect(spy.completed).toHaveLength(1);
    expect(spy.completed[0]?.videoUrl).toBe(`/media/${taskId}.mp4`);

    const output = path.join(TMP_OUT, `${taskId}.mp4`);
    expect(existsSync(output)).toBe(true);

    const info = await probe(output);
    expect(info.hasVideo).toBe(true);
    expect(info.hasAudio).toBe(true);
    // 3 + 5 − 0.5 = 7.5s（转场期间两段重叠，所以不是简单相加）
    expect(Math.abs(info.durationSec - 7.5)).toBeLessThanOrEqual(0.2);

    // 注：**不**在这里断言 `store.get(taskId).status === 'succeeded'` ——
    // 置终态是**队列**的职责（真实的 `SqliteJobQueue.complete` 会写库），
    // 而本用例的队列是桩（只记录调用）。断言越权会让测试与真实职责错位。
    // 心跳记录了推进过程（供刷新重挂载）
    expect(spy.heartbeats.length).toBeGreaterThan(1);
  });

  it('抽帧落为参考资产并写回任务（D38 闭环）；时间点超片长时如实报错且不产空文件', async () => {
    const taskId = 'edit-case-2';
    const script: EditScript = {
      sourceTaskId: 'source-a',
      operations: [{ type: 'extractFrame', atSec: 1 }],
    };

    store.insert({
      taskId,
      track: 'local',
      provider: 'fixture-local',
      status: 'queued',
      progressPercent: 0,
      requestSnapshot: REQUEST_SNAPSHOT,
      warnings: [],
      submitting: false,
      editScript: script,
    });

    const spy = createSpyQueue();
    await createEditJobRunner({ store, queue: spy.queue, outputsDir: TMP_OUT })({
      taskId,
      track: 'local',
      request: REQUEST_SNAPSHOT,
      idempotencyKey: `edit:${taskId}`,
      submitting: false,
      kind: 'edit',
      editScript: script,
    });

    expect(spy.failed).toHaveLength(0);
    const assetIds = store.get(taskId)?.extractedAssetIds ?? [];
    expect(assetIds).toHaveLength(1);
    const assetPath = path.join(TMP_OUT, 'assets', `${assetIds[0]}.jpg`);
    expect(existsSync(assetPath)).toBe(true);
    expect(statSync(assetPath).size).toBeGreaterThan(0);

    // ── 破坏性验证：时间点超片长 ──
    const badTaskId = 'edit-case-bad';
    const badScript: EditScript = {
      sourceTaskId: 'source-a',
      operations: [{ type: 'extractFrame', atSec: 999 }],
    };
    store.insert({
      taskId: badTaskId,
      track: 'local',
      provider: 'fixture-local',
      status: 'queued',
      progressPercent: 0,
      requestSnapshot: REQUEST_SNAPSHOT,
      warnings: [],
      submitting: false,
      editScript: badScript,
    });

    const badSpy = createSpyQueue();
    await createEditJobRunner({ store, queue: badSpy.queue, outputsDir: TMP_OUT })({
      taskId: badTaskId,
      track: 'local',
      request: REQUEST_SNAPSHOT,
      idempotencyKey: `edit:${badTaskId}`,
      submitting: false,
      kind: 'edit',
      editScript: badScript,
    });

    expect(badSpy.completed).toHaveLength(0);
    expect(badSpy.failed).toHaveLength(1);
    expect(badSpy.failed[0]?.code).toBe('UPSTREAM_ERROR');
    expect(badSpy.failed[0]?.message).toContain('超出片长');

    // 不产空文件：assets 目录里不应多出一个 0 字节的 jpg
    const assets = existsSync(path.join(TMP_OUT, 'assets'))
      ? readdirSync(path.join(TMP_OUT, 'assets')).filter((name) => name.endsWith('.jpg'))
      : [];
    for (const name of assets) {
      expect(statSync(path.join(TMP_OUT, 'assets', name)).size).toBeGreaterThan(0);
    }
  });

  it('源成片不存在 → TASK_NOT_FOUND（terminal），而不是让 ffmpeg 报错', async () => {
    const taskId = 'edit-case-3';
    const script: EditScript = {
      sourceTaskId: 'no-such-task',
      operations: [{ type: 'trim', startSec: 0, endSec: 1 }],
    };

    store.insert({
      taskId,
      track: 'local',
      provider: 'fixture-local',
      status: 'queued',
      progressPercent: 0,
      requestSnapshot: REQUEST_SNAPSHOT,
      warnings: [],
      submitting: false,
      editScript: script,
    });

    const spy = createSpyQueue();
    await createEditJobRunner({ store, queue: spy.queue, outputsDir: TMP_OUT })({
      taskId,
      track: 'local',
      request: REQUEST_SNAPSHOT,
      idempotencyKey: `edit:${taskId}`,
      submitting: false,
      kind: 'edit',
      editScript: script,
    });

    expect(spy.failed[0]?.code).toBe('TASK_NOT_FOUND');
  });
});
