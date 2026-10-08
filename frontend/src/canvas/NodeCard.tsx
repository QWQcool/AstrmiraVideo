import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { LineageNode } from '../lib/lineage';

/**
 * 画布节点卡（P4 / B42）。两类节点共用一张卡：任务（成片 / 剪辑产物）与资产。
 *
 * 只读约束的落点：卡上**只有**两个 `isConnectable={false}` 的隐形 Handle ——
 * 它们的作用是给边一个锚点（React Flow 的边必须挂在 Handle 上），而不是提供拉线能力；
 * 再配合 `nodesConnectable={false}` 与不注册 `onConnect`，连线在画布上不可能被创建（D40）。
 */

export type LineageFlowNode = Node<{ node: LineageNode }, 'lineage'>;

export function LineageNodeCard({ data, selected }: NodeProps<LineageFlowNode>) {
  const { node } = data;
  const classes = [
    'cv-node',
    `cv-node-${node.kind}`,
    node.ghost === true ? 'cv-node-ghost' : '',
    selected === true ? 'cv-node-selected' : '',
  ]
    .filter((value) => value !== '')
    .join(' ');

  return (
    <div className={classes} data-node-id={node.id} data-ghost={node.ghost === true ? '1' : '0'}>
      <Handle type="target" position={Position.Left} isConnectable={false} className="cv-handle" />

      <div className="cv-node-thumb">
        {node.thumbnailUrl !== undefined && node.thumbnailUrl !== null ? (
          <img src={node.thumbnailUrl} alt="" loading="lazy" />
        ) : node.kind === 'asset' && node.url !== null && node.url !== undefined && node.assetKind === 'image' ? (
          <img src={node.url} alt="" loading="lazy" />
        ) : (
          <span className="cv-node-glyph">{node.kind === 'task' ? '🎬' : node.assetKind === 'video' ? '🎬' : '🖼'}</span>
        )}
      </div>

      <div className="cv-node-body">
        <span className="cv-node-label">
          {node.isEdit === true ? <span className="cv-node-badge">✂</span> : null}
          {node.label}
        </span>
        <span className="cv-node-sub">{node.sublabel}</span>
      </div>

      <Handle type="source" position={Position.Right} isConnectable={false} className="cv-handle" />
    </div>
  );
}
