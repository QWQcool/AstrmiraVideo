import type { AgentPlanUsage, CanvasAgentContext, LlmConfig } from '@astrmira/shared';
import { ProviderFailureError } from '../errors.js';
import { isTimeoutError, redactSecrets, resolveLlmEndpoint } from './llm.js';

/**
 * 只读画布 Agent（S7-D1 / CONTRACT §24）。
 *
 * 这里**没有工具循环**：前端把 CanvasDoc 派生出的只读快照发来，模型只回答文本。
 * 因此它无法创建/删除节点，也无法触发 `/api/generate` —— 权限边界由 API 形状保证，
 * 不是靠系统提示词“请求模型不要做”。
 */
export interface CanvasAgentOptions {
  apiKey: string;
  question: string;
  canvas: CanvasAgentContext;
  llm?: LlmConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface CanvasAgentResult {
  answer: string;
  model: string;
  usage?: AgentPlanUsage;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function buildSystemPrompt(): string {
  return [
    '你是只读画布助手。你只能根据用户提供的画布快照回答，不能修改画布。',
    '画布快照包含节点、连线、产物状态；它是某一时刻的副本，不是你操作的目标。',
    '',
    '硬性约束：',
    '1. 不要声称你创建、删除、移动、连接、生成或保存了任何节点/边/媒体；你只能解释和回答。',
    '2. 不要输出 JSON、脚本、HTML、可执行命令或外部 URL。',
    '3. 先给直接结论，再给节点/连线依据；快照没有的信息明确说“当前快照没有”。',
    '4. 如果 truncated=true，必须提醒用户快照不完整，不能假装看过全部节点。',
    '5. 回答使用简体中文，简洁、可读，不使用表格以外的复杂格式。',
  ].join('\n');
}

function usageOf(value: unknown): AgentPlanUsage | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const prompt = (value as { prompt_tokens?: unknown }).prompt_tokens;
  const completion = (value as { completion_tokens?: unknown }).completion_tokens;
  if (!Number.isInteger(prompt) || !Number.isInteger(completion)) return undefined;
  if ((prompt as number) < 0 || (completion as number) < 0) return undefined;
  return {
    promptTokens: prompt as number,
    completionTokens: completion as number,
  };
}

/** @throws ProviderFailureError（`LLM_NOT_CONFIGURED` / `KEY_INVALID` / `UPSTREAM_ERROR`） */
export async function askCanvasWithLlm(options: CanvasAgentOptions): Promise<CanvasAgentResult> {
  const { baseUrl, model } = resolveLlmEndpoint(options.llm, '画布助手');
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const body = {
    model,
    temperature: 0.2,
    max_tokens: 1200,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      {
        role: 'user',
        content: [
          '画布快照（只读，不能修改）：',
          JSON.stringify(options.canvas),
          '',
          `问题：${options.question}`,
        ].join('\n'),
      },
    ],
  };

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new ProviderFailureError(
        'UPSTREAM_ERROR',
        `画布助手请求超时（${timeoutMs}ms 内无响应）：请检查端点地址与网络`,
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new ProviderFailureError(
      'UPSTREAM_ERROR',
      `画布助手请求失败：${redactSecrets(detail, options.apiKey)}`,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new ProviderFailureError(
      'KEY_INVALID',
      `画布助手凭据被上游拒绝（HTTP ${response.status}）：请检查 Key 与端点是否匹配`,
    );
  }

  if (!response.ok) {
    const snippet = redactSecrets((await response.text()).slice(0, 300), options.apiKey);
    throw new ProviderFailureError(
      'UPSTREAM_ERROR',
      `画布助手上游返回 HTTP ${response.status}：${snippet}`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ProviderFailureError('UPSTREAM_ERROR', '画布助手上游返回的不是 JSON');
  }

  const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> })
    .choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new ProviderFailureError('UPSTREAM_ERROR', '画布助手上游没有返回文本回答');
  }
  if (content.length > 8000) {
    throw new ProviderFailureError('UPSTREAM_ERROR', '画布助手回答超过长度上限');
  }

  const usage = usageOf((payload as { usage?: unknown }).usage);
  return {
    answer: content.trim(),
    model,
    ...(usage === undefined ? {} : { usage }),
  };
}
