import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreationRun, CreationRunSummary } from '@astrmira/shared';
import {
  ApiError,
  cancelCreationRun,
  confirmCreationRun,
  fetchCreationRun,
  fetchCreationRuns,
  retryCreationRunStep,
  startCreationRun,
} from '../lib/api';
import { useTranslate, type MessageKey } from '../lib/i18n';
import { useShell } from '../lib/shell';

/**
 * 创作会话视图（S8-D；CONTRACT §29）。
 *
 * 定位：**进度与控制台**，不是编辑器——步骤图在创建时冻结，这里只读进度、做四类显式动作
 * （开始 / 首帧确认继续 / 取消 / 失败步重试）。会话与画布解耦（§29-1），
 * 离开页面再回来：列表 + 详情轮询 3s 续看，断线由服务端 tick 定时器兜底。
 */

const STATE_KEYS: Record<CreationRun['state'], MessageKey> = {
  planned: 'runs.state.planned',
  running: 'runs.state.running',
  'awaiting-confirmation': 'runs.state.awaiting',
  assembling: 'runs.state.assembling',
  succeeded: 'runs.state.succeeded',
  failed: 'runs.state.failed',
  cancelled: 'runs.state.cancelled',
};

const STEP_STATUS_KEYS: Record<string, MessageKey> = {
  pending: 'runs.step.pending',
  submitting: 'runs.step.submitting',
  running: 'runs.step.running',
  succeeded: 'runs.step.succeeded',
  failed: 'runs.step.failed',
};

const MODE_KEYS: Record<CreationRun['mode'], MessageKey> = {
  unattended: 'runs.mode.unattended',
  'first-frame-confirm': 'runs.mode.confirm',
};

function isLive(run: CreationRunSummary | CreationRun | null): boolean {
  return (
    run !== null &&
    (run.state === 'running' ||
      run.state === 'awaiting-confirmation' ||
      run.state === 'assembling' ||
      run.state === 'planned')
  );
}

function errorText(caught: unknown): string {
  if (caught instanceof ApiError) return caught.message;
  return caught instanceof Error ? caught.message : String(caught);
}

