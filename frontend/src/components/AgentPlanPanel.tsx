import type { AgentPlan, AgentPlanUsage, SkillManifest, SkillParams } from '@astrmira/shared';
import { useTranslate, type MessageKey } from '../lib/i18n';

/**
 * Agent 计划卡（S6-B2）。
 *
 * 只展示 + 让用户选择“应用/拒绝/修改意图”：
 * - 应用由 CreateView 落到草稿，不在这里发生成请求；
 * - 引用/技能/参数都按 step 原样展示，不把计划改写成“已完成”。
 */

export interface AgentPlanPanelProps {
  plan: AgentPlan;
  model: string;
  usage?: AgentPlanUsage;
  skills: readonly SkillManifest[];
  applying: boolean;
  onApply(): void;
  onReject(): void;
  onModify(): void;
}

const ROLE_KEYS: Record<string, MessageKey> = {
  firstFrame: 'agent.plan.role.firstFrame',
  lastFrame: 'agent.plan.role.lastFrame',
  referenceImage: 'agent.plan.role.referenceImage',
  referenceVideo: 'agent.plan.role.referenceVideo',
  audio: 'agent.plan.role.audio',
};

function paramsText(
  t: ReturnType<typeof useTranslate>,
  params: SkillParams | undefined,
): string[] {
  if (params === undefined) return [];
  const values: string[] = [];
  if (params.aspectRatio !== undefined) {
    values.push(t('agent.plan.aspect', { value: params.aspectRatio }));
  }
  if (params.resolutionTier !== undefined) {
    values.push(t('agent.plan.resolution', { value: params.resolutionTier }));
  }
  if (params.durationSec !== undefined) {
    values.push(t('agent.plan.duration', { seconds: params.durationSec }));
  }
  return values;
}

export function AgentPlanPanel({
  plan,
  model,
  usage,
  skills,
  applying,
  onApply,
  onReject,
  onModify,
}: AgentPlanPanelProps) {
  const t = useTranslate();

  return (
    <section className="cr-agent" data-testid="agent-plan" aria-label={t('agent.plan.title')}>
      <header className="cr-agent-head">
        <div>
          <h3 className="cr-agent-title">{t('agent.plan.title')}</h3>
          <p className="wb-note">
            {t('agent.plan.model', { model })} · {t('agent.plan.hint')}
          </p>
        </div>
        <span className="recipe-tag recipe-tag--gold">{plan.version === 1 ? 'v1' : plan.version}</span>
      </header>

      <p className="cr-agent-summary">{plan.summary}</p>

      <h4 className="cr-agent-label">{t('agent.plan.steps')}</h4>
      <ol className="cr-agent-steps">
        {plan.steps.map((step, index) => {
          const reason =
            'reason' in step && step.reason !== undefined
              ? t('agent.plan.reason', { reason: step.reason })
              : null;
          if (step.kind === 'apply-skill') {
            const skill = skills.find((item) => item.id === step.skillId);
            return (
              <li key={`${step.kind}-${index}`} className="cr-agent-step">
                <span className="cr-agent-kind">{t('agent.plan.step.applySkill')}</span>
                <span className="cr-agent-body">
                  <strong>{skill?.name ?? step.skillId}</strong>
                  {step.prompt === undefined ? null : (
                    <span className="wb-note cr-agent-detail">{step.prompt}</span>
                  )}
                  {paramsText(t, step.params).map((value) => (
                    <span className="recipe-tag" key={value}>
                      {value}
                    </span>
                  ))}
                  {reason === null ? null : <span className="wb-note">{reason}</span>}
                </span>
              </li>
            );
          }
          if (step.kind === 'add-reference') {
            return (
              <li key={`${step.kind}-${index}`} className="cr-agent-step">
                <span className="cr-agent-kind">{t('agent.plan.step.addReference')}</span>
                <span className="cr-agent-body">
                  <code>{step.ref}</code>
                  <span className="recipe-tag">
                    {ROLE_KEYS[step.role] === undefined
                      ? step.role
                      : t(ROLE_KEYS[step.role])}
                  </span>
                  {reason === null ? null : <span className="wb-note">{reason}</span>}
                </span>
              </li>
            );
          }
          if (step.kind === 'set-params') {
            return (
              <li key={`${step.kind}-${index}`} className="cr-agent-step">
                <span className="cr-agent-kind">{t('agent.plan.step.setParams')}</span>
                <span className="cr-agent-body">
                  <span className="cr-agent-tags">
                    {paramsText(t, step.params).map((value) => (
                      <span className="recipe-tag" key={value}>
                        {value}
                      </span>
                    ))}
                  </span>
                  {reason === null ? null : <span className="wb-note">{reason}</span>}
                </span>
              </li>
            );
          }
          return (
            <li key={`${step.kind}-${index}`} className="cr-agent-step">
              <span className="cr-agent-kind">{t('agent.plan.step.note')}</span>
              <span className="cr-agent-body">{step.text}</span>
            </li>
          );
        })}
      </ol>

      {plan.assumptions.length === 0 ? null : (
        <div className="cr-agent-notes">
          <h4 className="cr-agent-label">{t('agent.plan.assumptions')}</h4>
          <ul>
            {plan.assumptions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {plan.warnings.length === 0 ? null : (
        <div className="cr-agent-notes cr-agent-warnings">
          <h4 className="cr-agent-label">{t('agent.plan.warnings')}</h4>
          <ul>
            {plan.warnings.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      <footer className="cr-agent-foot">
        <span className="wb-note">
          {usage === undefined
            ? t('agent.plan.costPending')
            : `${t('agent.plan.usage', {
                prompt: usage.promptTokens,
                completion: usage.completionTokens,
              })} · ${t('agent.plan.costPending')}`}
        </span>
        <span className="cr-agent-actions">
          <button type="button" className="wb-btn" onClick={onModify} disabled={applying}>
            {t('agent.plan.modify')}
          </button>
          <button type="button" className="wb-btn" onClick={onReject} disabled={applying}>
            {t('agent.plan.reject')}
          </button>
          <button
            type="button"
            className="wb-btn wb-btn-gold"
            data-testid="agent-apply"
            onClick={onApply}
            disabled={applying}
          >
            {applying ? t('agent.plan.applying') : t('agent.plan.apply')}
          </button>
        </span>
      </footer>
    </section>
  );
}
