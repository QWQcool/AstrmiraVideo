import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useNodesState,
  useReactFlow,
  type Edge,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type {
  AssetListEntry,
  CostRecord,
  EventLogEntry,
  GenerationMode,
  TaskProgress,
} from '@astrmira/shared';
import { formatYuan, logActionLabel, parseTaskRef } from '@astrmira/shared';
import {
  ApiError,
  fetchAssets,
  fetchHistory,
  fetchLogs,
  fetchMetrics,
  resolveMediaUrl,
} from '../lib/api';
import { useShell } from '../lib/shell';
import {
  assetNodeId,
  buildLineage,
  isProblemNode,
  layoutLineage,
  taskNodeId,
  type LineageEdgeKind,
  type LineageNode,
} from '../lib/lineage';
import { navigate } from '../lib/router';
import { LineageNodeCard, type LineageFlowNode } from '../canvas/NodeCard';

/**
 * 血缘画布 `#/canvas`（Step 8 · P4 / 台账 B42，L2 只读；决策 = PLAN §6-D40）。
 *
 * "这条成片是怎么长出来的"：一句话 / 一张图 / 一段参考 → 生成 → 抽帧 → 剪辑 → …… 一张 DAG 看完。
 *
 * 三条纪律（D40 逐字对应）：
 * 1. **只读**：不注册 `onConnect`、`nodesConnectable=false`、`deleteKeyCode=null`；
 *    节点可拖摆位（会话内，不持久化）——那是"看图的姿势"，不是编辑数据；
 * 2. **零契约变更**：节点与边全部由 `lib/lineage.ts` 从 `origin` / `extractedAssetIds` /
 *    `requestSnapshot.assets` 推导；数据源 = 既有三个只读接口；
 * 3. **不静默**：引用了但已不在列表里的对象以 ghost 节点出现；空库时有明确引导。
 *
 * 布局：自写分层（列 = 派生深度、行 = 同列时间倒序），不引 dagre（UPSTREAM #5 只登记组件本体）。
 */

const EDGE_STYLE: Record<LineageEdgeKind, { stroke: string; dash?: string; text: string }> = {
  edit: { stroke: 'var(--gold)', text: '剪辑自' },
  extract: { stroke: 'var(--blue)', text: '抽帧' },
  reference: { stroke: 'var(--muted)', text: '素材参考' },
  'task-ref': { stroke: 'var(--gold-line)', dash: '6 4', text: '成片参考' },
};

const EDGE_KINDS: LineageEdgeKind[] = ['edit', 'extract', 'reference', 'task-ref'];

function describeError(caught: unknown): string {
  if (caught instanceof ApiError) {
    const code = caught.failure.code === undefined ? '' : `【${caught.failure.code}】`;
    return `${code}${caught.failure.message}`;
  }
  return caught instanceof Error ? caught.message : String(caught);
}

/**
 * 画布工具条（V2.19 / 台账 B64）。
 *
 * 为什么需要"缩放到选区"：血缘图会长（多镜头剪辑链 + 抽帧派生），
 * 而 `Controls` 自带的 fitView 只能"看全部"—— 全图缩小到 20% 时节点小到读不出标题。
 * 选中几个节点 → 一键把它们填满视口，才是长图里真正省事的操作。
 *
 * ⚠️ 必须渲染在 `<ReactFlow>` 内部（`useReactFlow` 依赖它的 Provider）。
 * 参考 n8n 的画布导航交互，本组件为独立实现（PLAN §6-D48）。
 */
const CanvasToolbar: FC<{ selectedIds: string[] }> = ({ selectedIds }) => {
  const { fitView } = useReactFlow();
  const count = selectedIds.length;

  return (
    <div className="cv-tools">
      <button
        type="button"
        className="cv-tool"
        data-testid="cv-zoom-selection"
        disabled={count === 0}
        title={
          count === 0
            ? '先在画布上框选节点，或按住 Shift 点选多个节点'
            : `把选中的 ${count} 个节点填满视口`
        }
        onClick={() => {
          void fitView({
            nodes: selectedIds.map((id) => ({ id })),
            duration: 400,
            padding: 0.3,
            maxZoom: 1.6,
          });
        }}
      >
        ◎ 缩放到选区{count === 0 ? '' : `（${count}）`}
      </button>
      <button
        type="button"
        className="cv-tool"
        data-testid="cv-zoom-all"
        title="缩放到全部节点（等同左下角控件里的适配按钮）"
        onClick={() => {
          void fitView({ duration: 400, padding: 0.2, maxZoom: 1.6 });
        }}
      >
        ⤢ 全部
      </button>
    </div>
  );
};

