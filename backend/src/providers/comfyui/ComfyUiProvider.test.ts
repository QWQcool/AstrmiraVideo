import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VideoGenerateRequest } from '@astrmira/shared';
import { ProviderFailureError } from '../../errors.js';
import { ComfyUiProvider, readOutpaintPad, readUpscaleScaleBy } from './ComfyUiProvider.js';
import type { ComfyProgressSource } from './comfyuiProgress.js';
import {
  FLUX2_KLEIN_T2I_DECLARATION,
  FLUX2_KLEIN_T2I_REF_DECLARATION,
  FLUX2_KLEIN_T2I_REF_TEMPLATE,
  FLUX2_KLEIN_T2I_TEMPLATE,
  templateNodeTypes,
  WAN22_TI2V_5B_TEMPLATE,
  type ComfyTemplateDeclaration,
  type WorkflowTemplate,
} from './comfyuiProtocol.js';

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

/**
 * 假的 `/object_info`：三个加载节点的**枚举值**（决定 `pickComfyModels` 挑到什么）
 * + **模板引用的其余节点**（V2.33 起能力位按模板判定，fixture 必须像真机一样"该有的都有"——
 * 真机上 `KSampler` / `SaveVideo` 这些核心节点必然在 958 个节点里）。
 *
 * 这里**动态补全**而不是手抄一遍：以后改模板（多一个节点）不会让这些测试莫名其妙地红。
 */
const OBJECT_INFO: unknown = (() => {
  const info: Record<string, unknown> = {
    UNETLoader: {
      input: {
        required: {
          unet_name: [['wan2.2_ti2v_5B_fp16.safetensors']],
          weight_dtype: [['default', 'fp8_e4m3fn'], { advanced: true }],
        },
      },
    },
    CLIPLoader: {
      input: {
        required: { clip_name: [['umt5_xxl_fp8_e4m3fn_scaled.safetensors']], type: [['wan']] },
      },
    },
    VAELoader: { input: { required: { vae_name: [['wan2.2_vae.safetensors']] } } },
  };
  for (const type of templateNodeTypes(WAN22_TI2V_5B_TEMPLATE)) {
    if (info[type] === undefined) info[type] = { input: { required: {} } };
  }
  return info;
})();

/** 装了 FLUX 图片模型的那台机器的 `/object_info`（V2.40：`t2i` 路径要用它） */
const FLUX_OBJECT_INFO: unknown = (() => {
  const info: Record<string, unknown> = {
    UNETLoader: {
      input: {
        required: {
          unet_name: [['flux-2-klein-4b.safetensors']],
          weight_dtype: [['default', 'fp8_e4m3fn'], { advanced: true }],
        },
      },
    },
    CLIPLoader: { input: { required: { clip_name: [['qwen_3_4b.safetensors']], type: [['flux2']] } } },
    VAELoader: { input: { required: { vae_name: [['flux2-vae.safetensors']] } } },
  };
  for (const type of templateNodeTypes(FLUX2_KLEIN_T2I_TEMPLATE)) {
    if (info[type] === undefined) info[type] = { input: { required: {} } };
  }
  // B93：参考图变体还引用 LoadImage / VAEEncode / ReferenceLatent；假 /object_info 也要有这些节点。
  for (const type of templateNodeTypes(FLUX2_KLEIN_T2I_REF_TEMPLATE)) {
    if (info[type] === undefined) info[type] = { input: { required: {} } };
  }
  return info;
})();

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

/** 可注入的额外选项（V2.39 起含模板与声明 —— 让"声明生效"这条链也能在单测里覆盖） */
type ExtraOptions = Partial<{
  resolveAssetUrl: (id: string) => Promise<string | null>;
  template: WorkflowTemplate;
  declaration: ComfyTemplateDeclaration;
  /** V2.82：注入假进度（真实现走 WS，测试不建连接） */
  progress: ComfyProgressSource;
}>;