export function RunsView() {
  const t = useTranslate();
  const { projectId } = useShell();
  const [summaries, setSummaries] = useState<CreationRunSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CreationRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const detailRef = useRef<CreationRun | null>(null);
  detailRef.current = detail;

  /**
   * B97：会话列表与详情都**按当前业务项目**取。
   *
   * 两道异步边界（与 B94 同一条纪律）：
   * 1. `projectRef` 记录"请求发出时属于哪个项目"，返回时不一致就整包丢弃；
   * 2. 列表/详情各自的请求代次只允许最新一次写状态 —— 项目 A→B→A 的迟到响应
   *    不能把 B（或回 A 之后）的界面覆盖成旧数据。
   *
   * 切换项目**只**重拉列表并清空选中，不创建会话、不触发任何生成。
   */
  const projectRef = useRef(projectId);
  const listSeqRef = useRef(0);
  const detailSeqRef = useRef(0);

  const reload = useCallback(async (): Promise<void> => {
    const seq = ++listSeqRef.current;
    const project = projectRef.current;
    try {
      const list = await fetchCreationRuns(project);
      if (seq !== listSeqRef.current || project !== projectRef.current) return;
      setSummaries(list.runs);
      // 详情跟随：选中项仍属于当前项目且在列表里就续看；否则清空（换项目/被删）
      const current = detailRef.current;
      if (
        current !== null &&
        (current.projectId !== project || !list.runs.some((item) => item.id === current.id))
      ) {
        setSelectedId(null);
        setDetail(null);
      }
      setError(null);
    } catch (caught) {
      if (seq === listSeqRef.current) setError(errorText(caught));
    }
  }, []);

  const refreshDetail = useCallback(
    async (id: string, expectedProject: string = projectRef.current): Promise<void> => {
      const seq = ++detailSeqRef.current;
      try {
        const result = await fetchCreationRun(id);
        if (seq !== detailSeqRef.current || expectedProject !== projectRef.current) return;
        if (result.run.projectId !== expectedProject) {
          // 不属于当前项目：不显示（也不能让旧选中把另一项目的数据带出来）
          setSelectedId(null);
          setDetail(null);
          return;
        }
        setDetail(result.run);
      } catch (caught) {
        if (seq === detailSeqRef.current) setError(errorText(caught));
      }
    },
    [],
  );

  useEffect(() => {
    projectRef.current = projectId;
    // 让在途响应全部失效，再按新项目重拉
    listSeqRef.current += 1;
    detailSeqRef.current += 1;
    setSummaries(null);
    setSelectedId(null);
    setDetail(null);
    setError(null);
    void reload();
  }, [projectId, reload]);

  // 轮询：有活跃会话（列表或详情）才轮询，全部终态就停——不打无意义的请求
  useEffect(() => {
    const anyLive =
      summaries?.some(isLive) === true || isLive(detail);
    if (!anyLive) return;
    const timer = setInterval(() => {
      void reload();
      if (selectedId !== null) void refreshDetail(selectedId);
    }, 3000);
    return () => clearInterval(timer);
  }, [reload, refreshDetail, summaries, selectedId, detail]);

  const act = useCallback(
    async (action: () => Promise<unknown>): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        await action();
        if (selectedId !== null) await refreshDetail(selectedId);
        await reload();
      } catch (caught) {
        setError(errorText(caught));
      } finally {
        setBusy(false);
      }
    },
    [reload, refreshDetail, selectedId],
  );

  const openDetail = (id: string): void => {
    // 只打开当前项目列表里的会话（列表本身就是按项目取回的；这里再挡一次旧渲染闭包）
    const summary = summaries?.find((item) => item.id === id);
    if (summary !== undefined && summary.projectId !== projectRef.current) return;
    const project = projectRef.current;
    setSelectedId(id);
    setDetail(null);
    void refreshDetail(id, project);
  };

  return (
    <section className="wb-page">
      <div className="wb-page-head wb-page-head-row">
        <div>
          <h1 className="wb-page-title">{t('runs.title')}</h1>
          <p className="wb-note">{t('runs.subtitle')}</p>
        </div>
        <button type="button" className="wb-btn" onClick={() => void reload()} disabled={busy}>
          {t('runs.refresh')}
        </button>
      </div>

      {error === null ? null : (
        <p className="wb-note cs-agent-proposal-warning" role="alert">{error}</p>
      )}
      {summaries === null ? (
        <p className="wb-note">{t('runs.loading')}</p>
      ) : summaries.length === 0 ? (
        <p className="wb-note">{t('runs.empty')}</p>
      ) : (
        <div className="wb-log-panel" data-testid="runs-list">
          <table className="ov-table">
            <thead>
              <tr>
                <th>{t('runs.col.title')}</th>
                <th>{t('runs.col.state')}</th>
                <th>{t('runs.col.progress')}</th>
                <th>{t('runs.col.mode')}</th>
                <th>{t('runs.col.updated')}</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => openDetail(item.id)}
                  className={selectedId === item.id ? 'wb-row-selected' : undefined}
                  style={{ cursor: 'pointer' }}
                >
                  <td>{item.title}</td>
                  <td>{t(STATE_KEYS[item.state])}</td>
                  <td>
                    {t('runs.progress', {
                      done: item.succeededCount,
                      total: item.totalStepCount,
                    })}
                    {item.failedCount === 0
                      ? ''
                      : t('runs.progressFailed', { failed: item.failedCount })}
                  </td>
                  <td>{t(MODE_KEYS[item.mode])}</td>
                  <td className="wb-note">{new Date(item.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail === null ? null : (
        <div className="wb-log-panel" data-testid="runs-detail">
          <div className="wb-log-head">
            <div className="wb-log-title">
              <strong>{detail.title}</strong>
              <span className="wb-note">
                {t(STATE_KEYS[detail.state])} · {t(MODE_KEYS[detail.mode])} · {detail.provider}
                {detail.assembledTaskId === undefined
                  ? ''
                  : ` · ${t('runs.assembled', { task: detail.assembledTaskId.slice(0, 8) })}`}
              </span>
            </div>
            <div className="wb-log-head-actions">
              {detail.state === 'planned' ? (
                <button
                  type="button"
                  className="wb-btn"
                  disabled={busy}
                  onClick={() => void act(() => startCreationRun(detail.id))}
                >
                  {t('runs.action.start')}
                </button>
              ) : null}
              {detail.state === 'awaiting-confirmation' ? (
                <button
                  type="button"
                  className="wb-btn"
                  disabled={busy}
                  onClick={() => void act(() => confirmCreationRun(detail.id))}
                >
                  {t('runs.action.confirm')}
                </button>
              ) : null}
              {isLive(detail) ? (
                <button
                  type="button"
                  className="wb-btn"
                  disabled={busy}
                  onClick={() => void act(() => cancelCreationRun(detail.id))}
                >
                  {t('runs.action.cancel')}
                </button>
              ) : null}
              <button type="button" className="wb-btn" onClick={() => setDetail(null)}>
                {t('runs.action.close')}
              </button>
            </div>
          </div>

          {detail.state === 'awaiting-confirmation' ? (
            <p className="wb-note">{t('runs.awaitingHint')}</p>
          ) : null}
          {detail.failure === undefined ? null : (
            <p className="wb-note cs-agent-proposal-warning">
              {t('runs.failure', {
                step: detail.failure.stepId,
                message: detail.failure.message,
              })}
            </p>
          )}

          <table className="ov-table">
            <thead>
              <tr>
                <th>{t('runs.step.col.id')}</th>
                <th>{t('runs.step.col.kind')}</th>
                <th>{t('runs.step.col.status')}</th>
                <th>{t('runs.step.col.attempt')}</th>
                <th>{t('runs.step.col.output')}</th>
                <th>{t('runs.step.col.error')}</th>
              </tr>
            </thead>
            <tbody>
              {detail.steps.map((step) => (
                <tr key={step.id}>
                  <td>{step.id}</td>
                  <td>{step.kind === 'image' ? t('runs.step.image') : t('runs.step.video')}</td>
                  <td>{t(STEP_STATUS_KEYS[step.status] ?? 'runs.step.pending')}</td>
                  <td>{step.attempt}</td>
                  <td className="wb-note">
                    {step.outputAssetId === undefined ? '—' : step.outputAssetId.slice(0, 14)}
                  </td>
                  <td className="wb-note">
                    {step.error === undefined
                      ? ''
                      : step.error}
                    {/* S9-D：失败步重试（failed 会话）；确认档重出首帧（awaiting-confirmation 的 image 步） */}
                    {detail.state === 'failed' && step.status === 'failed' ? (
                      <button
                        type="button"
                        className="wb-btn lib-icon"
                        style={{ marginLeft: 8 }}
                        disabled={busy}
                        onClick={() => void act(() => retryCreationRunStep(detail.id, step.id))}
                      >
                        {t('runs.action.retry')}
                      </button>
                    ) : null}
                    {detail.state === 'awaiting-confirmation' && step.kind === 'image' && step.status === 'succeeded' ? (
                      <button
                        type="button"
                        className="wb-btn lib-icon"
                        style={{ marginLeft: 8 }}
                        disabled={busy}
                        title={t('runs.action.redoHint')}
                        onClick={() => void act(() => retryCreationRunStep(detail.id, step.id))}
                      >
                        {t('runs.action.redo')}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
