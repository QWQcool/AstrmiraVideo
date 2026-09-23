import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import { RECIPE_CARDS } from '@astrmira/shared';
import { enhancePromptWithLlm, type EnhancePromptOptions } from '../providers/llm.js';
import { createEnhanceRoutes } from './enhance.js';

/**
 * 配方作为扩写上下文（V9 · B8 / Step 6-AC5 的后半句）：
 * "带 `recipeId` 的扩写请求在服务端 system prompt 中包含该配方要点"。
 *
 * 两层各钉一次，缺一不可：
 * 1. **路由层**：`recipeId` → 卡片（命中传下去、未知 400）—— 用注入的执行者桩观察它收到了什么；
 * 2. **执行层**：卡片 → system prompt 的文本（直接看**发往上游的请求体**，不看我们的中间变量）。
 */

interface CapturedOptions {
  recipe?: { id: string; skeleton: string };
}

async function buildProbeApp(captured: CapturedOptions[]) {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(
    createEnhanceRoutes({
      enhance: async (options) => {
        captured.push(options as CapturedOptions);
        return { enhancedPrompt: '扩写后的提示词', engine: 'llm' };
      },
    }),
  );
  await app.ready();
  return app;
}

const HEADERS = { 'x-llm-key': 'sk-test-llm' };

describe('POST /api/prompt/enhance · recipeId 分支（AC5）', () => {
  it('命中配方：把整张卡交给执行者（不是只传 id）', async () => {
    const captured: CapturedOptions[] = [];
    const app = await buildProbeApp(captured);
    const card = RECIPE_CARDS[0];

    const response = await app.inject({
      method: 'POST',
      url: '/api/prompt/enhance',
      headers: HEADERS,
      payload: { originalPrompt: '一只猫在窗台', recipeId: card?.id },
    });

    expect(response.statusCode).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.recipe?.id).toBe(card?.id);
    // 逐字：执行者拿到的是数据里的原文，没有被路由层加工过
    expect(captured[0]?.recipe?.skeleton).toBe(card?.skeleton);

    await app.close();
  });

  it('未知配方 id → 400 PROMPT_REJECTED（不静默按普通扩写跑）', async () => {
    const captured: CapturedOptions[] = [];
    const app = await buildProbeApp(captured);

    const response = await app.inject({
      method: 'POST',
      url: '/api/prompt/enhance',
      headers: HEADERS,
      payload: { originalPrompt: '一只猫在窗台', recipeId: 'no-such-recipe' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { code: string; message: string; disposition: string };
    expect(body.code).toBe('PROMPT_REJECTED');
    expect(body.disposition).toBe('terminal');
    expect(body.message).toContain('no-such-recipe');
    // 关键：**没有**调用上游
    expect(captured).toHaveLength(0);

    await app.close();
  });

  it('不带 recipeId 时执行者收到的 recipe 为空（普通扩写不受影响）', async () => {
    const captured: CapturedOptions[] = [];
    const app = await buildProbeApp(captured);

    await app.inject({
      method: 'POST',
      url: '/api/prompt/enhance',
      headers: HEADERS,
      payload: { originalPrompt: '一只猫在窗台' },
    });

    expect(captured[0]?.recipe).toBeUndefined();
    await app.close();
  });
});

/** 发往上游的请求体（只取我们要断言的部分） */
interface CapturedBody {
  messages: Array<{ role: string; content: string }>;
}

describe('system prompt 注入（AC5 的"服务端注入要点"）', () => {
  async function captureRequestBody(options: Partial<EnhancePromptOptions>): Promise<{
    system: string;
    user: string;
  }> {
    // 用**容器对象**而不是裸 `let body`：TS 不会把闭包内的赋值算进控制流分析，
    // 于是 `let` 版本在闭包外会被窄化成 null（进而 never）。属性访问没有这个坑。
    const captured: { body: CapturedBody | null } = { body: null };

    await enhancePromptWithLlm({
      apiKey: 'sk-test-llm',
      originalPrompt: '一只猫在窗台',
      ...options,
      fetchImpl: async (_url, init) => {
        captured.body = JSON.parse(String(init?.body)) as CapturedBody;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: '{"enhancedPrompt":"扩写结果"}' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });

    const messages: CapturedBody['messages'] = captured.body?.messages ?? [];
    return {
      system: messages.find((message) => message.role === 'system')?.content ?? '',
      user: messages.find((message) => message.role === 'user')?.content ?? '',
    };
  }

  it('带配方时：system prompt 含骨架与每一条已知坑，用户原文原样作为 user message', async () => {
    const card = RECIPE_CARDS.find((item) => (item.pitfalls ?? []).length > 0);
    expect(card).toBeDefined();

    const { system, user } = await captureRequestBody(card === undefined ? {} : { recipe: card });

    expect(system).toContain(card?.skeleton ?? '<never>');
    expect(system).toContain(card?.title ?? '<never>');
    for (const pitfall of card?.pitfalls ?? []) {
      expect(system).toContain(pitfall);
    }
    // 配方只影响 system：用户写的那句话必须原样发出（不被配方覆盖）
    expect(user).toBe('一只猫在窗台');
  });

  it('不带配方时：system prompt 里不出现配方段落（不无中生有）', async () => {
    const { system } = await captureRequestBody({});
    expect(system).not.toContain('用户选用了配方');
  });
});
