import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node as RFNode,
  type NodeMouseHandler,
  type OnNodeDrag,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type {
  AssetListEntry,
  CanvasPlan,
  CostRecord,
  EventLogEntry,
  TaskProgress,
} from '@astrmira/shared';
import { logActionLabel } from '../lib/format';
// 语言迁移第十八批：编排文件的读/写/校验**搬来了前端**（它的消费者只有前端，
// 而它每一句 reason 都是给人看的 —— 共享包没法持有界面文案）。
import { buildCanvasPlanFile, canvasPlanFileText, readCanvasPlanFile } from '../lib/canvasPlanFile';
import { formatYuan, parseTaskRef } from '@astrmira/shared';
import {
  ApiError,
  fetchAssets,
  fetchHistory,
  fetchLogs,
  fetchMetrics,
  fetchTask,
  resolveMediaUrl,
  submitGenerate,
} from '../lib/api';
import { resolveProviderKey } from '../lib/byok';
import { useShell } from '../lib/shell';
import {
  assetNodeId,
  buildLineage,
  buildRecipePack,
  isProblemNode,
  layoutLineage,
  taskNodeId,
  type LineageEdgeKind,
  type LineageGraph,
  type LineageNode,
} from '../lib/lineage';
import { combineHasMore, mergeCanvasTasks, oldestCreatedAt } from '../lib/canvasPaging';
import {
  addPlanEdge,
  addPlanNode,
  createEmptyPlan,
  loadCanvasPlan,
  movePlanNode,
  newPlanNode,
  bumpPlanRun,
  pinPlanNode,
  planNodeBlockReason,
  planRunSeq,
  removePlanEdge,
  removePlanNode,
  saveCanvasPlan,
  setPlanNodeRetry,
  unpinPlanNode,
  updatePlanNode,
  withNewPlanIdentity,
  withRunTaskIds,
} from '../lib/canvasPlan';
import { runCanvasPlan, type PlanRunOutcome } from '../lib/canvasPlanRunner';
import { downloadText } from '../lib/zipStore';
import { navigate, useHashRoute } from '../lib/router';
import { LineageNodeCard, type LineageFlowNode } from '../canvas/NodeCard';
import { NoteCard, type CanvasNoteNode } from '../canvas/NoteCard';
import { PlanNodeCard, type PlanFlowNode } from '../canvas/PlanNodeCard';
import { PlanInspector } from '../canvas/PlanInspector';
import { canvasModeLabel } from '../canvas/labels';
import { getLanguage, translate, useTranslate, type MessageKey } from '../lib/i18n';
import {
  createNote,
  loadCanvasNotes,
  removeNote,
  saveCanvasNotes,
  updateNote,
  type CanvasNote,
} from '../lib/canvasNotes';

/**
 * 画布上的节点 = 数据节点（血缘）/ 便签（说明）/ 编排节点（打算做什么）——
 * 三者的类型与生命周期完全不同（V2.26 起多了第三类）。
 */
type CanvasFlowNode = LineageFlowNode | CanvasNoteNode | PlanFlowNode;

/** 便签节点（两种模式共用同一份构造 —— 便签在编排模式下也在） */
function noteFlowNodes(
  notes: CanvasNote[],
  mutateNotes: (next: CanvasNote[]) => void,
): CanvasNoteNode[] {
  return notes.map((note) => ({
    id: note.id,
    type: 'note' as const,
    position: { x: note.x, y: note.y },
    data: {
      note,
      onText: (id: string, text: string) => mutateNotes(updateNote(notes, id, { text })),
      onDelete: (id: string) => mutateNotes(removeNote(notes, id)),
    },
  }));
}

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
 *
 * ## 语言迁移第十一批：这一屏（127 处）全部走字典
 * 文案在 `dict/canvas.ts`（`canvas.*`）。三处**不是"把字符串换成 t()"** 的地方，写在这里免得被改回去：
 * 1. `EDGE_STYLE` / `COST_SOURCE_KEYS` 是**模块级常量** —— 它们在模块加载那一刻就把语言定死，
 *    所以改成**键表 + 取值函数**（与 `lib/format.ts` 的 `statusLabel` 同手法）；
 * 2. 血缘按钮的 `dir`（`up` / `down`）**不能直接存翻译后的箭头文字**：它同时被用作 React key，
 *    换成随语言变化的值会让这些按钮在切语言时被整体重挂（白掉一帧）；
 * 3. 句子里夹 `<strong>` / `<b>` 的那几段（编排顶栏说明、导入确认）按本仓惯例**拆段**，
 *    边界空格（如 `'； 上游…'`）写进字典值 —— 那是 JSX 把跨行文本合成一个空格的结果。
 */

/**
 * 边的样式表（V2.26）。
 *
 * 语言迁移第十一批：`text` 改成 **`textKey`**（字典键）—— 这里是个**模块级常量**，
 * 在模块加载那一刻就定死了一种语言；而图例要在**渲染那一刻**取文案。
 * 与 `WorkbenchView` 那次（`ENHANCE_NOTICE` 改字典键）是同一类"迁移不是替换字符串"。
 */
const EDGE_STYLE: Record<LineageEdgeKind, { stroke: string; dash?: string; textKey: MessageKey }> = {
  edit: { stroke: 'var(--gold)', textKey: 'canvas.edge.edit' },
  extract: { stroke: 'var(--blue)', textKey: 'canvas.edge.extract' },
  reference: { stroke: 'var(--muted)', textKey: 'canvas.edge.reference' },
  'task-ref': { stroke: 'var(--gold-line)', dash: '6 4', textKey: 'canvas.edge.taskRef' },
};

const EDGE_KINDS: LineageEdgeKind[] = ['edit', 'extract', 'reference', 'task-ref'];

/**
 * V2.25（台账 B44）：画布每次加载的条数（生成 / 剪辑两类**各自**取这么多）。
 *
 * 50 = 服务端省略 `?limit=` 时的默认值（V2.25 之前写死的那个数）—— 首屏行为与过去完全一致，
 * 「加载更早」每次再向前翻一页。**不要**把它当"画布上限"：上限现在是用户的点击次数。
 */
