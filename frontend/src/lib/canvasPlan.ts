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
import { getLanguage, translate } from './i18n';
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
 *
 * ## 语言迁移第十批：这一层的**原因字符串**进字典，但**函数签名没变**
 * `planNodeBlockReason` 的返回值是**给用户看的**（检查器顶部那句"现在不能跑：…"、
 * 以及每个 skipped 节点的卡片），所以它必须跟着语言走。做法与 `lib/format.ts` 的
 * `statusLabel` 一致：**按当前语言取**（`getLanguage()`），而不是把 `t` 传进来 ——
 * 调用方是视图与执行器，改造它们的签名只会把语言这件事扩散到十几处。
 * **代价如实**：这是"非 React 上下文取文案"的第**四**处，前提同样是**调用方订阅了语言**
 * （画布视图用 `useTranslate()`；单测在 Node 里默认中文，所以那 42 例断言一字未改）。
 *
 * ⚠️ `createEmptyPlan` 的 `name: '未命名编排'` **刻意没迁**（行内有 `i18n-exempt` 标记）：
 * 它是**数据**（落本机存储、并会被导出成编排文件里的 name），与配方名 / 模板名同一条口径。
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
  // 这是**数据默认值**（落本机存储、并被导出成编排文件里的 name），不是界面文案 ——
  // 与配方名 / 模板名同一条口径（内容不进字典，见 lib/dict/index.ts）。它只在"新建后还没改名"时可见。
  // i18n-exempt: 新建编排的默认名 —— 数据字段，不跟界面语言走（理由见上两行）
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
  if (node === undefined) return translate(getLanguage(), 'canvas.plan.block.notFound');
  if (node.prompt.trim() === '') return translate(getLanguage(), 'canvas.plan.block.emptyPrompt');
  if (!PLAN_SUPPORTED_MODES.includes(node.mode)) {
    return translate(getLanguage(), 'canvas.plan.block.unsupportedMode', { mode: node.mode });
  }
  const incoming = planIncomingEdges(plan, nodeId);
  if (incoming.length > 1) {
    return translate(getLanguage(), 'canvas.plan.block.tooManyUpstream', { count: incoming.length });
  }
  if (incoming.length === 1 && node.mode !== 'v2v') {
    return translate(getLanguage(), 'canvas.plan.block.t2vWithUpstream');
  }
  return null;
}

/**
 * 确定性幂等键（契约 §11-6 / V2.29）；**不要**用 `newIdempotencyKey()`（随机 = 每次点运行都是新提交）。
 *
 * `runSeq` 决定键：**代数不变 → 键不变**（连点「运行」不重复计费）；
 * **显式重跑把代数 +1 → 键全变 → 真的产生新任务**（B69）。
 * `runSeq <= 1` 沿用 V2.26 的老格式 —— 所以片 A 时代已提交的编排**天然就是第 1 代**，
 * 升级后重复点「运行」仍然幂等命中它们（不重复计费）。
 */
export function planIdempotencyKey(planId: string, nodeId: string, runSeq = 1): string {
  const base = `${PLAN_IDEMPOTENCY_PREFIX}${planId}:${nodeId}`;
  return runSeq <= 1 ? base : `${base}:r${runSeq}`;
}

/** 运行代数（老编排没有这个字段 → 读作第 1 代） */
export function planRunSeq(plan: CanvasPlan): number {
  return plan.runSeq ?? 1;
}

/** 显式重跑：代数 +1（**下一轮提交会换键 = 真的新建任务、真的花钱**） */
export function bumpPlanRun(plan: CanvasPlan, now = Date.now()): CanvasPlan {
  return { ...plan, runSeq: planRunSeq(plan) + 1, updatedAt: now };
}

/**
 * V2.35（A5 片 B 收口）：给一份编排**换新身份**（导入文件时用）。
 *
 * 为什么导入必须换 `id`：幂等键含 `planId`（`plan:<planId>:<nodeId>[:r<代数>]`）——
 * 两份从同一文件导入的编排若共享 id，在**同一部署**里跑会互相命中对方已提交的任务
 * （第二份显示"已提交"，产物却在另一个项目里，属静默错误）。
 * **代价如实**：导入后第一次「运行」会新建任务（不与来源共享幂等键）。
 *
 * `lastTaskId` / `pinnedTaskId` / `runSeq` **原样保留**：它们只在本机部署有意义，
 * 运行时对"任务不存在"有既有的如实处理（跳过并说明），这里不替用户改写编排。
 */
export function withNewPlanIdentity(
  plan: CanvasPlan,
  now = Date.now(),
  id = `plan-${now}-${Math.random().toString(36).slice(2, 8)}`,
): CanvasPlan {
  return { ...plan, id };
}

