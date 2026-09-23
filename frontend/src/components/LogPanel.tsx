import { useCallback, useEffect, useMemo, useState } from 'react';
import { LOG_ACTIONS, logActionLabel } from '@astrmira/shared';
import type { EventLogEntry, LogListResponse } from '@astrmira/shared';
import { ApiError, clearLogs, deleteLog, fetchLogs } from '../lib/api';
import { Eyebrow } from './Eyebrow';

/**
 * 操作日志（CONTRACT §10，V2.1）—— 顶栏「日志」打开的全屏页。
 *
 * 定位（用户 2026-09-23 拍板）：**给开发者排错用**，所以三个取舍都偏向"一眼能定位"：
 * 1. **明文 IP + 一行一条**：能直接看出"哪个访客在什么时候做了什么"；
 * 2. **requestId 可搜**：界面上报错时把它发给开发者，这里一搜即中（服务端同时回写 `x-request-id`）；
 * 3. **自动刷新 3s**：另一台机器复现问题时，这边能实时看到 —— 但**可关闭**，
 *    免得开发者在翻历史时列表一直跳。
 *
 * 权限：用户明确"全都可看、不加额外权限"，因此本组件不做任何角色判断
 * （公网仍有 Caddy 登录 + `PUBLIC_API_TOKEN` 两层，见 PLAN §7-4）。
 */

type RangeKey = '1h' | '24h' | '7d' | 'all';

const RANGE_LABELS: Record<RangeKey, string> = {
  '1h': '最近 1 小时',
  '24h': '最近 24 小时',
  '7d': '最近 7 天',
  all: '全部',
};

const RANGE_MS: Record<Exclude<RangeKey, 'all'>, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

const PAGE_SIZE = 50;

export interface LogPanelProps {
  onClose: () => void;
}

