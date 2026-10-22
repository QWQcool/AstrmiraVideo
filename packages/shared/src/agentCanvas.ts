import { z } from 'zod';
import { LlmConfigSchema } from './enhance.js';
import { AgentPlanUsageSchema } from './agent.js';

/**
 * 只读画布 Agent（S7-D1 / CONTRACT §24）。
 *
 * 这层只接收**快照**并返回文本回答：
 * - 没有 tools、没有 apply、没有 canvas mutation 字段；
 * - 请求里不能带任意 URL、脚本或节点写操作；
 * - 画布上下文由前端从 `CanvasDoc` 派生，服务端不直接读画布数据库。
 */
export const CanvasAgentNodeContextSchema = z
  .object({
    id: z.string().min(1).max(160),
    type: z.enum(['text', 'image', 'video', 'audio']),
    title: z.string().max(200),
    prompt: z.string().max(4000),
    batchCount: z.number().int().nonnegative(),
    outputKinds: z.array(z.enum(['image', 'video', 'audio', 'text'])).max(4),
    referenceCount: z.number().int().nonnegative(),
  })
  .strict();
export type CanvasAgentNodeContext = z.infer<typeof CanvasAgentNodeContextSchema>;

export const CanvasAgentEdgeContextSchema = z
  .object({
    from: z.string().min(1).max(160),
    to: z.string().min(1).max(160),
    kind: z.enum(['lineage', 'dependency']),
    role: z.string().max(40).optional(),
  })
  .strict();
export type CanvasAgentEdgeContext = z.infer<typeof CanvasAgentEdgeContextSchema>;

export const CanvasAgentContextSchema = z
  .object({
    projectId: z.string().min(1).max(160),
    name: z.string().max(200),
    nodes: z.array(CanvasAgentNodeContextSchema).max(200),
    edges: z.array(CanvasAgentEdgeContextSchema).max(500),
    selectedNodeId: z.string().min(1).max(160).optional(),
    /** 节点/边超过上限时由前端截断；回答必须如实说明“快照不完整”。 */
    truncated: z.boolean().default(false),
  })
  .strict();
export type CanvasAgentContext = z.infer<typeof CanvasAgentContextSchema>;

export const CanvasAgentRequestSchema = z
  .object({
    question: z.string().trim().min(1).max(2000),
    canvas: CanvasAgentContextSchema,
    llm: LlmConfigSchema.optional(),
  })
  .strict();
export type CanvasAgentRequest = z.infer<typeof CanvasAgentRequestSchema>;

export const CanvasAgentResponseSchema = z
  .object({
    answer: z.string().trim().min(1).max(8000),
    engine: z.literal('llm'),
    model: z.string().min(1),
    usage: AgentPlanUsageSchema.optional(),
  })
  .strict();
export type CanvasAgentResponse = z.infer<typeof CanvasAgentResponseSchema>;

/**
 * S7-D2：画布 Agent 只能**提议**一个文本节点，不能直接执行。
 *
 * 模型只产出这张方案卡；用户确认后，前端才用 `createCanvasNode` 写入 CanvasDoc。
 * `action` 固定为单一操作，防止模型在一个响应里夹带删除/连线/生成。
 */
export const CanvasNodeProposalSchema = z
  .object({
    version: z.literal(1),
    action: z.literal('create-text-node'),
    title: z.string().trim().min(1).max(80),
    content: z.string().trim().min(1).max(4000),
    reason: z.string().trim().max(300).optional(),
    warnings: z.array(z.string().trim().min(1).max(300)).max(5).default([]),
  })
  .strict();
export type CanvasNodeProposal = z.infer<typeof CanvasNodeProposalSchema>;

export const CanvasNodeProposalRequestSchema = z
  .object({
    instruction: z.string().trim().min(1).max(2000),
    canvas: CanvasAgentContextSchema,
    llm: LlmConfigSchema.optional(),
  })
  .strict();
export type CanvasNodeProposalRequest = z.infer<typeof CanvasNodeProposalRequestSchema>;

export const CanvasNodeProposalResponseSchema = z
  .object({
    proposal: CanvasNodeProposalSchema,
    engine: z.literal('llm'),
    model: z.string().min(1),
    usage: AgentPlanUsageSchema.optional(),
  })
  .strict();
export type CanvasNodeProposalResponse = z.infer<typeof CanvasNodeProposalResponseSchema>;

/**
 * S7-D5：更新**已存在的文本节点**，同样只返回待确认方案。
 *
 * targetNodeId 由前端选中节点提供，服务端校验目标存在且是 text；
 * 模型不得改目标，写入仍由前端在用户确认后完成。
 */
export const CanvasTextNodeUpdateProposalSchema = z
  .object({
    version: z.literal(1),
    action: z.literal('update-text-node'),
    targetNodeId: z.string().min(1).max(160),
    title: z.string().trim().min(1).max(80),
    content: z.string().trim().min(1).max(4000),
    reason: z.string().trim().max(300).optional(),
    warnings: z.array(z.string().trim().min(1).max(300)).max(5).default([]),
  })
  .strict();
export type CanvasTextNodeUpdateProposal = z.infer<
  typeof CanvasTextNodeUpdateProposalSchema
>;

export const CanvasTextNodeUpdateRequestSchema = z
  .object({
    instruction: z.string().trim().min(1).max(2000),
    canvas: CanvasAgentContextSchema,
    targetNodeId: z.string().min(1).max(160),
    llm: LlmConfigSchema.optional(),
  })
  .strict();
export type CanvasTextNodeUpdateRequest = z.infer<
  typeof CanvasTextNodeUpdateRequestSchema
>;

export const CanvasTextNodeUpdateResponseSchema = z
  .object({
    proposal: CanvasTextNodeUpdateProposalSchema,
    engine: z.literal('llm'),
    model: z.string().min(1),
    usage: AgentPlanUsageSchema.optional(),
  })
  .strict();
export type CanvasTextNodeUpdateResponse = z.infer<
  typeof CanvasTextNodeUpdateResponseSchema
>;
