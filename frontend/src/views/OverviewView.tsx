import { useCallback, useEffect, useMemo, useState } from 'react';
import { logActionLabel } from '@astrmira/shared';
import type { EventLogEntry, HistoryResponse, StorageUsage } from '@astrmira/shared';
import { Eyebrow } from '../components/Eyebrow';
import { ApiError, fetchHistory, fetchLogs } from '../lib/api';
import { useTranslate } from '../lib/i18n';
import { useShell } from '../lib/shell';
import { staggerStyle } from '../lib/motion';
import {
  buildActivityFeed,
  computeOverviewStats,
  formatBytes,
  formatRelativeTime,
  recentShots,
} from '../lib/overviewStats';

/**
 * 总览（V9 · B3）。
 *
 * 数据**全部来自现有 API**（`/api/history` + `/api/logs`），不新增后端路由；
 * 四卡的口径由 `lib/overviewStats` 的纯函数决定，每张卡在界面上写清它算的是什么
 * （Step 6-AC2："不许出现算不出来的指标"）。
 *
 * 为什么不轮询：总览是"看一眼"的地方。进视图拉一次 + 手动刷新即可，
 * 真正的实时性需求在生成工作台（那里有 2s 轮询）。
 */

const EMPTY_STORAGE: StorageUsage = {
  totalBytes: 0,
  videoBytes: 0,
  videoCount: 0,
  thumbBytes: 0,
  assetBytes: 0,
  assetCount: 0,
};

function describeError(caught: unknown): string {
  if (caught instanceof ApiError) {
    const code = caught.failure.code === undefined ? '' : `【${caught.failure.code}】`;
    return `${code}${caught.failure.message}`;
  }
  return caught instanceof Error ? caught.message : String(caught);
}

