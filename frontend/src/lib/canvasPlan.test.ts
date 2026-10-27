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
  bumpPlanRun,
  canvasPlanKey,
  createEmptyPlan,
  loadCanvasPlan,
  movePlanNode,
  newPlanImageNode,
  newPlanNode,
  pinPlanNode,
  planDownstreamClosure,
  planExecutionOrder,
  planIdempotencyKey,
  planNodeBlockReason,
  planRetainedTaskId,
  planRunScope,
  planRunSeq,
  removePlanEdge,
  removePlanNode,
  saveCanvasPlan,
  toGenerateRequest,
  unpinPlanNode,
  updatePlanNode,
  withRunTaskIds,
} from './canvasPlan';
import { isRetryableSubmitError, runCanvasPlan } from './canvasPlanRunner';
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

/**
 * 假 submit（记录每次调用的**三件要紧事**：提交体 / 幂等键 / 本轮 runId）。
 *
 * 放在顶层而不是某个 describe 里：片 A 与片 B 两组执行器用例都要用（A5 片 B 新增
 * "部分重跑 / 重试"用例时才发现它被关在 describe 内部 —— 提上来，别再复制一份）。
 */
interface SubmitCall {
  body: VideoGenerateRequest;
  key: string;
  runId: string;
}

function recorder(
  fail?: (prompt: string) => boolean,
  queryTask?: (taskId: string) => Promise<{ status: string; outputVideoUrl?: string | null }>,
) {
  const calls: SubmitCall[] = [];
  const deps = {
    submit: async (body: VideoGenerateRequest, key: string, runId: string) => {
      const index = calls.length;
      calls.push({ body, key, runId });
      const marker = `task-${index}`;
      if (fail?.(body.prompt) === true) throw new Error(`上游拒了 ${marker}`);
      return { taskId: marker };
    },
    // 默认：任何任务都"已出片"（链式用例不必关心等待；等待的边界另有专门用例）
    queryTask:
      queryTask ??
      (async (taskId: string) => ({ status: 'succeeded', outputVideoUrl: `/media/${taskId}.mp4` })),
    now: () => 1234,
    sleep: () => Promise.resolve(),
  };
  return { calls, deps };
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
    expect(planNodeBlockReason(graph, 't2v-with-in')).toContain('不消费上游');
    expect(planNodeBlockReason(graph, 'v2v-with-two')).toContain('接**一个**上游');
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

/**
 * A5 片 B（V2.29 / B68 + B69 + B74）：**重跑与部分重跑**。
 *
 * 这一组盯的全是"钱"：什么时候**不该**新建任务（幂等）、什么时候**必须**新建（显式重跑）、
 * 以及"上游失败但有旧产物"这种夹缝里**绝不能**悄悄接上去（那是让人误判产物来源）。
 */
describe('画布编排 · 重跑与部分重跑（A5 片 B）', () => {
  it('幂等键随代数变化：第 1 代沿用老格式（片 A 建的任务仍是第 1 代），第 2 代起带 rN', () => {
    expect(planIdempotencyKey('p1', 'n1')).toBe('plan:p1:n1');
    expect(planIdempotencyKey('p1', 'n1', 1)).toBe('plan:p1:n1');
    expect(planIdempotencyKey('p1', 'n1', 2)).toBe('plan:p1:n1:r2');
  });

  it('老编排（没有 runSeq 字段）读作第 1 代 —— 升级后重复点「运行」仍幂等命中片 A 建的任务', () => {
    expect(planRunSeq(plan([node('a')]))).toBe(1);
  });

  it('bumpPlanRun：代数 +1、updatedAt 更新，键随之全变（"真的新建任务"的开关）', () => {
    const before = plan([node('a')]);
    const after = bumpPlanRun(before, 77);
    expect(planRunSeq(after)).toBe(2);
    expect(after.updatedAt).toBe(77);
    expect(planIdempotencyKey(after.id, 'a', planRunSeq(after))).not.toBe(
      planIdempotencyKey(before.id, 'a'),
    );
  });

  it('下游闭包：改了一个节点，它和**它的全部下游**都得重跑（只跑自己 = 下游接旧产物）', () => {
    const graph = plan(
      [node('a'), node('b', { mode: 'v2v' }), node('c', { mode: 'v2v' }), node('loose')],
      [edge('a', 'b'), edge('b', 'c')],
    );
    expect([...planDownstreamClosure(graph, ['a'])].sort()).toEqual(['a', 'b', 'c']);
    expect([...planDownstreamClosure(graph, ['b'])].sort()).toEqual(['b', 'c']);
    expect([...planDownstreamClosure(graph, ['loose'])].sort()).toEqual(['loose']);
  });

  it('planRunScope：不传 = 全部提交；传 [b] = 提交 {b,c}、a 保留', () => {
    const graph = plan(
      [node('a'), node('b', { mode: 'v2v' }), node('c', { mode: 'v2v' })],
      [edge('a', 'b'), edge('b', 'c')],
    );
    const all = planRunScope(graph);
    expect([...all.submit].sort()).toEqual(['a', 'b', 'c']);
    expect([...all.keep]).toEqual([]);

    const partial = planRunScope(graph, ['b']);
    expect([...partial.submit].sort()).toEqual(['b', 'c']);
    expect([...partial.keep]).toEqual(['a']);
    expect([...partial.pinnedOverride]).toEqual([]);
  });

  it('固定的节点**永不提交**（即使被选中），并在 pinnedOverride 里如实报出来', () => {
    const graph = pinPlanNode(
      plan([node('a'), node('b', { mode: 'v2v' })], [edge('a', 'b')]),
      'a',
      'task-pinned',
    );
    const scope = planRunScope(graph, ['a']);
    expect([...scope.submit]).toEqual(['b']);
    expect([...scope.pinnedOverride]).toEqual(['a']);
    // 「重跑全部」也一样：固定的不提交
    expect([...planRunScope(graph).submit]).toEqual(['b']);
  });

  it('产物引用的优先序：固定 > 上次产物；都没有 = 拿不出引用', () => {
    const withLast = node('a', { lastTaskId: 'task-last' });
    expect(planRetainedTaskId(withLast)).toBe('task-last');
    expect(planRetainedTaskId({ ...withLast, pinnedTaskId: 'task-pin' })).toBe('task-pin');
    expect(planRetainedTaskId(node('b'))).toBeNull();
  });

  it('取消固定 → 回落到上次产物（不是把 lastTaskId 一起删掉）', () => {
    const graph = pinPlanNode(plan([node('a', { lastTaskId: 'task-last' })]), 'a', 'task-pin');
    const back = unpinPlanNode(graph, 'a', 9);
    expect(planRetainedTaskId(back.nodes[0] as CanvasPlanNode)).toBe('task-last');
    expect(back.updatedAt).toBe(9);
  });

  it('withRunTaskIds：只写回**提交成功**的节点（失败的不该留下假产物记录）', () => {
    const graph = plan([node('a'), node('b')]);
    const next = withRunTaskIds(graph, new Map([['a', 'task-a']]), 5);
    expect(next.nodes[0]?.lastTaskId).toBe('task-a');
    expect(next.nodes[1]?.lastTaskId).toBeUndefined();
    expect(next.updatedAt).toBe(5);
    // 空 map → 原样返回同一个对象（不发无谓的状态更新）
    expect(withRunTaskIds(graph, new Map())).toBe(graph);
  });

  it('部分重跑：范围外节点 kept，下游用它的 lastTaskId 作引用（**不重新提交它**）', async () => {
    const graph = withRunTaskIds(
      plan([node('a'), node('b', { prompt: '重跑这一段', mode: 'v2v' })], [edge('a', 'b')]),
      new Map([['a', 'task-a-old']]),
    );
    const { calls, deps } = recorder();
    const outcome = await runCanvasPlan(graph, { ...deps, scope: ['b'] });

    expect(calls).toHaveLength(1); // 只提交 b —— a 沿用上次产物
    expect(calls[0]?.body.prompt).toBe('重跑这一段');
    expect(calls[0]?.body.assets).toEqual({ referenceVideo: 'task:task-a-old' });
    expect(outcome.results.find((item) => item.nodeId === 'a')?.state).toBe('kept');
    expect(outcome.results.find((item) => item.nodeId === 'b')?.state).toBe('submitted');
  });

  it('范围外上游**没有**产物记录 → 下游 skipped 并说清怎么办（先单独跑一次它，或固定它）', async () => {
    const graph = plan([node('a'), node('b', { mode: 'v2v' })], [edge('a', 'b')]);
    const { calls, deps } = recorder();
    const outcome = await runCanvasPlan(graph, { ...deps, scope: ['b'] });

    expect(calls).toHaveLength(0);
    expect(outcome.results.find((item) => item.nodeId === 'b')?.message).toContain('先单独跑一次它');
  });

  it('上游本轮失败、但上一轮有产物 → 下游**仍然 skipped**（绝不悄悄接在旧产物上跑）', async () => {
    const graph = withRunTaskIds(
      plan([node('a', { prompt: '会失败' }), node('b', { prompt: '下游', mode: 'v2v' })], [edge('a', 'b')]),
      new Map([['a', 'task-a-old']]),
    );
    const { calls, deps } = recorder((prompt) => prompt === '会失败');
    const outcome = await runCanvasPlan(graph, deps);

    expect(calls).toHaveLength(1);
    expect(outcome.results.find((item) => item.nodeId === 'b')?.message).toContain('上游没有提交成功');
  });

  // V2.35（A5 片 B 收口）：导入的编排会带来"引用的任务在本部署里不存在"——
  // 它必须是**如实跳过 + 可执行的下一步**，而不是让异常冒出去把整轮运行中断成"运行失败：HTTP 404"。
  it('引用的产物在本服务上**不存在** → 下游 skipped 并给可执行下一步（不中断整轮运行）', async () => {
    const graph = withRunTaskIds(
      plan([node('a'), node('b', { mode: 'v2v' })], [edge('a', 'b')]),
      new Map([['a', 'task-imported']]),
    );
    const { calls, deps } = recorder(undefined, async (taskId) => {
      const error = new Error(`任务不存在：${taskId}`) as Error & { status: number };
      error.status = 404;
      throw error;
    });
    const outcome = await runCanvasPlan(graph, { ...deps, scope: ['b'] });

    expect(calls).toHaveLength(0); // 不带着一条不存在的引用去提交（那会被服务端在提交那一刻挡回）
    const downstream = outcome.results.find((item) => item.nodeId === 'b');
    expect(downstream?.state).toBe('skipped');
    expect(downstream?.message).toContain('不存在');
    expect(downstream?.message).toContain('取消固定'); // 给的是下一步，不是一句裸的 HTTP 404
  });

  it('查询引用产物**失败**（非 404，如网络抖动）→ 同样 skipped + 可执行原因（不抛出去中断整轮）', async () => {
    const graph = withRunTaskIds(
      plan([node('a'), node('b', { mode: 'v2v' })], [edge('a', 'b')]),
      new Map([['a', 'task-a-old']]),
    );
    const { deps } = recorder(undefined, async () => {
      throw new Error('HTTP 500（/api/tasks/x）');
    });
    const outcome = await runCanvasPlan(graph, { ...deps, scope: ['b'] });
    const downstream = outcome.results.find((item) => item.nodeId === 'b');
    expect(downstream?.state).toBe('skipped');
    expect(downstream?.message).toContain('稍后重试');
  });

  it('重跑（代数 +1）→ 键带 rN：这才是"真的新建任务"', async () => {
    const graph = bumpPlanRun(plan([node('a')]), 1);
    const { calls, deps } = recorder();
    const outcome = await runCanvasPlan(graph, deps);

    expect(calls[0]?.key).toBe('plan:plan-test:a:r2');
    expect(outcome.runSeq).toBe(2);
  });

  it('节点级重试：5xx 会重试到成功，且**沿用同一个幂等键**（换键 = 重复计费）', async () => {
    const graph = plan([node('a', { retry: { maxAttempts: 3, backoffMs: 0 } })]);
    const keys: string[] = [];
    let attempt = 0;
    const outcome = await runCanvasPlan(graph, {
      submit: async (_body, key) => {
        keys.push(key);
        attempt += 1;
        if (attempt < 3) throw new Error('提交失败：HTTP 503 Service Unavailable');
        return { taskId: 'task-ok' };
      },
      sleep: () => Promise.resolve(),
      now: () => 1,
    });

    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1); // 同一个键：这次重试绝不会变成第二条任务
    expect(outcome.results[0]).toMatchObject({ state: 'submitted', taskId: 'task-ok' });
  });

  it('重试用尽 → failed，且**不多试**（次数正好 = maxAttempts）', async () => {
    const graph = plan([node('a', { retry: { maxAttempts: 2, backoffMs: 0 } })]);
    let calls = 0;
    const outcome = await runCanvasPlan(graph, {
      submit: async () => {
        calls += 1;
        throw new Error('HTTP 500 Internal Server Error');
      },
      sleep: () => Promise.resolve(),
      now: () => 1,
    });

    expect(calls).toBe(2);
    expect(outcome.results[0]?.state).toBe('failed');
  });

  it('重试的判据：5xx / 网络层重试；4xx / 429 / 认不出的**一律不重试**', () => {
    expect(isRetryableSubmitError(new Error('HTTP 503 Service Unavailable'))).toBe(true);
    expect(isRetryableSubmitError(new Error('Failed to fetch'))).toBe(true);
    expect(isRetryableSubmitError(new Error('HTTP 400 Bad Request'))).toBe(false);
    // 429 是"等一下再点"，不是"再试一次"（自动重试只会连撞防线）
    expect(isRetryableSubmitError(new Error('HTTP 429 Too Many Requests'))).toBe(false);
    // 认不出来 → 不重试：宁可如实失败，也不做"悄悄多花一次钱"的猜测
    expect(isRetryableSubmitError(new Error('上游拒了 task-0'))).toBe(false);
  });

  it('429 撞上冷却时，即使配了重试也只提交一次（冷却的语义是"等"）', async () => {
    const graph = plan([node('a', { retry: { maxAttempts: 3, backoffMs: 0 } })]);
    let calls = 0;
    await runCanvasPlan(graph, {
      submit: async () => {
        calls += 1;
        throw new Error('提交过于频繁：HTTP 429 Too Many Requests');
      },
      sleep: () => Promise.resolve(),
      now: () => 1,
    });

    expect(calls).toBe(1);
  });
});

