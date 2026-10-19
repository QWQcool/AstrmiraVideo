import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useNodesState,
  type Node as RFNode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type {
  CanvasDoc,
  CanvasNodeType,
  CanvasProjectIndex,
} from '@astrmira/shared';
import { createEmptyCanvasDoc } from '@astrmira/shared';
import {
  ApiError,
  deleteCanvasDoc,
  fetchCanvasDoc,
  fetchCanvasIndex,
  saveCanvasDoc,
} from '../lib/api';
import {
  addCanvasNode,
  canvasDocCounts,
  canvasNodeTitle,
  moveCanvasNode,
  nextCanvasNodePosition,
  renameCanvasDoc,
} from '../lib/canvasDocOps';
import {
  defaultCanvasName,
  newCanvasProjectId,
  pickInitialCanvasProject,
  removeCanvasProject,
  setActiveCanvasProject,
  upsertCanvasProject,
} from '../lib/canvasProjects';
import { useTranslate } from '../lib/i18n';

/**
 * 创作画布（Step 11-S3 片 B2；设计基准 §7.3 / §21）。
 *
 * 这一版只做**骨架**：项目切换、新建/删除、文档读写、节点增删拖动、自动保存。
 * 浮动创作框、资产库选择器、本地上传、撤销栈、来源边（lineage）在 B3/B4 补齐 ——
 * 界面不预先放"点了没反应"的按钮。
 *
 * 旧的只读血缘图暂时保留在 `#/lineage`（隐藏路由），等 B4 把来源边做进新画布后下线。
 */

const ADDABLE: readonly CanvasNodeType[] = ['text', 'image', 'video', 'audio'];

function toRfNodes(doc: CanvasDoc): RFNode[] {
  return doc.nodes.map((node) => ({
    id: node.id,
    position: { x: node.layout.x, y: node.layout.y },
    data: { label: node.data.title ?? node.id },
    type: 'default',
    className: `cs-node cs-node--${node.type}`,
  }));
}

export function CanvasStudioView() {
  const t = useTranslate();
  const [index, setIndex] = useState<CanvasProjectIndex | null>(null);
  const [doc, setDoc] = useState<CanvasDoc | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const labels = useMemo(
    () => ({
      text: t('canvas.node.text'),
      image: t('common.kind.image'),
      video: t('common.kind.video'),
      audio: t('common.kind.audio'),
    }),
    [t],
  );

  const openProject = useCallback(
    async (projectId: string, fallbackName: string): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        let next: CanvasDoc;
        try {
          next = await fetchCanvasDoc(projectId);
        } catch (caught) {
          // 404 = 这个画布还没保存过：本地起一份空文档，第一次编辑时再落盘
          if (caught instanceof ApiError && caught.failure.status === 404) {
            next = createEmptyCanvasDoc(projectId, fallbackName);
          } else {
            throw caught;
          }
        }
        setDoc(next);
        setNodes(toRfNodes(next));
        setSaveState('saved');
        setIndex((prev) => (prev === null ? prev : setActiveCanvasProject(prev, projectId)));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
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
        if (initial !== null) await openProject(initial.projectId, initial.name);
      } catch (caught) {
        if (alive) setError(caught instanceof Error ? caught.message : String(caught));
      }
    })();
    return () => {
      alive = false;
    };
  }, [openProject]);

  /**
   * 文档 → React Flow 节点的同步。
   *
   * 只按 **projectId + 节点数** 触发：拖动时节点数不变，位置由 React Flow 自己维护并回写文档；
   * 若依赖整个 `doc`，每次 `onNodeDragStop` 都会重建节点数组，拖动手感会抖。
   */
  useEffect(() => {
    if (doc === null) return;
    setNodes(toRfNodes(doc));
    // 刻意只依赖"项目 + 节点数"：拖动时节点数不变，位置由 React Flow 维护并回写文档。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.projectId, doc?.nodes.length, setNodes]);

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
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      })();
    }, 600);
    return () => {
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    };
    // 依赖整个 doc：任何编辑（改名/加节点/拖动）都会触发一次去抖保存
  }, [doc]);

  const handleCreate = async (): Promise<void> => {
    if (index === null) return;
    const projectId = newCanvasProjectId();
    const name = defaultCanvasName(index.projects);
    const fresh = createEmptyCanvasDoc(projectId, name);
    setBusy(true);
    try {
      const saved = await saveCanvasDoc(fresh);
      setIndex((prev) =>
        prev === null
          ? prev
          : setActiveCanvasProject(upsertCanvasProject(prev, saved.summary), projectId),
      );
      setDoc(fresh);
      setNodes([]);
      setSaveState('saved');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (doc === null) return;
    setBusy(true);
    try {
      await deleteCanvasDoc(doc.projectId);
      const nextIndex = removeCanvasProject(index ?? { version: 1, projects: [] }, doc.projectId);
      setIndex(nextIndex);
      setDoc(null);
      setNodes([]);
      const fallback = pickInitialCanvasProject(nextIndex);
      if (fallback !== null) await openProject(fallback.projectId, fallback.name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = (type: CanvasNodeType): void => {
    if (doc === null) return;
    const position = nextCanvasNodePosition(doc);
    const next = addCanvasNode(doc, {
      id: newCanvasProjectId(),
      type,
      x: position.x,
      y: position.y,
      title: canvasNodeTitle(doc, type, labels),
    }).doc;
    setDoc(next);
  };

  const handleDragStop = (_event: unknown, node: RFNode): void => {
    if (doc === null) return;
    setDoc(moveCanvasNode(doc, node.id, { x: node.position.x, y: node.position.y }));
  };

  const counts = doc === null ? { nodes: 0, edges: 0 } : canvasDocCounts(doc);

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
                if (picked !== undefined) void openProject(picked.projectId, picked.name);
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
              if (doc !== null) setDoc(renameCanvasDoc(doc, event.target.value));
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

      {doc === null ? (
        <div className="cs-empty">
          <p className="cs-empty-title">{t('canvas.studio.empty')}</p>
          <p className="wb-note">{t('canvas.studio.emptyHint')}</p>
          <button type="button" className="wb-btn wb-btn-primary" disabled={busy} onClick={() => void handleCreate()}>
            {t('canvas.studio.new')}
          </button>
        </div>
      ) : (
        <div className="cs-workspace">
          <nav className="cs-rail" aria-label={t('canvas.studio.add')}>
            {ADDABLE.map((type) => (
              <button
                key={type}
                type="button"
                className="cs-rail-btn"
                onClick={() => handleAdd(type)}
                title={labels[type]}
              >
                {labels[type]}
              </button>
            ))}
          </nav>
          <div className="cs-canvas">
            <ReactFlow
              nodes={nodes}
              edges={[]}
              onNodesChange={onNodesChange}
              onNodeDragStop={handleDragStop}
              fitView
              minZoom={0.2}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={16} />
              <Controls />
              <MiniMap pannable zoomable />
            </ReactFlow>
          </div>
        </div>
      )}
    </section>
  );
}
