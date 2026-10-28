import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  taskOutput,
  type AssetListEntry,
  type CanvasDoc,
  type CanvasOutput,
  type CanvasProjectIndex,
  type HistoryResponse,
  type TaskProgress,
} from '@astrmira/shared';
import { Eyebrow } from '../components/Eyebrow';
import { MediaLightbox } from '../components/MediaLightbox';
import { EDIT_OPERATION_KEYS, describeEditOrigin } from '../edit/model';
import {
  ApiError,
  deleteHistory,
  fetchAssets,
  fetchCanvasDoc,
  fetchCanvasIndex,
  fetchHistory,
  importAssetsToHistory,
  resolveMediaUrl,
} from '../lib/api';
import { setCanvasResultHandoff } from '../lib/canvasHandoff';
import { TASK_STATUS_KEYS, EXECUTED_BY_LABEL_KEYS, EXECUTED_BY_TITLE_KEYS } from '../lib/format';
import { useTranslate } from '../lib/i18n';
import { useShell } from '../lib/shell';
import {
  LIBRARY_SORT_LABEL_KEYS,
  LIBRARY_STATUS_LABEL_KEYS,
  filterLibrary,
  hasActiveFilters,
  type LibraryKindFilter,
  type LibrarySort,
  type LibraryStatusFilter,
} from '../lib/libraryFilter';
import { writeActiveCanvasProjectId } from '../lib/canvasProjects';
import { staggerStyle } from '../lib/motion';
import { navigate, useHashRoute } from '../lib/router';
import { formatBytes, formatRelativeTime } from '../lib/overviewStats';

/**
 * 视频库（V9 · B4）。
 *
 * 三件事各自单一来源：
 * - **筛选/排序**在 `lib/libraryFilter.ts`（纯函数 + 单测），本组件只持有"当前条件"；
 * - **参数回填**走 hash：`#/create?reuse=<taskId>`（创作页读取后回填）——
 *   两个视图之间不共享 React 状态，刷新/分享都成立；
 * - **剪辑入口**跳 `#/edit?task=<taskId>`（B9 的独立视图）。
 *
 * "本片剪辑历史"区块先留位（`origin.kind === 'edit'` 的数据 B9 才产生）。
 */

function describeError(caught: unknown): string {
  if (caught instanceof ApiError) {
    const code = caught.failure.code === undefined ? '' : `【${caught.failure.code}】`;
    return `${code}${caught.failure.message}`;
  }
  return caught instanceof Error ? caught.message : String(caught);
}

function statusDot(status: TaskProgress['status']): 'ok' | 'warn' | 'bad' {
  if (status === 'succeeded') return 'ok';
  if (status === 'failed' || status === 'cancelled') return 'bad';
  return 'warn'; // queued / running
}



/**
 * `resolveMediaUrl` 的返回值是 `string | null`（内部要处理"没配 PUBLIC_BASE_URL"等情况），
 * 而 JSX 的 `href` / `src` 要的是 `string | undefined` —— 在这里显式对齐，
 * 而不是在调用处撒 `as`。
 */
function mediaHref(url: string | undefined): string | undefined {
  const resolved = resolveMediaUrl(url);
  return resolved ?? undefined;
}

type LibraryTab = 'history' | 'canvas';

const LIBRARY_KIND_FILTERS: readonly LibraryKindFilter[] = ['all', 'image', 'video', 'audio'];
const LIBRARY_KIND_LABEL_KEYS = {
  all: 'library.kind.all',
  image: 'common.kind.image',
  video: 'common.kind.video',
  audio: 'common.kind.audio',
} as const;

interface CanvasProduct {
  key: string;
  output: CanvasOutput;
  nodeTitle: string;
}

