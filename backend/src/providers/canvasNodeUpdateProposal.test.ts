import { describe, expect, it } from 'vitest';
import type { CanvasAgentContext } from '@astrmira/shared';
import { proposeCanvasTextNodeUpdate } from './canvasNodeUpdateProposal.js';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const canvas: CanvasAgentContext = {
  projectId: 'p1',
  name: '画布',
  nodes: [
    {
      id: 'text-1',
      type: 'text',
      title: '旧说明',
      prompt: '旧正文',
      batchCount: 0,
      outputKinds: [],
      referenceCount: 0,
    },
    {
      id: 'img-1',
      type: 'image',
      title: '图片',
      prompt: '图',
      batchCount: 1,
      outputKinds: ['image'],
      referenceCount: 0,
    },
  ],
  edges: [],
  truncated: false,
};

function updateContent(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    action: 'update-text-node',
    targetNodeId: 'text-1',
    title: '新说明',
    content: '新正文',
    warnings: [],
    ...overrides,
  });
}

describe('S7-D5 · proposeCanvasTextNodeUpdate', () => {
  it('只请求目标文本节点的更新方案，并返回 usage', async () => {
    let seenBody: unknown;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenBody = JSON.parse(String(init?.body ?? '{}'));
      return jsonResponse({
        choices: [{ message: { content: updateContent() } }],
        usage: { prompt_tokens: 70, completion_tokens: 20 },
      });
    }) as typeof fetch;
    const result = await proposeCanvasTextNodeUpdate({
      apiKey: 'sk-test',
      instruction: '改得更简洁',
      canvas,
      targetNodeId: 'text-1',
      fetchImpl,
    });
    expect(result.proposal).toMatchObject({
      action: 'update-text-node',
      targetNodeId: 'text-1',
      title: '新说明',
      content: '新正文',
    });
    expect(result.usage).toEqual({ promptTokens: 70, completionTokens: 20 });
    expect(JSON.stringify(seenBody)).toContain('只能更新 targetNodeId');
  });

  it('模型返回其他 targetNodeId → 拒绝，不返回方案', async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        choices: [{ message: { content: updateContent({ targetNodeId: 'img-1' }) } }],
      })) as typeof fetch;
    await expect(
      proposeCanvasTextNodeUpdate({
        apiKey: 'sk-test',
        instruction: 'x',
        canvas,
        targetNodeId: 'text-1',
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });

  it('目标不是文本节点 → INVALID_REQUEST，不请求上游', async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return jsonResponse({});
    }) as typeof fetch;
    await expect(
      proposeCanvasTextNodeUpdate({
        apiKey: 'sk-test',
        instruction: 'x',
        canvas,
        targetNodeId: 'img-1',
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(called).toBe(false);
  });
});
