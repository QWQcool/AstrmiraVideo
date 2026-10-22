import { describe, expect, it } from 'vitest';
import type { CanvasAgentContext } from '@astrmira/shared';
import { askCanvasWithLlm } from './agentCanvas.js';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const canvas: CanvasAgentContext = {
  projectId: 'p1',
  name: '雨夜画布',
  nodes: [
    {
      id: 'n1',
      type: 'image',
      title: '首帧',
      prompt: '雨夜霓虹',
      batchCount: 1,
      outputKinds: ['image'],
      referenceCount: 0,
    },
  ],
  edges: [],
  truncated: false,
};

describe('S7-D1 · askCanvasWithLlm', () => {
  it('只发送只读快照与问题，返回文本回答和 usage', async () => {
    let seenBody: unknown;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenBody = JSON.parse(String(init?.body ?? '{}'));
      return jsonResponse({
        choices: [{ message: { content: '当前画布只有 1 个节点，已有图片产物。' } }],
        usage: { prompt_tokens: 90, completion_tokens: 20 },
      });
    }) as typeof fetch;

    const result = await askCanvasWithLlm({
      apiKey: 'sk-test',
      question: '总结画布',
      canvas,
      fetchImpl,
    });

    expect(result.answer).toContain('1 个节点');
    expect(result.usage).toEqual({ promptTokens: 90, completionTokens: 20 });
    expect(JSON.stringify(seenBody)).toContain('只读画布助手');
    expect(JSON.stringify(seenBody)).toContain('不能修改画布');
    expect(JSON.stringify(seenBody)).toContain('首帧');
    expect(JSON.stringify(seenBody)).not.toContain('/api/generate');
  });

  it('上游 401 → KEY_INVALID', async () => {
    const fetchImpl = (async () => jsonResponse({ error: 'bad key' }, 401)) as typeof fetch;
    await expect(
      askCanvasWithLlm({ apiKey: 'sk-test', question: '总结', canvas, fetchImpl }),
    ).rejects.toMatchObject({ code: 'KEY_INVALID' });
  });

  it('上游非 JSON → UPSTREAM_ERROR，不拼出假答案', async () => {
    const fetchImpl = (async () =>
      new Response('not-json', { status: 200 })) as typeof fetch;
    await expect(
      askCanvasWithLlm({ apiKey: 'sk-test', question: '总结', canvas, fetchImpl }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });
});
