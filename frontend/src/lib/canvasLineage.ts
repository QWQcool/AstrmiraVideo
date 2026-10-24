import type { CanvasDoc, CanvasDocEdge, CanvasReferenceRole } from '@astrmira/shared';
import { canvasNodeVisibleOutput } from './canvasDocOps';

/**
 * 画布来源边（Step 11-S3 片 B4；CONTRACT §21-11）。
 *
 * 一条来源边 = 「下游这一次确实把上游的产物当成了参考」。因此：
 * 1. **上游必须有成功产物**（没有产物就没有可记录的事实）；
 * 2. **加边必须同时写入下游的 `references`**，删边要删掉对应的那条参考；
 * 3. **参考固定在连接那一刻的产物**：上游之后重跑不静默改写下游参考（用户要新产物就删边重连）。
 *
 * 全部纯函数：视图只负责把问题码翻成一句中文，判定本身可单测。
 */

export type CanvasLineageProblem =
  | 'node-missing'
  | 'self'
  | 'duplicate'
  | 'cycle'
  | 'source-no-output'
  | 'source-version-invalid'
  | 'source-audio'
  | 'source-not-media'
  | 'target-not-video'
  | 'role-taken';

export type CanvasLineagePlan =
  | { ok: true; role: CanvasReferenceRole; assetId: string; order: number }
  | { ok: false; problem: CanvasLineageProblem };

/** 沿已有边从 `start` 出发能不能走到 `goal`（用于拒绝环；`canvasReferenceLineage` 复用） */
export function canReach(doc: CanvasDoc, start: string, goal: string): boolean {
  const adjacency = new Map<string, string[]>();
  for (const edge of doc.edges) {
    const list = adjacency.get(edge.from);
    if (list === undefined) adjacency.set(edge.from, [edge.to]);
    else list.push(edge.to);
  }
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) continue;
    if (current === goal) return true;
    seen.add(current);
    for (const next of adjacency.get(current) ?? []) stack.push(next);
  }
  return false;
}

/**
 * 计划一条来源边：检查怎么连、用什么角色、写哪条参考。
 *
 * 拒绝顺序：节点存在 → 自环 → 重复 → 环 → 上游产物 → 上游类型 → 下游类型 → 角色占位。
 */
export function planCanvasLineage(doc: CanvasDoc, from: string, to: string): CanvasLineagePlan {
  const source = doc.nodes.find((node) => node.id === from);
  const target = doc.nodes.find((node) => node.id === to);
  if (source === undefined || target === undefined) {
    return { ok: false, problem: 'node-missing' };
  }
  if (from === to) return { ok: false, problem: 'self' };
  if (canReach(doc, to, from)) return { ok: false, problem: 'cycle' };

  const visible = canvasNodeVisibleOutput(source);
  if (visible.state === 'invalid') return { ok: false, problem: 'source-version-invalid' };
  if (visible.state !== 'selected' && visible.state !== 'latest') {
    return { ok: false, problem: 'source-no-output' };
  }
  const output = visible.output;
  if (source.type === 'audio' || output.kind === 'audio') {
    return { ok: false, problem: 'source-audio' };
  }
  if (output.kind !== 'image' && output.kind !== 'video') {
    return { ok: false, problem: 'source-not-media' };
  }
  if (target.type !== 'video') return { ok: false, problem: 'target-not-video' };

  // 同一对节点：同一产物重复连接拒绝；换了可见版本允许再连一条（旧边仍固定原产物）
  if (
    doc.edges.some(
      (edge) =>
        edge.from === from &&
        edge.to === to &&
        (edge.assetId === undefined || edge.assetId === output.assetId),
    )
  ) {
    return { ok: false, problem: 'duplicate' };
  }

  // 同一个产物不能既当首帧又当尾帧（重复参考没有意义）
  if (target.data.draft.references.some((ref) => ref.assetId === output.assetId)) {
    return { ok: false, problem: 'duplicate' };
  }

  const roles = target.data.draft.references.map((ref) => ref.role);
  let role: CanvasReferenceRole;
  if (output.kind === 'image') {
    if (!roles.includes('first-frame')) role = 'first-frame';
    else if (!roles.includes('last-frame')) role = 'last-frame';
    else return { ok: false, problem: 'role-taken' };
  } else {
    if (roles.includes('reference-video')) return { ok: false, problem: 'role-taken' };
    role = 'reference-video';
  }

  const order = target.data.draft.references.filter((ref) => ref.role === role).length;
  return { ok: true, role, assetId: output.assetId, order };
}

