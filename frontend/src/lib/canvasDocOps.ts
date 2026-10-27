import {
  createCanvasNode,
  TASK_REF_PREFIX,
  taskOutput,
  type CanvasDoc,
  type CanvasDocNode,
  type CanvasNodeBatch,
  type CanvasNodeDraft,
  type CanvasNodeSettings,
  type CanvasNodeType,
  type CanvasOutput,
  type TaskProgress,
} from '@astrmira/shared';
import { pruneCanvasGroups } from './canvasGroups';

/**
 * 画布文档的纯编辑操作（Step 11-S3 片 B2）。
 *
 * 全部返回**新文档**、不改入参：撤销栈/自动保存都靠"前后两份快照"，原地改会让两者指向同一对象。
 *
 * 三条口径：
 * 1. **删节点不删资产**：这里只动文档，产物仍在存储里（与设计基准 §4-D 一致）；
 * 2. **删节点连带删边**：留下悬空边，画布会画出"指向空气"的线；
 * 3. **标题按类型递增**（图片 1、图片 2…）—— 与实测产品一致，且不依赖节点 id。
 */

export function canvasNodeTitle(
  doc: CanvasDoc,
  type: CanvasNodeType,
  labelOf: Record<CanvasNodeType, string>,
): string {
  const prefix = labelOf[type];
  const used = new Set(doc.nodes.map((n) => n.data.title).filter((t): t is string => !!t));
  let i = 1;
  while (used.has(`${prefix} ${i}`)) i += 1;
  return `${prefix} ${i}`;
}

export function addCanvasNode(
  doc: CanvasDoc,
  input: {
    id: string;
    type: CanvasNodeType;
    x: number;
    y: number;
    title: string;
    now?: number;
  },
): { doc: CanvasDoc; node: CanvasDocNode } {
  const node = createCanvasNode({
    id: input.id,
    type: input.type,
    x: input.x,
    y: input.y,
    title: input.title,
    createdFrom: 'menu',
    now: input.now,
  });
  return { doc: { ...doc, nodes: [...doc.nodes, node], updatedAt: input.now ?? Date.now() }, node };
}

/** 拖动只改 layout（执行依赖在 edges 里，不受位置影响） */
export function moveCanvasNode(
  doc: CanvasDoc,
  nodeId: string,
  position: { x: number; y: number },
  now: number = Date.now(),
): CanvasDoc {
  let changed = false;
  const nodes = doc.nodes.map((node) => {
    if (node.id !== nodeId) return node;
    if (node.layout.x === position.x && node.layout.y === position.y) return node;
    changed = true;
    return { ...node, layout: { ...node.layout, x: position.x, y: position.y } };
  });
  return changed ? { ...doc, nodes, updatedAt: now } : doc;
}

/** 删节点：连带清掉悬空边（否则画布会画出指向空气的线） */
export function removeCanvasNodes(
  doc: CanvasDoc,
  nodeIds: readonly string[],
  now: number = Date.now(),
): CanvasDoc {
  const remove = new Set(nodeIds);
  const nodes = doc.nodes.filter((n) => !remove.has(n.id));
  if (nodes.length === doc.nodes.length) return doc;
  const edges = doc.edges.filter((e) => !remove.has(e.from) && !remove.has(e.to));
  // V2.81：组不会自己知道成员没了 —— 顺手收拾，避免留下空框或悬空 id
  return pruneCanvasGroups({ ...doc, nodes, edges, updatedAt: now }, now);
}

export function removeCanvasNode(
  doc: CanvasDoc,
  nodeId: string,
  now: number = Date.now(),
): CanvasDoc {
  return removeCanvasNodes(doc, [nodeId], now);
}

export function renameCanvasDoc(doc: CanvasDoc, name: string, now: number = Date.now()): CanvasDoc {
  const trimmed = name.trim();
  if (trimmed === '' || trimmed === doc.name) return doc;
  return { ...doc, name: trimmed, updatedAt: now };
}

export function canvasDocCounts(doc: CanvasDoc): { nodes: number; edges: number } {
  return { nodes: doc.nodes.length, edges: doc.edges.length };
}

/** 批量插入时的网格步长（最宽的节点 420，列距 480 留 60 的缝） */
export const CANVAS_GRID_STEP = { x: 480, y: 360 } as const;

/**
 * 新节点的落点：**在已有内容的右侧另起一组**，按 3 列网格排。
 *
 * 为什么不按"已有节点数 % 3"继续填原来的行：那会和现有节点叠在一起
 * （画布上已经有东西时，用户看到的应该是"新的一批在右边"）。
 */
