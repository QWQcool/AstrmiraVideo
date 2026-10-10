import { describe, expect, it } from 'vitest';
import {
  CANVAS_PLAN_VERSION,
  type CanvasPlan,
  type CanvasPlanEdge,
  type CanvasPlanNode,
  type VideoGenerateRequest,
} from '@astrmira/shared';
import {
  PLAN_NODE_DEFAULTS,
  addPlanEdge,
  addPlanNode,
  canvasPlanKey,
  createEmptyPlan,
  loadCanvasPlan,
  movePlanNode,
  newPlanNode,
  planExecutionOrder,
  planIdempotencyKey,
  planNodeBlockReason,
  removePlanEdge,
  removePlanNode,
  saveCanvasPlan,
  toGenerateRequest,
  updatePlanNode,
} from './canvasPlan';
import { runCanvasPlan } from './canvasPlanRunner';
import type { StorageLike } from './storage';

/**
 * 画布编排（V2.26 / 台账 A5 片 A）单测。
 *
 * 盯四件事：**编辑操作的自洽**（删节点连带删边、连线的三种拒绝）、
 * **执行序与环**、**阻断原因**（不猜上游）、**执行器的幂等键与顺序**（错一次就是真花钱）。
 */

function node(id: string, overrides: Partial<CanvasPlanNode> = {}): CanvasPlanNode {
  return { id, prompt: `提示词 ${id}`, ...PLAN_NODE_DEFAULTS, position: { x: 0, y: 0 }, ...overrides };
}

function plan(nodes: CanvasPlanNode[], edges: CanvasPlanEdge[] = []): CanvasPlan {
  return { version: CANVAS_PLAN_VERSION, id: 'plan-test', name: '测试编排', nodes, edges, updatedAt: 0 };
}

function edge(from: string, to: string): CanvasPlanEdge {
  return { id: `pedge-${from}-${to}`, from, to };
}

function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

describe('画布编排 · 模型与编辑（A5 片 A）', () => {
  it('新建节点带默认档（5s / 16:9 / 云端 seedance / t2v）', () => {
    const created = newPlanNode({ x: 10, y: 20 }, 123);
    expect(created).toMatchObject({ mode: 't2v', aspectRatio: '16:9', durationSec: 5, position: { x: 10, y: 20 } });
    expect(created.prompt).toBe('');
    expect(created.provider).toBe(PLAN_NODE_DEFAULTS.provider);
  });

  it('改节点参数：只动指定节点，其余不变', () => {
    const before = plan([node('a'), node('b')]);
    const after = updatePlanNode(before, 'b', { prompt: '新的词', mode: 'v2v' });
    expect(after.nodes.find((item) => item.id === 'b')).toMatchObject({ prompt: '新的词', mode: 'v2v' });
    expect(after.nodes.find((item) => item.id === 'a')?.prompt).toBe('提示词 a');
  });

  it('删节点**连带删掉它的所有边**（不留悬挂边）', () => {
    const before = plan([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('b', 'c')]);
    const after = removePlanNode(before, 'b');
    expect(after.nodes.map((item) => item.id)).toEqual(['a', 'c']);
    expect(after.edges).toEqual([]);
  });

  it('连线：正常成功；自环 / 重复 / 不存在的节点三种拒绝都返回原 plan', () => {
    const before = plan([node('a'), node('b')]);
    const linked = addPlanEdge(before, 'a', 'b');
    expect(linked.edges).toHaveLength(1);

    expect(addPlanEdge(linked, 'a', 'b').edges).toHaveLength(1); // 重复
    expect(addPlanEdge(before, 'a', 'a').edges).toHaveLength(0); // 自环
    expect(addPlanEdge(before, 'a', 'ghost').edges).toHaveLength(0); // 不存在
  });

  it('删边与移节点', () => {
    const before = plan([node('a')], [edge('a', 'b')]);
    expect(removePlanEdge(before, 'pedge-a-b').edges).toEqual([]);
    const moved = movePlanNode(before, 'a', { x: 99, y: -5 });
    expect(moved.nodes[0]?.position).toEqual({ x: 99, y: -5 });
  });

  it('存储往返：按项目隔离；坏数据 → broken（**不冒充空编排**）', () => {
    const storage = memoryStorage();
    const access = { local: storage };
    expect(canvasPlanKey('p1')).not.toBe(canvasPlanKey('p2'));

    const saved = plan([node('a')]);
    saveCanvasPlan('p1', saved, access);
    const loaded = loadCanvasPlan('p1', access);
    expect(loaded.broken).toBe(false);
    expect(loaded.plan?.nodes.map((item) => item.id)).toEqual(['a']);
    expect(loadCanvasPlan('p2', access)).toEqual({ plan: null, broken: false });

    storage.setItem(canvasPlanKey('p1'), '{"version":999}');
    expect(loadCanvasPlan('p1', access)).toEqual({ plan: null, broken: true });
  });

  it('createEmptyPlan：空图 + 自带 id（幂等键的组成部分）', () => {
    const empty = createEmptyPlan(1000, 'plan-fixed');
    expect(empty).toMatchObject({ version: CANVAS_PLAN_VERSION, id: 'plan-fixed', nodes: [], edges: [] });
  });

  it('addPlanNode 追加在末尾', () => {
    const after = addPlanNode(createEmptyPlan(), node('a'));
    expect(after.nodes.map((item) => item.id)).toEqual(['a']);
  });
});

