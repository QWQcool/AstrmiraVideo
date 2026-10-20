import { useEffect, useMemo, useState } from 'react';
import { fetchAssets, fetchHistory } from '../../lib/api';
import { useTranslate } from '../../lib/i18n';
import {
  filterReferenceSources,
  referenceSourceLabelKey,
  referenceSourcesFromAssets,
  referenceSourcesFromTasks,
  type ReferenceKind,
  type ReferenceSourceItem,
} from '../../lib/referenceSources';

/**
 * 资产库多选（Step 11-S3 片 B3；CONTRACT §21-10）。
 *
 * 只做三件事：读 `GET /api/assets?project=<当前资产项目>`、按名字/类型筛选、多选确认。
 * **不在这里上传**（本地上传是另一个入口，走 `POST /api/upload`）——
 * 两种来源在节点上用 `source` 区分（`from_asset` / `uploaded`）。
 */

type KindFilter = 'all' | ReferenceKind;

export interface AssetPickerDialogProps {
  /** 资产项目（不是画布项目；见 CONTRACT §12） */
  projectId: string;
  /** 只允许这些 kind；缺省 = 图/视频/音频（文本产物没有文件，不入选择器） */
  allowedKinds?: readonly ReferenceKind[];
  onClose(): void;
  onConfirm(sources: ReferenceSourceItem[]): void;
}

const KIND_FILTERS: readonly KindFilter[] = ['all', 'image', 'video', 'audio'];

export function AssetPickerDialog({
  projectId,
  allowedKinds = ['image', 'video', 'audio'],
  onClose,
  onConfirm,
}: AssetPickerDialogProps) {
  const t = useTranslate();
  const [sources, setSources] = useState<ReferenceSourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<KindFilter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        // S5-Ab：同一适配层列出上传素材、首页产物、画布产物，来源各不相同
        const [assetList, home, canvas] = await Promise.all([
          fetchAssets(projectId),
          fetchHistory({ project: projectId, limit: 200 }),
          fetchHistory({ project: projectId, origin: 'canvas', limit: 200 }),
        ]);
        if (alive) {
          setSources([
            ...referenceSourcesFromAssets(assetList.assets),
            ...referenceSourcesFromTasks(home.items, 'home'),
            ...referenceSourcesFromTasks(canvas.items, 'canvas'),
          ]);
          setError(null);
        }
      } catch (caught) {
        if (alive) setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId, reloadNonce]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const visible = useMemo(
    () =>
      filterReferenceSources(
        sources,
        query,
        filter === 'all' ? allowedKinds : [filter],
      ),
    [sources, filter, query, allowedKinds],
  );

  const kindLabel = (kind: ReferenceKind): string =>
    kind === 'image'
      ? t('common.kind.image')
      : kind === 'video'
        ? t('common.kind.video')
        : t('common.kind.audio');
  const kindFilters = KIND_FILTERS.filter(
    (key) => key === 'all' || allowedKinds.includes(key),
  );

  const toggle = (ref: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  };

  const confirm = (): void => {
    const picked = sources.filter((source) => selected.has(source.ref));
    onConfirm(picked);
  };

  return (
    <div
      className="cs-modal"
      role="dialog"
      aria-modal="true"
      aria-label={t('canvas.studio.pickerTitle')}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="cs-modal-panel">
        <header className="cs-modal-head">
          <h3 className="cs-modal-title">{t('canvas.studio.pickerTitle')}</h3>
          <button
            type="button"
            className="cs-modal-close"
            aria-label={t('canvas.studio.close')}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <p className="cs-modal-note">{t('canvas.studio.pickerNodeNote')}</p>

        <div className="cs-modal-tools">
          <input
            className="cs-modal-search"
            value={query}
            placeholder={t('canvas.studio.pickerSearch')}
            aria-label={t('canvas.studio.pickerSearch')}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="cs-modal-filters" role="group">
            {kindFilters.map((item) => (
              <button
                key={item}
                type="button"
                className="cs-chip"
                aria-pressed={filter === item}
                onClick={() => setFilter(item)}
              >
                {item === 'all' ? t('canvas.studio.filterAll') : kindLabel(item)}
              </button>
            ))}
          </div>
        </div>

        <div className="cs-modal-body">
          {loading ? <p className="cs-modal-note">{t('canvas.studio.pickerLoading')}</p> : null}
          {error !== null ? (
            <p className="cs-modal-note cs-modal-error">
              {t('canvas.studio.pickerError', { reason: error })}
              <button
                type="button"
                className="cs-toolbar-link"
                onClick={() => {
                  setLoading(true);
                  setReloadNonce((value) => value + 1);
                }}
              >
                {t('common.retry')}
              </button>
            </p>
          ) : null}
          {!loading && error === null && visible.length === 0 ? (
            <p className="cs-modal-note">{t('canvas.studio.pickerEmpty')}</p>
          ) : null}

          <div className="cs-asset-grid">
            {visible.map((source) => {
              const picked = selected.has(source.ref);
              return (
                <button
                  key={source.key}
                  type="button"
                  className={picked ? 'cs-asset is-picked' : 'cs-asset'}
                  aria-pressed={picked}
                  onClick={() => toggle(source.ref)}
                >
                  <span className="cs-asset-thumb">
                    {source.kind === 'image' && source.previewUrl !== undefined ? (
                      <img src={source.previewUrl} alt="" loading="lazy" draggable={false} />
                    ) : (
                      <span className="cs-asset-glyph">
                        {source.kind === 'video' ? '▶' : source.kind === 'audio' ? '♪' : 'T'}
                      </span>
                    )}
                  </span>
                  <span className="cs-asset-name" title={source.label}>
                    {source.label}
                  </span>
                  <span className="cs-asset-meta">
                    {t(referenceSourceLabelKey(source.source))} · {kindLabel(source.kind)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <footer className="cs-modal-foot">
          <span className="cs-modal-count">
            {t('canvas.studio.selected', { count: selected.size })}
          </span>
          <div className="cs-modal-actions">
            <button type="button" className="wb-btn" onClick={onClose}>
              {t('canvas.studio.cancel')}
            </button>
            <button
              type="button"
              className="wb-btn wb-btn-primary"
              disabled={selected.size === 0}
              onClick={confirm}
            >
              {t('canvas.studio.confirmAssets', { count: selected.size })}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
