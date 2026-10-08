import type { AssetListEntry, TaskProgress } from '@astrmira/shared';
import { parseTaskRef } from '@astrmira/shared';

/**
 * 血缘图纯函数层（Step 8 · P4 / 台账 B42，L2 只读画布；决策 = PLAN §6-D40）。
 *
 * ## 它回答的问题
 * "这条成片是怎么长出来的"——从一句话、一张图、一段参考，经生成 / 抽帧 / 剪辑，一路派生到眼前这条。
 * 血缘数据**本就存在**，不存在于任何新接口里：
 * - `origin.kind='edit'` + `sourceTaskId` → 剪辑产物与源片的关系；
 * - `extractedAssetIds[]` → 抽帧产物的来源任务；
 * - `requestSnapshot.assets`（含 V2.6 的 `task:<taskId>` 引用）→ 任务吃进过哪些素材 / 成片。
 *
 * ## 三条纪律
 * 1. **只读**：本文件不产生任何写操作；画布也不提供连线 / 删除（D40）；
 * 2. **推导式**：节点与边全部从既有字段算出，**零契约变更**——不可能把库写脏；
 * 3. **不静默**：引用了但不在列表里的对象（已删除 / 超出最近 50 条）会以 `ghost` 节点如实出现，
 *    而不是悄悄丢一条边让图断掉。
 */

export const TASK_NODE_PREFIX = 'task:';
export const ASSET_NODE_PREFIX = 'asset:';

export function taskNodeId(taskId: string): string {
  return `${TASK_NODE_PREFIX}${taskId}`;
}

export function assetNodeId(assetId: string): string {
  return `${ASSET_NODE_PREFIX}${assetId}`;
}

export interface LineageNode {
  /** `task:<taskId>` 或 `asset:<assetId>` */
  id: string;
  kind: 'task' | 'asset';
  /** 主标签（成片=提示词截断；资产=编号） */
  label: string;
  /** 副标签（状态 / 类型，界面第二行） */
  sublabel: string;
  /** 派生深度（布局列号；来源于最长路径） */
  depth: number;
  createdAt: number;
  /** 引用了但不在输入列表里（已删除或超出最近 50 条）——界面上如实标注 */
  ghost?: boolean;

  // ── task 专属 ──
  taskId?: string;
  status?: TaskProgress['status'];
  isEdit?: boolean;
  hasOutput?: boolean;
  thumbnailUrl?: string | null;
  /** 成片同源直链（`/media/<taskId>.mp4`）；详情抽屉的播放器与下载用 */
  outputVideoUrl?: string | null;

  // ── asset 专属 ──
  assetId?: string;
  assetKind?: 'image' | 'video';
  url?: string | null;
}

export type LineageEdgeKind = 'edit' | 'extract' | 'reference' | 'task-ref';

export interface LineageEdge {
  id: string;
  from: string;
  to: string;
  kind: LineageEdgeKind;
}

export interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

export interface LineageInput {
  tasks: TaskProgress[];
  /** 资产库（`GET /api/assets`）；缺省也能构图——引用的资产会以 ghost 节点出现 */
  assets?: AssetListEntry[];
}

