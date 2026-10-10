import { useCallback, useEffect, useMemo, useState } from 'react';
import { Background, Controls, ReactFlow, type Edge } from '@xyflow/react';
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

  const flowNodes = useMemo<LineageFlowNode[]>(
    () =>
      graph.nodes.map((node) => ({
        id: node.id,
        type: 'lineage' as const,
        position: layout.positions[node.id] ?? { x: 0, y: 0 },
        data: { node },
      })),
    [graph, layout],
  );

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
                nodeTypes={nodeTypes}
                onNodeClick={(_event, node) => setSelected((node as LineageFlowNode).data.node)}
                nodesConnectable={false}
                deleteKeyCode={null}
                fitView
                minZoom={0.2}
                maxZoom={1.6}
              >
                <Background gap={24} />
                <Controls showInteractive={false} />
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
