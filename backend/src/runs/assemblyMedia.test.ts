import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CreationRun, EditScript, VideoGenerateRequest } from '@astrmira/shared';
import type { JobQueue, QueueJob, TaskProgressUpdate } from '../queue/JobQueue.js';
import { openDatabase } from '../store/db.js';
import { TaskStore } from '../store/taskStore.js';
import { createEditJobRunner } from '../pipeline/editExecutor.js';
import { buildAssemblyScript } from './creationRunEngine.js';

/**
 * B107：真实 ffmpeg 验证自动拼接不再重复首镜。
 *
 * 只用可区分的纯色 fixture（红/绿/蓝），不调用模型、不依赖 provider。
 * 断言分三层：
 * 1. EDL：首镜是 sourceTaskId，concat 只追加后续镜头；
 * 2. 媒体：时长按硬切/转场公式核验（帧级容差），不是只看文件非空；
 * 3. 内容：按镜头中段采 RGB，顺序必须红→绿→蓝且每镜只出现一次。
 */
const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH ?? 'ffprobe';
const FRAME_SEC = 1 / 24;
const CLIP_SEC = 2;
const TMP_OUT = mkdtempSync(path.join(tmpdir(), 'astrmira-b107-'));
const COLORS = ['red', 'green', 'blue'] as const;
type Color = (typeof COLORS)[number];

const REQUEST_SNAPSHOT: VideoGenerateRequest = {
  prompt: 'B107 拼接夹具',
  mode: 't2v',
  aspectRatio: '16:9',
  provider: 'fixture-local',
};

