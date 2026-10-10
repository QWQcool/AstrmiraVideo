import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_PLATFORM_PRESET_ID,
  EDIT_OPERATION_LABELS,
  PLATFORM_PRESETS,
  describeEditOrigin,
  findPlatformPreset,
} from '@astrmira/shared';
import type { HistoryResponse, TaskProgress } from '@astrmira/shared';
import { Eyebrow } from '../components/Eyebrow';
import { ApiError, deleteHistory, fetchHistory, resolveMediaUrl } from '../lib/api';
import {
  buildDeliverableZip,
  planDeliverablePackage,
  saveDeliverable,
} from '../lib/deliverablePackage';
import { useShell } from '../lib/shell';
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
  // V2.11（B47）：视频库按当前项目过滤（切项目即重拉）
  const { projectId, projects } = useShell();
  // ── 交付包（V2.13 / 台账 B49）：多选 + 规格预设 + 命名 + 归档清单 ──
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [presetId, setPresetId] = useState<string>(DEFAULT_PLATFORM_PRESET_ID);
  const [deliverProjectName, setDeliverProjectName] = useState('');
  const [includeVideo, setIncludeVideo] = useState(true);
  const [includeProject, setIncludeProject] = useState(true);
  const [includeCover, setIncludeCover] = useState(true);
  const [includeManifest, setIncludeManifest] = useState(true);
  // V2.14（B49 片 B）：按预设重新渲染（画幅对齐）—— 默认关：它慢，且客户可能只想改名打包
  const [transcode, setTranscode] = useState(false);
  const [deliverBusy, setDeliverBusy] = useState(false);
  const [deliverProgress, setDeliverProgress] = useState<string | null>(null);
  const [deliverError, setDeliverError] = useState<string | null>(null);
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

  // ── 交付包（V2.13 / B49）──
  // 勾选的是"当前列表里选中的那些"（筛掉已删除 / 已不在列表的 id —— 陈旧勾选不该让打包失败）
  const pickedTasks = useMemo(
    () => items.filter((item) => pickedIds.includes(item.taskId)),
    [items, pickedIds],
  );
  const activeProject = projects.find((project) => project.projectId === projectId) ?? null;
  const effectiveProjectName = deliverProjectName.trim() === ''
    ? (activeProject?.name ?? '交付')
    : deliverProjectName.trim();
  const chosenPreset = findPlatformPreset(presetId) ?? PLATFORM_PRESETS[0]!;
  const deliverPlan = useMemo(
    () =>
      planDeliverablePackage(pickedTasks, {
        preset: chosenPreset,
        projectName: effectiveProjectName,
        projectId,
        includeVideo,
        includeProject,
        includeCover,
        includeManifest,
        transcode,
      }),
    [
      pickedTasks,
      chosenPreset,
      effectiveProjectName,
      projectId,
      includeVideo,
      includeProject,
      includeCover,
      includeManifest,
      transcode,
    ],
  );
  /** 有条目带规格提示时如实汇总（**不阻断**：客户有权按自己的判断交付） */
  const warnedItems = deliverPlan.items.filter((item) => item.warnings.length > 0);

  function togglePick(taskId: string): void {
    setPickedIds((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId],
    );
  }

  async function handleBuildDeliverable(): Promise<void> {
    if (deliverBusy) return;
    setDeliverBusy(true);
    setDeliverError(null);
    setDeliverProgress('准备中…');
    try {
      const built = await buildDeliverableZip(
        deliverPlan,
        {
          includeVideo,
          includeProject,
          includeCover,
          includeManifest,
          transcode,
          preset: chosenPreset,
        },
        (progress) => setDeliverProgress(progress.label),
      );
      saveDeliverable(built);
      setNotice(
        `交付包已生成：${built.packageName}（${built.entryNames.length} 个文件，含 ${
          includeManifest ? '交付清单' : '无清单'
        }）。`,
      );
      setDeliverOpen(false);
    } catch (caught) {
      setDeliverError(describeError(caught));
    } finally {
      setDeliverBusy(false);
      setDeliverProgress(null);
    }
  }

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

        {/* 交付包入口（V2.13 / B49）：勾选 ≥1 条才可用 —— 灰按钮上写明为什么要先勾选 */}
        <button
          type="button"
          className="wb-btn wb-btn-gold dl-open"
          disabled={pickedTasks.length === 0}
          title={
            pickedTasks.length === 0
              ? '先在卡片上勾选要交付的成片（卡片右下角的 ☐）'
              : '把选中的成片打成交付包（命名 + 规格校验 + 归档清单）'
          }
          onClick={() => {
            setDeliverError(null);
            setDeliverOpen(true);
          }}
        >
          📦 交付包{pickedTasks.length === 0 ? '' : `（${pickedTasks.length}）`}
        </button>
      </div>

      {deliverOpen && pickedTasks.length > 0 ? (
        <section className="wb-panel dl-panel" role="dialog" aria-label="交付包">
          <div className="wb-field-head">
            <Eyebrow tone="gold" as="h2">
              交付包
            </Eyebrow>
            <span className="wb-note">
              {pickedTasks.length} 条 · 包内 {deliverPlan.plannedEntryCount} 个文件 ·{' '}
              {deliverPlan.packageName}
            </span>
            <button
              type="button"
              className="wb-btn lib-icon"
              aria-label="关闭交付面板"
              onClick={() => setDeliverOpen(false)}
            >
              ✕
            </button>
          </div>

          <div className="dl-row">
            <label className="wb-field">
              <span className="wb-label">平台规格</span>
              <select
                className="wb-input dl-preset"
                value={presetId}
                aria-label="平台规格预设"
                onChange={(event) => setPresetId(event.target.value)}
              >
                {PLATFORM_PRESETS.map((preset) => (
                  <option key={preset.presetId} value={preset.presetId}>
                    {preset.label}（{preset.aspectRatio} · {preset.width}×{preset.height} · ≤
                    {preset.maxDurationSec}s）
                  </option>
                ))}
              </select>
            </label>
            <label className="wb-field">
              <span className="wb-label">项目前缀（命名用）</span>
              <input
                className="wb-input dl-project"
                value={deliverProjectName}
                maxLength={30}
                placeholder={activeProject?.name ?? '交付'}
                aria-label="项目前缀"
                onChange={(event) => setDeliverProjectName(event.target.value)}
              />
            </label>
          </div>

          <p className="wb-note dl-note">
            {chosenPreset.note} —— 本工具**只做命名与规格校验，不转码**（口径：{chosenPreset.basis}）。
          </p>

          <div className="dl-checks">
            <label>
              <input
                type="checkbox"
                checked={includeVideo}
                onChange={(event) => setIncludeVideo(event.target.checked)}
              />
              成片 MP4
            </label>
            <label>
              <input
                type="checkbox"
                checked={includeProject}
                onChange={(event) => setIncludeProject(event.target.checked)}
              />
              剪辑工程 JSON（仅剪辑产物有）
            </label>
            <label>
              <input
                type="checkbox"
                checked={includeCover}
                onChange={(event) => setIncludeCover(event.target.checked)}
              />
              封面图
            </label>
            <label>
              <input
                type="checkbox"
                checked={includeManifest}
                onChange={(event) => setIncludeManifest(event.target.checked)}
              />
              交付清单.json
            </label>
            <label
              className="dl-transcode"
              title={`在浏览器内把成片重新渲染成 ${chosenPreset.width}×${chosenPreset.height}（画幅按 cover 裁切，不拉伸；时长不变；耗时与片长成正比）`}
            >
              <input
                type="checkbox"
                checked={transcode}
                data-testid="dl-transcode"
                onChange={(event) => setTranscode(event.target.checked)}
              />
              按预设重新渲染（{chosenPreset.width}×{chosenPreset.height}）
            </label>
          </div>

          {warnedItems.length === 0 ? null : (
            <div className="wb-uncertain dl-warn">
              <span className="wb-uncertain-title">
                {warnedItems.length} 条与所选规格不一致（**只提示，不阻断**）
              </span>
              <ul className="dl-warn-list">
                {warnedItems.slice(0, 3).map((item) => (
                  <li key={item.task.taskId}>
                    {item.videoFileName}：{item.warnings.join('；')}
                  </li>
                ))}
              </ul>
              {warnedItems.length > 3 ? (
                <span className="wb-note">另有 {warnedItems.length - 3} 条，同类提示见交付清单。</span>
              ) : null}
            </div>
          )}

          {deliverError === null ? null : (
            <div className="wb-uncertain dl-warn">
              <span className="wb-uncertain-title">打包失败</span>
              <span className="wb-uncertain-body">{deliverError}</span>
            </div>
          )}

          <div className="dl-actions">
            <span className="wb-note dl-hint">
              {deliverProgress === null
                ? `命名示例：${deliverPlan.items[0]?.videoFileName ?? '—'}`
                : deliverProgress}
            </span>
            <button
              type="button"
              className="wb-btn wb-btn-gold"
              data-testid="dl-build"
              disabled={deliverBusy || deliverPlan.plannedEntryCount === 0}
              onClick={() => void handleBuildDeliverable()}
            >
              {deliverBusy ? '打包中…' : '📦 生成并下载'}
            </button>
          </div>
        </section>
      ) : null}

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
                    {/* 交付包多选（V2.13 / B49）：data-picked 是给冒烟读的渲染事实 */}
                    <button
                      type="button"
                      className={`wb-btn lib-icon dl-pick${pickedIds.includes(task.taskId) ? ' dl-pick-on' : ''}`}
                      aria-pressed={pickedIds.includes(task.taskId)}
                      data-picked={pickedIds.includes(task.taskId) ? '1' : '0'}
                      title="加入 / 移出交付包"
                      onClick={() => togglePick(task.taskId)}
                    >
                      {pickedIds.includes(task.taskId) ? '☑' : '☐'}
                    </button>
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

              {/* 剪辑产物（V2.5 起两代：旧 EDL 记 script、多轨工程记 project） */}
              <div className="lib-edl-slot">
                <Eyebrow>剪辑来源</Eyebrow>
                {selected.origin?.kind === 'edit' ? (
                  <>
                    <p className="wb-note">
                      剪辑自 {selected.origin.sourceTaskId.slice(0, 8)} ——{' '}
                      {describeEditOrigin(selected.origin)}
                    </p>
                    {selected.origin.script === undefined ? (
                      <p className="wb-note">
                        多轨工程产物（工程随任务落库；点 ✂ 可载入继续编辑）。
                      </p>
                    ) : (
                      <ol className="edit-history">
                        {selected.origin.script.operations.map((operation, index) => (
                          <li key={`${operation.type}-${index}`}>
                            <span className="edit-order">{String(index + 1).padStart(2, '0')}</span>
                            <span className="wb-note">{EDIT_OPERATION_LABELS[operation.type]}</span>
                          </li>
                        ))}
                      </ol>
                    )}
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
