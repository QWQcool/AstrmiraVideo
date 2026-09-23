import type { TaskProgress } from '@astrmira/shared';
import { Eyebrow } from './Eyebrow';
import { GalleryCard } from './GalleryCard';
import { statusLabel } from '../lib/format';

/**
 * 右栏：任务队列 + 历史画廊（施工单 §7）。
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
  return (
    <section className="wb-panel">
      <div className="wb-field-head">
        <Eyebrow index={3} tone="gold" as="h2">
          任务与画廊
        </Eyebrow>
        <button type="button" className="wb-btn" onClick={onRefresh} disabled={loadingHistory}>
          {loadingHistory ? '刷新中…' : '刷新'}
        </button>
      </div>

      <div className="wb-field">
        <span className="wb-label">当前任务</span>
        {current === null ? (
          <span className="wb-note">暂无进行中的任务</span>
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
        <span className="wb-label">历史成片（{history.length}）</span>

        {historyError === null ? null : <span className="wb-warn">{historyError}</span>}

        {history.length === 0 ? (
          <div className="wb-empty" style={{ padding: '24px 8px' }}>
            <span className="wb-empty-icon">🎞</span>
            <span className="wb-note">暂无历史成片</span>
            <span className="wb-note">生成后的成片会在这里沉淀，支持参数一键回填。</span>
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
