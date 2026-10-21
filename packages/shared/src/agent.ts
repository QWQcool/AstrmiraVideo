import { z } from 'zod';
import { LlmConfigSchema } from './enhance.js';
import { SkillManifestSchema, SkillParamsSchema } from './skills.js';
import type { GenerationMode } from './request.js';
import type { SkillManifest } from './skills.js';

/**
 * Agent 计划（S6-B1 / CONTRACT §23）。
 *
 * 这一层只定义“模型能提出什么”，**不执行**任何东西：
 * - 计划是结构化数据，不是脚本；`strict()` 让 `exec` / `script` 这类字段直接失败；
 * - 最多 8 步、只允许已登记的技能与引用格式；
 * - 真正的草稿落点、幂等键、生成提交在 S6-B2/B3，B1 只做 schema + 检索 + 能力校验。
 *
 * 为什么步骤里没有任意 URL：引用只接受 `asset:` / `task:`，服务端自己解析为媒体，
 * 不让模型输出 `https://...` 让前端去 fetch（SSRF/越权）。
 */

export const AGENT_PLAN_VERSION = 1 as const;

const SKILL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
const REFERENCE_PATTERN = /^(asset|task):[A-Za-z0-9_-]+$/;

export const AgentReferenceRoleSchema = z.enum([
  'firstFrame',
  'lastFrame',
  'referenceImage',
  'referenceVideo',
  'audio',
]);
export type AgentReferenceRole = z.infer<typeof AgentReferenceRoleSchema>;

const reasonSchema = z.string().trim().min(1).max(300).optional();

export const AgentPlanStepSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('apply-skill'),
      skillId: z.string().regex(SKILL_ID_PATTERN),
      /** 可选的场景化补充；空串会被 trim 掉，不覆盖技能本身的 prompt */
      prompt: z.string().trim().max(4000).optional(),
      params: SkillParamsSchema.optional(),
      reason: reasonSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('add-reference'),
      ref: z.string().regex(REFERENCE_PATTERN),
      role: AgentReferenceRoleSchema,
      reason: reasonSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('set-params'),
      params: SkillParamsSchema,
      reason: reasonSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('note'),
      text: z.string().trim().min(1).max(500),
    })
    .strict(),
]);
export type AgentPlanStep = z.infer<typeof AgentPlanStepSchema>;

export const AgentPlanSchema = z
  .object({
    version: z.literal(AGENT_PLAN_VERSION),
    intent: z.string().trim().min(1).max(4000),
    summary: z.string().trim().min(1).max(400),
    steps: z.array(AgentPlanStepSchema).min(1).max(8),
    assumptions: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
    warnings: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
  })
  .strict();
export type AgentPlan = z.infer<typeof AgentPlanSchema>;

/**
 * 请求里的 `skills` **只放本机自建技能**（内置由服务端提供）。
 * 不把 `apiKey` 放进来：凭据只走 `X-LLM-Key`。
 */
export const AgentPlanRequestSchema = z
  .object({
    intent: z.string().trim().min(1).max(4000),
    skills: z.array(SkillManifestSchema).max(50).default([]),
    llm: LlmConfigSchema.optional(),
  })
  .strict();
export type AgentPlanRequest = z.infer<typeof AgentPlanRequestSchema>;

export const AgentPlanUsageSchema = z
  .object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
  })
  .strict();
export type AgentPlanUsage = z.infer<typeof AgentPlanUsageSchema>;

export const AgentPlanResponseSchema = z
  .object({
    plan: AgentPlanSchema,
    /** 与 PromptEnhance 的 `engine` 同义：走到这里一定真的调了模型 */
    engine: z.literal('llm'),
    model: z.string().trim().min(1),
    /** 文本 token 用量；价格未知时不编造金额（AC6-B） */
    usage: AgentPlanUsageSchema.optional(),
  })
  .strict();
export type AgentPlanResponse = z.infer<typeof AgentPlanResponseSchema>;

const SUPPORTED_AGENT_MODES = new Set<GenerationMode>(['t2i', 't2v', 'i2v']);
const IMAGE_REFERENCE_ROLES = new Set<AgentReferenceRole>([
  'firstFrame',
  'lastFrame',
  'referenceImage',
]);

/**
 * 计划的能力校验。schema 校验“形状”；这里校验“这台实例能不能做”。
 *
 * 失败返回**全部**问题（不是第一条）：用户一次改完，而不是修一个再撞下一个。
 */
export function validateAgentPlan(
  plan: AgentPlan,
  skills: readonly SkillManifest[],
): { ok: true; issues: [] } | { ok: false; issues: string[] } {
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  const issues: string[] = [];
  const hasImageReference = plan.steps.some(
    (step) =>
      step.kind === 'add-reference' && IMAGE_REFERENCE_ROLES.has(step.role),
  );

  for (const [index, step] of plan.steps.entries()) {
    const label = `第 ${index + 1} 步`;
    if (step.kind !== 'apply-skill') continue;
    const skill = byId.get(step.skillId);
    if (skill === undefined) {
      issues.push(`${label}引用了不存在的技能：${step.skillId}`);
      continue;
    }
    if (!skill.modes.some((mode) => SUPPORTED_AGENT_MODES.has(mode))) {
      issues.push(
        `${label}技能「${skill.name}」没有当前可执行的模式（${skill.modes.join(' / ')}）`,
      );
    }
    if (skill.requiresImage && !hasImageReference) {
      issues.push(`${label}技能「${skill.name}」需要参考图，但计划里没有图片引用`);
    }
  }

  return issues.length === 0 ? { ok: true, issues: [] } : { ok: false, issues };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

/**
 * 轻量技能检索：不引入向量库/新依赖，先按触发词与名称/摘要的包含关系打分。
 *
 * 这是给 system prompt 选候选，不是最终校验；最终仍以完整 catalog 校验计划里的 skillId。
 * 不做“语义相似度”的假承诺：分数相同按原顺序，结果可复现。
 */
export function retrieveSkillsForIntent(
  intent: string,
  skills: readonly SkillManifest[],
  limit = 10,
): SkillManifest[] {
  const query = normalize(intent);
  const tokens = intent
    .toLowerCase()
    .split(/[\s，。！？；：、,.!?;:/\\|()[\]{}"'“”‘’]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

  const scored = skills.map((skill, index) => {
    const name = normalize(skill.name);
    const summary = normalize(skill.summary);
    const prompt = normalize(skill.prompt);
    let score = 0;
    for (const trigger of skill.triggers) {
      const value = normalize(trigger);
      if (value.length >= 2 && query.includes(value)) score += 6;
    }
    if (query.includes(name)) score += 4;
    for (const token of tokens) {
      if (name.includes(token)) score += 3;
      if (summary.includes(token)) score += 2;
      if (prompt.includes(token)) score += 1;
    }
    return { skill, score, index };
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, Math.max(1, Math.min(limit, 20))).map((item) => item.skill);
}

/**
 * 构造给模型的候选清单（只含 ID/名称/模式/是否需图/摘要/触发词，不含完整 prompt）。
 * 完整 prompt 留在服务端 catalog，模型只返回 skillId，避免把 54 份长提示词塞进上下文。
 */
export function agentSkillCandidateText(skill: SkillManifest): string {
  return [
    `- id: ${skill.id}`,
    `  name: ${skill.name}`,
    `  modes: ${skill.modes.join(', ')}`,
    `  requiresImage: ${skill.requiresImage ? 'true' : 'false'}`,
    `  summary: ${skill.summary}`,
    `  triggers: ${skill.triggers.join(', ')}`,
  ].join('\n');
}
