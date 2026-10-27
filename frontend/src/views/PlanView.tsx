import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CanvasPlan, CanvasPlanNode, TaskProgress } from '@astrmira/shared';
import { fetchTask, resolveMediaUrl, submitGenerate } from '../lib/api';
import { resolveProviderKey } from '../lib/byok';
import { comfyUiEngineOptions, providerLabel } from '../lib/engineOptions';
import { statusLabel } from '../lib/format';
import { useTranslate } from '../lib/i18n';
import { useShell } from '../lib/shell';
import { browserStorage } from '../lib/storage';
import {
  addPlanEdge,
  addPlanNode,
  bumpPlanRun,
  createEmptyPlan,
  loadCanvasPlan,
  newPlanImageNode,
  newPlanNode,
  planExecutionOrder,
  planIncomingEdges,
  planNodeBlockReason,
  planRunSeq,
  removePlanEdge,
  removePlanNode,
  saveCanvasPlan,
  updatePlanNode,
  withRunTaskIds,
} from '../lib/canvasPlan';
import { runCanvasPlan, type PlanRunOutcome } from '../lib/canvasPlanRunner';

/**
 * 编排独立页 `#/plan`（V2.88 / D-1；CONTRACT §11-6 / §21-18 的边界见 §11-6 附）。
 *
 * ## 为什么是独立页而不是塞进画布
 * 画布是"编辑与生成"（节点是媒体，产物是文档的一部分）；编排是"执行与依赖"
 * （节点只有提示词与参数，跑完就结束）。两种心智混在一个工具栏里，
 * 用户会分不清"我改的是这张图"还是"我改的是这条流水线"。
 *
 * ## 三条口径（与契约 §11-6 一一对应）
 * 1. **编排只在本机**（`astrmira.canvasPlan.<projectId>`）；提交仍走 `POST /api/generate`；
 * 2. **幂等**：同代「运行」重复点不重复计费；「重跑」显式 +1 代（真的新建任务）；
 * 3. **不猜上游**：每个节点为什么不能跑都写在卡片上（`planNodeBlockReason`）。
 *
 * ## 这一层不做什么
 * 不做可视化拖拽画布：编排的节点只有提示词/参数，列表 + 连边下拉足够表达依赖，
 * 而且不会把"位置"变成第二份需要保存的真相（`position` 仍写，只用于导入导出）。
 */

const STATE_LABEL_KEY = {
  submitted: 'plan.status.submitted',
  failed: 'plan.status.failed',
  skipped: 'plan.status.skipped',
  kept: 'plan.status.kept',
} as const;

const MODE_OPTIONS: ReadonlyArray<{ value: CanvasPlanNode['mode']; key: 'plan.mode.t2v' | 'plan.mode.v2v' | 'plan.mode.t2i' }> = [
  { value: 't2v', key: 'plan.mode.t2v' },
  { value: 'v2v', key: 'plan.mode.v2v' },
  { value: 't2i', key: 'plan.mode.t2i' },
];

const DURATION_OPTIONS = [5, 10] as const;