describe('V2.88：图片节点接上游（D-1，3 节点 2 边可真的跑）', () => {
  it('t2i 默认档是本地 ComfyUI + 1:1（云端没有 t2i 通道，默认给云端就是一建就不可提交）', () => {
    const created = newPlanImageNode({ x: 0, y: 0 }, 7);
    expect(created).toMatchObject({ mode: 't2i', aspectRatio: '1:1', provider: 'host-comfyui' });
    expect(created.durationSec).toBeUndefined();
  });

  it('t2i 允许一个上游；两个上游仍然拒绝（不猜）', () => {
    const ok = plan([node('a'), node('b', { mode: 't2i', provider: 'host-comfyui' })], [edge('a', 'b')]);
    expect(planNodeBlockReason(ok, 'b')).toBeNull();

    const two = plan(
      [node('a'), node('x'), node('b', { mode: 't2i' })],
      [edge('a', 'b'), edge('x', 'b')],
    );
    expect(planNodeBlockReason(two, 'b')).toContain('接**一个**上游');
  });

  it('t2i 的上游走 assets.firstFrameImage（图片派生编辑），不是 referenceVideo', () => {
    const request = toGenerateRequest(
      node('b', { mode: 't2i', provider: 'host-comfyui' }),
      'task-9',
    );
    expect(request.assets).toEqual({ firstFrameImage: 'task:task-9' });
    expect(request.mode).toBe('t2i');
  });

  it('上游出图（只有 outputImageUrl）也算"有产物"——否则图片链永远等不到', async () => {
    const graph = plan(
      [
        node('a', { mode: 't2i', provider: 'host-comfyui' }),
        node('b', { mode: 't2i', provider: 'host-comfyui' }),
      ],
      [edge('a', 'b')],
    );
    const { calls, deps } = recorder(undefined, async () => ({
      status: 'succeeded',
      outputImageUrl: '/media/a.png',
    }));
    const outcome = await runCanvasPlan(graph, deps);

    expect(calls).toHaveLength(2);
    expect(calls[1]?.body.assets).toEqual({ firstFrameImage: 'task:task-0' });
    expect(outcome.results.every((item) => item.state === 'submitted')).toBe(true);
  });

  it('上游成功了但没有图（只有视频产物）→ 下游 skipped，不带着空引用去提交', async () => {
    const graph = plan(
      [
        node('a', { mode: 't2i' }),
        node('b', { mode: 't2i' }),
      ],
      [edge('a', 'b')],
    );
    const { calls, deps } = recorder(undefined, async () => ({ status: 'succeeded' }));
    const outcome = await runCanvasPlan(graph, deps);

    expect(calls).toHaveLength(1);
    expect(outcome.results[1]).toMatchObject({ nodeId: 'b', state: 'skipped' });
    expect(outcome.results[1]?.message).toContain('没有成片');
  });
});
