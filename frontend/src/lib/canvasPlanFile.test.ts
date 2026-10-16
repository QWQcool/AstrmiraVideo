import { describe, expect, it } from 'vitest';
import {
  CANVAS_PLAN_VERSION,
  type CanvasPlan,
  type CanvasPlanEdge,
  type CanvasPlanNode,
} from '@astrmira/shared';
import {
  CANVAS_PLAN_FILE_KIND,
  buildCanvasPlanFile,
  canvasPlanFileText,
  planStructuralIssues,
  readCanvasPlanFile,
} from './canvasPlanFile';
import { PLAN_NODE_DEFAULTS, withNewPlanIdentity } from './canvasPlan';

/**
 * 编排文件 `astrmira.canvas-plan`（V2.35 / 台账 A5 片 B 收口）单测。
 *
 * 盯四件事（都是"错一次就白做"的）：
 * 1. **导出保真**：`plan` 原样（`runSeq` / `lastTaskId` / `pinnedTaskId` 一个不丢）+ 注记里写明"不含什么"；
 * 2. **导入的前向兼容**：未来版本明确拒绝（"请升级"）、无版本号按 v1 处理**并留痕**；
 * 3. **失败给人话原因**：坏 JSON / kind 不对 / 结构不符 / 悬挂边 / 重复 id / 自环 / 重复边
 *    —— 每一条都必须有**可读原因**（不是抛异常，也不是"解析失败"四个字）；
 * 4. **导入换新身份**：幂等键含 `planId`，同源两份编排共享 id 会在同一部署里互相命中对方的任务。
 */

function node(id: string, overrides: Partial<CanvasPlanNode> = {}): CanvasPlanNode {
  return { id, prompt: `提示词 ${id}`, ...PLAN_NODE_DEFAULTS, position: { x: 8, y: 9 }, ...overrides };
}

function plan(nodes: CanvasPlanNode[], edges: CanvasPlanEdge[] = []): CanvasPlan {
  return { version: CANVAS_PLAN_VERSION, id: 'plan-src', name: '客户 A 的编排', nodes, edges, updatedAt: 123 };
}

function edge(from: string, to: string): CanvasPlanEdge {
  return { id: `pedge-${from}-${to}`, from, to };
}

/** 组装一份**合法文件对象**（再按用例改写字段） */
function fileObject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...buildCanvasPlanFile(plan([node('a')]), { now: 1000 }), ...overrides };
}

describe('buildCanvasPlanFile / canvasPlanFileText（导出）', () => {
  it('组装：kind / version / exportedAt（可注入）/ notes / plan **原样**', () => {
    const source = plan([node('a', { lastTaskId: 'task-1', pinnedTaskId: 'task-2' })]);
    const file = buildCanvasPlanFile(source, { now: 4242 });
    expect(file.kind).toBe(CANVAS_PLAN_FILE_KIND);
    expect(file.version).toBe(CANVAS_PLAN_VERSION);
    expect(file.exportedAt).toBe(4242);
    // 保真：同一个引用（导出不是"抄一份"，而是把这份编排装进文件）
    expect(file.plan).toBe(source);
    expect(file.plan.nodes[0]?.lastTaskId).toBe('task-1');
    expect(file.plan.nodes[0]?.pinnedTaskId).toBe('task-2');
  });

  it('注记里写明"这份文件不含什么"（契约 §11-6 附 第 1 / 2 条）', () => {
    const file = buildCanvasPlanFile(plan([node('a')]));
    expect(file.notes.length).toBeGreaterThanOrEqual(3);
    const joined = file.notes.join(' ');
    expect(joined).toContain('只在本机部署有意义');
    expect(joined).toContain('不含凭据');
    expect(joined).toContain('不含媒体文件');
  });

  it('文本：缩进 + 尾换行，能原样解析回来', () => {
    const file = buildCanvasPlanFile(plan([node('a')]), { now: 7 });
    const text = canvasPlanFileText(file);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "kind"');
    expect(JSON.parse(text)).toEqual(file);
  });
});

describe('planStructuralIssues（schema 管不住的图结构）', () => {
  it('正常图（链）→ 没有问题', () => {
    expect(planStructuralIssues(plan([node('a'), node('b')], [edge('a', 'b')]))).toEqual([]);
  });

  it('重复节点 id', () => {
    const issues = planStructuralIssues(plan([node('a'), node('a')]));
    expect(issues[0]).toContain('重复的节点 id');
  });

  it('悬挂边（from / to 指向不存在的节点）', () => {
    const issues = planStructuralIssues(plan([node('a')], [edge('a', 'ghost'), edge('ghost', 'a')]));
    expect(issues.join(' ')).toContain('连到不存在节点的边');
  });

  it('自环', () => {
    const issues = planStructuralIssues(plan([node('a')], [edge('a', 'a')]));
    expect(issues.join(' ')).toContain('自环');
  });

  it('重复的边（同向同端点）', () => {
    const issues = planStructuralIssues(plan([node('a'), node('b')], [edge('a', 'b'), edge('a', 'b')]));
    expect(issues.join(' ')).toContain('重复的边');
  });
});

