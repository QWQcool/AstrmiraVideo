import { useCallback, useEffect, useMemo, useState } from 'react';
import { EDIT_OPERATION_LABELS } from '@astrmira/shared';
import type { HistoryResponse, TaskProgress } from '@astrmira/shared';
import { Eyebrow } from '../components/Eyebrow';
import { ApiError, deleteHistory, fetchHistory, resolveMediaUrl } from '../lib/api';
import {
  LIBRARY_SORT_LABELS,
  LIBRARY_STATUS_LABELS,
  filterLibrary,
  hasActiveFilters,
  type LibrarySort,
  type LibraryStatusFilter,
} from '../lib/libraryFilter';
import { staggerStyle } from '../lib/motion';
import { navigate, useHashRoute } from '../lib/router';
import { formatBytes, formatRelativeTime } from '../lib/overviewStats';

/**
 * 视频库（V9 · B4）。
 *
 * 三件事各自单一来源：
 * - **筛选/排序**在 `lib/libraryFilter.ts`（纯函数 + 单测），本组件只持有"当前条件"；
 * - **参数回填**走 hash：`#/workbench?reuse=<taskId>`（工作台读取后自行回填）——
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

const STATUS_TEXT: Record<TaskProgress['status'], string> = {
  queued: '排队中',
  running: '生成中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

/**
 * `resolveMediaUrl` 的返回值是 `string | null`（内部要处理"没配 PUBLIC_BASE_URL"等情况），
 * 而 JSX 的 `href` / `src` 要的是 `string | undefined` —— 在这里显式对齐，
 * 而不是在调用处撒 `as`。
 */
function mediaHref(url: string | undefined): string | undefined {
  const resolved = resolveMediaUrl(url);
  return resolved ?? undefined;
}

