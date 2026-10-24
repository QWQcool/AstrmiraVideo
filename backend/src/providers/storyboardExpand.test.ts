import { describe, expect, it } from 'vitest';
import type { StoryboardPlan } from '@astrmira/shared';
import {
  generateStoryboardExpansion,
  validateStoryboardExpansion,
} from './storyboardExpand.js';

function plan(shotCount = 2): StoryboardPlan {
  return {
    version: 1,
    title: '雨夜霓虹',
    aspectRatio: '16:9',
    durationSec: shotCount * 3,
    shots: Array.from({ length: shotCount }, (_unused, i) => ({
      index: i + 1,
      time: `${i * 3}-${i * 3 + 3}s`,
      shotSize: '中景',
      camera: '缓慢推近',
      visual: '橘猫蹲在霓虹灯下',
    })),
    openQuestions: [],
    warnings: [],
  };
}

function shot(index: number, overrides: Record<string, unknown> = {}) {
  return {
    index,
    title: `镜头 ${index}`,
    videoPrompt: `镜头 ${index} 的视频提示词`,
    aspectRatio: '16:9' as const,
    resolutionTier: '720p' as const,
    durationSec: 3,
    referenceAssetIds: [],
    warnings: [],
    ...overrides,
  };
}

function llmFetch(content: string): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 800, completion_tokens: 200 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as typeof fetch;
}

function wrap(shots: unknown[]): string {
  return JSON.stringify({ version: 1, shots });
}

describe('generateStoryboardExpansion · 分镜展开（S8-A2）', () => {
  it('合法输出：解析、业务校验、usage 全通过', async () => {
    const result = await generateStoryboardExpansion({
      apiKey: 'sk-test',
      plan: plan(),
      references: [{ assetId: 'asset-cat-1', kind: 'image' }],
      fetchImpl: llmFetch(
        wrap([
          shot(1, { imagePrompt: '雨夜街头定妆图', referenceAssetIds: ['asset-cat-1'] }),
          shot(2),
        ]),
      ),
    });
    expect(result.plan.shots).toHaveLength(2);
    expect(result.plan.shots[0]).toMatchObject({ index: 1, imagePrompt: '雨夜街头定妆图' });
    expect(result.model).toBe('gpt-4o-mini'); // 未指定 llm 时回落 LLM_PRESETS[0]
    expect(result.usage).toEqual({ promptTokens: 800, completionTokens: 200 });
  });

  it('模型编造参考素材 id → 502（不静默丢，不替用户猜）', async () => {
    await expect(
      generateStoryboardExpansion({
        apiKey: 'sk-test',
        plan: plan(),
        references: [{ assetId: 'asset-cat-1', kind: 'image' }],
        fetchImpl: llmFetch(wrap([shot(1, { referenceAssetIds: ['asset-fabricated'] }), shot(2)])),
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', message: expect.stringContaining('不存在') });
  });

  it('展开镜头与分镜表不一一对应 → 502', async () => {
    await expect(
      generateStoryboardExpansion({
        apiKey: 'sk-test',
        plan: plan(3),
        references: [],
        fetchImpl: llmFetch(wrap([shot(1), shot(2)])), // 分镜 3 镜只展开 2 镜
      }),
    ).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      message: expect.stringContaining('镜头数不一致'),
    });

    await expect(
      generateStoryboardExpansion({
        apiKey: 'sk-test',
        plan: plan(2),
        references: [],
        fetchImpl: llmFetch(wrap([shot(2), shot(1)])), // 顺序颠倒
      }),
    ).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      message: expect.stringContaining('一一对应'),
    });
  });

  it('非法枚举 / 超上限 → 502（schema 拒）', async () => {
    await expect(
      generateStoryboardExpansion({
        apiKey: 'sk-test',
        plan: plan(),
        references: [],
        fetchImpl: llmFetch(wrap([shot(1, { aspectRatio: '3:4' }), shot(2)])),
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });

    await expect(
      generateStoryboardExpansion({
        apiKey: 'sk-test',
        plan: plan(16),
        references: [],
        fetchImpl: llmFetch(
          wrap(Array.from({ length: 17 }, (_unused, i) => shot(i + 1))),
        ),
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });

  it('上游 401 → KEY_INVALID（不吞凭据错误）', async () => {
    const unauthorized = (async () =>
      new Response('denied', { status: 401 })) as unknown as typeof fetch;
    await expect(
      generateStoryboardExpansion({
        apiKey: 'sk-bad',
        plan: plan(),
        references: [],
        fetchImpl: unauthorized,
      }),
    ).rejects.toMatchObject({ code: 'KEY_INVALID' });
  });
});

describe('validateStoryboardExpansion · 纯校验函数', () => {
  it('合法透传；空引用清单下任何 referenceAssetIds 都算编造', () => {
    expect(validateStoryboardExpansion({ version: 1, shots: [shot(1), shot(2)] }, plan(2), [])).toBeNull();
    expect(
      validateStoryboardExpansion(
        { version: 1, shots: [shot(1, { referenceAssetIds: ['x'] }), shot(2)] },
        plan(2),
        [],
      ),
    ).toContain('不存在');
  });
});
