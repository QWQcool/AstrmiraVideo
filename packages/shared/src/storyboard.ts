import { z } from 'zod';
import { CanvasAgentContextSchema } from './agentCanvas.js';
import { LlmConfigSchema } from './enhance.js';
import { AspectRatioSchema } from './request.js';
import { AgentPlanUsageSchema } from './agent.js';

/**
 * P5：分镜计划（StoryboardPlan）是**独立于画布节点方案**的规划对象。
 *
 * 它不包含节点 id / 工具调用 / 删除/连线操作；只描述镜头、时长、转场与待确认点。
 * 任何“把分镜落到画布”的动作都必须由前端显式转换，不能由本响应自动执行。
 */
export const StoryboardShotSchema = z
  .object({
    index: z.number().int().positive(),
    time: z.string().trim().min(1).max(40),
    shotSize: z.string().trim().min(1).max(40),
    camera: z.string().trim().min(1).max(120),
    visual: z.string().trim().min(1).max(1200),
    transition: z.string().trim().max(160).optional(),
    audio: z.string().trim().max(300).optional(),
  })
  .strict();
export type StoryboardShot = z.infer<typeof StoryboardShotSchema>;

export const StoryboardPlanSchema = z
  .object({
    version: z.literal(1),
    title: z.string().trim().min(1).max(120),
    aspectRatio: AspectRatioSchema,
    durationSec: z.number().int().positive().max(600),
    shots: z.array(StoryboardShotSchema).min(1).max(20),
    openQuestions: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
    warnings: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
  })
  .strict();
export type StoryboardPlan = z.infer<typeof StoryboardPlanSchema>;

export const StoryboardRequestSchema = z
  .object({
    instruction: z.string().trim().min(1).max(2000),
    canvas: CanvasAgentContextSchema.optional(),
    llm: LlmConfigSchema.optional(),
  })
  .strict();
export type StoryboardRequest = z.infer<typeof StoryboardRequestSchema>;

export const StoryboardResponseSchema = z
  .object({
    plan: StoryboardPlanSchema,
    engine: z.literal('llm'),
    model: z.string().trim().min(1),
    usage: AgentPlanUsageSchema.optional(),
  })
  .strict();
export type StoryboardResponse = z.infer<typeof StoryboardResponseSchema>;
