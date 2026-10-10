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
import type { AssetListEntry, TaskProgress } from '@astrmira/shared';
import { ApiError, fetchAssets, fetchHistory, resolveMediaUrl } from '../lib/api';
import { useShell } from '../lib/shell';
import {
  buildLineage,
  layoutLineage,
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

/** 节点详情抽屉：动作全部指向既有 hash 参数（零新路由、零契约） */
function CanvasDrawer({ node, onClose }: { node: LineageNode; onClose: () => void }) {
  const taskId = node.kind === 'task' ? node.taskId : undefined;
  const assetId = node.kind === 'asset' ? node.assetId : undefined;
  const outputUrl = resolveMediaUrl(node.outputVideoUrl ?? undefined);

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
      <p className="wb-note">{node.sublabel}</p>

      {node.ghost === true ? (
        <p className="wb-note cv-drawer-ghost">
          这个对象已不在当前列表里（删除过或超出最近 50 条）——仅作为血缘占位显示。
        </p>
      ) : null}

      {outputUrl === null ? null : <video className="cv-player" src={outputUrl} controls playsInline />}

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

  const graph = useMemo(() => buildLineage({ tasks, assets }), [tasks, assets]);
  const layout = useMemo(() => layoutLineage(graph), [graph]);

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
        data: { node },
      })),
    );
  }, [graph, layout, setFlowNodes]);

  const flowEdges = useMemo<Edge[]>(
    () =>
      graph.edges.map((edge) => {
        const style = EDGE_STYLE[edge.kind];
        return {
          id: edge.id,
          source: edge.from,
          target: edge.to,
          type: 'smoothstep',
          style: {
            stroke: style.stroke,
            ...(style.dash === undefined ? {} : { strokeDasharray: style.dash }),
          },
        };
      }),
    [graph],
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
            <div className="cv-canvas" data-testid="cv-canvas">
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

      {selected === null ? null : <CanvasDrawer node={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}
