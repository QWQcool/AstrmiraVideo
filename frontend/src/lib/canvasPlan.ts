import {
  CANVAS_PLAN_VERSION,
  CanvasPlanSchema,
  PLAN_IDEMPOTENCY_PREFIX,
  TASK_REF_PREFIX,
  type CanvasPlan,
  type CanvasPlanEdge,
  type CanvasPlanNode,
  type VideoGenerateRequest,
} from '@astrmira/shared';
import { STORAGE_KEYS, browserStorage, readLocal, writeLocal, type StorageAccess } from './storage';

/**
 * 画布编排（CONTRACT §11-6 / V2.26；台账 A5 片 A，D50 定格 (b) 编排即可执行）。
 *
 * ## 这一层负责什么
 * 编排的**模型与编辑**（加/删/改/连线）与**本机存储**；执行驱动在 `canvasPlanRunner.ts`
 * （那里注入 submit 以便单测）。所有函数都是纯的（`now()` 可注入），组件只留 state 与 UI。
 *
 * ## 三条口径（与契约 §11-6 一一对应）
 * 1. **编排是本地产物**：按项目隔离存在 `astrmira.canvasPlan.<projectId>`，**不进服务端**；
 * 2. **幂等键确定性**：`plan:<planId>:<nodeId>` —— 连点「运行」不重复计费（见 `planIdempotencyKey`）；
 * 3. **不猜上游**：`planNodeBlockReason` 把"这条节点为什么不能跑"逐条说清（空提示词 / 非 v2v 带入边 /
 *    v2v 多入边 / 片 A 不支持 i2v·fl2v），**执行器只跑能说清为什么能跑的节点**。
 */

/** 新建节点的参数默认值（与工作台一致的默认档：5s / 16:9 / 云端 seedance） */
export const PLAN_NODE_DEFAULTS = {
  mode: 't2v',
  aspectRatio: '16:9',
  provider: 'cloud-volcano-seedance',
  durationSec: 5,
} as const satisfies Pick<CanvasPlanNode, 'mode' | 'aspectRatio' | 'provider' | 'durationSec'>;

/** 片 A 的编排**只支持两种模式**（i2v / fl2v 需要素材槽 —— 编排里没有素材选择，如实不支持） */
export const PLAN_SUPPORTED_MODES: ReadonlyArray<CanvasPlanNode['mode']> = ['t2v', 'v2v'];

export function canvasPlanKey(projectId: string): string {
  return `${STORAGE_KEYS.canvasPlanPrefix}${projectId}`;
}

export function createEmptyPlan(now = Date.now(), id = `plan-${now}-${Math.random().toString(36).slice(2, 8)}`): CanvasPlan {
  return { version: CANVAS_PLAN_VERSION, id, name: '未命名编排', nodes: [], edges: [], updatedAt: now };
}

/** 新建一个节点（位置由调用方给：通常是当前视口中心 —— 落在看不见的地方等于没建） */
export function newPlanNode(position: { x: number; y: number }, now = Date.now()): CanvasPlanNode {
  return {
    id: `pnode-${now}-${Math.random().toString(36).slice(2, 8)}`,
    prompt: '',
    ...PLAN_NODE_DEFAULTS,
    position,
  };
}

export function addPlanNode(plan: CanvasPlan, node: CanvasPlanNode, now = Date.now()): CanvasPlan {
  return { ...plan, nodes: [...plan.nodes, node], updatedAt: now };
}

export function updatePlanNode(
  plan: CanvasPlan,
  nodeId: string,
  patch: Partial<Omit<CanvasPlanNode, 'id' | 'position'>>,
  now = Date.now(),
): CanvasPlan {
  return {
    ...plan,
    nodes: plan.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
    updatedAt: now,
  };
}

/** 删节点**连带删掉它的所有边**（留下悬挂边 = 图上画着一条连不到东西的线） */
export function removePlanNode(plan: CanvasPlan, nodeId: string, now = Date.now()): CanvasPlan {
  return {
    ...plan,
    nodes: plan.nodes.filter((node) => node.id !== nodeId),
    edges: plan.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId),
    updatedAt: now,
  };
}

export function movePlanNode(
  plan: CanvasPlan,
  nodeId: string,
  position: { x: number; y: number },
  now = Date.now(),
): CanvasPlan {
  return {
    ...plan,
    nodes: plan.nodes.map((node) => (node.id === nodeId ? { ...node, position } : node)),
    updatedAt: now,
  };
}

/**
 * 连线（数据流：`from` 的产物喂给 `to`）。
 *
 * 两条拒绝（都是"不静默"的具体化）：**自环**（自己喂自己，语义上无解）与重复边（同向同端点）。
 * 拒绝时返回原 plan —— 调用方据此可以什么都不做（UI 上就是"连不上"）。
 */
export function addPlanEdge(plan: CanvasPlan, from: string, to: string, now = Date.now()): CanvasPlan {
  if (from === to) return plan;
  if (!plan.nodes.some((node) => node.id === from) || !plan.nodes.some((node) => node.id === to)) {
    return plan;
  }
  if (plan.edges.some((edge) => edge.from === from && edge.to === to)) return plan;
  const edge: CanvasPlanEdge = { id: `pedge-${from}-${to}`, from, to };
  return { ...plan, edges: [...plan.edges, edge], updatedAt: now };
}