const MODE_LABELS: Record<GenerationMode, string> = {
  t2v: '文生视频',
  i2v: '图生视频',
  fl2v: '首尾帧',
  v2v: '视频参考',
};

const COST_SOURCE_LABEL: Record<CostRecord['source'], string> = {
  estimate: '预估（公开价目）',
  'local-free': '本地轨 · 免费',
  upstream: '上游真实值',
};

function formatBytes(bytes: number | undefined): string | null {
  if (bytes === undefined) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatMoment(ts: number): string {
  return ts === 0 ? '—' : new Date(ts).toLocaleString();
}

/**
 * 请求快照里的引用值 → 画布节点 id。
 *
 * 两种形态（与 `lib/lineage.ts` 的推导规则**同源**）：`task:<taskId>` 是成片引用，
 * 其余是资产 id。这里不判断"节点是否存在" —— 那由 `catalog` 决定，
 * 于是"引用了但不在画布上"会**置灰并写明**，而不是给一个点了没反应的按钮。
 */
function refToNodeId(value: string): string {
  const refTaskId = parseTaskRef(value);
  return refTaskId === null ? assetNodeId(value) : taskNodeId(refTaskId);
}

/**
 * 某条任务的留痕（V2.19 / 台账 B62）。
 *
 * 用 `?taskId=` 取（V2.19 新增的筛选，见 CONTRACT §10）—— 检查器要回答
 * "这条片子当时发生了什么"：提交、终态（complete/fail/uncertain）、取消、渲染入库都带 `task_id`。
 * 只取最近 5 条（**看图时的上下文**，不是日志页的替代品），更多请去日志页。
 */
const NodeLogList: FC<{ taskId: string }> = ({ taskId }) => {
  const [items, setItems] = useState<EventLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    fetchLogs({ taskId, limit: 5 })
      .then((data) => {
        if (!cancelled) setItems(data.items);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  if (error !== null) return <p className="wb-note cv-insp-warn">留痕读取失败：{error}</p>;
  if (items === null) return <p className="wb-note">正在读取留痕…</p>;
  if (items.length === 0) {
    return (
      <p className="wb-note">没有留痕（这条任务早于操作日志功能，或已被日志保留策略清掉）。</p>
    );
  }

  return (
    <ul className="cv-log-list">
      {items.map((item) => (
        <li key={item.id} className="cv-log-row">
          <span className="cv-log-action">{logActionLabel(item.action)}</span>
          <span className="cv-log-time">{new Date(item.ts).toLocaleTimeString()}</span>
          <span className={item.statusCode !== undefined && item.statusCode >= 400 ? 'cv-log-bad' : 'cv-log-ok'}>
            {item.statusCode ?? '—'}
          </span>
        </li>
      ))}
    </ul>
  );
};

/**
 * 节点检查器（V2.19 / 台账 B62；设计参考 n8n 的 NDV，独立实现）。
 *
 * ## 它解决什么
 * 画布此前只能"看位置 + 播一下"：任务对象里那些**排错与对账真正要用的东西**
 * （提示词快照 / 输入素材 / 产物体积 / 成本 / warnings / 错误 / 该任务的留痕 / 上下游）
 * 全都没有出口。检查器把它们一次摆出来，并把"上下游"做成**可点击跳转**——
 * 于是"这条片子是怎么长出来的"从"看图猜"变成"沿链走"。
 *
 * ## 三条口径
 * 1. **不新造数据**：全部读 `LineageNode.task` / `.asset`（= 原始任务 / 资产对象），
 *    不另抄字段（否则每加一个任务字段就要同步两处）；
 * 2. **金额如实**：有成本记录就显示它（含来源与"是否命中单价表"），没有就写"未记录"
 *    —— **不做事后估算**（事后估算会让人以为那是当时的真实花费）；
 * 3. **只读**：动作全部指向既有 hash 参数（零新路由、零契约）。
 */
function CanvasInspector({
  node,
  catalog,
  upstream,
  downstream,
  onSelect,
  onClose,
}: {
  node: LineageNode;
  /** 当前画布上的全部节点（按 id 索引）—— 用来判断"引用能不能跳"，以及跳到哪里 */
  catalog: Map<string, LineageNode>;
  upstream: LineageNode[];
  downstream: LineageNode[];
  onSelect: (node: LineageNode) => void;
  onClose: () => void;
}) {
  const taskId = node.kind === 'task' ? node.taskId : undefined;
  const assetId = node.kind === 'asset' ? node.assetId : undefined;
  const outputUrl = resolveMediaUrl(node.outputVideoUrl ?? undefined);
  const task = node.task;
  const asset = node.asset;
  const request = task?.requestSnapshot;
  const sizeText = formatBytes(task?.outputSizeBytes);

  /** 输入素材（首帧 / 尾帧 / 视频参考）→ 引用值转成节点 id（能不能跳由 catalog 决定） */
  const inputs: Array<{ label: string; value: string; nodeId: string }> = [];
  if (request !== undefined) {
    const assets = request.assets;
    if (assets?.firstFrameImage !== undefined) {
      inputs.push({ label: '首帧图', value: assets.firstFrameImage, nodeId: refToNodeId(assets.firstFrameImage) });
    }
    if (assets?.lastFrameImage !== undefined) {
      inputs.push({ label: '尾帧图', value: assets.lastFrameImage, nodeId: refToNodeId(assets.lastFrameImage) });
    }
    if (assets?.referenceVideo !== undefined) {
      inputs.push({ label: '视频参考', value: assets.referenceVideo, nodeId: refToNodeId(assets.referenceVideo) });
    }
  }

  return (
    <aside className="cv-drawer" aria-label="节点详情">
      <div className="cv-drawer-head">
        <span className="cv-drawer-title">
          {node.isEdit === true ? '✂ ' : ''}
          {node.label}
        </span>
        <button type="button" className="cr-link" aria-label="关闭详情" onClick={onClose}>
          ✕
        </button>
      </div>
      <p className="wb-note" data-testid="cv-insp-sub">
        {node.sublabel} · {formatMoment(node.createdAt)}
      </p>

      {node.ghost === true ? (
        <p className="wb-note cv-drawer-ghost">
          这个对象已不在当前列表里（删除过或超出最近 50 条）——仅作为血缘占位显示。
        </p>
      ) : null}

      {outputUrl === null ? null : <video className="cv-player" src={outputUrl} controls playsInline />}

      {task === undefined ? null : (
        <>
          <section className="cv-insp-section">
            <h3 className="cv-insp-title">提示词</h3>
            <p className="cv-insp-prompt">{request?.prompt ?? '（无快照）'}</p>
            <dl className="cv-insp-kv">
              <div>
                <dt>模式</dt>
                <dd>{request === undefined ? '—' : MODE_LABELS[request.mode]}</dd>
              </div>
              <div>
                <dt>画幅</dt>
                <dd>{request?.aspectRatio ?? '—'}</dd>
              </div>
              <div>
                <dt>时长</dt>
                <dd>{request?.params?.durationSec === undefined ? '—' : `${request.params.durationSec}s`}</dd>
              </div>
              <div>
                <dt>引擎</dt>
                <dd>{request?.provider ?? '—'}</dd>
              </div>
              <div>
                <dt>种子</dt>
                <dd>
                  {request?.params?.seed === undefined
                    ? '随机'
                    : String(request.params.seed)}
                </dd>
              </div>
              <div>
                <dt>产物</dt>
                <dd>{sizeText ?? (node.hasOutput === true ? '已出片' : '无')}</dd>
              </div>
            </dl>
          </section>

          {inputs.length === 0 ? null : (
            <section className="cv-insp-section">
              <h3 className="cv-insp-title">输入素材</h3>
              <div className="cv-insp-links">
                {inputs.map((item) => {
                  const target = catalog.get(item.nodeId);
                  return (
                    <button
                      key={item.label}
                      type="button"
                      className="cv-jump"
                      disabled={target === undefined}
                      title={target === undefined ? '这个引用不在当前画布上' : '跳到这个节点'}
                      onClick={() => {
                        if (target !== undefined) onSelect(target);
                      }}
                    >
                      {item.label}：{item.value.slice(0, 22)}
                      {target === undefined ? '（画布外）' : ''}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section className="cv-insp-section">
            <h3 className="cv-insp-title">成本</h3>
            {task.cost === undefined ? (
              <p className="wb-note">
                未记录成本（老任务或尚未结算）。金额口径见 CONTRACT §13，**以方舟账单为准**。
              </p>
            ) : (
              <>
                <p className="cv-insp-cost">
                  {formatYuan(task.cost.yuan)}
                  <span className="cv-insp-cost-note">
                    （{COST_SOURCE_LABEL[task.cost.source]}
                    {task.cost.source !== 'local-free' && !task.cost.fromPriceTable
                      ? ' · 未命中单价表，按兜底价'
                      : ''}
                    ）
                  </span>
                </p>
                <p className="wb-note" title={task.cost.formula}>
                  模型 {task.cost.modelId} · {task.cost.outputSeconds}s · {task.cost.width}×
                  {task.cost.height}
                </p>
                {task.cost.notes.map((note) => (
                  <p key={note} className="wb-note cv-insp-warn">
                    ⚠ {note}
                  </p>
                ))}
              </>
            )}
          </section>

          {task.warnings === undefined || task.warnings.length === 0 ? null : (
            <section className="cv-insp-section">
              <h3 className="cv-insp-title">警告（{task.warnings.length}）</h3>
              {task.warnings.map((warning) => (
                <p key={warning} className="wb-note cv-insp-warn">
                  ⚠ {warning}
                </p>
              ))}
            </section>
          )}

          {task.error === undefined ? null : (
            <section className="cv-insp-section">
              <h3 className="cv-insp-title">错误</h3>
              <p className="wb-note cv-insp-bad">
                【{task.error.code}】{task.error.message}
              </p>
              <p className="wb-note">处置：{task.error.disposition}</p>
            </section>
          )}

          <section className="cv-insp-section">
            <h3 className="cv-insp-title">这条任务发生了什么</h3>
            <NodeLogList taskId={task.taskId} />
            <button type="button" className="cr-link" onClick={() => navigate('#/logs')}>
              去操作日志页看全部 →
            </button>
          </section>
        </>
      )}

      {asset === undefined ? null : (
        <section className="cv-insp-section">
          <h3 className="cv-insp-title">资产</h3>
          <dl className="cv-insp-kv">
            <div>
              <dt>类型</dt>
              <dd>{asset.kind}</dd>
            </div>
            <div>
              <dt>MIME</dt>
              <dd>{asset.mime}</dd>
            </div>
            <div>
              <dt>体积</dt>
              <dd>{formatBytes(asset.size) ?? '—'}</dd>
            </div>
            <div>
              <dt>上传于</dt>
              <dd>{formatMoment(asset.createdAt)}</dd>
            </div>
          </dl>
        </section>
      )}

      {upstream.length === 0 && downstream.length === 0 ? null : (
        <section className="cv-insp-section">
          <h3 className="cv-insp-title">血缘</h3>
          <div className="cv-insp-links">
            {[...upstream.map((item) => ({ item, dir: '↑ 上游' })), ...downstream.map((item) => ({ item, dir: '↓ 下游' }))].map(
              ({ item, dir }) => (
                <button
                  key={`${dir}-${item.id}`}
                  type="button"
                  className="cv-jump"
                  title="跳到这个节点"
                  onClick={() => onSelect(item)}
                >
                  {dir} · {item.label}
                </button>
              ),
            )}
          </div>
        </section>
      )}

      {taskId === undefined ? null : (
        <div className="cv-drawer-actions">
          <button
            type="button"
            className="wb-btn"
            onClick={() => navigate(`#/workbench?reuse=${encodeURIComponent(taskId)}`)}
          >
            ⟲ 复用参数
          </button>
          <button
            type="button"
            className="wb-btn"
            disabled={node.hasOutput !== true}
            onClick={() => navigate(`#/edit?task=${encodeURIComponent(taskId)}`)}
          >
            ✂ 送剪辑台
          </button>
          <button
            type="button"
            className="wb-btn"
            disabled={node.hasOutput !== true}
            onClick={() => navigate(`#/workbench?refTask=${encodeURIComponent(taskId)}`)}
          >
            🎬 设为视频参考
          </button>
        </div>
      )}

      {assetId === undefined ? null : (
        <div className="cv-drawer-actions">
          {node.assetKind === 'image' ? (
            <button
              type="button"
              className="wb-btn"
              onClick={() =>
                navigate(`#/workbench?frameAsset=${encodeURIComponent(assetId)}&frameExt=jpg`)
              }
            >
              🖼 当作首帧（I2V）
            </button>
          ) : null}
          {node.url === null || node.url === undefined ? null : (
            <a className="wb-btn" href={node.url} target="_blank" rel="noreferrer">
              ⧉ 打开原文件
            </a>
          )}
        </div>
      )}
    </aside>
  );
}

export function CanvasView() {
  // V2.11（B47）：血缘画布按当前项目取材
  const { projectId } = useShell();
  const [tasks, setTasks] = useState<TaskProgress[]>([]);
  const [assets, setAssets] = useState<AssetListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<LineageNode | null>(null);
  /** 当前选中的节点 id（V2.19 / B64）：只用于"缩放到选区"，不参与任何编辑语义 */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** 「只看异常」（V2.19 / B63）：把非异常节点调暗，而不是把图删成只剩几条 */
  const [onlyProblems, setOnlyProblems] = useState(false);
  /** 队列实况（来自 `/api/metrics` 的 `queue`，V2.16 / B53）—— 把"为什么要等"如实讲出来 */
  const [queue, setQueue] = useState<{ queued: number; oldestAgeSec: number | null } | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      // 三个既有只读接口，零契约变更（生成产物 + 剪辑产物 + 资产库）
      // V2.11（B47）：三者都按当前项目过滤（血缘图是"这个项目里的片子怎么长出来的"）
      const [generated, edits, assetList] = await Promise.all([
        fetchHistory({ project: projectId }),
        fetchHistory({ kind: 'edit', project: projectId }),
        fetchAssets(projectId),
      ]);
      setTasks([...generated.items, ...edits.items]);
      setAssets(assetList.assets);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * 队列实况（V2.19 / B63 的 E5：排队语义对用户可见）。
   *
   * 读 `/api/metrics` 的 `queue`（V2.16 / B53 已有）—— **零新接口**。
   * 本地轨并发为 1（防线 1）是硬约束："让你干等"和"告诉你为什么在等"是两种体验。
   * 拉不到就**不显示**（它是锦上添花的信息，不该让画布报错）。
   */
  useEffect(() => {
    let cancelled = false;
    fetchMetrics()
      .then((data) => {
        if (!cancelled) {
          setQueue({ queued: data.queue.queued, oldestAgeSec: data.queue.oldestQueuedAgeSec });
        }
      })
      .catch(() => {
        if (!cancelled) setQueue(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, tasks.length]);

  const graph = useMemo(() => buildLineage({ tasks, assets }), [tasks, assets]);
  const layout = useMemo(() => layoutLineage(graph), [graph]);

  /** 节点索引（检查器判断"引用能不能跳"）+ 上下游邻接表（跳转入口 / "只看异常"的邻居判定） */
  const catalog = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  );

  const { upstreamOf, downstreamOf } = useMemo(() => {
    const upstream = new Map<string, LineageNode[]>();
    const downstream = new Map<string, LineageNode[]>();
    const push = (map: Map<string, LineageNode[]>, key: string, node: LineageNode): void => {
      const list = map.get(key);
      if (list === undefined) map.set(key, [node]);
      else list.push(node);
    };
    for (const edge of graph.edges) {
      const from = catalog.get(edge.from);
      const to = catalog.get(edge.to);
      if (from !== undefined && to !== undefined) {
        push(downstream, from.id, to);
        push(upstream, to.id, from);
      }
    }
    return { upstreamOf: upstream, downstreamOf: downstream };
  }, [graph.edges, catalog]);

  // ── 执行态（V2.19 / 台账 B63）─────────────────────────────────────────────
  /** 需要人看一眼的节点：失败 / 不确定（后者 = 可能已产生费用） */
  const problemIds = useMemo(
    () => new Set(graph.nodes.filter((node) => isProblemNode(node)).map((node) => node.id)),
    [graph.nodes],
  );
  /** 异常节点的**直接邻居**：`只看异常`时它们保持正常亮度（好认出"这是谁的邻居"） */
  const nearIds = useMemo(() => {
    const near = new Set<string>();
    for (const id of problemIds) {
      for (const node of upstreamOf.get(id) ?? []) near.add(node.id);
      for (const node of downstreamOf.get(id) ?? []) near.add(node.id);
    }
    return near;
  }, [problemIds, upstreamOf, downstreamOf]);
  /** 正在跑的节点的**入边**：让数据"流进来"（复用 tokens 里的 `flow`，只改 dashoffset） */
  const flowingEdgeIds = useMemo(
    () =>
      new Set(
        graph.edges
          .filter((edge) => {
            const target = catalog.get(edge.to);
            return target?.status === 'running' || target?.status === 'queued';
          })
          .map((edge) => edge.id),
      ),
    [graph.edges, catalog],
  );

  /**
   * 节点走 `useNodesState`（**受控 + 变更回写**），而不是直接塞 `nodes={...}` 常量。
   *
   * ⚠️ **这是 2026-10-10 发现的一个真缺陷的修复**（B64 实施时暴露）：
   * 原先只传 `nodes` / `edges`、**没有 `onNodesChange`** —— 而 React Flow 的
   * "拖摆位"与"选中"都靠 `onNodesChange` 把变更写回节点数组。缺了它，
   * 文档里写的"节点可拖摆位（会话内）"**其实一直没生效**，选中态也落不下来
   * （直接后果：B64 的「缩放到选区」永远是灰的）。
   * 画布仍是**只读**：回写的只有位置与选中（`nodesConnectable=false` / `deleteKeyCode=null` 不变）。
   */
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<LineageFlowNode>([]);

  useEffect(() => {
    setFlowNodes(
      graph.nodes.map((node) => ({
        id: node.id,
        type: 'lineage' as const,
        position: layout.positions[node.id] ?? { x: 0, y: 0 },
        data: { node, near: nearIds.has(node.id) },
      })),
    );
  }, [graph, layout, nearIds, setFlowNodes]);

  const flowEdges = useMemo<Edge[]>(
    () =>
      graph.edges.map((edge) => {
        const style = EDGE_STYLE[edge.kind];
        return {
          id: edge.id,
          source: edge.from,
          target: edge.to,
          type: 'smoothstep',
          // B63：正在跑的节点的入边走 `.cv-edge-flowing`（虚线流动 = "数据正流过来"）
          ...(flowingEdgeIds.has(edge.id) ? { className: 'cv-edge-flowing' } : {}),
          style: {
            stroke: style.stroke,
            ...(style.dash === undefined ? {} : { strokeDasharray: style.dash }),
          },
        };
      }),
    [graph, flowingEdgeIds],
  );

  const nodeTypes = useMemo(() => ({ lineage: LineageNodeCard }), []);

  const empty = !loading && tasks.length === 0;

  return (
    /* 用 `wb-page`（单列页面容器）而不是 `wb-main`：后者是**工作台三栏栅格**
       （`minmax(320px,380px) 1fr minmax(300px,360px)`）—— 画布塞进第一栏会被挤成 380px 宽 */
    <section className="wb-page">
      <div className="cv-wrap">
        <header className="cv-head">
          <div>
            <p className="cr-eyebrow">Lineage Canvas</p>
            <h2 className="cv-title">血缘画布</h2>
          </div>
          <div className="cv-legend" aria-label="边的图例">
            {EDGE_KINDS.map((kind) => (
              <span key={kind} className="cv-legend-item">
                <span className="cv-legend-line" style={{ backgroundColor: EDGE_STYLE[kind].stroke }} />
                {EDGE_STYLE[kind].text}
              </span>
            ))}
          </div>
        </header>

        {error === null ? null : (
          <div className="wb-uncertain cv-alert">
            <span className="wb-uncertain-title">画布数据读取失败</span>
            <span className="wb-uncertain-body">{error}</span>
          </div>
        )}

        {loading ? <p className="wb-note cv-note">正在读取血缘数据…</p> : null}

        {empty ? (
          <div className="cv-empty">
            <p className="cv-empty-title">这里还是一张白纸</p>
            <p className="wb-note">
              还没有任何生成记录 —— 去创作入口写下第一句话，成片与它的派生关系会自动出现在这里。
            </p>
            <button type="button" className="wb-btn wb-btn-gold" onClick={() => navigate('#/create')}>
              去创作
            </button>
          </div>
        ) : null}

        {empty || loading ? null : (
          <>
            <p className="wb-note cv-note">
              {graph.nodes.length} 个节点 · {graph.edges.length} 条派生边（列 = 派生顺序，行 = 时间倒序）。
              只读视图：点节点看详情与动作；拖动只是挪位置，不保存。
            </p>

            {/* V2.19（B63）：异常计数 + 排队实况 —— 把"图里哪里不对"和"为什么要等"都讲出来 */}
            <div className="cv-status" data-testid="cv-status">
              <span className={problemIds.size === 0 ? 'cv-status-ok' : 'cv-status-bad'}>
                {problemIds.size === 0 ? '✓ 没有失败/待核对的任务' : `⚠ ${problemIds.size} 个节点异常`}
              </span>
              {problemIds.size === 0 ? null : (
                <button
                  type="button"
                  className="cv-tool"
                  data-testid="cv-focus-problems"
                  aria-pressed={onlyProblems}
                  title="把非异常节点调暗（不删图），方便一眼看出哪里不对"
                  onClick={() => setOnlyProblems((value) => !value)}
                >
                  {onlyProblems ? '显示全部' : '只看异常'}
                </button>
              )}
              {queue === null || queue.queued === 0 ? null : (
                <span className="cv-status-queue">
                  队列中 {queue.queued} 条
                  {queue.oldestAgeSec === null
                    ? ''
                    : `（最久已等 ${Math.round(queue.oldestAgeSec)}s）`}
                  · 本机一次只跑 1 条
                </span>
              )}
            </div>

            <div
              className="cv-canvas"
              data-testid="cv-canvas"
              data-focus={onlyProblems ? 'problems' : 'all'}
            >
              <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                onNodesChange={onNodesChange}
                nodeTypes={nodeTypes}
                onNodeClick={(_event, node) => setSelected((node as LineageFlowNode).data.node)}
                onSelectionChange={(params: OnSelectionChangeParams) =>
                  setSelectedIds(params.nodes.map((node) => node.id))
                }
                nodesConnectable={false}
                deleteKeyCode={null}
                fitView
                minZoom={0.2}
                maxZoom={1.6}
              >
                <Background gap={24} />
                <Controls showInteractive={false} />
                <CanvasToolbar selectedIds={selectedIds} />
                <MiniMap
                  data-testid="cv-minimap"
                  position="bottom-right"
                  pannable
                  zoomable
                  maskColor="var(--canvas-veil)"
                  nodeColor={(node) => {
                    const data = (node as LineageFlowNode).data.node;
                    if (data.ghost === true) return 'var(--faint)';
                    return data.isEdit === true ? 'var(--blue)' : 'var(--gold)';
                  }}
                />
              </ReactFlow>
            </div>
            <p className="cv-mobile-note wb-note">
              画布在窄屏上不好用：请到桌面端查看，或先去
              <button type="button" className="cr-link" onClick={() => navigate('#/library')}>
                视频库
              </button>
              看列表。
            </p>
          </>
        )}
      </div>

      {selected === null ? null : (
        <CanvasInspector
          node={selected}
          catalog={catalog}
          upstream={upstreamOf.get(selected.id) ?? []}
          downstream={downstreamOf.get(selected.id) ?? []}
          onSelect={setSelected}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
