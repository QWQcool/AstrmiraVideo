import {
  PLAN_RETRY_DEFAULT_BACKOFF_MS,
  type AspectRatio,
  type CanvasPlan,
  type CanvasPlanNode,
  type GenerationMode,
} from '@astrmira/shared';
import { useTranslate } from '../lib/i18n';
import { PLAN_SUPPORTED_MODES, planNodeBlockReason } from '../lib/canvasPlan';
import type { PlanNodeRunResult } from '../lib/canvasPlanRunner';
import { canvasModeLabel } from './labels';

/**
 * 编排节点面板（V2.26 / 台账 A5 片 A）：右边这块是"编辑这条节点"的地方。
 *
 * 三条口径：
 * 1. **实时写回**（每次按键就落本机存储，与便签同一取舍：量小、不做防抖）——
 *    "写了一半去接杯水，回来发现编排没保存"是比多写几次 localStorage 糟得多的体验；
 * 2. **阻断原因置顶**：现在不能跑的原因写在最上面（而不是等点了「运行」才报）；
 * 3. **不提供 i2v / fl2v**：它们需要素材槽，而编排里没有素材选择（片 A 的边界，如实说清）。
 *
 * 语言迁移第九批（片 A）：文案走 `canvas.inspector.*`。
 *
 * ⚠️ 两处**句内加粗**按本仓惯例拆成 `partN`（字典值只能是纯文本，加粗由这里的 JSX 保留）：
 * 拆段的边界空格**写进了字典值**（如 `'只对 '` 的尾随空格），所以渲染结果与迁移前一致。
 * 第十批（片 B）起，阻断原因（来自 `lib/canvasPlan.ts`）与模式名（`canvasModeLabel`
 * → `common.mode.*`）也走字典了。
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
  const t = useTranslate();
  const blocked = planNodeBlockReason(plan, node.id);

  return (
    <aside className="cv-drawer" aria-label={t('canvas.inspector.title')}>
      <div className="cv-drawer-head">
        <span className="cv-drawer-title">{t('canvas.inspector.title')}</span>
        <button type="button" className="wb-btn" onClick={onClose}>
          {t('canvas.inspector.collapse')}
        </button>
      </div>
      <p className="wb-note cv-drawer-sub">{t('canvas.inspector.subtitle')}</p>

      <section className="cv-insp-section">
        {blocked === null ? (
          <p className="wb-note cv-plan-ok">{t('canvas.inspector.ready')}</p>
        ) : (
          <p className="wb-note cv-plan-bad" data-testid="cv-plan-block">
            {t('canvas.inspector.blocked', { reason: blocked })}
          </p>
        )}
      </section>

      {/* V2.29（B68 / B69）：只重跑这一段及其下游 —— 上游沿用上次产物（省钱的关键入口） */}
      <section className="cv-insp-section">
        <h3 className="cv-insp-title">{t('canvas.inspector.run.title')}</h3>
        <button
          type="button"
          className="wb-btn"
          data-testid="cv-rerun-node"
          disabled={running || blocked !== null}
          title={
            blocked !== null
              ? t('canvas.inspector.rerun.blockedHint')
              : t('canvas.inspector.rerun.hint')
          }
          onClick={onRerun}
        >
          {t('canvas.inspector.rerun.action')}
        </button>
        <p className="wb-note">
          {t('canvas.inspector.rerun.note.part1')}
          <strong>{t('canvas.inspector.rerun.note.part2')}</strong>
          {t('canvas.inspector.rerun.note.part3')}
        </p>
      </section>

      {/* V2.29（B68 第二批）：**固定** —— 钉住"很贵 / 已经满意"的那一段，之后只重跑下游 */}
      <section className="cv-insp-section">
        <h3 className="cv-insp-title">{t('canvas.inspector.artifact.title')}</h3>
        {node.pinnedTaskId === undefined ? (
          <>
            <p className="wb-note" data-testid="cv-pin-state">
              {node.lastTaskId === undefined
                ? t('canvas.inspector.pin.none')
                : t('canvas.inspector.pin.lastTask', { id: node.lastTaskId.slice(0, 8) })}
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
              {t('canvas.inspector.pin.action')}
            </button>
          </>
        ) : (
          <>
            <p className="wb-note cv-plan-pinned" data-testid="cv-pin-state">
              {t('canvas.inspector.pin.pinned', { id: node.pinnedTaskId.slice(0, 8) })}
            </p>
            <button type="button" className="wb-btn" data-testid="cv-unpin-node" onClick={onUnpin}>
              {t('canvas.inspector.unpin.action')}
            </button>
          </>
        )}
      </section>

      {/* V2.29（B74 第二批）：节点级重试 —— 只对"可能靠重试变好"的失败生效 */}
      <section className="cv-insp-section">
        <h3 className="cv-insp-title">{t('canvas.inspector.retry.title')}</h3>
        <label className="cv-plan-field">
          {t('canvas.inspector.retry.attempts')}
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
            <option value={1}>{t('canvas.inspector.retry.option1')}</option>
            <option value={2}>{t('canvas.inspector.retry.optionN', { n: 2 })}</option>
            <option value={3}>{t('canvas.inspector.retry.optionN', { n: 3 })}</option>
          </select>
        </label>
        <p className="wb-note">
          {t('canvas.inspector.retry.note.part1')}
          <strong>{t('canvas.inspector.retry.note.part2')}</strong>
          {t('canvas.inspector.retry.note.part3')}
          <strong>{t('canvas.inspector.retry.note.part4')}</strong>
          {t('canvas.inspector.retry.note.part5')}
          <strong>{t('canvas.inspector.retry.note.part6')}</strong>
          {t('canvas.inspector.retry.note.part7')}
        </p>
      </section>

      <section className="cv-insp-section">
        <h3 className="cv-insp-title">{t('canvas.inspector.prompt.title')}</h3>
        <textarea
          className="cv-plan-textarea"
          data-testid="cv-plan-prompt"
          value={node.prompt}
          rows={6}
          placeholder={t('canvas.inspector.prompt.placeholder')}
          onChange={(event) => onChange({ prompt: event.target.value })}
        />
      </section>

      <section className="cv-insp-section">
        <h3 className="cv-insp-title">{t('canvas.inspector.mode.title')}</h3>
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
              {canvasModeLabel(mode)}
            </button>
          ))}
        </div>
        <p className="wb-note">{t('canvas.inspector.mode.note')}</p>
      </section>

      <section className="cv-insp-section">
        <h3 className="cv-insp-title">{t('canvas.inspector.size.title')}</h3>
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
          {t('canvas.inspector.duration.label')}
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
          {t('canvas.inspector.seed.label')}
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
          <h3 className="cv-insp-title">{t('canvas.inspector.lastRun.title')}</h3>
          {run.state === 'submitted' ? (
            <p className="wb-note cv-plan-ok">
              {t('canvas.inspector.lastRun.submitted', { id: run.taskId ?? '' })}
            </p>
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
          {t('canvas.inspector.remove')}
        </button>
      </div>
    </aside>
  );
}
