import React, { useCallback, useEffect, useState } from 'react';
import type { CostSummaryResponse } from '@astrmira/shared';
import { Eyebrow } from '../components/Eyebrow';
import { ApiError, fetchCostSummary } from '../lib/api';
import {
  COST_RANGE_OPTIONS,
  costRangeWindow,
  describeBudget,
  describeCostBucket,
  describeCostHeadline,
  type CostRangeKey,
} from '../lib/costView';
import { useTranslate } from '../lib/i18n';
import { useShell } from '../lib/shell';

/**
 * 成本台账（V2.12 / 台账 B48 片 B）。
 *
 * ## 这个页面最容易犯的错，就是"只显示一个金额"
 * 一个孤零零的「¥128」会被读成"就这么多了"。所以页面上的数字**成组出现**：
 * 已结算 N 条 / 未结算 N 条（老任务，未计入金额）/ 不确定 N 条（**可能已经花了钱**）。
 * 这三条是契约 §13 的要求，不是界面偏好。
 *
 * ## 两条范围口径
 * - **当前项目**（默认）：与全站同一个"我在哪个项目里"的心智模型；
 * - **全部项目**：只有这里刻意允许跨项目 —— "这台机器一共花了多少"是部署方的问题。
 *   **月度预算也只在这一档出现**（项目花费 vs 全局预算是两个口径，放一起只会误导）。
 *
 * ## 免责声明由**服务端下发**
 * 界面直接显示响应里的 `disclaimer`，不自己写一版（一处措辞 = 一处维护，
 * 而"以账单为准"这句话不允许被改弱）。
 */
