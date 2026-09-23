import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  clearLogs,
  deleteLog,
  enhancePrompt,
  fetchLogs,
  fetchTask,
  resolveMediaUrl,
  submitGenerate,
  verifyTrackKey,
} from './api';

/**
 * F1：API 层的两条底线——
 * ① 响应必须过契约（否则 UI 会把 `undefined` 当数据渲染）；
 * ② 凭据只走请求头（D23：Key 不入 URL / body）。
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const VALID_TASK = {
  taskId: 't-1',
  status: 'running',
  progressPercent: 42,
  requestSnapshot: {
    prompt: 'x',
    mode: 't2v',
    aspectRatio: '16:9',
    provider: 'fixture-local',
  },
  // V2.3（CONTRACT §4）：任务创建时间（epoch ms）现在是必填 —— 缺了就该被契约拦下
  createdAt: 1_756_000_000_000,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('响应契约校验（宁可报错，也不渲染 undefined）', () => {
  it('合法响应被正常解析', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, VALID_TASK)));

    const task = await fetchTask('t-1');

    expect(task.status).toBe('running');
    expect(task.progressPercent).toBe(42);
  });

  it('缺字段（progressPercent）→ 抛契约错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, { taskId: 't-1', status: 'running' })),
    );

    const err = await fetchTask('t-1').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).failure.kind).toBe('contract');
    expect((err as ApiError).failure.message).toContain('不符合契约');
  });

  it('404 TASK_NOT_FOUND → 契约错误带 code / disposition', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(404, { code: 'TASK_NOT_FOUND', message: '任务不存在', disposition: 'terminal' }),
      ),
    );

    const err = (await fetchTask('nope').catch((e: unknown) => e)) as ApiError;

    expect(err.failure.kind).toBe('contract');
    expect(err.failure.code).toBe('TASK_NOT_FOUND');
    expect(err.failure.disposition).toBe('terminal');
    expect(err.failure.status).toBe(404);
  });

  it('501 LLM_NOT_CONFIGURED（没填文本轨 Key）→ terminal，且文案透传', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(501, {
          code: 'LLM_NOT_CONFIGURED',
          message: '未配置扩写模型',
          disposition: 'terminal',
        }),
      ),
    );

    const err = (await enhancePrompt({ originalPrompt: '雨夜街头' }).catch((e: unknown) => e)) as ApiError;

    expect(err.failure.code).toBe('LLM_NOT_CONFIGURED');
    expect(err.failure.message).toContain('未配置扩写模型');
  });

  it('扩写：文本 Key 只走 X-LLM-Key（与视频轨的 X-Provider-Key 分开）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { enhancedPrompt: '扩写后', engine: 'llm' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await enhancePrompt(
      { originalPrompt: '雨夜街头', style: 'cinematic', llm: { preset: 'deepseek' } },
      { llmKey: 'sk-llm-abcdef123456' },
    );

    expect(result.engine).toBe('llm');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-llm-key']).toBe('sk-llm-abcdef123456');
    // 文本 Key 不得混进视频轨的头，也不得出现在 URL 或 body 里（CONTRACT §5）
    expect(headers['x-provider-key']).toBeUndefined();
    expect(url).not.toContain('sk-llm');
    expect(String(init.body)).not.toContain('sk-llm');
  });

  it('扩写：没带 Key 时不发送该请求头（由服务端如实回 501）', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(501, { code: 'LLM_NOT_CONFIGURED', message: 'x', disposition: 'terminal' }));
    vi.stubGlobal('fetch', fetchMock);

    await enhancePrompt({ originalPrompt: '雨夜街头' }).catch(() => undefined);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-llm-key']).toBeUndefined();
  });

  it('扩写：响应缺 engine → 契约错误（engine 是"是否静默降级"的可证伪标记，不得可选）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { enhancedPrompt: '扩写后' })));

    const err = (await enhancePrompt(
      { originalPrompt: '雨夜街头' },
      { llmKey: 'sk-llm-abcdef123456' },
    ).catch((e: unknown) => e)) as ApiError;

    expect(err.failure.kind).toBe('contract');
    expect(err.failure.message).toContain('engine');
  });

  it('UNCERTAIN_RESULT → isUncertain 为真（界面走人工核对分支，AC7）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(409, {
          code: 'UNCERTAIN_RESULT',
          message: '结果不明',
          disposition: 'uncertain',
        }),
      ),
    );

    const err = (await fetchTask('t-2').catch((e: unknown) => e)) as ApiError;

    expect(err.isUncertain).toBe(true);
  });

  it('非 JSON 响应 → 归 network（不是契约错误）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>oops</html>', { status: 200 })),
    );

    const err = (await fetchTask('t-3').catch((e: unknown) => e)) as ApiError;

    expect(err.failure.kind).toBe('network');
    expect(err.failure.message).toContain('合法 JSON');
  });

  it('fetch 本身失败（断网）→ network，status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const err = (await fetchTask('t-4').catch((e: unknown) => e)) as ApiError;

    expect(err.failure.kind).toBe('network');
    expect(err.failure.status).toBe(0);
  });
});

describe('凭据传递（D23：Key 只进请求头，不入 URL / body）', () => {
  it('submitGenerate 把 Key 与幂等键放进请求头', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { taskId: 't-9' }));
    vi.stubGlobal('fetch', fetchMock);

    await submitGenerate(
      {
        prompt: '雨夜街头',
        mode: 't2v',
        aspectRatio: '16:9',
        provider: 'cloud-volcano-seedance',
      },
      { idempotencyKey: 'idem-1', providerKey: 'super-secret-key' },
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(url).toBe('/api/generate');
    expect(url).not.toContain('super-secret-key');
    expect(String(init.body)).not.toContain('super-secret-key');
    expect(headers['x-provider-key']).toBe('super-secret-key');
    expect(headers['idempotency-key']).toBe('idem-1');
  });

  it('未提供 Key 时不带该请求头（服务端回落到 env 兜底 Key 或报 KEY_MISSING）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { taskId: 't-10' }));
    vi.stubGlobal('fetch', fetchMock);

    await submitGenerate(
      {
        prompt: '无 Key 提交',
        mode: 't2v',
        aspectRatio: '16:9',
        provider: 'cloud-volcano-seedance',
      },
      { idempotencyKey: 'idem-2' },
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(headers['x-provider-key']).toBeUndefined();
    expect(headers['idempotency-key']).toBe('idem-2');
  });
});

describe('resolveMediaUrl（成片直链只认同源 /media/）', () => {
  it('放行同源相对路径', () => {
    expect(resolveMediaUrl('/media/t-1.mp4')).toBe('/media/t-1.mp4');
  });

  it('拒绝绝对 URL（防止被污染的响应把浏览器带去外部地址）', () => {
    expect(resolveMediaUrl('https://evil.example/x.mp4')).toBeNull();
    expect(resolveMediaUrl('//evil.example/x.mp4')).toBeNull();
    expect(resolveMediaUrl('http://127.0.0.1/x.mp4')).toBeNull();
  });

  it('拒绝路径穿越与空值', () => {
    expect(resolveMediaUrl('/media/../../etc/passwd')).toBeNull();
    expect(resolveMediaUrl('/other/x.mp4')).toBeNull();
    expect(resolveMediaUrl(undefined)).toBeNull();
  });
});

describe('taskId 参与 URL 时必须编码', () => {
  it('特殊字符不会破坏路径', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, VALID_TASK));
    vi.stubGlobal('fetch', fetchMock);

    await fetchTask('a/b c');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/tasks/a%2Fb%20c');
  });
});

/**
 * 「测试连接」（CONTRACT §9，V2.1）与操作日志（§10）的客户端半边。
 * 这里只钉"发了什么请求"—— 判定逻辑在服务端，前端不该复制一份。
 */
