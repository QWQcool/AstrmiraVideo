import {
  LLM_CUSTOM_PRESET_ID,
  LLM_PRESETS,
  RECIPE_CATEGORY_PROMPT_WORDS,
  findLlmPreset,
} from '@astrmira/shared';
import type {
  GenerationMode,
  LlmConfig,
  PromptEnhanceStyle,
  RecipeCard,
} from '@astrmira/shared';
import { ProviderFailureError } from '../errors.js';
import { redactSecrets } from '../security/redact.js';

/**
 * 文本轨：**单一 OpenAI 兼容实现**（PLAN §6-D24）。
 *
 * 为什么视频侧用适配器、文本侧只有一份实现：不存在"OpenAI 兼容的视频生成标准"
 * （每家请求体、轮询、结果字段都不同，强行统一会造出伪抽象），而文本侧的
 * `POST {baseUrl}/chat/completions` 已经事实上收敛成同一形状。一份实现覆盖所有家。
 *
 * ## 三条纪律
 * 1. **纯 BYOK**：Key 只来自调用方（`X-LLM-Key`），本模块**不读任何 env 兜底**
 *    —— 这与视频轨的 B 方案口径一致：不替用户假装"服务端有 Key"；
 * 2. **禁止静默降级**：模型没按 JSON 回答时，**照实说是纯文本**（`notice`），
 *    绝不用规则引擎拼一段"看起来像扩写"的文案冒充 LLM（PLAN §3 铁律 4）；
 * 3. **错误消息不含凭据**：上游的错误体可能回显 Key（`Invalid API key: sk-…`），
 *    因此任何进入 message 的上游文本都要先过 `redactSecrets`。
 */

export interface EnhancePromptOptions {
  /** 本次请求携带的文本 Key（唯一来源） */
  apiKey: string;
  originalPrompt: string;
  style?: PromptEnhanceStyle;
  mode?: GenerationMode;
  /**
   * V9 · B8（CONTRACT §11-1）：用户选用的配方卡。
   * 它只影响 **system prompt**——`skeleton` 作为"该怎么写"的正例、`pitfalls` 作为"别踩什么"，
   * 而不是去改用户的原文（用户的 `originalPrompt` 始终原样作为 user message 发出去）。
   */
  recipe?: RecipeCard;
  /** 请求体里的端点覆盖（缺省回落到预设） */
  llm?: LlmConfig;
  /** 测试注入 */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface EnhancePromptResult {
  enhancedPrompt: string;
  cameraMovementSuggested?: string;
  lightingSuggested?: string;
  /** 需要让用户知道但不算错误的事（如"上游没按 JSON 回答，已按纯文本采用"） */
  notice?: string;
}

/** 默认超时：文本生成远快于视频，30s 足够；超时归 `UPSTREAM_ERROR`（D28，不是 uncertain） */
const DEFAULT_TIMEOUT_MS = 30_000;

const STYLE_LABELS: Record<PromptEnhanceStyle, string> = {
  cinematic: '电影感（真实光影、浅景深、镜头语言讲究）',
  anime: '动画 / 二次元（线条干净、色彩明快）',
  commercial: '广告大片（干净、产品级质感、光线讲究）',
  realistic: '写实纪录（手持感、自然光、少修饰）',
};

const MODE_HINTS: Record<GenerationMode, string> = {
  t2v: '文生视频：整段画面都靠文字描述生成，需写清主体、环境与镜头运动。',
  i2v: '图生视频：首帧已给定，描述要让画面从这一帧自然动起来（动作 + 镜头运动）。',
  fl2v: '首尾帧：首帧与尾帧都已给定，描述要交代中间过程的运动与变化。',
  v2v: '视频参考：参考视频已给定，描述要强调希望迁移的风格与动作。',
  // V2.40：文生图（本地 ComfyUI 的图片模板）—— 一句话画面，不要镜头运动
  t2i: '文生图：只出一张静止画面，描述要写清主体、构图、光线与画风（不要写镜头运动）。',
};

/**
 * 端点与模型的最终解析（请求体 > 预设 > 内置默认）。
 *
 * `custom` 预设**没有默认值**：用户必须自己填 `baseUrl` 与 `model` ——
 * 与其随便挑一个地址再报一个看不懂的上游错误，不如在这里直接说清没配全。
 */
export function resolveLlmEndpoint(llm?: LlmConfig): { baseUrl: string; model: string } {
  // 「自定义」**没有**可回落的预设：它若回落到 `LLM_PRESETS[0]`，用户选了自定义却留空，
  // 请求就会悄悄打到 OpenAI 的地址、用 OpenAI 的模型名，并带着他填的 Key
  // —— 这是最不该发生的一类"静默替用户做决定"（与铁律 4 同源）。
  const isCustom = llm?.preset === LLM_CUSTOM_PRESET_ID;
  const preset = isCustom ? undefined : (findLlmPreset(llm?.preset) ?? LLM_PRESETS[0]);

  const baseUrl = (llm?.baseUrl ?? '').trim() === '' ? (preset?.baseUrl ?? '') : (llm?.baseUrl ?? '').trim();
  const model = (llm?.model ?? '').trim() === '' ? (preset?.model ?? '') : (llm?.model ?? '').trim();

  if (baseUrl === '' || model === '') {
    throw new ProviderFailureError(
      'LLM_NOT_CONFIGURED',
      '扩写端点未配置完整：请填写 baseUrl 与模型名（自定义预设不提供默认值）',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new ProviderFailureError(
      'LLM_NOT_CONFIGURED',
      `扩写端点地址无效：${baseUrl}（需形如 https://host/v1）`,
    );
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ProviderFailureError(
      'LLM_NOT_CONFIGURED',
      `扩写端点协议不受支持：${parsed.protocol}（仅支持 http/https）`,
    );
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ''), model };
}

/**
 * 凭据擦除已抽到 `security/redact.ts`（视频轨、"测试连接"也都要用同一份实现——
 * 三处各写一份，迟早有一处漏擦）。
 */
export { redactSecrets } from '../security/redact.js';

/** 从模型回答里取出 JSON 对象；取不到返回 `null`（调用方按纯文本处理，并如实告知） */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  try {
    const parsed: unknown = JSON.parse(candidate.slice(start, end + 1));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** `AbortSignal.timeout` 的两种抛出形态（Node 的 undici 与 DOM 规范名不一致） */
function isTimeoutError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? '';
  const message = err instanceof Error ? err.message : '';
  return name === 'TimeoutError' || name === 'AbortError' || /aborted due to timeout/i.test(message);
}

/**
 * 宽松兜底：模型返回的 JSON **解析失败**时，尽量把 `enhancedPrompt` 的正文抠出来。
 *
 * 为什么需要它（2026-09-23 线上实测）：模型有时会把 JSON 里的字符串**拆成多行**（真换行而非 `\n`），
 * 于是 `JSON.parse` 失败 → 旧实现在"纯文本"分支里把**整段 JSON 原样**当成提示词回填，
 * 用户接着就把 `{"enhancedPrompt":"…"}` 这种文本提交去出片了（真的花了钱）。
 * 这里做两件事：① 抠正文；② 抠不出来时返回 `undefined`，由调用方**保留用户原文**（绝不回填垃圾）。
 */
export function extractEnhancedPromptLoosely(text: string): string | undefined {
  const match = /"enhancedPrompt"\s*:\s*"([\s\S]*?)"\s*[,}]/.exec(text);
  if (match === null) return undefined;

