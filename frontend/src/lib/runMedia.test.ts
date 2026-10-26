import { describe, expect, it } from 'vitest';
import type { CreationRun, CreationRunStep, TaskProgress } from '@astrmira/shared';
import { runFinalMedia, stepMedia } from './runMedia';

function step(overrides: Partial<CreationRunStep> = {}): CreationRunStep {
  return {
    id: 'shot-1',
    kind: 'video',
    prompt: '镜头',
    aspectRatio: '16:9',
    referenceAssetIds: [],
    dependsOn: [],
    status: 'succeeded',
    attempt: 0,
    taskId: 't1',
    outputAssetId: 'task:t1',
    ...overrides,
  } as CreationRunStep;
}

function task(overrides: Partial<TaskProgress> = {}): TaskProgress {
  return {
    taskId: 't1',
    status: 'succeeded',
    progressPercent: 100,
    requestSnapshot: { prompt: 'x', mode: 't2v', aspectRatio: '16:9', provider: 'fixture-local' },
    createdAt: 1,
    ...overrides,
  } as TaskProgress;
}

function run(overrides: Partial<CreationRun> = {}): CreationRun {
  return {
    version: 1,
    id: 'r1',
    title: '会话',
    projectId: 'default',
    mode: 'unattended',
    provider: 'fixture-local',
    steps: [step()],
    state: 'succeeded',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as CreationRun;
}

describe('stepMedia · 真实媒体解析（B96）', () => {
  it('未成功的步骤不显示上一版产物（none / failed）', () => {
    expect(stepMedia(step({ status: 'running', taskId: 't9' }), task({ taskId: 't9' }))).toEqual({
      kind: 'none',
    });
    expect(stepMedia(step({ status: 'failed' }), undefined)).toEqual({ kind: 'failed' });
  });

  it('已成功但任务详情未到 → loading（不拿 outputAssetId 猜 URL）', () => {
    expect(stepMedia(step(), undefined)).toEqual({ kind: 'loading' });
    expect(stepMedia(step(), task({ status: 'running' }))).toEqual({ kind: 'loading' });
  });

  it('图片 / 视频产物都取任务接口给出的同源地址', () => {
    expect(stepMedia(step({ kind: 'image' }), task({ outputImageUrl: '/media/t1.png' }))).toEqual({
      kind: 'image',
      url: '/media/t1.png',
    });
    expect(
      stepMedia(step(), task({ outputVideoUrl: '/media/t1.mp4', thumbnailUrl: '/media/thumbs/t1.jpg' })),
    ).toEqual({ kind: 'video', url: '/media/t1.mp4', thumbnailUrl: '/media/thumbs/t1.jpg' });
  });

  it('无产物 / 非 /media 地址 → missing（绝不用占位图冒充成功）', () => {
    expect(stepMedia(step(), task())).toEqual({ kind: 'missing', reason: 'no-output' });
    expect(stepMedia(step(), task({ outputVideoUrl: 'https://evil.example/x.mp4' }))).toEqual({
      kind: 'missing',
      reason: 'unsafe-url',
    });
  });
});

describe('runFinalMedia · 单镜取视频步、多镜取拼接产物（B96）', () => {
  it('单镜：取该视频步的产物', () => {
    const tasks = new Map([['t1', task({ outputVideoUrl: '/media/t1.mp4' })]]);
    expect(runFinalMedia(run(), tasks)).toEqual({
      kind: 'video',
      url: '/media/t1.mp4',
      taskId: 't1',
    });
  });

  it('多镜：取拼接产物（不是某个镜头）', () => {
    const two = run({
      steps: [
        step({ id: 'shot-1', taskId: 't1' }),
        step({ id: 'shot-2', taskId: 't2' }),
      ],
      assembledTaskId: 'e1',
    });
    const tasks = new Map([
      ['t1', task({ taskId: 't1', outputVideoUrl: '/media/t1.mp4' })],
      ['t2', task({ taskId: 't2', outputVideoUrl: '/media/t2.mp4' })],
      ['e1', task({ taskId: 'e1', outputVideoUrl: '/media/e1.mp4' })],
    ]);
    expect(runFinalMedia(two, tasks)).toEqual({
      kind: 'video',
      url: '/media/e1.mp4',
      taskId: 'e1',
    });
  });

  it('多镜但拼接产物还没取到 → pending；会话失败 → failed（不拿镜头冒充成片）', () => {
    const two = run({
      steps: [step({ id: 'shot-1', taskId: 't1' }), step({ id: 'shot-2', taskId: 't2' })],
      assembledTaskId: 'e1',
    });
    expect(runFinalMedia(two, new Map([['t1', task({ taskId: 't1', outputVideoUrl: '/media/t1.mp4' })]]))).toEqual({
      kind: 'pending',
    });
    expect(runFinalMedia({ ...two, state: 'failed' }, new Map())).toEqual({ kind: 'failed' });
  });

  it('成功但没有产物任务 / 产物已清理 → missing', () => {
    expect(runFinalMedia(run({ steps: [step({ taskId: undefined })] }), new Map())).toEqual({
      kind: 'missing',
      reason: 'no-output',
    });
    expect(runFinalMedia(run(), new Map([['t1', task()]]))).toEqual({
      kind: 'missing',
      reason: 'no-output',
    });
  });

  it('未成功的会话不显示成片', () => {
    expect(runFinalMedia(run({ state: 'running' }), new Map())).toEqual({ kind: 'none' });
    expect(runFinalMedia(run({ state: 'assembling' }), new Map())).toEqual({ kind: 'none' });
  });
});
