import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TaskProgress, VideoGenerateRequest, VideoProvider } from '@astrmira/shared';
import { buildApp } from '../index.js';
import { __clearProviderTestOverrides, __setProviderForTesting } from '../providers/registry.js';
import { MAX_PROMPT_CHARS } from './generate.js';

/**
 * 提示词校验（V8.3 批次 3）：给 `PROMPT_REJECTED` 一个**真实产生点**。
 *
 * 为什么值得单独测：本仓库的核对发现这个错误码此前**只在字典里存在** ——
 * 契约写了"提示词为空 / 超长"会归它，但没有任何代码抛过它。
 * 契约与实现之间这种"纸面承诺"是最容易骗过自己的东西，所以补上产生点并用例钉住。
 */

const TMP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-prompt-data-'));
const TMP_OUTPUTS_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-prompt-out-'));

class NeverCalledProvider implements VideoProvider {
  readonly id = 'fixture-local' as const;
  readonly name = 'prompt-guard-stub';
  submitCalls = 0;

  async checkHealth(): Promise<{ available: boolean }> {
    return { available: true };
  }

  async submit(): Promise<{ taskId: string }> {
    this.submitCalls += 1;
    return { taskId: 'should-not-happen' };
  }

  async queryStatus(taskId: string): Promise<TaskProgress> {
    return {
      taskId,
      status: 'succeeded',
      progressPercent: 100,
      requestSnapshot: { prompt: 'x', mode: 't2v', aspectRatio: '16:9', provider: 'fixture-local' },
    };
  }

  async cancel(): Promise<boolean> {
    return false;
  }
}

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let provider: NeverCalledProvider;

async function submit(
  prompt: string,
  remoteAddress: string,
  idempotencyKey: string,
): Promise<{ statusCode: number; body: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/generate',
    remoteAddress,
    headers: { 'idempotency-key': idempotencyKey },
    payload: {
      prompt,
      mode: 't2v',
      aspectRatio: '16:9',
      provider: 'fixture-local',
    } satisfies VideoGenerateRequest,
  });

  return { statusCode: response.statusCode, body: response.body };
}

beforeAll(async () => {
  process.env.DATA_DIR = TMP_DATA_DIR;
  process.env.OUTPUT_DIR = TMP_OUTPUTS_DIR;

  provider = new NeverCalledProvider();
  __setProviderForTesting('fixture-local', provider);
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  __clearProviderTestOverrides();
  for (const dir of [TMP_DATA_DIR, TMP_OUTPUTS_DIR]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* 临时目录残留无碍 */
    }
  }
});

describe('POST /api/generate · 提示词校验（PROMPT_REJECTED）', () => {
  it('空提示词（含纯空白）→ 400 PROMPT_REJECTED（terminal），且不触达上游', async () => {
    for (const [index, prompt] of ['', '   ', '\n\t '].entries()) {
      const response = await submit(prompt, `198.51.100.8${index}`, `prompt-empty-${index}`);

      expect(response.statusCode, response.body).toBe(400);

      const body = JSON.parse(response.body) as { code: string; disposition: string };
      expect(body.code).toBe('PROMPT_REJECTED');
      expect(body.disposition).toBe('terminal');
    }

    expect(provider.submitCalls).toBe(0);
  });

  it('超过上限的提示词 → 400 PROMPT_REJECTED，且错误信息带上实际长度', async () => {
    const tooLong = '雨'.repeat(MAX_PROMPT_CHARS + 1);
    const response = await submit(tooLong, '198.51.100.90', 'prompt-too-long');

    expect(response.statusCode, response.body).toBe(400);

    const body = JSON.parse(response.body) as { code: string; message: string };
    expect(body.code).toBe('PROMPT_REJECTED');
    expect(body.message).toContain(String(MAX_PROMPT_CHARS));
    expect(body.message).toContain(String(MAX_PROMPT_CHARS + 1));
    expect(provider.submitCalls).toBe(0);
  });

  it('刚好到上限的提示词可以正常提交（边界不是"少一个字符都不行"）', async () => {
    const atLimit = '雨'.repeat(MAX_PROMPT_CHARS);
    const response = await submit(atLimit, '198.51.100.91', 'prompt-at-limit');

    expect(response.statusCode, response.body).toBe(200);
    // 200 只代表入队成功：真正触达 provider 要等调度器下一个 tick（~200ms），所以用轮询式断言
    await expect
      .poll(() => provider.submitCalls, { timeout: 5_000, interval: 100 })
      .toBe(1);
  });
});
