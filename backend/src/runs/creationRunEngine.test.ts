import { describe, expect, it } from 'vitest';
import type { CreationRun, EditScript, VideoGenerateRequest } from '@astrmira/shared';
import { buildAssemblyScript } from './creationRunEngine.js';
import {
  CreationRunService,
  buildStepRequest,
  deriveTransition,
  readySteps,
  type RunEnginePorts,
  type RunTaskView,
} from './creationRunEngine.js';

function step(id: string, kind: 'image' | 'video', overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind,
    prompt: `${id} 提示词`,
    aspectRatio: '16:9' as const,
    resolutionTier: '720p' as const,
    ...(kind === 'video' ? { durationSec: 5 } : {}),
    referenceAssetIds: [],
    dependsOn: [],
    status: 'pending' as const,
    attempt: 0,
    ...overrides,
  };
}

function run(steps: Array<ReturnType<typeof step>>, overrides: Record<string, unknown> = {}): CreationRun {
  return {
    version: 1,
    id: 'r1',
    title: '雨夜霓虹',
    projectId: 'default',
    mode: 'unattended' as const,
    provider: 'fixture-local',
    steps,
    state: 'planned' as const,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as CreationRun;
}

interface Harness {
  service: CreationRunService;
  saved: CreationRun[];
  submissions: Array<{ request: VideoGenerateRequest; key: string }>;
  editSubmissions: Array<{ script: EditScript; key: string }>;
  tasks: Map<string, RunTaskView>;
  setRun(value: CreationRun): void;
}

function harness(): Harness {
  const saved: CreationRun[] = [];
  const submissions: Array<{ request: VideoGenerateRequest; key: string }> = [];
  const editSubmissions: Array<{ script: EditScript; key: string }> = [];
  const tasks = new Map<string, RunTaskView>();
  let current: CreationRun | null = null;
  const ports: RunEnginePorts = {
    getTask: (taskId) => tasks.get(taskId) ?? null,
    submit: async (request, key) => {
      submissions.push({ request, key });
      const taskId = `t${submissions.length}`;
      tasks.set(taskId, { status: 'running', hasOutput: false });
      return taskId;
    },
    submitEdit: async (script, key) => {
      editSubmissions.push({ script, key });
      const taskId = `e${editSubmissions.length}`;
      tasks.set(taskId, { status: 'running', hasOutput: false });
      return taskId;
    },
  };
  const service = new CreationRunService({
    load: () => current,
    save: (value) => {
      current = value;
      saved.push(value);
    },
    ports,
    now: () => 12345,
  });
  return {
    service,
    saved,
    submissions,
    editSubmissions,
    tasks,
    setRun: (value) => {
      current = value;
    },
  };
}

describe('CreationRunService · 拓扑执行（S8-B2）', () => {
  it('S10-R1：planned 会话被直接 tick 时保持 planned，不提交、不写 startedAt', async () => {
    const h = harness();
    h.setRun(
      run([step('img-1', 'image'), step('shot-1', 'video', { dependsOn: ['img-1'] })]),
    );
    const after = await h.service.tick('r1');
    expect(after?.state).toBe('planned');
    expect(after?.startedAt).toBeUndefined();
    expect(h.submissions).toHaveLength(0);
    expect(h.saved).toHaveLength(0);
  });

  it('已显式启动的 running 会话：先提交图片步，依赖未满足的视频步不提交', async () => {
    const h = harness();
    h.setRun(
      run([step('img-1', 'image'), step('shot-1', 'video', { dependsOn: ['img-1'] })], {
        state: 'running',
        startedAt: 12345,
      }),
    );
    await h.service.tick('r1');
    expect(h.submissions).toHaveLength(1);
    expect(h.submissions[0]?.request.mode).toBe('t2i');
    const after = h.saved.at(-1)!;
    expect(after.state).toBe('running');
    expect(after.steps[0]?.status).toBe('submitting');
    expect(after.steps[0]?.taskId).toBe('t1');
    expect(after.steps[1]?.status).toBe('pending');
    expect(after.startedAt).toBe(12345);
  });

  it('图片成功后：下一 tick 提交视频步（i2v + task: 首帧引用）；再成功 → 会话 succeeded', async () => {
    const h = harness();
    h.setRun(
      run([step('img-1', 'image'), step('shot-1', 'video', { dependsOn: ['img-1'] })], {
        state: 'running',
        startedAt: 1,
      }),
    );
    await h.service.tick('r1');
    h.tasks.set('t1', { status: 'succeeded', hasOutput: true });
    await h.service.tick('r1');

    expect(h.submissions).toHaveLength(2);
    expect(h.submissions[1]?.request.mode).toBe('i2v');
    expect(h.submissions[1]?.request.assets?.firstFrameImage).toBe('task:t1');
    expect(h.submissions[1]?.key).toBe('run:r1:shot-1:a0');

    h.tasks.set('t2', { status: 'succeeded', hasOutput: true });
    await h.service.tick('r1');
    const final = h.saved.at(-1)!;
    expect(final.state).toBe('succeeded');
    expect(final.finishedAt).toBe(12345);
    expect(final.steps.every((s) => s.status === 'succeeded')).toBe(true);
  });

  it('失败即停：任务失败 → 会话 failed + failure 记录，后续步骤零提交', async () => {
    const h = harness();
    h.setRun(
      run([step('img-1', 'image'), step('shot-1', 'video', { dependsOn: ['img-1'] })], {
        state: 'running',
        startedAt: 1,
      }),
    );
    await h.service.tick('r1');
    h.tasks.set('t1', { status: 'failed', hasOutput: false, message: '上游拒绝' });
    await h.service.tick('r1');

    expect(h.submissions).toHaveLength(1); // 视频步从未提交
    const failed = h.saved.at(-1)!;
    expect(failed.state).toBe('failed');
    expect(failed.failure).toEqual({ stepId: 'img-1', message: '上游拒绝' });
  });

  it('提交被拒 = 步骤失败（不重试）；断点续跑用同一幂等键重提', async () => {
    const h = harness();
    const rejected = run([step('img-1', 'image')]);
    rejected.state = 'running';
    rejected.startedAt = 1;
    rejected.steps[0] = { ...rejected.steps[0]!, status: 'submitting' }; // 崩溃残留：无 taskId
    h.setRun(rejected);
    await h.service.tick('r1');
    expect(h.submissions[0]?.key).toBe('run:r1:img-1:a0'); // 同键重提（幂等命中既有任务）

    // 提交被拒路径
    const h2 = harness();
    const rejectedPorts: RunEnginePorts = {
      getTask: () => null,
      submit: async () => {
        throw new Error('PROVIDER_UNAVAILABLE：引擎未启用');
      },
      submitEdit: async () => {
        throw new Error('不应进入拼接');
      },
    };
    const service2 = new CreationRunService({
      load: () => run([step('img-1', 'image', { status: 'pending' })], { state: 'running' }),
      save: (v) => h2.saved.push(v),
      ports: rejectedPorts,
      now: () => 1,
    });
    await service2.tick('r1');
    expect(h2.saved.at(-1)?.state).toBe('failed');
    expect(h2.saved.at(-1)?.failure?.message).toContain('PROVIDER_UNAVAILABLE');
  });

  it('首帧确认档：图片全部成功 → awaiting-confirmation 且不提交视频；确认后放行', async () => {
    const confirmed = run(
      [step('img-1', 'image'), step('shot-1', 'video', { dependsOn: ['img-1'] })],
      { mode: 'first-frame-confirm', state: 'running', startedAt: 1 },
    );
    confirmed.steps[0] = { ...confirmed.steps[0]!, status: 'succeeded', outputAssetId: 'task:t0' };
    expect(readySteps(confirmed)).toEqual([]); // 门未开
    deriveTransition(confirmed, 9);
    expect(confirmed.state).toBe('awaiting-confirmation');

    confirmed.confirmedAt = 10; // confirm 端点的效果（B3 路由落地）
    confirmed.state = 'running';
    const gates = readySteps(confirmed).map((s) => s.id);
    expect(gates).toEqual(['shot-1']);
  });
});

describe('buildStepRequest · 请求构造（纯函数）', () => {
  it('视频步无依赖：用户参考图第一张首帧、第二张尾帧；有依赖：上游产物作首帧', () => {
    const r = run([
      step('img-1', 'image', { status: 'succeeded', outputAssetId: 'task:t9' } as Record<string, unknown>),
      step('shot-1', 'video', { referenceAssetIds: ['asset-a', 'asset-b'] }),
      step('shot-2', 'video', { dependsOn: ['img-1'] }),
    ]);
    const free = buildStepRequest(r, r.steps[1]!);
    expect(free.mode).toBe('i2v');
    expect(free.assets).toEqual({ firstFrameImage: 'asset-a', lastFrameImage: 'asset-b' });

    const dep = buildStepRequest(r, r.steps[2]!);
    expect(dep.mode).toBe('i2v');
    expect(dep.assets?.firstFrameImage).toBe('task:t9');
    expect(dep.params?.durationSec).toBe(5);
    expect(dep.resolution).toEqual({ width: 1280, height: 720 });
  });
});

describe('CreationRunService · 收尾自动合成（S8-C）', () => {
  function twoShotRun(): CreationRun {
    const r = run([
      step('img-1', 'image', { status: 'succeeded', taskId: 't0', outputAssetId: 'task:t0' } as Record<string, unknown>),
      step('shot-1', 'video', { dependsOn: ['img-1'], status: 'succeeded', taskId: 't1', outputAssetId: 'task:t1' } as Record<string, unknown>),
      step('shot-2', 'video', { dependsOn: ['img-1'], status: 'succeeded', taskId: 't2', outputAssetId: 'task:t2' } as Record<string, unknown>),
    ], { state: 'running', startedAt: 1 });
    return r;
  }

  it('≥2 视频步全成功 → assembling；tick 提交 concat（镜头序）+ 确定性幂等键', async () => {
    const h = harness();
    const r = twoShotRun();
    deriveTransition(r, 9);
    expect(r.state).toBe('assembling');

    h.setRun(r);
    await h.service.tick('r1');
    expect(h.editSubmissions).toHaveLength(1);
    expect(h.editSubmissions[0]?.script).toEqual({
      sourceTaskId: 't1',
      operations: [{ type: 'concat', taskIds: ['t1', 't2'] }],
    });
    expect(h.editSubmissions[0]?.key).toBe('run:r1:assembly:a0');
    expect(h.saved.at(-1)?.assembledTaskId).toBe('e1');
    expect(h.saved.at(-1)?.state).toBe('assembling');
  });

  it('拼接成功 → succeeded（assembledTaskId 落盘）；拼接失败 → failed（stepId=assembly）', async () => {
    const ok = harness();
    const okRun = twoShotRun();
    okRun.state = 'assembling';
    okRun.assembledTaskId = 'e9';
    ok.setRun(okRun);
    ok.tasks.set('e9', { status: 'succeeded', hasOutput: true });
    await ok.service.tick('r1');
    const done = ok.saved.at(-1)!;
    expect(done.state).toBe('succeeded');
    expect(done.assembledTaskId).toBe('e9');
    expect(done.finishedAt).toBe(12345);

    const bad = harness();
    const badRun = twoShotRun();
    badRun.state = 'assembling';
    badRun.assembledTaskId = 'e8';
    bad.setRun(badRun);
    bad.tasks.set('e8', { status: 'failed', hasOutput: false, message: 'ffmpeg 拼接失败' });
    await bad.service.tick('r1');
    const failed = bad.saved.at(-1)!;
    expect(failed.state).toBe('failed');
    expect(failed.failure).toEqual({ stepId: 'assembly', message: 'ffmpeg 拼接失败' });
  });

  it('单视频步会话：全成功直落 succeeded，不提交拼接', async () => {
    const h = harness();
    h.setRun(
      run([
        step('img-1', 'image', { status: 'succeeded', taskId: 't0', outputAssetId: 'task:t0' } as Record<string, unknown>),
        step('shot-1', 'video', { dependsOn: ['img-1'], status: 'succeeded', taskId: 't1', outputAssetId: 'task:t1' } as Record<string, unknown>),
      ], { state: 'running', startedAt: 1 }),
    );
    await h.service.tick('r1');
    const done = h.saved.at(-1)!;
    expect(done.state).toBe('succeeded');
    expect(h.editSubmissions).toHaveLength(0);
  });
});

describe('buildAssemblyScript · 转场映射（S9 / V2.66）', () => {
  function videoRun(): CreationRun {
    return run([
      step('shot-1', 'video', { status: 'succeeded', taskId: 't1', outputAssetId: 'task:t1' } as Record<string, unknown>),
      step('shot-2', 'video', { status: 'succeeded', taskId: 't2', outputAssetId: 'task:t2' } as Record<string, unknown>),
      step('shot-3', 'video', { status: 'succeeded', taskId: 't3', outputAssetId: 'task:t3' } as Record<string, unknown>),
    ], { state: 'assembling', startedAt: 1 });
  }

  it('transition 白名单命中 → concat 后追加单一 xfade（0.5s）', () => {
    const script = buildAssemblyScript(videoRun(), ['切', '叠化']);
    expect(script?.operations).toEqual([
      { type: 'concat', taskIds: ['t1', 't2', 't3'] },
      { type: 'xfade', transition: 'fade', durationSec: 0.5 },
    ]);
  });

  it('未映射文案与缺省 = 硬切（纯 concat）；擦除类各自映射', () => {
    expect(buildAssemblyScript(videoRun(), ['匹配剪辑', undefined])?.operations).toHaveLength(1);
    expect(buildAssemblyScript(videoRun(), [])?.operations).toHaveLength(1);
    expect(
      buildAssemblyScript(videoRun(), ['左移', '右移'])?.operations?.[1],
    ).toEqual({ type: 'xfade', transition: 'wipeleft', durationSec: 0.5 });
  });
});

describe('buildStepRequest · 图步定妆参考（S9-A1）', () => {
  it('image 步带依赖 → t2i + assets.firstFrameImage = 上游产物', () => {
    const r = run([
      step('img-1', 'image', { status: 'succeeded', taskId: 't0', outputAssetId: 'task:t0' } as Record<string, unknown>),
      step('img-2', 'image', { dependsOn: ['img-1'] }),
    ]);
    const req = buildStepRequest(r, r.steps[1]!);
    expect(req.mode).toBe('t2i');
    expect(req.assets).toEqual({ firstFrameImage: 'task:t0' });
    const first = buildStepRequest(r, r.steps[0]!);
    expect(first.mode).toBe('t2i');
    expect(first.assets).toBeUndefined();
  });
});
