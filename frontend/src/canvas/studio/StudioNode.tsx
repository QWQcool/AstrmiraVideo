import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { NodeToolbar, Position, useViewport, type NodeProps } from '@xyflow/react';
import { formatYuan, type CanvasNodeBatch, type CanvasNodeType, type TaskProgress } from '@astrmira/shared';

import { resolveMediaUrl } from '../../lib/api';
import { resolveProviderKey } from '../../lib/byok';
import { findCanvasNode, latestCanvasBatch, latestCanvasOutput } from '../../lib/canvasDocOps';
import {
  canvasAspectRatio,
  canvasDefaultProvider,
  canvasDurationSec,
  canvasResolutionTier,
  canvasSubmitIssue,
  canvasSubmitIssueText,
  estimateCanvasNodeCost,
} from '../../lib/canvasNodeSubmit';
import { comfyUiEngineOptions } from '../../lib/engineOptions';
import { DURATION_OPTIONS, RESOLUTION_TIERS, resolveTargetSize, type ResolutionTier } from '../../lib/format';
import { useTranslate, type Translate } from '../../lib/i18n';
import { useShell } from '../../lib/shell';
import { useStudio } from './StudioContext';

/**
 * 画布节点卡 + **锚定浮动创作框**（Step 11-S3 片 B3；CONTRACT §21-10）。
 *
 * 三件事：
 * 1. 卡片 = 媒体预览 + 批次状态（最近一次**成功**的产物；失败批次不把上一版顶掉）；
 * 2. 创作框 = React Flow 的 `NodeToolbar`（选中才出现，位置贴着节点，不遮住卡片本体）；
 * 3. 提交走 `POST /api/generate`（`origin:'canvas'`），产物/状态由轮询写回 `data.batches`。
 *
 * 进度百分比**只在运行中显示**（来自内存里的 live 表），不写进文档。
 */

function statusText(batch: CanvasNodeBatch, live: TaskProgress | undefined, t: Translate): string {
  if (batch.status === 'queued') {
    return batch.taskId === undefined ? t('canvas.studio.submitUnknown') : t('common.status.queued');
  }
  if (batch.status === 'running') {
    const percent = live?.progressPercent;
    return percent !== undefined && percent > 0
      ? t('canvas.studio.progress', { status: t('common.status.running'), percent: Math.round(percent) })
      : t('common.status.running');
  }
  if (batch.status === 'succeeded') return t('common.status.succeeded');
  if (batch.status === 'failed') return t('common.status.failed');
  return t('common.status.cancelled');
}

/**
 * 创作框贴哪一侧：默认右边，放不下就换左边，再不行上下。
 *
 * 为什么必须换边：画布高度只有几百像素，一个 420×300 的节点居中后，上方/下方都放不下一整块
 * 300×250 的创作框 —— 固定 `Top` 会被画布上边缘裁掉，输入框直接看不见（B3 实机踩到）。
 *
 * 为什么单独一个组件并且订阅视口：节点刚插入会被 `setCenter` 平移，平移前的测量结果是旧的
 * （会贴着左边把相邻节点盖住）。这里只在**选中时**挂载，所以订阅视口不会让全画布节点跟着重渲染。
 */