function makeColorClip(color: Color): string {
  const target = path.join(TMP_OUT, `b107-${color}.mp4`);
  execFileSync(
    ffmpeg,
    [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=${color}:s=320x240:r=24:d=${CLIP_SEC}`,
      '-f', 'lavfi', '-i', `sine=frequency=440:duration=${CLIP_SEC}`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-shortest',
      target,
    ],
    { stdio: 'pipe' },
  );
  return target;
}

function probeDuration(file: string): number {
  const stdout = execFileSync(
    ffprobe,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { encoding: 'utf8' },
  );
  return Number.parseFloat(stdout.trim());
}

function sampleRgb(file: string, atSec: number): [number, number, number] {
  const bytes = execFileSync(
    ffmpeg,
    [
      '-nostdin', '-hide_banner', '-loglevel', 'error',
      '-ss', String(atSec), '-i', file,
      '-frames:v', '1',
      '-vf', 'scale=1:1',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24',
      'pipe:1',
    ],
    { encoding: 'buffer' },
  );
  return [bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0];
}

function expectDominant(file: string, atSec: number, color: Color): void {
  const [r, g, b] = sampleRgb(file, atSec);
  if (color === 'red') {
    expect(r, `red sample ${r},${g},${b} @${atSec}`).toBeGreaterThan(g + 40);
    expect(r, `red sample ${r},${g},${b} @${atSec}`).toBeGreaterThan(b + 40);
  } else if (color === 'green') {
    expect(g, `green sample ${r},${g},${b} @${atSec}`).toBeGreaterThan(r + 40);
    expect(g, `green sample ${r},${g},${b} @${atSec}`).toBeGreaterThan(b + 40);
  } else {
    expect(b, `blue sample ${r},${g},${b} @${atSec}`).toBeGreaterThan(r + 40);
    expect(b, `blue sample ${r},${g},${b} @${atSec}`).toBeGreaterThan(g + 40);
  }
}

function busyQueue(): { queue: JobQueue; completed: string[]; failed: string[] } {
  const completed: string[] = [];
  const failed: string[] = [];
  const queue = {
    submit: () => Promise.reject(new Error('测试不使用 submit')),
    claim: () => Promise.resolve(null),
    heartbeat: (_taskId: string, _progress: TaskProgressUpdate) => Promise.resolve(),
    complete: (taskId: string) => {
      completed.push(taskId);
      return Promise.resolve();
    },
    fail: (taskId: string, error: { message: string }) => {
      failed.push(`${taskId}:${error.message}`);
      return Promise.resolve();
    },
  } as unknown as JobQueue;
  return { queue, completed, failed };
}

function seedTask(store: TaskStore, taskId: string, color: Color): void {
  store.insert({
    taskId,
    track: 'local',
    provider: 'fixture-local',
    status: 'succeeded',
    progressPercent: 100,
    requestSnapshot: REQUEST_SNAPSHOT,
    outputVideoUrl: `/media/b107-${color}.mp4`,
    warnings: [],
    submitting: false,
  });
}

function runFor(colors: readonly Color[]): CreationRun {
  return {
    version: 1,
    id: 'b107-run',
    title: 'B107 拼接',
    projectId: 'default',
    mode: 'unattended',
    provider: 'fixture-local',
    steps: colors.map((color, index) => ({
      id: `shot-${index + 1}`,
      kind: 'video' as const,
      prompt: `${color} 镜头`,
      aspectRatio: '16:9' as const,
      durationSec: CLIP_SEC,
      referenceAssetIds: [],
      dependsOn: [],
      status: 'succeeded' as const,
      taskId: `source-${color}`,
      outputAssetId: `task:source-${color}`,
      attempt: 0,
    })),
    state: 'assembling',
    assemblyAttempt: 0,
    startedAt: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

async function assemble(
  store: TaskStore,
  colors: readonly Color[],
  transitions: readonly string[] = [],
  suffix = '',
): Promise<{ script: EditScript; output: string; completed: string[]; failed: string[] }> {
  const script = buildAssemblyScript(runFor(colors), transitions);
  if (script === null) throw new Error('预期产生拼接脚本');
  const taskId = `assembly-${colors.length}-${transitions.length}${suffix}`;
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
  const spy = busyQueue();
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
  return {
    script,
    output: path.join(TMP_OUT, `${taskId}.mp4`),
    completed: spy.completed,
    failed: spy.failed,
  };
}

let store: TaskStore;
beforeAll(() => {
  for (const color of COLORS) makeColorClip(color);
  store = new TaskStore(openDatabase(':memory:'));
  for (const color of COLORS) seedTask(store, `source-${color}`, color);
});

afterAll(() => {
  rmSync(TMP_OUT, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe('B107 · 真实 ffmpeg 自动拼接', () => {
  it('2 镜硬切：首镜只出现一次，顺序红→绿，时长=输入和（≤1 帧）', async () => {
    const result = await assemble(store, ['red', 'green']);
    expect(result.script.sourceTaskId).toBe('source-red');
    expect(result.script.operations).toEqual([
      { type: 'concat', taskIds: ['source-green'] },
    ]);
    expect(result.completed).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(existsSync(result.output)).toBe(true);
    const duration = probeDuration(result.output);
    expect(Math.abs(duration - 2 * CLIP_SEC)).toBeLessThanOrEqual(FRAME_SEC);
    expectDominant(result.output, 1.0, 'red');
    expectDominant(result.output, 3.0, 'green');
  });

  it('3 镜硬切：首镜只出现一次，顺序红→绿→蓝，时长=输入和（≤1 帧）', async () => {
    const result = await assemble(store, ['red', 'green', 'blue']);
    expect(result.script.sourceTaskId).toBe('source-red');
    expect(result.script.operations).toEqual([
      { type: 'concat', taskIds: ['source-green', 'source-blue'] },
    ]);
    const duration = probeDuration(result.output);
    expect(Math.abs(duration - 3 * CLIP_SEC)).toBeLessThanOrEqual(FRAME_SEC);
    expectDominant(result.output, 1.0, 'red');
    expectDominant(result.output, 3.0, 'green');
    expectDominant(result.output, 5.0, 'blue');
  });

  it('3 镜转场：N−1=2 个接缝，时长=输入和−2×0.5s，内容仍按红→绿→蓝', async () => {
    const result = await assemble(store, ['red', 'green', 'blue'], ['叠化', '叠化']);
    expect(result.script.operations).toEqual([
      { type: 'concat', taskIds: ['source-green', 'source-blue'] },
      { type: 'xfade', transition: 'fade', durationSec: 0.5 },
    ]);
    const duration = probeDuration(result.output);
    const expected = 3 * CLIP_SEC - 2 * 0.5;
    // 每个 xfade 接缝都可能因帧边界量化误差累积一帧；2 个接缝按 2 帧容差，
    // 硬切仍按 1 帧。不能把“成功/非空”当通过，也不能用无限容差掩盖重复镜头。
    const transitionTolerance = 2 * FRAME_SEC + 0.005;
    expect(Math.abs(duration - expected)).toBeLessThanOrEqual(transitionTolerance);
    // 避开 0.5s 接缝，取每个镜头中段的纯色区域。
    expectDominant(result.output, 0.5, 'red');
    expectDominant(result.output, 2.5, 'green');
    expectDominant(result.output, 4.0, 'blue');
  });

  it('单镜：buildAssemblyScript 返回 null，不创建拼接任务', () => {
    expect(buildAssemblyScript(runFor(['red']))).toBeNull();
  });

  it('B99：同一 EDL 在显式重试后重新拼接仍满足顺序与时长（含转场），且**源片不被删**', async () => {
    // 同一个脚本、两次独立执行（模拟 a0 失败 / a1 重试）：内容与时长必须一样成立。
    // 用转场分支是因为它会走 concatWithTransition —— 该路径曾无条件 rm(current)，
    // 第一次拼接就会把源任务的成片删掉（重试必然失败）。这条断言钉住"只删中间产物"。
    const first = await assemble(store, ['red', 'green', 'blue'], ['叠化', '叠化'], '-a0');
    const retry = await assemble(store, ['red', 'green', 'blue'], ['叠化', '叠化'], '-a1');
    expect(retry.script).toEqual(first.script);
    for (const result of [first, retry]) {
      expect(result.failed).toEqual([]);
      expect(existsSync(result.output)).toBe(true);
      const duration = probeDuration(result.output);
      const expected = 3 * CLIP_SEC - 2 * 0.5;
      expect(Math.abs(duration - expected)).toBeLessThanOrEqual(2 * FRAME_SEC + 0.005);
      expectDominant(result.output, 0.5, 'red');
      expectDominant(result.output, 2.5, 'green');
      expectDominant(result.output, 4.0, 'blue');
    }
    // 源片必须还在（用户还要能播、还能再次拼接）
    for (const color of COLORS) {
      expect(existsSync(path.join(TMP_OUT, `b107-${color}.mp4`))).toBe(true);
    }
    // 源任务的 URL 仍可用 → 第三次拼接仍能成功（真正证明"复用已有镜头"）
    const third = await assemble(store, ['red', 'green', 'blue'], ['叠化', '叠化'], '-a2');
    expect(third.failed).toEqual([]);
  });
});
