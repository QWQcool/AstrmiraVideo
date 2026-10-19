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
  type Edge,
  type Node as RFNode,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { createEmptyCanvasDoc, type CanvasDocNode, type CanvasDoc, type CanvasNodeType, type CanvasProjectIndex, type TaskProgress } from '@astrmira/shared';
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
import { newIdempotencyKey } from '../lib/idempotency';
import { useTranslate } from '../lib/i18n';
import { useShell } from '../lib/shell';
import {
  defaultCanvasName,
  newCanvasProjectId,
  pickInitialCanvasProject,
  removeCanvasProject,
  setActiveCanvasProject,
  upsertCanvasProject,
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

/** 稳定的空边数组（B4 会把来源边接进来；先固定类型，避免 `edges={[]}` 被推断成 never[]） */
const NO_EDGES: Edge[] = [];

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
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
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
  } | null>(null);
  const [clipboardCount, setClipboardCount] = useState(0);
  const [historyRev, setHistoryRev] = useState(0);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docRef = useRef<CanvasDoc | null>(null);
  const historyRef = useRef(createCanvasHistory());
  const clipboardRef = useRef<readonly CanvasDocNode[]>([]);
  const submittingRef = useRef<Set<string>>(new Set());
  /** 新节点/副本插入后，等文档 → RF 同步时选中它 */
  const pendingSelect = useRef<string | null>(null);
  const rfRef = useRef<ReactFlowInstance<StudioRfNode, Edge> | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

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
        docRef.current = next;
        setDoc(next);
        setNodes([]);
        setSelectedIds([]);
        setLive({});
        historyRef.current = createCanvasHistory();
        setHistoryRev((value) => value + 1);
        setSaveState('saved');
        setIndex((prev) => (prev === null ? prev : setActiveCanvasProject(prev, project.projectId)));
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
        setBusy(false);
      }
    },
    [setNodes],
  );

  // 首次进入：读索引 → 打开上次的画布（没有就显示空态，不擅自新建）
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const loaded = await fetchCanvasIndex();
        if (!alive) return;
        setIndex(loaded);
        const initial = pickInitialCanvasProject(loaded);
        if (initial !== null) await openProject(initial);
      } catch (caught) {
        if (alive) setError(describeError(caught));
      }
    })();
    return () => {
      alive = false;
    };
  }, [openProject]);

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

  // 自动保存：600ms 去抖；保存成功后把摘要写回索引（列表就地更新）
  useEffect(() => {
    if (doc === null) return;
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    setSaveState('saving');
    saveTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const saved = await saveCanvasDoc(doc);
          setIndex((prev) => (prev === null ? prev : upsertCanvasProject(prev, saved.summary)));
          setSaveState('saved');
        } catch (caught) {
          setSaveState('error');
          setError(describeError(caught));
        }
      })();
    }, 600);
    return () => {
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    };
  }, [doc]);

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
    (assets: readonly AssetListEntry[], source: 'from_asset' | 'uploaded'): void => {
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
      if (current === null) return;
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
      // 批次先落文档（queued）：用户立刻看到"提交中"；拿到 taskId 后由轮询接手
      applyDoc(
        (d) =>
          addCanvasBatch(d, nodeId, {
            id: batchId,
            createdAt: now,
            status: 'queued',
            outputs: [],
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

      try {
        const request = buildCanvasGenerateRequest({
          node,
          provider,
          projectId,
          canvasProjectId: current.projectId,
          ...(byok.baseUrl.trim() === '' ? {} : { baseUrl: byok.baseUrl }),
          ...(byok.model.trim() === '' ? {} : { model: byok.model }),
        });
        const providerKey = resolveProviderKey(byok);
        const created = await submitGenerate(request, {
          idempotencyKey: newIdempotencyKey(),
          ...(providerKey === undefined ? {} : { providerKey }),
        });
        applyToSubmittedProject((d) =>
          patchCanvasBatch(d, nodeId, batchId, { taskId: created.taskId }, Date.now()),
        );
      } catch (caught) {
        const failure =
          caught instanceof ApiError
            ? {
                code: caught.failure.code ?? 'UPSTREAM_ERROR',
                message: caught.failure.message,
              }
            : {
                code: 'UPSTREAM_ERROR',
                message: caught instanceof Error ? caught.message : String(caught),
              };
        applyToSubmittedProject((d) =>
          patchCanvasBatch(d, nodeId, batchId, { status: 'failed', failure }, Date.now()),
        );
        setNotice(t('canvas.studio.submitFailed', { reason: failure.message }));
      } finally {
        submittingRef.current.delete(nodeId);
        setSubmitting(new Set(submittingRef.current));
      }
    },
    [applyDoc, byok, projectId, providerStatus, t],
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
      });
    },
    [],
  );

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
    if (index === null) return;
    const projectIdNext = newCanvasProjectId();
    const name = defaultCanvasName(index.projects);
    const fresh = createEmptyCanvasDoc(projectIdNext, name);
    setBusy(true);
    setPickerOpen(false);
    setMenu(null);
    try {
      const saved = await saveCanvasDoc(fresh);
      setIndex((prev) =>
        prev === null
          ? prev
          : setActiveCanvasProject(upsertCanvasProject(prev, saved.summary), projectIdNext),
      );
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
      setBusy(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (doc === null) return;
    setBusy(true);
    setPickerOpen(false);
    setMenu(null);
    try {
      await deleteCanvasDoc(doc.projectId);
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
      if (fallback !== null) await openProject(fallback);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const counts = doc === null ? { nodes: 0, edges: 0 } : canvasDocCounts(doc);
  const canUndo = canUndoCanvas(historyRef.current);
  const canRedo = canRedoCanvas(historyRef.current);
  // historyRev 只负责让上面两行在栈变化后重新求值
  void historyRev;

  const menuItems: CanvasMenuItem[] =
    menu === null
      ? []
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
            key={doc?.projectId ?? 'none'}
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
            {saveState === 'saving'
              ? t('canvas.studio.saving')
              : saveState === 'error'
                ? t('canvas.studio.saveFailed')
                : t('canvas.studio.saved')}
          </span>
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
          value={{ doc, live, submitting, onDraftChange: handleDraftChange, onSubmit: (id) => void submitNode(id) }}
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
                edges={NO_EDGES}
                nodeTypes={NODE_TYPES}
                onNodesChange={onNodesChange}
                onNodeDragStop={handleDragStop}
                onSelectionChange={handleSelectionChange}
                onNodeContextMenu={(event, node) => openMenu(event, node.id)}
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