export function removePlanEdge(plan: CanvasPlan, edgeId: string, now = Date.now()): CanvasPlan {
  return { ...plan, edges: plan.edges.filter((edge) => edge.id !== edgeId), updatedAt: now };
}

/**
 * 拓扑序（Kahn）。**同层按 `plan.nodes` 顺序入队**（确定性：同样一张图每次跑的顺序一致，
 * 断言与"重复运行幂等"都依赖它）。
 *
 * 返回 `cycle` = 排序失败时剩下的节点（**整体拒绝执行**的依据：环上跑任何一条都可能烧钱）。
 */
export function planExecutionOrder(plan: CanvasPlan): { order: string[]; cycle: string[] } {
  const indegree = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const node of plan.nodes) {
    indegree.set(node.id, 0);
    out.set(node.id, []);
  }
  for (const edge of plan.edges) {
    if (!indegree.has(edge.from) || !indegree.has(edge.to)) continue; // 悬挂边忽略（防御）
    out.get(edge.from)?.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const queue = plan.nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const next of out.get(id) ?? []) {
      const left = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, left);
      if (left === 0) queue.push(next);
    }
  }

  const cycle =
    order.length === plan.nodes.length
      ? []
      : plan.nodes.filter((node) => !order.includes(node.id)).map((node) => node.id);
  return { order, cycle };
}

/** 该节点的入边（数据流来源） */
export function planIncomingEdges(plan: CanvasPlan, nodeId: string): CanvasPlanEdge[] {
  return plan.edges.filter((edge) => edge.to === nodeId);
}

/**
 * 这条节点**为什么不能跑**（null = 能跑）。逐条给出**可执行的原因**，而不是一个"校验失败"。
 *
 * ⚠️ 这是"错误输入烧钱比拒跑更贵"的落点：每一种不能跑的情形都必须在这里被说清。
 */
export function planNodeBlockReason(plan: CanvasPlan, nodeId: string): string | null {
  const node = plan.nodes.find((item) => item.id === nodeId);
  if (node === undefined) return '节点不存在（图刚被改过？）';
  if (node.prompt.trim() === '') return '提示词为空';
  if (!PLAN_SUPPORTED_MODES.includes(node.mode)) {
    return `模式 ${node.mode} 不受编排支持（i2v / fl2v 需要素材槽，片 A 只支持 t2v / v2v）`;
  }
  const incoming = planIncomingEdges(plan, nodeId);
  if (incoming.length > 1) {
    return `有 ${incoming.length} 条入边：v2v 只能接一个上游（不猜哪一个 —— 猜错就是拿错误输入烧钱）`;
  }
  if (incoming.length === 1 && node.mode !== 'v2v') {
    return `模式是 t2v 但接了一个上游：只有 v2v（视频参考）能引用上游产物`;
  }
  return null;
}

/** 确定性幂等键（契约 §11-6）；**不要**用 `newIdempotencyKey()`（随机 = 每次点运行都是新提交） */
export function planIdempotencyKey(planId: string, nodeId: string): string {
  return `${PLAN_IDEMPOTENCY_PREFIX}${planId}:${nodeId}`;
}

/**
 * 组装提交体。`upstreamTaskId` 由执行器按拓扑序传入（v2v 节点用它作 `task:` 引用）。
 * 未传 = 无上游引用（t2v 的正常形态）。
 */
export function toGenerateRequest(node: CanvasPlanNode, upstreamTaskId?: string): VideoGenerateRequest {
  const params: NonNullable<VideoGenerateRequest['params']> = {};
  if (node.durationSec !== undefined) params.durationSec = node.durationSec;
  if (node.seed !== undefined) params.seed = node.seed;

  return {
    prompt: node.prompt,
    mode: node.mode,
    aspectRatio: node.aspectRatio,
    provider: node.provider,
    ...(Object.keys(params).length === 0 ? {} : { params }),
    ...(node.resolution === undefined ? {} : { resolution: node.resolution }),
    ...(upstreamTaskId === undefined
      ? {}
      : { assets: { referenceVideo: `${TASK_REF_PREFIX}${upstreamTaskId}` } }),
  };
}

// ── 本机存储（按项目隔离；坏数据不覆盖原文）─────────────────────────────────

export interface CanvasPlanLoad {
  plan: CanvasPlan | null;
  /** 读不出来（不是"没存过"）—— 界面要如实说明，且**不自动覆盖**原文 */
  broken: boolean;
}

export function loadCanvasPlan(
  projectId: string,
  access: StorageAccess = browserStorage(),
): CanvasPlanLoad {
  const raw = readLocal(access, canvasPlanKey(projectId));
  if (raw === null) return { plan: null, broken: false };
  try {
    const parsed = CanvasPlanSchema.safeParse(JSON.parse(raw));
    return parsed.success ? { plan: parsed.data, broken: false } : { plan: null, broken: true };
  } catch {
    return { plan: null, broken: true };
  }
}

export function saveCanvasPlan(
  projectId: string,
  plan: CanvasPlan,
  access: StorageAccess = browserStorage(),
): void {
  try {
    writeLocal(access, canvasPlanKey(projectId), JSON.stringify(plan));
  } catch {
    /* 配额满 / 隐私模式：编排暂时写不进去，不阻塞画布（界面上有提示位，见 CanvasView） */
  }
}
