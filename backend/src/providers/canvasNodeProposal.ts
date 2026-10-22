import {
  CanvasNodeProposalSchema,
  type AgentPlanUsage,
  type CanvasAgentContext,
  type CanvasNodeProposal,
  type LlmConfig,
} from '@astrmira/shared';
import { ProviderFailureError } from '../errors.js';
import {
  extractJsonObject,
  isTimeoutError,
  redactSecrets,
  resolveLlmEndpoint,
} from './llm.js';

/**
 * S7-D2：把用户指令变成**一张待确认的文本节点方案**。
 *
 * 这里只返回 `CanvasNodeProposal`，不写 CanvasDoc、不建任务、不生成媒体；
 * 用户在前端确认后，才由前端调用 `createCanvasNode` 落节点。
 */
export interface CanvasNodeProposalOptions {
  apiKey: string;
  instruction: string;
  canvas: CanvasAgentContext;
  llm?: LlmConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface CanvasNodeProposalResult {
  proposal: CanvasNodeProposal;
  model: string;
  usage?: AgentPlanUsage;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function buildSystemPrompt(): string {
  return [
    '你是画布节点方案生成器。用户要创建一个文本节点，你只输出一份待确认的方案。',
    '只输出一个 JSON 对象，不要 Markdown、代码块、解释或前后缀。结构必须是：',
    '{',
    '  "version": 1,',
    '  "action": "create-text-node",',
    '  "title": "节点标题（1-80 字）",',
    '  "content": "节点正文（1-4000 字）",',
    '  "reason": "可选，为什么这样写",',
    '  "warnings": ["可选，最多 5 条"]',
    '}',
    '',
    '硬性约束：',
    '1. 只能创建一个文本节点；不要输出删除、连线、图片/视频生成或任何其他操作。',
    '2. 不要声称已经创建、已经保存或已经生成；你只是在提议。',
    '3. 不要输出脚本、HTML、任意 URL 或凭据。',
    '4. 标题和正文使用简体中文，正文保持可读的单行/短段落，不要复述整个画布。',
    '5. 信息不足时写入 warnings，不要编造素材、节点 id 或生成能力。',
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

/** @throws ProviderFailureError */
export async function proposeCanvasTextNode(
  options: CanvasNodeProposalOptions,
): Promise<CanvasNodeProposalResult> {
  const { baseUrl, model } = resolveLlmEndpoint(options.llm, '画布节点方案');
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const body = {
    model,
    temperature: 0.3,
    max_tokens: 900,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      {
        role: 'user',
        content: [
          '画布快照（只读；不要尝试修改）：',
          JSON.stringify(options.canvas),
          '',
          `创建文本节点的要求：${options.instruction}`,
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
        `画布节点方案请求超时（${timeoutMs}ms 内无响应）：请检查端点地址与网络`,
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new ProviderFailureError(
      'UPSTREAM_ERROR',
      `画布节点方案请求失败：${redactSecrets(detail, options.apiKey)}`,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new ProviderFailureError(
      'KEY_INVALID',
      `画布节点方案凭据被上游拒绝（HTTP ${response.status}）：请检查 Key 与端点是否匹配`,
    );
  }

  if (!response.ok) {
    const snippet = redactSecrets((await response.text()).slice(0, 300), options.apiKey);
    throw new ProviderFailureError(
      'UPSTREAM_ERROR',
      `画布节点方案上游返回 HTTP ${response.status}：${snippet}`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ProviderFailureError('UPSTREAM_ERROR', '画布节点方案上游返回的不是 JSON');
  }

  const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> })
    .choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new ProviderFailureError('UPSTREAM_ERROR', '画布节点方案上游没有返回文本');
  }
  const json = extractJsonObject(content);
  if (json === null) {
    throw new ProviderFailureError(
      'UPSTREAM_ERROR',
      '画布节点方案模型没有返回合法 JSON；请重试或换一个支持 JSON 输出的文本模型',
    );
  }
  const parsed = CanvasNodeProposalSchema.safeParse(json);
  if (!parsed.success) {
    throw new ProviderFailureError(
      'UPSTREAM_ERROR',
      '画布节点方案模型返回的 JSON 不符合结构（标题/正文/操作类型不合法）',
    );
  }
  const usage = usageOf((payload as { usage?: unknown }).usage);
  return {
    proposal: parsed.data,
    model,
    ...(usage === undefined ? {} : { usage }),
  };
}
