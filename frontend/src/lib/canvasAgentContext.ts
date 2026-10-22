import type {
  CanvasAgentContext,
  CanvasAgentEdgeContext,
  CanvasAgentNodeContext,
  CanvasDoc,
  CanvasOutput,
} from '@astrmira/shared';

export const CANVAS_AGENT_NODE_LIMIT = 120;
export const CANVAS_AGENT_EDGE_LIMIT = 240;
const PROMPT_LIMIT = 1200;

type OutputKind = CanvasOutput['kind'];

function outputKindsOf(node: CanvasDoc['nodes'][number]): OutputKind[] {
  const kinds = new Set<OutputKind>();
  for (const batch of node.data.batches) {
    for (const output of batch.outputs) kinds.add(output.kind);
  }
  return [...kinds];
}

function nodeContext(node: CanvasDoc['nodes'][number]): CanvasAgentNodeContext {
  return {
    id: node.id,
    type: node.type,
    title: node.data.title ?? node.id,
    prompt: node.data.draft.prompt.slice(0, PROMPT_LIMIT),
    batchCount: node.data.batches.length,
    outputKinds: outputKindsOf(node),
    referenceCount: node.data.draft.references.length,
  };
}

/**
 * S7-D1：把 CanvasDoc 派生成**只读快照**。
 *
 * 这个函数是纯函数，不修改 doc；超过上限时截断并设置 `truncated`，
 * 让模型必须承认“快照不完整”，而不是假装看过全部。
 */
export function buildCanvasAgentContext(
  doc: CanvasDoc,
  selectedNodeId?: string,
): CanvasAgentContext {
  const nodes = doc.nodes.slice(0, CANVAS_AGENT_NODE_LIMIT).map(nodeContext);
  const edges: CanvasAgentEdgeContext[] = doc.edges
    .slice(0, CANVAS_AGENT_EDGE_LIMIT)
    .map((edge) => ({
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      ...(edge.role === undefined ? {} : { role: edge.role }),
    }));
  const truncated =
    doc.nodes.length > CANVAS_AGENT_NODE_LIMIT || doc.edges.length > CANVAS_AGENT_EDGE_LIMIT;

  return {
    projectId: doc.projectId,
    name: doc.name,
    nodes,
    edges,
    ...(selectedNodeId === undefined ? {} : { selectedNodeId }),
    truncated,
  };
}

export function canvasAgentContextSummary(context: CanvasAgentContext): {
  nodes: number;
  edges: number;
  outputs: number;
  selected: string | null;
  truncated: boolean;
} {
  const outputIds = new Set<string>();
  for (const node of context.nodes) {
    if (node.outputKinds.length > 0) outputIds.add(node.id);
  }
  return {
    nodes: context.nodes.length,
    edges: context.edges.length,
    outputs: outputIds.size,
    selected: context.selectedNodeId ?? null,
    truncated: context.truncated,
  };
}
