import {
  AgentPlanSchema,
  agentSkillCandidateText,
  retrieveSkillsForIntent,
  validateAgentPlan,
} from '@astrmira/shared';
import type {
  AgentPlan,
  AgentPlanUsage,
  LlmConfig,
  SkillManifest,
} from '@astrmira/shared';
import { ProviderFailureError } from '../errors.js';
import {
  extractJsonObject,
  isTimeoutError,
  redactSecrets,
  resolveLlmEndpoint,
} from './llm.js';

/**
 * Agent 规划（S6-B1 / CONTRACT §23）。
 *
 * 和提示词扩写共用同一条 OpenAI 兼容文本轨，但**输出契约不同**：
 * - 这里必须输出 `AgentPlanSchema` 的结构，解析失败/能力校验失败就报错，不“降级成一段建议”；
 * - 计划只引用技能 id 与 `asset:/task:`，不执行脚本、不访问任意 URL；
 * - 本模块**不**调用 `/api/generate`，也不创建任务。
 *
 * 文本调用没有持久副作用，超时归 `UPSTREAM_ERROR`（D28），不是 uncertain。
 */

export interface AgentPlanOptions {
  apiKey: string;
  intent: string;
  /** 完整 catalog（内置 + 请求带来的自建），用于校验，不只用于 prompt */
  skills: readonly SkillManifest[];
  llm?: LlmConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface AgentPlanResult {
  plan: AgentPlan;
  model: string;
  usage?: AgentPlanUsage;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_CANDIDATES = 10;

function buildSystemPrompt(intent: string, skills: readonly SkillManifest[]): string {
  const candidates = retrieveSkillsForIntent(intent, skills, MAX_CANDIDATES);
  return [
    '你是创作 Agent 的规划器。把用户意图变成一份可审阅的计划，交给产品界面执行。',
    '',
    '只输出一个 JSON 对象，不要 Markdown、代码块、解释或前后缀。结构必须是：',
    '{',
    '  "version": 1,',
    '  "intent": "复述用户意图",',
    '  "summary": "一句话说明计划",',
    '  "steps": [',
    '    {"kind":"apply-skill","skillId":"...","prompt":"可选补充","params":{"aspectRatio":"16:9","resolutionTier":"720p","durationSec":5},"reason":"为什么"}',
    '  ],',
    '  "assumptions": ["..."],',
    '  "warnings": ["..."]',
    '}',
    '',
    '硬性约束：',
    '1. steps 最多 8 个，至少 1 个；不要输出任何脚本、命令、URL、HTML、函数名。',
    '2. apply-skill 的 skillId 必须来自下面候选清单；不要编造 id。',
    '3. 只允许这四种 step：apply-skill / add-reference / set-params / note。',
    '4. add-reference 的 ref 只能是 asset:<id> 或 task:<id>；role 只能是 firstFrame / lastFrame / referenceImage / referenceVideo / audio。',
    '5. 需要参考图的技能，必须先有对应的 add-reference 图片步骤；否则不要选它。',
    '6. 你只做计划，不提交图片/视频任务；不要声称已经生成。',
    '7. 没有把握就写进 assumptions/warnings，不要编造素材 id 或模型能力。',
    '',
    '候选技能（只能从这里选）：',
    ...candidates.map(agentSkillCandidateText),
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

/**
 * 调一次规划模型并做结构 + 能力校验。
 * @throws ProviderFailureError（`LLM_NOT_CONFIGURED` / `KEY_INVALID` / `INVALID_REQUEST` / `UPSTREAM_ERROR`）
 */
export async function planWithLlm(options: AgentPlanOptions): Promise<AgentPlanResult> {
  const { baseUrl, model } = resolveLlmEndpoint(options.llm, 'Agent 规划');
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const body = {
    model,
    temperature: 0.2,
    max_tokens: 1400,
    messages: [
      { role: 'system', content: buildSystemPrompt(options.intent, options.skills) },
      { role: 'user', content: options.intent },
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
        `Agent 规划请求超时（${timeoutMs}ms 内无响应）：请检查端点地址与网络`,
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new ProviderFailureError(
      'UPSTREAM_ERROR',
      `Agent 规划请求失败：${redactSecrets(detail, options.apiKey)}`,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new ProviderFailureError(
      'KEY_INVALID',
      `Agent 规划凭据被上游拒绝（HTTP ${response.status}）：请检查 Key 与端点是否匹配`,
    );
  }

  if (!response.ok) {
    const snippet = redactSecrets((await response.text()).slice(0, 300), options.apiKey);
    throw new ProviderFailureError(
      'UPSTREAM_ERROR',
      `Agent 规划上游返回 HTTP ${response.status}：${snippet}`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ProviderFailureError('UPSTREAM_ERROR', 'Agent 规划上游返回的不是 JSON');
  }

  const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> })
    .choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new ProviderFailureError('UPSTREAM_ERROR', 'Agent 规划上游没有返回 message.content');
  }

  const json = extractJsonObject(content);
  if (json === null) {
    throw new ProviderFailureError(
      'UPSTREAM_ERROR',
      'Agent 规划模型没有返回合法 JSON；请重试，或换一个支持 JSON 输出的文本模型',
    );
  }

  const parsed = AgentPlanSchema.safeParse(json);
  if (!parsed.success) {
    // 不回显模型原文：它可能包含提示词/内部指令；只给结构问题的稳定描述。
    throw new ProviderFailureError(
      'UPSTREAM_ERROR',
      'Agent 规划模型返回的 JSON 不符合计划结构（步骤/字段/长度不合法）',
    );
  }

  const validation = validateAgentPlan(parsed.data, options.skills);
  if (!validation.ok) {
    throw new ProviderFailureError(
      'INVALID_REQUEST',
      `Agent 计划未通过能力校验：${validation.issues.join('；')}`,
    );
  }

  const usage = usageOf((payload as { usage?: unknown }).usage);
  return {
    plan: parsed.data,
    model,
    ...(usage === undefined ? {} : { usage }),
  };
}