export function nextCanvasNodePositions(
  doc: CanvasDoc,
  count: number,
): Array<{ x: number; y: number }> {
  if (count <= 0) return [];
  const origin =
    doc.nodes.length === 0
      ? { x: 0, y: 0 }
      : {
          x: Math.max(...doc.nodes.map((n) => n.layout.x)) + CANVAS_GRID_STEP.x,
          y: Math.min(...doc.nodes.map((n) => n.layout.y)),
        };
  return Array.from({ length: count }, (_unused, index) => ({
    x: origin.x + (index % 3) * CANVAS_GRID_STEP.x,
    y: origin.y + Math.floor(index / 3) * CANVAS_GRID_STEP.y,
  }));
}

/** 新建节点的落点：已有节点右下方错开一格，避免叠在同一处 */
export function nextCanvasNodePosition(doc: CanvasDoc): { x: number; y: number } {
  return nextCanvasNodePositions(doc, 1)[0] ?? { x: 0, y: 0 };
}

export function findCanvasNode(doc: CanvasDoc, nodeId: string): CanvasDocNode | null {
  return doc.nodes.find((node) => node.id === nodeId) ?? null;
}

// ── 草稿 ───────────────────────────────────────────────────────────────

export interface CanvasDraftPatch {
  prompt?: string;
  settings?: Partial<CanvasNodeSettings>;
  references?: CanvasNodeDraft['references'];
}

function sameSettings(a: CanvasNodeSettings, b: CanvasNodeSettings): boolean {
  const aKeys = Object.keys(a) as Array<keyof CanvasNodeSettings>;
  const bKeys = Object.keys(b) as Array<keyof CanvasNodeSettings>;
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

/** 只改草稿；值没变时返回原文档（否则每敲一个字都会触发一次自动保存） */
export function updateCanvasNodeDraft(
  doc: CanvasDoc,
  nodeId: string,
  patch: CanvasDraftPatch,
  now: number = Date.now(),
): CanvasDoc {
  let changed = false;
  const nodes = doc.nodes.map((node) => {
    if (node.id !== nodeId) return node;
    const draft = node.data.draft;
    const nextPrompt = patch.prompt ?? draft.prompt;
    const nextSettings =
      patch.settings === undefined ? draft.settings : { ...draft.settings, ...patch.settings };
    const nextReferences = patch.references ?? draft.references;
    if (
      nextPrompt === draft.prompt &&
      nextReferences === draft.references &&
      sameSettings(draft.settings, nextSettings)
    ) {
      return node;
    }
    changed = true;
    return {
      ...node,
      data: {
        ...node.data,
        draft: {
          ...draft,
          prompt: nextPrompt,
          settings: nextSettings,
          references: nextReferences,
          updatedAt: now,
        },
      },
    };
  });
  return changed ? { ...doc, nodes, updatedAt: now } : doc;
}

// ── 产物批次（服务端事实） ──────────────────────────────────────────────

/** 追加一个批次；同 id 已存在则原样返回（防手抖/重放造成重复批次） */
export function addCanvasBatch(
  doc: CanvasDoc,
  nodeId: string,
  batch: CanvasNodeBatch,
  now: number = Date.now(),
): CanvasDoc {
  let changed = false;
  const nodes = doc.nodes.map((node) => {
    if (node.id !== nodeId) return node;
    if (node.data.batches.some((item) => item.id === batch.id)) return node;
    changed = true;
    return { ...node, data: { ...node.data, batches: [...node.data.batches, batch] } };
  });
  return changed ? { ...doc, nodes, updatedAt: now } : doc;
}

export interface CanvasBatchPatch {
  taskId?: string;
  status?: CanvasNodeBatch['status'];
  outputs?: CanvasOutput[];
  /** `null` = 清掉旧失败（成功批次不该继续显示上一次的失败） */
  failure?: CanvasNodeBatch['failure'] | null;
}

function sameOutputs(a: readonly CanvasOutput[], b: readonly CanvasOutput[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      item.assetId === other.assetId &&
      item.kind === other.kind &&
      item.url === other.url &&
      item.width === other.width &&
      item.height === other.height &&
      item.durationSec === other.durationSec
    );
  });
}

/**
 * 把一次轮询结果写回批次。
 *
 * **无变化时返回原文档**：轮询每 2 秒一次，如果每次都造一份新文档，自动保存会跟着白写盘。
 */
