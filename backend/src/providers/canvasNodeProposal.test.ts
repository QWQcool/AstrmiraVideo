import { describe, expect, it } from 'vitest';
import type { CanvasAgentContext } from '@astrmira/shared';
import { proposeCanvasTextNode } from './canvasNodeProposal.js';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const canvas: CanvasAgentContext = {
  projectId: 'p1',
  name: '画布',
  nodes: [],
  edges: [],
  truncated: false,
};

function proposalContent(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    action: 'create-text-node',
    title: '雨夜转场说明',
    content: '从雨幕切到霓虹倒影。',
    warnings: [],
    ...overrides,
  });
}

describe('S7-D2 · proposeCanvasTextNode', () => {
  it('只请求方案 JSON，返回 proposal 与 usage', async () => {
    let seenBody: unknown;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenBody = JSON.parse(String(init?.body ?? '{}'));
      return jsonResponse({
        choices: [{ message: { content: proposalContent() } }],
        usage: { prompt_tokens: 60, completion_tokens: 18 },
      });
    }) as typeof fetch;
    const result = await proposeCanvasTextNode({
      apiKey: 'sk-test',
      instruction: '写一条转场说明',
      canvas,
      fetchImpl,
    });
    expect(result.proposal.title).toBe('雨夜转场说明');
    expect(result.usage).toEqual({ promptTokens: 60, completionTokens: 18 });
    expect(JSON.stringify(seenBody)).toContain('只能创建一个文本节点');
    expect(JSON.stringify(seenBody)).toContain('不要声称已经创建');
  });

  it('模型夹带删除操作 → 结构校验失败，不返回半份方案', async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        choices: [{ message: { content: proposalContent({ action: 'delete-node' }) } }],
      })) as typeof fetch;
    await expect(
      proposeCanvasTextNode({ apiKey: 'sk-test', instruction: 'x', canvas, fetchImpl }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });

  it('上游 401 → KEY_INVALID', async () => {
    const fetchImpl = (async () => jsonResponse({ error: 'bad' }, 401)) as typeof fetch;
    await expect(
      proposeCanvasTextNode({ apiKey: 'sk-test', instruction: 'x', canvas, fetchImpl }),
    ).rejects.toMatchObject({ code: 'KEY_INVALID' });
  });
});
