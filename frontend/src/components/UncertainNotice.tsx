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
  return (
    <div className="wb-uncertain">
      <span className="wb-uncertain-title">结果不明 · 需要人工核对</span>

      <span className="wb-uncertain-body">
        可能已产生费用，请到服务商后台核对后手动处理。
        <br />
        任务编号 <code>{taskId}</code> —— 该编号在上游不一定存在，若后台看不到对应记录，说明请求未真正受理。
      </span>

      <span className="wb-uncertain-body">{message}</span>

      <span className="wb-uncertain-body">
        <strong>不会自动重试，也不提供一键重跑</strong>：重复提交可能被上游重复计费。
        确认上游无扣费后，可点击下方按钮用同一参数重新发起一次新任务。
      </span>

      <div className="wb-card-actions">
        <button
          type="button"
          className="wb-btn"
          onClick={onAcknowledge}
          disabled={acknowledged}
        >
          {acknowledged ? '已标记核对' : '标记已核对'}
        </button>
        <button type="button" className="wb-btn" onClick={onAbandon}>
          放弃任务
        </button>
      </div>
    </div>
  );
}
