import {
  StoryboardExpansionSchema,
  type AgentPlanUsage,
  type LlmConfig,
  type StoryboardExpansion,
  type StoryboardPlan,
  type StoryboardReference,
} from '@astrmira/shared';
import { ProviderFailureError } from '../errors.js';
import {
  extractJsonObject,
  isTimeoutError,
  redactSecrets,
  resolveLlmEndpoint,
} from './llm.js';

/**
 * S8-A2：分镜展开（第二次规划）——把确认过的分镜表转成「每镜生成参数」。
 *
 * 与 `storyboardPlan` 的分工：那边出**给人审的镜头表**，这边出**给画布落地的节点参数**。
 * 本模块只返回结构化 JSON；不创建节点、不写画布、不提交生成（落地由前端显式执行，S8-A2b）。
 */
export interface StoryboardExpandOptions {
  apiKey: string;
  plan: StoryboardPlan;
  references: readonly StoryboardReference[];
  llm?: LlmConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface StoryboardExpandResult {
  plan: StoryboardExpansion;
  model: string;
  usage?: AgentPlanUsage;
}

const DEFAULT_TIMEOUT_MS = 60_000;

const SYSTEM_PROMPT = [
  '你是分镜展开器：把已确认的分镜表逐镜转成可执行的生成参数。只输出一个 JSON 对象。',
  '不要输出 Markdown、代码块、解释或前后缀。结构必须是：',
  '{',
  '  "version": 1,',
  '  "shots": [',
  '    {',
  '      "index": 1,',
  '      "title": "镜头标题（1-60字）",',
  '      "imagePrompt": "可选：需要生成首帧图片时的提示词",',
  '      "videoPrompt": "该镜头的视频生成提示词（含主体/动作/环境/运镜/光线）",',
  '      "aspectRatio": "16:9",',
  '      "resolutionTier": "720p",',
  '      "durationSec": 5,',
  '      "referenceAssetIds": ["可选：用户参考素材 id"],',
  '      "warnings": ["可选，最多4条"]',
  '    }',
  '  ]',
  '}',
  '',
  '硬性约束：',
  '1. shots 与分镜表**同数量、同顺序、同 index**（1 连续递增），一个不漏、一个不加。',
  '2. aspectRatio 只允许 "16:9" / "9:16" / "1:1"；resolutionTier 只允许 "480p" / "720p" / "1080p"。',
  '3. durationSec 为 1-10 的整数；没有素材依据时默认 5。',
  '4. referenceAssetIds **只能**从用户提供的参考素材清单里选，一个不认识都不要写；禁止编造 id。',
  '5. imagePrompt 只在该镜头确实需要生成首帧图时给出（角色/场景需要视觉定妆）；',
  '   用户参考图已能当首帧的镜头不要重复生成。给出的 imagePrompt 要具体到可直接出图。',
  '6. videoPrompt 必须自包含：不写"见上文/同上"，把分镜表的 visual + camera 融进一句完整提示词。',
  '7. 参数缺乏依据时写进该镜的 warnings，不要编造（尤其是参考图与角色一致性）。',
].join('\n');

function usageOf(value: unknown): AgentPlanUsage | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const prompt = (value as { prompt_tokens?: unknown }).prompt_tokens;
  const completion = (value as { completion_tokens?: unknown }).completion_tokens;
  if (!Number.isInteger(prompt) || !Number.isInteger(completion)) return undefined;
  if ((prompt as number) < 0 || (completion as number) < 0) return undefined;
  return { promptTokens: prompt as number, completionTokens: completion as number };
}

/**
 * 结构之外的三道业务校验（schema 管不了的跨字段事实）：
 * 1. 展开结果与分镜表一一对应（同 index 集合）；
 * 2. referenceAssetIds 是请求清单的子集（防编造）；
 * 3. 镜头数不超过会话上限（D75；schema 有 max，这里给更明确的话术）。
 */