export function patchCanvasBatch(
  doc: CanvasDoc,
  nodeId: string,
  batchId: string,
  patch: CanvasBatchPatch,
  now: number = Date.now(),
): CanvasDoc {
  let docChanged = false;
  const nodes = doc.nodes.map((node) => {
    if (node.id !== nodeId) return node;
    let nodeChanged = false;
    const batches = node.data.batches.map((batch) => {
      if (batch.id !== batchId) return batch;
      const next: CanvasNodeBatch = { ...batch };
      let batchChanged = false;

      if (patch.taskId !== undefined && patch.taskId !== batch.taskId) {
        next.taskId = patch.taskId;
        batchChanged = true;
      }
      if (patch.status !== undefined && patch.status !== batch.status) {
        next.status = patch.status;
        batchChanged = true;
      }
      if (patch.outputs !== undefined && !sameOutputs(batch.outputs, patch.outputs)) {
        next.outputs = patch.outputs;
        batchChanged = true;
      }
      if (patch.failure !== undefined) {
        if (patch.failure === null) {
          if (next.failure !== undefined) {
            delete next.failure;
            batchChanged = true;
          }
        } else if (
          batch.failure?.code !== patch.failure.code ||
          batch.failure?.message !== patch.failure.message
        ) {
          next.failure = patch.failure;
          batchChanged = true;
        }
      }
      if (!batchChanged) return batch;
      nodeChanged = true;
      return next;
    });
    if (!nodeChanged) return node;

    docChanged = true;
    const generated = batches.some(
      (batch) =>
        batch.status === 'succeeded' &&
        batch.outputs.some((output) => output.assetId.startsWith(TASK_REF_PREFIX)),
    );
    return {
      ...node,
      data: {
        ...node.data,
        batches,
        ...(generated ? { source: 'model_generated' as const } : {}),
      },
    };
  });
  return docChanged ? { ...doc, nodes, updatedAt: now } : doc;
}

/**
 * 任务状态 → 批次补丁。
 *
 * 三个口径：
 * 1. 模型产物的 `assetId` 写 **`task:<taskId>`**（CONTRACT §21-10），不写临时 URL；
 * 2. `succeeded` 但**没有产物**时不覆盖已有 outputs（宁可保留上一版，也不把节点变空）；
 * 3. 失败必须带可读原因：任务没给 `error` 时退到 `message`，再没有就写"上游未说明原因"（不编造码）。
 */
export function canvasBatchPatchFromTask(task: TaskProgress): CanvasBatchPatch {
  if (task.status === 'succeeded') {
    const output = taskOutput(task);
    return {
      status: 'succeeded',
      ...(output.kind === 'none'
        ? {}
        : {
            outputs: [
              { assetId: `${TASK_REF_PREFIX}${task.taskId}`, kind: output.kind, url: output.url },
            ],
          }),
      failure: null,
    };
  }
  if (task.status === 'failed') {
    return {
      status: 'failed',
      failure:
        task.error === undefined
          ? { code: 'UPSTREAM_ERROR', message: task.message ?? '上游未说明失败原因' }
          : { code: task.error.code, message: task.error.message },
    };
  }
  return { status: task.status };
}

export function latestCanvasBatch(node: CanvasDocNode): CanvasNodeBatch | null {
  return node.data.batches[node.data.batches.length - 1] ?? null;
}

/** 节点当前展示的产物：**最近一次成功**的批次（失败批次不该把上一版产物顶掉） */
export function latestCanvasOutput(
  node: CanvasDocNode,
): { batch: CanvasNodeBatch; output: CanvasOutput } | null {
  for (let index = node.data.batches.length - 1; index >= 0; index -= 1) {
    const batch = node.data.batches[index];
    if (batch === undefined || batch.status !== 'succeeded') continue;
    const output = batch.outputs[batch.outputs.length - 1];
    if (output !== undefined) return { batch, output };
  }
  return null;
}

/**
 * S5-B3：当前预览的版本。
 *
 * 显式 `selectedBatchId` 失效时返回 `invalid`，**不静默回退**到最新成功批次；
 * 没选过才取最近一次成功批次。
 */
export type CanvasVisibleOutput =
  | { state: 'none' }
  | { state: 'latest' | 'selected'; batch: CanvasNodeBatch; output: CanvasOutput }
  | { state: 'invalid'; batch: CanvasNodeBatch | null };

export function canvasNodeVisibleOutput(node: CanvasDocNode): CanvasVisibleOutput {
  const selectedId = node.data.selectedBatchId;
  if (selectedId !== undefined) {
    const batch = node.data.batches.find((item) => item.id === selectedId) ?? null;
    if (batch === null || batch.status !== 'succeeded' || batch.outputs.length === 0) {
      return { state: 'invalid', batch };
    }
    const output = batch.outputs[batch.outputs.length - 1];
    return output === undefined
      ? { state: 'invalid', batch }
      : { state: 'selected', batch, output };
  }
  const latest = latestCanvasOutput(node);
  return latest === null ? { state: 'none' } : { state: 'latest', ...latest };
}

