import {
  PLAN_RETRY_DEFAULT_BACKOFF_MS,
  type AspectRatio,
  type CanvasPlan,
  type CanvasPlanNode,
  type GenerationMode,
} from '@astrmira/shared';
import { PLAN_SUPPORTED_MODES, planNodeBlockReason } from '../lib/canvasPlan';
import type { PlanNodeRunResult } from '../lib/canvasPlanRunner';
import { CANVAS_MODE_LABELS } from './labels';

/**
 * 编排节点面板（V2.26 / 台账 A5 片 A）：右边这块是"编辑这条节点"的地方。
 *
 * 三条口径：
 * 1. **实时写回**（每次按键就落本机存储，与便签同一取舍：量小、不做防抖）——
 *    "写了一半去接杯水，回来发现编排没保存"是比多写几次 localStorage 糟得多的体验；
 * 2. **阻断原因置顶**：现在不能跑的原因写在最上面（而不是等点了「运行」才报）；
 * 3. **不提供 i2v / fl2v**：它们需要素材槽，而编排里没有素材选择（片 A 的边界，如实说清）。
 */

export interface PlanInspectorProps {
  plan: CanvasPlan;
  node: CanvasPlanNode;
  run: PlanNodeRunResult | undefined;
  onChange: (patch: Partial<Omit<CanvasPlanNode, 'id' | 'position'>>) => void;
  onRemove: () => void;
  onClose: () => void;
  /** V2.29（B68 / B69）：从这条节点开始重跑（它 ∪ 它的下游，换一代幂等键） */
  onRerun: () => void;
  /** V2.29（B68 第二批）：固定这条节点的产物（之后永不重提交）。`taskId` 只能是它已有的产物 */
  onPin: (taskId: string) => void;
  onUnpin: () => void;
  /** V2.29（B74 第二批）：节点级重试设置（null = 回到"不重试"） */
  onRetryChange: (retry: CanvasPlanNode['retry'] | null) => void;
  /** 面板里有些动作要在"运行中"时禁用（重跑开着就再点一次 = 双份任务） */
  running: boolean;
}

const ASPECT_RATIOS: AspectRatio[] = ['16:9', '9:16', '1:1'];