function describeError(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

function isTerminal(status: string): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

export function PlanView(): ReactNode {
  const t = useTranslate();
  const { projectId, projects, byok, providerStatus } = useShell();
  const storage = useMemo(() => browserStorage(), []);

  const [plan, setPlan] = useState<CanvasPlan | null>(null);
  const [broken, setBroken] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PlanRunOutcome | null>(null);
  const [taskStates, setTaskStates] = useState<Record<string, TaskProgress>>({});
  const [runNonce, setRunNonce] = useState(0);

  /** 运行开始时的项目：跑完只写回**同一个项目**，避免中途切项目把结果写错地方 */
  const runProjectRef = useRef(projectId);

  // 本机存储 → 状态。`reloadNonce` 是"读不出来时重试"的唯一入口（不自动覆盖原文）
  useEffect(() => {
    const loaded = loadCanvasPlan(projectId, storage);
    setPlan(loaded.plan);
    setBroken(loaded.broken);
    setOutcome(null);
    setTaskStates({});
    setError(null);
    setNotice(null);
  }, [projectId, storage, reloadNonce]);

  const persist = useCallback(
    (next: CanvasPlan): void => {
      setPlan(next);
      saveCanvasPlan(projectId, next, storage);
    },
    [projectId, storage],
  );

  /** 空项目第一次编辑时惰性建一份（不落盘空编排：没编辑过就不该出现在存储里） */
  const editable = useCallback((): CanvasPlan => {
    if (plan !== null) return plan;
    const fresh = createEmptyPlan();
    setPlan(fresh);
    return fresh;
  }, [plan]);

  const projectName =
    projects.find((entry) => entry.projectId === projectId)?.name ?? projectId;

  const engines = useMemo(() => {
    const local = comfyUiEngineOptions(providerStatus).map((option) => ({
      id: option.id,
      label: option.label,
    }));
    return [
      { id: 'cloud-volcano-seedance', label: providerLabel('cloud-volcano-seedance', providerStatus) },
      ...local,
    ];
  }, [providerStatus]);

  const order = useMemo(() => (plan === null ? { order: [], cycle: [] } : planExecutionOrder(plan)), [plan]);

  /** V2.88：重试 = 换一代 + 只跑这一段（连带下游）—— 同一代的键会命中已失败的那条任务 */
  const run = useCallback(
    async (options: { scope?: string[]; bump?: boolean } = {}): Promise<void> => {
      const current = plan;
      if (current === null || running) return;
      const next = options.bump === true ? bumpPlanRun(current) : current;
      if (next !== current) persist(next);

      runProjectRef.current = projectId;
      setRunning(true);
      setError(null);
      setNotice(null);
      setTaskStates({});

      const providerKey = resolveProviderKey(byok);
      try {
        const result = await runCanvasPlan(next, {
          submit: async (body, idempotencyKey, planRunId) => {
            const response = await submitGenerate(body, {
              idempotencyKey,
              planRunId,
              ...(providerKey === undefined ? {} : { providerKey }),
            });
            return { taskId: response.taskId };
          },
          queryTask: async (taskId) => {
            const task = await fetchTask(taskId);
            return {
              status: task.status,
              outputVideoUrl: task.outputVideoUrl ?? null,
              outputImageUrl: task.outputImageUrl ?? null,
            };
          },
          ...(options.scope === undefined ? {} : { scope: options.scope }),
        });

        setOutcome(result);
        setRunNonce((value) => value + 1);
        setNotice(
          t('plan.run.done', {
            count: result.results.filter((item) => item.state === 'submitted').length,
          }),
        );

        // 部分重跑的唯一依据：把本轮提交成功的 taskId 写回（只写成功的）
        const submitted = new Map(
          result.results.flatMap((item) =>
            item.state === 'submitted' && item.taskId !== undefined
              ? [[item.nodeId, item.taskId] as const]
              : [],
          ),
        );
        if (submitted.size > 0 && runProjectRef.current === projectId) {
          persist(withRunTaskIds(next, submitted));
        }
      } catch (caught) {
        setError(t('plan.run.error', { reason: describeError(caught) }));
      } finally {
        setRunning(false);
      }
    },
    [byok, persist, plan, projectId, running, t],
  );

  /** 结果轮询：只查本轮提交的任务，全部终态就停（不常驻轮询） */
  useEffect(() => {
    const ids = (outcome?.results ?? []).flatMap((item) =>
      item.state === 'submitted' && item.taskId !== undefined ? [item.taskId] : [],
    );
    if (ids.length === 0) return;

    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async (): Promise<void> => {
      const entries = await Promise.all(
        ids.map(async (id) => {
          try {
            return [id, await fetchTask(id)] as const;
          } catch {
            return null;
          }
        }),
      );
      if (stopped) return;
      const fresh = entries.filter((entry): entry is readonly [string, TaskProgress] => entry !== null);
      if (fresh.length > 0) {
        setTaskStates((prev) => {
          const next = { ...prev };
          for (const [id, task] of fresh) next[id] = task;
          return next;
        });
      }
      // 有任何一条查不到就不停（网络抖动不该让状态停在 running）
      if (fresh.length === ids.length && fresh.every(([, task]) => isTerminal(task.status))) {
        if (timer !== null) clearInterval(timer);
        timer = null;
      }
    };

    void tick();
    timer = setInterval(() => void tick(), 2_000);
    return () => {
      stopped = true;
      if (timer !== null) clearInterval(timer);
    };
  }, [outcome, runNonce]);

  const addNode = (kind: 'video' | 'image'): void => {
    const current = editable();
    const index = current.nodes.length;
    const node =
      kind === 'image'
        ? newPlanImageNode({ x: 0, y: index * 96 })
        : newPlanNode({ x: 0, y: index * 96 });
    persist(addPlanNode(current, node));
  };

  const patchNode = (nodeId: string, patch: Partial<Omit<CanvasPlanNode, 'id' | 'position'>>): void => {
    if (plan === null) return;
    persist(updatePlanNode(plan, nodeId, patch));
  };

  const nodeName = (nodeId: string): string => {
    const node = plan?.nodes.find((item) => item.id === nodeId);
    if (node === undefined) return nodeId;
    const text = node.prompt.trim();
    return text === '' ? nodeId : text.slice(0, 24);
  };

  const resultFor = (nodeId: string) =>
    outcome?.results.find((item) => item.nodeId === nodeId) ?? null;

  return (
    <section className="wb-page plan-page">
      <header className="plan-head">
        <div>
          <h1 className="plan-title">{t('plan.title')}</h1>
          <p className="wb-note plan-subtitle">{t('plan.subtitle')}</p>
        </div>
        <div className="plan-actions">
          <span className="plan-meta">{t('plan.project')}：{projectName}</span>
          <span className="plan-meta">{t('plan.seq', { seq: plan === null ? 1 : planRunSeq(plan) })}</span>
          <button
            type="button"
            className="wb-btn"
            disabled={running || plan === null || plan.nodes.length === 0}
            title={t('plan.rerun.warning', {
              seq: plan === null ? 1 : planRunSeq(plan),
              next: (plan === null ? 1 : planRunSeq(plan)) + 1,
            })}
            onClick={() => void run({ bump: true })}
          >
            {t('plan.rerun')}
          </button>
          <button
            type="button"
            className="wb-btn wb-btn-primary"
            disabled={running || plan === null || plan.nodes.length === 0}
            onClick={() => void run()}
          >
            {running ? t('plan.running') : t('plan.run')}
          </button>
        </div>
      </header>

      {broken ? (
        <div className="plan-broken" role="alert">
          <span>{t('plan.loadBroken')}</span>
          <button
            type="button"
            className="cs-subject-link"
            onClick={() => setReloadNonce((value) => value + 1)}
          >
            {t('canvas.subject.retry')}
          </button>
        </div>
      ) : null}
      {error === null ? null : (
        <p className="plan-broken" role="alert">
          {error}
        </p>
      )}
      {notice === null ? null : (
        <p className="wb-note plan-notice" role="status">
          {notice}
        </p>
      )}

      <div className="plan-toolbar">
        <button type="button" className="wb-btn" onClick={() => addNode('video')}>
          {t('plan.addVideo')}
        </button>
        <button type="button" className="wb-btn" onClick={() => addNode('image')}>
          {t('plan.addImage')}
        </button>
      </div>

      <div className="plan-grid">
        <div className="plan-nodes">
          {plan === null || plan.nodes.length === 0 ? (
            <p className="wb-note">{t('plan.empty')}</p>
          ) : (
            plan.nodes.map((node) => {
              const blocked = planNodeBlockReason(plan, node.id);
              const result = resultFor(node.id);
              const incoming = planIncomingEdges(plan, node.id);
              const targets = plan.nodes.filter(
                (item) =>
                  item.id !== node.id &&
                  !plan.edges.some((edge) => edge.from === node.id && edge.to === item.id),
              );
              return (
                <article key={node.id} className="plan-card">
                  <div className="plan-card-head">
                    <span className="plan-card-id">{node.id}</span>
                    <button
                      type="button"
                      className="cs-subject-link cs-subject-danger"
                      aria-label={t('plan.node.remove')}
                      onClick={() => persist(removePlanNode(plan, node.id))}
                    >
                      {t('plan.node.remove')}
                    </button>
                  </div>

                  <textarea
                    className="plan-prompt"
                    value={node.prompt}
                    placeholder={t('plan.node.promptPlaceholder')}
                    rows={2}
                    onChange={(event) => patchNode(node.id, { prompt: event.target.value })}
                  />

                  <div className="plan-row">
                    <label className="plan-field">
                      <span>{t('plan.node.mode')}</span>
                      <select
                        value={node.mode}
                        onChange={(event) =>
                          patchNode(node.id, {
                            mode: event.target.value as CanvasPlanNode['mode'],
                          })
                        }
                      >
                        {MODE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {t(option.key)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="plan-field">
                      <span>{t('plan.node.provider')}</span>
                      <select
                        value={node.provider}
                        onChange={(event) => patchNode(node.id, { provider: event.target.value })}
                      >
                        {engines.some((engine) => engine.id === node.provider) ? null : (
                          <option value={node.provider}>{node.provider}</option>
                        )}
                        {engines.map((engine) => (
                          <option key={engine.id} value={engine.id}>
                            {engine.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    {node.mode === 't2i' ? null : (
                      <label className="plan-field">
                        <span>{t('plan.node.duration')}</span>
                        <select
                          value={String(node.durationSec ?? 5)}
                          onChange={(event) =>
                            patchNode(node.id, { durationSec: Number(event.target.value) })
                          }
                        >
                          {DURATION_OPTIONS.map((value) => (
                            <option key={value} value={String(value)}>
                              {value}s
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>

                  <div className="plan-row">
                    <label className="plan-field plan-field-grow">
                      <span>{t('plan.node.connectTo')}</span>
                      {targets.length === 0 ? (
                        <span className="plan-hint">{t('plan.node.noTargets')}</span>
                      ) : (
                        <select
                          value=""
                          onChange={(event) => {
                            const target = event.target.value;
                            if (target === '') return;
                            persist(addPlanEdge(plan, node.id, target));
                          }}
                        >
                          <option value="">{t('plan.node.connectPlaceholder')}</option>
                          {targets.map((target) => (
                            <option key={target.id} value={target.id}>
                              {target.id}
                            </option>
                          ))}
                        </select>
                      )}
                    </label>
                    {incoming.length === 0 ? null : (
                      <span className="plan-hint">
                        {t('plan.node.upstream', { count: incoming.length })}
                      </span>
                    )}
                  </div>

                  {blocked === null ? null : (
                    <p className="plan-block">{t('plan.blocked', { reason: blocked })}</p>
                  )}

                  {result === null ? null : (
                    <div className="plan-result" data-state={result.state}>
                      <span className="plan-result-state">{t(STATE_LABEL_KEY[result.state])}</span>
                      {result.message === undefined ? null : (
                        <span className="plan-result-msg">{result.message}</span>
                      )}
                      {result.taskId === undefined ? null : (
                        <span className="plan-result-task">
                          {statusLabel(taskStates[result.taskId]?.status ?? 'queued')} · {result.taskId}
                        </span>
                      )}
                      {result.taskId !== undefined &&
                      taskStates[result.taskId]?.outputImageUrl !== undefined ? (
                        <img
                          className="plan-result-thumb"
                          src={resolveMediaUrl(taskStates[result.taskId]?.outputImageUrl) ?? ''}
                          alt=""
                        />
                      ) : null}
                      {result.state === 'failed' || result.state === 'skipped' ? (
                        <button
                          type="button"
                          className="cs-subject-link"
                          title={t('plan.results.retryHint')}
                          onClick={() => void run({ scope: [node.id], bump: true })}
                        >
                          {t('plan.results.retry')}
                        </button>
                      ) : null}
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>

        <aside className="plan-side">
          <h2 className="plan-side-title">{t('plan.order.title')}</h2>
          {order.cycle.length > 0 ? (
            <p className="plan-block">{t('plan.order.cycle', { count: order.cycle.length })}</p>
          ) : null}
          {order.order.length === 0 ? (
            <p className="wb-note">{t('plan.order.empty')}</p>
          ) : (
            <ol className="plan-order">
              {order.order.map((nodeId) => {
                const reason = plan === null ? null : planNodeBlockReason(plan, nodeId);
                return (
                  <li key={nodeId} className="plan-order-item">
                    <span className="plan-order-name">{nodeName(nodeId)}</span>
                    <span className="plan-hint">{reason === null ? 'ok' : reason}</span>
                  </li>
                );
              })}
            </ol>
          )}

          {plan === null || plan.edges.length === 0 ? null : (
            <>
              <h2 className="plan-side-title">{t('plan.edges')}</h2>
              <ul className="plan-edges">
                {plan.edges.map((edge) => (
                  <li key={edge.id} className="plan-edge-item">
                    <span>
                      {nodeName(edge.from)} → {nodeName(edge.to)}
                    </span>
                    <button
                      type="button"
                      className="cs-subject-link cs-subject-danger"
                      aria-label={t('plan.edge.remove')}
                      onClick={() => persist(removePlanEdge(plan, edge.id))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <h2 className="plan-side-title">{t('plan.results.title')}</h2>
          {outcome === null ? (
            <p className="wb-note">{t('plan.results.none')}</p>
          ) : (
            <ul className="plan-results">
              {outcome.results.map((item) => (
                <li key={item.nodeId} className="plan-result-item" data-state={item.state}>
                  <span className="plan-order-name">{nodeName(item.nodeId)}</span>
                  <span className="plan-hint">{t(STATE_LABEL_KEY[item.state])}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </section>
  );
}