export function LibraryView() {
  const route = useHashRoute();
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<LibraryStatusFilter>('all');
  const [sort, setSort] = useState<LibrarySort>('time-desc');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const data = await fetchHistory();
      setHistory(data);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 从别处带过来的意图：总览的「去清理 →」= ?sort=size；总览九宫格 = ?task=<id>
  useEffect(() => {
    if (route.path !== '#/library') return;
    if (route.query.get('sort') === 'size') setSort('size-desc');
    const task = route.query.get('task');
    if (task !== null) setSelectedId(task);
  }, [route]);

  const options = useMemo(() => ({ query, status, sort }), [query, status, sort]);
  const allItems = history?.items ?? [];
  const items = useMemo(() => filterLibrary(allItems, options), [allItems, options]);
  const filtered = hasActiveFilters(options);

  // 抽屉内容从**全量**里找：改筛选不该把已经打开的详情弄丢
  const selected = allItems.find((item) => item.taskId === selectedId) ?? null;

  async function handleDelete(taskId: string): Promise<void> {
    setDeletingId(taskId);
    setNotice(null);
    try {
      await deleteHistory(taskId);
      if (selectedId === taskId) setSelectedId(null);
      await reload();
      setNotice('已删除该成片并释放磁盘。');
    } catch (caught) {
      setNotice(`删除失败：${describeError(caught)}`);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="wb-page">
      <div className="wb-page-head wb-page-head-row">
        <div>
          <h1 className="wb-page-title">视频库</h1>
          <Eyebrow tone="gold">Library</Eyebrow>
        </div>
        <button type="button" className="wb-btn" onClick={() => void reload()} disabled={loading}>
          {loading ? '读取中…' : '刷新'}
        </button>
      </div>

      {error === null ? null : (
        <div className="wb-uncertain" style={{ marginBottom: 14 }}>
          <span className="wb-uncertain-title">读取失败</span>
          <span className="wb-uncertain-body">{error}</span>
        </div>
      )}
      {notice === null ? null : (
        <div className="wb-queue-item" style={{ marginBottom: 14 }}>
          <span className="wb-dot" />
          <span className="wb-note">{notice}</span>
        </div>
      )}

      <div className="lib-toolbar">
        <label className="wb-field lib-search">
          <input
            className="wb-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索提示词…"
            aria-label="搜索提示词"
          />
        </label>

        <div className="chips" role="group" aria-label="按状态筛选">
          {(Object.keys(LIBRARY_STATUS_LABELS) as LibraryStatusFilter[]).map((key) => (
            <button
              key={key}
              type="button"
              className="lib-chip"
              aria-pressed={status === key}
              onClick={() => setStatus(key)}
            >
              {LIBRARY_STATUS_LABELS[key]}
            </button>
          ))}
        </div>

        <label className="wb-field lib-sort">
          <span className="wb-label">排序</span>
          <select
            className="wb-input"
            value={sort}
            onChange={(event) => setSort(event.target.value as LibrarySort)}
            aria-label="排序方式"
          >
            {(Object.keys(LIBRARY_SORT_LABELS) as LibrarySort[]).map((key) => (
              <option key={key} value={key}>
                {LIBRARY_SORT_LABELS[key]}
              </option>
            ))}
          </select>
        </label>

        <span className="wb-note" style={{ marginLeft: 'auto' }}>
          {items.length} / {allItems.length} 条
          {history === null ? '' : ` · 共 ${formatBytes(history.storage.totalBytes)}`}
        </span>
      </div>

      <div className="lib-body" data-drawer={selected === null ? '0' : '1'}>
        <div className="lib-grid">
          {history === null && loading ? (
            // B6 动效项⑦：数据到达前先占住位置（骨架屏），避免"空 → 有"的布局跳动
            Array.from({ length: 6 }, (_, index) => <div key={index} className="wb-skeleton" />)
          ) : items.length === 0 ? (
            <p className="wb-note lib-empty">
              {filtered
                ? '没有匹配的成片：换个关键词，或把筛选切回「全部」。'
                : '还没有成片。到 生成工作台 提交第一条任务吧。'}
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
                  aria-label={`查看 ${task.taskId} 的详情`}
                >
                  {task.thumbnailUrl === undefined ? (
                    <span className="lib-thumb-empty">无封面</span>
                  ) : (
                    <img src={task.thumbnailUrl} alt="" loading="lazy" />
                  )}
                  {task.requestSnapshot.params?.durationSec === undefined ? null : (
                    <span className="lib-dur">{task.requestSnapshot.params.durationSec}s</span>
                  )}
                </button>
                <div className="lib-bar">
                  <span className={`ov-dot ov-dot--${statusDot(task.status)}`} />
                  <span className="lib-idx">{String(index + 1).padStart(3, '0')}</span>
                  {/* V9 · B9：剪辑产物带来源徽标（B4 留的位在这里填上） */}
                  {task.origin?.kind === 'edit' ? (
                    <span className="recipe-tag recipe-tag--gold" title={`剪辑自 ${task.origin.sourceTaskId}`}>
                      剪辑自 {task.origin.sourceTaskId.slice(0, 8)}
                    </span>
                  ) : null}
                  <span className="lib-meta">
                    {STATUS_TEXT[task.status]} · {formatRelativeTime(task.createdAt, Date.now())}
                  </span>
                  <span className="lib-acts">
                    <button
                      type="button"
                      className="wb-btn lib-icon"
                      title={task.status === 'succeeded' ? '剪辑' : '失败任务不可剪辑'}
                      disabled={task.status !== 'succeeded'}
                      onClick={() => navigate(`#/edit?task=${encodeURIComponent(task.taskId)}`)}
                    >
                      ✂
                    </button>
                    <button
                      type="button"
                      className="wb-btn lib-icon"
                      title="复用参数"
                      onClick={() => navigate(`#/workbench?reuse=${encodeURIComponent(task.taskId)}`)}
                    >
                      ⟲
                    </button>
                    {task.outputVideoUrl === undefined ? null : (
                      <a
                        className="wb-btn lib-icon"
                        title="下载"
                        href={mediaHref(task.outputVideoUrl)}
                        download
                      >
                        ⤓
                      </a>
                    )}
                    <button
                      type="button"
                      className="wb-btn lib-icon lib-icon-danger"
                      title="删除（释放磁盘）"
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
                aria-label="关闭详情"
              >
                ✕
              </button>
            </div>

            <div className="lib-drawer-body">
              <div className="lib-preview">
                {selected.outputVideoUrl === undefined ? (
                  <span className="wb-note">
                    {STATUS_TEXT[selected.status]}：没有可播放的成片
                    {selected.error === undefined ? '' : `（${selected.error.code}）`}
                  </span>
                ) : (
                  <video src={mediaHref(selected.outputVideoUrl)} controls preload="metadata" />
                )}
              </div>

              <dl className="lib-kv">
                <dt>提示词</dt>
                <dd>{selected.requestSnapshot.prompt}</dd>
                <dt>模式</dt>
                <dd>{selected.requestSnapshot.mode}</dd>
                <dt>引擎</dt>
                <dd>{selected.requestSnapshot.provider}</dd>
                {selected.requestSnapshot.options?.model === undefined ? null : (
                  <>
                    <dt>模型</dt>
                    <dd>{String(selected.requestSnapshot.options.model)}</dd>
                  </>
                )}
                <dt>创建时间</dt>
                <dd>{new Date(selected.createdAt).toLocaleString()}</dd>
                <dt>文件大小</dt>
                <dd>
                  {selected.outputSizeBytes === undefined
                    ? '—（文件已清理或未产出）'
                    : formatBytes(selected.outputSizeBytes)}
                </dd>
                <dt>状态</dt>
                <dd>{STATUS_TEXT[selected.status]}</dd>
              </dl>

              {selected.warnings === undefined || selected.warnings.length === 0 ? null : (
                <ul className="lib-warnings">
                  {selected.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}

              {/* B9 才产生 origin.kind='edit' 的数据；本批先留位（不假装有历史） */}
              <div className="lib-edl-slot">
                <Eyebrow>本片剪辑历史</Eyebrow>
                {selected.origin?.kind === 'edit' ? (
                  <>
                    <p className="wb-note">
                      剪辑自 {selected.origin.sourceTaskId.slice(0, 8)} —— 操作序列：
                    </p>
                    <ol className="edit-history">
                      {selected.origin.script.operations.map((operation, index) => (
                        <li key={`${operation.type}-${index}`}>
                          <span className="edit-order">{String(index + 1).padStart(2, '0')}</span>
                          <span className="wb-note">{EDIT_OPERATION_LABELS[operation.type]}</span>
                        </li>
                      ))}
                    </ol>
                  </>
                ) : (
                  <p className="wb-note">这条还没有剪辑记录（在视频库里点它的 ✂ 就能开始剪）。</p>
                )}
              </div>

              <div className="lib-drawer-acts">
                <button
                  type="button"
                  className="wb-btn wb-btn-gold"
                  onClick={() => navigate(`#/workbench?reuse=${encodeURIComponent(selected.taskId)}`)}
                >
                  复用参数
                </button>
                <button
                  type="button"
                  className="wb-btn"
                  disabled={selected.status !== 'succeeded'}
                  onClick={() => navigate(`#/edit?task=${encodeURIComponent(selected.taskId)}`)}
                >
                  ✂ 剪辑
                </button>
                {selected.outputVideoUrl === undefined ? null : (
                  <a className="wb-btn" href={mediaHref(selected.outputVideoUrl)} download>
                    下载
                  </a>
                )}
                <button
                  type="button"
                  className="wb-btn wb-btn-danger"
                  disabled={deletingId === selected.taskId}
                  onClick={() => void handleDelete(selected.taskId)}
                >
                  删除
                </button>
              </div>
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}
