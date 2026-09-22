/**
 * 环形进度（施工单 §7 中栏）。
 *
 * 生成中**不留白转圈**：环上的流光弧（`flow` keyframe）承担"还在动"的感知，
 * 旁边始终给百分比与当前阶段文案 —— 用户能判断"卡住了"还是"在跑"。
 */
export interface ProgressRingProps {
  percent: number;
  /** 环心大字（默认百分比） */
  label?: string;
  /** 环下说明（阶段 / 提示） */
  caption?: string;
  /** 是否处于进行中：决定流光弧是否显示 */
  active: boolean;
}

const RADIUS = 45;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ProgressRing({ percent, label, caption, active }: ProgressRingProps) {
  const clamped = Math.min(100, Math.max(0, percent));
  const offset = CIRCUMFERENCE * (1 - clamped / 100);

  return (
    <div className="wb-empty">
      <div className="wb-ring">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <defs>
            <linearGradient id="wb-ring-flow-gradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.15" />
              <stop offset="100%" stopColor="var(--gold)" stopOpacity="1" />
            </linearGradient>
          </defs>

          <circle className="wb-ring-track" cx="50" cy="50" r={RADIUS} />
          <circle
            className="wb-ring-value"
            cx="50"
            cy="50"
            r={RADIUS}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
          />
          {active ? <circle className="wb-ring-flow" cx="50" cy="50" r={RADIUS} /> : null}
        </svg>

        <span className="wb-ring-label">{label ?? `${Math.round(clamped)}%`}</span>
      </div>

      {caption === undefined ? null : <span className="wb-ring-caption">{caption}</span>}
    </div>
  );
}