export function validateStoryboardExpansion(
  expansion: StoryboardExpansion,
  plan: StoryboardPlan,
  references: readonly StoryboardReference[],
): string | null {
  if (expansion.shots.length !== plan.shots.length) {
    return `展开结果与分镜表镜头数不一致（分镜 ${plan.shots.length} 镜，展开 ${expansion.shots.length} 镜）`;
  }
  const expectedIndexes = plan.shots.map((shot) => shot.index).join(',');
  const actualIndexes = expansion.shots.map((shot) => shot.index).join(',');
  if (expectedIndexes !== actualIndexes) {
    return `展开结果的镜头 index 与分镜表不一一对应（期望 [${expectedIndexes}]，得到 [${actualIndexes}]）`;
  }
  const allowed = new Set(references.map((reference) => reference.assetId));
  for (const shot of expansion.shots) {
    for (const assetId of shot.referenceAssetIds) {
      if (!allowed.has(assetId)) {
        return `镜头 ${shot.index} 引用了不存在的参考素材（${assetId.slice(0, 12)}…）：模型不得编造 id`;
      }
    }
  }
  return null;
}

/** @throws ProviderFailureError */
export async function generateStoryboardExpansion(
  options: StoryboardExpandOptions,
): Promise<StoryboardExpandResult> {
  const { baseUrl, model } = resolveLlmEndpoint(options.llm, '分镜展开');
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const referenceLines =
    options.references.length === 0
      ? '（无参考素材）'
      : options.references
          .map((reference) => `- ${reference.assetId}（${reference.kind}${reference.label === undefined ? '' : `：${reference.label}`}）`)
          .join('\n');
  const userContent = [
    '已确认的分镜表：',
    JSON.stringify(options.plan),
    '',
    '可引用的用户参考素材清单：',
    referenceLines,
    '',
    '请逐镜输出可执行的生成参数。',
  ].join('\n');

  const body = {
    model,
    temperature: 0.3,
    max_tokens: 3000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
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
        `分镜展开请求超时（${timeoutMs}ms 内无响应）：请检查端点地址与网络`,
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new ProviderFailureError(
      'UPSTREAM_ERROR',
      `分镜展开请求失败：${redactSecrets(detail, options.apiKey)}`,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new ProviderFailureError(
      'KEY_INVALID',
      `分镜展开凭据被上游拒绝（HTTP ${response.status}）：请检查 Key 与端点是否匹配`,
    );
  }
  if (!response.ok) {
    const snippet = redactSecrets((await response.text()).slice(0, 300), options.apiKey);
    throw new ProviderFailureError(
      'UPSTREAM_ERROR',
      `分镜展开上游返回 HTTP ${response.status}：${snippet}`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ProviderFailureError('UPSTREAM_ERROR', '分镜展开上游返回的不是 JSON');
  }
  const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> })
    .choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new ProviderFailureError('UPSTREAM_ERROR', '分镜展开上游没有返回文本');
  }
  const json = extractJsonObject(content);
  if (json === null) {
    throw new ProviderFailureError(
      'UPSTREAM_ERROR',
      '分镜展开模型没有返回合法 JSON；请重试或换一个支持 JSON 输出的文本模型',
    );
  }
  const parsed = StoryboardExpansionSchema.safeParse(json);
  if (!parsed.success) {
    throw new ProviderFailureError(
      'UPSTREAM_ERROR',
      '分镜展开模型返回的 JSON 不符合结构（字段/枚举/上限不合法）',
    );
  }
  const structureProblem = validateStoryboardExpansion(parsed.data, options.plan, options.references);
  if (structureProblem !== null) {
    throw new ProviderFailureError('UPSTREAM_ERROR', `分镜展开${structureProblem}`);
  }
  const usage = usageOf((payload as { usage?: unknown }).usage);
  return {
    plan: parsed.data,
    model,
    ...(usage === undefined ? {} : { usage }),
  };
}