describe('画布编排 · 执行序与阻断', () => {
  it('拓扑序：上游先于下游（a → b → c 的提交顺序固定）', () => {
    const graph = plan([node('c'), node('a'), node('b')], [edge('a', 'b'), edge('b', 'c')]);
    const { order, cycle } = planExecutionOrder(graph);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(cycle).toEqual([]);
  });

  it('同层按 nodes 顺序（确定性：同一张图每次跑的顺序一致）', () => {
    const graph = plan([node('x'), node('y'), node('z')]);
    expect(planExecutionOrder(graph).order).toEqual(['x', 'y', 'z']);
  });

  it('环 → cycle 列出参与的节点（整体拒绝执行的依据）', () => {
    const graph = plan([node('a'), node('b')], [edge('a', 'b'), edge('b', 'a')]);
    const { order, cycle } = planExecutionOrder(graph);
    expect(order).toEqual([]);
    expect(cycle.sort()).toEqual(['a', 'b']);
  });

  it('阻断原因逐条说清（空提示词 / 不支持的模式 / 非 v2v 带入边 / v2v 多入边）', () => {
    const graph = plan(
      [
        node('up1'),
        node('up2'),
        node('empty', { prompt: '   ' }),
        node('bad-mode', { mode: 'i2v' }),
        node('t2v-with-in', { mode: 't2v' }),
        node('v2v-with-two', { mode: 'v2v' }),
      ],
      [edge('up1', 't2v-with-in'), edge('up1', 'v2v-with-two'), edge('up2', 'v2v-with-two')],
    );

    expect(planNodeBlockReason(graph, 'empty')).toContain('提示词为空');
    expect(planNodeBlockReason(graph, 'bad-mode')).toContain('不受编排支持');
    expect(planNodeBlockReason(graph, 't2v-with-in')).toContain('只有 v2v');
    expect(planNodeBlockReason(graph, 'v2v-with-two')).toContain('只能接一个上游');
    expect(planNodeBlockReason(graph, 'up1')).toBeNull();
  });

  it('组装提交体：t2v 无 assets；v2v 带 task: 引用；params 只在有值时出现', () => {
    const bare = toGenerateRequest(node('a'));
    expect(bare.assets).toBeUndefined();
    expect(bare.params).toEqual({ durationSec: 5 }); // 默认档 5s

    const noParams = toGenerateRequest(node('c', { durationSec: undefined }));
    expect(noParams.params).toBeUndefined(); // 真的没有值时才省略（不是"传了 0/undefined 就算有"）

    const v2v = toGenerateRequest(node('b', { mode: 'v2v', seed: 7 }), 'task-42');
    expect(v2v.assets).toEqual({ referenceVideo: 'task:task-42' });
    expect(v2v.params).toEqual({ durationSec: 5, seed: 7 });
  });

  it('幂等键确定性：同 plan + 同节点 = 同键（连点两次运行不会重复计费）', () => {
    expect(planIdempotencyKey('p1', 'n1')).toBe(planIdempotencyKey('p1', 'n1'));
    expect(planIdempotencyKey('p1', 'n1')).not.toBe(planIdempotencyKey('p1', 'n2'));
    expect(planIdempotencyKey('p1', 'n1')).not.toBe(planIdempotencyKey('p2', 'n1'));
    expect(planIdempotencyKey('p1', 'n1')).toMatch(/^plan:/);
  });
});

