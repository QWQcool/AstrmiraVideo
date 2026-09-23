import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EDIT_OPERATION_LABELS,
  MAX_EDIT_OPERATIONS,
  type EditOperation,
  type EditScript,
  type TaskProgress,
} from '@astrmira/shared';
import { Eyebrow } from '../components/Eyebrow';
import { useTaskPolling } from '../hooks/useTaskPolling';
import { ApiError, fetchHistory, resolveMediaUrl, submitEdit } from '../lib/api';
import { navigate, useHashRoute } from '../lib/router';
import { formatBytes, formatRelativeTime } from '../lib/overviewStats';

/**
 * 剪辑台（V9 · B9；CONTRACT §11-2）。
 *
 * 形态由 B1 闸门拍板：**独立视图 `#/edit?task=<id>`**（不是视频库里的子面板）——
 * 它的体量值得一整块屏幕。无 `task` 参数时显示空态引导（"去视频库选一条"）。
 *
 * 两件事各自单一来源：
 * - **操作序列**（EDL）在本地 state 里编辑，提交时整体发给 `POST /api/edits`；
 * - **执行状态**复用 `useTaskPolling`（与生成任务同一条轮询链路）—— 剪辑产物就是一条普通任务。
 *
 * "本片剪辑历史"从 `/api/history` 里按 `origin.sourceTaskId` 过滤得到（不新增后端路由）。
 */

const OPERATION_TYPES: EditOperation['type'][] = [
  'trim',
  'concat',
  'xfade',
  'volume',
  'speed',
  'extractFrame',
];

/** 每种操作的默认参数（点了"添加"就能直接用，不用先填一堆空） */
function defaultOperation(type: EditOperation['type']): EditOperation {
  switch (type) {
    case 'trim':
      return { type: 'trim', startSec: 0, endSec: 3 };
    case 'concat':
      return { type: 'concat', taskIds: [''] };
    case 'xfade':
      return { type: 'xfade', transition: 'fade', durationSec: 0.4 };
    case 'volume':
      return { type: 'volume', gain: 1 };
    case 'speed':
      return { type: 'speed', factor: 1.25 };
    case 'extractFrame':
      return { type: 'extractFrame', atSec: 1 };
  }
}

function describeOperation(operation: EditOperation): string {
  switch (operation.type) {
    case 'trim':
      return `${operation.startSec}s → ${operation.endSec}s`;
    case 'concat':
      return operation.taskIds.map((id) => id.slice(0, 8)).join(' + ');
    case 'xfade':
      return `${operation.transition} · ${operation.durationSec}s`;
    case 'volume':
      return operation.gain === 0 ? '静音' : `×${operation.gain}`;
    case 'speed':
      return `×${operation.factor}`;
    case 'extractFrame':
      return `at ${operation.atSec}s → 参考资产`;
  }
}

function describeError(caught: unknown): string {
  if (caught instanceof ApiError) {
    const code = caught.failure.code === undefined ? '' : `【${caught.failure.code}】`;
    return `${code}${caught.failure.message}`;
  }
  return caught instanceof Error ? caught.message : String(caught);
}

