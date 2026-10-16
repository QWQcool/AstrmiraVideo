import { useCallback, useEffect, useMemo, useState } from 'react';
import { LOG_ACTIONS } from '@astrmira/shared';
import { logActionLabel } from '../lib/format';
import type { EventLogEntry, LogListResponse } from '@astrmira/shared';
import { ApiError, clearLogs, deleteLog, fetchLogs } from '../lib/api';
import { Eyebrow } from '../components/Eyebrow';
import { useTranslate, type MessageKey } from '../lib/i18n';

/**
 * 操作日志（V9 · B5；CONTRACT §10）。
 *
 * 定位（用户 2026-09-23 拍板）：**给开发者排错用**，所以三个取舍都偏向"一眼能定位"：
 * 1. **明文 IP + 一行一条**：能直接看出"哪个访客在什么时候做了什么"；
 * 2. **requestId 可搜**：界面上报错时把它发给开发者，这里一搜即中（服务端同时回写 `x-request-id`）；
 * 3. **自动刷新 3s**：另一台机器复现问题时，这边能实时看到 —— 但**可关闭**，
 *    免得开发者在翻历史时列表一直跳。
 *
 * B5 的改动**只在壳**：从顶栏弹层升级为一级视图（D33）——组件主体（状态 / 过滤 / 分页 /
 * 删除 / LogRow）一行未改，只是去掉弹层背板、换成页面头，并把原来的"关闭"换成"导出 JSON"。
 * 侧栏的红点由壳统计（`errorLogCount`），不在本视图里做。
 *
 * 权限：用户明确"全都可看、不加额外权限"，因此本组件不做任何角色判断
 * （公网仍有 Caddy 登录 + `PUBLIC_API_TOKEN` 两层，见 PLAN §7-4）。
 */

type RangeKey = '1h' | '24h' | '7d' | 'all';

/**
 * 时间范围档位的**键表**（语言迁移第十四批）。
 *
 * 与 `lib/libraryFilter.ts` / `lib/costView.ts` 同一处理：模块级常量只留"取值 → 键"，
 * 显示名在渲染时取（否则语言在模块加载那一刻就定死了）。
 * ⚠️ 键名的段**不能以数字开头**（字典单测的"键名规范"），所以是 `hour1` / `day7` 而不是 `1h` / `7d`。
 */
const RANGE_LABEL_KEYS: Record<RangeKey, MessageKey> = {
  '1h': 'logs.range.hour1',
  '24h': 'logs.range.hour24',
  '7d': 'logs.range.day7',
  all: 'logs.range.all',
};

const RANGE_MS: Record<Exclude<RangeKey, 'all'>, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

const PAGE_SIZE = 50;

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

