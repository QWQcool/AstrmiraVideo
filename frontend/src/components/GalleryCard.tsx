import type { TaskProgress } from '@astrmira/shared';
import { Eyebrow } from './Eyebrow';
import { resolveMediaUrl } from '../lib/api';
import { formatIndex, statusLabel } from '../lib/format';

/**
 * 画廊卡片（施工单 §7 右栏）。
 *
 * `outputVideoUrl` 经 `resolveMediaUrl` 收口：只认同源 `/media/...`，
 * 拒绝绝对地址与 `..` —— 卡片缩略图同样是 `<video src>`，这也是注入面。
 */
export interface GalleryCardProps {
  task: TaskProgress;
  /** 1-based 序号，渲染为 3 位索引号（AC6） */
  index: number;
  deleting: boolean;
  onReuse: (task: TaskProgress) => void;
  onDelete: (taskId: string) => void;
}

export function GalleryCard({ task, index, deleting, onReuse, onDelete }: GalleryCardProps) {
  const videoUrl = resolveMediaUrl(task.outputVideoUrl);
  const snapshot = task.requestSnapshot;
  const prompt = snapshot.prompt.trim();

  return (
    <article className="wb-card">
      <div className="wb-card-thumb">
        {videoUrl === null ? (
          <span>{statusLabel(task.status)}</span>
        ) : (
          <video src={videoUrl} muted preload="metadata" playsInline />
        )}
      </div>

      <div className="wb-card-body">
        <div className="wb-field-head">
          <Eyebrow index={index} tone="gold">
            {statusLabel(task.status)}
          </Eyebrow>
          <span className="wb-note">{formatIndex(index)}</span>
        </div>

        <span className="wb-card-prompt">{prompt === '' ? '（无提示词）' : prompt}</span>

        <span className="wb-note">
          {snapshot.aspectRatio} · {snapshot.provider}
          {snapshot.params?.seed === undefined ? '' : ` · seed ${snapshot.params.seed}`}
          {snapshot.assets?.firstFrameImage === undefined ? '' : ' · 含参考图'}
        </span>

        {task.warnings === undefined || task.warnings.length === 0 ? null : (
          <span className="wb-note">⚠ {task.warnings.join('；')}</span>
        )}

        <div className="wb-card-actions">
          <button type="button" className="wb-btn" onClick={() => onReuse(task)}>
            复用参数
          </button>
          <button
            type="button"
            className="wb-btn"
            onClick={() => onDelete(task.taskId)}
            disabled={deleting}
          >
            {deleting ? '删除中…' : '删除'}
          </button>
        </div>
      </div>
    </article>
  );
}