/** 选中一个成功批次；非成功/无产物批次不允许写进文档 */
export function selectCanvasNodeBatch(
  doc: CanvasDoc,
  nodeId: string,
  batchId: string,
  now: number = Date.now(),
): CanvasDoc {
  let changed = false;
  const nodes = doc.nodes.map((node) => {
    if (node.id !== nodeId) return node;
    const batch = node.data.batches.find((item) => item.id === batchId);
    if (batch === undefined || batch.status !== 'succeeded' || batch.outputs.length === 0) {
      return node;
    }
    if (node.data.selectedBatchId === batchId) return node;
    changed = true;
    return { ...node, data: { ...node.data, selectedBatchId: batchId } };
  });
  return changed ? { ...doc, nodes, updatedAt: now } : doc;
}

/**
 * 还在跑（可轮询）的批次。
 *
 * **只算有 `taskId` 的**：`queued` 但没有 taskId 表示"提交请求发出去了、响应还没回来"，
 * 页面刷新后它是**结果未知**（可能已建任务，也可能没有）—— 既不能轮询，也不该永久挡住重提。
 * 界面会把这种批次如实显示成"提交中断"，由用户决定要不要再提交一次。
 */
export function canvasNodeActiveBatches(node: CanvasDocNode): CanvasNodeBatch[] {
  // V2.49：`queued` 但没有 taskId = 提交结果未知（可能已建任务）。
  // 有 request 才能核对，所以它要挡住删除/撤销/再次提交；
  // 旧批次没有 request（V2.45 之前），无法核对，不能永久锁死，允许用户显式重提/删除。
  return node.data.batches.filter(
    (batch) =>
      batch.status === 'running' ||
      (batch.status === 'queued' &&
        (batch.taskId !== undefined || batch.request !== undefined)),
  );
}

/** 有在跑任务的节点 id（撤销/删除前的守卫用） */
export function canvasActiveTaskNodeIds(doc: CanvasDoc): string[] {
  return doc.nodes.filter((node) => canvasNodeActiveBatches(node).length > 0).map((node) => node.id);
}

export interface CanvasActiveTask {
  nodeId: string;
  batchId: string;
  taskId: string;
}

/** 把"要轮询哪些任务"从文档里摊平（批次 → 任务；只含有 taskId 的） */
export function canvasActiveTasks(doc: CanvasDoc): CanvasActiveTask[] {
  const out: CanvasActiveTask[] = [];
  for (const node of doc.nodes) {
    for (const batch of canvasNodeActiveBatches(node)) {
      if (batch.taskId === undefined) continue;
      out.push({ nodeId: node.id, batchId: batch.id, taskId: batch.taskId });
    }
  }
  return out;
}

/**
 * 若把文档恢复成 `target`，会**丢掉**哪些"还有任务在跑"的节点？
 *
 * 撤销/重做与删除都靠它做守卫：任务在服务端继续跑，但节点没了 = 产物没有地方写回。
 */
export function canvasLostActiveTaskNodes(target: CanvasDoc, current: CanvasDoc): string[] {
  const keep = new Set(target.nodes.map((node) => node.id));
  return current.nodes
    .filter((node) => !keep.has(node.id) && canvasNodeActiveBatches(node).length > 0)
    .map((node) => node.id);
}

// ── 复制 / 粘贴 / 资产入库 ──────────────────────────────────────────────

/** 深拷贝一个节点（新 id / 新标题 / 位置错开）；产物批次只复制引用，不复制文件 */
export function cloneCanvasNode(
  source: CanvasDocNode,
  input: { id: string; title: string; dx?: number; dy?: number; now?: number },
): CanvasDocNode {
  const now = input.now ?? Date.now();
  return {
    ...source,
    id: input.id,
    layout: {
      ...source.layout,
      x: source.layout.x + (input.dx ?? 40),
      y: source.layout.y + (input.dy ?? 40),
    },
    data: {
      ...source.data,
      title: input.title,
      draft: {
        ...source.data.draft,
        settings: { ...source.data.draft.settings },
        references: source.data.draft.references.map((reference) => ({ ...reference })),
      },
      batches: source.data.batches.map((batch) => ({
        ...batch,
        outputs: batch.outputs.map((output) => ({ ...output })),
        ...(batch.failure === undefined ? {} : { failure: { ...batch.failure } }),
      })),
      tags: [...source.data.tags],
    },
    meta: { ...source.meta, createdAt: now },
  };
}

