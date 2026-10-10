import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { describeEditOrigin } from '@astrmira/shared';
import type { AssetListEntry, TaskProgress } from '@astrmira/shared';
import { Eyebrow } from '../components/Eyebrow';
import { ApiError, fetchAssets, fetchHistory, resolveMediaUrl } from '../lib/api';
import { navigate, useHashRoute } from '../lib/router';
import { formatBytes, formatRelativeTime } from '../lib/overviewStats';
import { DEFAULT_PROJECT_FPS, createProjectFromSource } from '../edit/model';
import { ExportPanel } from '../edit/ExportPanel';
import { InspectorPanel } from '../edit/InspectorPanel';
import { loadEditDraft, saveEditDraft } from '../edit/draft';
import { probeVideoMeta } from '../edit/mediaProbe';
import { useShell } from '../lib/shell';
import { togglePlayback } from '../edit/playerRef';
import { EditStore, useEditStore } from '../edit/store';
import { Timeline } from '../edit/Timeline';

/**
 * 剪辑台（B34 · Remotion 多轨改版 · P1）。
 *
 * 形态：独立视图 `#/edit?task=<id>`（B1 闸门拍板，不进侧栏；无 task 时空态引导）。
 * P1 交付 = 多轨数据模型 + @remotion/player 预览 + 单轨时间轴（clip 可拖动/裁剪/选中）：
 * - **预览即所得**：预览组件 `EditComposition` 与 P2 的浏览器端导出（web-renderer）共用；
 * - 导出、字幕/转场/音效轨、属性面板分别在 P2 / P3 开放（P1 界面不出假按钮）；
 * - 本地 ffmpeg 基础剪辑链路（`POST /api/edits`）按决策保留为**纯 API 能力**，
 *   UI 入口随本次改版撤掉；「本片剪辑历史」保留（P4 契约迁移继续用）。
 *
 * Remotion 的加载边界：`PlayerStage` 用 React.lazy 懒加载（主 bundle 不含 Remotion）。
 */

const PlayerStage = lazy(() => import('../edit/PlayerStage'));

/** 一次性提示条（store.notice）：模型替用户做的"破坏性修补"必须说出来，不静默 */
const EditNotice: React.FC<{ store: EditStore }> = ({ store }) => {
  const notice = useEditStore(store, (s) => s.notice);
  if (notice === null) return null;
  return (
    <div className="wb-queue-item ed-notice" style={{ marginBottom: 14 }}>
      <span className="wb-dot" />
      <span className="wb-note">{notice}</span>
    </div>
  );
};

