import type { TaskProgress } from '@astrmira/shared';
import { Eyebrow } from './Eyebrow';
import { GalleryCard } from './GalleryCard';
import { statusLabel } from '../lib/format';
import { useTranslate } from '../lib/i18n';

/**
 * 右栏：任务队列 + 历史画廊（PLAN §4 Step 3）。
 * 队列只显示"当前这个"（后端本身也是拒绝并发/排队语义），画廊是已完成任务的沉淀与回填入口。
 */
export interface RightPanelProps {
  current: TaskProgress | null;
  history: TaskProgress[];
  historyError: string | null;
  loadingHistory: boolean;
  deletingId: string | null;
  onReuse: (task: TaskProgress) => void;
  /** 点封面 → 中栏播放（V8.3 批次 7 / 台账 B26） */
  onPreview: (task: TaskProgress) => void;
  onDelete: (taskId: string) => void;
  onRefresh: () => void;
}

export function RightPanel({
  current,
  history,
  historyError,
  loadingHistory,
  deletingId,
  onReuse,
  onPreview,
  onDelete,
  onRefresh,
}: RightPanelProps) {
  const t = useTranslate();

  return (
    <section className="wb-panel">
      <div className="wb-field-head">
        <Eyebrow index={3} tone="gold" as="h2">
          {t('workbench.right.eyebrow')}
        </Eyebrow>
        <button type="button" className="wb-btn" onClick={onRefresh} disabled={loadingHistory}>
          {loadingHistory ? t('workbench.right.refreshing') : t('workbench.right.refresh')}
        </button>
      </div>

      <div className="wb-field">
        <span className="wb-label">{t('workbench.right.current')}</span>
        {current === null ? (
          <span className="wb-note">{t('workbench.right.noCurrent')}</span>
        ) : (
          <div className="wb-queue-item wb-queue-item-active">
            <span
              className={
                current.status === 'running'
                  ? 'wb-dot wb-dot-busy'
                  : current.status === 'succeeded'
                    ? 'wb-dot wb-dot-ok'
                    : 'wb-dot'
              }
            />
            <span>{statusLabel(current.status)}</span>
            <span className="wb-note">{Math.round(current.progressPercent)}%</span>
            <span className="wb-note" style={{ marginLeft: 'auto' }}>
              {current.taskId.slice(0, 8)}
            </span>
          </div>
        )}
      </div>

      <div className="wb-field" style={{ flex: 1, minHeight: 0 }}>
        <span className="wb-label">
          {t('workbench.right.history', { count: history.length })}
        </span>

        {historyError === null ? null : <span className="wb-warn">{historyError}</span>}

        {history.length === 0 ? (
          <div className="wb-empty" style={{ padding: '24px 8px' }}>
            <span className="wb-empty-icon">🎞</span>
            <span className="wb-note">{t('workbench.right.noHistory')}</span>
            <span className="wb-note">{t('workbench.right.noHistoryNote')}</span>
            <span className="wb-watermark">Astrmira gallery</span>
          </div>
        ) : (
          <div className="wb-list">
            {history.map((item, position) => (
              <GalleryCard
                key={item.taskId}
                task={item}
                index={position + 1}
                deleting={deletingId === item.taskId}
                active={current?.taskId === item.taskId}
                onReuse={onReuse}
                onPreview={onPreview}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
