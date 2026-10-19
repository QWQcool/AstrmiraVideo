import { useTranslate } from '../lib/i18n';

export type ComposerKind = 'video' | 'image';

export interface CreationTypeBarProps {
  kind: ComposerKind;
  onChange(next: ComposerKind): void;
  /**
   * 图片模型是否已接入。
   * S2 固定 `false`（S4 才接真实适配），界面必须**如实**标注"待接入"，
   * 而不是让用户填完参数才发现提交不了。
   */
  imageReady?: boolean;
}

/**
 * 创作类型切换条（Step 11-S2；设计基准 §7.2 的"创作类型驱动参数"）。
 *
 * 为什么是分段控件而不是下拉：只有两态，一眼看全；下拉会把"还有图片这回事"藏起来。
 * Agent 态不在 S2 开放（S6 做对话式编排），所以这里只有视频 / 图片。
 */
export function CreationTypeBar({ kind, onChange, imageReady = false }: CreationTypeBarProps) {
  const t = useTranslate();

  return (
    <div className="cr-types" role="group" aria-label={t('create.type.aria')}>
      <span className="cr-types-label">{t('create.type.label')}</span>
      <span className="cr-types-seg">
        <button
          type="button"
          className="cr-types-btn"
          aria-pressed={kind === 'video'}
          onClick={() => onChange('video')}
        >
          {t('create.type.video')}
        </button>
        <button
          type="button"
          className="cr-types-btn"
          aria-pressed={kind === 'image'}
          onClick={() => onChange('image')}
        >
          {t('create.type.image')}
          {imageReady ? null : <span className="cr-types-badge">{t('create.type.pending')}</span>}
        </button>
      </span>
    </div>
  );
}
