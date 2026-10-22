import { describe, expect, it } from 'vitest';
import { BUILTIN_SKILLS, type AgentPlan } from '@astrmira/shared';
import {
  buildAgentCanvasPlan,
  appendAgentCanvasPlan,
} from './agentCanvas';
import {
  clearAgentCanvasHandoff,
  parseAgentCanvasHandoff,
  peekAgentCanvasHandoff,
  setAgentCanvasHandoff,
  takeAgentCanvasHandoff,
} from './agentCanvasHandoff';
import { createEmptyCanvasDoc } from '@astrmira/shared';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => data.set(key, value),
  };
}

function plan(): AgentPlan {
  return {
    version: 1,
    intent: '雨夜霓虹慢推',
    summary: '雨夜氛围 + 慢推',
    steps: [
      { kind: 'add-reference', ref: 'asset:asset-1', role: 'referenceImage' },
      { kind: 'apply-skill', skillId: 'mood-rainy-night' },
      { kind: 'apply-skill', skillId: 'camera-push-in-slow', prompt: '更慢一点' },
      { kind: 'set-params', params: { aspectRatio: '16:9', durationSec: 5 } },
    ],
    assumptions: [],
    warnings: [],
  };
}

describe('S7-C2 Agent plan → canvas drafts', () => {
  it('每个 apply-skill 建一个草稿节点，引用/参数/顺序边都写入', () => {
    const built = buildAgentCanvasPlan(plan(), BUILTIN_SKILLS, { x: 100, y: 80 }, 123);
    expect(built.missingSkillIds).toEqual([]);
    expect(built.nodes).toHaveLength(2);
    expect(built.nodes[0]?.type).toBe('video');
    expect(built.nodes[0]?.data.draft.prompt).toContain('雨夜街道');
    expect(built.nodes[1]?.data.draft.prompt).toContain('更慢一点');
    expect(built.nodes[0]?.data.draft.references).toEqual([
      { assetId: 'asset-1', role: 'reference-image', order: 0 },
    ]);
    expect(built.nodes[0]?.data.draft.settings).toMatchObject({
      mode: 't2v',
      aspectRatio: '16:9',
      durationSec: 5,
    });
    expect(built.edges).toHaveLength(1);
    expect(built.edges[0]).toMatchObject({
      from: built.nodes[0]?.id,
      to: built.nodes[1]?.id,
      kind: 'dependency',
    });
    expect(built.nodes[0]?.meta?.createdFrom).toBe('skill');
  });

  it('只有 note 的计划建一个文本节点，不产生伪生成批次', () => {
    const built = buildAgentCanvasPlan(
      {
        version: 1,
        intent: '海报说明',
        summary: '需要 MOSS/FLUX t2i 能力',
        steps: [{ kind: 'note', text: '当前候选没有 t2i' }],
        assumptions: [],
        warnings: [],
      },
      BUILTIN_SKILLS,
      { x: 0, y: 0 },
      123,
    );
    expect(built.nodes).toHaveLength(1);
    expect(built.nodes[0]?.type).toBe('text');
    expect(built.nodes[0]?.data.draft.prompt).toContain('MOSS');
    expect(built.edges).toEqual([]);
    expect(built.nodes[0]?.data.batches).toEqual([]);
  });

  it('未知技能不伪装成功，返回 missing 且不建节点', () => {
    const built = buildAgentCanvasPlan(
      {
        version: 1,
        intent: '未知技能',
        summary: '未知技能',
        steps: [{ kind: 'apply-skill', skillId: 'no-such-skill' }],
        assumptions: [],
        warnings: [],
      },
      BUILTIN_SKILLS,
      { x: 0, y: 0 },
      123,
    );
    expect(built.nodes).toEqual([]);
    expect(built.missingSkillIds).toEqual(['no-such-skill']);
  });

  it('appendAgentCanvasPlan 只追加，不覆盖已有节点', () => {
    const doc = createEmptyCanvasDoc('p', '画布', 1);
    const built = buildAgentCanvasPlan(plan(), BUILTIN_SKILLS, { x: 0, y: 0 }, 123);
    const next = appendAgentCanvasPlan(doc, built, 124);
    expect(doc.nodes).toHaveLength(0);
    expect(next.nodes).toHaveLength(2);
    expect(next.edges).toHaveLength(1);
    expect(next.updatedAt).toBe(124);
  });
});

describe('S7-C2 Agent plan handoff', () => {
  it('合法计划可读、take 后清除；非法 JSON 不抛', () => {
    const storage = memoryStorage();
    expect(setAgentCanvasHandoff(plan(), storage)).toBe(true);
    expect(peekAgentCanvasHandoff(storage)?.intent).toBe('雨夜霓虹慢推');
    expect(takeAgentCanvasHandoff(storage)?.intent).toBe('雨夜霓虹慢推');
    expect(peekAgentCanvasHandoff(storage)).toBeNull();
    expect(parseAgentCanvasHandoff('{bad')).toBeNull();
    expect(parseAgentCanvasHandoff(JSON.stringify({ version: 2 }))).toBeNull();
    expect(() => clearAgentCanvasHandoff(storage)).not.toThrow();
  });
});
