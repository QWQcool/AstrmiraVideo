import type { CanvasDoc, CanvasDocEdge } from '@astrmira/shared';
import { canReach } from './canvasLineage';

/**
 * 「引用即连线」：把一条参考关系对齐成一条来源边（Step 11-S7 · 2026-10-24）。
 *
 * ## 为什么需要它
 * 手动拖连接柄（`addCanvasLineageEdge`）是**唯一**能建边的路径，于是：
 * 从资产库给节点加参考、或「从选中版本继续」新建节点时，**数据里有引用、图上却没线**。
 * 用户看到的是"节点之间没有关系"，而实际上关系已经写进了 `draft.references`。
 *
 * ## 三条口径（与 CONTRACT §21-11 同源）
 * 1. **边是引用的事实投影**，不是额外授权：只有"某个 ref 的 assetId 确实是另一个节点的批次产物"才连边；
 * 2. **只增删本模块生成的边**（id 前缀 `edge-ref-`）：手动拖出来的边一律不动，
 *    否则用户手连的关系会被一次草稿变更悄悄抹掉；
 * 3. **不因为引用而改引用**：本函数只写 `edges`，`references` 原样保留
 *    （与 `addCanvasLineageEdge` 的方向相反——那边是"拖线 → 写参考"，这里是"已有参考 → 补线"）。
 *
 * 全纯函数，可单测。
 */

/** 自动边的 id 前缀。删改都只认这个前缀，手动边不受影响。 */
export const AUTO_REFERENCE_EDGE_PREFIX = 'edge-ref-';

export interface ReferenceLineageResult {
  doc: CanvasDoc;
  /** 新增的边数 */
  added: number;
  /** 移除的边数（引用被删/被换掉） */
  removed: number;
  /** 角色被改写的边数（首尾帧互换） */
  retargeted: number;
}

/**
 * 自动边 id：由「来源 + 目标 + 产物」三者确定。
 *
 * 刻意做成**确定性的**：同一份引用关系重复对齐不会产生第二条边，
 * 也让测试能断言 id 而不是只断言数量。
 */
export function autoReferenceEdgeId(from: string, to: string, assetId: string): string {
  return `${AUTO_REFERENCE_EDGE_PREFIX}${from}>${to}:${assetId}`;
}

/** assetId → 产出它的节点 id（只看批次产物；同一产物只应有一个来源） */
function indexBatchOutputs(doc: CanvasDoc): Map<string, string> {
  const owners = new Map<string, string>();
  for (const node of doc.nodes) {
    for (const batch of node.data.batches) {
      for (const output of batch.outputs) {
        if (!owners.has(output.assetId)) owners.set(output.assetId, node.id);
      }
    }
  }
  return owners;
}

/**
 * 把 `nodeId` 的引用与来源边对齐。
 *
 * - 引用的 assetId 属于别的节点 → 应有边（缺则补）；
 * - 引用被删掉、或换了别的产物 → 旧自动边删掉；
 * - 首帧/尾帧互换 → 边上的 `role` 跟着改（否则边标签会与实际用途不符）；
 * - 会形成环 → **不连**（数据里两个节点互相引用属异常输入，宁可不画边也不画一个环）。
 *
 * 没有变化时**原样返回同一个 doc 引用**，避免触发一次无意义的保存。
 */
export function reconcileReferenceLineage(
  doc: CanvasDoc,
  nodeId: string,
  now: number = Date.now(),
): ReferenceLineageResult {
  const target = doc.nodes.find((node) => node.id === nodeId);
  if (target === undefined) return { doc, added: 0, removed: 0, retargeted: 0 };

  const owners = indexBatchOutputs(doc);
  /** 期望存在的自动边（id → edge） */
  const expected = new Map<string, CanvasDocEdge>();
  for (const reference of target.data.draft.references) {
    const from = owners.get(reference.assetId);
    // 自己产出自己引用不算来源关系；找不到来源（上传素材、外部导入）也不画边
    if (from === undefined || from === nodeId) continue;
    // 已有边会把 to→from 走通时再加 from→to 就是环
    if (canReach(doc, nodeId, from)) continue;
    const id = autoReferenceEdgeId(from, nodeId, reference.assetId);
    expected.set(id, {
      id,
      from,
      to: nodeId,
      kind: 'lineage',
      role: reference.role,
      assetId: reference.assetId,
    });
  }

  const kept: CanvasDocEdge[] = [];
  let removed = 0;
  let retargeted = 0;

  for (const edge of doc.edges) {
    const isAutoForTarget = edge.to === nodeId && edge.id.startsWith(AUTO_REFERENCE_EDGE_PREFIX);
    if (!isAutoForTarget) {
      kept.push(edge);
      continue;
    }
    const want = expected.get(edge.id);
    if (want === undefined) {
      removed += 1; // 引用已不存在 → 这条自动边失去依据
      continue;
    }
    expected.delete(edge.id);
    if (edge.role !== want.role) retargeted += 1;
    kept.push(want);
  }

  const added = expected.size;
  if (added === 0 && removed === 0 && retargeted === 0) {
    return { doc, added, removed, retargeted };
  }

  return {
    doc: { ...doc, edges: [...kept, ...expected.values()], updatedAt: now },
    added,
    removed,
    retargeted,
  };
}
