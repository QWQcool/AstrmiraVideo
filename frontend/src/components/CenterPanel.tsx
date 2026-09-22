import type { AspectRatio, TaskProgress } from '@astrmira/shared';
import { Eyebrow } from './Eyebrow';
import { ProgressRing } from './ProgressRing';
import { UncertainNotice } from './UncertainNotice';
import type { ApiError } from '../lib/api';
import { resolveMediaUrl } from '../lib/api';
import { formatClock, resolveTargetSize, statusLabel } from '../lib/format';

/**
 * 中栏视窗（施工单 §7）。
 *
 * 状态 → 画面必须一一对应，不允许出现"转圈但没有百分比"或"失败但界面还在转"：
 * queued/running→进度环（带流光，`flow` keyframe）、succeeded→播放器 + 下载、
 * failed→错误分支（`UNCERTAIN_RESULT` 走人工核对卡，见 AC7）。
 */
export interface CenterPanelProps {
  task: TaskProgress | null;
  pollingError: ApiError | null;
  aspectRatio: AspectRatio;
  elapsedSeconds: number;
  uncertainAcknowledged: boolean;
  onAcknowledgeUncertain: () => void;
  onAbandonUncertain: () => void;
  onCancel: () => void;
  onRequestReuse: () => void;
}

export function CenterPanel({
  task,
  pollingError,
  aspectRatio,
  elapsedSeconds,
  uncertainAcknowledged,
  onAcknowledgeUncertain,
  onAbandonUncertain,
  onCancel,
  onRequestReuse,
}: CenterPanelProps) {
  const target = resolveTargetSize(aspectRatio);
  const videoUrl = task === null ? null : resolveMediaUrl(task.outputVideoUrl);

  return (
    <section className="wb-panel wb-panel-center">
      <div className="wb-field-head">
        <Eyebrow index={2} tone="gold" as="h2">
          实时视窗
        </Eyebrow>
        <span className="wb-note">
          {target.width}×{target.height} · 32 倍数对齐
        </span>
      </div>

      <div className="wb-viewport">
        <div className="wb-viewport-stage">
          {renderStage()}
        </div>

        <div className="wb-transport">
          <span className="wb-timecode">
            {task === null
              ? '--:-- / --:--'
              : `${formatClock(elapsedSeconds * 1000)} · ${statusLabel(task.status)}`}
          </span>

          <div className="wb-card-actions">
            {task !== null && (task.status === 'queued' || task.status === 'running') ? (
              <button type="button" className="wb-btn" onClick={onCancel}>
                取消任务
              </button>
            ) : null}

            <a
              className="wb-btn"
              href={videoUrl ?? undefined}
              download={videoUrl === null ? undefined : `${task?.taskId ?? 'video'}.mp4`}
              aria-disabled={videoUrl === null}
              style={videoUrl === null ? { opacity: 0.45, pointerEvents: 'none' } : undefined}
            >
              下载 MP4
            </a>
          </div>
        </div>
      </div>
    </section>
  );

  function renderStage() {
    if (pollingError !== null && pollingError.failure.kind === 'contract') {
      return (
        <div className="wb-empty">
          <span className="wb-empty-icon">✧</span>
          <span className="wb-empty-title">任务不可用</span>
          <span className="wb-note">{pollingError.failure.message}</span>
          <span className="wb-note">任务可能已被清理；可从右栏历史重新发起。</span>
        </div>
      );
    }

    if (task === null) {
      return (
        <div className="wb-empty">
          <span className="wb-empty-icon">✧</span>
          <span className="wb-empty-title">等待生成任务下发</span>
          <span className="wb-note">配置左侧提示词与参考首帧后，点击「立即生成视频」。</span>
          <span className="wb-watermark">Astrmira · awaiting signal</span>
        </div>
      );
    }

    if (task.status === 'succeeded' && videoUrl !== null) {
      return (
        <>
          <video className="wb-video" src={videoUrl} controls loop playsInline />
          <span className="wb-done-mark" title="生成完成">
            ✦
          </span>
        </>
      );
    }

    if (task.status === 'succeeded') {
      return (
        <div className="wb-empty">
          <span className="wb-empty-icon">✧</span>
          <span className="wb-empty-title">任务已完成</span>
          <span className="wb-note">
            但成片地址缺失（outputVideoUrl 为空）。这属于异常，请检查服务端输出目录。
          </span>
        </div>
      );
    }

    if (task.status === 'failed') {
      const uncertain = task.error?.disposition === 'uncertain';

      return (
        <div className="wb-empty">
          {uncertain ? (
            <UncertainNotice
              message={task.error?.message ?? '结果不明'}
              taskId={task.taskId}
              acknowledged={uncertainAcknowledged}
              onAcknowledge={onAcknowledgeUncertain}
              onAbandon={onAbandonUncertain}
            />
          ) : (
            <>
              <span className="wb-empty-title">未完成 · {task.error?.code ?? '未知错误'}</span>
              <span className="wb-note">{task.error?.message ?? '任务失败'}</span>
              <span className="wb-note">
                {task.error?.disposition === 'retryable'
                  ? '该错误属可重试类：确认外部条件（额度 / 限流 / 网络）后可用同一参数再次发起。'
                  : '该错误属终止类：重复提交大概率仍会失败，请先修正参数或凭据。'}
              </span>
              <button type="button" className="wb-btn wb-btn-gold" onClick={onRequestReuse}>
                复用参数
              </button>
            </>
          )}
        </div>
      );
    }

    if (task.status === 'cancelled') {
      return (
        <div className="wb-empty">
          <span className="wb-empty-icon">✧</span>
          <span className="wb-empty-title">任务已取消</span>
          <span className="wb-note">{task.message ?? '该任务不再继续执行。'}</span>
        </div>
      );
    }

    // queued / running
    return (
      <ProgressRing
        percent={task.progressPercent}
        active
        caption={
          task.status === 'queued'
            ? '已入队 · 等待执行'
            : task.message ?? `生成中 · ${statusLabel(task.status)}`
        }
      />
    );
  }
}
