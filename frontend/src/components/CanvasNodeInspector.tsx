import type { CanvasDoc, CanvasDocNode } from '@astrmira/shared';
import { useTranslate } from '../lib/i18n';

/**
 * P6：画布节点检查器（只读）。
 *
 * 审计结果：即梦用 group 包住节点，并提供节点详情/资源状态；我们当前画布
 * 只有卡片，缺一个“这条是怎么来的”出口。分组会改 CanvasDoc schema，先做
 * 不改数据的检查器，避免为了视觉面板动存储格式。
 */
export interface CanvasNodeInspectorProps {
  doc: CanvasDoc;
  nodeId: string;
  onClose(): void;
}

function upstreamOf(doc: CanvasDoc, nodeId: string): CanvasDocNode[] {
  const ids = new Set(doc.edges.filter((edge) => edge.to === nodeId).map((edge) => edge.from));
  return doc.nodes.filter((node) => ids.has(node.id));
}

function downstreamOf(doc: CanvasDoc, nodeId: string): CanvasDocNode[] {
  const ids = new Set(doc.edges.filter((edge) => edge.from === nodeId).map((edge) => edge.to));
  return doc.nodes.filter((node) => ids.has(node.id));
}

export function CanvasNodeInspector({ doc, nodeId, onClose }: CanvasNodeInspectorProps) {
  const t = useTranslate();
  const node = doc.nodes.find((item) => item.id === nodeId);
  if (node === undefined) return null;
  const upstream = upstreamOf(doc, nodeId);
  const downstream = downstreamOf(doc, nodeId);
  const references = node.data.draft.references;

  return (
    <aside
      className="cs-inspector"
      data-testid="canvas-node-inspector"
      aria-label={t('canvas.node.inspectorTitle')}
    >
      <div className="cs-inspector-head">
        <div>
          <h3 className="cs-agent-title">{t('canvas.node.inspectorTitle')}</h3>
          <p className="wb-note">{node.data.title ?? node.id}</p>
        </div>
        <button
          type="button"
          className="wb-btn cs-icon-btn"
          data-testid="canvas-inspector-close"
          aria-label={t('common.close')}
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="cs-inspector-body">
        <dl className="lib-kv">
          <dt>{t('canvas.inspector.type')}</dt>
          <dd>{node.type}</dd>
          <dt>{t('canvas.inspector.createdFrom')}</dt>
          <dd>{node.meta?.createdFrom ?? t('canvas.inspector.unknown')}</dd>
          <dt>{t('canvas.inspector.batches')}</dt>
          <dd>{node.data.batches.length}</dd>
          <dt>{t('canvas.inspector.references')}</dt>
          <dd>{references.length}</dd>
        </dl>

        <section className="cs-inspector-section">
          <h4>{t('canvas.inspector.prompt')}</h4>
          <p className="wb-note cs-inspector-pre">
            {node.data.draft.prompt || t('canvas.inspector.noPrompt')}
          </p>
        </section>

        <section className="cs-inspector-section">
          <h4>{t('canvas.inspector.upstream')}</h4>
          <p className="wb-note">
            {upstream.length === 0
              ? t('canvas.inspector.none')
              : upstream.map((item) => item.data.title ?? item.id).join('、')}
          </p>
          <h4>{t('canvas.inspector.downstream')}</h4>
          <p className="wb-note">
            {downstream.length === 0
              ? t('canvas.inspector.none')
              : downstream.map((item) => item.data.title ?? item.id).join('、')}
          </p>
        </section>

        <section className="cs-inspector-section">
          <h4>{t('canvas.inspector.outputs')}</h4>
          {node.data.batches.length === 0 ? (
            <p className="wb-note">{t('canvas.inspector.none')}</p>
          ) : (
            <ul className="cs-inspector-batches">
              {node.data.batches.map((batch) => (
                <li key={batch.id}>
                  <span>{batch.status}</span>
                  <span className="wb-note">
                    {batch.outputs.length === 0
                      ? t('canvas.inspector.none')
                      : batch.outputs.map((output) => output.kind).join(' / ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}
