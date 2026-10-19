import { useEffect } from 'react';
import { useTranslate } from '../lib/i18n';

/**
 * 结果全屏预览（Step 11-S4）。
 *
 * 只做一件事：把已经生成好的图片/视频放到一个不干扰的遮罩里看和下载。
 * 不自带播放器状态、不做编辑、不复制文件；关闭 = 点遮罩 / 点关闭 / 按 Esc。
 */
export interface MediaLightboxProps {
  open: boolean;
  kind: 'image' | 'video';
  url: string;
  title?: string;
  downloadName?: string;
  onClose: () => void;
}

export function MediaLightbox({
  open,
  kind,
  url,
  title,
  downloadName,
  onClose,
}: MediaLightboxProps) {
  const t = useTranslate();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="wb-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={title ?? t('common.preview')}
      onClick={onClose}
    >
      <button
        type="button"
        className="wb-lightbox-close"
        aria-label={t('common.close')}
        onClick={onClose}
      >
        ✕
      </button>
      <div className="wb-lightbox-media" onClick={(event) => event.stopPropagation()}>
        {kind === 'image' ? (
          <img src={url} alt={title ?? t('common.preview')} />
        ) : (
          <video src={url} controls autoPlay loop playsInline />
        )}
      </div>
      <div className="wb-lightbox-bar" onClick={(event) => event.stopPropagation()}>
        {title === undefined || title === '' ? null : <span className="wb-note">{title}</span>}
        <a className="wb-btn" href={url} download={downloadName}>
          {t('common.download')}
        </a>
      </div>
    </div>
  );
}