export function OverviewView() {
  // V2.11（B47）：总览也按项目统计（"我在哪个项目里"是全局上下文，见 lib/shell.ts）
  const { projectId } = useShell();
  const t = useTranslate();
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [logs, setLogs] = useState<EventLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [historyData, logsData] = await Promise.all([
        fetchHistory({ project: projectId }),
        fetchLogs({ limit: 50 }),
      ]);
      setHistory(historyData);
      setLogs(logsData.items);
      setError(null);
      // 用"数据到达的时刻"算"今日"与相对时间，避免与渲染时刻错位（同一批数据反复渲染不该跳数字）
      setNow(Date.now());
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const stats = useMemo(
    () => computeOverviewStats(history?.items ?? [], history?.storage ?? EMPTY_STORAGE, now),
    [history, now],
  );
  const shots = useMemo(() => recentShots(history?.items ?? []), [history]);
  const feed = useMemo(() => buildActivityFeed(logs, logActionLabel), [logs]);

  return (
    <section className="wb-page">
      <div className="wb-page-head wb-page-head-row">
        <div>
          <h1 className="wb-page-title">{t('overview.title')}</h1>
          <Eyebrow tone="gold">Overview</Eyebrow>
        </div>
        <button type="button" className="wb-btn" onClick={() => void reload()} disabled={loading}>
          {t(loading ? 'overview.refresh.loading' : 'overview.refresh.label')}
        </button>
      </div>

      {error === null ? null : (
        <div className="wb-uncertain" style={{ marginBottom: 14 }}>
          <span className="wb-uncertain-title">{t('overview.load.error')}</span>
          <span className="wb-uncertain-body">{error}</span>
        </div>
      )}

      {/* B6：数据未到位时先显示骨架，**不显示 0 / — 这类看起来像真实数据的占位值** */}
      <div className="ov-kpis">
        {history === null && loading ? (
          Array.from({ length: 4 }, (_, index) => <div key={index} className="wb-skeleton" />)
        ) : (
          <>
            <article className="ov-kpi" style={staggerStyle(0)}>
              <span className="ov-kpi-label">{t('overview.kpi.today')}</span>
              <span className="ov-kpi-value">
                {stats.todayCount}
                <small>{t('overview.kpi.unit')}</small>
              </span>
              <span className="ov-kpi-foot">{t('overview.kpi.todayFoot')}</span>
            </article>

            <article className="ov-kpi" style={staggerStyle(1)}>
              <span className="ov-kpi-label">{t('overview.kpi.successRate')}</span>
              <span className="ov-kpi-value">
                {stats.successRate === null ? '—' : Math.round(stats.successRate * 100)}
                {stats.successRate === null ? null : <small>%</small>}
              </span>
              <span className="ov-kpi-foot">
                {stats.settledCount === 0
                  ? t('overview.kpi.successFootNone')
                  : t('overview.kpi.successFootSome', { count: stats.settledCount })}
              </span>
            </article>

            <article className="ov-kpi" style={staggerStyle(2)}>
              <span className="ov-kpi-label">{t('overview.kpi.inFlight')}</span>
              <span className="ov-kpi-value">
                {stats.inFlight}
                <small>{t('overview.kpi.unit')}</small>
              </span>
              <span className="ov-kpi-foot">{t('overview.kpi.inFlightFoot')}</span>
            </article>

            <article className="ov-kpi" style={staggerStyle(3)}>
              <span className="ov-kpi-label">{t('overview.kpi.storage')}</span>
              <span className="ov-kpi-value">{formatBytes(stats.storage.totalBytes)}</span>
              <span className="ov-kpi-foot">
                {t('overview.kpi.storageFoot', {
                  videos: stats.storage.videoCount,
                  assets: stats.storage.assetCount,
                })}
                <a className="ov-kpi-link" href="#/library?sort=size">
                  {t('overview.kpi.storageLink')}
                </a>
              </span>
            </article>
          </>
        )}
      </div>

      <div className="ov-body">
        <section className="ov-panel">
          <div className="ov-panel-head">
            <Eyebrow index={1}>{t('overview.shots.title')}</Eyebrow>
            <a className="wb-note" href="#/library">
              {t('overview.shots.all')}
            </a>
          </div>
          {history === null && loading ? (
            <div className="ov-shots">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="wb-skeleton" style={{ aspectRatio: '16 / 9' }} />
              ))}
            </div>
          ) : shots.length === 0 ? (
            <p className="wb-note">
              {t('overview.shots.emptyBefore')}
              <a href="#/workbench">{t('overview.shots.emptyLink')}</a>
              {t('overview.shots.emptyAfter')}
            </p>
          ) : (
            <div className="ov-shots">
              {shots.map((shot, index) => (
                <a
                  key={shot.taskId}
                  className="ov-shot"
                  href={`#/library?task=${encodeURIComponent(shot.taskId)}`}
                  title={shot.taskId}
                  style={staggerStyle(index)}
                >
                  {shot.thumbnailUrl === undefined ? (
                    <span className="ov-shot-empty">{t('overview.shots.noCover')}</span>
                  ) : (
                    <img src={shot.thumbnailUrl} alt="" loading="lazy" />
                  )}
                  {shot.durationLabel === undefined ? null : (
                    <span className="ov-shot-dur">{shot.durationLabel}</span>
                  )}
                </a>
              ))}
            </div>
          )}
        </section>

        <aside className="ov-panel">
          <div className="ov-panel-head">
            <Eyebrow index={2}>{t('overview.feed.title')}</Eyebrow>
            <a className="wb-note" href="#/logs">
              {t('overview.feed.all')}
            </a>
          </div>
          {feed.length === 0 ? (
            <p className="wb-note">{t('overview.feed.empty')}</p>
          ) : (
            <div className="ov-feed">
              {feed.map((entry) => (
                <a key={entry.id} className="ov-feed-row" href="#/logs">
                  <time className="ov-feed-time">{formatRelativeTime(entry.ts, now)}</time>
                  <span className={`ov-dot ov-dot--${entry.tone}`} />
                  <span className="ov-feed-label">{entry.label}</span>
                  {entry.errorCode === undefined ? null : (
                    <span className="ov-feed-code">{entry.errorCode}</span>
                  )}
                </a>
              ))}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
