import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { VideoGenerateRequest } from '@astrmira/shared';
import { ComfyUiProvider } from './ComfyUiProvider.js';

/**
 * `host-comfyui` provider 的单测（假 ComfyUI）。
 *
 * ## 为什么用假服务而不是真机
 * 真机验收证明的是"**参数对不对**"（V8.34/V8.35 已经做过）；这一层要证明的是
 * "**状态机对不对**" —— 队列中 / 出片 / 无产物 / 记录丢失 / 重复查询不重复下载 / 取消做不到。
 * 这些分支在真机上要么造不出来（要等十几分钟、还得真把服务重启），要么不可复现。
 *
 * 假服务覆盖的就是真机用到的**全部端点**：`/system_stats`、`/object_info`、`/prompt`、
 * `/queue`、`/history/{id}`、`/view`、`/upload/image`。端点形状都从真机响应抄来。
 */

const OBJECT_INFO: unknown = {
  UNETLoader: {
    input: {
      required: {
        unet_name: [['wan2.2_ti2v_5B_fp16.safetensors']],
        weight_dtype: [['default', 'fp8_e4m3fn'], { advanced: true }],
      },
    },
  },
  CLIPLoader: {
    input: { required: { clip_name: [['umt5_xxl_fp8_e4m3fn_scaled.safetensors']], type: [['wan']] } },
  },
  VAELoader: { input: { required: { vae_name: [['wan2.2_vae.safetensors']] } } },
  VAEDecodeTiled: { input: { required: {} } },
  Wan22ImageToVideoLatent: { input: { required: {} } },
};

interface FakeState {
  /** `/queue` 里是否有这条任务 */
  queued: boolean;
  /** `/history/{id}` 的条目（undefined = 查不到） */
  historyEntry?: unknown;
  /** `/prompt` 的响应（默认接受） */
  promptResponse?: { status: number; body: unknown };
  /** `/object_info` 的响应 */
  objectInfo?: unknown;
  /** `/system_stats` 抛错（模拟连不上） */
  offline?: boolean;
  /** 产物字节（`/view` 返回它） */
  videoBytes?: Buffer;
}

function createFakeComfy(state: FakeState) {
  const calls: string[] = [];
  const bodies: { prompt?: unknown; uploadCount: number } = { uploadCount: 0 };

  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(`${init?.method ?? 'GET'} ${url}`);

    if (state.offline === true) throw new Error('fetch failed: ECONNREFUSED');
    if (url.endsWith('/system_stats')) return Response.json({ devices: [] });
    if (url.endsWith('/object_info')) return Response.json(state.objectInfo ?? OBJECT_INFO);
    if (url.endsWith('/prompt')) {
      bodies.prompt = JSON.parse(String(init?.body ?? '{}'));
      const response = state.promptResponse ?? { status: 200, body: { prompt_id: 'p-1' } };
      return Response.json(response.body, { status: response.status });
    }
    if (url.endsWith('/queue')) {
      return Response.json({ queue_running: state.queued ? [[0, 'p-1', {}]] : [], queue_pending: [] });
    }
    if (url.includes('/history/')) {
      return Response.json(state.historyEntry === undefined ? {} : { 'p-1': state.historyEntry });
    }
    if (url.endsWith('/upload/image')) {
      bodies.uploadCount += 1;
      return Response.json({ name: 'frame.png', subfolder: 'astrmira', type: 'input' });
    }
    if (url.includes('/view?')) {
      // `Response` 的 BodyInit 不收 Buffer（Node 的 Buffer 是 Uint8Array 子类但类型上不等价），
      // 复制成普通 Uint8Array —— 这正是"类型检查逼我们写清楚"的地方
      return new Response(new Uint8Array(state.videoBytes ?? Buffer.from('fake-mp4-bytes')), {
        status: 200,
      });
    }
    // 资产下载（i2v 首帧）：真机上这是本服务的 /media/*
    if (url.includes('/media/')) return new Response('fake-png', { status: 200 });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  return { fetch: fakeFetch, calls, bodies };
}

