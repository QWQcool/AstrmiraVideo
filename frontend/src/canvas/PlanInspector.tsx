import type { AspectRatio, CanvasPlan, CanvasPlanNode, GenerationMode } from '@astrmira/shared';
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
}

const ASPECT_RATIOS: AspectRatio[] = ['16:9', '9:16', '1:1'];

export function PlanInspector({ plan, node, run, onChange, onRemove, onClose }: PlanInspectorProps) {
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
