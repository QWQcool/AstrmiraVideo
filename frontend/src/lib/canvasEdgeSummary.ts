import type { CanvasDocEdge, CanvasDocNode, CanvasReferenceRole } from '@astrmira/shared';

/**
 * B109 / D76：引用边的**按需说明**（纯函数）。
 *
 * ## 为什么要有它
 * 细白线把"谁引用了谁"画出来了，但"引用的是什么用途、哪个版本"只在数据里。
 * 常驻标签会让画布变吵（设计规格要求默认无箭头/标签），所以说明只在悬停 / 选中 / 键盘焦点出现。
 *
 * ## 三条诚实规则
 * 1. **不编版本**：`assetId` 缺省（旧边 / 计划边）就返回 `version: undefined`，
 *    界面必须写"版本未记录"，不能拿当前最新产物冒充"这条边引用过的版本"；
 * 2. **不编标题**：节点标题缺省时返回 `label: undefined` + 类型，由界面用"类型 + id 短码"兜底；
 * 3. **计划边没有产物**：`kind === 'dependency'` 只表达意图，`version` 恒为 undefined。
 */

export interface CanvasEdgeEndpoint {
  id: string;
  /** 节点标题或提示词摘要；缺省 = 界面按类型 + 短码显示 */
  label?: string;
  type?: CanvasDocNode['type'];
  /** 节点已经不在画布上（悬空边）：界面必须如实说"节点已不在画布上" */
  missing: boolean;
}

export interface CanvasEdgeSummary {
  source: CanvasEdgeEndpoint;
  target: CanvasEdgeEndpoint;
  kind: CanvasDocEdge['kind'];
  /** 用途（仅 `lineage` 有）；缺省 = 未记录 */
  role?: CanvasReferenceRole;
  /** 连接那一刻的产物 id（`task:<id>` 或资产 id）；缺省 = 未记录 */
  version?: string;
  versionRecorded: boolean;
}

function shortId(id: string): string {
  return id.length <= 8 ? id : id.slice(0, 8);
}

function endpoint(node: CanvasDocNode | undefined, id: string): CanvasEdgeEndpoint {
  if (node === undefined) return { id, missing: true };
  const title = node.data.title?.trim();
  const prompt = node.data.draft.prompt.trim();
  const label =
    title !== undefined && title !== ''
      ? title
      : prompt !== ''
        ? prompt.length > 20
          ? `${prompt.slice(0, 20)}…`
          : prompt
        : undefined;
  return { id, type: node.type, missing: false, ...(label === undefined ? {} : { label }) };
}

/** 边 id 的短码（UI 在两端都缺省时至少还能指明是哪条边） */
export function edgeShortId(id: string): string {
  return shortId(id);
}

/**
 * 边的说明；节点缺失时仍返回说明（画布允许悬空边，UI 如实说"节点已不在画布上"），
 * 只有空的 from/to 才返回 null。
 */
export function canvasEdgeSummary(
  edge: CanvasDocEdge,
  nodes: readonly CanvasDocNode[],
): CanvasEdgeSummary | null {
  if (edge.from === '' || edge.to === '') return null;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const version = edge.kind === 'dependency' ? undefined : edge.assetId;
  return {
    source: endpoint(byId.get(edge.from), edge.from),
    target: endpoint(byId.get(edge.to), edge.to),
    kind: edge.kind,
    ...(edge.role === undefined ? {} : { role: edge.role }),
    ...(version === undefined ? {} : { version }),
    versionRecorded: version !== undefined,
  };
}