function makeProvider(state: FakeState, extra: ExtraOptions = {}) {
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

function setup(state: FakeState, extra: ExtraOptions = {}) {
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
    // V2.39：**判定的来源也要说清**（内置模板自带声明 —— "这个判断是从哪来的"要能回答）
    expect(health.reason).toContain('模板声明');
  });

  it('V2.39：注入声明 → 能力位与模型挑选都按声明走（H3 那种"文件名不含 ti2v"的模型也判得对）', async () => {
    // 覆盖 /object_info 的 unet 候选：换成一个**不含 ti2v** 的 H3 风格文件名
    const info = JSON.parse(JSON.stringify(OBJECT_INFO)) as Record<
      string,
      { input?: { required?: Record<string, unknown> } }
    >;
    const required = info['UNETLoader']?.input?.required;
    if (required !== undefined) {
      required['unet_name'] = [['minimax_h3_fl2va_pruned_int8_convrot.safetensors']];
    }

    const { provider } = setup(
      { queued: false, objectInfo: info },
      { declaration: { modes: ['t2v', 'i2v'], modelMatch: { unet: 'minimax_h3' } } },
    );
    const health = await provider.checkHealth();

    expect(health.available).toBe(true);
    expect(health.reason).toContain('t2v / i2v'); // 声明生效（启发式只会给 t2v）
    expect(health.reason).toContain('minimax_h3'); // 声明关键词挑中了那个模型文件
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

  /**
   * B111 真机发现：这些**提交前**的拒绝原本是裸 `Error`，被兜底逻辑判成
   * "已进入提交阶段" → `UNCERTAIN_RESULT`（界面显示"可能已扣费"），而实际一个字节都没发出去。
   * 现在按语义归类：请求本身不合法 → `INVALID_REQUEST`；这台机器没这个能力 → `PROVIDER_UNAVAILABLE`。
   */
  it('参考图超过实例上限 → INVALID_REQUEST（terminal），且不白提交一次', async () => {
    const { provider, fake } = setup({ queued: false });
    const references = Array.from({ length: 5 }, (_, index) => ({
      assetId: `asset-${index}`,
      role: 'reference-image' as const,
      order: index,
    }));
    const error = await provider
      .submit(request({ mode: 't2i', assets: { references } }))
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderFailureError);
    expect((error as ProviderFailureError).code).toBe('INVALID_REQUEST');
    expect(String((error as Error).message)).toMatch(/最多消费 4 张参考图/);
    expect(fake.calls.some((call) => call.includes('/prompt'))).toBe(false);
  });

  it('模式在这台机器上没有模板 → PROVIDER_UNAVAILABLE（terminal），不是"结果未知"', async () => {
    const { provider } = setup({ queued: false });
    const error = await provider
      .submit(request({ mode: 'v2v' }))
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderFailureError);
    expect((error as ProviderFailureError).code).toBe('PROVIDER_UNAVAILABLE');
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

  it('档位（V2.32）：注入的 steps / fps / 像素预算真的进了提交体', async () => {
    // "换卡只改 env"这条承诺的端到端证据：注入档位 → 提交体跟着变
    const outputDir = mkdtempSync(path.join(tmpdir(), 'comfy-tuning-'));
    dirs.push(outputDir);
    const fake = createFakeComfy({ queued: false });
    const provider = new ComfyUiProvider({
      baseUrl: 'http://127.0.0.1:8188',
      outputDir,
      fetchImpl: fake.fetch,
      // 模拟"24GB 卡 + 少步数快出"的一套档位
      tuning: { steps: 8, cfg: 4, shift: 3, fps: 16, maxPixels: 1280 * 704, dtype: 'default' },
    });

    await provider.submit(
      request({ resolution: { width: 1280, height: 704 }, params: { durationSec: 5 } }),
    );

    const body = fake.bodies.prompt as {
      prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    };
    expect(body.prompt['3']?.inputs).toMatchObject({ steps: 8, cfg: 4 });
    expect(body.prompt['48']?.inputs['shift']).toBe(3);
    expect(body.prompt['37']?.inputs['weight_dtype']).toBe('default');
    // 720p 档不再被缩小（像素预算放开了）；fps 16 → 5 秒 80 帧 → 对齐 4n+1 = 81
    expect(body.prompt['55']?.inputs).toMatchObject({ width: 1280, height: 704, length: 81 });
    expect(body.prompt['57']?.inputs['fps']).toBe(16);
  });
});

