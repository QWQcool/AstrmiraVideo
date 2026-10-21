import type { AgentPlan, AgentPlanStep, AspectRatio } from '@astrmira/shared';
import { newIdempotencyKey } from './idempotency';

/**
 * Agent 执行意图（S6-B3）。
 *
 * 目标不是“给每次点击都换一个键”，而是把“同一份方案 + 同一份草稿”收敛成一个
 * **执行意图**：
 * - 同一意图重复点生成 → 沿用同一个 `Idempotency-Key`（服务端会返回同一 taskId）；
 * - 改方案/改提示词/改参数/改引用 → 新指纹 → 新键；
 * - Agent 计划清空后仍保留最近一次执行意图，直到草稿真的变化或显式新方案。
 *
 * 指纹只存内存（`useRef`），不落 localStorage；幂等键也不写日志/URL。
 */

export interface AgentDraftSignatureInput {
  prompt: string;
  kind: 'video' | 'image';
  aspectRatio: AspectRatio;
  resolutionTier: string;
  durationSec: number;
  seed: string;
  provider: string;
  model: string;
  refs: readonly { ref: string; kind: 'image' | 'video' }[];
}

export interface AgentExecutionIntent {
  planSignature: string;
  draftSignature: string;
  idempotencyKey: string;
}

/** 计划里真正会改变请求的步骤；note / reason 不进入执行指纹。 */
function executionSteps(steps: readonly AgentPlanStep[]): unknown[] {
  return steps
    .filter((step) => step.kind !== 'note')
    .map((step) => {
      if (step.kind === 'apply-skill') {
        return {
          kind: step.kind,
          skillId: step.skillId,
          ...(step.prompt === undefined ? {} : { prompt: step.prompt }),
          ...(step.params === undefined ? {} : { params: step.params }),
        };
      }
      if (step.kind === 'add-reference') {
        return { kind: step.kind, ref: step.ref, role: step.role };
      }
      return { kind: step.kind, params: step.params };
    });
}

export function planSignature(plan: AgentPlan): string {
  return JSON.stringify({ version: plan.version, steps: executionSteps(plan.steps) });
}

export function draftSignature(input: AgentDraftSignatureInput): string {
  return JSON.stringify({
    prompt: input.prompt,
    kind: input.kind,
    aspectRatio: input.aspectRatio,
    resolutionTier: input.resolutionTier,
    durationSec: input.durationSec,
    seed: input.seed,
    provider: input.provider,
    model: input.model,
    refs: input.refs.map((item) => ({ ref: item.ref, kind: item.kind })),
  });
}

/**
 * 返回可复用的执行意图；只有方案与草稿都相同时才复用键。
 * 调用方负责在“应用方案”后记录返回值，并在生成时用当前草稿重新比对。
 */
export function reuseAgentExecution(
  previous: AgentExecutionIntent | null,
  plan: AgentPlan,
  draft: AgentDraftSignatureInput,
): AgentExecutionIntent {
  const nextPlan = planSignature(plan);
  const nextDraft = draftSignature(draft);
  if (
    previous !== null &&
    previous.planSignature === nextPlan &&
    previous.draftSignature === nextDraft
  ) {
    return previous;
  }
  return {
    planSignature: nextPlan,
    draftSignature: nextDraft,
    idempotencyKey: newIdempotencyKey(),
  };
}

/**
 * 生成时取键：当前草稿与最近一次 Agent 执行意图一致 → 复用；否则新键。
 * 这覆盖“用户改了提示词后又手滑点生成”的情况：不能误用旧意图的幂等键。
 */
export function idempotencyKeyForSubmit(
  intent: AgentExecutionIntent | null,
  draft: AgentDraftSignatureInput,
): string {
  if (intent !== null && intent.draftSignature === draftSignature(draft)) {
    return intent.idempotencyKey;
  }
  return newIdempotencyKey();
}