export function LibraryView() {
  const route = useHashRoute();
  const t = useTranslate();
  // V2.11（B47）：视频库按当前项目过滤（切项目即重拉）
  const { projectId } = useShell();
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<LibraryTab>('history');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<LibraryKindFilter>('all');
  const [status, setStatus] = useState<LibraryStatusFilter>('all');
  const [sort, setSort] = useState<LibrarySort>('time-desc');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /** P4：从资产库挑一个图片/视频登记为 imported 历史；不伪造生成任务。 */
  const [importOpen, setImportOpen] = useState(false);
  const [importAssets, setImportAssets] = useState<AssetListEntry[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // S5-A：画布作为一等资产（独立于生成历史）
  const [canvasIndex, setCanvasIndex] = useState<CanvasProjectIndex | null>(null);
  const [canvasTasks, setCanvasTasks] = useState<TaskProgress[]>([]);
  const [canvasAssets, setCanvasAssets] = useState<AssetListEntry[]>([]);
  const [canvasLoading, setCanvasLoading] = useState(false);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [selectedCanvasId, setSelectedCanvasId] = useState<string | null>(null);
  const [canvasDoc, setCanvasDoc] = useState<CanvasDoc | null>(null);
  const [canvasDocLoading, setCanvasDocLoading] = useState(false);
  const [canvasDocError, setCanvasDocError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{
    kind: 'image' | 'video';
    url: string;
    title: string;
  } | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      // V2.11（B47）：视频库只列当前项目的成片
      const data = await fetchHistory({ project: projectId });
      setHistory(data);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** S5-A：画布索引 + 画布产物 + 封面资源，三者同一项目上下文 */
  const reloadCanvas = useCallback(async (): Promise<void> => {
    setCanvasLoading(true);
    try {
      const [index, generated, assets] = await Promise.all([
        fetchCanvasIndex(),
        fetchHistory({ project: projectId, origin: 'canvas', limit: 200 }),
        fetchAssets(projectId),
      ]);
      setCanvasIndex(index);
      setCanvasTasks(generated.items);
      setCanvasAssets(assets.assets);
      setCanvasError(null);
    } catch (caught) {
      // 保留旧索引：搜索/刷新失败不能把已经看到的画布清空
      setCanvasError(describeError(caught));
    } finally {
      setCanvasLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (tab === 'canvas') void reloadCanvas();
  }, [tab, reloadCanvas]);

  // 从别处带过来的意图：总览的「去清理 →」= ?sort=size；总览九宫格 = ?task=<id>
  useEffect(() => {
    if (route.path !== '#/library') return;
    if (route.query.get('sort') === 'size') setSort('size-desc');
    if (route.query.get('tab') === 'canvas') setTab('canvas');
    const task = route.query.get('task');
    if (task !== null) setSelectedId(task);
  }, [route]);

  const options = useMemo(() => ({ query, status, sort, kind }), [query, status, sort, kind]);
  const allItems = history?.items ?? [];
  const items = useMemo(() => filterLibrary(allItems, options), [allItems, options]);
  const filtered = hasActiveFilters(options);

  // 抽屉内容从**全量**里找：改筛选不该把已经打开的详情弄丢
  const selected = allItems.find((item) => item.taskId === selectedId) ?? null;
  // 产物可能是视频或图片（V2.40）；`none` = 失败/取消，没有可播放/可下载的东西
  const selectedOutput = selected === null ? null : taskOutput(selected);

  // ── S5-A：画布 tab ──
  const canvasCoverMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const task of canvasTasks) {
      const output = taskOutput(task);
      const thumb =
        task.thumbnailUrl ?? (output.kind === 'image' || output.kind === 'video' ? output.url : undefined);
      if (thumb !== undefined) map.set(`task:${task.taskId}`, thumb);
    }
    for (const asset of canvasAssets) map.set(asset.assetId, asset.url);
    return map;
  }, [canvasTasks, canvasAssets]);

  const canvasProjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const source = canvasIndex?.projects ?? [];
    return source
      .filter((project) => needle === '' || project.name.toLowerCase().includes(needle))
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [canvasIndex, query]);

  const selectedCanvas =
    canvasIndex?.projects.find((project) => project.projectId === selectedCanvasId) ?? null;

  useEffect(() => {
    if (selectedCanvasId === null) {
      setCanvasDoc(null);
      setCanvasDocError(null);
      return;
    }
    let alive = true;
    setCanvasDocLoading(true);
    setCanvasDocError(null);
    void fetchCanvasDoc(selectedCanvasId)
      .then((doc) => {
        if (alive) setCanvasDoc(doc);
      })
      .catch((caught: unknown) => {
        if (alive) setCanvasDocError(describeError(caught));
      })
      .finally(() => {
        if (alive) setCanvasDocLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [selectedCanvasId]);

  const canvasProducts = useMemo<CanvasProduct[]>(() => {
    if (canvasDoc === null) return [];
    return canvasDoc.nodes.flatMap((node) =>
      node.data.batches.flatMap((batch) =>
        batch.outputs.map((output) => ({
          key: `${node.id}:${batch.id}:${output.assetId}`,
          output,
          nodeTitle: node.data.title ?? node.type,
        })),
      ),
    );
  }, [canvasDoc]);

  const openCanvas = (projectId: string): void => {
    writeActiveCanvasProjectId(projectId);
    navigate(`#/canvas?project=${encodeURIComponent(projectId)}`);
  };


  async function handleDelete(taskId: string): Promise<void> {
    setDeletingId(taskId);
    setNotice(null);
    try {
      await deleteHistory(taskId);
      if (selectedId === taskId) setSelectedId(null);
      await reload();
      setNotice(t('library.delete.done'));
    } catch (caught) {
      setNotice(t('library.delete.failed', { reason: describeError(caught) }));
    } finally {
      setDeletingId(null);
    }
  }

  async function openImport(): Promise<void> {
    setImportOpen(true);
    setImportError(null);
    setImportBusy(true);
    try {
      const pool = await fetchAssets(projectId);
      setImportAssets(
        pool.assets.filter((asset) => asset.kind === 'image' || asset.kind === 'video'),
      );
    } catch (caught) {
      setImportError(t('library.import.failed', { reason: describeError(caught) }));
    } finally {
      setImportBusy(false);
    }
  }

  async function handleImportAsset(asset: AssetListEntry): Promise<void> {
    setImportBusy(true);
    setImportError(null);
    try {
      const result = await importAssetsToHistory({
        projectId,
        items: [
          {
            assetId: asset.assetId,
            kind: asset.kind === 'image' ? 'image' : 'video',
            title: asset.name ?? asset.assetId.slice(0, 8),
            prompt: asset.name ?? asset.assetId,
            source: 'asset-library',
          },
        ],
      });
      await reload();
      setImportOpen(false);
      setNotice(t('library.import.done', { count: result.tasks.length }));
    } catch (caught) {
      setImportError(t('library.import.failed', { reason: describeError(caught) }));
    } finally {
      setImportBusy(false);
    }
  }

  const activeLoading = tab === 'history' ? loading : canvasLoading;
  const activeError = tab === 'history' ? error : canvasError;
  const retryActive = (): void => {
    if (tab === 'history') void reload();
    else void reloadCanvas();
  };

  return (
    <section className="wb-page">
      <div className="wb-page-head wb-page-head-row">
        <div>
          <h1 className="wb-page-title">{t('library.title')}</h1>
          <Eyebrow tone="gold">Library</Eyebrow>
        </div>
        <div className="lib-head-actions">
          {tab === 'history' ? (
            <button
              type="button"
              className="wb-btn"
              data-testid="library-import-open"
              onClick={() => void openImport()}
            >
              {t('library.import.open')}
            </button>
          ) : null}
          <button
            type="button"
            className="wb-btn"
            onClick={retryActive}
            disabled={activeLoading}
          >
            {t(activeLoading ? 'library.refresh.loading' : 'library.refresh.label')}
          </button>
        </div>
      </div>

      <div className="lib-tabs" role="tablist" aria-label={t('library.tabs.aria')}>
        <button
          type="button"
          className="lib-tab"
          role="tab"
          aria-selected={tab === 'history'}
          onClick={() => setTab('history')}
        >
          {t('library.tabs.history')}
        </button>
        <button
          type="button"
          className="lib-tab"
          role="tab"
          aria-selected={tab === 'canvas'}
          onClick={() => setTab('canvas')}
        >
          {t('library.tabs.canvas')}
        </button>
      </div>

      {activeError === null ? null : (
        <div className="wb-uncertain" style={{ marginBottom: 14 }} role="alert">
          <span className="wb-uncertain-title">{t('library.load.error')}</span>
          <span className="wb-uncertain-body">{activeError}</span>
          <button type="button" className="wb-btn" onClick={retryActive} disabled={activeLoading}>
            {t('library.load.retry')}
          </button>
        </div>
      )}
      {notice === null ? null : (
        <div className="wb-queue-item" style={{ marginBottom: 14 }} role="status">
          <span className="wb-dot" />
          <span className="wb-note">{notice}</span>
        </div>
      )}

      {tab === 'history' && importOpen ? (
        <section className="wb-panel lib-import-panel" role="dialog" aria-label={t('library.import.title')}>
          <div className="wb-field-head">
            <Eyebrow tone="gold" as="h2">
              {t('library.import.title')}
            </Eyebrow>
            <span className="wb-note">{t('library.import.hint')}</span>
            <button
              type="button"
              className="wb-btn lib-icon"
              aria-label={t('common.close')}
              onClick={() => setImportOpen(false)}
              disabled={importBusy}
            >
              ✕
            </button>
          </div>
          {importError === null ? null : (
            <p className="wb-alert" role="alert">
              {importError}
            </p>
          )}
          {importBusy ? <p className="wb-note">{t('library.import.loading')}</p> : null}
          {!importBusy && importAssets.length === 0 && importError === null ? (
            <p className="wb-note">{t('library.import.empty')}</p>
          ) : null}
          <div className="lib-import-list">
            {importAssets.map((asset) => (
              <div className="lib-import-item" key={asset.assetId}>
                <span className="lib-import-thumb">
                  {asset.kind === 'image' ? (
                    <img src={asset.url} alt="" loading="lazy" />
                  ) : (
                    <span>▶</span>
                  )}
                </span>
                <span className="lib-import-meta">
                  <strong>{asset.name ?? asset.assetId.slice(0, 8)}</strong>
                  <span className="wb-note">
                    {t('library.import.meta', { kind: asset.kind, size: formatBytes(asset.size) })}
                  </span>
                </span>
                <button
                  type="button"
                  className="wb-btn wb-btn-primary"
                  data-testid={`library-import-${asset.assetId}`}
                  disabled={importBusy}
                  onClick={() => void handleImportAsset(asset)}
                >
                  {t('library.import.action')}
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="lib-toolbar">
        <label className="wb-field lib-search">
          <input
            className="wb-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t(tab === 'history' ? 'library.search.placeholder' : 'library.canvas.search')}
            aria-label={t('library.search.aria')}
          />
        </label>

        {tab === 'history' ? (
          <>
            <div className="chips" role="group" aria-label={t('library.statusFilter.aria')}>
              {(Object.keys(LIBRARY_STATUS_LABEL_KEYS) as LibraryStatusFilter[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  className="lib-chip"
                  aria-pressed={status === key}
                  onClick={() => setStatus(key)}
                >
                  {t(LIBRARY_STATUS_LABEL_KEYS[key])}
                </button>
              ))}
            </div>

            <div className="chips" role="group" aria-label={t('library.kindFilter.aria')}>
              {LIBRARY_KIND_FILTERS.map((key) => (
                <button
                  key={key}
                  type="button"
                  className="lib-chip"
                  aria-pressed={kind === key}
                  onClick={() => setKind(key)}
                >
                  {t(LIBRARY_KIND_LABEL_KEYS[key])}
                </button>
              ))}
            </div>

            <label className="wb-field lib-sort">
              <span className="wb-label">{t('library.sort.label')}</span>
              <select
                className="wb-input"
                value={sort}
                onChange={(event) => setSort(event.target.value as LibrarySort)}
                aria-label={t('library.sort.aria')}
              >
                {(Object.keys(LIBRARY_SORT_LABEL_KEYS) as LibrarySort[]).map((key) => (
                  <option key={key} value={key}>
                    {t(LIBRARY_SORT_LABEL_KEYS[key])}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}

        <span className="wb-note" style={{ marginLeft: 'auto' }}>
          {tab === 'history'
            ? t('library.count', { shown: items.length, total: allItems.length })
            : t('library.canvas.count', { count: canvasProjects.length })}
          {tab === 'history' && history !== null
            ? t('library.totalSize', { size: formatBytes(history.storage.totalBytes) })
            : ''}
        </span>
      </div>

      {tab === 'history' ? (
        <div className="lib-body" data-drawer={selected === null ? '0' : '1'}>
        <div className="lib-grid">
          {history === null && loading ? (
            // B6 动效项⑦：数据到达前先占住位置（骨架屏），避免"空 → 有"的布局跳动
            Array.from({ length: 6 }, (_, index) => <div key={index} className="wb-skeleton" />)
          ) : items.length === 0 ? (
            <p className="wb-note lib-empty">
              {t(filtered ? 'library.empty.filtered' : 'library.empty.none')}
            </p>
          ) : (
            items.map((task, index) => (
              <article
                className="lib-card"
                key={task.taskId}
                data-task={task.taskId}
                // B6：级联序号封顶在 12（延迟不随列表长度无限增长）
                style={staggerStyle(Math.min(index, 11))}
              >
                <button
                  type="button"
                  className="lib-thumb"
                  onClick={() => setSelectedId(task.taskId)}
                  aria-label={t('library.card.detailAria', { id: task.taskId })}
                >
                  {(() => {
                    const coverUrl = task.thumbnailUrl ?? task.outputImageUrl;
                    return coverUrl === undefined ? (
                      <span className="lib-thumb-empty">{t('library.card.noCover')}</span>
                    ) : (
                      <img src={mediaHref(coverUrl)} alt="" loading="lazy" />
                    );
                  })()}
                  {task.requestSnapshot.params?.durationSec === undefined ? null : (
                    <span className="lib-dur">{task.requestSnapshot.params.durationSec}s</span>
                  )}
                </button>
                <div className="lib-bar">
                  <span className={`ov-dot ov-dot--${statusDot(task.status)}`} />
                  <span className="lib-idx">{String(index + 1).padStart(3, '0')}</span>
                  {/* V9 · B9：剪辑产物带来源徽标（B4 留的位在这里填上） */}
                  {task.origin?.kind === 'edit' ? (
                    <span
                      className="recipe-tag recipe-tag--gold"
                      title={t('library.card.editOriginTitle', { id: task.origin.sourceTaskId })}
                    >
                      {t('library.card.editOrigin', {
                        id: task.origin.sourceTaskId.slice(0, 8),
                      })}
                    </span>
                  ) : null}
                  {task.requestSnapshot.provider === 'imported' ? (
                    <span
                      className="recipe-tag recipe-tag--gold"
                      data-testid="library-imported-badge"
                      title={t('library.card.importedTitle')}
                    >
                      {t('library.card.imported')}
                    </span>
                  ) : null}
                  {/* V2.27（A1 片 A / B11）：执行位置如实标注（缺省 = 老任务 —— 不猜、不写） */}
                  <span
                    className="lib-meta"
                    title={
                      task.executedBy === undefined
                        ? undefined
                        : t(EXECUTED_BY_TITLE_KEYS[task.executedBy])
                    }
                  >
                    {t(TASK_STATUS_KEYS[task.status])} ·{' '}
                    {formatRelativeTime(task.createdAt, Date.now())}
                    {task.executedBy === undefined
                      ? ''
                      : ` · ${t(EXECUTED_BY_LABEL_KEYS[task.executedBy])}`}
                  </span>
                  <span className="lib-acts">
                    {/* 交付包多选（V2.13 / B49）：data-picked 是给冒烟读的渲染事实 */}
                    <button
                      type="button"
                      className="wb-btn lib-icon"
                      title={t(
                        task.status !== 'succeeded'
                          ? 'library.card.editDisabledTitle'
                          : task.outputVideoUrl === undefined
                            ? 'library.card.editNoVideo'
                            : 'library.card.editTitle',
                      )}
                      disabled={task.status !== 'succeeded' || task.outputVideoUrl === undefined}
                      onClick={() => navigate(`#/edit?task=${encodeURIComponent(task.taskId)}`)}
                    >
                      ✂
                    </button>
                    {task.outputVideoUrl === undefined ? null : (
                      <button
                        type="button"
                        className="wb-btn lib-icon"
                        title={t('library.card.reuseTitle')}
                        onClick={() =>
                          navigate(`#/create?reuse=${encodeURIComponent(task.taskId)}`)
                        }
                      >
                        ⟲
                      </button>
                    )}
                    {(() => {
                      const output = taskOutput(task);
                      if (output.kind === 'none') return null;
                      return (
                        <a
                          className="wb-btn lib-icon"
                          title={t('library.card.downloadTitle')}
                          href={mediaHref(output.url)}
                          download={`${task.taskId}.${output.kind === 'image' ? 'png' : 'mp4'}`}
                        >
                          ⤓
                        </a>
                      );
                    })()}
                    <button
                      type="button"
                      className="wb-btn lib-icon lib-icon-danger"
                      title={t('library.card.deleteTitle')}
                      disabled={deletingId === task.taskId}
                      onClick={() => void handleDelete(task.taskId)}
                    >
                      🗑
                    </button>
                  </span>
                </div>
              </article>
            ))
          )}
        </div>

        {selected === null ? null : (
          <aside className="lib-drawer">
            <div className="lib-drawer-head">
              <Eyebrow tone="gold">Detail</Eyebrow>
              <span className="wb-note">{selected.taskId}</span>
              <button
                type="button"
                className="wb-btn lib-icon"
                onClick={() => setSelectedId(null)}
                aria-label={t('library.drawer.closeAria')}
              >
                ✕
              </button>
            </div>

            <div className="lib-drawer-body">
              <div className="lib-preview">
                {/* V2.40：产物可能是视频或图片（`t2i`）—— 用 shared 的 `taskOutput()` 收口 */}
                {selectedOutput === null ? null : selectedOutput.kind === 'video' ? (
                  <video src={mediaHref(selectedOutput.url)} controls preload="metadata" />
                ) : selectedOutput.kind === 'image' ? (
                  <img src={mediaHref(selectedOutput.url)} alt={t('library.drawer.imageAlt')} />
                ) : (
                  <span className="wb-note">
                    {t('library.drawer.noPlayable', {
                      status: t(TASK_STATUS_KEYS[selected.status]),
                    })}
                    {selected.error === undefined ? '' : `（${selected.error.code}）`}
                  </span>
                )}
              </div>

              <dl className="lib-kv">
                <dt>{t('library.drawer.kv.prompt')}</dt>
                <dd>{selected.requestSnapshot.prompt}</dd>
                <dt>{t('library.drawer.kv.mode')}</dt>
                <dd>{selected.requestSnapshot.mode}</dd>
                <dt>{t('library.drawer.kv.engine')}</dt>
                <dd>{selected.requestSnapshot.provider}</dd>
                {selected.requestSnapshot.options?.model === undefined ? null : (
                  <>
                    <dt>{t('library.drawer.kv.model')}</dt>
                    <dd>{String(selected.requestSnapshot.options.model)}</dd>
                  </>
                )}
                <dt>{t('library.drawer.kv.createdAt')}</dt>
                <dd>{new Date(selected.createdAt).toLocaleString()}</dd>
                <dt>{t('library.drawer.kv.size')}</dt>
                <dd>
                  {selected.outputSizeBytes === undefined
                    ? t('library.drawer.kv.sizeMissing')
                    : formatBytes(selected.outputSizeBytes)}
                </dd>
                <dt>{t('library.drawer.kv.status')}</dt>
                <dd>{t(TASK_STATUS_KEYS[selected.status])}</dd>
              </dl>

              {selected.warnings === undefined || selected.warnings.length === 0 ? null : (
                <ul className="lib-warnings">
                  {selected.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}

              {/* 剪辑产物（V2.5 起两代：旧 EDL 记 script、多轨工程记 project） */}
              <div className="lib-edl-slot">
                <Eyebrow>{t('library.drawer.edlTitle')}</Eyebrow>
                {selected.origin?.kind === 'edit' ? (
                  <>
                    <p className="wb-note">
                      {t('library.drawer.edlOrigin', {
                        id: selected.origin.sourceTaskId.slice(0, 8),
                        origin: describeEditOrigin(selected.origin),
                      })}
                    </p>
                    {selected.origin.script === undefined ? (
                      <p className="wb-note">{t('library.drawer.projectProduct')}</p>
                    ) : (
                      <ol className="edit-history">
                        {selected.origin.script.operations.map((operation, index) => (
                          <li key={`${operation.type}-${index}`}>
                            <span className="edit-order">{String(index + 1).padStart(2, '0')}</span>
                            <span className="wb-note">{t(EDIT_OPERATION_KEYS[operation.type])}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </>
                ) : (
                  <p className="wb-note">{t('library.drawer.noEditRecord')}</p>
                )}
              </div>

              <div className="lib-drawer-acts">
                {selectedOutput?.kind === 'video' ? (
                  <button
                    type="button"
                    className="wb-btn wb-btn-gold"
                    onClick={() =>
                      navigate(`#/create?reuse=${encodeURIComponent(selected.taskId)}`)
                    }
                  >
                    {t('library.drawer.action.reuse')}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="wb-btn"
                  disabled={selected.status !== 'succeeded' || selectedOutput?.kind !== 'video'}
                  title={t(
                    selected.status !== 'succeeded'
                      ? 'library.card.editDisabledTitle'
                      : selectedOutput?.kind !== 'video'
                        ? 'library.card.editNoVideo'
                        : 'library.card.editTitle',
                  )}
                  onClick={() => navigate(`#/edit?task=${encodeURIComponent(selected.taskId)}`)}
                >
                  {t('library.drawer.action.edit')}
                </button>

                {selectedOutput !== null &&
                (selectedOutput.kind === 'image' || selectedOutput.kind === 'video') ? (
                  <>
                    <button
                      type="button"
                      className="wb-btn"
                      onClick={() =>
                        setLightbox({
                          kind: selectedOutput.kind === 'image' ? 'image' : 'video',
                          url: mediaHref(selectedOutput.url) ?? '',
                          title: selected.requestSnapshot.prompt,
                        })
                      }
                    >
                      {t('common.fullscreen')}
                    </button>
                    <button
                      type="button"
                      className="wb-btn"
                      onClick={() =>
                        navigate(`#/create?refTask=${encodeURIComponent(selected.taskId)}`)
                      }
                    >
                      {t('common.asReference')}
                    </button>
                    <button
                      type="button"
                      className="wb-btn"
                      onClick={() => {
                        if (
                          !setCanvasResultHandoff({
                            taskId: selected.taskId,
                            kind: selectedOutput.kind,
                            url: selectedOutput.url,
                            title: selected.requestSnapshot.prompt.slice(0, 40),
                          })
                        ) {
                          setNotice(t('common.resultStorageOff'));
                          return;
                        }
                        navigate('#/canvas');
                      }}
                    >
                      {t('common.toCanvas')}
                    </button>
                    <a
                      className="wb-btn"
                      href={mediaHref(selectedOutput.url)}
                      download={`${selected.taskId}.${selectedOutput.kind === 'image' ? 'png' : 'mp4'}`}
                    >
                      {t('library.drawer.action.download')}
                    </a>
                  </>
                ) : null}
                <button
                  type="button"
                  className="wb-btn wb-btn-danger"
                  disabled={deletingId === selected.taskId}
                  onClick={() => void handleDelete(selected.taskId)}
                >
                  {t('library.drawer.action.delete')}
                </button>
              </div>
            </div>
          </aside>
        )}
      </div>
      ) : (
        <div className="lib-body" data-drawer={selectedCanvas === null ? '0' : '1'}>
          <div className="lib-grid">
            {canvasIndex === null && canvasLoading ? (
              Array.from({ length: 6 }, (_, index) => <div key={index} className="wb-skeleton" />)
            ) : canvasProjects.length === 0 ? (
              <p className="wb-note lib-empty">
                {t(query.trim() === '' ? 'library.canvas.empty' : 'library.canvas.emptyFiltered')}
              </p>
            ) : (
              canvasProjects.map((project, index) => {
                const cover =
                  project.coverAssetId === undefined
                    ? undefined
                    : canvasCoverMap.get(project.coverAssetId);
                return (
                  <article
                    className="lib-card lib-canvas-card"
                    key={project.projectId}
                    data-canvas={project.projectId}
                    style={staggerStyle(Math.min(index, 11))}
                  >
                    <button
                      type="button"
                      className="lib-thumb"
                      onClick={() => setSelectedCanvasId(project.projectId)}
                      aria-label={t('library.canvas.openAria', { name: project.name })}
                    >
                      {cover === undefined ? (
                        <span className="lib-thumb-empty">{t('library.canvas.noCover')}</span>
                      ) : (
                        <img src={mediaHref(cover)} alt="" loading="lazy" />
                      )}
                      <span className="lib-canvas-badge">{t('library.canvas.badge')}</span>
                    </button>
                    <div className="lib-bar">
                      <span className="lib-idx">{String(index + 1).padStart(3, '0')}</span>
                      <span className="lib-canvas-name" title={project.name}>
                        {project.name}
                      </span>
                      <span className="lib-meta">
                        {formatRelativeTime(project.updatedAt, Date.now())} ·{' '}
                        {t('library.canvas.nodes', { count: project.nodeCount })}
                      </span>
                      <span className="lib-acts">
                        <button
                          type="button"
                          className="wb-btn lib-icon"
                          title={t('library.canvas.open')}
                          onClick={() => openCanvas(project.projectId)}
                        >
                          ↗
                        </button>
                      </span>
                    </div>
                  </article>
                );
              })
            )}
          </div>

          {selectedCanvas === null ? null : (
            <aside className="lib-drawer">
              <div className="lib-drawer-head">
                <Eyebrow tone="gold">{t('library.canvas.detail')}</Eyebrow>
                <span className="wb-note">{selectedCanvas.name}</span>
                <button
                  type="button"
                  className="wb-btn lib-icon"
                  aria-label={t('library.drawer.closeAria')}
                  onClick={() => setSelectedCanvasId(null)}
                >
                  ✕
                </button>
              </div>

              <div className="lib-drawer-body">
                <dl className="lib-kv">
                  <dt>{t('library.canvas.updatedAt')}</dt>
                  <dd>{new Date(selectedCanvas.updatedAt).toLocaleString()}</dd>
                  <dt>{t('library.canvas.nodeCount')}</dt>
                  <dd>{selectedCanvas.nodeCount}</dd>
                  <dt>{t('library.canvas.products')}</dt>
                  <dd>{canvasProducts.length}</dd>
                </dl>

                <div className="lib-drawer-acts">
                  <button
                    type="button"
                    className="wb-btn wb-btn-gold"
                    onClick={() => openCanvas(selectedCanvas.projectId)}
                  >
                    {t('library.canvas.open')}
                  </button>
                </div>

                {canvasDocLoading ? (
                  <p className="wb-note">{t('library.canvas.loading')}</p>
                ) : null}
                {canvasDocError === null ? null : (
                  <p className="wb-note lib-canvas-error">{canvasDocError}</p>
                )}
                {!canvasDocLoading && canvasDocError === null && canvasProducts.length === 0 ? (
                  <p className="wb-note">{t('library.canvas.noProducts')}</p>
                ) : null}

                <div className="lib-canvas-products">
                  {canvasProducts.map((product) => {
                    const output = product.output;
                    const url = output.url === undefined ? undefined : mediaHref(output.url);
                    const playable =
                      (output.kind === 'image' || output.kind === 'video') && url !== undefined;
                    return (
                      <button
                        key={product.key}
                        type="button"
                        className="lib-canvas-product"
                        disabled={!playable}
                        onClick={() => {
                          if (!playable || url === undefined) return;
                          setLightbox({
                            kind: output.kind === 'image' ? 'image' : 'video',
                            url,
                            title: `${product.nodeTitle} · ${output.kind}`,
                          });
                        }}
                      >
                        <span className="lib-canvas-product-thumb">
                          {output.kind === 'image' && url !== undefined ? (
                            <img src={url} alt="" loading="lazy" />
                          ) : (
                            <span>
                              {output.kind === 'video'
                                ? '▶'
                                : output.kind === 'audio'
                                  ? '♪'
                                  : 'T'}
                            </span>
                          )}
                        </span>
                        <span className="lib-canvas-product-meta">
                          <span>{product.nodeTitle}</span>
                          <span className="wb-note">{output.kind}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </aside>
          )}
        </div>
      )}

      {lightbox === null ? null : (
        <MediaLightbox
          open
          kind={lightbox.kind}
          url={lightbox.url}
          title={lightbox.title}
          downloadName={`${selected?.taskId ?? 'result'}.${lightbox.kind === 'image' ? 'png' : 'mp4'}`}
          onClose={() => setLightbox(null)}
        />
      )}
    </section>
  );
}
