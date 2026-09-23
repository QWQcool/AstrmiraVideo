import type { TaskProgress } from '@astrmira/shared';
import { Eyebrow } from './Eyebrow';
import { resolveMediaUrl } from '../lib/api';
import { formatIndex, statusLabel } from '../lib/format';

/**
 * 画廊卡片（施工单 §7 右栏）。
 *
 * `outputVideoUrl` 经 `resolveMediaUrl` 收口：只认同源 `/media/...`，
 * 拒绝绝对地址与 `..` —— 卡片缩略图同样是 `<video src>`，这也是注入面。
 *
 * V1.9：优先用服务端抽好的 **JPEG 首帧**（`thumbnailUrl`）。
 * 50 条历史若各挂一个 `<video preload="metadata">`，就是 50 个媒体元素同时抢带宽；
 * 换成图片后可懒加载、可缓存。
 * 两个回落分支都是**有意保留**的：旧记录（缩略图字段上线前产生的）没有该字段，
 * 抽帧失败的任务也不会有 —— 那时回到 `<video>`，画廊不会因此空一块。
 */
export interface GalleryCardProps {
  task: TaskProgress;
  /** 1-based 序号，渲染为 3 位索引号（AC6） */
  index: number;
  deleting: boolean;
  /** 这张卡对应的任务当前是否正显示在中栏（用于高亮，避免"点了但不知道看的是哪条"） */
  active: boolean;
  onReuse: (task: TaskProgress) => void;
  /**
   * 点封面 → 把该任务载入中栏播放（V8.3 批次 7，台账 B26）。
   *
   * 修的是这次用户报障：封面上那个 ▶ 原本只是**装饰角标**，卡片只有「复用参数 / 删除」，
   * 于是"别人跑完的成片点不开"。服务端侧一直正常（`/media/<id>.mp4` 206、封面 200）。
   */
  onPreview: (task: TaskProgress) => void;
  onDelete: (taskId: string) => void;
}

export function GalleryCard({
  task,
  index,
  deleting,
  active,
  onReuse,
  onPreview,
  onDelete,
}: GalleryCardProps) {
  const videoUrl = resolveMediaUrl(task.outputVideoUrl);
  const thumbnailUrl = resolveMediaUrl(task.thumbnailUrl);
  // `?? ''` 只为满足 <img src> 的类型；真正的分支判据是 `showThumbnail`
  const thumbnailSrc = thumbnailUrl ?? '';
  const showThumbnail = thumbnailUrl !== null;
  const snapshot = task.requestSnapshot;
  const prompt = snapshot.prompt.trim();
  /** 只有"成功且成片地址可用"的任务才可播 —— 其余（未完成/失败/已被清理）保持不可点 */
  const playable = videoUrl !== null && task.status === 'succeeded';

  const thumbContent =
    videoUrl === null ? (
      <span>{statusLabel(task.status)}</span>
    ) : showThumbnail ? (
      <>
        <img src={thumbnailSrc} alt="" loading="lazy" decoding="async" />
        <span className="wb-card-play" aria-hidden="true">
          ▶
        </span>
      </>
    ) : (
      <video src={videoUrl} muted preload="metadata" playsInline />
    );

  return (
    <article className={`wb-card${active ? ' wb-card-active' : ''}`}>
      {playable ? (
        <button
          type="button"
          className="wb-card-thumb wb-card-thumb-button"
          onClick={() => onPreview(task)}
          title="在中栏播放这条成片"
          aria-label={`播放第 ${index} 条成片`}
        >
          {thumbContent}
        </button>
      ) : (
        // 不可播的卡片保持静态：点它没有意义，做成按钮反而会让人以为"点了没反应 = 坏了"
        <div className="wb-card-thumb" title="该任务没有可播放的成片">
          {thumbContent}
        </div>
      )}

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
