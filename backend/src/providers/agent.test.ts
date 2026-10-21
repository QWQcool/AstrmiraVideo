import { describe, expect, it } from 'vitest';
import {
  BUILTIN_SKILLS,
  SkillManifestSchema,
  type SkillManifest,
} from '@astrmira/shared';
import { planWithLlm } from './agent.js';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function planContent(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    intent: '雨夜镜头',
    summary: '应用镜头技能',
    steps: [{ kind: 'apply-skill', skillId: 'camera-push-in-slow' }],
    assumptions: [],
    warnings: [],
    ...overrides,
  });
}

function customSkill(overrides: Record<string, unknown> = {}): SkillManifest {
  return SkillManifestSchema.parse({
    version: 1,
    id: 'user-provider-test',
    name: 'Provider 测试',
    summary: '测试',
    category: 'mood',
    origin: 'user',
    triggers: ['测试'],
    prompt: '测试提示词',
    params: {},
    modes: ['t2v'],
    requiresImage: false,
    notes: [],
    ...overrides,
  });
}

describe('S6-B1 · planWithLlm', () => {
  it('调用 OpenAI 兼容 /chat/completions，解析计划并保留 usage', async () => {
    let seenUrl = '';
    let seenBody: unknown;
    let seenAuth = '';
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = String(input);
      seenAuth = new Headers(init?.headers).get('authorization') ?? '';
      seenBody = JSON.parse(String(init?.body ?? '{}'));
      return jsonResponse({
        choices: [{ message: { content: planContent() } }],
        usage: { prompt_tokens: 100, completion_tokens: 30 },
      });
    }) as typeof fetch;

    const result = await planWithLlm({
      apiKey: 'sk-test',
      intent: '雨夜镜头',
      skills: BUILTIN_SKILLS,
      llm: { baseUrl: 'https://llm.example/v1', model: 'deepseek-chat' },
      fetchImpl,
    });

    expect(seenUrl).toBe('https://llm.example/v1/chat/completions');
    expect(seenAuth).toBe('Bearer sk-test');
    expect(seenBody).toMatchObject({ model: 'deepseek-chat', temperature: 0.2 });
    expect(JSON.stringify(seenBody)).toContain('camera-push-in-slow');
    expect(result.model).toBe('deepseek-chat');
    expect(result.usage).toEqual({ promptTokens: 100, completionTokens: 30 });
    expect(result.plan.steps[0]).toMatchObject({ kind: 'apply-skill' });
  });

  it('非 JSON / 不符合 schema 的计划 → 502 UPSTREAM_ERROR', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ choices: [{ message: { content: '不是 JSON' } }] })) as typeof fetch;
    await expect(
      planWithLlm({
        apiKey: 'sk-test',
        intent: '测试',
        skills: BUILTIN_SKILLS,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });

    const badSchema = (async () =>
      jsonResponse({
        choices: [
          { message: { content: planContent({ steps: [{ kind: 'apply-skill', skillId: 'nope' }] }) } },
        ],
      })) as typeof fetch;
    await expect(
      planWithLlm({
        apiKey: 'sk-test',
        intent: '测试',
        skills: BUILTIN_SKILLS,
        fetchImpl: badSchema,
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });

  it('未知技能/无可用模式 → 400 INVALID_REQUEST', async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: planContent({
                steps: [{ kind: 'apply-skill', skillId: 'missing-skill' }],
              }),
            },
          },
        ],
      })) as typeof fetch;

    await expect(
      planWithLlm({
        apiKey: 'sk-test',
        intent: '测试',
        skills: BUILTIN_SKILLS,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('需要参考图但没有图片引用 → 400', async () => {
    const imageSkill = customSkill({ id: 'user-image-only', modes: ['i2v'], requiresImage: true });
    const fetchImpl = (async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: planContent({
                steps: [{ kind: 'apply-skill', skillId: imageSkill.id }],
              }),
            },
          },
        ],
      })) as typeof fetch;

    await expect(
      planWithLlm({
        apiKey: 'sk-test',
        intent: '测试',
        skills: [imageSkill],
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('401/403 → KEY_INVALID', async () => {
    const fetchImpl = (async () => jsonResponse({ error: 'bad key' }, 401)) as typeof fetch;
    await expect(
      planWithLlm({
        apiKey: 'sk-test',
        intent: '测试',
        skills: BUILTIN_SKILLS,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'KEY_INVALID' });
  });

  it('超 8 步 / 旧 plan version → 502，不执行半份计划', async () => {
    const tooMany = (async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: planContent({
                steps: Array.from({ length: 9 }, () => ({ kind: 'note', text: 'x' })),
              }),
            },
          },
        ],
      })) as typeof fetch;
    await expect(
      planWithLlm({
        apiKey: 'sk-test',
        intent: '测试',
        skills: BUILTIN_SKILLS,
        fetchImpl: tooMany,
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });

    const oldVersion = (async () =>
      jsonResponse({
        choices: [{ message: { content: planContent({ version: 2 }) } }],
      })) as typeof fetch;
    await expect(
      planWithLlm({
        apiKey: 'sk-test',
        intent: '测试',
        skills: BUILTIN_SKILLS,
        fetchImpl: oldVersion,
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });
});