export function PlanInspector({
  plan,
  node,
  run,
  onChange,
  onRemove,
  onClose,
  onRerun,
  onPin,
  onUnpin,
  onRetryChange,
  running,
}: PlanInspectorProps) {
  const blocked = planNodeBlockReason(plan, node.id);

  return (
    <aside className="cv-drawer" aria-label="编排节点">
      <div className="cv-drawer-head">
        <span className="cv-drawer-title">编排节点</span>
        <button type="button" className="wb-btn" onClick={onClose}>
          收起
        </button>
      </div>
      <p className="wb-note cv-drawer-sub">
        这张卡是"打算做什么"；点「▶ 运行编排」才会变成真实任务。
      </p>

      <section className="cv-insp-section">
        {blocked === null ? (
          <p className="wb-note cv-plan-ok">✓ 可以跑（写好了就点运行）</p>
        ) : (
          <p className="wb-note cv-plan-bad" data-testid="cv-plan-block">
            现在不能跑：{blocked}
          </p>
        )}
      </section>

      {/* V2.29（B68 / B69）：只重跑这一段及其下游 —— 上游沿用上次产物（省钱的关键入口） */}
      <section className="cv-insp-section">
        <h3 className="cv-insp-title">执行</h3>
        <button
          type="button"
          className="wb-btn"
          data-testid="cv-rerun-node"
          disabled={running || blocked !== null}
          title={
            blocked !== null
              ? '先修好这条节点（原因见上）'
              : '从这条节点开始重跑：它和它的下游都会新建任务（真的计费）；上游沿用上次产物'
          }
          onClick={onRerun}
        >
          🔁 重跑此节点及下游
        </button>
        <p className="wb-note">
          换一代幂等键 → <strong>这条与它的下游会新建任务（真的计费）</strong>；
          上游不在范围内、沿用上次产物。若某个上游本机没有产物记录，下游会如实跳过并说明原因。
        </p>
      </section>

      {/* V2.29（B68 第二批）：**固定** —— 钉住"很贵 / 已经满意"的那一段，之后只重跑下游 */}
      <section className="cv-insp-section">
        <h3 className="cv-insp-title">产物</h3>
        {node.pinnedTaskId === undefined ? (
          <>
            <p className="wb-note" data-testid="cv-pin-state">
              {node.lastTaskId === undefined
                ? '还没有产物可固定 —— 先运行一次，出片之后就能把这一段钉住'
                : `上次产物 ${node.lastTaskId.slice(0, 8)}（固定 = 之后任何运行都不再重提交它）`}
            </p>
            <button
              type="button"
              className="wb-btn"
              data-testid="cv-pin-node"
              disabled={node.lastTaskId === undefined || running}
              onClick={() => {
                if (node.lastTaskId !== undefined) onPin(node.lastTaskId);
              }}
            >
              📌 固定这条的产物
            </button>
          </>
        ) : (
          <>
            <p className="wb-note cv-plan-pinned" data-testid="cv-pin-state">
              📌 已固定 {node.pinnedTaskId.slice(0, 8)} ——
              之后任何运行（含「重跑全部」）都不会再动这一段，下游一律引用它
            </p>
            <button type="button" className="wb-btn" data-testid="cv-unpin-node" onClick={onUnpin}>
              🔓 取消固定
            </button>
          </>
        )}
      </section>

      {/* V2.29（B74 第二批）：节点级重试 —— 只对"可能靠重试变好"的失败生效 */}
      <section className="cv-insp-section">
        <h3 className="cv-insp-title">失败重试</h3>
        <label className="cv-plan-field">
          提交失败最多试
          <select
            data-testid="cv-retry-attempts"
            value={node.retry?.maxAttempts ?? 1}
            onChange={(event) => {
              const attempts = Number(event.target.value);
              onRetryChange(
                attempts <= 1
                  ? null
                  : {
                      maxAttempts: attempts,
                      backoffMs: node.retry?.backoffMs ?? PLAN_RETRY_DEFAULT_BACKOFF_MS,
                    },
              );
            }}
          >
            <option value={1}>1 次（不重试）</option>
            <option value={2}>2 次</option>
            <option value={3}>3 次</option>
          </select>
        </label>
        <p className="wb-note">
          只对 <strong>5xx / 网络错误</strong>重试；参数错误（4xx）与<strong>冷却（429）不重试</strong>
          （后者的意思是"等一下再点"）。重试<strong>沿用同一个幂等键</strong> —— 不会因此多花一次钱。
        </p>
      </section>

      <section className="cv-insp-section">
        <h3 className="cv-insp-title">提示词</h3>
        <textarea
          className="cv-plan-textarea"
          data-testid="cv-plan-prompt"
          value={node.prompt}
          rows={6}
          placeholder="写清这一镜要什么（参考图/参考视频由连线给）"
          onChange={(event) => onChange({ prompt: event.target.value })}
        />
      </section>

      <section className="cv-insp-section">
        <h3 className="cv-insp-title">模式</h3>
        <div className="cv-plan-seg">
          {PLAN_SUPPORTED_MODES.map((mode: GenerationMode) => (
            <button
              key={mode}
              type="button"
              className="cv-tool"
              aria-pressed={node.mode === mode}
              data-testid={`cv-plan-mode-${mode}`}
              onClick={() => onChange({ mode })}
            >
              {CANVAS_MODE_LABELS[mode]}
            </button>
          ))}
        </div>
        <p className="wb-note">
          片 A 的编排只支持这两种：i2v / fl2v 需要素材槽（选图上传），属后续片。
        </p>
      </section>

      <section className="cv-insp-section">
        <h3 className="cv-insp-title">画幅与时长</h3>
        <div className="cv-plan-seg">
          {ASPECT_RATIOS.map((ratio) => (
            <button
              key={ratio}
              type="button"
              className="cv-tool"
              aria-pressed={node.aspectRatio === ratio}
              onClick={() => onChange({ aspectRatio: ratio })}
            >
              {ratio}
            </button>
          ))}
        </div>
        <label className="cv-plan-field">
          时长（秒，1~10）
          <input
            type="number"
            min={1}
            max={10}
            value={node.durationSec ?? 5}
            onChange={(event) => {
              const parsed = Number(event.target.value);
              if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 10) {
                onChange({ durationSec: Math.floor(parsed) });
              }
            }}
          />
        </label>
        <label className="cv-plan-field">
          seed（留空 = 随机）
          <input
            type="number"
            value={node.seed ?? ''}
            onChange={(event) => {
              if (event.target.value === '') {
                onChange({ seed: undefined });
                return;
              }
              const parsed = Number(event.target.value);
              if (Number.isInteger(parsed)) onChange({ seed: parsed });
            }}
          />
        </label>
      </section>

      {run === undefined ? null : (
        <section className="cv-insp-section">
          <h3 className="cv-insp-title">上次运行</h3>
          {run.state === 'submitted' ? (
            <p className="wb-note cv-plan-ok">✓ 已提交：{run.taskId}</p>
          ) : run.state === 'kept' ? (
            // 三种"没提交"的原因完全不同，配色也不该混：跳过/失败是红的，保留是中性的
            <p className="wb-note cv-plan-kept">⏸ {run.message}</p>
          ) : (
            <p className="wb-note cv-plan-bad">{run.state === 'failed' ? '✗' : '⏭'} {run.message}</p>
          )}
        </section>
      )}

      <div className="cv-drawer-actions">
        <button type="button" className="wb-btn" data-testid="cv-plan-remove" onClick={onRemove}>
          删除节点
        </button>
      </div>
    </aside>
  );
}