/** 固定：把某个节点的产物钉住（之后的运行**永不重提交**它） */
export function pinPlanNode(plan: CanvasPlan, nodeId: string, taskId: string, now = Date.now()): CanvasPlan {
  return {
    ...plan,
    nodes: plan.nodes.map((node) => (node.id === nodeId ? { ...node, pinnedTaskId: taskId } : node)),
    updatedAt: now,
  };
}

export function unpinPlanNode(plan: CanvasPlan, nodeId: string, now = Date.now()): CanvasPlan {
  return {
    ...plan,
    nodes: plan.nodes.map((node) => {
      if (node.id !== nodeId) return node;
      const { pinnedTaskId: _pinned, ...rest } = node;
      return rest;
    }),
    updatedAt: now,
  };
}

/** 节点级重试（B74）；传 `null` = 清掉（回到"不重试"） */
export function setPlanNodeRetry(
  plan: CanvasPlan,
  nodeId: string,
  retry: CanvasPlanNode['retry'] | null,
  now = Date.now(),
): CanvasPlan {
  return {
    ...plan,
    nodes: plan.nodes.map((node) => {
      if (node.id !== nodeId) return node;
      if (retry === null) {
        const { retry: _retry, ...rest } = node;
        return rest;
      }
      return { ...node, retry };
    }),
    updatedAt: now,
  };
}

/**
 * 该节点**可被下游引用**的产物（`null` = 拿不出引用）。
 *
 * 固定优先于"上次产物"：用户显式钉住的那一份就是**唯一权威**（他要的是"别再动这段"）。
 */
export function planRetainedTaskId(node: CanvasPlanNode): string | null {
  return node.pinnedTaskId ?? node.lastTaskId ?? null;
}

/** 选中节点 + **它们的全部下游**（沿边传递闭包）：改了一个节点的参数，下游引用的就是旧产物了 */
export function planDownstreamClosure(plan: CanvasPlan, nodeIds: ReadonlyArray<string>): Set<string> {
  const selected = new Set(nodeIds);
  const queue = [...selected];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of plan.edges) {
      if (edge.from !== current || selected.has(edge.to)) continue;
      selected.add(edge.to);
      queue.push(edge.to);
    }
  }
  return selected;
}

export interface PlanRunScope {
  /** 本轮**提交**的节点（拓扑序的筛选依据由 runner 决定） */
  submit: Set<string>;
  /** 本轮**不提交**、沿用上次产物的节点（含被固定的） */
  keep: Set<string>;
  /** 被固定导致"选中了也不提交"的节点（界面要如实说明，不能静默忽略用户的选择） */
  pinnedOverride: Set<string>;
}

/**
 * 决定本轮哪些节点提交、哪些保留（B68 部分重跑）。
 *
 * 三条口径：
 * 1. **不传 `selected`** → 全部提交（= 「运行 / 重跑全部」的语义）；
 * 2. 传了 → 提交范围 = **选中 ∪ 下游**（只重跑选中的那个而不管下游，会让下游引用旧产物 ——
 *    那不是"部分重跑"，那是"数据不一致"）；
 * 3. **固定的节点永不提交**（即使它被选中）—— 并在 `pinnedOverride` 里如实报出来。
 */
export function planRunScope(plan: CanvasPlan, selected?: ReadonlyArray<string>): PlanRunScope {
  const all = new Set(plan.nodes.map((node) => node.id));
  const pinned = new Set(plan.nodes.filter((node) => node.pinnedTaskId !== undefined).map((node) => node.id));

  if (selected === undefined || selected.length === 0) {
    const submit = new Set([...all].filter((id) => !pinned.has(id)));
    return {
      submit,
      keep: new Set([...all].filter((id) => !submit.has(id))),
      pinnedOverride: new Set(),
    };
  }

  const wanted = planDownstreamClosure(plan, selected);
  const submit = new Set([...wanted].filter((id) => !pinned.has(id)));
  return {
    submit,
    keep: new Set([...all].filter((id) => !submit.has(id))),
    pinnedOverride: new Set([...wanted].filter((id) => pinned.has(id))),
  };
}

/**
 * 把本轮提交得到的 taskId **写回编排**（`lastTaskId`）。
 *
 * 为什么必须写回：下一轮"部分重跑"里，范围外的节点不会重新提交 —— 下游要引用它的成片，
 * 而那份引用**只能**来自这里记下的 taskId（否则部分重跑永远只能跑全图）。
 */
export function withRunTaskIds(
  plan: CanvasPlan,
  submitted: ReadonlyMap<string, string>,
  now = Date.now(),
): CanvasPlan {
  if (submitted.size === 0) return plan;
  return {
    ...plan,
    nodes: plan.nodes.map((node) => {
      const taskId = submitted.get(node.id);
      return taskId === undefined ? node : { ...node, lastTaskId: taskId };
    }),
    updatedAt: now,
  };
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