describe('画布编排 · 执行器（注入 submit）', () => {
  interface Call {
    body: VideoGenerateRequest;
    key: string;
    runId: string;
  }

  function recorder(
    fail?: (nodeId: string) => boolean,
    queryTask?: (taskId: string) => Promise<{ status: string; outputVideoUrl?: string | null }>,
  ) {
    const calls: Call[] = [];
    const deps = {
      submit: async (body: VideoGenerateRequest, key: string, runId: string) => {
        const index = calls.length;
        calls.push({ body, key, runId });
        const marker = `task-${index}`;
        if (fail?.(body.prompt) === true) throw new Error(`上游拒了 ${marker}`);
        return { taskId: marker };
      },
      // 默认：任何任务都"已出片"（链式用例不必关心等待；等待的边界另有专门用例）
      queryTask: queryTask ?? (async (taskId: string) => ({ status: 'succeeded', outputVideoUrl: `/media/${taskId}.mp4` })),
      now: () => 1234,
      sleep: () => Promise.resolve(),
    };
    return { calls, deps };
  }

  it('链式执行：按序提交，v2v 下游拿到上游 task: 引用，结果带 taskId', async () => {
    const graph = plan(
      [node('a', { prompt: '生成 A' }), node('b', { prompt: '参考 A', mode: 'v2v' })],
      [edge('a', 'b')],
    );
    const { calls, deps } = recorder();
    const outcome = await runCanvasPlan(graph, deps);

    expect(outcome.order).toEqual(['a', 'b']);
    expect(calls.map((call) => call.body.prompt)).toEqual(['生成 A', '参考 A']);
    expect(calls[1]?.body.assets).toEqual({ referenceVideo: 'task:task-0' });
    expect(calls.map((call) => call.key)).toEqual([
      planIdempotencyKey('plan-test', 'a'),
      planIdempotencyKey('plan-test', 'b'),
    ]);
    // 整轮运行**共用同一个 runId**（服务端按它把一串节点当成一次有意动作）
    expect(calls[0]?.runId).toBe(calls[1]?.runId);
    expect(calls[0]?.runId).toBe('plan-test-1234');
    expect(outcome.results).toEqual([
      { nodeId: 'a', state: 'submitted', taskId: 'task-0' },
      { nodeId: 'b', state: 'submitted', taskId: 'task-1' },
    ]);
  });

  it('环 → **一个都不提交**（cycle 列出节点）', async () => {
    const graph = plan([node('a'), node('b')], [edge('a', 'b'), edge('b', 'a')]);
    const { calls, deps } = recorder();
    const outcome = await runCanvasPlan(graph, deps);
    expect(calls).toHaveLength(0);
    expect(outcome.cycle.sort()).toEqual(['a', 'b']);
    expect(outcome.results).toEqual([]);
  });

  it('上游失败 → 下游 skipped（不带着错误输入去跑），失败原因如实带出', async () => {
    const graph = plan(
      [node('a', { prompt: '会失败' }), node('b', { prompt: '下游', mode: 'v2v' })],
      [edge('a', 'b')],
    );
    const { calls, deps } = recorder((prompt) => prompt === '会失败');
    const outcome = await runCanvasPlan(graph, deps);

    expect(calls).toHaveLength(1); // 下游没被提交
    expect(outcome.results[0]).toMatchObject({ nodeId: 'a', state: 'failed' });
    expect(outcome.results[0]?.message).toContain('上游拒了');
    expect(outcome.results[1]).toMatchObject({ nodeId: 'b', state: 'skipped' });
    expect(outcome.results[1]?.message).toContain('上游没有提交成功');
  });

  it('有上游的节点会**等上游出片**（running → succeeded 之后才提交下游）', async () => {
    const graph = plan(
      [node('a'), node('b', { prompt: '下游', mode: 'v2v' })],
      [edge('a', 'b')],
    );
    let polls = 0;
    const { calls, deps } = recorder(undefined, async () => {
      polls += 1;
      // 前两次还在跑，第三次出片
      return polls < 3 ? { status: 'running' } : { status: 'succeeded', outputVideoUrl: '/media/a.mp4' };
    });
    const outcome = await runCanvasPlan(graph, deps);

    expect(polls).toBe(3); // 真的轮询了（不是"提交即引用"）
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body.assets).toEqual({ referenceVideo: 'task:task-0' });
    expect(outcome.results[1]).toMatchObject({ state: 'submitted' });
  });

  it('上游以 failed 结束 → 下游 skipped（不带着一条没有成片的引用去提交）', async () => {
    const graph = plan(
      [node('a'), node('b', { prompt: '下游', mode: 'v2v' })],
      [edge('a', 'b')],
    );
    const { calls, deps } = recorder(undefined, async () => ({ status: 'failed' }));
    const outcome = await runCanvasPlan(graph, deps);

    expect(calls).toHaveLength(1); // 只提交了 a
    expect(outcome.results[1]).toMatchObject({ nodeId: 'b', state: 'skipped' });
    expect(outcome.results[1]?.message).toContain('failed');
  });

  it('等上游超时 → 下游 skipped 并给出可执行提示（本地轨可能很久）', async () => {
    const graph = plan(
      [node('a'), node('b', { prompt: '下游', mode: 'v2v' })],
      [edge('a', 'b')],
    );
    let clock = 0;
    const { calls, deps } = recorder(undefined, async () => ({ status: 'queued' }));
    const outcome = await runCanvasPlan(graph, {
      ...deps,
      now: () => (clock += 1000),
      waitTimeoutMs: 5000,
      pollIntervalMs: 1000,
    });

    expect(calls).toHaveLength(1);
    expect(outcome.results[1]).toMatchObject({ nodeId: 'b', state: 'skipped' });
    expect(outcome.results[1]?.message).toContain('超时');
    expect(outcome.results[1]?.message).toContain('再点一次运行');
  });

  it('被阻断的节点 skipped 且不提交（空提示词不进网络层）', async () => {
    const graph = plan([node('blank', { prompt: '' }), node('ok')]);
    const { calls, deps } = recorder();
    const outcome = await runCanvasPlan(graph, deps);

    expect(calls).toHaveLength(1);
    expect(outcome.results[0]).toMatchObject({ nodeId: 'blank', state: 'skipped' });
    expect(outcome.results[1]).toMatchObject({ nodeId: 'ok', state: 'submitted' });
  });

  it('幂等键确定性可观测：同一 plan 跑两次，两次提交的键完全相同', async () => {
    const graph = plan([node('a')]);
    const first = recorder();
    const second = recorder();
    await runCanvasPlan(graph, first.deps);
    await runCanvasPlan(graph, second.deps);
    expect(first.calls[0]?.key).toBe(second.calls[0]?.key);
  });

  it('幂等键与运行 id 是两件事：同一 plan 两次运行 → 键相同、runId 可以不同', async () => {
    const graph = plan([node('a')]);
    const runA = recorder();
    await runCanvasPlan(graph, runA.deps);

    const runB = recorder();
    await runCanvasPlan(graph, { ...runB.deps, now: () => 9999 });

    expect(runA.calls[0]?.key).toBe(runB.calls[0]?.key); // 键不动（去重与省钱靠它）
    expect(runA.calls[0]?.runId).not.toBe(runB.calls[0]?.runId); // runId 每轮新生成（冷却豁免的边界）
  });
});