function StudioToolbar({
  cardRef,
  children,
}: {
  cardRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const [placement, setPlacement] = useState<Position>(Position.Right);
  const viewport = useViewport();

  useLayoutEffect(() => {
    const card = cardRef.current;
    const canvas = card?.closest('.react-flow');
    if (card === null || !(canvas instanceof HTMLElement)) return;
    const canvasRect = canvas.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const needed = 316; // 创作框 300 + 间距 16
    if (canvasRect.right - cardRect.right >= needed) setPlacement(Position.Right);
    else if (cardRect.left - canvasRect.left >= needed) setPlacement(Position.Left);
    else if (cardRect.top - canvasRect.top >= 260) setPlacement(Position.Top);
    else if (canvasRect.bottom - cardRect.bottom >= 260) setPlacement(Position.Bottom);
    else setPlacement(Position.Top);
  }, [cardRef, viewport.x, viewport.y, viewport.zoom]);

  return (
    <NodeToolbar className="cs-toolbar" position={placement} offset={12}>
      {children}
    </NodeToolbar>
  );
}

export function StudioNode({ id, selected }: NodeProps) {
  const t = useTranslate();
  const { byok, providerStatus, openByok } = useShell();
  const studio = useStudio();

  const cardRef = useRef<HTMLDivElement | null>(null);

  const node = findCanvasNode(studio.doc, id);
  if (node === null) return null;

  const labels: Record<CanvasNodeType, string> = {
    text: t('canvas.node.text'),
    image: t('common.kind.image'),
    video: t('common.kind.video'),
    audio: t('common.kind.audio'),
  };

  const draft = node.data.draft;
  const preview = latestCanvasOutput(node);
  const latest = latestCanvasBatch(node);
  const active = node.data.batches.find(
    (batch) => (batch.status === 'queued' || batch.status === 'running') && batch.taskId !== undefined,
  );
  const live = active?.taskId === undefined ? undefined : studio.live[active.taskId];
  const submitting = studio.submitting.has(id);

  const context = {
    providerStatus,
    hasCloudKey: resolveProviderKey(byok) !== undefined,
  };
  const provider = canvasDefaultProvider(node, context);
  const issue = canvasSubmitIssue(node, provider, context);
  const estimate = estimateCanvasNodeCost(node, provider, byok.model);

  const priceText =
    node.type === 'text'
      ? null
      : provider === 'cloud-volcano-seedance'
        ? estimate === null
          ? t('canvas.studio.pricePending')
          : t('common.cost.estimated', { amount: formatYuan(estimate.yuan) })
        : t('canvas.studio.priceLocal');

  const engines =
    node.type === 'image'
      ? comfyUiEngineOptions(providerStatus).map((option) => ({ id: option.id, label: option.label }))
      : [
          { id: 'cloud-volcano-seedance', label: t('common.engine.cloud') },
          ...comfyUiEngineOptions(providerStatus).map((option) => ({ id: option.id, label: option.label })),
        ];

  const mediaUrl = preview === null ? null : resolveMediaUrl(preview.output.url);
  const previewKind = preview?.output.kind ?? null;

  return (
    <div ref={cardRef} className={`cs-card cs-card--${node.type}${selected ? ' is-selected' : ''}`}>
      <header className="cs-card-head">
        <span className="cs-card-type">{labels[node.type]}</span>
        <span className="cs-card-title" title={node.data.title}>
          {node.data.title ?? ''}
        </span>
        {latest === null ? null : (
          <span className="cs-card-status" data-state={latest.status}>
            {statusText(latest, live, t)}
          </span>
        )}
      </header>

      <div className="cs-card-body">
        {mediaUrl !== null && previewKind === 'image' ? (
          <img className="cs-card-media" src={mediaUrl} alt={node.data.title ?? ''} draggable={false} />
        ) : null}
        {mediaUrl !== null && previewKind === 'video' ? (
          <video className="cs-card-media nodrag" src={mediaUrl} controls preload="metadata" />
        ) : null}
        {mediaUrl !== null && previewKind === 'audio' ? (
          <audio className="cs-card-media nodrag" src={mediaUrl} controls preload="metadata" />
        ) : null}
        {(mediaUrl === null || previewKind === 'text') && node.type === 'text' ? (
          <p className="cs-card-text">{draft.prompt || t('canvas.studio.textPlaceholder')}</p>
        ) : null}
        {(mediaUrl === null || previewKind === 'text') && node.type !== 'text' ? (
          <p className="cs-card-empty">{t('canvas.studio.noOutput')}</p>
        ) : null}
      </div>

      <footer className="cs-card-foot">
        <span>{t('canvas.studio.batches', { count: node.data.batches.length })}</span>
        {latest?.status === 'failed' && latest.failure !== undefined ? (
          <span className="cs-card-error" title={latest.failure.message}>
            {latest.failure.code}
          </span>
        ) : null}
      </footer>

      {selected ? (
        <StudioToolbar cardRef={cardRef}>
          <div className="cs-toolbar-inner nodrag nowheel" onPointerDown={(event) => event.stopPropagation()}>
          <div className="cs-toolbar-head">
            <span className="cs-toolbar-title">{node.data.title ?? labels[node.type]}</span>
            <span className="cs-toolbar-count">
              {t('canvas.studio.batches', { count: node.data.batches.length })}
            </span>
          </div>

          <textarea
            className="cs-toolbar-input"
            rows={3}
            value={draft.prompt}
            placeholder={
              node.type === 'text'
                ? t('canvas.studio.textPlaceholder')
                : t('canvas.studio.promptPlaceholder')
            }
            onChange={(event) => studio.onDraftChange(id, { prompt: event.target.value })}
          />

          {node.type === 'text' ? (
            <p className="cs-toolbar-issue">{t('canvas.studio.textNodeHint')}</p>
          ) : (
            <>
              <div className="cs-toolbar-row">
                <label className="cs-toolbar-field">
                  <span>{t('create.more.aspect')}</span>
                  <select
                    className="cs-toolbar-select"
                    value={canvasAspectRatio(node)}
                    onChange={(event) => {
                      const next = event.target.value;
                      const tier = canvasResolutionTier(node);
                      studio.onDraftChange(id, {
                        settings: {
                          aspectRatio: next as '16:9' | '9:16' | '1:1',
                          resolution: resolveTargetSize(next as '16:9' | '9:16' | '1:1', tier),
                        },
                      });
                    }}
                  >
                    {(['16:9', '9:16', '1:1'] as const).map((ratio) => (
                      <option key={ratio} value={ratio}>
                        {ratio}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="cs-toolbar-field">
                  <span>{t('create.more.resolution')}</span>
                  <select
                    className="cs-toolbar-select"
                    value={canvasResolutionTier(node)}
                    onChange={(event) =>
                      studio.onDraftChange(id, {
                        settings: {
                          resolution: resolveTargetSize(
                            canvasAspectRatio(node),
                            event.target.value as ResolutionTier,
                          ),
                        },
                      })
                    }
                  >
                    {RESOLUTION_TIERS.map((tier) => (
                      <option key={tier} value={tier}>
                        {tier}
                      </option>
                    ))}
                  </select>
                </label>

                {node.type === 'video' ? (
                  <label className="cs-toolbar-field">
                    <span>{t('create.more.duration')}</span>
                    <select
                      className="cs-toolbar-select"
                      value={canvasDurationSec(node)}
                      onChange={(event) =>
                        studio.onDraftChange(id, {
                          settings: { durationSec: Number(event.target.value) },
                        })
                      }
                    >
                      {DURATION_OPTIONS.map((value) => (
                        <option key={value} value={value}>
                          {value}s
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                <label className="cs-toolbar-field">
                  <span>{t('canvas.studio.engine')}</span>
                  <select
                    className="cs-toolbar-select"
                    value={provider}
                    onChange={(event) =>
                      studio.onDraftChange(id, { settings: { provider: event.target.value } })
                    }
                  >
                    {engines.map((engine) => (
                      <option key={engine.id} value={engine.id}>
                        {engine.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="cs-toolbar-foot">
                <span className="cs-toolbar-price">{priceText}</span>
                <button
                  type="button"
                  className="wb-btn wb-btn-primary"
                  disabled={issue !== null || submitting}
                  onClick={() => studio.onSubmit(id)}
                >
                  {submitting ? t('common.submit.pending') : t('canvas.studio.generate')}
                </button>
              </div>

              {issue === null ? null : (
                <p className="cs-toolbar-issue">
                  {canvasSubmitIssueText(issue)}
                  {issue === 'cloud-key-missing' ? (
                    <button type="button" className="cs-toolbar-link" onClick={openByok}>
                      {t('canvas.studio.openByok')}
                    </button>
                  ) : null}
                </p>
              )}

              {latest?.failure === undefined ? null : (
                <p className="cs-toolbar-error" title={latest.failure.message}>
                  {latest.failure.code} · {latest.failure.message}
                </p>
              )}
            </>
          )}
          </div>
        </StudioToolbar>
      ) : null}
    </div>
  );
}
