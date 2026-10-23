import { describe, expect, it } from 'vitest';
import { generateStoryboardPlan } from './storyboardPlan.js';

function jsonResponse(content: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 100, completion_tokens: 80 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('P5 · generateStoryboardPlan', () => {
  it('返回独立分镜表与 usage', async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        version: 1,
        title: '雨夜霓虹',
        aspectRatio: '16:9',
        durationSec: 6,
        shots: [
          {
            index: 1,
            time: '0-3s',
            shotSize: '中景',
            camera: '推近',
            visual: '橘猫',
          },
          {
            index: 2,
            time: '3-6s',
            shotSize: '近景',
            camera: '固定',
            visual: '抬头',
          },
        ],
        openQuestions: ['是否需要旁白'],
        warnings: [],
      })) as typeof fetch;
    const result = await generateStoryboardPlan({
      apiKey: 'sk-test',
      instruction: '雨夜短片',
      fetchImpl,
    });
    expect(result.plan.title).toBe('雨夜霓虹');
    expect(result.plan.shots).toHaveLength(2);
    expect(result.usage).toEqual({ promptTokens: 100, completionTokens: 80 });
  });

  it('镜头结构非法 → UPSTREAM_ERROR', async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        version: 1,
        title: '坏分镜',
        aspectRatio: '16:9',
        durationSec: 6,
        shots: [{ index: 0, time: '', shotSize: '', camera: '', visual: '' }],
      })) as typeof fetch;
    await expect(
      generateStoryboardPlan({ apiKey: 'sk-test', instruction: 'x', fetchImpl }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });
});
