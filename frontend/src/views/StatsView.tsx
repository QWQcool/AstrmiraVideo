import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { ComfyLinkStats, StatsSummaryResponse } from '@astrmira/shared';
import { ApiError, fetchStatsSummary } from '../lib/api';
import { providerLabel } from '../lib/engineOptions';
import { Eyebrow } from '../components/Eyebrow';
import { useTranslate, type MessageKey } from '../lib/i18n';
import { useShell } from '../lib/shell';

/** 连接状态 → 文案键（类型化映射：新增状态会编译期报错，不会静默显示原始值） */
const LINK_STATE_KEYS: Record<ComfyLinkStats['state'], MessageKey> = {
  connecting: 'stats.links.state.connecting',
  connected: 'stats.links.state.connected',
  closed: 'stats.links.state.closed',
};

/**
 * 运行观测（V2.90 / D-8；CONTRACT §16 附）。
 *
 * ## 三条口径
 * 1. **只展示服务端给的数字**：耗时口径句直接显示 `durationNote`，界面不自己写一版
 *    （两处各写一份，早晚有一处过期）；
 * 2. **没有样本显示「—」而不是 0**：0 毫秒是假数据；
 * 3. **本地轨成本为 0 要写清原因**：自建算力、无按次计费。把电费/折旧折算成金额
 *    属于编造 —— 这一页不做，也不让读者以为"0 元 = 没数据"。
 *
 * 与成本台账（`#/costs`）分工：那边是金额，这边是速度与失败分布。
 */

function describeError(caught: unknown): string {
  if (caught instanceof ApiError) {
    const code = caught.failure.code === undefined ? '' : `【${caught.failure.code}】`;
    return `${code}${caught.failure.message}`;
  }
  return caught instanceof Error ? caught.message : String(caught);
}

/** 毫秒 → 人看的秒（保留 1 位；null → 「—」由调用方处理） */
function formatMs(value: number | null): string {
  if (value === null) return '—';
  if (value < 1_000) return `${value} ms`;
  return `${(value / 1_000).toFixed(1)} s`;
}

export function StatsView(): ReactNode {
  const t = useTranslate();
  const { providerStatus } = useShell();
  const [data, setData] = useState<StatsSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setData(await fetchStatsSummary());
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

  return (
    <section className="wb-page">
      <div className="wb-page-head wb-page-head-row">
        <div>
          <h1 className="wb-page-title">{t('stats.title')}</h1>
          <Eyebrow tone="gold">Observability</Eyebrow>
        </div>
        <button type="button" className="wb-btn" onClick={() => void reload()} disabled={loading}>
          {t(loading ? 'stats.refreshLoading' : 'stats.refresh')}
        </button>
      </div>

      <p className="wb-note">{t('stats.subtitle')}</p>

      {error === null ? null : (
        <div className="wb-uncertain" style={{ marginBottom: 14 }}>
          <span className="wb-uncertain-title">{t('stats.errorTitle')}</span>
          <span className="wb-uncertain-body">{error}</span>
        </div>
      )}

      {data === null && loading ? <div className="wb-skeleton" /> : null}

      {data !== null ? (
        <>
          <p className="wb-note stats-note">{data.durationNote}</p>
          {data.truncated ? (
            <p className="wb-note stats-note">{t('stats.truncated', { count: data.total })}</p>
          ) : null}

          <section className="ov-panel stats-panel">
            <div className="ov-panel-head">
              <Eyebrow index={1}>{t('stats.providers.title')}</Eyebrow>
            </div>
            {data.byProvider.length === 0 ? (
              <p className="wb-note">{t('stats.empty')}</p>
            ) : (
              <div className="stats-table-wrap">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th scope="col">{t('stats.col.provider')}</th>
                    <th scope="col">{t('stats.col.count')}</th>
                    <th scope="col">{t('stats.col.success')}</th>
                    <th scope="col">{t('stats.col.fail')}</th>
                    <th scope="col">{t('stats.col.unfinished')}</th>
                    <th scope="col">{t('stats.col.p50')}</th>
                    <th scope="col">{t('stats.col.p95')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byProvider.map((row) => (
                    <tr key={row.provider}>
                      <th scope="row">{providerLabel(row.provider, providerStatus)}</th>
                      <td>{row.count}</td>
                      <td>{row.succeeded}</td>
                      <td>{row.failed}</td>
                      <td>{row.unfinished}</td>
                      <td>{formatMs(row.p50Ms)}</td>
                      <td>{formatMs(row.p95Ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </section>

          <section className="ov-panel stats-panel">
            <div className="ov-panel-head">
              <Eyebrow index={2}>{t('stats.codes.title')}</Eyebrow>
            </div>
            {data.failureCodes.length === 0 ? (
              <p className="wb-note">{t('stats.codes.empty')}</p>
            ) : (
              <ul className="stats-codes">
                {data.failureCodes.map((item) => (
                  <li key={item.code} className="stats-code-row">
                    <code>{item.code}</code>
                    <span>{item.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="ov-panel stats-panel">
            <div className="ov-panel-head">
              <Eyebrow index={3}>{t('stats.links.title')}</Eyebrow>
            </div>
            {data.comfyLinks.length === 0 ? (
              <p className="wb-note">{t('stats.links.none')}</p>
            ) : (
              <ul className="stats-codes">
                {data.comfyLinks.map((link) => (
                  <li key={link.baseUrl} className="stats-code-row">
                    <code>{link.baseUrl}</code>
                    <span>
                      {t(LINK_STATE_KEYS[link.state])} ·{' '}
                      {t('stats.links.opens', { count: link.opens })} ·{' '}
                      {t('stats.links.reconnects', { count: link.reconnects })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="ov-panel stats-panel">
            <div className="ov-panel-head">
              <Eyebrow index={4}>{t('stats.cost.title')}</Eyebrow>
            </div>
            <p className="wb-note">{t('stats.cost.body')}</p>
            <a className="wb-note" href="#/costs">
              {t('stats.cost.link')}
            </a>
          </section>
        </>
      ) : null}
    </section>
  );
}
