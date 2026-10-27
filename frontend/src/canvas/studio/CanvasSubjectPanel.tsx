import { useState, type DragEvent, type ReactNode } from 'react';
import type { Subject } from '@astrmira/shared';
import { useTranslate } from '../../lib/i18n';
import { referenceThumbnailPath } from '../../lib/canvasReferences';

/**
 * 画布左侧「主体」面板（CONTRACT §21-18 / V2.86 / D-3）。
 *
 * ## 三条口径
 * 1. **主体不是新参考类型**：加进节点后就是一条普通参考 + 一个 `subjectId` 溯源标签；
 *    所以面板不提供"主体专属参数"，也不承诺一致性；
 * 2. **没有素材不能加**：按钮置灰并说明原因（不做点了没反应的按钮）；
 * 3. **拖拽与按钮两条路**：拖到节点上（`application/x-astrmira-subject`）或加到当前选中节点 ——
 *    拖到空白处会如实提示，不静默吞掉。
 */

/** 拖拽时携带的数据类型（画布 `onDrop` 按它分流：文件 / 主体） */
export const SUBJECT_DRAG_TYPE = 'application/x-astrmira-subject';

export interface CanvasSubjectPanelProps {
  subjects: readonly Subject[];
  loading: boolean;
  error: string | null;
  /** 当前选中的单个节点（多选 / 未选 = null） */
  selectedNodeId: string | null;
  busy: boolean;
  onRetry(): void;
  onClose(): void;
  onCreate(input: { name: string; description?: string }): Promise<void>;
  onDelete(subjectId: string): void;
  onPickAssets(subject: Subject): void;
  onAttach(subjectId: string, nodeId: string | null): void;
}

export function CanvasSubjectPanel({
  subjects,
  loading,
  error,
  selectedNodeId,
  busy,
  onRetry,
  onClose,
  onCreate,
  onDelete,
  onPickAssets,
  onAttach,
}: CanvasSubjectPanelProps): ReactNode {
  const t = useTranslate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const submit = async (): Promise<void> => {
    if (name.trim() === '' || busy) return;
    await onCreate({
      name: name.trim(),
      ...(description.trim() === '' ? {} : { description: description.trim() }),
    });
    setName('');
    setDescription('');
  };

  return (
    <aside className="cs-subjects" aria-label={t('canvas.subject.title')}>
      <header className="cs-subjects-head">
        <h3 className="cs-subjects-title">{t('canvas.subject.title')}</h3>
        <button
          type="button"
          className="cs-icon-btn"
          onClick={onClose}
          aria-label={t('canvas.subject.close')}
          title={t('canvas.subject.close')}
        >
          ×
        </button>
      </header>
      <p className="cs-subjects-hint">{t('canvas.subject.hint')}</p>

      <form
        className="cs-subject-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input
          className="cs-subject-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('canvas.subject.namePlaceholder')}
          maxLength={60}
          aria-label={t('canvas.subject.namePlaceholder')}
        />
        <input
          className="cs-subject-input"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={t('canvas.subject.descriptionPlaceholder')}
          maxLength={500}
          aria-label={t('canvas.subject.descriptionPlaceholder')}
        />
        <button
          type="submit"
          className="cs-subject-create"
          disabled={busy || name.trim() === ''}
        >
          {busy ? t('canvas.subject.creating') : t('canvas.subject.create')}
        </button>
      </form>

      {loading ? <p className="cs-subjects-note">{t('canvas.subject.loading')}</p> : null}
      {error === null ? null : (
        <div className="cs-subjects-error" role="alert">
          <span>{t('canvas.subject.error', { reason: error })}</span>
          <button type="button" className="cs-subject-link" onClick={onRetry}>
            {t('canvas.subject.retry')}
          </button>
        </div>
      )}

      {!loading && error === null && subjects.length === 0 ? (
        <p className="cs-subjects-note">{t('canvas.subject.empty')}</p>
      ) : null}

      <ul className="cs-subject-list">
        {subjects.map((subject) => {
          const canAttach = subject.assetIds.length > 0;
          return (
            <li
              key={subject.id}
              className="cs-subject-card"
              draggable={canAttach}
              onDragStart={(event: DragEvent<HTMLLIElement>) => {
                // 没有素材的主体不可拖：拖过去也加不了，先给"加素材"
                if (!canAttach) {
                  event.preventDefault();
                  return;
                }
                event.dataTransfer.setData(SUBJECT_DRAG_TYPE, subject.id);
                event.dataTransfer.effectAllowed = 'copy';
              }}
            >
              <div className="cs-subject-main">
                {subject.assetIds.length === 0 ? null : (
                  <img
                    className="cs-subject-thumb"
                    src={referenceThumbnailPath(subject.assetIds[0] as string)}
                    alt=""
                    loading="lazy"
                    onError={(event) => {
                      // 缩略图不一定存在（上传图没有抽帧）：退回纯文字，不假装有图
                      event.currentTarget.style.display = 'none';
                    }}
                  />
                )}
                <div className="cs-subject-text">
                  <span className="cs-subject-name">{subject.name}</span>
                  {subject.description === undefined ? null : (
                    <span className="cs-subject-desc">{subject.description}</span>
                  )}
                  <span className="cs-subject-count">
                    {subject.assetIds.length === 0
                      ? t('canvas.subject.noAssets')
                      : t('canvas.subject.assets', { count: subject.assetIds.length })}
                  </span>
                </div>
              </div>

              <div className="cs-subject-actions">
                <button
                  type="button"
                  className="cs-subject-link"
                  onClick={() => onPickAssets(subject)}
                >
                  {t('canvas.subject.pickAssets')}
                </button>
                <button
                  type="button"
                  className="cs-subject-link"
                  disabled={!canAttach || selectedNodeId === null}
                  title={
                    !canAttach
                      ? t('canvas.subject.needAssets')
                      : selectedNodeId === null
                        ? t('canvas.subject.needSelection')
                        : t('canvas.subject.addToSelected')
                  }
                  onClick={() => onAttach(subject.id, selectedNodeId)}
                >
                  {t('canvas.subject.addToSelected')}
                </button>
                <button
                  type="button"
                  className="cs-subject-link cs-subject-danger"
                  onClick={() => onDelete(subject.id)}
                  aria-label={t('canvas.subject.delete')}
                >
                  {t('canvas.subject.delete')}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
