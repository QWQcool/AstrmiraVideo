import { z } from 'zod';
import { GenerationModeSchema } from './request.js';

/**
 * 契约投影来源：docs/CONTRACT.md §3 提示词扩写接口契约 `PromptEnhance`（V2.0）。
 *
 * V2.0（PLAN §6-D24，落地台账 B3）三条硬口径：
 * 1. **纯 BYOK**：凭据只走请求头 `X-LLM-Key`，服务端**不设兜底 Key**。
 *    因此"服务端是否可用"这个问题在文本侧不存在 —— 有没有 Key 由前端自己知道；
 * 2. **禁止静默降级**：`engine` 是必填的**可证伪标记**。本实现只可能产出 `'llm'`；
 *    `'rules'` 保留在契约里是为了让"某天有人用规则引擎冒充 LLM"这件事在类型与测试层面都藏不住；
 * 3. `baseUrl` / `model` 由 `LLM_PRESETS` 提供默认值，允许请求体覆盖（自建代理 / 兼容端点）。
 */

export const PromptEnhanceStyleSchema = z.enum(['cinematic', 'anime', 'commercial', 'realistic']);

/**
 * OpenAI 兼容的文本端点预设（D24：预设表放 `packages/shared`，前后端共用一份）。
 *
 * 为什么是"预设 + 可覆盖"而不是"写死三家"：
 * 文本侧各家兼容层已收敛到同一形状（`POST {baseUrl}/chat/completions`），
 * 一份实现即可覆盖；写死列表会让"我用自己的兼容端点"变成改代码。
 *
 * ⚠️ `model` 只是**占位默认值**，模型 id 随各家发布节奏变动、且需与用户账号的可用列表匹配；
 * 因此界面必须允许覆盖，文档也不得把这里的值当成"已验证可用的模型"。
 */
export interface LlmPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  /** 该预设的来源说明（显示用；不写"已验证"，只写它是什么） */
  note: string;
}

export const LLM_PRESETS: readonly LlmPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    note: 'OpenAI 官方端点；模型 id 以账号可用列表为准',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    note: 'DeepSeek 官方端点；模型 id 以账号可用列表为准',
  },
  {
    id: 'volcano-ark',
    label: '火山方舟',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-1-6-250615',
    note: '与视频轨同一家的文本端点；方舟的模型名通常是 endpoint id，务必按控制台填写',
  },
] as const;

/** 自定义预设：只给形状，不给值（用户必须自己填 baseUrl 与 model） */
export const LLM_CUSTOM_PRESET_ID = 'custom';

export function findLlmPreset(id: string | undefined): LlmPreset | undefined {
  if (id === undefined) return undefined;
  return LLM_PRESETS.find((preset) => preset.id === id);
}

/** 文本轨的端点配置（请求体可选字段；缺省时服务端回落到 `LLM_PRESETS` 的第一项） */
export const LlmConfigSchema = z.object({
  preset: z.string().optional(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
});

export const PromptEnhanceRequestSchema = z.object({
  originalPrompt: z.string(),
  style: PromptEnhanceStyleSchema.optional(),
  mode: GenerationModeSchema.optional(),
  /** V2.0：端点与模型（`baseUrl` / `model` 覆盖预设值）；凭据**绝不**出现在这里 */
  llm: LlmConfigSchema.optional(),
});

export const PromptEnhanceResponseSchema = z.object({
  enhancedPrompt: z.string(),
  cameraMovementSuggested: z.string().optional(),
  lightingSuggested: z.string().optional(),
  /**
   * V2.0 必填：产出这份结果的引擎。本服务只可能返回 `'llm'`。
   * 它是"是否静默降级"在测试层面唯一可证伪的标记（D24）。
   */
  engine: z.enum(['llm', 'rules']),
  /** 需要让用户知道但不算错误的事（如"上游返回的不是 JSON，已按纯文本采用"） */
  notice: z.string().optional(),
});

export type PromptEnhanceStyle = z.infer<typeof PromptEnhanceStyleSchema>;
export type LlmConfig = z.infer<typeof LlmConfigSchema>;
export type PromptEnhanceRequest = z.infer<typeof PromptEnhanceRequestSchema>;
export type PromptEnhanceResponse = z.infer<typeof PromptEnhanceResponseSchema>;