describe('readCanvasPlanFile（导入：成功路径）', () => {
  it('导出 → 导入 往返：编排原样回来（含产物 ID 与代数）', () => {
    const source = plan(
      [node('a', { lastTaskId: 'task-a', pinnedTaskId: 'task-pin' }), node('b')],
      [edge('a', 'b')],
    );
    const text = canvasPlanFileText(buildCanvasPlanFile({ ...source, runSeq: 3 }, { now: 1 }));
    const result = readCanvasPlanFile(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan).toEqual({ ...source, runSeq: 3 });
    expect(result.migratedFrom).toBeNull();
    // 文件里的注记要带给调用方（界面上逐条展示 —— 它就是"写给接收方的话"）
    expect(result.notes.length).toBeGreaterThanOrEqual(3);
  });

  it('没有版本号 → 按 v1 处理**并留痕**（不静默）', () => {
    const { version: _version, ...withoutVersion } = fileObject();
    const result = readCanvasPlanFile(JSON.stringify(withoutVersion));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notes[0]).toContain('没有版本号');
    // `migratedFrom` 的口径与 `migrateEditProject` 一致（§11-2 附）：
    // "按 v1 处理"落在**当前版本**上，不算迁移（留痕在 notes 里，界面照样会展示）
    expect(result.migratedFrom).toBeNull();
  });

  it('空编排（0 节点）也是合法文件（新建的编排就是空的）', () => {
    const result = readCanvasPlanFile(canvasPlanFileText(buildCanvasPlanFile(plan([]))));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.nodes).toEqual([]);
  });
});

describe('readCanvasPlanFile（导入：失败路径 —— 每一条都给可读原因）', () => {
  it('不是 JSON：说清"这不是 JSON"并给出该怎么做', () => {
    const result = readCanvasPlanFile('这显然不是 JSON');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('JSON');
    expect(result.reason).toContain('导出编排');
  });

  it('顶层不是对象（数组 / null / 数字）', () => {
    for (const raw of ['[]', 'null', '42']) {
      const result = readCanvasPlanFile(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('顶层不是对象');
    }
  });

  it('kind 缺失 / 不对（例如误选了配方包文件）', () => {
    const missing = readCanvasPlanFile(JSON.stringify({ version: 1, plan: {} }));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toContain('没有 kind 标识');

    const wrongKind = readCanvasPlanFile(
      JSON.stringify({ kind: 'astrmira.recipe-pack', version: 1, plan: {} }),
    );
    expect(wrongKind.ok).toBe(false);
    if (!wrongKind.ok) {
      // 误导性的提示比没有提示更糟：把"看到的是什么"如实说出来
      expect(wrongKind.reason).toContain('astrmira.recipe-pack');
      expect(wrongKind.reason).toContain(CANVAS_PLAN_FILE_KIND);
    }
  });

  it('来自更新的版本 → **明确拒绝**（照 §11-2 附 的前向兼容纪律）', () => {
    const result = readCanvasPlanFile(JSON.stringify(fileObject({ version: CANVAS_PLAN_VERSION + 1 })));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.futureVersion).toBe(CANVAS_PLAN_VERSION + 1);
    expect(result.reason).toContain('请升级');
  });

  it('plan 结构不符（nodes 不是数组）→ 原因里带路径', () => {
    // 只坏 nodes 一个字段：否则 zod 会先报更靠前的字段，测不到"原因带路径"这件事
    const broken = { ...plan([node('a')]), nodes: '不是数组' };
    const result = readCanvasPlanFile(JSON.stringify(fileObject({ plan: broken })));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('格式不对');
    expect(result.reason).toContain('nodes');
  });

  it('图不成立的四类：悬挂边 / 重复 id / 自环 / 重复边（**拒绝**而不是修好一半）', () => {
    const cases: Array<{ plan: CanvasPlan; expect: string }> = [
      { plan: plan([node('a')], [edge('a', 'ghost')]), expect: '连到不存在节点的边' },
      { plan: plan([node('a'), node('a')]), expect: '重复的节点 id' },
      { plan: plan([node('a')], [edge('a', 'a')]), expect: '自环' },
      { plan: plan([node('a'), node('b')], [edge('a', 'b'), edge('a', 'b')]), expect: '重复的边' },
    ];
    for (const item of cases) {
      const result = readCanvasPlanFile(canvasPlanFileText(buildCanvasPlanFile(item.plan)));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain('图不成立');
        expect(result.reason).toContain(item.expect);
      }
    }
  });
});

describe('withNewPlanIdentity（导入 = 新编排身份）', () => {
  it('只换 id：其余字段全等（产物 ID / 代数一个不动 —— 运行时的既有校验会如实处理它们）', () => {
    const source = plan([node('a', { lastTaskId: 'task-a' })], [edge('a', 'a')]);
    const adopted = withNewPlanIdentity(source, 999, 'plan-fixed');
    expect(adopted.id).toBe('plan-fixed');
    expect({ ...adopted, id: source.id }).toEqual(source);
  });

  it('默认 id 与来源不同（幂等键含 planId：同源两份编排不能共享它）', () => {
    const source = plan([node('a')]);
    expect(withNewPlanIdentity(source).id).not.toBe(source.id);
  });
});