function formatTime(ts: number): string {
  const date = new Date(ts);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function statusClass(statusCode: number | undefined): string {
  if (statusCode === undefined) return 'wb-log-status';
  if (statusCode >= 500) return 'wb-log-status wb-log-status-bad';
  if (statusCode >= 400) return 'wb-log-status wb-log-status-warn';
  return 'wb-log-status wb-log-status-ok';
}

function describeFailure(error: unknown): string {
  if (error instanceof ApiError) return error.failure.message;
  return error instanceof Error ? error.message : String(error);
}

export function LogPanel({ onClose }: LogPanelProps) {
  const [range, setRange] = useState<RangeKey>('24h');
  const [ip, setIp] = useState('');
  const [action, setAction] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<LogListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useMemo(
    () => ({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      ...(ip.trim() === '' ? {} : { ip: ip.trim() }),
      ...(action === '' ? {} : { action }),
      ...(errorCode.trim() === '' ? {} : { errorCode: errorCode.trim() }),
      ...(keyword.trim() === '' ? {} : { q: keyword.trim() }),
      ...(range === 'all' ? {} : { since: Date.now() - RANGE_MS[range] }),
    }),
    [ip, action, errorCode, keyword, range, page],
  );

  const reload = useCallback(async (): Promise<void> => {
    try {
      setData(await fetchLogs(query));
      setError(null);
    } catch (caught) {
      setError(describeFailure(caught));
    }
  }, [query]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 自动刷新：关掉它才不会在翻历史时被列表跳动打断
  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = window.setInterval(() => void reload(), 3_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, reload]);

  async function handleDelete(id: number): Promise<void> {
    setBusy(true);
    try {
      await deleteLog(id);
      await reload();
    } catch (caught) {
      setError(describeFailure(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleClear(): Promise<void> {
    // 清空 = 清掉**你正看到的这批**：有筛选就按筛选清，没筛选才是全清（避免"以为只清了一批、其实全没了"）
    const hasFilters =
      ip.trim() !== '' ||
      action !== '' ||
      errorCode.trim() !== '' ||
      keyword.trim() !== '' ||
      range !== 'all';
    const scope = hasFilters ? '当前筛选条件下的' : '全部';
    if (!window.confirm(`确定要清空${scope}操作日志吗？此操作不可撤销。`)) return;

    setBusy(true);
    try {
      const { deleted } = await clearLogs(query);
      setError(deleted === 0 ? '没有匹配的日志可清空' : null);
      setPage(0);
      await reload();
    } catch (caught) {
      setError(describeFailure(caught));
    } finally {
      setBusy(false);
    }
  }

  const total = data?.total ?? 0;
  const items = data?.items ?? [];
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <div className="wb-log-overlay" role="dialog" aria-modal="true" aria-label="操作日志">
      <div className="wb-log-panel">
        <div className="wb-log-head">
          <div className="wb-log-title">
            <Eyebrow tone="gold">操作日志</Eyebrow>
            <span className="wb-note">
              共 {total} 条 · 只记写操作与失败请求（`/media`、`/api/health`、日志页自身不记，避免自我污染）
            </span>
          </div>
          <div className="wb-log-head-actions">
            <label className="wb-checkbox wb-checkbox-inline">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(event) => setAutoRefresh(event.target.checked)}
              />
              <span>自动刷新 3s</span>
            </label>
            <button type="button" className="wb-btn" onClick={() => void reload()} disabled={busy}>
              刷新
            </button>
            <button type="button" className="wb-btn" onClick={() => void handleClear()} disabled={busy}>
              清空
            </button>
            <button type="button" className="wb-btn wb-btn-gold" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>

        <div className="wb-log-filters">
          <label className="wb-field wb-field-inline">
            <span className="wb-label">时间范围</span>
            <select
              className="wb-input"
              value={range}
              onChange={(event) => {
                setRange(event.target.value as RangeKey);
                setPage(0);
              }}
            >
              {(Object.keys(RANGE_LABELS) as RangeKey[]).map((key) => (
                <option key={key} value={key}>
                  {RANGE_LABELS[key]}
                </option>
              ))}
            </select>
          </label>

          <label className="wb-field wb-field-inline">
            <span className="wb-label">动作</span>
            <select
              className="wb-input"
              value={action}
              onChange={(event) => {
                setAction(event.target.value);
                setPage(0);
              }}
            >
              <option value="">全部动作</option>
              {LOG_ACTIONS.map((value) => (
                <option key={value} value={value}>
                  {logActionLabel(value)}
                </option>
              ))}
            </select>
          </label>

          <label className="wb-field wb-field-inline">
            <span className="wb-label">来源 IP</span>
            <input
              className="wb-input wb-input-mono"
              value={ip}
              placeholder="精确匹配"
              onChange={(event) => {
                setIp(event.target.value);
                setPage(0);
              }}
            />
          </label>

          <label className="wb-field wb-field-inline">
            <span className="wb-label">错误码</span>
            <input
              className="wb-input wb-input-mono"
              value={errorCode}
              placeholder="如 UPSTREAM_ERROR"
              onChange={(event) => {
                setErrorCode(event.target.value);
                setPage(0);
              }}
            />
          </label>

          <label className="wb-field wb-field-inline wb-log-keyword">
            <span className="wb-label">关键词</span>
            <input
              className="wb-input"
              value={keyword}
              placeholder="requestId / 路径 / 请求体 / 上游 Request id"
              onChange={(event) => {
                setKeyword(event.target.value);
                setPage(0);
              }}
            />
          </label>
        </div>

        {error === null ? null : <span className="wb-warn wb-log-error">{error}</span>}

        <div className="wb-log-list">
          {items.length === 0 ? (
            <span className="wb-note">没有匹配的记录。换个时间范围或清掉筛选试试。</span>
          ) : (
            items.map((entry) => (
              <LogRow
                key={entry.id}
                entry={entry}
                expanded={expanded === entry.id}
                onToggle={() => setExpanded(expanded === entry.id ? null : entry.id)}
                onDelete={() => void handleDelete(entry.id)}
                busy={busy}
              />
            ))
          )}
        </div>

        <div className="wb-log-foot">
          <button
            type="button"
            className="wb-btn"
            disabled={page === 0}
            onClick={() => setPage((value) => Math.max(0, value - 1))}
          >
            上一页
          </button>
          <span className="wb-note">
            第 {page + 1} / {maxPage + 1} 页
          </span>
          <button
            type="button"
            className="wb-btn"
            disabled={page >= maxPage}
            onClick={() => setPage((value) => value + 1)}
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  );
}

interface LogRowProps {
  entry: EventLogEntry;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  busy: boolean;
}

function LogRow({ entry, expanded, onToggle, onDelete, busy }: LogRowProps) {
  return (
    <div className={`wb-log-row${expanded ? ' wb-log-row-open' : ''}`}>
      <button type="button" className="wb-log-row-main" onClick={onToggle}>
        <span className="wb-log-time">{formatTime(entry.ts)}</span>
        <span className={statusClass(entry.statusCode)}>{entry.statusCode ?? '—'}</span>
        <span className="wb-log-action">{logActionLabel(entry.action)}</span>
        <span className="wb-log-path">
          {entry.method} {entry.path}
        </span>
        <span className="wb-log-ip">{entry.ip ?? '—'}</span>
        <span className="wb-log-meta">
          {entry.durationMs === undefined ? '' : `${entry.durationMs}ms`}
          {entry.errorCode === undefined ? '' : ` · ${entry.errorCode}`}
          {entry.taskId === undefined ? '' : ` · ${entry.taskId.slice(0, 8)}`}
        </span>
      </button>

      <button type="button" className="wb-btn wb-log-del" onClick={onDelete} disabled={busy}>
        删除
      </button>

      {expanded ? (
        <div className="wb-log-detail">
          <span className="wb-note">
            requestId {entry.requestId ?? '—'} · provider {entry.provider ?? '—'} · disposition{' '}
            {entry.disposition ?? '—'}
          </span>
          {entry.userAgent === undefined ? null : (
            <span className="wb-note">UA {entry.userAgent}</span>
          )}
          {entry.body === undefined ? null : (
            <>
              <span className="wb-label">请求体</span>
              <pre className="wb-log-pre">{entry.body}</pre>
            </>
          )}
          {entry.detail === undefined ? null : (
            <>
              <span className="wb-label">诊断字段</span>
              <pre className="wb-log-pre">{JSON.stringify(entry.detail, null, 2)}</pre>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
