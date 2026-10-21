import { z } from 'zod';
import { AspectRatioSchema, GenerationModeSchema } from './request.js';
import {
  RECIPE_CARDS,
  RECIPE_CATEGORY_PROMPT_WORDS,
  RecipeCategorySchema,
  type RecipeCard,
} from './recipes.js';
import { INDUSTRY_TEMPLATES, type IndustryTemplate } from './templates.js';

/**
 * 技能库（S6-A / B83）。
 *
 * 这一层刻意比“配方卡 + 行业模板”更窄，也比即梦的社区技能市场更窄：
 * - **数据不是 API**：随前端 bundle 下发，零新路由、零新表；
 * - **内置技能由现有配方/模板迁移**，不复制 60 份提示词；
 * - **应用只填提示词与参数**，不提交生成；能力门控留给应用层；
 * - **自建技能**只保存结构，不执行任意脚本/URL。Agent（S6-B）后续消费同一份 manifest。
 *
 * 之所以单独建文件而不是把字段塞进 `RecipeCard`：
 * 配方是“镜头技法”，行业模板是“整片起手式”，技能需要统一的名字/摘要/触发词/参数，
 * 但又不该反向污染已经稳定的两份数据。
 */

export const SkillCategorySchema = z.union([RecipeCategorySchema, z.literal('industry')]);
export type SkillCategory = z.infer<typeof SkillCategorySchema>;

export const SkillOriginSchema = z.enum(['recipe', 'template', 'user']);
export type SkillOrigin = z.infer<typeof SkillOriginSchema>;

export const SkillParamsSchema = z.object({
  aspectRatio: AspectRatioSchema.optional(),
  resolutionTier: z.enum(['480p', '720p', '1080p']).optional(),
  durationSec: z.number().positive().optional(),
});
export type SkillParams = z.infer<typeof SkillParamsSchema>;

const SKILL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

/**
 * 技能 manifest。
 *
 * `prompt` 保留原文（不 trim / 不改写），因为“插入技能”必须逐字落进草稿；
 * `summary` 只是卡片/检索用的短句，不替代 prompt。
 */
export const SkillManifestSchema = z
  .object({
    version: z.literal(1),
    id: z.string().regex(SKILL_ID_PATTERN),
    name: z.string().trim().min(1),
    summary: z.string().trim().min(1).max(240),
    category: SkillCategorySchema,
    origin: SkillOriginSchema,
    /** Agent 检索/触发词；内置技能从标题/分类派生，自建技能由用户填写 */
    triggers: z.array(z.string().trim().min(1)).min(1),
    /** 逐字落到草稿的提示词骨架（不 trim；但纯空白不算有效内容） */
    prompt: z.string().refine((value) => value.trim().length > 0, 'prompt 不能为空'),
    params: SkillParamsSchema.default({}),
    modes: z.array(GenerationModeSchema).min(1),
    requiresImage: z.boolean().default(false),
    notes: z.array(z.string().trim().min(1)).default([]),
    /** 行业模板的来源说明；配方/自建技能可为空 */
    source: z.string().trim().min(1).optional(),
    /** 行业模板的行业名；其他技能为空 */
    industry: z.string().trim().min(1).optional(),
    /** 配方卡的时长建议（如“5s 以内”）；只展示，不强制改表单 */
    durationHint: z.string().trim().min(1).optional(),
  })
  .strict();

export type SkillManifest = z.infer<typeof SkillManifestSchema>;

function firstSentence(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const stop = normalized.indexOf('。');
  return (stop === -1 ? normalized : normalized.slice(0, stop)).slice(0, 240);
}

/** 配方卡 → 技能。提示词原文不复制、不改写。 */
export function skillFromRecipe(card: RecipeCard): SkillManifest {
  return SkillManifestSchema.parse({
    version: 1,
    id: card.id,
    name: card.title,
    summary: firstSentence(card.skeleton),
    category: card.category,
    origin: 'recipe',
    triggers: [card.title, RECIPE_CATEGORY_PROMPT_WORDS[card.category]],
    prompt: card.skeleton,
    params: card.paramsHint ?? {},
    modes: card.modes,
    requiresImage: false,
    notes: card.pitfalls ?? [],
    durationHint: card.durationHint,
  });
}

/** 行业模板 → 技能。参数从模板的推荐值迁移，但只作为建议。 */
export function skillFromTemplate(template: IndustryTemplate): SkillManifest {
  return SkillManifestSchema.parse({
    version: 1,
    id: template.id,
    name: template.title,
    summary: template.summary,
    category: 'industry',
    origin: 'template',
    triggers: [template.industry, template.title],
    prompt: template.skeleton,
    params: {
      aspectRatio: template.aspectRatio,
      resolutionTier: template.resolutionTier,
      durationSec: template.durationSec,
    },
    modes: [template.recommendedMode],
    requiresImage: template.requiresImage,
    notes: template.notes,
    source: template.source,
    industry: template.industry,
  });
}

/** 内置技能 = 现有配方 + 行业模板；顺序保持原数据顺序，便于 UI 稳定。 */
export const BUILTIN_SKILLS: readonly SkillManifest[] = [
  ...RECIPE_CARDS.map(skillFromRecipe),
  ...INDUSTRY_TEMPLATES.map(skillFromTemplate),
];

const BUILTIN_SKILL_IDS = new Set(BUILTIN_SKILLS.map((skill) => skill.id));

/** 自建技能与启停状态（S6-A 本地持久化；不新增服务端表）。 */
export const SkillLibrarySchema = z
  .object({
    version: z.literal(1),
    custom: z.array(SkillManifestSchema).default([]),
    disabledIds: z.array(z.string()).default([]),
  })
  .strict()
  .superRefine((library, ctx) => {
    const customIds = new Set<string>();
    for (const skill of library.custom) {
      if (skill.origin !== 'user') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['custom'],
          message: `自建技能 ${skill.id} 的 origin 必须是 user`,
        });
      }
      if (BUILTIN_SKILL_IDS.has(skill.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['custom'],
          message: `自建技能 id ${skill.id} 与内置技能冲突`,
        });
      }
      if (customIds.has(skill.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['custom'],
          message: `自建技能 id ${skill.id} 重复`,
        });
      }
      customIds.add(skill.id);
    }
  });

export type SkillLibrary = z.infer<typeof SkillLibrarySchema>;

export function emptySkillLibrary(): SkillLibrary {
  return { version: 1, custom: [], disabledIds: [] };
}

/** 按 id 查内置技能；未知/空 id 返回 undefined，调用方必须显式处理。 */
export function findSkill(id: string | undefined): SkillManifest | undefined {
  if (id === undefined) return undefined;
  return BUILTIN_SKILLS.find((skill) => skill.id === id);
}