const STATUS_TEXT: Record<TaskProgress['status'], string> = {
  queued: '排队中',
  running: '剪辑中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

function describeError(caught: unknown): string {
  if (caught instanceof ApiError) {
    const code = caught.failure.code === undefined ? '' : `【${caught.failure.code}】`;
    return `${code}${caught.failure.message}`;
  }
  return caught instanceof Error ? caught.message : String(caught);
}

export function EditView() {
  const route = useHashRoute();
  const sourceId = route.query.get('task');
  // V2.11（B47）：剪辑台的候选素材 / 剪辑历史 / 音频素材都按当前项目过滤
  const { projectId } = useShell();

  const [history, setHistory] = useState<TaskProgress[]>([]);
  const [allEdits, setAllEdits] = useState<TaskProgress[]>([]);
  const [edlHistory, setEdlHistory] = useState<TaskProgress[]>([]);
  // V2.10（台账 B57）：上传的音频素材（资产库里 kind=audio 的那些）——音效轨的独立素材来源
  const [assets, setAssets] = useState<AssetListEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [store, setStore] = useState<EditStore | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      // 四路并发：生成产物（源片 + 候选素材）、全部剪辑产物（B37：素材候选合并）、
      // 本片剪辑历史（V2.4 口径，剪辑产物不进主历史）、资产库（B57：音频素材）
      const [main, edits, sourceEdits, assetList] = await Promise.all([
        fetchHistory({ project: projectId }),
        fetchHistory({ kind: 'edit', project: projectId }),
        sourceId === null
          ? Promise.resolve(null)
          : fetchHistory({ kind: 'edit', source: sourceId, project: projectId }),
        fetchAssets(projectId),
      ]);
      setHistory(main.items);
      setAllEdits(edits.items);
      setEdlHistory(sourceEdits === null ? [] : sourceEdits.items);
      setAssets(assetList.assets);
      setLoadError(null);
    } catch (caught) {
      setLoadError(describeError(caught));
    }
  }, [sourceId, projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 源片查找覆盖生成产物与剪辑产物（B37：剪辑产物本身也可以再剪 —— 串剪是一等手法）
  const source = useMemo(
    () =>
      history.find((item) => item.taskId === sourceId) ??
      allEdits.find((item) => item.taskId === sourceId) ??
      null,
    [history, allEdits, sourceId],
  );

  /** 可作为素材的成片（已成功且有产物；含源片自己 —— 同一片多次入场是合法剪辑手法；
   *  B37：剪辑产物与生成产物同列候选，新的在前） */
  const candidates = useMemo(
    () =>
      [...history, ...allEdits]
        .filter((item) => item.status === 'succeeded' && item.outputVideoUrl !== undefined)
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
    [history, allEdits],
  );

  /** V2.10（B57）：音效轨的素材来源 = 资产库里的音频（新的在前，与成片候选同一观感） */
  const audioAssets = useMemo(
    () =>
      assets
        .filter((asset) => asset.kind === 'audio')
        .sort((a, b) => b.createdAt - a.createdAt),
    [assets],
  );

  const sourceUrl = resolveMediaUrl(source?.outputVideoUrl);

  // 源片 → 探测真实时长/尺寸（裁剪上限的唯一依据）→ 建工程与 store。
  // 有草稿则恢复草稿（刷新不丢编辑成果，P3），草稿脏数据由 draft 模块自愈
  useEffect(() => {
    if (sourceId === null || sourceUrl === null) {
      setStore(null);
      return;
    }
    let cancelled = false;
    setProbeError(null);
    probeVideoMeta(sourceUrl, DEFAULT_PROJECT_FPS)
      .then((meta) => {
        if (cancelled) return;
        const draft = loadEditDraft(sourceId);
        const project =
          draft ??
          createProjectFromSource(
            { taskId: sourceId, url: sourceUrl, durationFrames: meta.durationFrames },
            { fps: DEFAULT_PROJECT_FPS, width: meta.width, height: meta.height, label: '源片' },
          );
        setStore(new EditStore(project));
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setStore(null);
        setProbeError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [sourceId, sourceUrl]);

  // 工程变化 → 防抖落草稿（500ms；切视图/刷新时即刻 flush）
  useEffect(() => {
    if (store === null || sourceId === null) return;
    let timer: number | undefined;
    const flush = (): void => saveEditDraft(sourceId, store.getState().project);
    const unsubscribe = store.subscribe(() => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(flush, 500);
    });
    // ⚠️ 硬导航（刷新 / 关标签 / 跳外链）**不走 React 的 cleanup** ——
    // 只靠防抖会丢掉"刚编辑完就刷新"的最后一笔；pagehide + beforeunload 兜底同步落一次。
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      unsubscribe();
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [store, sourceId]);

  // 快捷键：Delete 删除选中片段；空格播放/暂停（输入控件内不抢）
  useEffect(() => {
    if (store === null) return;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const selected = store.getState().selectedClipId;
        if (selected !== null) {
          store.removeClip(selected);
          event.preventDefault();
        }
      } else if (event.key === ' ') {
        togglePlayback();
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);

  // ── 无源片：空态 ──
  if (sourceId === null) {
    return (
      <section className="wb-page">
        <div className="wb-page-head">
          <h1 className="wb-page-title">剪辑台</h1>
          <Eyebrow tone="gold">Editing Desk</Eyebrow>
        </div>
        <div className="wb-placeholder">
          <Eyebrow>Empty State</Eyebrow>
          <p className="wb-note">
            剪辑台需要一个源片：到 <a href="#/library">视频库</a> 里挑一条成片，点卡片上的 ✂ 进来。
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="wb-page ed-page">
      <div className="wb-page-head wb-page-head-row">
        <div>
          <h1 className="wb-page-title">剪辑 · {sourceId.slice(0, 8)}</h1>
          <Eyebrow tone="gold">Editing Desk</Eyebrow>
        </div>
        <a className="wb-btn" href="#/library">
          ← 返回视频库
        </a>
      </div>

      {loadError === null ? null : (
        <div className="wb-uncertain" style={{ marginBottom: 14 }}>
          <span className="wb-uncertain-title">历史加载失败</span>
          <span className="wb-uncertain-body">{loadError}</span>
        </div>
      )}
      {probeError === null ? null : (
        <div className="wb-uncertain" style={{ marginBottom: 14 }}>
          <span className="wb-uncertain-title">源片不可剪辑</span>
          <span className="wb-uncertain-body">{probeError}</span>
        </div>
      )}
      {store === null ? null : <EditNotice store={store} />}

      <div className="ed-body">
        <div className="ed-stage-col">
          {store === null ? (
            <div className="wb-skeleton ed-stage-skeleton" />
          ) : (
            <Suspense fallback={<div className="wb-skeleton ed-stage-skeleton" />}>
              <PlayerStage store={store} />
            </Suspense>
          )}
        </div>

        <aside className="ed-side">
          {store === null ? null : <InspectorPanel store={store} />}
          {store === null ? null : <ExportPanel store={store} sourceTaskId={sourceId} />}

          <section className="wb-panel ed-side-panel">
            <div className="wb-field-head">
              <Eyebrow index={3} tone="gold" as="h2">
                源片
              </Eyebrow>
              <span className="wb-note">
                {source === null
                  ? '读取中…'
                  : `${STATUS_TEXT[source.status]} · ${formatBytes(source.outputSizeBytes ?? 0)}`}
              </span>
            </div>
            {source === null ? null : (
              <p className="wb-note ed-source-prompt">{source.requestSnapshot.prompt}</p>
            )}
          </section>

          <section className="wb-panel ed-side-panel">
            <div className="wb-field-head">
              <Eyebrow index={4} tone="gold" as="h2">
                本片剪辑历史
              </Eyebrow>
            </div>
            {edlHistory.length === 0 ? (
              <p className="wb-note">这条还没有剪辑记录。</p>
            ) : (
              <ul className="edit-history">
                {edlHistory.map((item) => (
                  <li key={item.taskId}>
                    <span className="wb-note">
                      {formatRelativeTime(item.createdAt, Date.now())} · {STATUS_TEXT[item.status]} ·{' '}
                      {item.origin?.kind === 'edit' ? describeEditOrigin(item.origin) : '—'}
                    </span>
                    {item.outputVideoUrl === undefined ? null : (
                      <button
                        type="button"
                        className="wb-btn lib-icon"
                        title="载入这条剪辑结果继续编辑"
                        onClick={() => navigate(`#/edit?task=${encodeURIComponent(item.taskId)}`)}
                      >
                        ✂
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {store === null ? null : (
        <Timeline store={store} candidates={candidates} audioAssets={audioAssets} />
      )}

      <p className="wb-note ed-footnote">
        多轨时间轴（Remotion 预览，所见即所得）：拖动移动片段、左右缘拖拽裁剪、Delete 删除、空格播放/暂停。
        导出在下一批接入（浏览器端渲染，不占服务器算力）；字幕 / 转场 / 音效轨随后开放。
      </p>
    </section>
  );
}
