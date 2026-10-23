import {
  StoryboardPlanSchema,
  type AgentPlanUsage,
  type CanvasAgentContext,
  type LlmConfig,
  type StoryboardPlan,
} from '@astrmira/shared';
import { ProviderFailureError } from '../errors.js';
import {
  extractJsonObject,
  isTimeoutError,
  redactSecrets,
  resolveLlmEndpoint,
} from './llm.js';

/**
 * P5：分镜计划生成器。
 *
 * 只返回结构化镜头表，不创建节点、不提交生成、不调用工具。
 * 画布上下文可选；有则用来避免镜头与已有素材冲突，没有也能生成。
 */
export interface StoryboardPlanOptions {
  apiKey: string;
  instruction: string;
  canvas?: CanvasAgentContext;
  llm?: LlmConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface StoryboardPlanResult {
  plan: StoryboardPlan;
  model: string;
  usage?: AgentPlanUsage;
}

const DEFAULT_TIMEOUT_MS = 30_000;

const SYSTEM_PROMPT = [
  '你是视频分镜计划生成器。用户要一份可审阅的分镜表，你只输出一个 JSON 对象。',
  '不要输出 Markdown、代码块、解释或前后缀。结构必须是：',
  '{',
  '  "version": 1,',
  '  "title": "分镜标题（1-120字）",',
  '  "aspectRatio": "16:9",',
  '  "durationSec": 15,',
  '  "shots": [',
  '    {',
  '      "index": 1,',
  '      "time": "0-3s",',
  '      "shotSize": "中景",',
  '      "camera": "缓慢推近",',
  '      "visual": "画面内容",',
  '      "transition": "可选：切/叠化/匹配剪辑",',
  '      "audio": "可选：旁白/音乐/音效提示"',
  '    }',
  '  ],',
  '  "openQuestions": ["可选，最多8条"],',
  '  "warnings": ["可选，最多8条"]',
  '}',
  '',
  '硬性约束：',
  '1. 只规划分镜，不创建节点、不提交生成、不声称已经执行。',
  '2. shot.index 从 1 连续递增；time 用秒或时间区间。',
  '3. 不编造具体素材 id、模型 id、价格或平台能力。',
  '4. 信息不足时写入 openQuestions/warnings，不要编造。',
  '5. 总时长与 shots 的时间范围要自洽；不确定就写待确认。',
].join('\n');

function usageOf(value: unknown): AgentPlanUsage | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const prompt = (value as { prompt_tokens?: unknown }).prompt_tokens;
  const completion = (value as { completion_tokens?: unknown }).completion_tokens;
  if (!Number.isInteger(prompt) || !Number.isInteger(completion)) return undefined;
  if ((prompt as number) < 0 || (completion as number) < 0) return undefined;
  return { promptTokens: prompt as number, completionTokens: completion as number };
}

/** @throws ProviderFailureError */
export async function generateStoryboardPlan(
  options: StoryboardPlanOptions,
): Promise<StoryboardPlanResult> {
  const { baseUrl, model } = resolveLlmEndpoint(options.llm, '分镜计划');
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const context = options.canvas === undefined ? '' : `\n\n画布上下文（只读）：\n${JSON.stringify(options.canvas)}`;
  const body = {
    model,
    temperature: 0.4,
    max_tokens: 1800,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `分镜要求：${options.instruction}${context}` },
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
        `分镜计划请求超时（${timeoutMs}ms 内无响应）：请检查端点地址与网络`,
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new ProviderFailureError(
      'UPSTREAM_ERROR',
      `分镜计划请求失败：${redactSecrets(detail, options.apiKey)}`,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new ProviderFailureError(
      'KEY_INVALID',
      `分镜计划凭据被上游拒绝（HTTP ${response.status}）：请检查 Key 与端点是否匹配`,
    );
  }
  if (!response.ok) {
    const snippet = redactSecrets((await response.text()).slice(0, 300), options.apiKey);
    throw new ProviderFailureError(
      'UPSTREAM_ERROR',
      `分镜计划上游返回 HTTP ${response.status}：${snippet}`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ProviderFailureError('UPSTREAM_ERROR', '分镜计划上游返回的不是 JSON');
  }
  const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> })
    .choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new ProviderFailureError('UPSTREAM_ERROR', '分镜计划上游没有返回文本');
  }
  const json = extractJsonObject(content);
  if (json === null) {
    throw new ProviderFailureError(
      'UPSTREAM_ERROR',
      '分镜计划模型没有返回合法 JSON；请重试或换一个支持 JSON 输出的文本模型',
    );
  }
  const parsed = StoryboardPlanSchema.safeParse(json);
  if (!parsed.success) {
    throw new ProviderFailureError(
      'UPSTREAM_ERROR',
      '分镜计划模型返回的 JSON 不符合结构（镜头/时长/字段不合法）',
    );
  }
  const usage = usageOf((payload as { usage?: unknown }).usage);
  return {
    plan: parsed.data,
    model,
    ...(usage === undefined ? {} : { usage }),
  };
}