export interface CanvasLineageResult {
  doc: CanvasDoc;
  edge: CanvasDocEdge | null;
  problem: CanvasLineageProblem | null;
}

/** 加边 + 把上游产物写进下游参考（一步完成，避免"有边没参考"的半状态） */
export function addCanvasLineageEdge(
  doc: CanvasDoc,
  from: string,
  to: string,
  edgeId: string,
  now: number = Date.now(),
): CanvasLineageResult {
  const plan = planCanvasLineage(doc, from, to);
  if (!plan.ok) return { doc, edge: null, problem: plan.problem };

  const edge: CanvasDocEdge = {
    id: edgeId,
    from,
    to,
    kind: 'lineage',
    role: plan.role,
    assetId: plan.assetId,
  };
  const nodes = doc.nodes.map((node) => {
    if (node.id !== to) return node;
    return {
      ...node,
      data: {
        ...node.data,
        draft: {
          ...node.data.draft,
          references: [
            ...node.data.draft.references,
            { assetId: plan.assetId, role: plan.role, order: plan.order },
          ],
          updatedAt: now,
        },
      },
    };
  });

  return {
    doc: { ...doc, nodes, edges: [...doc.edges, edge], updatedAt: now },
    edge,
    problem: null,
  };
}

/** 上游节点所有批次产物 id（删边时用来找"这条边写进去的那条参考"） */
function sourceAssetIds(doc: CanvasDoc, from: string): Set<string> {
  const source = doc.nodes.find((node) => node.id === from);
  if (source === undefined) return new Set();
  const ids = new Set<string>();
  for (const batch of source.data.batches) {
    for (const output of batch.outputs) ids.add(output.assetId);
  }
  return ids;
}

/**
 * 删边 + 删掉它写进去的那条参考（按边上的角色与上游产物 id 匹配）。
 *
 * 只删一条：同一个上游可能在角色不同时被连了两次（首帧 / 尾帧），各边各管各的参考。
 */
export function removeCanvasLineageEdge(
  doc: CanvasDoc,
  edgeId: string,
  now: number = Date.now(),
): CanvasDoc {
  const edge = doc.edges.find((item) => item.id === edgeId);
  if (edge === undefined) return doc;

  const candidates = sourceAssetIds(doc, edge.from);
  const nodes = doc.nodes.map((node) => {
    if (node.id !== edge.to || candidates.size === 0) return node;
    const index = node.data.draft.references.findIndex((ref) => {
      // V2.53：新边按连接时的 assetId 精确删除；旧边缺 assetId 才退回候选集匹配
      if (edge.assetId !== undefined) {
        return (
          ref.assetId === edge.assetId &&
          (edge.role === undefined || ref.role === edge.role)
        );
      }
      return (
        candidates.has(ref.assetId) && (edge.role === undefined || ref.role === edge.role)
      );
    });
    if (index === -1) return node;
    const references = node.data.draft.references.filter((_ref, position) => position !== index);
    return {
      ...node,
      data: {
        ...node.data,
        draft: { ...node.data.draft, references, updatedAt: now },
      },
    };
  });

  return {
    ...doc,
    nodes,
    edges: doc.edges.filter((item) => item.id !== edgeId),
    updatedAt: now,
  };
}
