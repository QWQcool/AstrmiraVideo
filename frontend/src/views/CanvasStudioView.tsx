import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useNodesState,
  type Connection,
  type Edge,
  type Node as RFNode,
  type NodeTypes,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  BUILTIN_SKILLS,
  createCanvasNode,
  createEmptyCanvasDoc,
  type CanvasDocNode,
  type CanvasDoc,
  type CanvasNodeType,
  type CanvasNodeProposal,
  type CanvasTextNodeUpdateProposal,
  type CanvasProjectIndex,
  type CanvasReferenceRole,
  type StoryboardExpansion,
  type TaskProgress,
  type VideoGenerateRequest,
} from '@astrmira/shared';
import type { AssetListEntry } from '@astrmira/shared';
import {
  ApiError,
  deleteCanvasDoc,
  fetchAssets,
  fetchCanvasDoc,
  fetchCanvasIndex,
  fetchTask,
  resolveMediaUrl,
  saveCanvasDoc,
  submitGenerate,
  uploadAssets,
} from '../lib/api';
import { isModalLayerOpen } from '../lib/modalLayer';
import { mapWithConcurrency } from '../lib/concurrency';
import {
  addCanvasBatch,
  addCanvasNode,
  addCanvasNodesFromAssets,
  canvasActiveTasks,
  canvasBatchPatchFromTask,
  canvasDocCounts,
  canvasLostActiveTaskNodes,
  canvasNodeActiveBatches,
  canvasNodeVisibleOutput,
  canvasNodeTitle,
  duplicateCanvasNode,
  findCanvasNode,
  insertCanvasNodes,
  moveCanvasNode,
  nextCanvasNodePosition,
  nextCanvasNodePositions,
  selectCanvasNodeBatch,
  patchCanvasBatch,
  removeCanvasNodes,
  renameCanvasDoc,
  updateCanvasNodeDraft,
  type CanvasDraftPatch,
} from '../lib/canvasDocOps';
import {
  canRedoCanvas,
  canUndoCanvas,
  createCanvasHistory,
  recordCanvasHistory,
  redoCanvasHistory,
  undoCanvasHistory,
} from '../lib/canvasHistory';
import {
  buildCanvasGenerateRequest,
  buildCanvasUpscaleRequest,
  canvasAspectRatio,
  canvasDefaultProvider,
  canvasSubmitIssue,
  canvasSubmitIssueText,
  stripCanvasMentions,
} from '../lib/canvasNodeSubmit';
import { resolveProviderKey } from '../lib/byok';
import { comfyUiEngineOptions, httpServiceEngineOptions } from '../lib/engineOptions';
import { createCanvasSaveQueue, type CanvasSaveState } from '../lib/canvasSaveQueue';
import { navigate, parseHash } from '../lib/router';
import {
  clearCanvasResultHandoff,
  peekCanvasResultHandoff,
  resultHandoffAsset,
  type CanvasResultHandoff,
} from '../lib/canvasHandoff';
import {
  appendAgentCanvasPlan,
  buildAgentCanvasPlan,
} from '../lib/agentCanvas';
import {
  clearAgentCanvasHandoff,
  peekAgentCanvasHandoff,
} from '../lib/agentCanvasHandoff';
import { loadSkillLibrary } from '../lib/skills';
import { newIdempotencyKey } from '../lib/idempotency';
import {
  addCanvasDependencyEdge,
  addCanvasLineageEdge,
  planCanvasDependency,
  planCanvasLineage,
  referenceLimit,
  removeCanvasLineageEdge,
  type CanvasDependencyProblem,
  type CanvasLineageProblem,
} from '../lib/canvasLineage';
import { reconcileReferenceLineage } from '../lib/canvasReferenceLineage';
import {
  canvasEdgeSummary,
  edgeShortId,
  type CanvasEdgeEndpoint,
  type CanvasEdgeSummary,
} from '../lib/canvasEdgeSummary';
import {
  appendStoryboardLanding,
  buildStoryboardLanding,
  storyboardLandingOrigin,
} from '../lib/storyboardLanding';
import { useTranslate, type MessageKey } from '../lib/i18n';
import { useShell } from '../lib/shell';
import {
  defaultCanvasName,
  newCanvasProjectId,
  pickInitialCanvasProject,
  readActiveCanvasProjectId,
  removeCanvasProject,
  setActiveCanvasProject,
  upsertCanvasProject,
  writeActiveCanvasProjectId,
} from '../lib/canvasProjects';
import { AssetPickerDialog } from '../canvas/studio/AssetPickerDialog';
import {
  addReferencesToDraft,
  allowedKindsForReferenceTarget,
  referenceThumbnailPath,
} from '../lib/canvasReferences';
import { reuseFromBatch } from '../lib/canvasNodeReuse';
import type { ReferenceSourceItem } from '../lib/referenceSources';
import { CanvasContextMenu, type CanvasMenuItem } from '../canvas/studio/CanvasContextMenu';
import { CanvasAgentPanel } from '../components/CanvasAgentPanel';
import { CanvasNodeInspector } from '../components/CanvasNodeInspector';
import { StudioNode } from '../canvas/studio/StudioNode';
import { StudioProvider, type ReferencePreview } from '../canvas/studio/StudioContext';

/**
 * 创作画布（Step 11-S3 片 B2 骨架 + 片 B3 编辑器；CONTRACT §21 / 设计基准 §7.3）。
 *
 * B3 补齐四件事：
 * 1. **节点浮动创作框**：选中节点 → 写提示词 → 提交（`origin:'canvas'`），状态与产物写回 `data.batches`；
 * 2. **资产库多选 / 本地上传**：每项一个节点 + 一个 `succeeded` 批次；
 * 3. **删除 / 复制 / 右键菜单 / 撤销栈**：撤销只覆盖编辑动作，批次是服务端事实；
 * 4. **不装可用**：未配置的能力在节点里如实给理由（见 `lib/canvasNodeSubmit.ts`）。
 *
 * 旧只读血缘图仍在隐藏路由 `#/lineage`，等 B4 把来源边做进新画布后下线。
 */

type StudioRfNode = RFNode<Record<string, unknown>, 'studio'>;

/** 必须模块级：内联对象会让 React Flow 每渲染一次就重建节点类型（节点卡会被卸载重挂） */
const NODE_TYPES: NodeTypes = { studio: StudioNode };

const ADDABLE: readonly CanvasNodeType[] = ['text', 'image', 'video', 'audio'];

/** 稳定的空边数组（避免 `edges={[]}` 被推断成 never[]） */
const NO_EDGES: Edge[] = [];
/** 画布轮询并发上限：任务多时不要每 2s 同时打出几十个 /api/tasks 请求 */
const CANVAS_TASK_POLL_CONCURRENCY = 4;

const ROLE_KEYS: Record<CanvasReferenceRole, MessageKey> = {
  'first-frame': 'canvas.studio.role.firstFrame',
  'last-frame': 'canvas.studio.role.lastFrame',
  'reference-image': 'canvas.studio.role.referenceImage',
  'reference-video': 'canvas.studio.role.referenceVideo',
  'reference-audio': 'canvas.studio.role.referenceAudio',
};

/** 资产入库只需要这四个字段（资产清单条目是它的超集；「去画布」交接只带这四个） */
interface CanvasAssetInput {
  assetId: string;
  kind: 'image' | 'video' | 'audio';
  url: string;
  name?: string;
}

/** V2.49：提交/核对失败的归类；只有 terminal 才能把批次判死并显式换新键 */
function describeSubmitFailure(caught: unknown): {
  code: string;
  message: string;
  definitive: boolean;
} {
  if (caught instanceof ApiError) {
    return {
      code: caught.failure.code ?? 'UPSTREAM_ERROR',
      message: caught.failure.message,
      definitive: caught.failure.disposition === 'terminal',
    };
  }
  return {
    code: 'UPSTREAM_ERROR',
    message: caught instanceof Error ? caught.message : String(caught),
    definitive: false,
  };
}

const LINEAGE_PROBLEM_KEYS: Record<CanvasLineageProblem, MessageKey> = {
  'node-missing': 'canvas.studio.lineage.nodeMissing',
  self: 'canvas.studio.lineage.self',
  duplicate: 'canvas.studio.lineage.duplicate',
  cycle: 'canvas.studio.lineage.cycle',
  'source-no-output': 'canvas.studio.lineage.sourceNoOutput',
  'source-version-invalid': 'canvas.studio.lineage.sourceVersionInvalid',
  'source-audio': 'canvas.studio.lineage.sourceAudio',
  'source-not-media': 'canvas.studio.lineage.sourceNotMedia',
  'target-not-video': 'canvas.studio.lineage.targetNotVideo',
  'role-taken': 'canvas.studio.lineage.roleTaken',
  'references-full': 'canvas.studio.lineage.referencesFull',
};

/** 计划依赖边的拒绝理由（V2.61）：是来源边那批理由的子集，共用同一组文案键。 */
const DEPENDENCY_PROBLEM_KEYS: Record<CanvasDependencyProblem, MessageKey> = {
  'node-missing': 'canvas.studio.lineage.nodeMissing',
  self: 'canvas.studio.lineage.self',
  duplicate: 'canvas.studio.lineage.duplicate',
  cycle: 'canvas.studio.lineage.cycle',
  'source-audio': 'canvas.studio.lineage.sourceAudio',
  'source-not-media': 'canvas.studio.lineage.sourceNotMedia',
  'target-not-video': 'canvas.studio.lineage.targetNotVideo',
};

function toRfNode(node: CanvasDocNode, selected: boolean): StudioRfNode {
  return {
    id: node.id,
    type: 'studio',
    position: { x: node.layout.x, y: node.layout.y },
    selected,
    style: { width: node.layout.width, height: node.layout.height },
    data: {},
  };
}

function describeError(caught: unknown): string {
  if (caught instanceof ApiError) {
    const code = caught.failure.code === undefined ? '' : `【${caught.failure.code}】`;
    return `${code}${caught.failure.message}`;
  }
  return caught instanceof Error ? caught.message : String(caught);
}

/** S5-B2：输入框/弹窗/菜单里的 Delete、Backspace、Ctrl+V 不触发全局画布动作 */
function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  ) {
    return true;
  }
  return target.closest('.cs-modal, .cs-menu, .cs-toolbar') !== null;
}

