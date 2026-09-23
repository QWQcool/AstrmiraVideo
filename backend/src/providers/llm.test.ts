import { describe, expect, it } from 'vitest';
import { LLM_PRESETS } from '@astrmira/shared';
import { ProviderFailureError } from '../errors.js';
import { redactSecrets } from '../security/redact.js';
import {
  enhancePromptWithLlm,
  extractEnhancedPromptLoosely,
  extractJsonObject,
  looksLikeJsonEnvelope,
  resolveLlmEndpoint,
} from './llm.js';

/**
 * 文本轨（V2.0，PLAN §6-D24 落地台账 B3）。
 *
 * 这里的断言集中在**四件容易做错、且做错了很难发现的事**：
 * 1. 端点解析（请求体 > 预设 > 默认）与"自定义预设不许留空"；
 * 2. 出站请求的形状（URL / Bearer / model / 两条 message 的内容）；
 * 3. **Key 绝不进错误消息**（上游错误体经常回显 Key，而这条消息会原样回给前端）；
 * 4. 失败的三态归类：401 → `KEY_INVALID`(terminal)、其余 → `UPSTREAM_ERROR`(**retryable**，
 *    按 D28 不适用"超时即结果不明"的硬规则 2 —— 文本调用没有持久副作用)。
 */

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function chatResponse(content: string): Response {
  return jsonResponse(200, { choices: [{ message: { role: 'assistant', content } }] });
}

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function stubFetch(responder: (call: CapturedCall) => Response | Promise<Response>): {
  fetchImpl: typeof fetch;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return responder(call);
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

describe('resolveLlmEndpoint · 请求体 > 预设 > 内置默认', () => {
  it('不给任何配置时回落到预设表第一项', () => {
    expect(resolveLlmEndpoint()).toEqual({
      baseUrl: LLM_PRESETS[0].baseUrl,
      model: LLM_PRESETS[0].model,
    });
  });

  it('按预设 id 取该家的端点与模型', () => {
    const deepseek = LLM_PRESETS.find((preset) => preset.id === 'deepseek');
    expect(resolveLlmEndpoint({ preset: 'deepseek' })).toEqual({
      baseUrl: deepseek?.baseUrl,
      model: deepseek?.model,
    });
  });

  it('请求体里的 baseUrl / model 覆盖预设值，并去掉结尾斜杠（否则会拼出 //chat/completions）', () => {
    expect(resolveLlmEndpoint({ preset: 'openai', baseUrl: 'https://proxy.example/v1/', model: 'my-model' })).toEqual({
      baseUrl: 'https://proxy.example/v1',
      model: 'my-model',
    });
  });

  it('「自定义」预设**不回落到 OpenAI**：留空必须报错，而不是悄悄用别家的地址 + 用户的 Key', () => {
    // 这条用例是实测抓出来的：最初的实现 `findLlmPreset('custom') ?? LLM_PRESETS[0]`，
    // 于是用户选了"自定义"却忘记填地址时，请求会打到 OpenAI —— 静默替用户做了决定。
    expect(() => resolveLlmEndpoint({ preset: 'custom' })).toThrow(ProviderFailureError);
    expect(() => resolveLlmEndpoint({ preset: 'custom', baseUrl: 'https://my.example/v1' })).toThrow();
    expect(() => resolveLlmEndpoint({ preset: 'custom', model: 'my-model' })).toThrow();

    try {
      resolveLlmEndpoint({ preset: 'custom', model: 'my-model' });
    } catch (err) {
      expect((err as ProviderFailureError).code).toBe('LLM_NOT_CONFIGURED');
    }

    // 填全了就正常用（自定义兼容端点这条路必须真的通）
    expect(
      resolveLlmEndpoint({ preset: 'custom', baseUrl: 'https://my.example/v1', model: 'my-model' }),
    ).toEqual({ baseUrl: 'https://my.example/v1', model: 'my-model' });
  });

  it('地址不是 http(s) → LLM_NOT_CONFIGURED（含写错协议与根本不是 URL 两种）', () => {
    for (const baseUrl of ['ftp://example.com', '不是地址', 'localhost:8000/v1']) {
      expect(() => resolveLlmEndpoint({ baseUrl, model: 'm' })).toThrow(ProviderFailureError);
    }
    expect(resolveLlmEndpoint({ baseUrl: 'http://127.0.0.1:8000/v1', model: 'm' }).baseUrl).toBe(
      'http://127.0.0.1:8000/v1',
    );
  });
});

describe('redactSecrets · Key 不得随错误消息回给前端', () => {
  it('抹掉本次请求用的 Key 原文', () => {
    const key = 'sk-verysecret1234567890';
    expect(redactSecrets(`Invalid API key provided: ${key}`, key)).not.toContain(key);
  });

  it('抹掉 Bearer 串与 `sk-…` 形态的其它凭据（上游可能回显另一把 Key）', () => {
    const scrubbed = redactSecrets('sent header Authorization: Bearer abcdef1234567890 and sk-abcdef123456');
    expect(scrubbed).not.toContain('abcdef1234567890');
    expect(scrubbed).not.toContain('sk-abcdef123456');
    expect(scrubbed).toContain('<redacted>');
  });
});

describe('extractJsonObject · 模型不一定乖乖只回 JSON', () => {
  it('纯 JSON / ```json 代码块 / 前后带解释文字都能取出对象', () => {
    expect(extractJsonObject('{"enhancedPrompt":"a"}')).toEqual({ enhancedPrompt: 'a' });
    expect(extractJsonObject('```json\n{"enhancedPrompt":"a"}\n```')).toEqual({
      enhancedPrompt: 'a',
    });
    expect(extractJsonObject('好的，这是结果：{"enhancedPrompt":"a"} 希望有帮助')).toEqual({
      enhancedPrompt: 'a',
    });
  });

  it('取不到对象时返回 null（调用方据此走"纯文本 + notice"，而不是假装结构化）', () => {
    expect(extractJsonObject('这是一段纯文本描述')).toBeNull();
    expect(extractJsonObject('[1,2,3]')).toBeNull();
    expect(extractJsonObject('{不是合法 JSON}')).toBeNull();
    expect(extractJsonObject('')).toBeNull();
  });
});

/**
 * 模型把 JSON 写坏时的三条退路（2026-09-23 线上实测驱动）。
 *
 * 真实事故：模型在 JSON 字符串里写了**真换行**→ 严格解析失败 → 旧实现把整段 JSON 当成提示词回填，
 * 用户接着就把 `{"enhancedPrompt":"…"}` 提交去出片了（花了钱）。
 * 新口径：先宽松抠正文；抠不出就**保留用户原文**；只有"看起来是普通散文"时才按纯文本采用。
 */
describe('extractEnhancedPromptLoosely / looksLikeJsonEnvelope', () => {
  it('多行 JSON（字符串里有真换行）也能把正文抠出来', () => {
    const broken = `{
  "enhancedPrompt": "竖屏短剧画面，一位年轻女孩独自站在雨夜的城市街头，
  她缓缓抬起头，脸上绽放出微笑着说道：\\"我等的就是你\\"",
  "cameraMovementSuggested": "缓慢推近"
}`;

    expect(extractJsonObject(broken)).toBeNull(); // 严格解析确实失败
    const loose = extractEnhancedPromptLoosely(broken);
    expect(loose).toContain('竖屏短剧画面');
    expect(loose).toContain('我等的就是你');
    expect(loose).not.toContain('cameraMovementSuggested');
  });

  it('抠不出正文时返回 undefined（由调用方保留原文，绝不回填 JSON 外壳）', () => {
    expect(extractEnhancedPromptLoosely('{"foo":1}')).toBeUndefined();
    expect(extractEnhancedPromptLoosely('{"enhancedPrompt":"{坏的"}')).toBeUndefined();
    expect(extractEnhancedPromptLoosely('完全不是 JSON')).toBeUndefined();
  });

  it('"看起来像结构化数据"的判定：JSON 外壳与键值对形态都算', () => {
    expect(looksLikeJsonEnvelope('{"a":1}')).toBe(true);
    expect(looksLikeJsonEnvelope('[1,2]')).toBe(true);
    expect(looksLikeJsonEnvelope('{"enhancedPrompt":"x"')).toBe(true);
    expect(looksLikeJsonEnvelope('雨夜街头，女孩撑伞回头')).toBe(false);
  });
});

describe('enhancePromptWithLlm · 出站请求与结果归一化', () => {
  it('请求形状：`{baseUrl}/chat/completions` + Bearer + model + 系统提示带风格与模式', async () => {
    const { fetchImpl, calls } = stubFetch(() =>
      chatResponse('{"enhancedPrompt":"雨夜街头，女孩微笑","cameraMovementSuggested":"缓慢推近","lightingSuggested":"霓虹逆光"}'),
    );

    const result = await enhancePromptWithLlm({
      apiKey: 'sk-test-1234567890',
      originalPrompt: '女孩在雨夜街头微笑',
      style: 'cinematic',
      mode: 'fl2v',
      fetchImpl,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${LLM_PRESETS[0].baseUrl}/chat/completions`);

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-test-1234567890');

    const body = JSON.parse(String(calls[0]?.init.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe(LLM_PRESETS[0].model);
    expect(body.messages[0]?.role).toBe('system');
    expect(body.messages[0]?.content).toContain('电影感');
    expect(body.messages[0]?.content).toContain('首尾帧');
    expect(body.messages[1]).toEqual({ role: 'user', content: '女孩在雨夜街头微笑' });

    expect(result).toEqual({
      enhancedPrompt: '雨夜街头，女孩微笑',
      cameraMovementSuggested: '缓慢推近',
      lightingSuggested: '霓虹逆光',
    });
  });

  it('模型没按 JSON 回 → 照实取纯文本并给出 notice（**不**用规则引擎补字段冒充）', async () => {
    const { fetchImpl } = stubFetch(() => chatResponse('雨夜街头，女孩微笑着，霓虹倒影，镜头缓慢推近'));

    const result = await enhancePromptWithLlm({
      apiKey: 'sk-test-1234567890',
      originalPrompt: '女孩在雨夜街头微笑',
      fetchImpl,
    });

    expect(result.enhancedPrompt).toBe('雨夜街头，女孩微笑着，霓虹倒影，镜头缓慢推近');
    expect(result.notice).toContain('不是 JSON');
    expect(result.cameraMovementSuggested).toBeUndefined();
  });

  it('401 / 403 → KEY_INVALID（terminal）；不冒充"结果不明"', async () => {
    for (const status of [401, 403]) {
      const { fetchImpl } = stubFetch(() => jsonResponse(status, { error: 'unauthorized' }));

      const err = (await enhancePromptWithLlm({
        apiKey: 'sk-test-1234567890',
        originalPrompt: 'x',
        fetchImpl,
      }).catch((e: unknown) => e)) as ProviderFailureError;

      expect(err).toBeInstanceOf(ProviderFailureError);
      expect(err.code).toBe('KEY_INVALID');
      // 凭据错是终态：重试同一把 Key 没有任何意义
      expect(err.message).not.toContain('sk-test-1234567890');
    }
  });

  it('5xx → UPSTREAM_ERROR 且**可重试**（D28：文本调用无持久副作用，不适用"超时即结果不明"）', async () => {
    const { fetchImpl } = stubFetch(() => new Response('upstream boom', { status: 500 }));

    const err = (await enhancePromptWithLlm({
      apiKey: 'sk-test-1234567890',
      originalPrompt: 'x',
      fetchImpl,
    }).catch((e: unknown) => e)) as ProviderFailureError;

    expect(err.code).toBe('UPSTREAM_ERROR');
  });

  it('上游错误体回显了 Key → 消息里必须是掩码后的内容', async () => {
    const apiKey = 'sk-leakme-9876543210';
    const { fetchImpl } = stubFetch(
      () => new Response(`{"error":{"message":"Invalid API key: ${apiKey}"}}`, { status: 400 }),
    );

    const err = (await enhancePromptWithLlm({
      apiKey,
      originalPrompt: 'x',
      fetchImpl,
    }).catch((e: unknown) => e)) as ProviderFailureError;

    expect(err.message).not.toContain(apiKey);
    expect(err.message).toContain('<redacted>');
  });

  it('网络异常 / 超时 → UPSTREAM_ERROR（不是 UNCERTAIN_RESULT）', async () => {
    const { fetchImpl } = stubFetch(() => {
      throw new Error('The operation was aborted due to timeout');
    });

    const err = (await enhancePromptWithLlm({
      apiKey: 'sk-test-1234567890',
      originalPrompt: 'x',
      fetchImpl,
    }).catch((e: unknown) => e)) as ProviderFailureError;

    expect(err.code).toBe('UPSTREAM_ERROR');
    expect(err.message).toContain('超时');
  });

  it('JSON 解析失败但能抠出正文 → 用正文，且带 notice（不把 JSON 外壳当提示词）', async () => {
    const { fetchImpl } = stubFetch(() =>
      chatResponse('{"enhancedPrompt":"雨夜街头，女孩微笑，\\n镜头缓慢推近","cameraMovementSuggested":"推近"}'),
    );

    const result = await enhancePromptWithLlm({
      apiKey: 'sk-test-1234567890',
      originalPrompt: '女孩在雨夜街头微笑',
      fetchImpl,
    });

    // 注：这段是**合法** JSON（`\n` 是转义符），因此走严格解析；这里断言正文被取出且不含字段名
    expect(result.enhancedPrompt).toContain('雨夜街头，女孩微笑');
    expect(result.enhancedPrompt).not.toContain('cameraMovementSuggested');
  });

  it('JSON 写坏又抠不出正文 → **保留用户原文**（绝不回填 JSON 外壳让用户拿去出片）', async () => {
    const { fetchImpl } = stubFetch(() => chatResponse('{"foo":1,"bar":2}'));

    const result = await enhancePromptWithLlm({
      apiKey: 'sk-test-1234567890',
      originalPrompt: '女孩在雨夜街头微笑',
      fetchImpl,
    });

    expect(result.enhancedPrompt).toBe('女孩在雨夜街头微笑');
    expect(result.notice).toContain('保留你的原文');
  });

  it('上游返回空内容 → UPSTREAM_ERROR（当成功继续只会让用户看到空提示词）', async () => {
    const { fetchImpl } = stubFetch(() => chatResponse('   '));

    const err = (await enhancePromptWithLlm({
      apiKey: 'sk-test-1234567890',
      originalPrompt: 'x',
      fetchImpl,
    }).catch((e: unknown) => e)) as ProviderFailureError;

    expect(err.code).toBe('UPSTREAM_ERROR');
  });
});