export function CostsView() {
  const { projectId, projects } = useShell();
  const t = useTranslate();
  const [scope, setScope] = useState<'project' | 'all'>('project');
  const [range, setRange] = useState<CostRangeKey>('30d');
  const [summary, setSummary] = useState<CostSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const window = costRangeWindow(range);
      const data = await fetchCostSummary({
        project: scope === 'all' ? 'all' : projectId,
        ...window,
      });
      setSummary(data);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }, [scope, range, projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const activeProject = projects.find((project) => project.projectId === projectId) ?? null;
  const headline = summary === null ? null : describeCostHeadline(summary);
  const budget = summary === null ? null : describeBudget(summary.budget);

  return (
    <section className="wb-page">
      <div className="wb-page-head wb-page-head-row">
        <div>
          <h1 className="wb-page-title">{t('costs.title')}</h1>
          <Eyebrow tone="gold">Cost Ledger</Eyebrow>
        </div>
        <button type="button" className="wb-btn" onClick={() => void reload()} disabled={loading}>
          {t(loading ? 'costs.refresh.loading' : 'costs.refresh.label')}
        </button>
      </div>

      {/* 范围与区间（两个分段控件；"全部项目"是本页独有的能力） */}
      <div className="cost-controls">
        <div className="wb-segmented wb-segmented-compact" role="group" aria-label={t('costs.scope.aria')}>
          <button
            type="button"
            className="wb-segment"
            aria-pressed={scope === 'project'}
            onClick={() => setScope('project')}
          >
            {activeProject === null
              ? t('costs.scope.project')
              : t('costs.scope.projectNamed', { name: activeProject.name })}
          </button>
          <button
            type="button"
            className="wb-segment"
            aria-pressed={scope === 'all'}
            onClick={() => setScope('all')}
          >
            {t('costs.scope.allProjects')}
          </button>
        </div>

        <div className="wb-segmented wb-segmented-compact" role="group" aria-label={t('costs.range.aria')}>
          {COST_RANGE_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              className="wb-segment"
              aria-pressed={range === option.key}
              onClick={() => setRange(option.key)}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {error === null ? null : (
        <div className="wb-uncertain" style={{ marginBottom: 14 }}>
          <span className="wb-uncertain-title">{t('costs.load.error')}</span>
          <span className="wb-uncertain-body">{error}</span>
        </div>
      )}

      {/* 数据未到位时先骨架，**不显示 0 / — 这类看起来像真实数据的占位值**（与总览同纪律） */}
      <div className="ov-kpis">
        {summary === null && loading ? (
          Array.from({ length: 4 }, (_, index) => <div key={index} className="wb-skeleton" />)
        ) : summary === null || headline === null ? null : (
          <>
            <article className="ov-kpi">
              <span className="ov-kpi-label">{t('costs.kpi.estimate')}</span>
              <span className="ov-kpi-value">{headline.total}</span>
              <span className="ov-kpi-foot">{headline.detail}</span>
            </article>
            <article className="ov-kpi">
              <span className="ov-kpi-label">{t('costs.kpi.tasks')}</span>
              <span className="ov-kpi-value">
                {summary.taskCount}
                <small>{t('costs.kpi.unit')}</small>
              </span>
              <span className="ov-kpi-foot">{t('costs.kpi.tasksFoot')}</span>
            </article>
            <article className="ov-kpi">
              <span className="ov-kpi-label">{t('costs.kpi.unsettled')}</span>
              <span className="ov-kpi-value">
                {summary.unsettledCount}
                <small>{t('costs.kpi.unit')}</small>
              </span>
              <span className="ov-kpi-foot">
                {t(
                  summary.unsettledCount === 0
                    ? 'costs.kpi.unsettledFootNone'
                    : 'costs.kpi.unsettledFootSome',
                )}
              </span>
            </article>
            <article className="ov-kpi">
              <span className="ov-kpi-label">{t('costs.kpi.uncertain')}</span>
              <span className="ov-kpi-value">
                {summary.uncertainCount}
                <small>{t('costs.kpi.unit')}</small>
              </span>
              <span className="ov-kpi-foot">{t('costs.kpi.uncertainFoot')}</span>
            </article>
          </>
        )}
      </div>

      {summary === null || headline === null ? null : (
        <>
          {/* 未结算 / 不确定的说明 —— 有就必须说，没有就不硬凑（噪声纪律） */}
          {headline.unsettledNote === null ? null : (
            <p className="wb-note cost-note">{headline.unsettledNote}</p>
          )}
          {headline.uncertainNote === null ? null : (
            <p className="wb-note cost-note cost-note-warn">{headline.uncertainNote}</p>
          )}

          {budget === null ? null : (
            <section className="wb-panel cost-panel">
              <div className="wb-field-head">
                <Eyebrow index={1} tone="gold" as="h2">
                  {t('costs.budget.title')}
                </Eyebrow>
                <span className="wb-note">{budget.text}</span>
              </div>
              <div className="cost-budget-bar" role="img" aria-label={budget.text}>
                <div
                  className={`cost-budget-fill${budget.over ? ' cost-budget-fill-over' : ''}`}
                  style={{ width: `${Math.round(budget.ratio * 100)}%` }}
                />
              </div>
              {budget.over ? (
                <p className="wb-note cost-note-warn">{t('costs.budget.over')}</p>
              ) : null}
            </section>
          )}

          <section className="wb-panel cost-panel">
            <div className="wb-field-head">
              <Eyebrow index={2} tone="gold" as="h2">
                {t('costs.byProject.title')}
              </Eyebrow>
              <span className="wb-note">{t('costs.byProject.note')}</span>
            </div>
            <CostBucketList
              buckets={summary.byProject}
              emptyText={t('costs.bucket.empty')}
            />
          </section>

          <section className="wb-panel cost-panel">
            <div className="wb-field-head">
              <Eyebrow index={3} tone="gold" as="h2">
                {t('costs.byDay.title')}
              </Eyebrow>
              <span className="wb-note">{t('costs.byDay.note')}</span>
            </div>
            <CostBucketList buckets={summary.byDay} emptyText={t('costs.bucket.empty')} />
          </section>

          <section className="wb-panel cost-panel">
            <div className="wb-field-head">
              <Eyebrow index={4} tone="gold" as="h2">
                {t('costs.byModel.title')}
              </Eyebrow>
              <span className="wb-note">{t('costs.byModel.note')}</span>
            </div>
            <CostBucketList buckets={summary.byModel} emptyText={t('costs.bucket.empty')} />
          </section>

          {/* 口径说明：**原样显示服务端下发的文案**（界面不许自己写一版） */}
          <p className="wb-note cost-disclaimer">{summary.disclaimer}</p>
        </>
      )}
    </section>
  );
}

const CostBucketList: React.FC<{
  buckets: CostSummaryResponse['byProject'];
  emptyText: string;
}> = ({ buckets, emptyText }) => {
  if (buckets.length === 0) return <p className="wb-note">{emptyText}</p>;
  return (
    <ul className="cost-bucket-list">
      {buckets.map((bucket) => (
        <li key={bucket.key}>
          <span className="cost-bucket-label" title={bucket.key}>
            {bucket.label}
          </span>
          <span className="wb-note">{describeCostBucket(bucket)}</span>
        </li>
      ))}
    </ul>
  );
};

function describeError(caught: unknown): string {
  if (caught instanceof ApiError) {
    const code = caught.failure.code === undefined ? '' : `【${caught.failure.code}】`;
    return `${code}${caught.failure.message}`;
  }
  return caught instanceof Error ? caught.message : String(caught);
}