describe('凭据与模型校验 / 操作日志', () => {
  it('测试连接：视频轨用 X-Provider-Key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { keyValid: true, totalModels: 135, modelListed: true, modelAvailable: true, message: 'ok' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyTrackKey(
      { track: 'video', model: 'doubao-seedance-2-0-mini-260615' },
      { providerKey: 'sk-video-1' },
    );

    expect(result.modelAvailable).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/providers/keys/verify');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-provider-key']).toBe('sk-video-1');
    expect(headers['x-llm-key']).toBeUndefined();
  });

  it('测试连接：文本轨用 X-LLM-Key（两把 Key 不串台）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { keyValid: true, totalModels: null, modelListed: null, modelAvailable: true, message: 'ok' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await verifyTrackKey({ track: 'text', preset: 'volcano-ark' }, { llmKey: 'sk-llm-1' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-llm-key']).toBe('sk-llm-1');
    expect(headers['x-provider-key']).toBeUndefined();
  });

  it('日志查询：空值与 undefined 不进 query（否则筛选会被空串污染）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { items: [], total: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchLogs({ limit: 50, offset: 0, ip: '', q: undefined });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/logs?limit=50&offset=0');
  });

  it('日志查询：筛选值被编码（IP 里的特殊字符不会破坏 URL）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { items: [], total: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchLogs({ ip: '2001:db8::1', q: '雨夜 & 街头' });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('ip=2001%3Adb8%3A%3A1');
    expect(url).toContain('q=%E9%9B%A8%E5%A4%9C+%26+%E8%A1%97%E5%A4%B4');
  });

  it('删单条与清空都走 DELETE，且清空会带上当前筛选', async () => {
    // ⚠️ 必须每次返回**新的** Response：同一个 Response 的 body 只能读一次，
    // 复用会让第二次调用抛 "Body is unusable"（这个坑刚踩过）
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(jsonResponse(200, { ok: true, deleted: 1 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await deleteLog(7);
    await clearLogs({ ip: '203.0.113.7' });

    const [firstUrl, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [secondUrl, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(firstUrl).toBe('/api/logs/7');
    expect(firstInit.method).toBe('DELETE');
    expect(secondUrl).toBe('/api/logs?ip=203.0.113.7');
    expect(secondInit.method).toBe('DELETE');
  });
});
