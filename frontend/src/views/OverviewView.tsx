import { useCallback, useEffect, useMemo, useState } from 'react';
import { logActionLabel } from '@astrmira/shared';
import type { EventLogEntry, HistoryResponse, StorageUsage } from '@astrmira/shared';
import { Eyebrow } from '../components/Eyebrow';
import { ApiError, fetchHistory, fetchLogs } from '../lib/api';
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
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [logs, setLogs] = useState<EventLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [historyData, logsData] = await Promise.all([fetchHistory(), fetchLogs({ limit: 50 })]);
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
  }, []);

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
          <h1 className="wb-page-title">总览</h1>
          <Eyebrow tone="gold">Overview</Eyebrow>
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

      <div className="ov-kpis">
        <article className="ov-kpi">
          <span className="ov-kpi-label">今日生成</span>
          <span className="ov-kpi-value">
            {stats.todayCount}
            <small>条</small>
          </span>
          <span className="ov-kpi-foot">今日 0:00 起（本地时区）</span>
        </article>

        <article className="ov-kpi">
          <span className="ov-kpi-label">成功率</span>
          <span className="ov-kpi-value">
            {stats.successRate === null ? '—' : Math.round(stats.successRate * 100)}
            {stats.successRate === null ? null : <small>%</small>}
          </span>
          <span className="ov-kpi-foot">
            {stats.settledCount === 0
              ? '还没有终态任务'
              : `最近 50 条里的 ${stats.settledCount} 条终态任务`}
          </span>
        </article>

        <article className="ov-kpi">
          <span className="ov-kpi-label">队列中</span>
          <span className="ov-kpi-value">
            {stats.inFlight}
            <small>条</small>
          </span>
          <span className="ov-kpi-foot">等待或生成中</span>
        </article>

        <article className="ov-kpi">
          <span className="ov-kpi-label">存储占用</span>
          <span className="ov-kpi-value">{formatBytes(stats.storage.totalBytes)}</span>
          <span className="ov-kpi-foot">
            成片 {stats.storage.videoCount} 支 · 素材 {stats.storage.assetCount} 张
            <a className="ov-kpi-link" href="#/library?sort=size">
              去清理 →
            </a>
          </span>
        </article>
      </div>

      <div className="ov-body">
        <section className="ov-panel">
          <div className="ov-panel-head">
            <Eyebrow index={1}>最近成片</Eyebrow>
            <a className="wb-note" href="#/library">
              查看全部 →
            </a>
          </div>
          {shots.length === 0 ? (
            <p className="wb-note">
              还没有成片。到 <a href="#/workbench">生成工作台</a> 提交第一条任务吧。
            </p>
          ) : (
            <div className="ov-shots">
              {shots.map((shot) => (
                <a key={shot.taskId} className="ov-shot" href="#/library" title={shot.taskId}>
                  {shot.thumbnailUrl === undefined ? (
                    <span className="ov-shot-empty">无封面</span>
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
            <Eyebrow index={2}>最近操作</Eyebrow>
            <a className="wb-note" href="#/logs">
              全部 →
            </a>
          </div>
          {feed.length === 0 ? (
            <p className="wb-note">还没有操作记录（只记写操作与失败请求）。</p>
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