describe('ComfyUiProvider · 查状态', () => {
  it('在队列里但拿不到进度 → running + 0 + 说明（**不编造**）', async () => {
    const { provider } = setup({ queued: true });
    await provider.submit(request());
    const progress = await provider.queryStatus('p-1');
    expect(progress.status).toBe('running');
    expect(progress.progressPercent).toBe(0);
    expect(progress.message).toContain('拿不到进度百分比');
  });

  it('V2.82：注入 WS 进度源后 running 带**真实**百分比', async () => {
    const { provider } = setup(
      { queued: true },
      { progress: { progress: () => ({ percent: 60 }) } },
    );
    await provider.submit(request());
    const progress = await provider.queryStatus('p-1');
    expect(progress.status).toBe('running');
    expect(progress.progressPercent).toBe(60);
    expect(progress.message).toContain('60%');
  });

  it('V2.82：进度源对别的 prompt 返回 null → 仍然 0（不串台）', async () => {
    const { provider } = setup(
      { queued: true },
      { progress: { progress: (promptId) => (promptId === 'p-1' ? { percent: 30 } : null) } },
    );
    await provider.submit(request());
    expect((await provider.queryStatus('p-1')).progressPercent).toBe(30);
    expect((await provider.queryStatus('p-2')).progressPercent).toBe(0);
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

  it('多产物（V2.39）：**挑视频**而不是"取第一个"（音频节点的 id 更小也抢不走）', async () => {
    const { provider } = setup({
      queued: false,
      videoBytes: Buffer.from('real-mp4-bytes'),
      historyEntry: {
        status: { status_str: 'success' },
        outputs: {
          // 音频节点 id 更小 → `Object.values()` 会先遇到它；老实现（outputs[0]）会取到音频
          '20': { audio: [{ filename: 'clip_00001_.wav', subfolder: 'astrmira', type: 'output' }] },
          '58': { images: [{ filename: 'clip_00001_.mp4', subfolder: 'astrmira', type: 'output' }] },
        },
      },
    });
    const { taskId } = await provider.submit(request());
    const progress = await provider.queryStatus(taskId);
    expect(progress.status).toBe('succeeded');
    expect(progress.outputVideoUrl).toBe(`/media/${taskId}.mp4`);
  });

  it('只有音频产物 → **如实失败**（把音频字节写成 .mp4 是静默出错）', async () => {
    const { provider } = setup({
      queued: false,
      historyEntry: {
        status: { status_str: 'success' },
        outputs: {
          '20': { audio: [{ filename: 'clip_00001_.wav', subfolder: 'astrmira', type: 'output' }] },
        },
      },
    });
    const { taskId } = await provider.submit(request());
    const progress = await provider.queryStatus(taskId);
    expect(progress.status).toBe('failed');
    // 失败原因在 `error.message`（`fail()` 的既有形状：terminal 的错误码 + 人话）
    expect(progress.error?.message).toContain('没有视频');
  });

  it('兼容层**提前写 history**（`completed=false`）→ 继续 running，不判假失败（V2.40 接 comfyui_lb 实测抓到）', async () => {
    const { provider } = setup({
      queued: false,
      historyEntry: { status: { status_str: 'queued', completed: false, messages: [] }, outputs: {} },
    });
    await provider.submit(request());
    const progress = await provider.queryStatus('p-1');
    expect(progress.status).toBe('running');
    expect(progress.error).toBeUndefined();
  });

  it('收尾竞态（2026-10-19 实测）：已出队但 history 还没写入 → 先报 running，不判失败', async () => {
    const { provider } = setup({ queued: false });
    const { taskId } = await provider.submit(request());
    const progress = await provider.queryStatus(taskId);
    expect(progress.status).toBe('running');
    expect(progress.message).toContain('收尾');
    expect(progress.error).toBeUndefined();
  });

  it('超出宽限期仍不在历史也不在队列 → 如实失败（记录真的丢了）', async () => {
    vi.useFakeTimers();
    try {
      const { provider } = setup({ queued: false });
      const { taskId } = await provider.submit(request());
      vi.setSystemTime(Date.now() + 31_000);
      const progress = await provider.queryStatus(taskId);
      expect(progress.status).toBe('failed');
      expect(progress.error?.message).toContain('找不到');
    } finally {
      vi.useRealTimers();
    }
  });

  it('B93/F2 回归：带参考图的 t2i 在只有普通模板时明确拒绝，不回退文生图', async () => {
    const { provider, fake } = setup(
      { queued: false, objectInfo: FLUX_OBJECT_INFO },
      {
        template: FLUX2_KLEIN_T2I_TEMPLATE,
        declaration: FLUX2_KLEIN_T2I_DECLARATION,
        resolveAssetUrl: async (id) => `http://127.0.0.1:9/media/${id}.png`,
      },
    );
    await expect(
      provider.submit(
        request({ mode: 't2i', assets: { firstFrameImage: 'asset-ref' } }),
      ),
    ).rejects.toThrow(/参考图|referenceImage|ReferenceLatent/);
    expect(fake.calls.some((call) => call.includes('/prompt'))).toBe(false);
    expect(fake.bodies.uploadCount).toBe(0);
  });

  it('B93 支持路径：referenceImage 模板仍上传参考图并带 ReferenceLatent', async () => {
    const { provider, fake } = setup(
      { queued: false, objectInfo: FLUX_OBJECT_INFO },
      {
        template: FLUX2_KLEIN_T2I_REF_TEMPLATE,
        declaration: FLUX2_KLEIN_T2I_REF_DECLARATION,
        resolveAssetUrl: async (id) => `http://127.0.0.1:9/media/${id}.png`,
      },
    );
    await provider.submit(
      request({ mode: 't2i', assets: { firstFrameImage: 'asset-ref' } }),
    );
    expect(fake.bodies.uploadCount).toBe(1);
    const body = fake.bodies.prompt as {
      prompt: Record<string, { class_type: string }>;
    };
    expect(
      Object.values(body.prompt).some((node) => node.class_type === 'ReferenceLatent'),
    ).toBe(true);
  });

  it('t2i 幂等：重复查询返回同一产物，且写的是 **outputImageUrl**（不是 outputVideoUrl）', async () => {
    const bytes = Buffer.from('real-png-bytes');
    const { provider } = setup(
      {
        queued: false,
        objectInfo: FLUX_OBJECT_INFO,
        videoBytes: bytes,
        historyEntry: {
          status: { status_str: 'success', completed: true },
          outputs: {
            '9': {
              images: [{ filename: 'flux-klein_00001_.png', subfolder: 'astrmira', type: 'output' }],
            },
          },
        },
      },
      { template: FLUX2_KLEIN_T2I_TEMPLATE, declaration: FLUX2_KLEIN_T2I_DECLARATION },
    );

    const { taskId } = await provider.submit(request({ mode: 't2i' }));
    const first = await provider.queryStatus(taskId);
    expect(first.outputImageUrl).toBe(`/media/${taskId}.png`);

    const second = await provider.queryStatus(taskId); // 幂等分支
    expect(second.status).toBe('succeeded');
    expect(second.outputImageUrl).toBe(`/media/${taskId}.png`);
    expect(second.outputVideoUrl).toBeUndefined();
    expect(second.message).toContain('已出图');
  });

  it('t2i（V2.40）：出图 → 落 `<taskId>.png` 并返回 **outputImageUrl**（不是 outputVideoUrl）', async () => {
    const bytes = Buffer.from('real-png-bytes');
    const { provider } = setup(
      {
        queued: false,
        objectInfo: FLUX_OBJECT_INFO,
        videoBytes: bytes,
        historyEntry: {
          status: { status_str: 'success' },
          outputs: {
            '9': {
              images: [{ filename: 'flux-klein_00001_.png', subfolder: 'astrmira', type: 'output' }],
            },
          },
        },
      },
      { template: FLUX2_KLEIN_T2I_TEMPLATE, declaration: FLUX2_KLEIN_T2I_DECLARATION },
    );

    const { taskId } = await provider.submit(request({ mode: 't2i' }));
    const progress = await provider.queryStatus(taskId);

    expect(progress.status).toBe('succeeded');
    expect(progress.outputImageUrl).toBe(`/media/${taskId}.png`);
    expect(progress.outputVideoUrl).toBeUndefined();
    expect(progress.message).toContain('已出图');
    expect(readFileSync(path.join(dirs.at(-1) as string, `${taskId}.png`))).toEqual(bytes);
  });

  it('t2i 但产物里是 mp4 → **如实失败**（不把视频当图片塞进 outputImageUrl）', async () => {
    const { provider } = setup(
      {
        queued: false,
        objectInfo: FLUX_OBJECT_INFO,
        historyEntry: {
          status: { status_str: 'success' },
          outputs: { '9': { images: [{ filename: 'oops.mp4', subfolder: 'astrmira', type: 'output' }] } },
        },
      },
      { template: FLUX2_KLEIN_T2I_TEMPLATE, declaration: FLUX2_KLEIN_T2I_DECLARATION },
    );

    const { taskId } = await provider.submit(request({ mode: 't2i' }));
    const progress = await provider.queryStatus(taskId);
    expect(progress.status).toBe('failed');
    expect(progress.error?.message).toContain('没有图片');
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

  it('既不在历史也不在队列：宽限期内先报 running，超期后 failed 且直说"可能重启过"', async () => {
    // 2026-10-19 实测：ComfyUI 先出队、后写 history，中间有个收尾窗口 ——
    // 旧的"立刻判失败"会把刚跑完的任务判死（产物其实已落盘）。
    // `shouldAdvanceTime` 让宽限期里那个 800ms 的补查等待能真实到期（否则测试会挂住）
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { provider } = setup({ queued: false });
      await provider.submit(request());

      const fresh = await provider.queryStatus('p-1');
      expect(fresh.status).toBe('running');
      expect(fresh.message).toContain('收尾');

      vi.setSystemTime(Date.now() + 31_000);
      const stale = await provider.queryStatus('p-1');
      expect(stale.status).toBe('failed');
      expect(stale.error?.message).toContain('重启');
    } finally {
      vi.useRealTimers();
    }
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

/** V2.79：`options.expand` → 四边外扩像素（8 的整数倍、至少一边 > 0、画布不超 4096） */
describe('ComfyUiProvider · 扩图外扩像素', () => {
  const withExpand = (expand: unknown, resolution = { width: 1024, height: 576 }): VideoGenerateRequest => ({
    ...request(),
    mode: 'outpaint',
    resolution,
    options: { expand },
  });

  it('右扩 256：通过，feathering 默认 40', () => {
    const parsed = readOutpaintPad(withExpand({ right: 256 }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.pad).toEqual({ left: 0, top: 0, right: 256, bottom: 0, feathering: 40 });
  });

  it('不是 8 的整数倍 → 明确报错（不悄悄改数）', () => {
    const parsed = readOutpaintPad(withExpand({ right: 100 }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toMatch(/8 的整数倍/);
  });

  it('四边全 0 / 缺 expand / 非整数 → 三种都拒绝', () => {
    expect(readOutpaintPad(withExpand({ left: 0, right: 0 })).ok).toBe(false);
    expect(readOutpaintPad(withExpand(undefined)).ok).toBe(false);
    expect(readOutpaintPad(withExpand({ right: 12.5 })).ok).toBe(false);
  });

  it('外扩后超过 4096 → 拒绝并说清上限', () => {
    const parsed = readOutpaintPad(withExpand({ left: 2048, right: 2048 }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toMatch(/4096/);
  });

  it('feathering 越界被夹紧（不是报错项）', () => {
    const parsed = readOutpaintPad({ ...withExpand({ top: 64 }), options: { expand: { top: 64, feathering: 9999 } } });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.pad.feathering).toBe(256);
  });
});

/** V2.77：`options.scale` → 4x 模型的降采样系数（4x 模型跑完之后的缩小系数） */
describe('ComfyUiProvider · 放大倍率', () => {
  const withScale = (scale: unknown): VideoGenerateRequest => ({
    ...request(),
    options: scale === undefined ? {} : { scale },
  });

  it('4 / 4x / 缺省 → 1（不缩）；2 / 2x → 0.5；非法一律回落到 1', () => {
    expect(readUpscaleScaleBy(withScale('4'))).toBe(1);
    expect(readUpscaleScaleBy(withScale('4x'))).toBe(1);
    expect(readUpscaleScaleBy(withScale(undefined))).toBe(1);
    expect(readUpscaleScaleBy(withScale('2'))).toBe(0.5);
    expect(readUpscaleScaleBy(withScale('2x'))).toBe(0.5);
    expect(readUpscaleScaleBy(withScale(2))).toBe(0.5);
    expect(readUpscaleScaleBy(withScale('abc'))).toBe(1);
    // 超过 4x 拿不到更多细节，夹到 1；极端小值也不允许变成 0
    expect(readUpscaleScaleBy(withScale('8'))).toBe(1);
    expect(readUpscaleScaleBy(withScale('0.1'))).toBe(0.05);
  });
});
