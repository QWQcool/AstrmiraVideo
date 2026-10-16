import { taskOutput, type AspectRatio, type TaskProgress } from '@astrmira/shared';
import { Eyebrow } from './Eyebrow';
import { ProgressRing } from './ProgressRing';
import { UncertainNotice } from './UncertainNotice';
import type { ApiError } from '../lib/api';
import { resolveMediaUrl } from '../lib/api';
import {
  formatClock,
  resolveTargetSize,
  statusLabel,
  type ResolutionTier,
} from '../lib/format';
import { useTranslate } from '../lib/i18n';

/**
 * 中栏视窗（PLAN §4 Step 3）。
 *
 * 状态 → 画面必须一一对应，不允许出现"转圈但没有百分比"或"失败但界面还在转"：
 * queued/running→进度环（带流光，`flow` keyframe）、succeeded→播放器 + 下载、
 * failed→错误分支（`UNCERTAIN_RESULT` 走人工核对卡，见 AC7）。
 */
export interface CenterPanelProps {
  task: TaskProgress | null;
  pollingError: ApiError | null;
  aspectRatio: AspectRatio;
  /** 清晰度档：与左栏选择联动，决定顶部显示的目标尺寸 */
  resolutionTier: ResolutionTier;
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
  resolutionTier,
  elapsedSeconds,
  uncertainAcknowledged,
  onAcknowledgeUncertain,
  onAbandonUncertain,
  onCancel,
  onRequestReuse,
}: CenterPanelProps) {
  const t = useTranslate();
  const target = resolveTargetSize(aspectRatio, resolutionTier);
  // V2.40：产物可能是视频或图片（`t2i`）—— 用 shared 的 `taskOutput()` 收口
  const output = task === null ? { kind: 'none' as const } : taskOutput(task);
  const videoUrl = output.kind === 'video' ? resolveMediaUrl(output.url) : null;
  const imageUrl = output.kind === 'image' ? resolveMediaUrl(output.url) : null;
  /** 下载按钮用（视频或图片都算"有产物"）；扩展名按类型给 */
  const outputUrl = videoUrl ?? imageUrl;
  const downloadName =
    task === null
      ? undefined
      : `${task.taskId}${output.kind === 'image' ? imageUrl?.slice(imageUrl.lastIndexOf('.')) ?? '.png' : '.mp4'}`;

  return (
    // data-status 是 V9 · B6 的动效挂接点：生成中/排队中时，CSS 会给视窗加一层呼吸微光晕
    // （纯 CSS，不需要在组件里加/删节点）
    <section className="wb-panel wb-panel-center" data-status={task?.status ?? 'idle'}>
      <div className="wb-field-head">
        <Eyebrow index={2} tone="gold" as="h2">
          {t('workbench.center.eyebrow')}
        </Eyebrow>
        <span className="wb-note">
          {t('workbench.center.sizeNote', { width: target.width, height: target.height })}
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
              : t('workbench.center.timecode', {
                  clock: formatClock(elapsedSeconds * 1000),
                  status: statusLabel(task.status),
                })}
          </span>

          <div className="wb-card-actions">
            {task !== null && (task.status === 'queued' || task.status === 'running') ? (
              <button type="button" className="wb-btn" onClick={onCancel}>
                {t('workbench.center.cancel')}
              </button>
            ) : null}

            <a
              className="wb-btn"
              href={outputUrl ?? undefined}
              download={outputUrl === null ? undefined : downloadName}
              aria-disabled={outputUrl === null}
              style={outputUrl === null ? { opacity: 0.45, pointerEvents: 'none' } : undefined}
            >
              {t('workbench.center.download')}
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
          <span className="wb-empty-title">{t('workbench.center.unavailable')}</span>
          <span className="wb-note">{pollingError.failure.message}</span>
          <span className="wb-note">{t('workbench.center.unavailableNote')}</span>
        </div>
      );
    }

    if (task === null) {
      return (
        <div className="wb-empty">
          <span className="wb-empty-icon">✧</span>
          <span className="wb-empty-title">{t('workbench.center.waiting')}</span>
          <span className="wb-note">{t('workbench.center.waitingNote')}</span>
          <span className="wb-watermark">Astrmira · awaiting signal</span>
        </div>
      );
    }

    if (task.status === 'succeeded' && videoUrl !== null) {
      return (
        <>
          <video className="wb-video" src={videoUrl} controls loop playsInline />
          {/* V9 · B6：star-gather 提级到播放器中央。`key` 用 taskId 保证"换任务/重新出片即重播" */}
          <span className="wb-done-wrap" key={task.taskId}>
            <span className="wb-done-mark" title={t('workbench.center.doneMark')} aria-hidden="true">
              ✦
            </span>
          </span>
        </>
      );
    }

    // V2.40：图片产物（`t2i`）—— 复用播放器的框，按 contain 展示（不裁切）
    if (task.status === 'succeeded' && imageUrl !== null) {
      return (
        <img
          className="wb-video"
          src={imageUrl}
          alt={t('workbench.center.imageAlt')}
          style={{ objectFit: 'contain' }}
        />
      );
    }

    if (task.status === 'succeeded') {
      return (
        <div className="wb-empty">
          <span className="wb-empty-icon">✧</span>
          <span className="wb-empty-title">{t('workbench.center.doneNoUrl')}</span>
          <span className="wb-note">{t('workbench.center.doneNoUrlNote')}</span>
        </div>
      );
    }

    if (task.status === 'failed') {
      const uncertain = task.error?.disposition === 'uncertain';

      return (
        <div className="wb-empty">
          {uncertain ? (
            <UncertainNotice
              message={task.error?.message ?? t('workbench.center.uncertain')}
              taskId={task.taskId}
              acknowledged={uncertainAcknowledged}
              onAcknowledge={onAcknowledgeUncertain}
              onAbandon={onAbandonUncertain}
            />
          ) : (
            <>
              <span className="wb-empty-title">
                {t('workbench.center.failedTitle', {
                  code: task.error?.code ?? t('workbench.center.unknownError'),
                })}
              </span>
              <span className="wb-note">
                {task.error?.message ?? t('workbench.center.failedMessage')}
              </span>
              <span className="wb-note">
                {task.error?.disposition === 'retryable'
                  ? t('workbench.center.retryable')
                  : t('workbench.center.fatal')}
              </span>
              <button type="button" className="wb-btn wb-btn-gold" onClick={onRequestReuse}>
                {t('workbench.center.reuse')}
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
          <span className="wb-empty-title">{t('workbench.center.cancelled')}</span>
          <span className="wb-note">{task.message ?? t('workbench.center.cancelledNote')}</span>
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
            ? t('workbench.center.queued')
            : (task.message ??
              t('workbench.center.running', { status: statusLabel(task.status) }))
        }
      />
    );
  }
}
