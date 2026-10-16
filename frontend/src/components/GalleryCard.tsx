import { taskOutput, type TaskProgress } from '@astrmira/shared';
import { Eyebrow } from './Eyebrow';
import { resolveMediaUrl } from '../lib/api';
import { EXECUTED_BY_LABEL_KEYS, EXECUTED_BY_TITLE_KEYS, formatIndex, statusLabel } from '../lib/format';
import { useTranslate } from '../lib/i18n';

/**
 * 画廊卡片（PLAN §4 Step 3 右栏）。
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
  const t = useTranslate();
  // V2.40：产物可能是**视频或图片**（`t2i`）—— 用 shared 的 `taskOutput()` 读，
  // 六处渲染点各写一遍分支迟早会漂移（口径见其注释）
  const output = taskOutput(task);
  const videoUrl = output.kind === 'video' ? resolveMediaUrl(output.url) : null;
  const imageUrl = output.kind === 'image' ? resolveMediaUrl(output.url) : null;
  const thumbnailUrl = resolveMediaUrl(task.thumbnailUrl);
  // `?? ''` 只为满足 <img src> 的类型；真正的分支判据是 `showThumbnail`
  const thumbnailSrc = thumbnailUrl ?? '';
  const showThumbnail = thumbnailUrl !== null;
  const snapshot = task.requestSnapshot;
  const prompt = snapshot.prompt.trim();
  /** 只有"成功且产物地址可用"的任务才可点 —— 其余（未完成/失败/已被清理）保持不可点 */
  const playable = (videoUrl !== null || imageUrl !== null) && task.status === 'succeeded';

  const thumbContent =
    // 图片产物：它本身就是封面（不需要抽帧），点开在中栏看大图
    imageUrl !== null ? (
      <img src={imageUrl} alt="" loading="lazy" decoding="async" />
    ) : videoUrl === null ? (
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
          title={t('workbench.gallery.playTitle')}
          aria-label={t('workbench.gallery.playAria', { index })}
        >
          {thumbContent}
        </button>
      ) : (
        // 不可播的卡片保持静态：点它没有意义，做成按钮反而会让人以为"点了没反应 = 坏了"
        <div className="wb-card-thumb" title={t('workbench.gallery.noOutput')}>
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

        <span className="wb-card-prompt">
          {prompt === '' ? t('workbench.gallery.emptyPrompt') : prompt}
        </span>

        <span className="wb-note">
          {snapshot.aspectRatio} · {snapshot.provider}
          {snapshot.params?.seed === undefined ? '' : ` · seed ${snapshot.params.seed}`}
          {snapshot.assets?.firstFrameImage === undefined
            ? ''
            : t('workbench.gallery.hasReference')}
        </span>

        {/* V2.27（台账 A1 片 A / B11）：**这条在哪跑的**如实标注 ——
            本地轨（D49）的全部价值都建立在它上面。缺省 = 老任务，**不猜**（宁可不写）。 */}
        {task.executedBy === undefined ? null : (
          <span
            className="wb-note"
            data-testid="gallery-executed-by"
            title={t(EXECUTED_BY_TITLE_KEYS[task.executedBy])}
          >
            {t('workbench.gallery.executedAt', { label: t(EXECUTED_BY_LABEL_KEYS[task.executedBy]) })}
          </span>
        )}

        {task.warnings === undefined || task.warnings.length === 0 ? null : (
          <span className="wb-note">⚠ {task.warnings.join('；')}</span>
        )}

        <div className="wb-card-actions">
          <button type="button" className="wb-btn" onClick={() => onReuse(task)}>
            {t('workbench.center.reuse')}
          </button>
          <button
            type="button"
            className="wb-btn"
            onClick={() => onDelete(task.taskId)}
            disabled={deleting}
          >
            {deleting ? t('workbench.gallery.deleting') : t('common.delete')}
          </button>
        </div>
      </div>
    </article>
  );
}
