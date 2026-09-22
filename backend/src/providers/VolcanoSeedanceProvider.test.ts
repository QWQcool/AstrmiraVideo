import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VideoGenerateRequest } from '@astrmira/shared';
import { ProviderFailureError } from '../errors.js';
import { VolcanoSeedanceProvider } from './VolcanoSeedanceProvider.js';

/**
 * 云端 provider 的流程与归类（S5b）。
 *
 * **零真实调用**：所有上游交互都走注入的 `fetchImpl` 桩。
 * 这里能保证的是"逻辑与错误归类正确"；"上游真的这么返回"只能由 AC2 冒烟证明。
 * 两类断言最重要，且都直指防线 7：
 * ① 无凭据时**一个请求都不许发出去**（发出去就意味着可能已计费）；
 * ② 轮询阶段无凭据必须归 **UNCERTAIN**，绝不能降成"失败可重试"。
 */

const request: VideoGenerateRequest = {
  prompt: '雨夜街头，女孩撑伞回头',
  mode: 't2v',
  aspectRatio: '16:9',
  provider: 'cloud-volcano-seedance',
  params: { durationSec: 5, seed: 42 },
};

const dirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 's5b-'));
  dirs.push(dir);
  return dir;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): { fetchImpl: typeof fetch; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const options = init ?? {};
    calls.push({ url, init: options });
    return handler(url, options);
  }) as typeof fetch;

  return { fetchImpl, calls };
}

function makeProvider(
  overrides: Partial<ConstructorParameters<typeof VolcanoSeedanceProvider>[0]> = {},
): VolcanoSeedanceProvider {
  return new VolcanoSeedanceProvider({
    taskId: 'task-abc',
    providerKey: 'sk-secret',
    model: 'doubao-seedance-1-0-pro-250528',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    ...overrides,
  });
}

describe('无凭据：必须先失败，且不许发出任何请求', () => {
  it('submit 报 KEY_MISSING（terminal），并且 fetch 一次都没被调用', async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, { id: 'cgt-1' }));
    const provider = makeProvider({ providerKey: null, fetchImpl });

    const err = await provider.submit(request).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProviderFailureError);
    expect((err as ProviderFailureError).code).toBe('KEY_MISSING');
    // 这条是钱：一旦发出去就可能产生费用
    expect(calls).toHaveLength(0);
  });

  it('queryStatus 报 UNCERTAIN_RESULT —— 已提交但查不了，绝不能降级为可重试', async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, { status: 'succeeded' }));
    const provider = makeProvider({ providerKey: null, fetchImpl });

    const err = await provider.queryStatus('cgt-1').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProviderFailureError);
    expect((err as ProviderFailureError).code).toBe('UNCERTAIN_RESULT');
    expect((err as ProviderFailureError).dispositionOverride).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it('引擎自检不看凭据（凭据是"每次请求"的事，不该报成引擎不可用）', async () => {
    const provider = makeProvider({ providerKey: null });
    await expect(provider.checkHealth()).resolves.toEqual({ available: true });
  });

  it('未配置模型名时自检失败', async () => {
    const provider = makeProvider({ model: '   ' });
    const health = await provider.checkHealth();

    expect(health.available).toBe(false);
    expect(health.reason).toContain('模型');
  });
});

describe('提交', () => {
  it('打到正确端点、带 Bearer 凭据、body 是协议适配层的产物', async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, { id: 'cgt-777' }));
    const provider = makeProvider({ fetchImpl });

    const result = await provider.submit(request);

    expect(result.taskId).toBe('cgt-777');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
    );
    expect(calls[0].init.method).toBe('POST');

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-secret');

    const body = JSON.parse(String(calls[0].init.body)) as {
      model: string;
      content: Array<{ type: string; text?: string }>;
    };
    expect(body.model).toBe('doubao-seedance-1-0-pro-250528');
    expect(body.content[0].text).toContain('雨夜街头');
    expect(body.content[0].text).toContain('--seed 42');
  });

  it('自定义 baseUrl 生效（自建代理 / 兼容端点）', async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, { id: 'cgt-1' }));
    const provider = makeProvider({ fetchImpl, baseUrl: 'https://proxy.internal/v1/' });

    await provider.submit(request);

    expect(calls[0].url).toBe('https://proxy.internal/v1/contents/generations/tasks');
  });

  it('参考资产连不上时如实报 INVALID_ASSET（不静默丢掉参考图）', async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, { id: 'cgt-1' }));
    const provider = makeProvider({ fetchImpl, resolveAssetUrl: async () => null });

    const err = await provider
      .submit({ ...request, mode: 'i2v', assets: { firstFrameImage: 'a-1' } })
      .catch((e: unknown) => e);

    expect((err as ProviderFailureError).code).toBe('INVALID_ASSET');
    expect(calls).toHaveLength(0);
  });

  it('参考资产解析成功后进入 content', async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, { id: 'cgt-1' }));
    const provider = makeProvider({
      fetchImpl,
      resolveAssetUrl: async () => 'data:image/png;base64,AAA',
    });

    await provider.submit({ ...request, mode: 'i2v', assets: { firstFrameImage: 'a-1' } });

    const body = JSON.parse(String(calls[0].init.body)) as {
      content: Array<{ type: string; role?: string }>;
    };
    expect(body.content.some((item) => item.type === 'image_url' && item.role === 'first_frame')).toBe(
      true,
    );
  });

  it('提交成功但响应没有任务 id → UPSTREAM_ERROR（当成功继续只会更难查）', async () => {
    const { fetchImpl } = stubFetch(() => jsonResponse(200, { status: 'queued' }));
    const provider = makeProvider({ fetchImpl });

    const err = await provider.submit(request).catch((e: unknown) => e);

    expect((err as ProviderFailureError).code).toBe('UPSTREAM_ERROR');
    expect((err as Error).message).toContain('任务 id');
  });

  it('401 → KEY_INVALID', async () => {
    const { fetchImpl } = stubFetch(() =>
      jsonResponse(401, { error: { code: 'AuthenticationError', message: 'invalid api key' } }),
    );
    const provider = makeProvider({ fetchImpl });

    const err = await provider.submit(request).catch((e: unknown) => e);

    expect((err as ProviderFailureError).code).toBe('KEY_INVALID');
    expect((err as Error).message).toContain('invalid api key');
  });

  it('网络层异常抛**普通 Error**（交给上层按"是否已提交"归 UNCERTAIN，不在这里抢答）', async () => {
    const { fetchImpl } = stubFetch(() => {
      throw new Error('socket hang up');
    });
    const provider = makeProvider({ fetchImpl });

    const err = await provider.submit(request).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ProviderFailureError);
    expect((err as Error).message).toContain('socket hang up');
  });
});