function makeProvider(state: FakeState, extra: Partial<{ resolveAssetUrl: (id: string) => Promise<string | null> }> = {}) {
  const outputDir = mkdtempSync(path.join(tmpdir(), 'comfy-provider-test-'));
  const fake = createFakeComfy(state);
  const provider = new ComfyUiProvider({
    baseUrl: 'http://127.0.0.1:8188',
    outputDir,
    fetchImpl: fake.fetch,
    ...extra,
  });
  return { provider, fake, outputDir };
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function request(overrides: Partial<VideoGenerateRequest> = {}): VideoGenerateRequest {
  return { prompt: '雨夜街角', mode: 't2v', aspectRatio: '16:9', provider: 'host-comfyui', ...overrides };
}

function setup(
  state: FakeState,
  extra: Partial<{ resolveAssetUrl: (id: string) => Promise<string | null> }> = {},
) {
  const made = makeProvider(state, extra);
  dirs.push(made.outputDir);
  return made;
}

describe('ComfyUiProvider · 健康检查', () => {
  it('可达 + 模型齐 + 节点齐 → 可用，且把"能跑什么 / 不能跑什么"一并说清', async () => {
    const { provider } = setup({ queued: false });
    const health = await provider.checkHealth();
    expect(health.available).toBe(true);
    expect(health.reason).toContain('t2v / i2v');
    expect(health.reason).toContain('FLF2V');
  });

  it('连不上 → 不可用，原因里带地址（部署者一眼知道该改哪个 env）', async () => {
    const { provider } = setup({ queued: false, offline: true });
    const health = await provider.checkHealth();
    expect(health.available).toBe(false);
    expect(health.reason).toContain('127.0.0.1:8188');
  });

  it('可达但缺关键节点 → 不可用（不许假装能跑）', async () => {
    const info = { ...(OBJECT_INFO as Record<string, unknown>) };
    delete info['VAEDecodeTiled'];
    const { provider } = setup({ queued: false, objectInfo: info });
    const health = await provider.checkHealth();
    expect(health.available).toBe(false);
    expect(health.reason).toContain('VAEDecodeTiled');
  });
});

describe('ComfyUiProvider · 提交', () => {
  it('t2v：POST /prompt 的 body 是 API 格式，且采样档 / 精度 / 产物前缀都对', async () => {
    const { provider, fake } = setup({ queued: false });
    const { taskId } = await provider.submit(request({ params: { seed: 7 } }));

    expect(taskId).toBe('p-1');
    const body = fake.bodies.prompt as { prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }> };
    expect(body.prompt['8']?.class_type).toBe('VAEDecodeTiled');
    expect(body.prompt['3']?.inputs).toMatchObject({ seed: 7, steps: 20, cfg: 5, sampler_name: 'uni_pc' });
    expect(body.prompt['37']?.inputs['weight_dtype']).toBe('fp8_e4m3fn');
    expect(body.prompt['58']?.inputs['filename_prefix']).toBe('astrmira/comfy');
    // 5 秒 → 121 帧（4n+1，与官方模板一致）
    expect(body.prompt['55']?.inputs['length']).toBe(121);
  });

  it('模式不在能力位（v2v）→ **本地拒绝**，且原因里写着为什么', async () => {
    const { provider, fake } = setup({ queued: false });
    await expect(provider.submit(request({ mode: 'v2v' }))).rejects.toThrow(/不支持 v2v/);
    // 拒绝发生在本地：不该白提交一次
    expect(fake.calls.some((call) => call.includes('/prompt'))).toBe(false);
  });

  it('i2v：先下载首帧再上传给 ComfyUI，LoadImage 用的就是上传返回的名字', async () => {
    const { provider, fake } = setup(
      { queued: false },
      { resolveAssetUrl: async (id) => `http://127.0.0.1:9/media/${id}.png` },
    );
    await provider.submit(
      request({ mode: 'i2v', assets: { firstFrameImage: 'asset-1' } }),
    );

    expect(fake.bodies.uploadCount).toBe(1);
    const body = fake.bodies.prompt as { prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }> };
    expect(body.prompt['56']).toMatchObject({
      class_type: 'LoadImage',
      inputs: { image: 'astrmira/frame.png' },
    });
    expect(body.prompt['55']?.inputs['start_image']).toEqual(['56', 0]);
  });

  it('i2v 缺首帧 → 提交前就报错（提示用户去选素材，而不是等上游 400）', async () => {
    const { provider } = setup({ queued: false });
    await expect(provider.submit(request({ mode: 'i2v' }))).rejects.toThrow(/需要首帧/);
  });

  it('ComfyUI 拒绝提交 → 把**节点级原因**带出来', async () => {
    const { provider } = setup({
      queued: false,
      promptResponse: {
        status: 400,
        body: { node_errors: { '38': { errors: [{ message: 'clip_name 不存在' }] } } },
      },
    });
    await expect(provider.submit(request())).rejects.toThrow(/节点 38.*clip_name 不存在/s);
  });

  it('提交成功但没回 prompt_id → 明确报错（响应形状变了要能被发现）', async () => {
    const { provider } = setup({ queued: false, promptResponse: { status: 200, body: {} } });
    await expect(provider.submit(request())).rejects.toThrow(/没有返回 prompt_id/);
  });
});

