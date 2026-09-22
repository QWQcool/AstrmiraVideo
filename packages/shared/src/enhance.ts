import { z } from 'zod';
import { GenerationModeSchema } from './request.js';

/**
 * 契约投影来源：docs/CONTRACT.md §3 提示词扩写接口契约 `PromptEnhance`
 */

export const PromptEnhanceStyleSchema = z.enum(['cinematic', 'anime', 'commercial', 'realistic']);

export const PromptEnhanceRequestSchema = z.object({
  originalPrompt: z.string(),
  style: PromptEnhanceStyleSchema.optional(),
  mode: GenerationModeSchema.optional(),
});

export const PromptEnhanceResponseSchema = z.object({
  enhancedPrompt: z.string(),
  cameraMovementSuggested: z.string().optional(),
  lightingSuggested: z.string().optional(),
});

export type PromptEnhanceStyle = z.infer<typeof PromptEnhanceStyleSchema>;
export type PromptEnhanceRequest = z.infer<typeof PromptEnhanceRequestSchema>;
export type PromptEnhanceResponse = z.infer<typeof PromptEnhanceResponseSchema>;