const CANVAS_PAGE_SIZE = 50;

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
const CanvasToolbar: FC<{
  selectedIds: string[];
  onAddNote: (x: number, y: number) => void;
  /** V2.25（B44）：还有更早的任务可加载吗（两类来源取或，服务端的 `hasMore` 汇总而来） */
  hasMore: boolean;
  loadingEarlier: boolean;
  onLoadEarlier: () => void;
  /** V2.26（A5 片 A）：编排模式 —— 事实图与编排图是**同一张画布的两个模式** */
  planMode: boolean;
  onTogglePlan: () => void;
  onAddPlanNode: (x: number, y: number) => void;
  onRunPlan: () => void;
  /** V2.29（A5 片 B / B69）：**显式重跑**（换一代幂等键 —— 会真的新建任务） */
  onRerunPlan: () => void;
  running: boolean;
  /** 当前能跑的节点数（空 / 被阻断的不算）—— 按钮上直接写出来，省得点了才发现没东西可跑 */
  runnableCount: number;
  /** V2.29（B69）：当前运行代数（界面如实展示"第几轮"） */
  runSeq: number;
  /** V2.35（A5 片 B 收口）：编排导出 / 导入文件（格式见契约 §11-6 附；不进服务端） */
  onExportPlan: () => void;
  onImportPlanFile: (file: File) => void;
}> = ({
  selectedIds,
  onAddNote,
  hasMore,
  loadingEarlier,
  onLoadEarlier,
  planMode,
  onTogglePlan,
  onAddPlanNode,
  onRunPlan,
  onRerunPlan,
  running,
  runnableCount,
  runSeq,
  onExportPlan,
  onImportPlanFile,
}) => {
  const { fitView, screenToFlowPosition } = useReactFlow();
  const t = useTranslate();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const count = selectedIds.length;
  const viewportCenter = (): { x: number; y: number } =>
    screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

  return (
    <div className="cv-tools">
      {/* V2.26（台账 A5 片 A）：编排 ↔ 事实图 的切换（同一张画布的两个模式） */}
      <button
        type="button"
        className="cv-tool"
        data-testid="cv-toggle-plan"
        title={t(planMode ? 'canvas.tool.togglePlan.off' : 'canvas.tool.togglePlan.on')}
        onClick={onTogglePlan}
      >
        {t(planMode ? 'canvas.tool.togglePlan.labelFact' : 'canvas.tool.togglePlan.labelPlan')}
      </button>
      {planMode ? (
        <>
          <button
            type="button"
            className="cv-tool"
            data-testid="cv-add-plan-node"
            title={t('canvas.tool.addNode.title')}
            onClick={() => {
              const center = viewportCenter();
              onAddPlanNode(center.x, center.y);
            }}
          >
            {t('canvas.tool.addNode.label')}
          </button>
          <button
            type="button"
            className="cv-tool"
            data-testid="cv-run-plan"
            disabled={running || runnableCount === 0}
            title={
              runnableCount === 0
                ? t('canvas.tool.run.noneRunnable')
                : t('canvas.tool.run.title', { count: runnableCount })
            }
            onClick={onRunPlan}
          >
            {running
              ? t('canvas.tool.run.running')
              : runnableCount === 0
                ? t('canvas.tool.run.label')
                : t('canvas.tool.run.labelWithCount', { count: runnableCount })}
          </button>
          {/* V2.29（台账 B69）：**显式重跑** —— 换一代幂等键 = 真的新建任务。
              它必须与「▶ 运行编排」在视觉与文案上明确区分：前者是"补跑没跑成的"，
              后者是"整张图再来一遍（花钱）"。 */}
          <button
            type="button"
            className="cv-tool"
            data-testid="cv-rerun-plan"
            disabled={running || runnableCount === 0}
            title={
              runnableCount === 0
                ? t('canvas.tool.run.noneRunnable')
                : t('canvas.tool.rerun.title', {
                    count: runnableCount,
                    seq: runSeq,
                    next: runSeq + 1,
                  })
            }
            onClick={onRerunPlan}
          >
            {t('canvas.tool.rerun.label')}
          </button>
          {/* V2.35（A5 片 B 收口）：编排的导出 / 导入文件 —— 纯前端（浏览器下载 / 本地文件读取），
              零服务端交互。导出的是一份新的"编排身份"（见契约 §11-6 附 第 3 条）。 */}
          <button
            type="button"
            className="cv-tool"
            data-testid="cv-export-plan"
            title={t('canvas.tool.export.title')}
            onClick={onExportPlan}
          >
            {t('canvas.tool.export.label')}
          </button>
          <button
            type="button"
            className="cv-tool"
            data-testid="cv-import-plan"
            title={t('canvas.tool.import.title')}
            onClick={() => importInputRef.current?.click()}
          >
            {t('canvas.tool.import.label')}
          </button>
          <input
            ref={importInputRef}
            type="file"
            hidden
            accept="application/json,.json"
            data-testid="cv-import-plan-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // 先清空再处理：否则"再选同一个文件"不会再触发 change（浏览器行为），
              // 用户会以为导入没反应 —— 而这正是"重试一次"最常见的动作。
              event.target.value = '';
              if (file !== undefined) onImportPlanFile(file);
            }}
          />
        </>
      ) : (
        /* V2.25（台账 B44）：把"能看多少"交给用户 —— 每点一次向前翻一页（50 条），
           翻完**置灰并写明原因**（不是点了没反应）。 */
        <button
          type="button"
          className="cv-tool"
          data-testid="cv-load-earlier"
          disabled={!hasMore || loadingEarlier}
          title={
            loadingEarlier
              ? t('canvas.tool.earlier.loading')
              : hasMore
                ? t('canvas.tool.earlier.more', { size: CANVAS_PAGE_SIZE })
                : t('canvas.tool.earlier.none')
          }
          onClick={onLoadEarlier}
        >
          {loadingEarlier
            ? t('canvas.tool.earlier.labelLoading')
            : hasMore
              ? t('canvas.tool.earlier.labelMore')
              : t('canvas.tool.earlier.labelDone')}
        </button>
      )}
      <button
        type="button"
        className="cv-tool"
        data-testid="cv-zoom-selection"
        disabled={count === 0}
        title={
          count === 0
            ? t('canvas.tool.zoomSelection.hint')
            : t('canvas.tool.zoomSelection.title', { count })
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
        {count === 0
          ? t('canvas.tool.zoomSelection.label')
          : t('canvas.tool.zoomSelection.labelWithCount', { count })}
      </button>
      {/* V2.22（台账 B67）：便签落在**当前视口中心**（落在看不见的地方等于没建） */}
      <button
        type="button"
        className="cv-tool"
        data-testid="cv-add-note"
        title={t('canvas.tool.addNote.title')}
        onClick={() => {
          const center = screenToFlowPosition({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
          });
          onAddNote(center.x, center.y);
        }}
      >
        {t('canvas.tool.addNote.label')}
      </button>
      <button
        type="button"
        className="cv-tool"
        data-testid="cv-zoom-all"
        title={t('canvas.tool.fitAll.title')}
        onClick={() => {
          void fitView({ duration: 400, padding: 0.2, maxZoom: 1.6 });
        }}
      >
        {t('canvas.tool.fitAll.label')}
      </button>
    </div>
  );
};

// V2.26（A5 片 A）：模式文案收口到 `canvas/labels.ts`（编排节点卡片与事实图检查器共用一份，
// 两处各写一遍必然漂移 —— 同一个模式在两处叫不同名字会让用户以为是两个东西）。
// 语言迁移第十批：`label 表` 变成 `canvasModeLabel()`（按当前语言取，底层是 `common.mode.*`）——
// 视图这一屏的其余文案仍在**片 B** 的后续批次里迁，这一处先跟上（否则词表删了它会编译不过）。

/**
 * 成本来源的显示名（V2.19）。
 *
 * 语言迁移第十一批：常量表改成**键表 + 取值函数**（与 `lib/format.ts` 的 `statusLabel` 同手法）——
 * 模块级常量在模块加载那一刻就把语言定死了，而这个值要跟着界面语言走。
 */
const COST_SOURCE_KEYS: Record<CostRecord['source'], MessageKey> = {
  estimate: 'canvas.costSource.estimate',
  'local-free': 'canvas.costSource.localFree',
  upstream: 'canvas.costSource.upstream',
};

