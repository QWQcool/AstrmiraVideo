import { describe, expect, it } from 'vitest';
import { AgentPlanSchema } from '@astrmira/shared';
import {
  draftSignature,
  idempotencyKeyForSubmit,
  planSignature,
  reuseAgentExecution,
  type AgentDraftSignatureInput,
} from './agentExecution';

function plan(overrides: Record<string, unknown> = {}) {
  return AgentPlanSchema.parse({
    version: 1,
    intent: '雨夜镜头',
    summary: '应用技能',
    steps: [{ kind: 'apply-skill', skillId: 'camera-push-in-slow' }],
    assumptions: [],
    warnings: [],
    ...overrides,
  });
}

function draft(overrides: Partial<AgentDraftSignatureInput> = {}): AgentDraftSignatureInput {
  return {
    prompt: '雨夜镜头',
    kind: 'video',
    aspectRatio: '16:9',
    resolutionTier: '720p',
    durationSec: 5,
    seed: '',
    provider: 'host-comfyui',
    model: '',
    refs: [],
    ...overrides,
  };
}

describe('S6-B3 · Agent 执行意图', () => {
  it('同一方案 + 同一草稿复用幂等键；改草稿/改方案换新键', () => {
    const first = reuseAgentExecution(null, plan(), draft());
    expect(reuseAgentExecution(first, plan(), draft())).toBe(first);

    const changedDraft = reuseAgentExecution(first, plan(), draft({ prompt: '另一个镜头' }));
    expect(changedDraft.idempotencyKey).not.toBe(first.idempotencyKey);

    const changedPlan = reuseAgentExecution(
      first,
      plan({ steps: [{ kind: 'apply-skill', skillId: 'lighting-golden-hour' }] }),
      draft(),
    );
    expect(changedPlan.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it('note 不改变执行指纹；参数/引用会改变', () => {
    const base = plan();
    const withNote = plan({
      steps: [...base.steps, { kind: 'note', text: '确认后生成' }],
    });
    expect(planSignature(withNote)).toBe(planSignature(base));

    expect(draftSignature(draft({ durationSec: 8 }))).not.toBe(draftSignature(draft()));
    expect(
      draftSignature(draft({ refs: [{ ref: 'asset:abc', kind: 'image' }] })),
    ).not.toBe(draftSignature(draft()));
  });

  it('提交时草稿与 Agent 意图一致才复用键，否则新键', () => {
    const intent = reuseAgentExecution(null, plan(), draft());
    expect(idempotencyKeyForSubmit(intent, draft())).toBe(intent.idempotencyKey);
    expect(idempotencyKeyForSubmit(intent, draft({ seed: '42' }))).not.toBe(
      intent.idempotencyKey,
    );
    const key = idempotencyKeyForSubmit(null, draft());
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });
});