export function LogsView() {
  const t = useTranslate();
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
    const scope = t(hasFilters ? 'logs.clear.scopeFiltered' : 'logs.clear.scopeAll');
    if (!window.confirm(t('logs.clear.confirm', { scope }))) return;

    setBusy(true);
    try {
      const { deleted } = await clearLogs(query);
      setError(deleted === 0 ? t('logs.clear.none') : null);
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

  /**
   * 导出当前**筛选结果**为 JSON（V9 · B5 补）。
   *
   * 为什么要它：排错时最常见的动作就是"把这段日志发给别人看"——
   * 截图会丢字段、复制粘贴会丢结构。导出的是**当前筛选下的这一页**（与服务端返回的一致），
   * 文件名带时间戳；用完立刻 revoke（延迟一拍，避免浏览器还没开始下载就失效）。
   */
  function handleExport(): void {
    const payload = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        query,
        total,
        items,
      },
      null,
      2,
    );
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `astrmira-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return (
    <section className="wb-page">
      <div className="wb-page-head wb-page-head-row">
        <div>
          <h1 className="wb-page-title">{t('logs.title')}</h1>
          <Eyebrow tone="gold">Logs</Eyebrow>
        </div>
      </div>

      <div className="wb-log-panel">
        <div className="wb-log-head">
          <div className="wb-log-title">
            <span className="wb-label">{t('logs.records.label')}</span>
            <span className="wb-note">{t('logs.records.summary', { total })}</span>
          </div>
          <div className="wb-log-head-actions">
            <label className="wb-checkbox wb-checkbox-inline">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(event) => setAutoRefresh(event.target.checked)}
              />
              <span>{t('logs.autoRefresh')}</span>
            </label>
            <button type="button" className="wb-btn" onClick={() => void reload()} disabled={busy}>
              {t('logs.refresh')}
            </button>
            <button type="button" className="wb-btn" onClick={() => void handleClear()} disabled={busy}>
              {t('logs.clear')}
            </button>
            <button
              type="button"
              className="wb-btn wb-btn-gold"
              onClick={handleExport}
              disabled={items.length === 0}
            >
              {t('logs.export')}
            </button>
          </div>
        </div>

        <div className="wb-log-filters">
          <label className="wb-field wb-field-inline">
            <span className="wb-label">{t('logs.range.aria')}</span>
            <select
              className="wb-input"
              value={range}
              onChange={(event) => {
                setRange(event.target.value as RangeKey);
                setPage(0);
              }}
            >
              {(Object.keys(RANGE_LABEL_KEYS) as RangeKey[]).map((key) => (
                <option key={key} value={key}>
                  {t(RANGE_LABEL_KEYS[key])}
                </option>
              ))}
            </select>
          </label>

          <label className="wb-field wb-field-inline">
            <span className="wb-label">{t('logs.filter.action')}</span>
            <select
              className="wb-input"
              value={action}
              onChange={(event) => {
                setAction(event.target.value);
                setPage(0);
              }}
            >
              <option value="">{t('logs.filter.allActions')}</option>
              {LOG_ACTIONS.map((value) => (
                <option key={value} value={value}>
                  {logActionLabel(value)}
                </option>
              ))}
            </select>
          </label>

          <label className="wb-field wb-field-inline">
            <span className="wb-label">{t('logs.filter.ip')}</span>
            <input
              className="wb-input wb-input-mono"
              value={ip}
              placeholder={t('logs.filter.ipPlaceholder')}
              onChange={(event) => {
                setIp(event.target.value);
                setPage(0);
              }}
            />
          </label>

          <label className="wb-field wb-field-inline">
            <span className="wb-label">{t('logs.filter.errorCode')}</span>
            <input
              className="wb-input wb-input-mono"
              value={errorCode}
              placeholder={t('logs.filter.errorCodePlaceholder')}
              onChange={(event) => {
                setErrorCode(event.target.value);
                setPage(0);
              }}
            />
          </label>

          <label className="wb-field wb-field-inline wb-log-keyword">
            <span className="wb-label">{t('logs.filter.keyword')}</span>
            <input
              className="wb-input"
              value={keyword}
              placeholder={t('logs.filter.keywordPlaceholder')}
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
            <span className="wb-note">{t('logs.empty')}</span>
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
            {t('logs.pager.prev')}
          </button>
          <span className="wb-note">
            {t('logs.pager.page', { page: page + 1, max: maxPage + 1 })}
          </span>
          <button
            type="button"
            className="wb-btn"
            disabled={page >= maxPage}
            onClick={() => setPage((value) => value + 1)}
          >
            {t('logs.pager.next')}
          </button>
        </div>
      </div>
    </section>
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
  const t = useTranslate();
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
        {t('logs.row.delete')}
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
              <span className="wb-label">{t('logs.detail.requestBody')}</span>
              <pre className="wb-log-pre">{entry.body}</pre>
            </>
          )}
          {entry.detail === undefined ? null : (
            <>
              <span className="wb-label">{t('logs.detail.diagnostics')}</span>
              <pre className="wb-log-pre">{JSON.stringify(entry.detail, null, 2)}</pre>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
