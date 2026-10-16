import { Handle, Position, type Node, NodeProps } from '@xyflow/react';
import type { CanvasPlanNode } from '@astrmira/shared';
import { useTranslate } from '../lib/i18n';
import type { PlanNodeRunResult } from '../lib/canvasPlanRunner';
import { CANVAS_MODE_LABELS } from './labels';

/**
 * 编排节点卡片（V2.26 / 台账 A5 片 A）。
 *
 * 与事实图节点（`NodeCard.tsx`）的区别，一句话：**这张卡画的是"打算做什么"，不是"已经发生了什么"**。
 * 因此：句柄可交互（能连线）、执行状态来自**本轮运行结果**（不是任务状态）、文案用将来时。
 *
 * ⚠️ 句柄必须在这里声明（`Handle` 是 React Flow 找连线锚点的唯一方式）——
 * `nodesConnectable` 只控制"能不能拖出线"，句柄本身在两种模式下都要渲染，
 * 否则从只读切到编排模式时锚点会凭空出现/消失。
 *
 * 语言迁移第九批（片 A）：本卡文案走 `canvas.*`。
 * ⚠️ 模式名仍来自 `canvas/labels.ts`（**片 B** 才迁）—— 它此刻还是中文映射表，
 * 所以英文界面下这一行会是"中文模式名 + 其余英文"；那是**分片的中间态**，不是漏做。
 */
export type PlanFlowNode = Node<
  { node: CanvasPlanNode; run?: PlanNodeRunResult },
  'plan'
>;

export function PlanNodeCard({ data, selected }: NodeProps<PlanFlowNode>) {
  const { node, run } = data;
  const t = useTranslate();
  const state = run?.state ?? 'idle';
  const prompt = node.prompt.trim() === '' ? t('canvas.planNode.emptyPrompt') : node.prompt;

  return (
    <div
      className={`cv-node cv-plan-node cv-plan-${state}${selected === true ? ' cv-plan-selected' : ''}`}
      data-node-id={node.id}
      data-plan-state={state}
    >
      <Handle type="target" position={Position.Left} />
      <div className="cv-node-body">
        <span className="cv-node-line">
          <span className="cv-node-dot" />
          <span className="cv-node-label">{prompt}</span>
        </span>
        <span className="cv-node-sub">
          {CANVAS_MODE_LABELS[node.mode]} · {node.aspectRatio} · {node.durationSec ?? 5}s
        </span>
        {run?.state === 'submitted' ? (
          <span className="cv-node-sub cv-plan-ok">
            {t('canvas.planNode.submitted', { id: run.taskId?.slice(0, 8) ?? '' })}
          </span>
        ) : null}
        {run?.state === 'failed' ? (
          <span className="cv-node-sub cv-plan-bad">✗ {run.message}</span>
        ) : null}
        {run?.state === 'skipped' ? (
          <span className="cv-node-sub cv-plan-skip">⏭ {run.message}</span>
        ) : null}
        {/* V2.29（B68 部分重跑）：本轮**没提交**的节点也要说清为什么 ——
            "卡片上什么都没变"会让用户以为它跑了。 */}
        {run?.state === 'kept' ? (
          <span className="cv-node-sub cv-plan-kept">⏸ {run.message}</span>
        ) : null}
        {/* 固定标记与"本轮结果"无关：它是编排自身的状态，运行时没跑也要看得见 */}
        {node.pinnedTaskId === undefined ? null : (
          <span className="cv-node-sub cv-plan-pinned">
            {t('canvas.planNode.pinned', { id: node.pinnedTaskId.slice(0, 8) })}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
