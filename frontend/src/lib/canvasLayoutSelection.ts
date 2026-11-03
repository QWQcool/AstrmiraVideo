import type { CanvasDoc, CanvasDocNode } from '@astrmira/shared';

/**
 * 「按布局出图」的**选区规则**（V2.113 / B103-10）。
 *
 * 为什么先把规则写成纯函数：这是唯一一处"用户得先学会怎么选"的功能 ——
 * 选错了不该给一句含糊的失败，而应该**说清差什么**。规则本身要能被断言，所以不放进视图。
 *
 * ## 规则（一句话）
 * **选一个文本节点写整图描述，再选至少两个有提示词的节点当框。**
 *
 * - 文本节点 → `summary.caption`（整张图是什么画面）；它**不参与**布局框；
 * - 其他节点（图片/视频/音频/文本以外）的提示词 → 各自框的 `caption`；
 * - 没写提示词的节点**既不占框也不报错**（草图阶段本来就有一半是空的）。
 *
 * 为什么不让第一个框兼任 summary：那会把"这个框里画什么"和"整张图是什么"混成一句话，
 * 出来的图会既不像框也不像整图 —— 这正是这个功能最容易做成废品的失败模式。
 */
export type CanvasLayoutIssue = 'needTwoFrames' | 'needSummary' | 'tooManySummaries';

export interface CanvasLayoutSelection {
  /** 整图描述（来自唯一的那个文本节点） */
  summary: string;
  frames: { id: string; caption: string; layout: CanvasDocNode['layout'] }[];
}

export type CanvasLayoutSelectionResult =
  | { ok: true; selection: CanvasLayoutSelection }
  | { ok: false; issue: CanvasLayoutIssue; frameCount: number };

/** 从当前选区里挑出 summary 与框（顺序 = 文档顺序，保证同样的选法给同样的提示词） */
export function collectLayoutSelection(
  doc: CanvasDoc,
  selectedIds: readonly string[],
): CanvasLayoutSelectionResult {
  const selected = new Set(selectedIds);
  const picked = doc.nodes.filter((node) => selected.has(node.id));
  const summaryNodes = picked.filter(
    (node) => node.type === 'text' && node.data.draft.prompt.trim() !== '',
  );
  const frameNodes = picked.filter(
    (node) => node.type !== 'text' && node.data.draft.prompt.trim() !== '',
  );

  if (frameNodes.length < 2) {
    return {
      ok: false,
      issue: 'needTwoFrames',
      frameCount: frameNodes.length,
    };
  }
  if (summaryNodes.length === 0) {
    return { ok: false, issue: 'needSummary', frameCount: frameNodes.length };
  }
  if (summaryNodes.length > 1) {
    return { ok: false, issue: 'tooManySummaries', frameCount: frameNodes.length };
  }

  return {
    ok: true,
    selection: {
      summary: summaryNodes[0]!.data.draft.prompt.trim(),
      frames: frameNodes.map((node) => ({
        id: node.id,
        caption: node.data.draft.prompt.trim(),
        layout: node.layout,
      })),
    },
  };
}
