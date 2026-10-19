import { useEffect, useMemo, useState } from 'react';
import type { AssetListEntry } from '@astrmira/shared';
import { fetchAssets } from '../../lib/api';
import { useTranslate } from '../../lib/i18n';

/**
 * 资产库多选（Step 11-S3 片 B3；CONTRACT §21-10）。
 *
 * 只做三件事：读 `GET /api/assets?project=<当前资产项目>`、按名字/类型筛选、多选确认。
 * **不在这里上传**（本地上传是另一个入口，走 `POST /api/upload`）——
 * 两种来源在节点上用 `source` 区分（`from_asset` / `uploaded`）。
 */

type KindFilter = 'all' | 'image' | 'video' | 'audio';

export interface AssetPickerDialogProps {
  /** 资产项目（不是画布项目；见 CONTRACT §12） */
  projectId: string;
  onClose(): void;
  onConfirm(assets: AssetListEntry[]): void;
}

const KIND_FILTERS: readonly KindFilter[] = ['all', 'image', 'video', 'audio'];

export function AssetPickerDialog({ projectId, onClose, onConfirm }: AssetPickerDialogProps) {
  const t = useTranslate();
  const [assets, setAssets] = useState<AssetListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<KindFilter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const result = await fetchAssets(projectId);
        if (alive) {
          setAssets(result.assets);
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
  }, [projectId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return assets.filter((asset) => {
      if (filter !== 'all' && asset.kind !== filter) return false;
      if (needle === '') return true;
      const name = asset.name?.toLocaleLowerCase() ?? '';
      return name.includes(needle) || asset.assetId.toLocaleLowerCase().includes(needle);
    });
  }, [assets, filter, query]);

  const kindLabel = (kind: AssetListEntry['kind']): string =>
    kind === 'image'
      ? t('common.kind.image')
      : kind === 'video'
        ? t('common.kind.video')
        : t('common.kind.audio');

  const toggle = (assetId: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  };

  const confirm = (): void => {
    const picked = assets.filter((asset) => selected.has(asset.assetId));
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

        <div className="cs-modal-tools">
          <input
            className="cs-modal-search"
            value={query}
            placeholder={t('canvas.studio.pickerSearch')}
            aria-label={t('canvas.studio.pickerSearch')}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="cs-modal-filters" role="group">
            {KIND_FILTERS.map((item) => (
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
            </p>
          ) : null}
          {!loading && error === null && visible.length === 0 ? (
            <p className="cs-modal-note">{t('canvas.studio.pickerEmpty')}</p>
          ) : null}

          <div className="cs-asset-grid">
            {visible.map((asset) => {
              const picked = selected.has(asset.assetId);
              return (
                <button
                  key={asset.assetId}
                  type="button"
                  className={picked ? 'cs-asset is-picked' : 'cs-asset'}
                  aria-pressed={picked}
                  onClick={() => toggle(asset.assetId)}
                >
                  <span className="cs-asset-thumb">
                    {asset.kind === 'image' ? (
                      <img src={asset.url} alt="" loading="lazy" draggable={false} />
                    ) : (
                      <span className="cs-asset-glyph">{asset.kind === 'video' ? '▶' : '♪'}</span>
                    )}
                  </span>
                  <span className="cs-asset-name" title={asset.name ?? asset.assetId}>
                    {asset.name ?? asset.assetId.slice(0, 10)}
                  </span>
                  <span className="cs-asset-meta">{kindLabel(asset.kind)}</span>
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