const STATUS_LABEL: Record<TaskProgress['status'], string> = {
  queued: '排队中',
  running: '生成中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

export function buildLineage(input: LineageInput): LineageGraph {
  const nodes = new Map<string, LineageNode>();
  const edges: LineageEdge[] = [];
  const edgeKeys = new Set<string>();

  const taskById = new Map(input.tasks.map((task) => [task.taskId, task]));
  const assetById = new Map((input.assets ?? []).map((asset) => [asset.assetId, asset]));

  const addEdge = (from: string, to: string, kind: LineageEdgeKind): void => {
    // 去重键含 kind 与方向：同一对节点可能同时存在"参考"与"抽帧"两种关系（语义不同，都保留）
    const key = `${kind}|${from}|${to}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ id: key, from, to, kind });
  };

  const ensureTask = (taskId: string): LineageNode => {
    const id = taskNodeId(taskId);
    const existing = nodes.get(id);
    if (existing !== undefined) return existing;

    const task = taskById.get(taskId);
    const node: LineageNode =
      task === undefined
        ? {
            id,
            kind: 'task',
            label: `任务 ${taskId.slice(0, 8)}`,
            sublabel: '不在最近记录里（已删除或超出列表）',
            depth: 0,
            createdAt: 0,
            ghost: true,
            taskId,
          }
        : {
            id,
            kind: 'task',
            label: task.requestSnapshot.prompt.slice(0, 18) || `任务 ${taskId.slice(0, 8)}`,
            sublabel: `${task.origin?.kind === 'edit' ? '剪辑产物 · ' : ''}${STATUS_LABEL[task.status]}`,
            depth: 0,
            createdAt: task.createdAt,
            taskId,
            status: task.status,
            isEdit: task.origin?.kind === 'edit',
            hasOutput: task.outputVideoUrl !== undefined,
            thumbnailUrl: task.thumbnailUrl ?? null,
            outputVideoUrl: task.outputVideoUrl ?? null,
          };
    nodes.set(id, node);
    return node;
  };

  const ensureAsset = (assetId: string): LineageNode => {
    const id = assetNodeId(assetId);
    const existing = nodes.get(id);
    if (existing !== undefined) return existing;

    const asset = assetById.get(assetId);
    const node: LineageNode =
      asset === undefined
        ? {
            id,
            kind: 'asset',
            label: `资产 ${assetId.slice(0, 8)}`,
            sublabel: '不在资产库里（已清理或超出列表）',
            depth: 0,
            createdAt: 0,
            ghost: true,
            assetId,
          }
        : {
            id,
            kind: 'asset',
            label: `资产 ${assetId.slice(0, 8)}`,
            sublabel: asset.kind === 'image' ? '图片' : '视频',
            depth: 0,
            createdAt: asset.createdAt,
            assetId,
            assetKind: asset.kind,
            url: asset.url,
          };
    nodes.set(id, node);
    return node;
  };

  // ① 先把两边列表里的对象都落成节点 —— 没有关系的"孤儿节点"也要出现在画布上（如实呈现，不悄悄吞掉）
  for (const task of input.tasks) ensureTask(task.taskId);
  for (const asset of input.assets ?? []) ensureAsset(asset.assetId);

  // ② 推导边
  for (const task of input.tasks) {
    const self = taskNodeId(task.taskId);

    if (task.origin?.kind === 'edit') {
      const source = ensureTask(task.origin.sourceTaskId);
      addEdge(source.id, self, 'edit');
    }

    for (const assetId of task.extractedAssetIds ?? []) {
      const asset = ensureAsset(assetId);
      addEdge(self, asset.id, 'extract');
    }

    const assets = task.requestSnapshot.assets ?? {};
    for (const value of [assets.firstFrameImage, assets.lastFrameImage, assets.referenceVideo]) {
      if (value === undefined || value === '') continue;
      const refTaskId = parseTaskRef(value);
      if (refTaskId !== null) {
        const refTask = ensureTask(refTaskId);
        addEdge(refTask.id, self, 'task-ref');
      } else {
        const asset = ensureAsset(value);
        addEdge(asset.id, self, 'reference');
      }
    }
  }

  // ③ 深度 = 从根出发的最长路径（循环引用按 0 收口：不崩、不死循环 —— 自引用是被允许的输入）
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    const list = incoming.get(edge.to);
    if (list === undefined) incoming.set(edge.to, [edge.from]);
    else list.push(edge.from);
  }

  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    // 环（自引用 / 互相引用是被允许的输入）：正在访问的节点按 0 收口 —— 不崩、不死循环
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let best = 0;
    for (const parent of incoming.get(id) ?? []) {
      // 自环不抬深度：否则「把自己当参考」会把节点推进下一列，看着像派生关系
      if (parent === id) continue;
      best = Math.max(best, depthOf(parent) + 1);
    }
    visiting.delete(id);
    memo.set(id, best);
    return best;
  };

  for (const node of nodes.values()) {
    node.depth = depthOf(node.id);
  }

  // ④ 同列内新的在前（读取顺序：列 = 派生顺序，行 = 时间倒序）
  const sorted = [...nodes.values()].sort(
    (a, b) => a.depth - b.depth || b.createdAt - a.createdAt || a.id.localeCompare(b.id),
  );
  return { nodes: sorted, edges };
}

// ── 布局（自写分层：列 = depth，行 = 同列序号；不引 dagre —— D40）──

export interface LineagePosition {
  x: number;
  y: number;
}

export interface LineageLayout {
  positions: Record<string, LineagePosition>;
  width: number;
  height: number;
}

/** 列宽含节点卡宽度与间距（像素值直接给 React Flow 的画布坐标系，不参与 CSP/字号体系） */
export const LINEAGE_COLUMN_WIDTH = 300;
export const LINEAGE_ROW_HEIGHT = 128;

export function layoutLineage(graph: LineageGraph): LineageLayout {
  const rowInColumn = new Map<number, number>();
  const positions: Record<string, LineagePosition> = {};
  let maxRows = 0;

  for (const node of graph.nodes) {
    const row = rowInColumn.get(node.depth) ?? 0;
    rowInColumn.set(node.depth, row + 1);
    positions[node.id] = { x: node.depth * LINEAGE_COLUMN_WIDTH, y: row * LINEAGE_ROW_HEIGHT };
    maxRows = Math.max(maxRows, row + 1);
  }

  const columns = Math.max(1, rowInColumn.size);
  return {
    positions,
    width: columns * LINEAGE_COLUMN_WIDTH,
    height: Math.max(1, maxRows) * LINEAGE_ROW_HEIGHT,
  };
}