  const value = (match[1] ?? '')
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .trim();

  // 抠出来的东西若仍像一段 JSON 外壳，说明这次兜底不成立
  if (value === '' || /^[[{]/.test(value) || value.includes('":"')) return undefined;
  return value;
}

/** 该文本"看起来是结构化数据"吗？（用于判定能否安全地当成提示词） */
export function looksLikeJsonEnvelope(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.includes('":"');
}

function stringField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function buildSystemPrompt(
  style: PromptEnhanceStyle | undefined,
  mode: GenerationMode | undefined,
  recipe: RecipeCard | undefined,
): string {
  const lines = [
    '你是短视频分镜与提示词助手。把用户的一句话改写成可直接喂给视频生成模型的提示词。',
    '要求：',
    '1. 覆盖镜头运动、主体动作、环境氛围、光线质感；',
    '2. 保留原意，引号内的台词**一字不改**；',
    '3. 不要解释、不要序言、不要 Markdown 标题；',
    '4. 只输出一个 JSON 对象：{"enhancedPrompt":"完整提示词","cameraMovementSuggested":"镜头运动","lightingSuggested":"光线建议"}',
    // 实测踩点：模型会把 JSON 字符串**写成多行**，导致严格解析失败 → 必须明确要求单行 + `\\n` 转义
    '5. JSON 必须是**单行**：字符串里不能出现真实换行，需要分段请写成 \\n 转义；不要用 Markdown 代码块包裹。',
  ];
  if (style !== undefined) lines.push(`风格：${STYLE_LABELS[style]}。`);
  if (mode !== undefined) lines.push(`生成模式：${MODE_HINTS[mode]}`);

  // V9 · B8：配方作为**风格上下文**注入（骨架 = 该怎么写，已知坑 = 别踩什么）。
  // 注意：注入的是提示词的"写法约束"，不是让模型复读骨架 —— 用户的主体描述仍然是主角。
  if (recipe !== undefined) {
    lines.push(
      '',
      // 注意：这里的分类名用的是**提示词用词**（`RECIPE_CATEGORY_PROMPT_WORDS`），
      // 不是界面那份（`dict/recipes.ts` 的 `recipes.category.*`）—— 提示词语言是独立轴。
      `用户选用了配方「${recipe.title}」（${RECIPE_CATEGORY_PROMPT_WORDS[recipe.category]}）。改写结果请遵循这个骨架的写法：`,
      recipe.skeleton,
    );
    if (recipe.pitfalls !== undefined && recipe.pitfalls.length > 0) {
      lines.push(`已知坑（务必规避）：${recipe.pitfalls.join('；')}`);
    }
  }

  return lines.join('\n');
}

/**
 * 调一次上游并归一化结果。
 * @throws ProviderFailureError（`LLM_NOT_CONFIGURED` / `KEY_INVALID` / `UPSTREAM_ERROR`）
 */
export async function enhancePromptWithLlm(options: EnhancePromptOptions): Promise<EnhancePromptResult> {
  const { baseUrl, model } = resolveLlmEndpoint(options.llm);
  const fetchImpl = options.fetchImpl ?? fetch;

  const body = {
    model,
    temperature: 0.7,
    messages: [
      { role: 'system', content: buildSystemPrompt(options.style, options.mode, options.recipe) },
      { role: 'user', content: options.originalPrompt },
    ],
  };

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        // Key 只在此处出现，且**不进日志**（pino redact 覆盖请求头，本处是出站请求）
        authorization: `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    // 超时 / DNS / 连接被拒：**不是 uncertain**（D28：无副作用的文本调用不该冒充"费用不明"）。
    // 超时单独识别并给中文说明 —— `AbortSignal.timeout` 抛的是英文 `The operation was aborted…`，
    // 直接透出会让用户以为是我们自己坏了，而实际原因（网络慢 / 端点不通）是另一回事。
    if (isTimeoutError(err)) {
      throw new ProviderFailureError(
        'UPSTREAM_ERROR',
        `扩写请求超时（${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms 内无响应）：请检查端点地址与网络`,
      );
    }

    const detail = err instanceof Error ? err.message : String(err);
    throw new ProviderFailureError('UPSTREAM_ERROR', `扩写请求失败：${redactSecrets(detail, options.apiKey)}`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new ProviderFailureError(
      'KEY_INVALID',
      `扩写凭据被上游拒绝（HTTP ${response.status}）：请检查 Key 与端点是否匹配`,
    );
  }

  if (!response.ok) {
    const snippet = redactSecrets((await response.text()).slice(0, 300), options.apiKey);
    throw new ProviderFailureError(
      'UPSTREAM_ERROR',
      `扩写上游返回 HTTP ${response.status}：${snippet}`,
    );
  }

  const payload = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  } | null;

  const content = payload?.choices?.[0]?.message?.content;
  const text = typeof content === 'string' ? content.trim() : '';
  if (text === '') {
    throw new ProviderFailureError('UPSTREAM_ERROR', '扩写上游返回了空内容（choices[0].message.content 为空）');
  }

  const json = extractJsonObject(text);
  const strict = json === null ? undefined : stringField(json, 'enhancedPrompt');

  if (strict !== undefined && json !== null) {
    const camera = stringField(json, 'cameraMovementSuggested');
    const lighting = stringField(json, 'lightingSuggested');
    return {
      enhancedPrompt: strict,
      ...(camera === undefined ? {} : { cameraMovementSuggested: camera }),
      ...(lighting === undefined ? {} : { lightingSuggested: lighting }),
    };
  }

  // 走到这里有两种情况：严格解析失败，或解析成功但**没有** `enhancedPrompt` 字段。
  // 两者都**不能**把原文当结果（那会把一段 JSON 外壳塞给用户去出片，实测发生过）。

  // ① 先试"宽松抠正文"（模型偶尔把 JSON 字符串写成多行，严格解析必然失败）
  const loose = extractEnhancedPromptLoosely(text);
  if (loose !== undefined) {
    return { enhancedPrompt: loose, notice: '上游的 JSON 无法严格解析，已从字段中取出提示词正文' };
  }

  // ② 纯文本且不像结构化数据 → 照实采用（**不许**假装结构化、更不许用规则引擎补字段）
  if (!looksLikeJsonEnvelope(text)) {
    return { enhancedPrompt: text, notice: '上游返回的不是 JSON，已按纯文本采用' };
  }

  // ③ 看起来是结构化数据却拿不到正文：**保留用户原文**，并说明原因。
  // 回填一段 `{"enhancedPrompt":…}` 是最坏的结果 —— 用户很可能直接拿它去出片（2026-09-23 线上实测）。
  return {
    enhancedPrompt: options.originalPrompt,
    notice: '上游返回的结构化结果里没有可用的提示词正文（疑似 JSON 格式错误），已保留你的原文：请重试或改用其他模型',
  };
}
