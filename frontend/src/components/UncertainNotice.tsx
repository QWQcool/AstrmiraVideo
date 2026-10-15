import { useTranslate } from '../lib/i18n';

/**
 * `UNCERTAIN_RESULT` 的人工核对提示（Step 3 AC7 / PLAN §3 防线 7）。
 *
 * 这里**故意不提供**「一键重跑」：
 * 结果不明意味着"可能已经出片、可能已经计费"，自动或一键重提就是**重复付费**。
 * 界面只做三件事：解释清楚、给出去服务商后台核对的指引、让用户显式决定后续状态。
 */
export interface UncertainNoticeProps {
  message: string;
  taskId: string;
  acknowledged: boolean;
  onAcknowledge: () => void;
  onAbandon: () => void;
}

export function UncertainNotice({
  message,
  taskId,
  acknowledged,
  onAcknowledge,
  onAbandon,
}: UncertainNoticeProps) {
  const t = useTranslate();

  return (
    <div className="wb-uncertain">
      <span className="wb-uncertain-title">{t('workbench.uncertain.title')}</span>

      <span className="wb-uncertain-body">
        {t('workbench.uncertain.feeNote')}
        <br />
        {t('workbench.uncertain.taskId.before')}
        <code>{taskId}</code>
        {t('workbench.uncertain.taskId.after')}
      </span>

      <span className="wb-uncertain-body">{message}</span>

      <span className="wb-uncertain-body">
        <strong>{t('workbench.uncertain.noRetry.emphasis')}</strong>
        {t('workbench.uncertain.noRetry.after')}
      </span>

      <div className="wb-card-actions">
        <button
          type="button"
          className="wb-btn"
          onClick={onAcknowledge}
          disabled={acknowledged}
        >
          {acknowledged
            ? t('workbench.uncertain.acknowledged')
            : t('workbench.uncertain.acknowledge')}
        </button>
        <button type="button" className="wb-btn" onClick={onAbandon}>
          {t('workbench.uncertain.abandon')}
        </button>
      </div>
    </div>
  );
}
