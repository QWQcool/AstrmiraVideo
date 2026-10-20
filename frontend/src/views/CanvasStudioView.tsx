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
  MarkerType,
  ReactFlow,
  useNodesState,
  type Connection,
  type Edge,
  type Node as RFNode,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { createEmptyCanvasDoc, type CanvasDocNode, type CanvasDoc, type CanvasNodeType, type CanvasProjectIndex, type CanvasReferenceRole, type TaskProgress } from '@astrmira/shared';
import type { AssetListEntry } from '@astrmira/shared';
import {
  ApiError,
  deleteCanvasDoc,
  fetchAssets,
  fetchCanvasDoc,
  fetchCanvasIndex,
  fetchTask,
  saveCanvasDoc,
  submitGenerate,
  uploadAssets,
} from '../lib/api';
import {
  addCanvasBatch,
  addCanvasNode,
  addCanvasNodesFromAssets,
  canvasActiveTasks,
  canvasBatchPatchFromTask,
  canvasDocCounts,
  canvasLostActiveTaskNodes,
  canvasNodeActiveBatches,
  canvasNodeTitle,
  duplicateCanvasNode,
  findCanvasNode,
  insertCanvasNodes,
  moveCanvasNode,
  nextCanvasNodePosition,
  nextCanvasNodePositions,
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
  canvasDefaultProvider,
  canvasDraftMode,
  canvasSubmitIssue,
  canvasSubmitIssueText,
} from '../lib/canvasNodeSubmit';
import { resolveProviderKey } from '../lib/byok';
import { createCanvasSaveQueue, type CanvasSaveState } from '../lib/canvasSaveQueue';
import { navigate, parseHash } from '../lib/router';
import {
  clearCanvasResultHandoff,
  peekCanvasResultHandoff,
  resultHandoffAsset,
  type CanvasResultHandoff,
} from '../lib/canvasHandoff';
import { newIdempotencyKey } from '../lib/idempotency';
import {
  addCanvasLineageEdge,
  planCanvasLineage,
  removeCanvasLineageEdge,
  type CanvasLineageProblem,
} from '../lib/canvasLineage';
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
import { CanvasContextMenu, type CanvasMenuItem } from '../canvas/studio/CanvasContextMenu';
import { StudioNode } from '../canvas/studio/StudioNode';
import { StudioProvider } from '../canvas/studio/StudioContext';

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
  'source-audio': 'canvas.studio.lineage.sourceAudio',
  'source-not-media': 'canvas.studio.lineage.sourceNotMedia',
  'target-not-video': 'canvas.studio.lineage.targetNotVideo',
  'role-taken': 'canvas.studio.lineage.roleTaken',
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

