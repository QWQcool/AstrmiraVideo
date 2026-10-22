import {
  CanvasTextNodeUpdateProposalSchema,
  type AgentPlanUsage,
  type CanvasAgentContext,
  type CanvasTextNodeUpdateProposal,
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
 * S7-D5：为**当前选中的文本节点**生成一份待确认的更新方案。
 *
 * 目标节点由前端指定；服务端只读快照并返回 diff 数据，不写 CanvasDoc。
 * 模型必须原样返回 targetNodeId；否则拒答，避免“改错节点”。
 */
export interface CanvasNodeUpdateProposalOptions {
  apiKey: string;
  instruction: string;
  canvas: CanvasAgentContext;
  targetNodeId: string;
  llm?: LlmConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface CanvasNodeUpdateProposalResult {
  proposal: CanvasTextNodeUpdateProposal;
  model: string;
  usage?: AgentPlanUsage;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function buildSystemPrompt(target: {
  id: string;
  title: string;
  prompt: string;
}): string {
  return [
    '你是画布文本节点更新方案生成器。用户要修改一个已存在的文本节点，你只输出待确认方案。',
    '只输出一个 JSON 对象，不要 Markdown、代码块、解释或前后缀。结构必须是：',
    '{',
    '  "version": 1,',
    '  "action": "update-text-node",',
    `  "targetNodeId": ${JSON.stringify(target.id)},`,
    '  "title": "更新后的标题（1-80 字）",',
    '  "content": "更新后的正文（1-4000 字）",',
    '  "reason": "可选，为什么这样改",',
    '  "warnings": ["可选，最多 5 条"]',
    '}',
    '',
    '硬性约束：',
    '1. 只能更新 targetNodeId 指定的这一个文本节点；不得改目标、不得新增/删除/连线/生成。',
    '2. 不要声称已经修改、已经保存或已经执行；你只是在提议。',
    '3. 不要输出脚本、HTML、任意 URL 或凭据。',
    '4. 保留原节点中用户没有要求改变的有效信息，不要无故删减。',
    '5. 信息不足时写入 warnings，不要编造批次、产物或素材 id。',
    '',
    `当前目标节点：id=${target.id}，title=${JSON.stringify(target.title)}，content=${JSON.stringify(target.prompt)}`,
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
export async function proposeCanvasTextNodeUpdate(
  options: CanvasNodeUpdateProposalOptions,
): Promise<CanvasNodeUpdateProposalResult> {
  const target = options.canvas.nodes.find((node) => node.id === options.targetNodeId);
  if (target === undefined || target.type !== 'text') {
    throw new ProviderFailureError('INVALID_REQUEST', '只能更新当前画布中已选中的文本节点');
  }

  const { baseUrl, model } = resolveLlmEndpoint(options.llm, '画布节点更新方案');
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const body = {
    model,
    temperature: 0.2,
    max_tokens: 900,
    messages: [
      { role: 'system', content: buildSystemPrompt(target) },
      {
        role: 'user',
        content: [
          '画布快照（只读；不要尝试修改）：',
          JSON.stringify(options.canvas),
          '',
          `更新要求：${options.instruction}`,
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
        `画布节点更新方案请求超时（${timeoutMs}ms 内无响应）：请检查端点地址与网络`,
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new ProviderFailureError(
      'UPSTREAM_ERROR',
      `画布节点更新方案请求失败：${redactSecrets(detail, options.apiKey)}`,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new ProviderFailureError(
      'KEY_INVALID',
      `画布节点更新方案凭据被上游拒绝（HTTP ${response.status}）：请检查 Key 与端点是否匹配`,
    );
  }

  if (!response.ok) {
    const snippet = redactSecrets((await response.text()).slice(0, 300), options.apiKey);
    throw new ProviderFailureError(
      'UPSTREAM_ERROR',
      `画布节点更新方案上游返回 HTTP ${response.status}：${snippet}`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ProviderFailureError('UPSTREAM_ERROR', '画布节点更新方案上游返回的不是 JSON');
  }

  const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> })
    .choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new ProviderFailureError('UPSTREAM_ERROR', '画布节点更新方案上游没有返回文本');
  }
  const json = extractJsonObject(content);
  if (json === null) {
    throw new ProviderFailureError(
      'UPSTREAM_ERROR',
      '画布节点更新方案模型没有返回合法 JSON；请重试或换一个支持 JSON 输出的文本模型',
    );
  }
  const parsed = CanvasTextNodeUpdateProposalSchema.safeParse(json);
  if (!parsed.success) {
    throw new ProviderFailureError(
      'UPSTREAM_ERROR',
      '画布节点更新方案模型返回的 JSON 不符合结构（目标/标题/正文不合法）',
    );
  }
  if (parsed.data.targetNodeId !== target.id) {
    throw new ProviderFailureError(
      'UPSTREAM_ERROR',
      '画布节点更新方案返回了不同的目标节点，已拒绝',
    );
  }

  const usage = usageOf((payload as { usage?: unknown }).usage);
  return {
    proposal: parsed.data,
    model,
    ...(usage === undefined ? {} : { usage }),
  };
}