const STATUS_TEXT: Record<TaskProgress['status'], string> = {
  queued: '排队中',
  running: '剪辑中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

export function EditView() {
  const route = useHashRoute();
  const sourceId = route.query.get('task');

  const [history, setHistory] = useState<TaskProgress[]>([]);
  const [operations, setOperations] = useState<EditOperation[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const data = await fetchHistory();
      setHistory(data.items);
    } catch (caught) {
      setError(describeError(caught));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const { task: activeTask } = useTaskPolling(activeTaskId, {
    onSettled: () => {
      void reload();
    },
  });

  const source = useMemo(
    () => history.find((item) => item.taskId === sourceId) ?? null,
    [history, sourceId],
  );

  /** 该源片的剪辑历史（`origin.sourceTaskId` 指向它） */
  const edlHistory = useMemo(
    () => history.filter((item) => item.origin?.kind === 'edit' && item.origin.sourceTaskId === sourceId),
    [history, sourceId],
  );

  /** 可作为拼接素材的其它成片 */
  const candidates = useMemo(
    () =>
      history.filter(
        (item) => item.status === 'succeeded' && item.outputVideoUrl !== undefined && item.taskId !== sourceId,
      ),
    [history, sourceId],
  );

  async function handleRun(): Promise<void> {
    if (sourceId === null || source === null) return;

    setError(null);
    setNotice(null);

    if (operations.length === 0) {
      setError('请先添加至少一个操作');
      return;
    }
    if (operations.length > MAX_EDIT_OPERATIONS) {
      setError(`操作数上限 ${MAX_EDIT_OPERATIONS}（当前 ${operations.length}）`);
      return;
    }
    const incomplete = operations.findIndex((op) =>
      op.type === 'concat' ? op.taskIds.some((id) => id.trim() === '') : false,
    );
    if (incomplete !== -1) {
      setError(`第 ${incomplete + 1} 个「拼接」还没选素材`);
      return;
    }

    const script: EditScript = { sourceTaskId: source.taskId, operations };

    setSubmitting(true);
    try {
      const created = await submitEdit(script);
      setActiveTaskId(created.taskId);
      setNotice('已提交剪辑（本地 ffmpeg · 零上游调用 · 不占冷却）');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSubmitting(false);
    }
  }

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
    <section className="wb-page">
      <div className="wb-page-head wb-page-head-row">
        <div>
          <h1 className="wb-page-title">剪辑 · {sourceId.slice(0, 8)}</h1>
          <Eyebrow tone="gold">Editing Desk</Eyebrow>
        </div>
        <a className="wb-btn" href="#/library">
          ← 返回视频库
        </a>
      </div>

      {error === null ? null : (
        <div className="wb-uncertain" style={{ marginBottom: 14 }}>
          <span className="wb-uncertain-title">无法执行</span>
          <span className="wb-uncertain-body">{error}</span>
        </div>
      )}
      {notice === null ? null : (
        <div className="wb-queue-item" style={{ marginBottom: 14 }}>
          <span className="wb-dot" />
          <span className="wb-note">{notice}</span>
        </div>
      )}

      <div className="edit-wrap">
        <section className="wb-panel">
          <div className="wb-field-head">
            <Eyebrow index={1} tone="gold" as="h2">
              操作序列（EDL）
            </Eyebrow>
            <span className="wb-note">
              {operations.length} / {MAX_EDIT_OPERATIONS} 步
            </span>
          </div>

          {operations.length === 0 ? (
            <p className="wb-note">还没有操作。从下面选一个加进来：裁剪 → 拼接 → 转场是最常见的组合。</p>
          ) : (
            <div className="edit-edl">
              {operations.map((operation, index) => (
                <div className="edit-row" key={`${operation.type}-${index}`}>
                  <span className="edit-order">{String(index + 1).padStart(2, '0')}</span>
                  <span className="edit-kind">{EDIT_OPERATION_LABELS[operation.type]}</span>

                  {operation.type === 'trim' ? (
                    <span className="edit-params">
                      <input
                        className="wb-input edit-num"
                        type="number"
                        min={0}
                        step={0.1}
                        value={operation.startSec}
                        aria-label="裁剪起点"
                        onChange={(event) =>
                          setOperations((prev) =>
                            prev.map((item, position) =>
                              position === index && item.type === 'trim'
                                ? { ...item, startSec: Number(event.target.value) }
                                : item,
                            ),
                          )
                        }
                      />
                      <span className="wb-note">→</span>
                      <input
                        className="wb-input edit-num"
                        type="number"
                        min={0}
                        step={0.1}
                        value={operation.endSec}
                        aria-label="裁剪终点"
                        onChange={(event) =>
                          setOperations((prev) =>
                            prev.map((item, position) =>
                              position === index && item.type === 'trim'
                                ? { ...item, endSec: Number(event.target.value) }
                                : item,
                            ),
                          )
                        }
                      />
                      <span className="wb-note">秒</span>
                    </span>
                  ) : null}

                  {operation.type === 'concat' ? (
                    <span className="edit-params">
                      <select
                        className="wb-input"
                        value={operation.taskIds[0] ?? ''}
                        aria-label="拼接素材"
                        onChange={(event) =>
                          setOperations((prev) =>
                            prev.map((item, position) =>
                              position === index && item.type === 'concat'
                                ? { ...item, taskIds: [event.target.value] }
                                : item,
                            ),
                          )
                        }
                      >
                        <option value="">选择素材…</option>
                        {candidates.map((item) => (
                          <option key={item.taskId} value={item.taskId}>
                            {item.taskId.slice(0, 8)} · {item.requestSnapshot.prompt.slice(0, 16)}
                          </option>
                        ))}
                      </select>
                    </span>
                  ) : null}

                  {operation.type === 'xfade' ? (
                    <span className="edit-params">
                      <select
                        className="wb-input"
                        value={operation.transition}
                        aria-label="转场类型"
                        onChange={(event) =>
                          setOperations((prev) =>
                            prev.map((item, position) =>
                              position === index && item.type === 'xfade'
                                ? { ...item, transition: event.target.value as 'fade' | 'wipeleft' | 'slideright' }
                                : item,
                            ),
                          )
                        }
                      >
                        <option value="fade">淡入淡出</option>
                        <option value="wipeleft">左擦除</option>
                        <option value="slideright">右滑入</option>
                      </select>
                      <input
                        className="wb-input edit-num"
                        type="number"
                        min={0.1}
                        max={2}
                        step={0.1}
                        value={operation.durationSec}
                        aria-label="转场时长"
                        onChange={(event) =>
                          setOperations((prev) =>
                            prev.map((item, position) =>
                              position === index && item.type === 'xfade'
                                ? { ...item, durationSec: Number(event.target.value) }
                                : item,
                            ),
                          )
                        }
                      />
                      <span className="wb-note">秒</span>
                    </span>
                  ) : null}

                  {operation.type === 'volume' ? (
                    <span className="edit-params">
                      <input
                        className="wb-input edit-num"
                        type="number"
                        min={0}
                        max={2}
                        step={0.1}
                        value={operation.gain}
                        aria-label="音量倍数"
                        onChange={(event) =>
                          setOperations((prev) =>
                            prev.map((item, position) =>
                              position === index && item.type === 'volume'
                                ? { ...item, gain: Number(event.target.value) }
                                : item,
                            ),
                          )
                        }
                      />
                      <span className="wb-note">倍（0 = 静音）</span>
                    </span>
                  ) : null}

                  {operation.type === 'speed' ? (
                    <span className="edit-params">
                      <input
                        className="wb-input edit-num"
                        type="number"
                        min={0.25}
                        max={4}
                        step={0.05}
                        value={operation.factor}
                        aria-label="速度倍数"
                        onChange={(event) =>
                          setOperations((prev) =>
                            prev.map((item, position) =>
                              position === index && item.type === 'speed'
                                ? { ...item, factor: Number(event.target.value) }
                                : item,
                            ),
                          )
                        }
                      />
                      <span className="wb-note">倍</span>
                    </span>
                  ) : null}

                  {operation.type === 'extractFrame' ? (
                    <span className="edit-params">
                      <input
                        className="wb-input edit-num"
                        type="number"
                        min={0}
                        step={0.1}
                        value={operation.atSec}
                        aria-label="抽帧时间点"
                        onChange={(event) =>
                          setOperations((prev) =>
                            prev.map((item, position) =>
                              position === index && item.type === 'extractFrame'
                                ? { ...item, atSec: Number(event.target.value) }
                                : item,
                            ),
                          )
                        }
                      />
                      <span className="wb-note">秒 → 参考资产</span>
                    </span>
                  ) : null}

                  <span className="edit-summary wb-note">{describeOperation(operation)}</span>

                  <button
                    type="button"
                    className="wb-btn lib-icon"
                    title="移除这一步"
                    onClick={() => setOperations((prev) => prev.filter((_, position) => position !== index))}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="edit-add">
            {OPERATION_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                className="wb-btn"
                onClick={() => setOperations((prev) => [...prev, defaultOperation(type)])}
              >
                ＋ {EDIT_OPERATION_LABELS[type]}
              </button>
            ))}
          </div>

          <p className="wb-note" style={{ marginTop: 10 }}>
            顺序执行、最多 {MAX_EDIT_OPERATIONS} 步。「转场」必须紧跟在「拼接」之后（它的语义属于两段之间的接缝）。
          </p>
        </section>

        <section className="wb-panel">
          <div className="wb-field-head">
            <Eyebrow index={2} tone="gold" as="h2">
              源片与产物
            </Eyebrow>
            <span className="wb-note">
              {source === null
                ? '读取中…'
                : `源片 ${source.status} · ${formatBytes(source.outputSizeBytes ?? 0)}`}
            </span>
          </div>

          <div className="lib-preview">
            {source?.outputVideoUrl === undefined ? (
              <span className="wb-note">源片不可播放（可能已被清理）</span>
            ) : (
              <video src={resolveMediaUrl(source.outputVideoUrl) ?? undefined} controls preload="metadata" />
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <button
              type="button"
              className="wb-btn wb-btn-gold"
              disabled={submitting || source === null}
              onClick={() => void handleRun()}
            >
              {submitting ? '提交中…' : '执行剪辑'}
            </button>
            <span className="wb-note">本地 ffmpeg · 并发 1 · 零上游调用（不花钱、不占冷却）</span>
          </div>

          {activeTask === null ? null : (
            <div className="wb-queue-item" style={{ marginTop: 12 }}>
              <span className={`wb-dot ${activeTask.status === 'succeeded' ? 'wb-dot-ok' : ''}`} />
              <span className="wb-note">
                {STATUS_TEXT[activeTask.status]}
                {activeTask.status === 'running' ? ` · ${activeTask.progressPercent}%` : ''}
                {activeTask.error === undefined ? '' : ` · ${activeTask.error.code}`}
              </span>
            </div>
          )}

          {activeTask?.status === 'succeeded' && activeTask.outputVideoUrl !== undefined ? (
            <div className="lib-preview" style={{ marginTop: 12 }}>
              <video src={resolveMediaUrl(activeTask.outputVideoUrl) ?? undefined} controls preload="metadata" />
            </div>
          ) : null}

          {activeTask?.extractedAssetIds === undefined || activeTask.extractedAssetIds.length === 0 ? null : (
            <p className="wb-note" style={{ marginTop: 8 }}>
              已抽出 {activeTask.extractedAssetIds.length} 张参考资产（在视频库详情里可用作首帧/尾帧）。
            </p>
          )}

          <div className="lib-edl-slot" style={{ marginTop: 14 }}>
            <Eyebrow>本片剪辑历史</Eyebrow>
            {edlHistory.length === 0 ? (
              <p className="wb-note">这条还没有剪辑记录。</p>
            ) : (
              <ul className="edit-history">
                {edlHistory.map((item) => (
                  <li key={item.taskId}>
                    <span className="wb-note">
                      {formatRelativeTime(item.createdAt, Date.now())} · {STATUS_TEXT[item.status]} ·{' '}
                      {(item.origin?.kind === 'edit' ? item.origin.script.operations.length : 0)} 步
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
          </div>
        </section>
      </div>
    </section>
  );
}