/** 批量插入（复制/粘贴共用）：标题按**逐个插入后**的文档递增，避免两个副本都叫"视频 2" */
export function insertCanvasNodes(
  doc: CanvasDoc,
  sources: readonly CanvasDocNode[],
  input: {
    ids: readonly string[];
    labels: Record<CanvasNodeType, string>;
    dx?: number;
    dy?: number;
    /** 绝对落点（粘贴到鼠标处用）；给了就以它为准，忽略 dx/dy */
    positions?: ReadonlyArray<{ x: number; y: number }>;
    now?: number;
  },
): { doc: CanvasDoc; nodes: CanvasDocNode[] } {
  if (sources.length === 0 || sources.length !== input.ids.length) return { doc, nodes: [] };
  const now = input.now ?? Date.now();
  let working = doc;
  const created: CanvasDocNode[] = [];

  sources.forEach((source, index) => {
    const id = input.ids[index];
    if (id === undefined) return;
    const title = canvasNodeTitle(working, source.type, input.labels);
    const node = cloneCanvasNode(source, {
      id,
      title,
      dx: input.dx ?? 40,
      dy: input.dy ?? 40,
      now,
    });
    const position = input.positions?.[index];
    const placed =
      position === undefined ? node : { ...node, layout: { ...node.layout, x: position.x, y: position.y } };
    working = { ...working, nodes: [...working.nodes, placed], updatedAt: now };
    created.push(placed);
  });

  return { doc: working, nodes: created };
}

export function duplicateCanvasNode(
  doc: CanvasDoc,
  nodeId: string,
  input: { id: string; labels: Record<CanvasNodeType, string>; dx?: number; dy?: number; now?: number },
): { doc: CanvasDoc; node: CanvasDocNode } | null {
  const source = findCanvasNode(doc, nodeId);
  if (source === null) return null;
  const inserted = insertCanvasNodes(doc, [source], {
    ids: [input.id],
    labels: input.labels,
    ...(input.dx === undefined ? {} : { dx: input.dx }),
    ...(input.dy === undefined ? {} : { dy: input.dy }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  const node = inserted.nodes[0];
  return node === undefined ? null : { doc: inserted.doc, node };
}

export interface CanvasAssetInput {
  assetId: string;
  kind: 'image' | 'video' | 'audio';
  url?: string;
  name?: string;
}

/**
 * 资产库多选 / 本地上传 → 每项一个节点。
 *
 * 只带**一个 `succeeded` 批次**（它确实已经是这个节点的内容）；
 * `source` 区分"从资产库挑的"与"我上传的"，两者都不改写资产本身。
 */
export function addCanvasNodesFromAssets(
  doc: CanvasDoc,
  input: {
    assets: readonly CanvasAssetInput[];
    ids: readonly string[];
    batchIds: readonly string[];
    source: 'from_asset' | 'uploaded';
    positions: readonly { x: number; y: number }[];
    labels: Record<CanvasNodeType, string>;
    now?: number;
  },
): { doc: CanvasDoc; nodes: CanvasDocNode[] } {
  const count = input.assets.length;
  if (count === 0 || input.ids.length !== count || input.batchIds.length !== count) {
    return { doc, nodes: [] };
  }
  const now = input.now ?? Date.now();
  let working = doc;
  const created: CanvasDocNode[] = [];

  input.assets.forEach((asset, index) => {
    const id = input.ids[index];
    const batchId = input.batchIds[index];
    const position = input.positions[index] ?? { x: 0, y: 0 };
    if (id === undefined || batchId === undefined) return;
    const title =
      asset.name !== undefined && asset.name.trim() !== ''
        ? asset.name.trim()
        : canvasNodeTitle(working, asset.kind, input.labels);
    const node = createCanvasNode({
      id,
      type: asset.kind,
      x: position.x,
      y: position.y,
      title,
      source: input.source,
      createdFrom: 'menu',
      now,
    });
    node.data.batches = [
      {
        id: batchId,
        createdAt: now,
        status: 'succeeded',
        outputs: [
          {
            assetId: asset.assetId,
            kind: asset.kind,
            ...(asset.url === undefined ? {} : { url: asset.url }),
          },
        ],
      },
    ];
    working = { ...working, nodes: [...working.nodes, node], updatedAt: now };
    created.push(node);
  });

  return { doc: working, nodes: created };
}