describe('轮询与成片落地', () => {
  it('running：状态与进度透传，requestSnapshot 是原始请求（画廊复用参数靠它）', async () => {
    const { fetchImpl } = stubFetch((url) =>
      url.endsWith('/tasks/cgt-1') ? jsonResponse(200, { id: 'cgt-1', status: 'running' }) : jsonResponse(200, { id: 'cgt-1' }),
    );
    const provider = makeProvider({ fetchImpl });

    await provider.submit(request);
    const progress = await provider.queryStatus('cgt-1');

    expect(progress.status).toBe('running');
    expect(progress.progressPercent).toBe(45);
    expect(progress.requestSnapshot).toEqual(request);
  });

  it('succeeded：把上游临时地址**下载到本地**，对外只给同源 /media 直链', async () => {
    const outDir = await tempDir();
    const videoBytes = Buffer.from('fake-mp4-bytes');

    const { fetchImpl, calls } = stubFetch((url) => {
      if (url.includes('/contents/generations/tasks/')) {
        return jsonResponse(200, {
          id: 'cgt-1',
          status: 'succeeded',
          content: { video_url: 'https://upstream.example/v/1.mp4' },
        });
      }
      return new Response(videoBytes, { status: 200, headers: { 'content-type': 'video/mp4' } });
    });

    const provider = makeProvider({ fetchImpl, outputDir: outDir });
    const progress = await provider.queryStatus('cgt-1');

    expect(progress.status).toBe('succeeded');
    expect(progress.outputVideoUrl).toBe('/media/task-abc.mp4');

    // 真的落盘了，且内容一致（不是只返回了个字符串）
    const written = await readFile(path.join(outDir, 'task-abc.mp4'));
    expect(written.equals(videoBytes)).toBe(true);
    expect(calls.some((call) => call.url === 'https://upstream.example/v/1.mp4')).toBe(true);
  });

  it('成片下载失败 → UPSTREAM_ERROR（地址可能已过期）', async () => {
    const outDir = await tempDir();
    const { fetchImpl } = stubFetch((url) => {
      if (url.includes('/contents/generations/tasks/')) {
        return jsonResponse(200, {
          status: 'succeeded',
          content: { video_url: 'https://upstream.example/gone.mp4' },
        });
      }
      return new Response('not found', { status: 404 });
    });

    const provider = makeProvider({ fetchImpl, outputDir: outDir });
    const err = await provider.queryStatus('cgt-1').catch((e: unknown) => e);

    expect((err as ProviderFailureError).code).toBe('UPSTREAM_ERROR');
    expect((err as Error).message).toContain('404');
  });

  it('响应不是 JSON → 抛普通 Error（属于"无法确认"，不是"明确失败"）', async () => {
    const { fetchImpl } = stubFetch(() => new Response('<html>502</html>', { status: 200 }));
    const provider = makeProvider({ fetchImpl });

    const err = await provider.queryStatus('cgt-1').catch((e: unknown) => e);

    expect(err).not.toBeInstanceOf(ProviderFailureError);
    expect((err as Error).message).toContain('不是合法 JSON');
  });
});

describe('取消', () => {
  it('DELETE 成功返回 true；无凭据直接 false（不猜）', async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));
    const withKey = makeProvider({ fetchImpl });
    await expect(withKey.cancel('cgt-1')).resolves.toBe(true);
    expect(calls[0].init.method).toBe('DELETE');

    const withoutKey = makeProvider({ providerKey: null, fetchImpl });
    await expect(withoutKey.cancel('cgt-1')).resolves.toBe(false);
  });

  it('取消失败不抛（终态由轮询结果决定）', async () => {
    const { fetchImpl } = stubFetch(() => {
      throw new Error('boom');
    });
    const provider = makeProvider({ fetchImpl });

    await expect(provider.cancel('cgt-1')).resolves.toBe(false);
  });
});