function costSourceLabel(source: CostRecord['source']): string {
  return translate(getLanguage(), COST_SOURCE_KEYS[source]);
}

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

  const t = useTranslate();

  if (error !== null) {
    return <p className="wb-note cv-insp-warn">{t('canvas.trail.error', { reason: error })}</p>;
  }
  if (items === null) return <p className="wb-note">{t('canvas.trail.loading')}</p>;
  if (items.length === 0) {
    return <p className="wb-note">{t('canvas.trail.empty')}</p>;
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
  graph,
  catalog,
  upstream,
  downstream,
  onSelect,
  onClose,
}: {
  node: LineageNode;
  /** 全图（导出配方包要沿血缘回溯上游闭包） */
  graph: LineageGraph;
  /** 当前画布上的全部节点（按 id 索引）—— 用来判断"引用能不能跳"，以及跳到哪里 */
  catalog: Map<string, LineageNode>;
  upstream: LineageNode[];
  downstream: LineageNode[];
  onSelect: (node: LineageNode) => void;
  onClose: () => void;
}) {
  const t = useTranslate();
  const taskId = node.kind === 'task' ? node.taskId : undefined;
  const assetId = node.kind === 'asset' ? node.assetId : undefined;
  // V2.40：产物可能是视频或图片（`t2i`）—— 两条各自解析，渲染时按类型分支
  const videoUrl = resolveMediaUrl(node.outputVideoUrl ?? undefined);
  const imageUrl = resolveMediaUrl(node.outputImageUrl ?? undefined);
  const task = node.task;
  const asset = node.asset;
  const request = task?.requestSnapshot;
  const sizeText = formatBytes(task?.outputSizeBytes);
  /** 导出配方包的结果反馈（成功给计数、失败给原因 —— 不静默） */
  const [exportResult, setExportResult] = useState<string | null>(null);

  const exportPack = (): void => {
    try {
      const pack = buildRecipePack(graph, node.id);
      downloadText(
        `${JSON.stringify(pack, null, 2)}\n`,
        `recipe-pack-${(node.taskId ?? node.id).slice(0, 8)}.json`,
      );
      setExportResult(
        pack.omitted.length === 0
          ? t('canvas.insp.export.done', { tasks: pack.tasks.length, assets: pack.assets.length })
          : t('canvas.insp.export.doneWithOmitted', {
              tasks: pack.tasks.length,
              assets: pack.assets.length,
              omitted: pack.omitted.length,
            }),
      );
    } catch (caught) {
      setExportResult(t('canvas.insp.export.failed', { reason: describeError(caught) }));
    }
  };

  /** 输入素材（首帧 / 尾帧 / 视频参考）→ 引用值转成节点 id（能不能跳由 catalog 决定） */
  const inputs: Array<{ label: string; value: string; nodeId: string }> = [];
  if (request !== undefined) {
    const assets = request.assets;
    if (assets?.firstFrameImage !== undefined) {
      inputs.push({ label: t('canvas.insp.input.firstFrame'), value: assets.firstFrameImage, nodeId: refToNodeId(assets.firstFrameImage) });
    }
    if (assets?.lastFrameImage !== undefined) {
      inputs.push({ label: t('canvas.insp.input.lastFrame'), value: assets.lastFrameImage, nodeId: refToNodeId(assets.lastFrameImage) });
    }
    if (assets?.referenceVideo !== undefined) {
      inputs.push({ label: t('canvas.insp.input.referenceVideo'), value: assets.referenceVideo, nodeId: refToNodeId(assets.referenceVideo) });
    }
  }

  return (
    <aside className="cv-drawer" aria-label={t('canvas.insp.aria')}>
      <div className="cv-drawer-head">
        <span className="cv-drawer-title">
          {node.isEdit === true ? '✂ ' : ''}
          {node.label}
        </span>
        <button type="button" className="cr-link" aria-label={t('canvas.insp.close')} onClick={onClose}>
          ✕
        </button>
      </div>
      <p className="wb-note" data-testid="cv-insp-sub">
        {node.sublabel} · {formatMoment(node.createdAt)}
      </p>

      {node.ghost === true ? (
        <p className="wb-note cv-drawer-ghost">{t('canvas.insp.ghost')}</p>
      ) : null}

      {videoUrl === null ? null : <video className="cv-player" src={videoUrl} controls playsInline />}
      {imageUrl === null ? null : (
        <img className="cv-player" src={imageUrl} alt={t('canvas.insp.imageAlt')} />
      )}

      {task === undefined ? null : (
        <>
          <section className="cv-insp-section">
            <h3 className="cv-insp-title">{t('canvas.insp.section.prompt')}</h3>
            <p className="cv-insp-prompt">{request?.prompt ?? t('canvas.insp.noSnapshot')}</p>
            <dl className="cv-insp-kv">
              <div>
                <dt>{t('canvas.insp.kv.mode')}</dt>
                <dd>{request === undefined ? '—' : canvasModeLabel(request.mode)}</dd>
              </div>
              <div>
                <dt>{t('canvas.insp.kv.aspect')}</dt>
                <dd>{request?.aspectRatio ?? '—'}</dd>
              </div>
              <div>
                <dt>{t('canvas.insp.kv.duration')}</dt>
                <dd>{request?.params?.durationSec === undefined ? '—' : `${request.params.durationSec}s`}</dd>
              </div>
              <div>
                <dt>{t('canvas.insp.kv.engine')}</dt>
                <dd>{request?.provider ?? '—'}</dd>
              </div>
              <div>
                <dt>{t('canvas.insp.kv.seed')}</dt>
                <dd>
                  {request?.params?.seed === undefined
                    ? t('canvas.insp.seedRandom')
                    : String(request.params.seed)}
                </dd>
              </div>
              <div>
                <dt>{t('canvas.insp.kv.output')}</dt>
                <dd>{sizeText ?? (node.hasOutput === true ? t('canvas.insp.outputDone') : t('canvas.insp.outputNone'))}</dd>
              </div>
            </dl>
          </section>

          {inputs.length === 0 ? null : (
            <section className="cv-insp-section">
              <h3 className="cv-insp-title">{t('canvas.insp.section.inputs')}</h3>
              <div className="cv-insp-links">
                {inputs.map((item) => {
                  const target = catalog.get(item.nodeId);
                  return (
                    <button
                      key={item.label}
                      type="button"
                      className="cv-jump"
                      disabled={target === undefined}
                      title={
                        target === undefined
                          ? t('canvas.insp.jump.missing')
                          : t('canvas.insp.jump.go')
                      }
                      onClick={() => {
                        if (target !== undefined) onSelect(target);
                      }}
                    >
                      {item.label}：{item.value.slice(0, 22)}
                      {target === undefined ? t('canvas.insp.jump.offCanvas') : ''}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section className="cv-insp-section">
            <h3 className="cv-insp-title">{t('canvas.insp.section.cost')}</h3>
            {task.cost === undefined ? (
              <p className="wb-note">{t('canvas.insp.cost.unrecorded')}</p>
            ) : (
              <>
                <p className="cv-insp-cost">
                  {formatYuan(task.cost.yuan)}
                  <span className="cv-insp-cost-note">
                    {task.cost.source !== 'local-free' && !task.cost.fromPriceTable
                      ? t('canvas.insp.cost.noteFallback', {
                          source: costSourceLabel(task.cost.source),
                        })
                      : t('canvas.insp.cost.note', { source: costSourceLabel(task.cost.source) })}
                  </span>
                </p>
                <p className="wb-note" title={task.cost.formula}>
                  {t('canvas.insp.cost.model', {
                    model: task.cost.modelId,
                    seconds: task.cost.outputSeconds,
                    width: task.cost.width,
                    height: task.cost.height,
                  })}
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
              <h3 className="cv-insp-title">
                {t('canvas.insp.section.warnings', { count: task.warnings.length })}
              </h3>
              {task.warnings.map((warning) => (
                <p key={warning} className="wb-note cv-insp-warn">
                  ⚠ {warning}
                </p>
              ))}
            </section>
          )}

          {task.error === undefined ? null : (
            <section className="cv-insp-section">
              <h3 className="cv-insp-title">{t('canvas.insp.section.error')}</h3>
              <p className="wb-note cv-insp-bad">
                【{task.error.code}】{task.error.message}
              </p>
              <p className="wb-note">
                {t('canvas.insp.error.disposition', { text: task.error.disposition })}
              </p>
            </section>
          )}

          <section className="cv-insp-section">
            <h3 className="cv-insp-title">{t('canvas.insp.section.trail')}</h3>
            <NodeLogList taskId={task.taskId} />
            <button type="button" className="cr-link" onClick={() => navigate('#/logs')}>
              {t('canvas.insp.trail.all')}
            </button>
          </section>
        </>
      )}

      {asset === undefined ? null : (
        <section className="cv-insp-section">
          <h3 className="cv-insp-title">{t('canvas.insp.section.asset')}</h3>
          <dl className="cv-insp-kv">
            <div>
              <dt>{t('canvas.insp.kv.assetKind')}</dt>
              <dd>{asset.kind}</dd>
            </div>
            <div>
              <dt>MIME</dt>
              <dd>{asset.mime}</dd>
            </div>
            <div>
              <dt>{t('canvas.insp.kv.assetSize')}</dt>
              <dd>{formatBytes(asset.size) ?? '—'}</dd>
            </div>
            <div>
              <dt>{t('canvas.insp.kv.assetCreated')}</dt>
              <dd>{formatMoment(asset.createdAt)}</dd>
            </div>
          </dl>
        </section>
      )}

      {upstream.length === 0 && downstream.length === 0 ? null : (
        <section className="cv-insp-section">
          <h3 className="cv-insp-title">{t('canvas.insp.section.lineage')}</h3>
          <div className="cv-insp-links">
            {/**
             * ⚠️ `dir` 是**稳定标记**（`up` / `down`），不是显示文案 —— 它同时被用作 React key：
             * 把翻译后的箭头文字当 key，切语言时这些按钮会被整体**重挂**（白掉一帧）。
             * 显示名在下面按语言取（`canvas.insp.lineage.upstream` / `.downstream`）。
             */}
            {[
              ...upstream.map((item) => ({ item, dir: 'up' as const })),
              ...downstream.map((item) => ({ item, dir: 'down' as const })),
            ].map(({ item, dir }) => (
              <button
                key={`${dir}-${item.id}`}
                type="button"
                className="cv-jump"
                title={t('canvas.insp.jump.go')}
                onClick={() => onSelect(item)}
              >
                {t(dir === 'up' ? 'canvas.insp.lineage.upstream' : 'canvas.insp.lineage.downstream')} ·{' '}
                {item.label}
              </button>
            ))}
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
            {t('canvas.insp.action.reuse')}
          </button>
          <button
            type="button"
            className="wb-btn"
            disabled={node.hasOutput !== true}
            onClick={() => navigate(`#/edit?task=${encodeURIComponent(taskId)}`)}
          >
            {t('canvas.insp.action.toEdit')}
          </button>
          <button
            type="button"
            className="wb-btn"
            disabled={node.hasOutput !== true}
            onClick={() => navigate(`#/workbench?refTask=${encodeURIComponent(taskId)}`)}
          >
            {t('canvas.insp.action.asReference')}
          </button>
          {/* V2.20（台账 B65）：把"这条片子的完整配方链"导出成可复用 / 可归档的 JSON */}
          <button
            type="button"
            className="wb-btn"
            data-testid="cv-export-pack"
            title={t('canvas.insp.exportPack.title')}
            onClick={exportPack}
          >
            {t('canvas.insp.exportPack.label')}
          </button>
          {exportResult === null ? null : (
            <p className="wb-note cv-insp-warn" data-testid="cv-export-result">
              {exportResult}
            </p>
          )}
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
              {t('canvas.insp.action.asFirstFrame')}
            </button>
          ) : null}
          {node.url === null || node.url === undefined ? null : (
            <a className="wb-btn" href={node.url} target="_blank" rel="noreferrer">
              {t('canvas.insp.action.openOriginal')}
            </a>
          )}
        </div>
      )}
    </aside>
  );
}

export function CanvasView() {
  // V2.11（B47）：血缘画布按当前项目取材
  const { projectId, byok } = useShell();
  const t = useTranslate();
  const route = useHashRoute();
  /**
   * V2.26（台账 A5 片 A）：**编排模式**（`#/canvas?mode=plan`）。
   *
   * 为什么用 hash 参数而不是一个组件状态：模式是"你在看哪张图"的一部分 ——
   * 刷新/分享链接要能落回同一个模式（与 `#/edit?task=` 同一条约定，见 CONTRACT §11-6）。
   */
  const planMode = route.query.get('mode') === 'plan';
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
  /** 画布便签（V2.22 / B67）：按项目存本机，零契约 */
  const [notes, setNotes] = useState<CanvasNote[]>([]);
  /**
   * V2.25（台账 B44）：分页状态。
   * `before` = 已加载数据里最旧一条的 `createdAt`（下一页游标）；`hasMore` = 服务端说还有更早的。
   */
  const [page, setPage] = useState<{ hasMore: boolean; before: number | null }>({
    hasMore: false,
    before: null,
  });
  const [loadingEarlier, setLoadingEarlier] = useState(false);

  // ── 编排（V2.26 / 台账 A5 片 A）────────────────────────────────────────────
  const [plan, setPlan] = useState<CanvasPlan>(() => createEmptyPlan());
  const [planLoaded, setPlanLoaded] = useState(false);
  /** 用户是否**真的动过**编排：只有动过才落盘 —— 否则会把"读不出来的旧编排"覆盖掉 */
  const [planDirty, setPlanDirty] = useState(false);
  const [planBroken, setPlanBroken] = useState(false);
  const [selectedPlanNodeId, setSelectedPlanNodeId] = useState<string | null>(null);
  const [runOutcome, setRunOutcome] = useState<PlanRunOutcome | null>(null);
  const [running, setRunning] = useState(false);
  const [planNotice, setPlanNotice] = useState<string | null>(null);
  /**
   * V2.35（A5 片 B 收口）：编排文件的提示（导出成功 / 导入结果 / 导入失败）。
   *
   * 为什么**独立于** `planNotice`：运行结果与文件操作是两件不同的事 —— 混用一个位会让
   * "运行结果"把"导入说了什么"顶掉（或反过来），而两条信息用户都需要看到。
   * `notes` 是文件里写给接收方的话（含"这份文件不含什么"），逐条展示、不折叠。
   */
  const [planFileNotice, setPlanFileNotice] = useState<{ text: string; notes: string[] } | null>(null);
  /** 待确认的导入（当前编排非空时不静默覆盖 —— 两步确认，照 `ProjectSwitcher` 的删除同款） */
  const [pendingImport, setPendingImport] = useState<{ plan: CanvasPlan; notes: string[] } | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      // 三个既有只读接口，零契约变更（生成产物 + 剪辑产物 + 资产库）
      // V2.11（B47）：三者都按当前项目过滤（血缘图是"这个项目里的片子怎么长出来的"）
      // V2.25（B44）：显式 `limit`（两类各自一页）+ 用响应的 `hasMore` 决定「加载更早」是否可用
      const [generated, edits, assetList] = await Promise.all([
        fetchHistory({ project: projectId, limit: CANVAS_PAGE_SIZE }),
        fetchHistory({ kind: 'edit', project: projectId, limit: CANVAS_PAGE_SIZE }),
        fetchAssets(projectId),
      ]);
      const merged = mergeCanvasTasks([...generated.items, ...edits.items], []);
      setTasks(merged);
      setAssets(assetList.assets);
      setPage({
        hasMore: combineHasMore(generated.hasMore, edits.hasMore),
        before: oldestCreatedAt(merged),
      });
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  /**
   * V2.25（台账 B44）：「加载更早」—— 以当前最旧一条的 `createdAt` 为游标，两类各自再取一页，
   * 合并去重后重算游标与 `hasMore`。加载期间按钮置灰（防连点重复拉同一页）。
   */
  const loadEarlier = useCallback(async (): Promise<void> => {
    if (page.before === null || loadingEarlier) return;
    setLoadingEarlier(true);
    try {
      const [generated, edits] = await Promise.all([
        fetchHistory({ project: projectId, limit: CANVAS_PAGE_SIZE, before: page.before }),
        fetchHistory({ kind: 'edit', project: projectId, limit: CANVAS_PAGE_SIZE, before: page.before }),
      ]);
      const merged = mergeCanvasTasks(tasks, [...generated.items, ...edits.items]);
      setTasks(merged);
      setPage({
        hasMore: combineHasMore(generated.hasMore, edits.hasMore),
        before: oldestCreatedAt(merged),
      });
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoadingEarlier(false);
    }
  }, [page.before, loadingEarlier, projectId, tasks]);

  // 事实图数据：首次挂载 / 切项目 / **从编排切回来**都要重拉 ——
  // 编排刚提交的任务必须能在事实图里看到（否则"提交了但图里没有"像是丢了）
  useEffect(() => {
    if (!planMode) void reload();
  }, [planMode, reload]);

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

  // 便签：进画布读一次（按项目），之后每次改动就地写回（量小，不做防抖）
  useEffect(() => {
    setNotes(loadCanvasNotes(projectId).notes);
  }, [projectId]);

  // ── 编排：加载 / 落盘 / 编辑助手（V2.26 / 台账 A5 片 A）──────────────────────
  useEffect(() => {
    const loaded = loadCanvasPlan(projectId);
    setPlan(loaded.plan ?? createEmptyPlan());
    setPlanBroken(loaded.broken);
    setPlanDirty(false);
    setSelectedPlanNodeId(null);
    setRunOutcome(null);
    setPlanNotice(loaded.broken ? t('canvas.plan.brokenNotice') : null);
    // 文件提示与待确认的导入都属于"上一份编排"的上下文：切项目/重载时清掉，避免串项目
    setPlanFileNotice(null);
    setPendingImport(null);
    setPlanLoaded(true);
  }, [projectId]);

  /**
   * 编排落盘：**只在用户真的动过之后**（`planDirty`）。
   *
   * 为什么不在加载后立刻保存：那样会把"读不出来的旧编排"用一份空编排覆盖掉 ——
   * "打开看一眼"不该是破坏性操作（与 §11-2 附 的"坏草稿不静默丢"同一条纪律）。
   */
  useEffect(() => {
    if (!planLoaded || !planDirty) return;
    saveCanvasPlan(projectId, plan);
  }, [projectId, plan, planLoaded, planDirty]);

  /** 所有编辑都走这里：标记 dirty + 更新 state（落盘由上面的 effect 统一做） */
  const mutatePlan = useCallback((updater: (current: CanvasPlan) => CanvasPlan): void => {
    setPlan(updater);
    setPlanDirty(true);
  }, []);

  const runnableCount = useMemo(
    () =>
      planMode
        ? plan.nodes.filter((node) => planNodeBlockReason(plan, node.id) === null).length
        : 0,
    [planMode, plan],
  );

  const selectedPlanNode = useMemo(
    () => (selectedPlanNodeId === null ? null : (plan.nodes.find((node) => node.id === selectedPlanNodeId) ?? null)),
    [plan, selectedPlanNodeId],
  );

  /**
   * 「▶ 运行编排 / 🔁 重跑」（契约 §11-6 的执行语义）：拓扑序提交、幂等键确定性、不猜上游。
   *
   * 三种入口共用这一条路径（V2.29 / B68 + B69）：
   * - **运行**（`rerun` 省略）：代数不变 → 幂等键不变 → 连点两次**不会重复计费**；
   * - **重跑全部**（`rerun: true`）：代数 +1 → 键全变 → **真的新建任务**；
   * - **重跑此节点及下游**（`rerun: true` + `scope`）：只重提交"选中 ∪ 下游"，
   *   范围外沿用上次产物（引用来自写回的 `lastTaskId`）。
   */
  const runPlan = useCallback(
    async (options?: { rerun?: boolean; scope?: ReadonlyArray<string> }): Promise<void> => {
      if (running) return;
      const rerun = options?.rerun === true;
      // 显式重跑先把代数 +1 并**落盘**：否则刷新后回到旧代数，下一次「运行」会命中上一代的任务
      // —— 用户以为重跑了，其实什么都没发生。
      let base = plan;
      if (rerun) {
        base = bumpPlanRun(plan);
        mutatePlan(() => base);
      }

      setRunning(true);
      setPlanNotice(null);
      try {
        const providerKey = resolveProviderKey(byok);
        const outcome = await runCanvasPlan(base, {
          submit: async (body, idempotencyKey, planRunId) => {
            const created = await submitGenerate(
              // 与工作台同一条口径：BYOK 的服务端地址与模型名走 options（未识别键由服务端忽略）
              { ...body, options: { baseUrl: byok.baseUrl, model: byok.model } },
              {
                idempotencyKey,
                // 本轮运行 id：服务端据此把"一串节点"当成一次有意动作（只吃一次 60s 冷却）
                planRunId,
                ...(providerKey === undefined ? {} : { providerKey }),
              },
            );
            return { taskId: created.taskId };
          },
          // 等上游出片：`task:` 引用要求"已有可用成片"，否则下游提交会被服务端 404 挡回
          queryTask: (taskId) => fetchTask(taskId),
          ...(options?.scope === undefined ? {} : { scope: options.scope }),
        });
        setRunOutcome(outcome);

        // 把本轮的产物写回编排：下一轮"部分重跑"里范围外的节点，靠它给下游提供引用
        const submitted = new Map<string, string>();
        for (const item of outcome.results) {
          if (item.taskId !== undefined) submitted.set(item.nodeId, item.taskId);
        }
        if (submitted.size > 0) {
          const next = withRunTaskIds(base, submitted);
          mutatePlan(() => next);
        }

        if (outcome.cycle.length > 0) {
          setPlanNotice(t('canvas.plan.notice.cycle', { count: outcome.cycle.length }));
        } else {
          const ok = submitted.size;
          const kept = outcome.results.filter((item) => item.state === 'kept').length;
          const bad = outcome.results.filter(
            (item) => item.state === 'failed' || item.state === 'skipped',
          ).length;
          const parts = [t('canvas.plan.notice.submitted', { count: ok })];
          if (kept > 0) parts.push(t('canvas.plan.notice.kept', { count: kept }));
          if (bad > 0) parts.push(t('canvas.plan.notice.bad', { count: bad }));
          const head = rerun ? t('canvas.plan.notice.rerunHead', { seq: outcome.runSeq }) : '';
          // 分隔符也是排版事实（中文全角逗号 / 英文半角逗号 + 空格）→ 走字典，不写死在代码里
          setPlanNotice(head + parts.join(t('canvas.plan.notice.separator')));
        }
        // 提交出来的任务要立刻能在事实图里看到（切回去时不再等一次手动刷新）
        void reload();
      } catch (caught) {
        setPlanNotice(t('canvas.plan.notice.runFailed', { reason: describeError(caught) }));
      } finally {
        setRunning(false);
      }
    },
    [plan, running, byok, reload, mutatePlan],
  );

  /** 「▶ 运行编排」：代数不变（幂等） */
  const handleRunPlan = useCallback((): void => {
    void runPlan();
  }, [runPlan]);

  /** 「🔁 重跑全部」：代数 +1（真的新建任务） */
  const handleRerunPlan = useCallback((): void => {
    void runPlan({ rerun: true });
  }, [runPlan]);

  /** 「🔁 重跑此节点及下游」：代数 +1 + 只重跑选中 ∪ 下游 */
  const handleRerunFromNode = useCallback(
    (nodeId: string): void => {
      void runPlan({ rerun: true, scope: [nodeId] });
    },
    [runPlan],
  );

  /**
   * V2.35（A5 片 B 收口）：导出编排文件（契约 §11-6 附）。
   *
   * 导出的是**内存里这份**（不是 localStorage 里那份）：两者只在"刚改动、还没落盘"的瞬间不同，
   * 而用户按下导出时想要的一定是**眼前这份**。
   */
  const handleExportPlan = useCallback((): void => {
    const file = buildCanvasPlanFile(plan);
    downloadText(canvasPlanFileText(file), `canvas-plan-${plan.id.slice(0, 8)}.json`);
    setPlanFileNotice({
      text: t('canvas.plan.file.exported', {
        name: plan.name,
        nodes: plan.nodes.length,
        edges: plan.edges.length,
        notes: file.notes.length,
      }),
      notes: [],
    });
  }, [plan, t]);

  /** 导入成功后的**唯一落点**（两条路径共用：空编排直接装入 / 非空经两步确认） */
  const applyImportedPlan = useCallback(
    (imported: CanvasPlan, notes: string[]): void => {
      mutatePlan(() => imported);
      setPendingImport(null);
      setPlanFileNotice({
        text: t('canvas.plan.file.imported', {
          name: imported.name,
          nodes: imported.nodes.length,
          edges: imported.edges.length,
        }),
        notes,
      });
    },
    [mutatePlan, t],
  );

  /**
   * V2.35（A5 片 B 收口）：读一份导入文件。
   *
   * 三条口径（契约 §11-6 附）：
   * 1. **失败给人话原因**：解析函数说清是哪一类问题，这里只负责"如实展示 + 一动不动"；
   * 2. **导入 = 新编排身份**（`withNewPlanIdentity`）：避免两份同源编排在同一部署里互相命中对方的任务；
   * 3. **非空不静默覆盖**：走两步确认（当前为空则直接装入）—— 覆盖前提示"可以先导出留一份"。
   */
  const handleImportPlanFile = useCallback(
    (file: File): void => {
      void file
        .text()
        .then((text) => {
          const result = readCanvasPlanFile(text);
          if (!result.ok) {
            setPendingImport(null);
            setPlanFileNotice({
              text: t('canvas.plan.file.importRejected', { reason: result.reason }),
              notes: [],
            });
            return;
          }
          const adopted = withNewPlanIdentity(result.plan);
          if (plan.nodes.length === 0) {
            applyImportedPlan(adopted, result.notes);
            return;
          }
          setPendingImport({ plan: adopted, notes: result.notes });
          setPlanFileNotice(null);
        })
        .catch((caught: unknown) => {
          setPendingImport(null);
          setPlanFileNotice({
            text: t('canvas.plan.file.importUnreadable', { reason: describeError(caught) }),
            notes: [],
          });
        });
    },
    [plan.nodes.length, applyImportedPlan],
  );

  const mutateNotes = useCallback(
    (next: CanvasNote[]): void => {
      setNotes(next);
      saveCanvasNotes(projectId, next);
    },
    [projectId],
  );

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
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<CanvasFlowNode>([]);

  useEffect(() => {
    // 编排模式（V2.26 / A5 片 A）：节点 = 编排节点 + 便签（事实图数据一件不画 ——
    // "同一张画布的两个模式"是两个**互斥**的视图，混在一起会让人分不清哪张卡会花钱）
    if (planMode) {
      setFlowNodes([
        ...plan.nodes.map((node) => ({
          id: node.id,
          type: 'plan' as const,
          position: node.position,
          data: {
            node,
            run: runOutcome?.results.find((item) => item.nodeId === node.id),
          },
        })),
        ...noteFlowNodes(notes, mutateNotes),
      ]);
      return;
    }

    setFlowNodes([
      ...graph.nodes.map((node) => ({
        id: node.id,
        type: 'lineage' as const,
        position: layout.positions[node.id] ?? { x: 0, y: 0 },
        data: { node, near: nearIds.has(node.id) },
      })),
      // 便签与数据节点同住一个 nodes 数组（V2.22 / B67）：这样拖动它同样走 `onNodesChange`，
      // 位置才不会"拖完弹回去"
      ...noteFlowNodes(notes, mutateNotes),
    ]);
  }, [planMode, plan, runOutcome, graph, layout, nearIds, notes, mutateNotes, setFlowNodes]);

  /**
   * 画布快捷键（V2.22 / 台账 B67）：**只做两件在只读图上成立的事** ——
   * `Ctrl/Cmd+A` 全选、`Esc` 取消选择（配合 B64 的「缩放到选区」才有意义）。
   *
   * ⚠️ n8n 的另外两条快捷键在本画布上**不成立**，刻意不做（如实登记）：
   * `F2 改名`（我们的节点名来自提示词快照，不是可编辑字段）与 `Ctrl+D 复制`
   * （节点是**已发生的事实**，复制一条生成任务没有语义）。
   * 另外：正在写便签时不抢键（输入框里的 Ctrl+A 该是"全选文本"）。
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === 'TEXTAREA' ||
          target.tagName === 'INPUT' ||
          target.isContentEditable === true);
      if (typing) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setFlowNodes((nodes) => nodes.map((node) => ({ ...node, selected: true })));
        return;
      }
      if (event.key === 'Escape') {
        setFlowNodes((nodes) =>
          nodes.some((node) => node.selected === true)
            ? nodes.map((node) => ({ ...node, selected: false }))
            : nodes,
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setFlowNodes]);

  const flowEdges = useMemo<Edge[]>(() => {
    // 编排模式的边（V2.26）：**带箭头** —— 它是"数据流方向"（from 的产物喂给 to），
    // 与事实图的"派生关系"方向虽然同向，但语义不同（这边是"我打算这么接"）
    if (planMode) {
      return plan.edges.map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: 'var(--gold)' },
        style: { stroke: 'var(--gold)' },
      }));
    }

    return graph.edges.map((edge) => {
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
    });
  }, [planMode, plan, graph, flowingEdgeIds]);

  /**
   * React Flow 的**回调 props 必须稳定**（V2.26 实测教训，值得留痕）。
   *
   * 第一版把 `onConnect` / `onNodeClick` / `onSelectionChange` 全写成内联箭头函数 ——
   * 每次渲染都是新引用，而 React Flow 会把这些 props 同步进它的内部 store（effect 依赖它们）。
   * **平时看不出问题**，一旦开始**拖拽连线**（connection 状态高频变化）就变成
   * "props 变 → store 更新 → 重渲染 → props 又变"的循环：浏览器里报
   * `React error #185`（Maximum update depth exceeded），连线**直接失效**。
   * 修法：全部 `useCallback` / `useMemo`（依赖只放真正会变的值）。
   */
  const handleNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
      if (planMode) {
        // 编排模式：点节点 = 在右侧编辑它（便签不弹面板）
        if (node.type === 'plan') setSelectedPlanNodeId(node.id);
        return;
      }
      // 便签不是数据（没有 LineageNode）：点它不该弹检查器
      if (node.type === 'lineage') setSelected((node as LineageFlowNode).data.node);
    },
    [planMode],
  );

  const handleNodeDragStop = useCallback<OnNodeDrag<CanvasFlowNode>>(
    (_event, node) => {
      // 便签的位置**落存储**（事实图的数据节点位置是会话级的，D40 不变）
      if (node.type === 'note') {
        mutateNotes(updateNote(notes, node.id, { x: node.position.x, y: node.position.y }));
        return;
      }
      // 编排节点的位置**持久化**（V2.26：编排是本地产物，位置是它的一部分）
      if (planMode && node.type === 'plan') {
        mutatePlan((current) => movePlanNode(current, node.id, node.position));
      }
    },
    [planMode, mutateNotes, notes, mutatePlan],
  );

  const handleSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    setSelectedIds(params.nodes.map((node) => node.id));
  }, []);

  /**
   * V2.26（台账 A5 片 A）：**编排是唯一允许改结构的模式**。
   *
   * 三条连线纪律（与 `lib/canvasPlan.ts` 的 addPlanEdge 一一对应）：
   * 自环 / 重复边 / 连到不存在的节点都被拒（UI 上表现为"连不上"，不是静默接受）；
   * 真正"这条线能不能跑"的判定在执行期（`planNodeBlockReason`）——
   * **连线时不拦**：先让用户把想法画出来，不合法的地方在节点上说明白。
   *
   * 用 `useMemo` 包成**稳定对象**：理由同上（React Flow 会把它们同步进 store）。
   */
  const planInteractionProps = useMemo(
    () =>
      planMode
        ? {
            onConnect: (params: Connection) => {
              if (typeof params.source === 'string' && typeof params.target === 'string') {
                const { source, target } = params;
                mutatePlan((current) => addPlanEdge(current, source, target));
              }
            },
            onNodesDelete: (deleted: RFNode[]) => {
              for (const node of deleted) {
                if (node.type === 'plan') mutatePlan((current) => removePlanNode(current, node.id));
              }
            },
            onEdgesDelete: (deleted: Edge[]) => {
              for (const edge of deleted) mutatePlan((current) => removePlanEdge(current, edge.id));
            },
          }
        : {},
    [planMode, mutatePlan],
  );

  const nodeTypes = useMemo(
    () => ({ lineage: LineageNodeCard, note: NoteCard, plan: PlanNodeCard }),
    [],
  );

  const empty = !loading && tasks.length === 0;

  return (
    /* 用 `wb-page`（单列页面容器）而不是 `wb-main`：后者是**工作台三栏栅格**
       （`minmax(320px,380px) 1fr minmax(300px,360px)`）—— 画布塞进第一栏会被挤成 380px 宽 */
    <section className="wb-page">
      <div className="cv-wrap">
        <header className="cv-head">
          <div>
            <p className="cr-eyebrow">{planMode ? 'Canvas Plan' : 'Lineage Canvas'}</p>
            <h2 className="cv-title">
              {planMode ? t('canvas.title.plan') : t('canvas.title.lineage')}
            </h2>
          </div>
          {planMode ? (
            <p className="wb-note cv-plan-hint" data-testid="cv-plan-hint">
              {t('canvas.plan.hint.part1')}
              <strong>{t('canvas.plan.hint.part2')}</strong>
              {t('canvas.plan.hint.part3')}
              {t('canvas.plan.hint.part4')}
              <strong>{t('canvas.plan.hint.part5')}</strong>
              {t('canvas.plan.hint.part6')}
              <b>{t('canvas.plan.hint.part7')}</b>
              {t('canvas.plan.hint.part8')}
              <span data-testid="cv-plan-run-seq">
                {t('canvas.plan.runSeq', { seq: planRunSeq(plan) })}
              </span>
            </p>
          ) : (
            <div className="cv-legend" aria-label={t('canvas.legend.aria')}>
              {EDGE_KINDS.map((kind) => (
                <span key={kind} className="cv-legend-item">
                  <span className="cv-legend-line" style={{ backgroundColor: EDGE_STYLE[kind].stroke }} />
                  {t(EDGE_STYLE[kind].textKey)}
                </span>
              ))}
            </div>
          )}
        </header>

        {planMode && planBroken ? (
          <div className="wb-uncertain cv-alert" data-testid="cv-plan-broken">
            <span className="wb-uncertain-title">{t('canvas.plan.broken.title')}</span>
            <span className="wb-uncertain-body">{t('canvas.plan.broken.body')}</span>
          </div>
        ) : null}

        {planMode && planNotice !== null ? (
          <div className="cv-plan-notice" data-testid="cv-plan-notice">
            {planNotice}
          </div>
        ) : null}

        {/* V2.35（A5 片 B 收口）：编排文件的导出 / 导入结果 —— 与运行结果分开显示（两件事） */}
        {planMode && planFileNotice !== null ? (
          <div className="cv-plan-notice" data-testid="cv-plan-file-notice">
            {planFileNotice.text}
            {planFileNotice.notes.length === 0 ? null : (
              <ul className="cv-plan-file-notes">
                {planFileNotice.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {/* V2.35：非空时的**两步确认** —— 导入会替换当前编排，不能静默覆盖别人的工作
            （照 ProjectSwitcher 的删除确认：不用原生对话框，内联两步） */}
        {planMode && pendingImport !== null ? (
          <div className="cv-plan-notice cv-plan-import-confirm" data-testid="cv-import-confirm">
            <span>
              {t('canvas.plan.importConfirm.part1')}
              <strong>{t('canvas.plan.importConfirm.part2')}</strong>
              {t('canvas.plan.importConfirm.part3', {
                nodes: plan.nodes.length,
                edges: plan.edges.length,
                name: pendingImport.plan.name,
                fileNodes: pendingImport.plan.nodes.length,
              })}
            </span>
            <button
              type="button"
              className="wb-btn"
              data-testid="cv-import-confirm-yes"
              onClick={() => applyImportedPlan(pendingImport.plan, pendingImport.notes)}
            >
              {t('canvas.plan.importConfirm.yes')}
            </button>
            <button
              type="button"
              className="wb-btn"
              data-testid="cv-import-confirm-cancel"
              onClick={() => setPendingImport(null)}
            >
              {t('canvas.plan.importConfirm.cancel')}
            </button>
          </div>
        ) : null}

        {error === null ? null : (
          <div className="wb-uncertain cv-alert">
            <span className="wb-uncertain-title">{t('canvas.load.error')}</span>
            <span className="wb-uncertain-body">{error}</span>
          </div>
        )}

        {loading ? <p className="wb-note cv-note">{t('canvas.load.loading')}</p> : null}

        {empty ? (
          <div className="cv-empty">
            <p className="cv-empty-title">{t('canvas.empty.title')}</p>
            <p className="wb-note">{t('canvas.empty.body')}</p>
            <button type="button" className="wb-btn wb-btn-gold" onClick={() => navigate('#/create')}>
              {t('canvas.empty.action')}
            </button>
          </div>
        ) : null}

        {planMode ? (
          <p className="wb-note cv-note" data-testid="cv-plan-count">
            {t('canvas.plan.count', {
              nodes: plan.nodes.length,
              edges: plan.edges.length,
              runnable: runnableCount,
            })}
          </p>
        ) : null}

        {(planMode ? false : empty || loading) ? null : (
          <>
            {planMode ? null : (
              <p className="wb-note cv-note">
                {t('canvas.graph.summary', {
                  nodes: graph.nodes.length,
                  edges: graph.edges.length,
                })}
              </p>
            )}

            {/* V2.19（B63）：异常计数 + 排队实况 —— 把"图里哪里不对"和"为什么要等"都讲出来 */}
            {planMode ? null : (
            <div className="cv-status" data-testid="cv-status">
              <span className={problemIds.size === 0 ? 'cv-status-ok' : 'cv-status-bad'}>
                {problemIds.size === 0
                  ? t('canvas.status.allOk')
                  : t('canvas.status.problems', { count: problemIds.size })}
              </span>
              {problemIds.size === 0 ? null : (
                <button
                  type="button"
                  className="cv-tool"
                  data-testid="cv-focus-problems"
                  aria-pressed={onlyProblems}
                  title={t('canvas.status.onlyProblems.title')}
                  onClick={() => setOnlyProblems((value) => !value)}
                >
                  {t(onlyProblems ? 'canvas.status.showAll' : 'canvas.status.onlyProblems')}
                </button>
              )}
              {queue === null || queue.queued === 0 ? null : (
                <span className="cv-status-queue">
                  {t('canvas.status.queue', { count: queue.queued })}
                  {queue.oldestAgeSec === null
                    ? ''
                    : t('canvas.status.queueOldest', {
                        seconds: Math.round(queue.oldestAgeSec),
                      })}
                  {t('canvas.status.queueSingle')}
                </span>
              )}
            </div>
            )}

            <div
              className="cv-canvas"
              data-testid="cv-canvas"
              data-focus={planMode ? 'plan' : onlyProblems ? 'problems' : 'all'}
              /**
               * V2.25（台账 B44）：**数据层**的已加载节点数（含便签）。
               *
               * 为什么必须把它暴露出来：`onlyRenderVisibleElements` 之后，DOM 里的节点数
               * **只反映视口覆盖，不反映图里有多少数据** —— 大图上"DOM 数不变"其实
               * 完全可能意味着"数据在长、只是没进视口"。没有这个属性，冒烟就只能靠
               * DOM 数猜分页，而那是错的（第一版就是这样误判的）。
               */
              data-loaded-nodes={flowNodes.length}
            >
              <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                onNodesChange={onNodesChange}
                nodeTypes={nodeTypes}
                onNodeClick={handleNodeClick}
                onNodeDragStop={handleNodeDragStop}
                onSelectionChange={handleSelectionChange}
                {...planInteractionProps}
                nodesConnectable={planMode}
                deleteKeyCode={planMode ? 'Delete' : null}
                fitView
                minZoom={0.2}
                maxZoom={1.6}
                /**
                 * V2.25（台账 B44）：**视口裁剪** —— 只为视口内的节点建 DOM。
                 *
                 * 血缘图的形状很"窄高"（生成任务全在同一列，行数 = 任务数）：几百条任务就是
                 * 上万像素高的一列，`fitView` 会被 `minZoom` 钳到只能看到其中一小截 ——
                 * 也就是说**大图下大多数节点本来就在视口外**，为它们建 DOM 是纯浪费。
                 * 这条是纯前端的渲染开关（React Flow 自带），与分页（`?limit=`/`?before=`）互补：
                 * 分页决定"图里有多少数据"，它决定"屏幕上渲染多少"。
                 */
                onlyRenderVisibleElements
              >
                <Background gap={24} />
                <Controls showInteractive={false} />
                <CanvasToolbar
                  selectedIds={selectedIds}
                  onAddNote={(x, y) => mutateNotes(createNote(notes, { x, y }))}
                  hasMore={page.hasMore}
                  loadingEarlier={loadingEarlier}
                  onLoadEarlier={() => {
                    void loadEarlier();
                  }}
                  planMode={planMode}
                  onTogglePlan={() => navigate(planMode ? '#/canvas' : '#/canvas?mode=plan')}
                  /* 连续加节点自动往右下错开（一整张卡的宽度）：全部叠在视口中心 =
                     "加了 5 个但看起来只有 1 个"，而且点不到下面那些（V2.26 实测踩到） */
                  onAddPlanNode={(x, y) =>
                    mutatePlan((current) =>
                      addPlanNode(
                        current,
                        newPlanNode({
                          x: x + current.nodes.length * 300,
                          y: y + current.nodes.length * 40,
                        }),
                      ),
                    )
                  }
                  onRunPlan={handleRunPlan}
                  onRerunPlan={handleRerunPlan}
                  running={running}
                  runnableCount={runnableCount}
                  runSeq={planRunSeq(plan)}
                  onExportPlan={handleExportPlan}
                  onImportPlanFile={handleImportPlanFile}
                />
                <MiniMap
                  data-testid="cv-minimap"
                  position="bottom-right"
                  pannable
                  zoomable
                  maskColor="var(--canvas-veil)"
                  nodeColor={(node) => {
                    // ⚠️ 这个回调会拿到**所有**节点，包括便签（B67）—— 第一版直接读 `data.node.ghost`，
                    // 遇到便签时 `data.node` 是 undefined → 抛错 → **整页白屏**（没有 ErrorBoundary）。
                    // 画布上多一种节点类型，所有"按节点取色/取名"的回调都要先问类型。
                    if (node.type === 'note') return 'var(--line-gold)';
                    // 编排节点（V2.26）：统一主色（它还没有"执行过"的事实可着色）
                    if (node.type === 'plan') return 'var(--gold)';
                    const data = (node as LineageFlowNode).data.node;
                    if (data === undefined) return 'var(--muted)';
                    if (data.ghost === true) return 'var(--faint)';
                    return data.isEdit === true ? 'var(--blue)' : 'var(--gold)';
                  }}
                />
              </ReactFlow>
            </div>
            <p className="cv-mobile-note wb-note">
              {t('canvas.mobile.part1')}
              <button type="button" className="cr-link" onClick={() => navigate('#/library')}>
                {t('canvas.mobile.library')}
              </button>
              {t('canvas.mobile.part2')}
            </p>
          </>
        )}
      </div>

      {/* 右侧面板：编排模式 = 编辑节点；事实图 = 只读检查器（V2.26 / A5 片 A） */}
      {planMode
        ? selectedPlanNode === null
          ? null
          : (
              <PlanInspector
                plan={plan}
                node={selectedPlanNode}
                run={runOutcome?.results.find((item) => item.nodeId === selectedPlanNode.id)}
                onChange={(patch) =>
                  mutatePlan((current) => updatePlanNode(current, selectedPlanNode.id, patch))
                }
                onRemove={() => {
                  mutatePlan((current) => removePlanNode(current, selectedPlanNode.id));
                  setSelectedPlanNodeId(null);
                }}
                onClose={() => setSelectedPlanNodeId(null)}
                onRerun={() => handleRerunFromNode(selectedPlanNode.id)}
                onPin={(taskId) =>
                  mutatePlan((current) => pinPlanNode(current, selectedPlanNode.id, taskId))
                }
                onUnpin={() => mutatePlan((current) => unpinPlanNode(current, selectedPlanNode.id))}
                onRetryChange={(retry) =>
                  mutatePlan((current) => setPlanNodeRetry(current, selectedPlanNode.id, retry))
                }
                running={running}
              />
            )
        : selected === null
          ? null
          : (
              <CanvasInspector
                node={selected}
                graph={graph}
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