describe('ComfyUiProvider · 查状态', () => {
  it('在队列里 → running，且**不编造进度**（progressPercent 0 + 说明）', async () => {
    const { provider } = setup({ queued: true });
    await provider.submit(request());
    const progress = await provider.queryStatus('p-1');
    expect(progress.status).toBe('running');
    expect(progress.progressPercent).toBe(0);
    expect(progress.message).toContain('不上报进度');
  });

  it('出片 → 下载到 OUTPUT_DIR 并返回 /media/<taskId>.mp4（内容是 ComfyUI 给的那份）', async () => {
    const bytes = Buffer.from('real-mp4-bytes');
    const { provider } = setup({
      queued: false,
      videoBytes: bytes,
      historyEntry: {
        status: { status_str: 'success', completed: true, messages: [] },
        outputs: { '58': { images: [{ filename: 'x_00001_.mp4', subfolder: 'astrmira', type: 'output' }] } },
      },
    });
    const { taskId } = await provider.submit(request());
    const progress = await provider.queryStatus(taskId);

    expect(progress.status).toBe('succeeded');
    expect(progress.outputVideoUrl).toBe(`/media/${taskId}.mp4`);
    expect(readFileSync(path.join(dirs.at(-1) as string, `${taskId}.mp4`))).toEqual(bytes);
  });

  it('重复查询 → 直接返回同一个结果，**不重复下载**（调度器会反复查）', async () => {
    const { provider, fake } = setup({
      queued: false,
      historyEntry: {
        status: { status_str: 'success' },
        outputs: { '58': { images: [{ filename: 'x.mp4' }] } },
      },
    });
    await provider.submit(request());
    await provider.queryStatus('p-1');
    await provider.queryStatus('p-1');
    const views = fake.calls.filter((call) => call.includes('/view?')).length;
    expect(views).toBe(1);
  });

  it('执行结束但没有产物 → failed，并把 ComfyUI 的状态原样带出', async () => {
    const { provider } = setup({
      queued: false,
      historyEntry: { status: { status_str: 'error', messages: [['execution_error', { exception_message: 'CUDA out of memory' }]] }, outputs: {} },
    });
    await provider.submit(request());
    const progress = await provider.queryStatus('p-1');
    expect(progress.status).toBe('failed');
    expect(progress.error?.message).toContain('CUDA out of memory');
  });

  it('既不在历史也不在队列 → failed 且直说"可能重启过"（不糊成"未知错误"）', async () => {
    const { provider } = setup({ queued: false });
    await provider.submit(request());
    const progress = await provider.queryStatus('p-1');
    expect(progress.status).toBe('failed');
    expect(progress.error?.message).toContain('重启');
  });

  it('产物取不到（/view 非 200）→ failed 并带 HTTP 码', async () => {
    const { fake } = setup({
      queued: false,
      historyEntry: { status: { status_str: 'success' }, outputs: { '58': { images: [{ filename: 'x.mp4' }] } } },
    });
    const original = fake.fetch;
    // 只让 /view 失败
    const failing = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/view?')) return new Response('gone', { status: 410 });
      return original(input, init);
    }) as typeof fetch;
    const patched = new ComfyUiProvider({
      baseUrl: 'http://127.0.0.1:8188',
      outputDir: dirs.at(-1) as string,
      fetchImpl: failing,
    });
    await patched.submit(request());
    const progress = await patched.queryStatus('p-1');
    expect(progress.status).toBe('failed');
    expect(progress.error?.message).toContain('410');
  });
});

describe('ComfyUiProvider · 取消', () => {
  it('**做不到就返回 false**（实测：interrupt 会让任务重启、queue delete 只清 pending）', async () => {
    const { provider } = setup({ queued: true });
    await provider.submit(request());
    await expect(provider.cancel('p-1')).resolves.toBe(false);
  });
});