export function CanvasStudioView() {
  const t = useTranslate();
  const { byok, providerStatus, projectId } = useShell();

  const [index, setIndex] = useState<CanvasProjectIndex | null>(null);
  /** S7-D1：只读画布侧栏；它不参与文档状态，也不会在打开时写盘。 */
  const [agentOpen, setAgentOpen] = useState(false);
  /** P6：只读节点检查器；不改变 CanvasDoc。 */
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [doc, setDoc] = useState<CanvasDoc | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<StudioRfNode>([]);
  const [saveState, setSaveState] = useState<CanvasSaveState>('saved');
  /** V2.48：另一个标签已写入 / 文档已删除；此时只能重载，不能继续用旧 revision 重试 */
  const [conflict, setConflict] = useState(false);
  /** 重载时让受控的标题输入框重新挂载（正常保存不重挂载，避免打字时丢焦点） */
  const [reloadNonce, setReloadNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** B109：受控边的选中态（见 handleSelectionChange 的说明） */
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<ReadonlySet<string>>(() => new Set());
  const [live, setLive] = useState<Record<string, TaskProgress>>({});
  const [submitting, setSubmitting] = useState<ReadonlySet<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  /** null = 添加节点；非 null = 给这个节点添加参考 */
  const [pickerReferenceNodeId, setPickerReferenceNodeId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  /** P1-2d：上传后让参考封面索引重拉一次（资产清单是另一个数据源） */
  const [assetPreviewRev, setAssetPreviewRev] = useState(0);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    flow: { x: number; y: number };
    nodeId: string | null;
    edgeId: string | null;
  } | null>(null);
  const [clipboardCount, setClipboardCount] = useState(0);
  const [historyRev, setHistoryRev] = useState(0);

  const docRef = useRef<CanvasDoc | null>(null);
  const saveQueueRef = useRef<ReturnType<typeof createCanvasSaveQueue> | null>(null);
  /** 打开/新建画布时跳过它自己触发的那次保存（文档刚加载，没有修改） */
  const skipSaveRef = useRef(false);
  /** 切换/新建/删除的互斥：flush 期间用户再点一次不并发执行 */
  const switchingRef = useRef(false);
  const mountedRef = useRef(true);
  /** 离开画布前的拦截目标（保存成功后放行） */
  const leaveTargetRef = useRef<string | null>(null);
  const historyRef = useRef(createCanvasHistory());
  const clipboardRef = useRef<readonly CanvasDocNode[]>([]);
  const submittingRef = useRef<Set<string>>(new Set());
  /** 新节点/副本插入后，等文档 → RF 同步时选中它 */
  const pendingSelect = useRef<string | null>(null);
  /** V2.49：结果交接在**保存成功之前**不消费，失败/刷新后还能再试 */
  const pendingHandoffRef = useRef<CanvasResultHandoff | null>(null);
  const pendingAgentHandoffRef = useRef(false);
  /** 空索引自动建画布只允许一次；失败不自动重试（交给用户） */
  const autoCreateRef = useRef(false);
  const rfRef = useRef<ReactFlowInstance<StudioRfNode, Edge> | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  /**
   * 保存队列（S4-R1a）：串行化 PUT、去抖、切换前 flush、失败可重试。
   * 放在 render 里惰性创建一次；回调只依赖稳定的 setter 与 ref，不会读到旧闭包。
   */
  if (saveQueueRef.current === null) {
    saveQueueRef.current = createCanvasSaveQueue({
      save: async (doc, revision) => {
        const saved = await saveCanvasDoc(doc, { revision });
        setIndex((prev) => (prev === null ? prev : upsertCanvasProject(prev, saved.summary)));
        return saved.revision;
      },
      onState: (state, projectId) => {
        if (!mountedRef.current) return;
        if (docRef.current?.projectId !== projectId) return;
        if (state === 'saving') setError(null);
        if (state === 'saved') {
          setConflict(false);
          // V2.49：交接节点已经随文档落盘，这时才清除一次性交接
          if (pendingHandoffRef.current !== null) {
            clearCanvasResultHandoff();
            pendingHandoffRef.current = null;
          }
        }
        setSaveState(state);
      },
      onError: (caught) => {
        if (!mountedRef.current) return;
        if (caught instanceof ApiError && caught.failure.status === 409) setConflict(true);
        setError(describeError(caught));
      },
    });
  }

  const labels = useMemo(
    () => ({
      text: t('canvas.node.text'),
      image: t('common.kind.image'),
      video: t('common.kind.video'),
      audio: t('common.kind.audio'),
    }),
    [t],
  );

  /**
   * 唯一的文档写入口：记录撤销快照 → 更新 ref → 更新 state。
   *
   * `record:false` 用于**服务端事实**（批次状态、提交回写）——它们不该被 Ctrl+Z 回滚。
   */
  const applyDoc = useCallback(
    (
      mutator: (current: CanvasDoc) => CanvasDoc,
      options?: { record?: boolean; coalesceKey?: string },
    ): void => {
      const current = docRef.current;
      if (current === null) return;
      const next = mutator(current);
      if (next === current) return;
      if (options?.record !== false) {
        historyRef.current = recordCanvasHistory(
          historyRef.current,
          current,
          options?.coalesceKey === undefined ? {} : { coalesceKey: options.coalesceKey },
        );
        setHistoryRev((value) => value + 1);
      }
      docRef.current = next;
      setDoc(next);
    },
    [],
  );

  /**
   * S5-B2：视口按画布恢复。
   *
   * `{0,0,1}` 是新建文档的默认值，未真正移动过；有节点时仍走一次 fitView，
   * 已保存过视口则原样恢复。用户点 Controls 的 fitView 属于显式适应，会写回文档。
   */
  const restoreCanvasViewport = useCallback((next: CanvasDoc): void => {
    const instance = rfRef.current;
    if (instance === null) return;
    const viewport = next.viewport;
    const explicit = viewport.x !== 0 || viewport.y !== 0 || viewport.zoom !== 1;
    if (explicit) {
      instance.setViewport(viewport, { duration: 0 });
      return;
    }
    if (next.nodes.length > 0) {
      instance.fitView({ padding: 0.2, maxZoom: 1, duration: 200 });
    } else {
      instance.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 });
    }
  }, []);

  const openProject = useCallback(
    async (project: { projectId: string; name: string }): Promise<void> => {
      if (switchingRef.current) return;
      if (submittingRef.current.size > 0) {
        setNotice(t('canvas.studio.guard.submitting'));
        return;
      }
      const current = docRef.current;
      if (current !== null && current.projectId !== project.projectId) {
        // 切换前先把当前文档落盘；失败就**留在原画布**，不丢草稿
        const ok = (await saveQueueRef.current?.flush()) ?? true;
        if (!ok) {
          setError(t('canvas.studio.saveBlocked'));
          return;
        }
      }
      switchingRef.current = true;
      setBusy(true);
      setError(null);
      setNotice(null);
      setPickerOpen(false);
      setMenu(null);
      try {
        let next: CanvasDoc;
        try {
          next = await fetchCanvasDoc(project.projectId);
        } catch (caught) {
          // 404 = 这个画布还没保存过：本地起一份空文档，第一次编辑时再落盘
          if (caught instanceof ApiError && caught.failure.status === 404) {
            next = createEmptyCanvasDoc(project.projectId, project.name);
          } else {
            throw caught;
          }
        }
        skipSaveRef.current = true;
        saveQueueRef.current?.setRevision(next.revision);
        setConflict(false);
        docRef.current = next;
        setDoc(next);
        setNodes([]);
        setSelectedIds([]);
        setLive({});
        historyRef.current = createCanvasHistory();
        setHistoryRev((value) => value + 1);
        setSaveState('saved');
        setIndex((prev) => (prev === null ? prev : setActiveCanvasProject(prev, project.projectId)));
        writeActiveCanvasProjectId(project.projectId);
        // B94：切换后同步 URL query，避免旧 `?project=` 的 hash effect 把项目切回去。
        window.history.replaceState(
          null,
          '',
          `#/canvas?project=${encodeURIComponent(project.projectId)}`,
        );
        window.setTimeout(() => restoreCanvasViewport(next), 60);
      } catch (caught) {
        setError(describeError(caught));
      } finally {
        switchingRef.current = false;
        setBusy(false);
      }
    },
    [restoreCanvasViewport, setNodes, t],
  );

  /**
   * V2.48：修订冲突后**只能重载**（旧 revision 重试永远不会成功）。
   * 这是一次显式的“丢弃本地未保存修改”，按钮文案必须说清。
   */
  const reloadCanvas = useCallback(async (): Promise<void> => {
    const current = docRef.current;
    if (current === null || switchingRef.current) return;
    switchingRef.current = true;
    setBusy(true);
    try {
      const next = await fetchCanvasDoc(current.projectId);
      const queue = saveQueueRef.current;
      queue?.cancel();
      queue?.setRevision(next.revision);
      skipSaveRef.current = true;
      docRef.current = next;
      setDoc(next);
      setNodes([]);
      setSelectedIds([]);
      setLive({});
      historyRef.current = createCanvasHistory();
      setHistoryRev((value) => value + 1);
      setSaveState('saved');
      setConflict(false);
      setError(null);
      setReloadNonce((value) => value + 1);
      window.setTimeout(() => restoreCanvasViewport(next), 60);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      switchingRef.current = false;
      setBusy(false);
    }
  }, [restoreCanvasViewport, setNodes]);

  // 首次进入：读索引 → 打开上次的画布（没有就显示空态，不擅自新建）
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const loaded = await fetchCanvasIndex();
        if (!alive) return;
        setIndex(loaded);
        const requested = parseHash(window.location.hash).query.get('project');
        const requestedProject =
          requested === null
            ? null
            : (loaded.projects.find((project) => project.projectId === requested) ?? null);
        const initial =
          requestedProject ?? pickInitialCanvasProject(loaded, readActiveCanvasProjectId());
        if (initial !== null) {
          await openProject(initial);
        } else if (
          !autoCreateRef.current &&
          (peekCanvasResultHandoff() !== null || peekAgentCanvasHandoff() !== null)
        ) {
          // 「去画布编辑」/「Agent 建画布草稿」但一块画布都没有：先建一块，交接由下面的 effect 消费。
          // 只自动建一次；保存失败就报错，不再循环创建。
          autoCreateRef.current = true;
          const fresh = createEmptyCanvasDoc(newCanvasProjectId(), defaultCanvasName(loaded.projects));
          const saved = await saveCanvasDoc(fresh, { revision: 1 });
          if (!alive) return;
          setIndex(
            setActiveCanvasProject(upsertCanvasProject(loaded, saved.summary), fresh.projectId),
          );
          writeActiveCanvasProjectId(fresh.projectId);
          skipSaveRef.current = true;
          saveQueueRef.current?.setRevision(saved.revision);
          docRef.current = fresh;
          setDoc(fresh);
          setNodes([]);
          setSelectedIds([]);
          setLive({});
          historyRef.current = createCanvasHistory();
          setHistoryRev((value) => value + 1);
          setSaveState('saved');
        }
      } catch (caught) {
        if (alive) setError(describeError(caught));
      }
    })();
    return () => {
      alive = false;
    };
  }, [openProject]);

  /**
   * S5-A：资产页的画布卡可以带着 `?project=<id>` 进来。
   * 画布视图是 keepalive 的，初次挂载 effect 不会因为再次导航而重跑，所以单独监听 hash。
   */
  useEffect(() => {
    const consume = (): void => {
      if (!window.location.hash.startsWith('#/canvas')) return;
      const target = parseHash(window.location.hash).query.get('project');
      if (target === null || index === null) return;
      if (docRef.current?.projectId === target) return;
      const project = index.projects.find((item) => item.projectId === target);
      if (project !== undefined) void openProject(project);
    };
    window.addEventListener('hashchange', consume);
    consume();
    return () => window.removeEventListener('hashchange', consume);
  }, [index, openProject]);

  /**
   * 文档 → React Flow 的同步。
   *
   * 只按**布局签名**（id + 位置 + 尺寸）触发：轮询写批次、输入提示词都不会重建节点数组；
   * 而撤销/粘贴/拖动落位会变位置，必须重建。选中态从 RF 的旧数组里带过来（或取 `pendingSelect`）。
   */
  const layoutKey =
    doc === null
      ? ''
      : doc.nodes
          .map(
            (node) =>
              `${node.id}:${node.layout.x}:${node.layout.y}:${node.layout.width}:${node.layout.height}`,
          )
          .join('|');

  useEffect(() => {
    if (doc === null) {
      setNodes([]);
      return;
    }
    const pending = pendingSelect.current;
    pendingSelect.current = null;
    const source = doc.nodes;
    setNodes((prev) => {
      const selected = new Set(prev.filter((node) => node.selected).map((node) => node.id));
      if (pending !== null) {
        selected.clear();
        selected.add(pending);
      }
      return source.map((node) => toRfNode(node, selected.has(node.id)));
    });
    if (pending !== null) {
      const target = source.find((node) => node.id === pending);
      if (target !== undefined) {
        // 新节点可能落在视口外（尤其是右侧网格的第二列）：把它平移到视野中心，否则"加了但看不见"
        window.setTimeout(() => {
          const instance = rfRef.current;
          if (instance === null) return;
          instance.setCenter(
            target.layout.x + target.layout.width / 2,
            target.layout.y + target.layout.height / 2,
            { zoom: instance.getZoom(), duration: 220 },
          );
        }, 40);
      }
    }
    // 刻意只依赖"项目 + 布局签名"：轮询写批次时不重建节点（否则每 2 秒打断一次拖动）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.projectId, layoutKey, setNodes]);

  // 自动保存：队列负责 600ms 去抖与串行化；刚打开/新建的文档跳过首次保存
  useEffect(() => {
    if (doc === null) return;
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    saveQueueRef.current?.schedule(doc);
  }, [doc]);

  // 卸载时尽力把未保存内容发出去（站内切走时队列仍能完成请求）
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void saveQueueRef.current?.flush();
    };
  }, []);

  // 关标签/刷新：有未保存内容时让浏览器确认；pagehide 用 keepalive 再兜一层
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!saveQueueRef.current?.isDirty()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const onPageHide = (): void => {
      const current = docRef.current;
      const queue = saveQueueRef.current;
      if (current === null || queue === null || !queue.isDirty()) return;
      void saveCanvasDoc(current, {
        keepalive: true,
        revision: queue.currentRevision(),
      }).catch(() => undefined);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  // 站内离开画布：脏数据先落盘，成功再放行；失败留在画布并显示原因
  useEffect(() => {
    const onHashChange = (): void => {
      const hash = window.location.hash;
      if (hash.startsWith('#/canvas')) return;
      if (submittingRef.current.size > 0) {
        // 提交响应还没回来：留在画布，等写回 taskId 再离开
        navigate('#/canvas');
        setNotice(t('canvas.studio.guard.submitting'));
        return;
      }
      const queue = saveQueueRef.current;
      if (queue === null || !queue.isDirty()) return;
      if (leaveTargetRef.current === hash) return;
      leaveTargetRef.current = hash;
      navigate('#/canvas');
      void queue.flush().then((ok) => {
        if (!mountedRef.current) return;
        if (ok) {
          leaveTargetRef.current = null;
          navigate(hash);
        } else {
          leaveTargetRef.current = null;
          setError(t('canvas.studio.saveBlocked'));
        }
      });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [t]);

  // ── 轮询：按文档里的 batches[].taskId 拉任务；终态写回批次 ─────────────────
  const activeKey =
    doc === null ? '' : canvasActiveTasks(doc).map((task) => task.taskId).sort().join(',');

  useEffect(() => {
    if (activeKey === '') {
      setLive({});
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async (): Promise<void> => {
      const current = docRef.current;
      if (current === null) return;
      const tasks = canvasActiveTasks(current);
      if (tasks.length === 0) {
        setLive({});
        return;
      }

      const results = await mapWithConcurrency(
        tasks,
        CANVAS_TASK_POLL_CONCURRENCY,
        async (task) => {
          try {
            return { task, progress: await fetchTask(task.taskId), failure: null };
          } catch (caught) {
            const failure =
              caught instanceof ApiError && caught.failure.kind === 'contract'
                ? {
                    code: caught.failure.code ?? 'TASK_NOT_FOUND',
                    message: caught.failure.message,
                  }
                : null;
            return { task, progress: null, failure };
          }
        },
      );
      if (disposed) return;

      const running: Record<string, TaskProgress> = {};
      const settled: Array<{ nodeId: string; batchId: string; progress: TaskProgress }> = [];
      for (const result of results) {
        if (result.progress === null) {
          if (result.failure !== null) {
            const failure = result.failure;
            applyDoc(
              (d) =>
                patchCanvasBatch(
                  d,
                  result.task.nodeId,
                  result.task.batchId,
                  { status: 'failed', failure },
                  Date.now(),
                ),
              { record: false },
            );
          }
          continue;
        }
        if (result.progress.status === 'queued' || result.progress.status === 'running') {
          running[result.task.taskId] = result.progress;
        } else {
          settled.push({
            nodeId: result.task.nodeId,
            batchId: result.task.batchId,
            progress: result.progress,
          });
        }
      }

      setLive(running);
      if (settled.length > 0) {
        applyDoc(
          (d) =>
            settled.reduce(
              (acc, item) =>
                patchCanvasBatch(
                  acc,
                  item.nodeId,
                  item.batchId,
                  canvasBatchPatchFromTask(item.progress),
                  Date.now(),
                ),
              d,
            ),
          { record: false },
        );
      }

      timer = setTimeout(() => void tick(), 2000);
    };

    void tick();
    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [activeKey, applyDoc]);

  // 窄屏没有“桌面视口”可恢复：桌面保存的 x/y 会把节点推到 375 视口外，
  // 用户打开画布只看到空白。首次进入窄屏时 fit 一次；之后用户自己的平移/缩放不再被重置。
  useEffect(() => {
    if (doc === null || typeof window === 'undefined') return;
    if (!window.matchMedia('(max-width: 768px)').matches) return;
    const timer = window.setTimeout(() => {
      rfRef.current?.fitView({ padding: 0.2, duration: 0 });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [doc?.projectId]);

  // ── 编辑动作 ───────────────────────────────────────────────────────────
  const addNode = useCallback(
    (type: CanvasNodeType, at?: { x: number; y: number }): void => {
      const current = docRef.current;
      if (current === null) return;
      const position = at ?? nextCanvasNodePosition(current);
      const id = newCanvasProjectId();
      pendingSelect.current = id;
      applyDoc(
        (d) =>
          addCanvasNode(d, {
            id,
            type,
            x: position.x,
            y: position.y,
            title: canvasNodeTitle(d, type, labels),
          }).doc,
      );
    },
    [applyDoc, labels],
  );

  /**
   * S8-A2b：只有用户在展开卡点击「创建镜头草稿」后才落节点；Agent 自己不写文档。
   * 只落草稿 + 计划依赖边，不提交任何生成（/api/generate 计数必须为 0）。
   */
  const landStoryboard = useCallback(
    (expansion: StoryboardExpansion): boolean => {
      const current = docRef.current;
      if (current === null) return false;
      const landing = buildStoryboardLanding(expansion, storyboardLandingOrigin(current));
      applyDoc((d) => appendStoryboardLanding(d, landing));
      setNotice(
        landing.report.unattachedReferences.length === 0
          ? t('canvas.agent.storyboard.landed', {
              shots: landing.report.shotCount,
              images: landing.report.imageNodeCount,
            })
          : t('canvas.agent.storyboard.landedWithUnattached', {
              shots: landing.report.shotCount,
              images: landing.report.imageNodeCount,
              unattached: landing.report.unattachedReferences.length,
            }),
      );
      return true;
    },
    [applyDoc, t],
  );

  /** S7-D2：只有用户在方案卡点击“创建节点”后才落节点；Agent 自己不写文档。 */
  const createAgentTextNode = useCallback(
    (proposal: CanvasNodeProposal): boolean => {
      const current = docRef.current;
      if (current === null) return false;
      const position = nextCanvasNodePosition(current);
      const id = newCanvasProjectId();
      const node = createCanvasNode({
        id,
        type: 'text',
        x: position.x,
        y: position.y,
        title: proposal.title,
        createdFrom: 'agent',
      });
      node.data.draft.prompt = proposal.content;
      node.data.draft.updatedAt = Date.now();
      pendingSelect.current = id;
      applyDoc((d) => ({
        ...d,
        nodes: [...d.nodes, node],
        updatedAt: Date.now(),
      }));
      setNotice(t('canvas.agent.created', { title: proposal.title }));
      return true;
    },
    [applyDoc, t],
  );

  /** S7-D5：只更新确认过的目标文本节点，不动批次/产物/连线。 */
  const updateAgentTextNode = useCallback(
    (proposal: CanvasTextNodeUpdateProposal): boolean => {
      const current = docRef.current;
      if (current === null) return false;
      const node = findCanvasNode(current, proposal.targetNodeId);
      if (node === null || node.type !== 'text') return false;
      applyDoc((d) => ({
        ...d,
        nodes: d.nodes.map((item) =>
          item.id === proposal.targetNodeId
            ? {
                ...item,
                data: {
                  ...item.data,
                  title: proposal.title,
                  draft: {
                    ...item.data.draft,
                    prompt: proposal.content,
                    updatedAt: Date.now(),
                  },
                },
              }
            : item,
        ),
        updatedAt: Date.now(),
      }));
      pendingSelect.current = proposal.targetNodeId;
      setNotice(t('canvas.agent.updated', { title: proposal.title }));
      return true;
    },
    [applyDoc, t],
  );

  const deleteNodes = useCallback(
    (ids: readonly string[]): void => {
      const current = docRef.current;
      if (current === null || ids.length === 0) return;
      const running = current.nodes.filter(
        (node) =>
          ids.includes(node.id) &&
          (canvasNodeActiveBatches(node).length > 0 || submittingRef.current.has(node.id)),
      );
      if (running.length > 0) {
        setNotice(t('canvas.studio.guard.activeDelete'));
        return;
      }
      setNotice(null);
      setSelectedIds([]);
      applyDoc((d) => removeCanvasNodes(d, ids));
    },
    [applyDoc, t],
  );

  const copyNodes = useCallback((ids: readonly string[]): void => {
    const current = docRef.current;
    if (current === null) return;
    const picked = current.nodes.filter((node) => ids.includes(node.id));
    if (picked.length === 0) return;
    clipboardRef.current = picked;
    setClipboardCount(picked.length);
    setNotice(null);
  }, []);

  const pasteAt = useCallback(
    (at: { x: number; y: number } | null): void => {
      const current = docRef.current;
      const source = clipboardRef.current;
      if (current === null || source.length === 0) return;
      const ids = source.map(() => newCanvasProjectId());
      let positions: Array<{ x: number; y: number }> | undefined;
      if (at !== null) {
        const minX = Math.min(...source.map((node) => node.layout.x));
        const minY = Math.min(...source.map((node) => node.layout.y));
        positions = source.map((node) => ({
          x: at.x + (node.layout.x - minX),
          y: at.y + (node.layout.y - minY),
        }));
      }
      pendingSelect.current = ids[ids.length - 1] ?? null;
      applyDoc(
        (d) =>
          insertCanvasNodes(d, source, {
            ids,
            labels,
            ...(positions === undefined ? {} : { positions }),
          }).doc,
      );
    },
    [applyDoc, labels],
  );

  const duplicateNodes = useCallback(
    (ids: readonly string[]): void => {
      const current = docRef.current;
      const nodeId = ids[0];
      if (current === null || nodeId === undefined) return;
      const id = newCanvasProjectId();
      pendingSelect.current = id;
      applyDoc((d) => duplicateCanvasNode(d, nodeId, { id, labels })?.doc ?? d);
    },
    [applyDoc, labels],
  );

  const undo = useCallback((): void => {
    const current = docRef.current;
    if (current === null) return;
    const result = undoCanvasHistory(historyRef.current, current);
    if (result === null) return;
    const lost = canvasLostActiveTaskNodes(result.doc, current);
    const inFlight = current.nodes
      .filter((node) => !result.doc.nodes.some((item) => item.id === node.id))
      .some((node) => submittingRef.current.has(node.id));
    if (lost.length > 0 || inFlight) {
      setNotice(t('canvas.studio.guard.activeUndo'));
      return;
    }
    historyRef.current = result.history;
    docRef.current = result.doc;
    setDoc(result.doc);
    setSelectedIds((prev) => prev.filter((id) => result.doc.nodes.some((node) => node.id === id)));
    setHistoryRev((value) => value + 1);
    setNotice(null);
  }, [t]);

  const redo = useCallback((): void => {
    const current = docRef.current;
    if (current === null) return;
    const result = redoCanvasHistory(historyRef.current, current);
    if (result === null) return;
    const lost = canvasLostActiveTaskNodes(result.doc, current);
    const inFlight = current.nodes
      .filter((node) => !result.doc.nodes.some((item) => item.id === node.id))
      .some((node) => submittingRef.current.has(node.id));
    if (lost.length > 0 || inFlight) {
      setNotice(t('canvas.studio.guard.activeUndo'));
      return;
    }
    historyRef.current = result.history;
    docRef.current = result.doc;
    setDoc(result.doc);
    setSelectedIds((prev) => prev.filter((id) => result.doc.nodes.some((node) => node.id === id)));
    setHistoryRev((value) => value + 1);
    setNotice(null);
  }, [t]);

  const viewportCenterFlow = useCallback((): { x: number; y: number } | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect === undefined) return null;
    return (
      rfRef.current?.screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      }) ?? null
    );
  }, []);

  // ── 资产入库 ───────────────────────────────────────────────────────────
  const addAssets = useCallback(
    (assets: readonly CanvasAssetInput[], source: 'from_asset' | 'uploaded'): void => {
      const current = docRef.current;
      if (current === null || assets.length === 0) return;
      const positions = nextCanvasNodePositions(current, assets.length);
      const ids = assets.map(() => newCanvasProjectId());
      const batchIds = assets.map(() => newIdempotencyKey());
      pendingSelect.current = ids[ids.length - 1] ?? null;
      applyDoc(
        (d) =>
          addCanvasNodesFromAssets(d, {
            assets: assets.map((asset) => ({
              assetId: asset.assetId,
              kind: asset.kind,
              url: asset.url,
              ...(asset.name === undefined ? {} : { name: asset.name }),
            })),
            ids,
            batchIds,
            source,
            positions,
            labels,
          }).doc,
      );
    },
    [applyDoc, labels],
  );

  /**
   * 消费「去画布编辑」交接：把结果作为资产节点放进当前画布。
   *
   * 去重：同一个 `task:<taskId>` 已经在当前文档里（比如连点两次），不再建第二个节点，
   * 只选中已有节点并如实告诉用户"已经在画布中"。
   */
  useEffect(() => {
    if (doc === null || pendingHandoffRef.current !== null) return;
    const handoff = peekCanvasResultHandoff();
    if (handoff === null) return;
    pendingHandoffRef.current = handoff;
    const assetId = `task:${handoff.taskId}`;
    const existing = doc.nodes.find((node) =>
      node.data.batches.some((batch) =>
        batch.outputs.some((output) => output.assetId === assetId),
      ),
    );
    if (existing !== undefined) {
      // 已经在文档里 = 上一次其实已经保存成功；这时可以安全消费
      clearCanvasResultHandoff();
      pendingHandoffRef.current = null;
      pendingSelect.current = existing.id;
      setSelectedIds([existing.id]);
      setNodes((prev) =>
        prev.map((node) => ({ ...node, selected: node.id === existing.id })),
      );
      setNotice(t('common.resultInCanvas'));
      return;
    }
    // 只在保存队列报 saved 时才清除（见 onState）；保存失败/刷新后还会保留
    addAssets([resultHandoffAsset(handoff)], 'from_asset');
    setNotice(t('common.resultToCanvas'));
  }, [doc?.projectId, addAssets, setNodes, t]);

  /**
   * S7-C2：消费 Agent 计划交接，在当前画布创建草稿节点。
   * 先 take 一次性计划；结构/能力在 CreateView 已校验，这里只处理 catalog 缺失。
   */
  useEffect(() => {
    if (doc === null || pendingAgentHandoffRef.current) return;
    const handed = peekAgentCanvasHandoff();
    if (handed === null) return;
    pendingAgentHandoffRef.current = true;
    const skills = [...BUILTIN_SKILLS, ...loadSkillLibrary().library.custom];
    const built = buildAgentCanvasPlan(handed, skills, { x: 80, y: 80 });
    if (built.nodes.length === 0) {
      clearAgentCanvasHandoff();
      setNotice(
        built.missingSkillIds.length === 0
          ? t('agent.plan.canvasEmpty')
          : t('agent.plan.canvasMissing', { ids: built.missingSkillIds.join(', ') }),
      );
      pendingAgentHandoffRef.current = false;
      return;
    }
    const first = built.nodes[0];
    if (first === undefined) {
      pendingAgentHandoffRef.current = false;
      return;
    }
    pendingSelect.current = first.id;
    applyDoc((current) => appendAgentCanvasPlan(current, built));
    clearAgentCanvasHandoff();
    setNotice(
      built.missingSkillIds.length === 0
        ? t('agent.plan.canvasCreated', { count: built.nodes.length })
        : t('agent.plan.canvasMissing', { ids: built.missingSkillIds.join(', ') }),
    );
    pendingAgentHandoffRef.current = false;
  }, [doc?.projectId, applyDoc, t]);

  const handleUpload = useCallback(
    async (files: File[]): Promise<void> => {
      if (files.length === 0) return;
      setUploading(true);
      setError(null);
      setNotice(null);
      try {
        const uploadedIds: string[] = [];
        for (let offset = 0; offset < files.length; offset += 4) {
          const chunk = files.slice(offset, offset + 4);
          const result = await uploadAssets(chunk, projectId);
          uploadedIds.push(...result.assets.map((asset) => asset.assetId));
        }
        // 上传响应没有 url / name；按 id 从资产清单回读（不自己拼 URL、不猜名字）
        const pool = await fetchAssets(projectId);
        const byId = new Map(pool.assets.map((asset) => [asset.assetId, asset]));
        const entries = uploadedIds
          .map((id) => byId.get(id))
          .filter((asset): asset is AssetListEntry => asset !== undefined);
        if (entries.length < uploadedIds.length) {
          setNotice(
            t('canvas.studio.uploadMissing', { count: uploadedIds.length - entries.length }),
          );
        }
        addAssets(entries, 'uploaded');
        // 新素材要能立刻在素材条里看见缩略图
        setAssetPreviewRev((value) => value + 1);
      } catch (caught) {
        setError(describeError(caught));
      } finally {
        setUploading(false);
      }
    },
    [addAssets, projectId, t],
  );

  /**
   * S5-B2：系统粘贴。
   *
   * - 图片/视频文件 → 上传成资产节点；
   * - 内部复制的节点 → 在视口中心粘贴；
   * - 输入框/弹窗/菜单里完全不拦，浏览器自己处理文本。
   *
   * Ctrl+V 从 keydown 移到这里：keydown 阶段拿不到剪贴板文件类型，先拦会把系统图片粘贴吞掉。
   */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      if (docRef.current === null || menu !== null || pickerOpen) return;
      // S5-B4d：预览/凭据抽屉/项目面板等模态层打开时，背景画布不处理粘贴
      if (isModalLayerOpen()) return;
      if (isTextEditingTarget(event.target)) return;
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length > 0) {
        event.preventDefault();
        void handleUpload(files);
        return;
      }
      if (clipboardRef.current.length > 0) {
        event.preventDefault();
        pasteAt(viewportCenterFlow());
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleUpload, menu, pasteAt, pickerOpen, viewportCenterFlow]);

  // ── 提交生成 ───────────────────────────────────────────────────────────
  const submitNode = useCallback(
    /**
     * `override` 用于"不是按草稿生成"的动作（V2.77 的超清：输入是当前产物、不吃提示词）。
     * 传了它就不再跑 `canvasSubmitIssue` 那一套（那是给"生成"设计的：空提示词会被它拦住），
     * 批次、幂等键、轮询、写回全都复用同一条路径。
     */
    async (nodeId: string, override?: VideoGenerateRequest): Promise<void> => {
      const current = docRef.current;
      if (current === null || switchingRef.current) return;
      const node = findCanvasNode(current, nodeId);
      if (node === null || submittingRef.current.has(nodeId)) return;

      const context = {
        providerStatus,
        hasCloudKey: resolveProviderKey(byok) !== undefined,
      };
      const provider = canvasDefaultProvider(node, context);
      if (override === undefined) {
        const issue = canvasSubmitIssue(node, provider, context);
        if (issue !== null) {
          setNotice(canvasSubmitIssueText(issue));
          return;
        }
      }

      let request: VideoGenerateRequest;
      if (override !== undefined) {
        request = override;
      } else {
        try {
          request = buildCanvasGenerateRequest({
            node,
            provider,
            projectId,
            canvasProjectId: current.projectId,
            ...(byok.baseUrl.trim() === '' ? {} : { baseUrl: byok.baseUrl }),
            ...(byok.model.trim() === '' ? {} : { model: byok.model }),
          });
        } catch (caught) {
          setNotice(describeError(caught));
          return;
        }
      }

      submittingRef.current.add(nodeId);
      setSubmitting(new Set(submittingRef.current));
      setNotice(null);

      const batchId = newIdempotencyKey();
      const now = Date.now();
      const projectAtSubmit = current.projectId;
      /** 响应回来时如果用户已经切了画布，**不要**把旧项目的任务写进新项目的文档 */
      const applyToSubmittedProject = (mutator: (d: CanvasDoc) => CanvasDoc): void => {
        if (docRef.current?.projectId !== projectAtSubmit) return;
        applyDoc(mutator, { record: false });
      };
      // 批次先落文档（queued）：用户立刻看到"提交中"；拿到 taskId 后由轮询接手。
      // V2.49：request 是原始提交快照，`batchId` 同时是幂等键 —— 刷新/响应丢失后靠它核对。
      applyDoc(
        (d) =>
          addCanvasBatch(d, nodeId, {
            id: batchId,
            createdAt: now,
            status: 'queued',
            outputs: [],
            request,
          }),
        { record: false },
      );
      // 把这次实际用的引擎与模式写回草稿：刷新后下拉框显示的就是刚才提交的那台
      applyDoc(
        (d) =>
          updateCanvasNodeDraft(
            d,
            nodeId,
            // 写回**实际提交的**模式（超清那次是 upscale，不是草稿推导出来的 t2i）
            { settings: { provider, mode: request.mode } },
            now,
          ),
        { record: false },
      );

      // **先落盘再发请求**：否则提交后立刻刷新会丢掉唯一能核对的依据
      const saved = (await saveQueueRef.current?.flush()) ?? true;
      if (!saved) {
        applyToSubmittedProject((d) =>
          patchCanvasBatch(
            d,
            nodeId,
            batchId,
            {
              status: 'failed',
              failure: { code: 'SAVE_FAILED', message: t('canvas.studio.submitNotSent') },
            },
            Date.now(),
          ),
        );
        setNotice(t('canvas.studio.submitNotSent'));
        submittingRef.current.delete(nodeId);
        setSubmitting(new Set(submittingRef.current));
        return;
      }

      try {
        const providerKey = resolveProviderKey(byok);
        const created = await submitGenerate(request, {
          // 同一个批次 = 同一个幂等键；重放不会新建第二个任务
          idempotencyKey: batchId,
          ...(providerKey === undefined ? {} : { providerKey }),
        });
        applyToSubmittedProject((d) =>
          patchCanvasBatch(d, nodeId, batchId, { taskId: created.taskId }, Date.now()),
        );
      } catch (caught) {
        const failure = describeSubmitFailure(caught);
        if (failure.definitive) {
          // 明确失败（参数/凭据/上游拒绝）：可以显式重提，重提会换新批次/新键
          applyToSubmittedProject((d) =>
            patchCanvasBatch(
              d,
              nodeId,
              batchId,
              { status: 'failed', failure: { code: failure.code, message: failure.message } },
              Date.now(),
            ),
          );
          setNotice(t('canvas.studio.submitFailed', { reason: failure.message }));
        } else {
          // 网络/5xx/超时：结果未知，保留 queued + request，等待核对，不直接判死
          setNotice(t('canvas.studio.submitUnknownNotice'));
        }
      } finally {
        submittingRef.current.delete(nodeId);
        setSubmitting(new Set(submittingRef.current));
      }
    },
    [applyDoc, byok, projectId, providerStatus, t],
  );

  /**
   * V2.49：核对“提交结果未知”的批次。
   *
   * 用**原请求 + 原批次 id（幂等键）**重放：服务端先按幂等键查已有任务，
   * 查到就返回同一个 taskId，不会产生第二个上游任务；没查到才按同一个键创建。
   * 因此这里绝不换新键，也不在前端“猜”成功/失败。
   */
  const recoverSubmit = useCallback(
    async (nodeId: string, batchId: string): Promise<void> => {
      const current = docRef.current;
      if (current === null || switchingRef.current || submittingRef.current.has(nodeId)) return;
      const node = findCanvasNode(current, nodeId);
      const batch = node?.data.batches.find((item) => item.id === batchId);
      if (
        node === null ||
        batch === undefined ||
        batch.status !== 'queued' ||
        batch.taskId !== undefined
      ) {
        return;
      }
      if (batch.request === undefined) {
        setNotice(t('canvas.studio.recoverNoRequest'));
        return;
      }

      submittingRef.current.add(nodeId);
      setSubmitting(new Set(submittingRef.current));
      setNotice(null);
      const projectAtSubmit = current.projectId;
      const applyToSubmittedProject = (mutator: (d: CanvasDoc) => CanvasDoc): void => {
        if (docRef.current?.projectId !== projectAtSubmit) return;
        applyDoc(mutator, { record: false });
      };

      try {
        const providerKey = resolveProviderKey(byok);
        const created = await submitGenerate(batch.request, {
          idempotencyKey: batch.id,
          ...(providerKey === undefined ? {} : { providerKey }),
        });
        applyToSubmittedProject((d) =>
          patchCanvasBatch(d, nodeId, batchId, { taskId: created.taskId }, Date.now()),
        );
        setNotice(t('canvas.studio.recoverDone'));
      } catch (caught) {
        const failure = describeSubmitFailure(caught);
        if (failure.definitive) {
          applyToSubmittedProject((d) =>
            patchCanvasBatch(
              d,
              nodeId,
              batchId,
              { status: 'failed', failure: { code: failure.code, message: failure.message } },
              Date.now(),
            ),
          );
          setNotice(t('canvas.studio.submitFailed', { reason: failure.message }));
        } else {
          // 仍然未知：保留 queued + request，允许稍后再核对
          setNotice(t('canvas.studio.recoverUnknown'));
        }
      } finally {
        submittingRef.current.delete(nodeId);
        setSubmitting(new Set(submittingRef.current));
      }
    },
    [applyDoc, byok, t],
  );

  const handleDraftChange = useCallback(
    (nodeId: string, patch: CanvasDraftPatch): void => {
      applyDoc(
        (d) => {
          const next = updateCanvasNodeDraft(d, nodeId, patch);
          // 2026-10-24「引用即连线」：引用一变就把来源边对齐。
          // 只增删 id 以 `edge-ref-` 开头的自动边，手动拖出来的边不回受影响。
          return patch.references === undefined
            ? next
            : reconcileReferenceLineage(next, nodeId).doc;
        },
        { coalesceKey: `draft:${nodeId}` },
      );
    },
    [applyDoc],
  );

  /** S5-B4f：窄屏底部抽屉的关闭（取消这个节点的选中态，不改文档） */
  const handleDeselect = useCallback(
    (nodeId: string): void => {
      setSelectedIds((prev) => prev.filter((id) => id !== nodeId));
      setNodes((prev) =>
        prev.map((node) => (node.id === nodeId ? { ...node, selected: false } : node)),
      );
    },
    [setNodes],
  );

  /** S5-B3：把选中版本写进文档（非成功批次不写） */
  const selectBatch = useCallback(
    (nodeId: string, batchId: string): void => {
      applyDoc((d) => selectCanvasNodeBatch(d, nodeId, batchId));
    },
    [applyDoc],
  );

  /** S5-B3d：用选中批次的真实 request 回填节点草稿，不提交 */
  const reuseBatch = useCallback(
    (nodeId: string, batchId: string): void => {
      const current = docRef.current;
      if (current === null) return;
      const node = findCanvasNode(current, nodeId);
      const batch = node?.data.batches.find((item) => item.id === batchId);
      if (node === null || batch === undefined) return;
      const reused = reuseFromBatch(batch);
      if (reused === null) {
        setNotice(t('canvas.studio.reuseBatchMissing'));
        return;
      }
      handleDraftChange(nodeId, {
        prompt: reused.prompt,
        settings: reused.settings,
        references: reused.references,
      });
      setNotice(t('canvas.studio.reuseBatchDone'));
    },
    [handleDraftChange, t],
  );

  /** S5-B3b：用当前可见版本创建一个邻近**草稿**节点，绝不提交 */
  const continueFromVersion = useCallback(
    (nodeId: string): void => {
      const current = docRef.current;
      if (current === null) return;
      const source = findCanvasNode(current, nodeId);
      if (source === null) return;
      const visible = canvasNodeVisibleOutput(source);
      if (visible.state === 'invalid') {
        setNotice(t('canvas.studio.versionInvalid'));
        return;
      }
      if (visible.state !== 'selected' && visible.state !== 'latest') {
        setNotice(t('canvas.studio.continueNoOutput'));
        return;
      }
      const output = visible.output;
      if (output.kind !== 'image' && output.kind !== 'video') {
        setNotice(t('canvas.studio.continueUnsupported'));
        return;
      }

      // 按当前引擎能力门控：图片需要 i2v/fl2v，视频需要 v2v；未自检不拦
      const provider = canvasDefaultProvider(source, {
        providerStatus,
        hasCloudKey: resolveProviderKey(byok) !== undefined,
      });
      const modes = provider.startsWith('http-service:')
        ? httpServiceEngineOptions(providerStatus).find((item) => item.id === provider)?.modes
        : provider === 'cloud-volcano-seedance'
          ? undefined
          : comfyUiEngineOptions(providerStatus).find((item) => item.id === provider)?.modes;
      const needed = output.kind === 'image' ? ['i2v', 'fl2v'] : ['v2v'];
      if (modes !== undefined && !modes.some((mode) => needed.includes(mode))) {
        setNotice(t('canvas.studio.continueUnsupported'));
        return;
      }

      const id = newCanvasProjectId();
      const draft = createCanvasNode({
        id,
        type: 'video',
        x: source.layout.x + source.layout.width + 80,
        y: source.layout.y,
        title: t('canvas.studio.newNode', { type: labels.video }),
        createdFrom: 'toolbar',
      });
      draft.data.draft.settings = { ...source.data.draft.settings };
      draft.data.draft.references = [
        {
          assetId: output.assetId,
          role: output.kind === 'video' ? 'reference-video' : 'first-frame',
          order: 0,
        },
      ];
      pendingSelect.current = id;
      applyDoc((d) => {
        const withNode: CanvasDoc = {
          ...d,
          nodes: [...d.nodes, draft],
          updatedAt: Date.now(),
        };
        // 「引用即连线」：新节点的参考来自上游产物，图上要能看见这条来源关系
        return reconcileReferenceLineage(withNode, id).doc;
      });
      setNotice(t('canvas.studio.continueCreated'));
    },
    [applyDoc, byok, labels.video, providerStatus, t],
  );

  /** S5-Ac：把来源选择写成稳定引用（不复制文件、不新建节点） */
  const addReferencesToNode = useCallback(
    (nodeId: string, sources: readonly ReferenceSourceItem[]): void => {
      const current = docRef.current;
      if (current === null) return;
      const node = findCanvasNode(current, nodeId);
      if (node === null) return;
      const result = addReferencesToDraft(
        node.data.draft.references,
        sources.map((source) => ({ ref: source.ref, kind: source.kind })),
        node.type,
        { referenceMode: node.data.draft.settings.referenceMode },
      );
      if (result.added === 0) {
        setNotice(t('canvas.studio.referenceLimited', { count: result.ignored }));
        return;
      }
      handleDraftChange(nodeId, { references: result.references });
      setNotice(
        result.ignored > 0
          ? t('canvas.studio.referenceLimited', { count: result.ignored })
          : t('canvas.studio.referenceAdded', { count: result.added }),
      );
    },
    [handleDraftChange, t],
  );

  // ── 选择 / 菜单 / 快捷键 ────────────────────────────────────────────────
  const handleSelectionChange = useCallback(
    ({ nodes: selected, edges }: { nodes: StudioRfNode[]; edges?: Array<{ id: string }> }): void => {
      setSelectedIds(selected.map((node) => node.id));
      /**
       * B109：边是**受控**的（rfEdges 由 doc 派生）。选中的 `selected` 标记必须自己记住，
       * 否则任何一次重渲染（任务轮询 2s 一次）都会把 React Flow 的选中态重置掉 ——
       * 表现是"点一下边，说明闪一下又没了"。只在集合真的变化时更新，避免自激循环。
       */
      const next = new Set((edges ?? []).map((edge) => edge.id));
      setSelectedEdgeIds((prev) => {
        if (prev.size === next.size && [...next].every((id) => prev.has(id))) return prev;
        return next;
      });
    },
    [],
  );

  const handleDragStop = useCallback(
    (_event: unknown, node: StudioRfNode): void => {
      applyDoc((d) => moveCanvasNode(d, node.id, node.position));
    },
    [applyDoc],
  );

  /** S5-B2：平移/缩放停止后写回视口（不占撤销栈；切画布时避免写错项目） */
  const handleMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport): void => {
      if (switchingRef.current || skipSaveRef.current) return;
      applyDoc(
        (d) => ({
          ...d,
          viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
          updatedAt: Date.now(),
        }),
        { record: false, coalesceKey: 'viewport' },
      );
    },
    [applyDoc],
  );

    /** 连接柄拖拽 → 来源边；上游尚无产物时回退为计划依赖边（V2.61 / CONTRACT §21-11） */
    const handleConnect = useCallback(
      (connection: Connection): void => {
        const current = docRef.current;
        const from = connection.source;
        const to = connection.target;
        if (current === null || from === null || to === null) return;

        // V2.80：参考张数上限取**目标节点所用引擎**的配置事实（缺省 = 产品上限 12）
        const target = findCanvasNode(current, to);
        const engine =
          target === null
            ? undefined
            : canvasDefaultProvider(target, {
                providerStatus,
                hasCloudKey: resolveProviderKey(byok) !== undefined,
              });
        const capacity = comfyUiEngineOptions(providerStatus).find(
          (option) => option.id === engine,
        )?.maxReferences;

        const plan = planCanvasLineage(current, from, to, { maxReferences: capacity });
        if (!plan.ok) {
          if (plan.problem === 'source-no-output') {
            // 草稿之间先连成流水线是合法意图：建虚线计划边（不写参考），不是拒绝。
            const dep = planCanvasDependency(current, from, to);
            if (dep.ok) {
              const edgeId = `edge-${newCanvasProjectId()}`;
              setNotice(t('canvas.studio.lineage.plannedEdgeCreated'));
              applyDoc((d) => addCanvasDependencyEdge(d, from, to, edgeId).doc);
              return;
            }
            setNotice(t(DEPENDENCY_PROBLEM_KEYS[dep.problem]));
            return;
          }
          setNotice(
            plan.problem === 'references-full'
              ? t('canvas.studio.lineage.referencesFull', {
                  count: referenceLimit({ maxReferences: capacity }),
                })
              : t(LINEAGE_PROBLEM_KEYS[plan.problem]),
          );
          return;
        }
        const edgeId = `edge-${newCanvasProjectId()}`;
        setNotice(null);
        applyDoc((d) =>
          addCanvasLineageEdge(d, from, to, edgeId, Date.now(), { maxReferences: capacity }).doc,
        );
      },
      [applyDoc, byok, providerStatus, t],
    );

  const deleteEdge = useCallback(
    (edgeId: string): void => {
      applyDoc((d) => removeCanvasLineageEdge(d, edgeId));
    },
    [applyDoc],
  );

  const isValidConnection = useCallback(
    (connection: Connection | Edge): boolean => connection.source !== connection.target,
    [],
  );

  const openMenu = useCallback(
    (event: ReactMouseEvent | MouseEvent, nodeId: string | null): void => {
      event.preventDefault();
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect === undefined) return;
      setMenu({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        flow: rfRef.current?.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        }) ?? { x: 0, y: 0 },
        nodeId,
        edgeId: null,
      });
    },
    [],
  );

  const openEdgeMenu = useCallback((event: ReactMouseEvent, edge: Edge): void => {
    event.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    setMenu({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      flow: { x: 0, y: 0 },
      nodeId: null,
      edgeId: edge.id,
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (menu !== null || pickerOpen) return;
      // S5-B4d：任何模态层（预览/凭据/资产选择/项目面板）打开时暂停全局快捷键
      if (isModalLayerOpen()) return;
      if (isTextEditingTarget(event.target)) return;

      const mod = event.ctrlKey || event.metaKey;
      if (mod) {
        const key = event.key.toLocaleLowerCase();
        if (key === 'z') {
          event.preventDefault();
          if (event.shiftKey) redo();
          else undo();
          return;
        }
        if (key === 'y') {
          event.preventDefault();
          redo();
          return;
        }
        if (key === 'c') {
          event.preventDefault();
          copyNodes(selectedIds);
          return;
        }
        if (key === 'd') {
          event.preventDefault();
          duplicateNodes(selectedIds);
          return;
        }
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedIds.length === 0) return;
        event.preventDefault();
        deleteNodes(selectedIds);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [copyNodes, deleteNodes, duplicateNodes, menu, pickerOpen, redo, selectedIds, undo]);

  // ── 项目动作 ───────────────────────────────────────────────────────────
  const handleCreate = async (): Promise<void> => {
    if (index === null || switchingRef.current) return;
    if (submittingRef.current.size > 0) {
      setNotice(t('canvas.studio.guard.submitting'));
      return;
    }
    if (docRef.current !== null) {
      const ok = (await saveQueueRef.current?.flush()) ?? true;
      if (!ok) {
        setError(t('canvas.studio.saveBlocked'));
        return;
      }
    }
    const projectIdNext = newCanvasProjectId();
    const name = defaultCanvasName(index.projects);
    const fresh = createEmptyCanvasDoc(projectIdNext, name);
    switchingRef.current = true;
    setBusy(true);
    setPickerOpen(false);
    setMenu(null);
    try {
      const saved = await saveCanvasDoc(fresh, { revision: 1 });
      setIndex((prev) =>
        prev === null
          ? prev
          : setActiveCanvasProject(upsertCanvasProject(prev, saved.summary), projectIdNext),
      );
      writeActiveCanvasProjectId(projectIdNext);
      skipSaveRef.current = true;
      saveQueueRef.current?.setRevision(saved.revision);
      docRef.current = fresh;
      setDoc(fresh);
      setNodes([]);
      setSelectedIds([]);
      setLive({});
      historyRef.current = createCanvasHistory();
      setHistoryRev((value) => value + 1);
      setSaveState('saved');
      // 新画布沿用上一块的视口会让人以为"节点很小"：重置到 1:1 原点
      window.setTimeout(() => {
        rfRef.current?.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 });
      }, 40);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      switchingRef.current = false;
      setBusy(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (doc === null || switchingRef.current) return;
    if (submittingRef.current.size > 0) {
      setNotice(t('canvas.studio.guard.submitting'));
      return;
    }
    if (doc.nodes.some((node) => canvasNodeActiveBatches(node).length > 0)) {
      // 运行中或结果未知的批次都可能是唯一线索；整块画布删除前必须先收口
      setNotice(t('canvas.studio.guard.canvasActive'));
      return;
    }
    switchingRef.current = true;
    setBusy(true);
    setPickerOpen(false);
    setMenu(null);
    try {
      // 删除前等完在飞保存，避免迟到的 PUT 把文档又建回来；脏内容随删除丢弃
      const queue = saveQueueRef.current;
      if (queue !== null) await queue.settle();
      await deleteCanvasDoc(doc.projectId);
      queue?.cancel();
      if (readActiveCanvasProjectId() === doc.projectId) writeActiveCanvasProjectId(null);
      const nextIndex = removeCanvasProject(index ?? { version: 1, projects: [] }, doc.projectId);
      setIndex(nextIndex);
      docRef.current = null;
      setDoc(null);
      setNodes([]);
      setSelectedIds([]);
      setLive({});
      historyRef.current = createCanvasHistory();
      setHistoryRev((value) => value + 1);
      const fallback = pickInitialCanvasProject(nextIndex);
      // 删除已成功：先放开互斥，fallback 的 openProject 才能进入
      switchingRef.current = false;
      if (fallback !== null) await openProject(fallback);
    } catch (caught) {
      setError(describeError(caught));
      // 删除失败：文档还在，把未保存内容重新排进队列
      const current = docRef.current;
      if (current !== null) saveQueueRef.current?.schedule(current);
    } finally {
      switchingRef.current = false;
      setBusy(false);
    }
  };

  const counts = doc === null ? { nodes: 0, edges: 0 } : canvasDocCounts(doc);
  const canUndo = canUndoCanvas(historyRef.current);
  const canRedo = canRedoCanvas(historyRef.current);
  // historyRev 只负责让上面两行在栈变化后重新求值
  void historyRev;

  const edgeSource = doc?.edges ?? null;

  /**
   * P1-2d：**上传素材**的封面（批次产物之外的另一半）。
   *
   * 早先只从批次产物建索引，所以"从资产库加进来的参考"永远没有缩略图 ——
   * 而即梦那边参考就是"看得见的那张图"。这里按项目拉一次资产清单补上：
   * 产物优先（下面 memo 里先写产物），资产只补空缺。
   *
   * 只取图片与视频；取不到 url 的条目直接跳过（不拼 URL、不猜扩展名）。
   */
  const [assetPreviews, setAssetPreviews] = useState<ReadonlyMap<string, ReferencePreview>>(
    () => new Map(),
  );
  const refreshAssetPreviews = useCallback(async (): Promise<void> => {
    try {
      const pool = await fetchAssets(projectId);
      const map = new Map<string, ReferencePreview>();
      for (const asset of pool.assets) {
        if (asset.kind === 'audio') continue;
        if (asset.url === '') continue;
        map.set(asset.assetId, { kind: asset.kind, url: resolveMediaUrl(asset.url) ?? asset.url });
      }
      setAssetPreviews(map);
    } catch {
      // 拉不到就保持旧值：缩略图是锦上添花，不该把画布打成错误态
    }
  }, [projectId]);
  useEffect(() => {
    void refreshAssetPreviews();
    // 切换画布/项目、或刚上传完新素材时，资产池会变，重新拉一次
  }, [refreshAssetPreviews, doc?.projectId, assetPreviewRev]);

  /**
   * 2026-10-24「引用缩略图」：assetId → 可显示的封面。
   *
   * 两个来源，产物优先：①节点批次产物（一定可显示）②资产清单（P1-2d 补的上传素材）。
   * 都没有就返回 null，组件退回文字标签 —— 不假装有图。
   */
  const referencePreviews = useMemo((): ReadonlyMap<string, ReferencePreview> => {
    const map = new Map<string, ReferencePreview>();
    if (doc === null) return map;
    for (const node of doc.nodes) {
      for (const batch of node.data.batches) {
        for (const output of batch.outputs) {
          if (output.kind !== 'image' && output.kind !== 'video') continue;
          if (map.has(output.assetId)) continue;
          // 图片直接用产物地址（一定可显示）；视频用服务端抽帧封面，失败由组件 onError 兜底
          const url =
            output.kind === 'image'
              ? (resolveMediaUrl(output.url) ?? referenceThumbnailPath(output.assetId))
              : referenceThumbnailPath(output.assetId);
          map.set(output.assetId, { kind: output.kind, url });
        }
      }
    }
    // 资产清单补齐空缺（产物地址优先：那是"这一次真正生成的图"）
    for (const [assetId, preview] of assetPreviews) {
      if (!map.has(assetId)) map.set(assetId, preview);
    }
    return map;
  }, [doc, assetPreviews]);

  const referencePreview = useCallback(
    (assetId: string): ReferencePreview | null => referencePreviews.get(assetId) ?? null,
    [referencePreviews],
  );

  /**
   * B109 / D76：边的说明只在**悬停 / 选中 / 键盘焦点**出现（CSS 控制显隐），
   * 默认没有常驻箭头与标签；文字里带来源、目标、用途与"连接那一刻的版本"。
   * 版本缺失时写「版本未记录」，不拿当前最新产物冒充历史引用。
   */
  const edgeLabelText = (summary: CanvasEdgeSummary): string => {
    const endpoint = (end: CanvasEdgeEndpoint): string => {
      if (end.missing) return t('canvas.edge.nodeMissing');
      if (end.label !== undefined) return end.label;
      const typeKey = `canvas.node.type.${end.type ?? 'text'}` as MessageKey;
      return `${t(typeKey)} ${edgeShortId(end.id)}`;
    };
    const parts = [
      `${endpoint(summary.source)} → ${endpoint(summary.target)}`,
      t(summary.kind === 'lineage' ? 'canvas.edge.lineage' : 'canvas.edge.dependency'),
    ];
    if (summary.role !== undefined) parts.push(t(ROLE_KEYS[summary.role]));
    parts.push(
      summary.version === undefined
        ? t('canvas.edge.versionMissing')
        : t('canvas.edge.version', {
            version:
              summary.version.length > 18
                ? `${summary.version.slice(0, 18)}…`
                : summary.version,
          }),
    );
    return parts.join(' · ');
  };

  const edgeNodeSource = doc?.nodes ?? null;
  const rfEdges = useMemo<Edge[]>(() => {
    if (edgeSource === null) return NO_EDGES;
    const nodes = edgeNodeSource ?? [];
    return edgeSource.map((edge) => {
      const summary = canvasEdgeSummary(edge, nodes);
      const label = summary === null ? undefined : edgeLabelText(summary);
      return {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        // 自然曲线（不是折线），端点锚定节点边缘；默认无箭头
        type: 'default',
        animated: edge.kind === 'dependency',
        className: `cs-edge cs-edge--${edge.kind}`,
        selected: selectedEdgeIds.has(edge.id),
        // 命中区比线宽大：1px 的线也要能 hover / 选中
        interactionWidth: 24,
        ...(label === undefined
          ? {}
          : {
              label,
              labelShowBg: true,
              labelBgPadding: [6, 4] as [number, number],
              labelBgBorderRadius: 4,
            }),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edgeSource, edgeNodeSource, selectedEdgeIds, t]);

  const menuItems: CanvasMenuItem[] =
    menu === null
      ? []
      : menu.edgeId !== null
        ? [
            {
              id: 'delete-edge',
              label: t('canvas.studio.deleteEdge'),
              danger: true,
              onSelect: () => deleteEdge(menu.edgeId as string),
            },
            'separator',
            { id: 'undo', label: t('canvas.studio.undo'), disabled: !canUndo, onSelect: undo },
            { id: 'redo', label: t('canvas.studio.redo'), disabled: !canRedo, onSelect: redo },
          ]
        : menu.nodeId === null
          ? [
              ...ADDABLE.map((type) => ({
                id: `new-${type}`,
                label: t('canvas.studio.newNode', { type: labels[type] }),
                onSelect: () => addNode(type, menu.flow),
              })),
              'separator',
              {
                id: 'paste',
                label: t('canvas.studio.paste'),
                disabled: clipboardCount === 0,
                onSelect: () => pasteAt(menu.flow),
              },
              'separator',
              { id: 'undo', label: t('canvas.studio.undo'), disabled: !canUndo, onSelect: undo },
              { id: 'redo', label: t('canvas.studio.redo'), disabled: !canRedo, onSelect: redo },
            ]
          : [
              {
                id: 'copy',
                label: t('canvas.studio.copy'),
                onSelect: () => copyNodes([menu.nodeId as string]),
              },
              {
                id: 'duplicate',
                label: t('canvas.studio.duplicate'),
                onSelect: () => duplicateNodes([menu.nodeId as string]),
              },
              {
                id: 'delete',
                label: t('canvas.studio.deleteNode'),
                danger: true,
                onSelect: () => deleteNodes([menu.nodeId as string]),
              },
              'separator',
              { id: 'undo', label: t('canvas.studio.undo'), disabled: !canUndo, onSelect: undo },
              { id: 'redo', label: t('canvas.studio.redo'), disabled: !canRedo, onSelect: redo },
            ];

  return (
    <section className="wb-page cs-page">
      <header className="cs-top">
        <div className="cs-top-left">
          {index !== null && index.projects.length > 0 ? (
            <select
              className="cs-select"
              aria-label={t('canvas.studio.new')}
              value={doc?.projectId ?? ''}
              onChange={(event) => {
                const picked = index.projects.find((p) => p.projectId === event.target.value);
                if (picked !== undefined) void openProject(picked);
              }}
            >
              {index.projects.map((p) => (
                <option key={p.projectId} value={p.projectId}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : null}
          <input
            key={`${doc?.projectId ?? 'none'}:${reloadNonce}`}
            className="cs-title"
            defaultValue={doc?.name ?? ''}
            disabled={doc === null}
            aria-label={t('canvas.studio.nameLabel')}
            onBlur={(event) => {
              const next = event.target.value;
              applyDoc((d) => renameCanvasDoc(d, next));
            }}
          />
          <span className="cs-counts">
            {t('canvas.studio.counts', { nodes: counts.nodes, edges: counts.edges })}
          </span>
          <span className="cs-save" data-state={saveState} role="status" aria-live="polite">
            {saveState === 'dirty'
              ? t('canvas.studio.unsaved')
              : saveState === 'saving'
                ? t('canvas.studio.saving')
                : saveState === 'error'
                  ? t('canvas.studio.saveFailed')
                  : t('canvas.studio.saved')}
          </span>
          {saveState === 'error' ? (
            <button
              type="button"
              className="cs-save-retry"
              title={conflict ? t('canvas.studio.conflict') : undefined}
              onClick={() =>
                conflict ? void reloadCanvas() : void saveQueueRef.current?.flush()
              }
            >
              {conflict ? t('canvas.studio.reload') : t('canvas.studio.retrySave')}
            </button>
          ) : null}
        </div>
        <div className="cs-top-right">
          <button
            type="button"
            className="wb-btn"
            data-testid="canvas-inspector-toggle"
            aria-expanded={inspectorOpen}
            disabled={doc === null || selectedIds.length === 0}
            onClick={() => {
              setInspectorOpen((value) => !value);
              setAgentOpen(false);
            }}
          >
            {t('canvas.inspector.open')}
          </button>
          <button
            type="button"
            className="wb-btn"
            data-testid="canvas-agent-toggle"
            aria-expanded={agentOpen}
            disabled={doc === null}
            onClick={() => {
              setAgentOpen((value) => !value);
              setInspectorOpen(false);
            }}
          >
            {t('canvas.agent.open')}
          </button>
          <button
            type="button"
            className="wb-btn cs-icon-btn"
            aria-label={t('canvas.studio.undo')}
            title={t('canvas.studio.undo')}
            disabled={!canUndo}
            onClick={undo}
          >
            ↶
          </button>
          <button
            type="button"
            className="wb-btn cs-icon-btn"
            aria-label={t('canvas.studio.redo')}
            title={t('canvas.studio.redo')}
            disabled={!canRedo}
            onClick={redo}
          >
            ↷
          </button>
          <button type="button" className="wb-btn" disabled={busy} onClick={() => void handleCreate()}>
            {t('canvas.studio.new')}
          </button>
          <button
            type="button"
            className="wb-btn"
            disabled={busy || doc === null}
            onClick={() => void handleDelete()}
          >
            {t('canvas.studio.delete')}
          </button>
        </div>
      </header>

      {error === null ? null : (
        <p className="wb-note cs-error" role="alert">
          {error}
        </p>
      )}
      {notice === null ? null : (
        <p className="wb-note cs-notice" role="status">
          {notice}
        </p>
      )}

      {doc === null ? (
        <div className="cs-empty">
          <p className="cs-empty-title">{t('canvas.studio.empty')}</p>
          <p className="wb-note">{t('canvas.studio.emptyHint')}</p>
          <button
            type="button"
            className="wb-btn wb-btn-primary"
            disabled={busy}
            onClick={() => void handleCreate()}
          >
            {t('canvas.studio.new')}
          </button>
        </div>
      ) : (
        <StudioProvider
          value={{
            doc,
            live,
            submitting,
            referencePreview,
            onDraftChange: handleDraftChange,
            onSubmit: (id) => void submitNode(id),
            onUpscale: (id, scale) => {
              const current = docRef.current;
              const node = current === null ? null : findCanvasNode(current, id);
              if (current === null || node === null) return;
              const request = buildCanvasUpscaleRequest({
                node,
                provider: canvasDefaultProvider(node, {
                  providerStatus,
                  hasCloudKey: resolveProviderKey(byok) !== undefined,
                }),
                projectId,
                canvasProjectId: current.projectId,
                scale,
              });
              if (request === null) {
                // 没有可见产物就不该出现这个按钮；真点到了也只说一句，不静默什么都不做
                setNotice(t('canvas.studio.issue.imageUnavailable'));
                return;
              }
              void submitNode(id, request);
            },
            onInpaint: (id, mask, size) => {
              const current = docRef.current;
              const node = current === null ? null : findCanvasNode(current, id);
              if (current === null || node === null) return;
              const visible = canvasNodeVisibleOutput(node);
              if (visible.state !== 'selected' && visible.state !== 'latest') {
                setNotice(t('canvas.studio.issue.imageUnavailable'));
                return;
              }
              const provider = canvasDefaultProvider(node, {
                providerStatus,
                hasCloudKey: resolveProviderKey(byok) !== undefined,
              });
              void (async () => {
                try {
                  // 蒙版走普通上传通道（与服务端同一套清洗/落盘），拿回 assetId 再提交
                  const uploaded = await uploadAssets(
                    [new File([mask], 'mask.png', { type: 'image/png' })],
                    projectId,
                  );
                  const maskId = uploaded.assets[0]?.assetId;
                  if (maskId === undefined) throw new Error('蒙版上传失败：服务端没有返回 assetId');
                  const request: VideoGenerateRequest = {
                    // 提示词仍是"要画成什么"的描述；`{{image:N}}` 这类占位符发上游前剥掉
                    prompt: stripCanvasMentions(node.data.draft.prompt),
                    mode: 'inpaint',
                    assets: { firstFrameImage: visible.output.assetId, maskImage: maskId },
                    aspectRatio: canvasAspectRatio(node),
                    // 蒙版与底图同尺寸：这里必须用图片的真实宽高，不能走像素预算缩放
                    resolution: size,
                    provider,
                    projectId,
                    origin: 'canvas',
                    canvasProjectId: current.projectId,
                  };
                  await submitNode(id, request);
                } catch (caught) {
                  setNotice(describeError(caught));
                }
              })();
            },
            onOutpaint: (id, expand, size) => {
              const current = docRef.current;
              const node = current === null ? null : findCanvasNode(current, id);
              if (current === null || node === null) return;
              const visible = canvasNodeVisibleOutput(node);
              if (visible.state !== 'selected' && visible.state !== 'latest') {
                setNotice(t('canvas.studio.issue.imageUnavailable'));
                return;
              }
              const provider = canvasDefaultProvider(node, {
                providerStatus,
                hasCloudKey: resolveProviderKey(byok) !== undefined,
              });
              const request: VideoGenerateRequest = {
                prompt: stripCanvasMentions(node.data.draft.prompt),
                mode: 'outpaint',
                assets: { firstFrameImage: visible.output.assetId },
                aspectRatio: canvasAspectRatio(node),
                // 底图真实宽高：服务端据此算外扩后的画布
                resolution: size,
                provider,
                projectId,
                origin: 'canvas',
                canvasProjectId: current.projectId,
                options: { expand },
              };
              void submitNode(id, request);
            },
            onRecover: (id, batchId) => void recoverSubmit(id, batchId),
            onAddReference: (id) => {
              setPickerReferenceNodeId(id);
              setPickerOpen(true);
            },
            onSelectBatch: selectBatch,
            onContinueFromVersion: continueFromVersion,
            onReuseBatch: reuseBatch,
            onDeselect: handleDeselect,
          }}
        >
          <div className="cs-workspace">
            <nav className="cs-rail" aria-label={t('canvas.studio.add')}>
              {ADDABLE.map((type) => (
                <button
                  key={type}
                  type="button"
                  className="cs-rail-btn"
                  onClick={() => addNode(type)}
                  title={labels[type]}
                >
                  {labels[type]}
                </button>
              ))}
              <button
                type="button"
                className="cs-rail-btn"
                onClick={() => {
                  setPickerReferenceNodeId(null);
                  setPickerOpen(true);
                }}
                title={t('canvas.studio.fromAssets')}
              >
                {t('canvas.studio.fromAssets')}
              </button>
              <button
                type="button"
                className="cs-rail-btn"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                title={t('canvas.studio.upload')}
              >
                {uploading ? t('canvas.studio.uploading') : t('canvas.studio.upload')}
              </button>
              <input
                ref={fileRef}
                className="cs-file"
                type="file"
                multiple
                accept="image/*,video/*,audio/*"
                onChange={(event) => {
                  const picked = event.target.files === null ? [] : Array.from(event.target.files);
                  event.target.value = '';
                  void handleUpload(picked);
                }}
              />
            </nav>

            <div
              className={dragActive ? 'cs-canvas is-drop' : 'cs-canvas'}
              ref={canvasRef}
              onDoubleClick={(event) => {
                if (
                  (event.target as HTMLElement).closest(
                    '.react-flow__node, .cs-toolbar, .cs-modal, .cs-menu',
                  ) !== null
                ) {
                  return;
                }
                openMenu(event, null);
              }}
              onDragOver={(event) => {
                if (!Array.from(event.dataTransfer.types).includes('Files')) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
                setDragActive(true);
              }}
              onDragLeave={(event) => {
                const next = event.relatedTarget;
                if (next instanceof Node && event.currentTarget.contains(next)) return;
                setDragActive(false);
              }}
              onDrop={(event) => {
                if (
                  (event.target as HTMLElement).closest('.cs-toolbar, .cs-modal, .cs-menu') !== null
                ) {
                  return;
                }
                const files = Array.from(event.dataTransfer.files);
                if (files.length === 0) return;
                event.preventDefault();
                setDragActive(false);
                void handleUpload(files);
              }}
            >
              {dragActive ? (
                <div className="cs-drop-hint">{t('canvas.studio.dropHint')}</div>
              ) : null}
              <ReactFlow
                nodes={nodes}
                edges={rfEdges}
                nodeTypes={NODE_TYPES}
                onNodesChange={onNodesChange}
                onNodeDragStop={handleDragStop}
                onMoveEnd={handleMoveEnd}
                onConnect={handleConnect}
                isValidConnection={isValidConnection}
                onSelectionChange={handleSelectionChange}
                onEdgesChange={(changes) => {
                  // B109：边是受控的（doc 派生）。React Flow 的选中变化只回传到这里，
                  // 不接的话选中态会被下一次轮询刷新掉（点一下闪一下）。
                  const selection = changes.filter((change) => change.type === 'select');
                  if (selection.length === 0) return;
                  setSelectedEdgeIds((prev) => {
                    const next = new Set(prev);
                    for (const change of selection) {
                      if (change.selected) next.add(change.id);
                      else next.delete(change.id);
                    }
                    if (prev.size === next.size && [...next].every((id) => prev.has(id))) {
                      return prev;
                    }
                    return next;
                  });
                }}
                onNodeContextMenu={(event, node) => openMenu(event, node.id)}
                onEdgeContextMenu={openEdgeMenu}
                onPaneContextMenu={(event) => openMenu(event, null)}
                onPaneClick={() => setMenu(null)}
                deleteKeyCode={null}
                onInit={(instance) => {
                  rfRef.current = instance;
                }}
                minZoom={0.2}
                maxZoom={2}
                zoomOnDoubleClick={false}
                proOptions={{ hideAttribution: true }}
                onlyRenderVisibleElements
              >
                <Background gap={16} />
                <Controls />
                <MiniMap pannable zoomable />
              </ReactFlow>
              {menu === null ? null : (
                <CanvasContextMenu
                  x={menu.x}
                  y={menu.y}
                  items={menuItems}
                  onClose={() => setMenu(null)}
                />
              )}
            </div>
            {inspectorOpen && selectedIds[0] !== undefined ? (
              <CanvasNodeInspector
                doc={doc}
                nodeId={selectedIds[0]}
                onClose={() => setInspectorOpen(false)}
              />
            ) : null}
            {agentOpen ? (
              <CanvasAgentPanel
                key={doc.projectId}
                doc={doc}
                projectId={projectId}
                {...(selectedIds[0] === undefined ? {} : { selectedNodeId: selectedIds[0] })}
                onCreateText={createAgentTextNode}
                onUpdateText={updateAgentTextNode}
                onLandStoryboard={landStoryboard}
                onClose={() => setAgentOpen(false)}
              />
            ) : null}
          </div>
        </StudioProvider>
      )}

      {pickerOpen ? (
        <AssetPickerDialog
          projectId={projectId}
          mode={pickerReferenceNodeId === null ? 'node' : 'reference'}
          allowedKinds={
            pickerReferenceNodeId === null
              ? undefined
              : allowedKindsForReferenceTarget(
                  (doc === null
                    ? null
                    : findCanvasNode(doc, pickerReferenceNodeId)
                  )?.data.draft.references ?? [],
                )
          }
          onClose={() => {
            setPickerOpen(false);
            setPickerReferenceNodeId(null);
          }}
          onConfirm={(sources) => {
            if (pickerReferenceNodeId === null) {
              addAssets(
                sources.map((source) => ({
                  assetId: source.ref,
                  kind: source.kind,
                  url: source.url,
                  name: source.label,
                })),
                'from_asset',
              );
            } else {
              addReferencesToNode(pickerReferenceNodeId, sources);
            }
            setPickerOpen(false);
            setPickerReferenceNodeId(null);
          }}
        />
      ) : null}
    </section>
  );
}