export function CanvasStudioView() {
  const t = useTranslate();
  const { byok, providerStatus, projectId } = useShell();

  const [index, setIndex] = useState<CanvasProjectIndex | null>(null);
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
  const [live, setLive] = useState<Record<string, TaskProgress>>({});
  const [submitting, setSubmitting] = useState<ReadonlySet<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
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
        window.setTimeout(() => {
          if (next.nodes.length > 0) {
            // maxZoom 1：单个节点不该被放大到 2 倍贴满视口（创作框会因此被上边缘裁掉）
            rfRef.current?.fitView({ padding: 0.2, maxZoom: 1, duration: 200 });
          } else {
            // 空画布：上一块画布的视口会留在实例里（React Flow 不随项目重挂载），重置到原点
            rfRef.current?.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 });
          }
        }, 60);
      } catch (caught) {
        setError(describeError(caught));
      } finally {
        switchingRef.current = false;
        setBusy(false);
      }
    },
    [setNodes, t],
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
      window.setTimeout(() => {
        if (next.nodes.length > 0) {
          rfRef.current?.fitView({ padding: 0.2, maxZoom: 1, duration: 200 });
        } else {
          rfRef.current?.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 });
        }
      }, 60);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      switchingRef.current = false;
      setBusy(false);
    }
  }, [setNodes]);

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
        } else if (!autoCreateRef.current && peekCanvasResultHandoff() !== null) {
          // 「去画布编辑」但一块画布都没有：先建一块，交接由下面的 effect 消费。
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

      const results = await Promise.all(
        tasks.map(async (task) => {
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
        }),
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
      } catch (caught) {
        setError(describeError(caught));
      } finally {
        setUploading(false);
      }
    },
    [addAssets, projectId, t],
  );

  // ── 提交生成 ───────────────────────────────────────────────────────────
  const submitNode = useCallback(
    async (nodeId: string): Promise<void> => {
      const current = docRef.current;
      if (current === null || switchingRef.current) return;
      const node = findCanvasNode(current, nodeId);
      if (node === null || submittingRef.current.has(nodeId)) return;

      const context = {
        providerStatus,
        hasCloudKey: resolveProviderKey(byok) !== undefined,
      };
      const provider = canvasDefaultProvider(node, context);
      const issue = canvasSubmitIssue(node, provider, context);
      if (issue !== null) {
        setNotice(canvasSubmitIssueText(issue));
        return;
      }

      let request: ReturnType<typeof buildCanvasGenerateRequest>;
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
            { settings: { provider, mode: canvasDraftMode(node).mode } },
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
      applyDoc((d) => updateCanvasNodeDraft(d, nodeId, patch), {
        coalesceKey: `draft:${nodeId}`,
      });
    },
    [applyDoc],
  );

  // ── 选择 / 菜单 / 快捷键 ────────────────────────────────────────────────
  const handleSelectionChange = useCallback(
    ({ nodes: selected }: { nodes: StudioRfNode[] }): void => {
      setSelectedIds(selected.map((node) => node.id));
    },
    [],
  );

  const handleDragStop = useCallback(
    (_event: unknown, node: StudioRfNode): void => {
      applyDoc((d) => moveCanvasNode(d, node.id, node.position));
    },
    [applyDoc],
  );

  /** 连接柄拖拽 → 来源边（规则见 CONTRACT §21-11；不合法时只提示，不建边） */
  const handleConnect = useCallback(
    (connection: Connection): void => {
      const current = docRef.current;
      const from = connection.source;
      const to = connection.target;
      if (current === null || from === null || to === null) return;
      const plan = planCanvasLineage(current, from, to);
      if (!plan.ok) {
        setNotice(t(LINEAGE_PROBLEM_KEYS[plan.problem]));
        return;
      }
      const edgeId = `edge-${newCanvasProjectId()}`;
      setNotice(null);
      applyDoc((d) => addCanvasLineageEdge(d, from, to, edgeId).doc);
    },
    [applyDoc, t],
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
      const target = event.target as HTMLElement | null;
      const editing =
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (editing) return;

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
        if (key === 'v') {
          event.preventDefault();
          pasteAt(viewportCenterFlow());
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
  }, [
    copyNodes,
    deleteNodes,
    duplicateNodes,
    pasteAt,
    redo,
    selectedIds,
    undo,
    viewportCenterFlow,
  ]);

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
  const rfEdges = useMemo<Edge[]>(() => {
    if (edgeSource === null) return NO_EDGES;
    return edgeSource.map((edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      type: 'smoothstep',
      animated: edge.kind === 'dependency',
      className: `cs-edge cs-edge--${edge.kind}`,
      ...(edge.role === undefined ? {} : { label: t(ROLE_KEYS[edge.role]) }),
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    }));
  }, [edgeSource, t]);

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
            aria-label="canvas name"
            onBlur={(event) => {
              const next = event.target.value;
              applyDoc((d) => renameCanvasDoc(d, next));
            }}
          />
          <span className="cs-counts">
            {t('canvas.studio.counts', { nodes: counts.nodes, edges: counts.edges })}
          </span>
          <span className="cs-save" data-state={saveState}>
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

      {error === null ? null : <p className="wb-note cs-error">{error}</p>}
      {notice === null ? null : <p className="wb-note cs-notice">{notice}</p>}

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
            onDraftChange: handleDraftChange,
            onSubmit: (id) => void submitNode(id),
            onRecover: (id, batchId) => void recoverSubmit(id, batchId),
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
                onClick={() => setPickerOpen(true)}
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

            <div className="cs-canvas" ref={canvasRef}>
              <ReactFlow
                nodes={nodes}
                edges={rfEdges}
                nodeTypes={NODE_TYPES}
                onNodesChange={onNodesChange}
                onNodeDragStop={handleDragStop}
                onConnect={handleConnect}
                isValidConnection={isValidConnection}
                onSelectionChange={handleSelectionChange}
                onNodeContextMenu={(event, node) => openMenu(event, node.id)}
                onEdgeContextMenu={openEdgeMenu}
                onPaneContextMenu={(event) => openMenu(event, null)}
                onPaneClick={() => setMenu(null)}
                deleteKeyCode={null}
                onInit={(instance) => {
                  rfRef.current = instance;
                }}
                fitView
                fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
                minZoom={0.2}
                maxZoom={2}
                proOptions={{ hideAttribution: true }}
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
          </div>
        </StudioProvider>
      )}

      {pickerOpen ? (
        <AssetPickerDialog
          projectId={projectId}
          onClose={() => setPickerOpen(false)}
          onConfirm={(assets) => {
            addAssets(assets, 'from_asset');
            setPickerOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}
