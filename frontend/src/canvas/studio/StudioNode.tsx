import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '../../lib/dialogFocus';
import { Handle, NodeToolbar, Position, useViewport, type NodeProps } from '@xyflow/react';
import {
  formatYuan,
  type CanvasNodeBatch,
  type CanvasNodeType,
  type CanvasReference,
  type CanvasReferenceRole,
  type TaskProgress,
} from '@astrmira/shared';

import { resolveMediaUrl } from '../../lib/api';
import { resolveProviderKey } from '../../lib/byok';
import {
  canvasNodeVisibleOutput,
  findCanvasNode,
  latestCanvasBatch,
} from '../../lib/canvasDocOps';
import {
  canvasAspectRatio,
  canvasDefaultProvider,
  canvasDurationSec,
  canvasResolution,
  canvasResolutionTier,
  canvasSubmitIssue,
  canvasSubmitIssueText,
  estimateCanvasNodeCost,
  swapFirstLastReferences,
} from '../../lib/canvasNodeSubmit';
import { comfyUiEngineOptions, httpServiceEngineOptions } from '../../lib/engineOptions';
import { modesAllowReferences } from '../../lib/referenceSources';
import {
  DURATION_OPTIONS,
  RESOLUTION_TIERS,
  resolveImageSize,
  resolveTargetSize,
  type ResolutionTier,
} from '../../lib/format';
import { useTranslate, type MessageKey, type Translate } from '../../lib/i18n';
import {
  StructuredPromptInput,
  type InlinePromptToken,
} from '../../components/StructuredPromptInput';
import { useShell } from '../../lib/shell';
import { useStudio, type ReferencePreview } from './StudioContext';

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

const REFERENCE_LABEL_KEYS: Record<CanvasReferenceRole, MessageKey> = {
  'first-frame': 'create.chip.firstFrame',
  'last-frame': 'create.chip.lastFrame',
  'reference-image': 'create.chip.referenceImage',
  'reference-video': 'create.chip.referenceVideo',
  'reference-audio': 'create.chip.referenceAudio',
};

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
  title,
  closeLabel,
  onClose,
  children,
}: {
  cardRef: RefObject<HTMLDivElement | null>;
  title: string;
  closeLabel: string;
  onClose(): void;
  children: ReactNode;
}) {
  const [placement, setPlacement] = useState<Position>(Position.Right);
  const [align, setAlign] = useState<'start' | 'center' | 'end'>('center');
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches,
  );
  const viewport = useViewport();

  // S5-B4f：窄屏把锚定面板改成底部抽屉；用 dialogFocus 统一 Esc/回焦/背景快捷键隔离
  const sheetRef = useDialogFocus<HTMLDivElement>(narrow, onClose);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 768px)');
    const onChange = (): void => setNarrow(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useLayoutEffect(() => {
    const card = cardRef.current;
    const canvas = card?.closest('.react-flow');
    if (card === null || !(canvas instanceof HTMLElement)) return;

    const update = (): void => {
      const canvasRect = canvas.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const needed = 316; // 创作框 300 + 间距 16
      const topSpace = cardRect.top - canvasRect.top;
      const bottomSpace = canvasRect.bottom - cardRect.bottom;
      // S5-B2b：左右放置时按节点在画布中的上下位置对齐（start/center/end），
      // 让长面板贴顶/贴底而不是以节点为中心向上/向下溢出。
      const verticalAlign = topSpace < 220 ? 'start' : bottomSpace < 220 ? 'end' : 'center';
      if (canvasRect.right - cardRect.right >= needed) {
        setPlacement(Position.Right);
        setAlign(verticalAlign);
        setMaxHeight(undefined);
      } else if (cardRect.left - canvasRect.left >= needed) {
        setPlacement(Position.Left);
        setAlign(verticalAlign);
        setMaxHeight(undefined);
      } else if (bottomSpace >= 260) {
        setPlacement(Position.Bottom);
        setAlign('center');
        setMaxHeight(bottomSpace - 12 < 300 ? Math.max(100, bottomSpace - 12) : undefined);
      } else {
        setPlacement(Position.Top);
        setAlign('center');
        // 上下都不够 312px 时（窄画布 + 节点居中），面板改为可滚动而不是被视口裁掉。
        setMaxHeight(topSpace - 12 < 300 ? Math.max(100, topSpace - 12) : undefined);
      }
    };

    // 首帧 effect 跑时节点可能还没完成布局；ResizeObserver 让“节点移动/缩放/侧栏变化”
    // 都重新算一次，避免把 312px 的面板放到视口上方（Playwright 的 outside viewport 就是这么撞到的）。
    update();
    const raf = requestAnimationFrame(update);
    const late = window.setTimeout(update, 120);
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => update());
    observer?.observe(card);
    observer?.observe(canvas);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(late);
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [cardRef, viewport.x, viewport.y, viewport.zoom]);

  if (narrow) {
    return createPortal(
      <div
        ref={sheetRef}
        className="cs-toolbar-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <button
          type="button"
          className="cs-sheet-close"
          aria-label={closeLabel}
          onClick={onClose}
        >
          ×
        </button>
        {children}
      </div>,
      document.body,
    );
  }

  return (
    <NodeToolbar
      className="cs-toolbar"
      position={placement}
      align={align}
      offset={12}
      style={maxHeight === undefined ? undefined : { maxHeight, overflowY: 'auto' }}
    >
      {children}
    </NodeToolbar>
  );
}

export function StudioNode({ id, selected }: NodeProps) {
  const t = useTranslate();
  const { byok, providerStatus, openByok } = useShell();
  const studio = useStudio();

  const cardRef = useRef<HTMLDivElement | null>(null);

  /** 引用目录：删除行内 token 后原生撤销时找回 reference（只增不删） */
  const referenceCatalog = useRef<Map<string, CanvasReference>>(new Map());
  const [versionsOpen, setVersionsOpen] = useState(false);
  const versionToggleRef = useRef<HTMLButtonElement | null>(null);
  const versionListRef = useRef<HTMLDivElement | null>(null);
  const node = findCanvasNode(studio.doc, id);

  /** 关闭版本列表并把焦点还给「N 轮」按钮（选中/ Esc 共用） */
  const closeVersions = (): void => {
    setVersionsOpen(false);
    requestAnimationFrame(() => versionToggleRef.current?.focus());
  };

  // S5-B4d：版本列表是 listbox，方向键/Home/End/Esc 必须可用
  useEffect(() => {
    if (!versionsOpen) return;
    const list = versionListRef.current;
    if (list === null) return;
    const items = (): HTMLButtonElement[] => [
      ...list.querySelectorAll<HTMLButtonElement>('button[role="option"]:not([disabled])'),
    ];
    const raf = requestAnimationFrame(() => {
      const active = list.querySelector<HTMLButtonElement>(
        'button[role="option"][aria-selected="true"]:not([disabled])',
      );
      (active ?? items()[0])?.focus();
    });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        closeVersions();
        return;
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const listItems = items();
        (event.key === 'Home' ? listItems[0] : listItems[listItems.length - 1])?.focus();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const listItems = items();
      if (listItems.length === 0) return;
      const current = listItems.indexOf(document.activeElement as HTMLButtonElement);
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next =
        current < 0
          ? delta > 0
            ? 0
            : listItems.length - 1
          : (current + delta + listItems.length) % listItems.length;
      listItems[next]?.focus();
    };
    list.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      list.removeEventListener('keydown', onKey);
    };
  }, [versionsOpen]);
  if (node === null) return null;

  const labels: Record<CanvasNodeType, string> = {
    text: t('canvas.node.text'),
    image: t('common.kind.image'),
    video: t('common.kind.video'),
    audio: t('common.kind.audio'),
  };

  const draft = node.data.draft;
  for (const reference of draft.references) {
    referenceCatalog.current.set(reference.assetId, reference);
  }
  const inlineTokens: InlinePromptToken[] = [...new Set(draft.references.map((item) => item.assetId))]
    .map((assetId) => {
      const reference = draft.references.find((item) => item.assetId === assetId);
      return reference === undefined
        ? null
        : {
            id: assetId,
            label: `${assetId.slice(0, 10)}`,
            kind: reference.role === 'reference-video' ? ('video' as const) : ('image' as const),
          };
    })
    .filter((item): item is InlinePromptToken => item !== null);
  const visible = canvasNodeVisibleOutput(node);
  const preview =
    visible.state === 'selected' || visible.state === 'latest' ? visible : null;
  const latest = latestCanvasBatch(node);
  const latestSucceeded = [...node.data.batches]
    .reverse()
    .find((batch) => batch.status === 'succeeded' && batch.outputs.length > 0);
  const visibleBatchId = node.data.selectedBatchId ?? latestSucceeded?.id;
  const active = node.data.batches.find(
    (batch) => batch.status === 'queued' || batch.status === 'running',
  );
  /** V2.49：queued 但没有 taskId = 提交结果未知；有 request 才能核对 */
  const unknown = node.data.batches.find(
    (batch) => batch.status === 'queued' && batch.taskId === undefined,
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

  const isHttpProvider = provider.startsWith('http-service:');
  const engineModes = isHttpProvider
    ? httpServiceEngineOptions(providerStatus).find((item) => item.id === provider)?.modes
    : provider === 'cloud-volcano-seedance'
      ? undefined
      : comfyUiEngineOptions(providerStatus).find((item) => item.id === provider)?.modes;
  /**
   * B 路线（V2.76）：图片节点声明「全能参考」后也能加参考图。
   *
   * 这里不看 `modesAllowReferences`：那个函数判的是"视频轨能不能吃参考"，
   * t2i 的参考能力由模板声明（`referenceImage`）决定，模板缺失时 B93 会在提交前明确拒绝。
   */
  const omniReferences =
    node.type === 'image' && draft.settings.referenceMode === 'omni-reference';
  /** S5-Ac：未自检 = 未知，不据此藏入口；明确只支持 t2v/t2i 时不显示参考入口 */
  const canAddReference =
    (node.type === 'video' && modesAllowReferences(engineModes)) || omniReferences;
  const priceText =
    node.type === 'text'
      ? null
      : isHttpProvider
        ? t('canvas.studio.pricePending')
        : provider === 'cloud-volcano-seedance'
          ? estimate === null
            ? t('canvas.studio.pricePending')
            : t('common.cost.estimated', { amount: formatYuan(estimate.yuan) })
          : t('canvas.studio.priceLocal');

  // V2.51：ComfyUI 与 HTTP 用同一份 modes 判定；缺省 = 未自检，不据此过滤
  const comfyEngines = comfyUiEngineOptions(providerStatus)
    .filter((option) =>
      option.modes === undefined
        ? true
        : node.type === 'image'
          ? option.modes.includes('t2i')
          : option.modes.some((mode) => mode !== 't2i'),
    )
    .map((option) => ({ id: option.id, label: option.label }));
  const httpEngines = httpServiceEngineOptions(providerStatus)
    .filter((option) =>
      node.type === 'image'
        ? option.modes?.includes('t2i') === true
        : option.modes?.some((mode) => mode !== 't2i') === true,
    )
    .map((option) => ({ id: option.id, label: option.label }));
  const engines =
    node.type === 'image'
      ? [...comfyEngines, ...httpEngines]
      : [
          { id: 'cloud-volcano-seedance', label: t('common.engine.cloud') },
          ...comfyEngines,
          ...httpEngines,
        ];

  const mediaUrl = preview === null ? null : resolveMediaUrl(preview.output.url);
  const previewKind = preview?.output.kind ?? null;
  const posterKey =
    preview?.output.assetId.startsWith('task:') === true
      ? preview.output.assetId.slice('task:'.length)
      : preview?.output.assetId;
  const posterUrl = previewKind === 'video' ? `/media/thumbs/${posterKey}.jpg` : null;
  const downloadExt =
    previewKind === 'image' ? 'png' : previewKind === 'audio' ? 'mp3' : 'mp4';
  // 默认标题就是「视频 1 / 图片 1」：再在前面加一个类型标签会显示成「视频 视频 1」
  const title = node.data.title;
  const showType = title === undefined || !title.startsWith(labels[node.type]);

  return (
    <div ref={cardRef} className="cs-node-shell">
      <div className={`cs-card cs-card--${node.type}${selected ? ' is-selected' : ''}`}>
        <header className="cs-card-head">
        {showType ? <span className="cs-card-type">{labels[node.type]}</span> : null}
        <span className="cs-card-title" title={node.data.title}>
          {title ?? ''}
        </span>
        {latest === null ? null : (
          <span className="cs-card-status" data-state={latest.status}>
            {statusText(latest, live, t)}
          </span>
        )}
      </header>

      <div className="cs-card-body">
        {mediaUrl !== null && previewKind === 'image' ? (
          <img
            className="cs-card-media"
            src={mediaUrl}
            alt={node.data.title ?? ''}
            draggable={false}
            loading="lazy"
            decoding="async"
          />
        ) : null}
        {/* S7-D6：没有 task 缩略图的上传/导入视频也要有首帧。
            metadata 只拉头部，不会像 auto 一样整段预载。 */}
        {mediaUrl !== null && previewKind === 'video' ? (
          <video
            className="cs-card-media nodrag"
            src={mediaUrl}
            poster={posterUrl ?? undefined}
            controls
            playsInline
            preload="metadata"
          />
        ) : null}
        {mediaUrl !== null && previewKind === 'audio' ? (
          <audio className="cs-card-media nodrag" src={mediaUrl} controls preload="none" />
        ) : null}
        {(mediaUrl === null || previewKind === 'text') && node.type === 'text' ? (
          <p className="cs-card-text">{draft.prompt || t('canvas.studio.textPlaceholder')}</p>
        ) : null}
        {visible.state === 'invalid' ? (
          <p className="cs-card-empty cs-card-error">{t('canvas.studio.versionInvalid')}</p>
        ) : null}
        {(mediaUrl === null || previewKind === 'text') &&
        node.type !== 'text' &&
        visible.state !== 'invalid' ? (
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
        {unknown !== undefined && unknown.request !== undefined ? (
          <button
            type="button"
            className="cs-card-recover nodrag"
            onClick={() => studio.onRecover(id, unknown.id)}
          >
            {t('canvas.studio.recoverSubmit')}
          </button>
        ) : null}
      </footer>

      {selected ? (
        <StudioToolbar
          cardRef={cardRef}
          title={node.data.title ?? labels[node.type]}
          closeLabel={t('canvas.studio.close')}
          onClose={() => studio.onDeselect(id)}
        >
          <div className="cs-toolbar-inner nodrag nowheel" onPointerDown={(event) => event.stopPropagation()}>
          <div className="cs-toolbar-head">
            <span className="cs-toolbar-title">{node.data.title ?? labels[node.type]}</span>
            <button
              ref={versionToggleRef}
              type="button"
              className="cs-toolbar-count cs-version-toggle"
              aria-expanded={versionsOpen}
              disabled={node.data.batches.length === 0}
              onClick={() => setVersionsOpen((open) => !open)}
            >
              {t('canvas.studio.batches', { count: node.data.batches.length })}
            </button>
          </div>

          {versionsOpen ? (
            <div
              ref={versionListRef}
              className="cs-version-list"
              role="listbox"
              aria-label={t('canvas.studio.versions')}
            >
              {[...node.data.batches].reverse().map((batch, index) => {
                const selectable = batch.status === 'succeeded' && batch.outputs.length > 0;
                const active = batch.id === visibleBatchId;
                const output = batch.outputs[batch.outputs.length - 1];
                return (
                  <button
                    key={batch.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={
                      active ? 'cs-version-item is-active' : 'cs-version-item'
                    }
                    disabled={!selectable}
                    onClick={() => {
                      studio.onSelectBatch(id, batch.id);
                      closeVersions();
                    }}
                  >
                    <span>v{node.data.batches.length - index}</span>
                    <span>{statusText(batch, live, t)}</span>
                    <span className="cs-version-tail">
                      {active ? (
                        <span className="cs-version-current">
                          {t('canvas.studio.currentVersion')}
                        </span>
                      ) : null}
                      <span className="wb-note">{output?.kind ?? '—'}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {visible.state === 'invalid' ? (
            <p className="cs-toolbar-issue">{t('canvas.studio.versionInvalid')}</p>
          ) : null}

          {node.type === 'text' ? (
            <textarea
              className="cs-toolbar-input"
              rows={3}
              value={draft.prompt}
              placeholder={t('canvas.studio.textPlaceholder')}
              onChange={(event) => studio.onDraftChange(id, { prompt: event.target.value })}
            />
          ) : (
            <StructuredPromptInput
              initialText={draft.prompt}
              text={draft.prompt}
              initialTokens={inlineTokens}
              className="cs-toolbar-input cs-toolbar-input-rich"
              placeholder={t('canvas.studio.promptPlaceholder')}
              ariaLabel={t('canvas.studio.promptPlaceholder')}
              enableMentions={false}
              onChange={(prompt) => studio.onDraftChange(id, { prompt })}
              onRemoveToken={(assetId) =>
                studio.onDraftChange(id, {
                  references: draft.references.filter((item) => item.assetId !== assetId),
                })
              }
              onRestoreToken={(assetId) => {
                const restored = referenceCatalog.current.get(assetId);
                if (restored === undefined) return;
                if (draft.references.some((item) => item.assetId === assetId)) return;
                studio.onDraftChange(id, { references: [...draft.references, restored] });
              }}
              onPasteFiles={() => undefined}
              onSubmit={() => studio.onSubmit(id)}
            />
          )}
          {node.type === 'text' ? null : (
            <p className="cs-toolbar-hint">{t('create.hint.submit')}</p>
          )}

          {node.type !== 'text' && draft.references.length > 0 ? (
            <div className="cs-toolbar-refs">
              {[...draft.references]
                .sort((a, b) => a.order - b.order)
                .map((item, index) => (
                  <ReferenceChip
                    key={`${item.role}-${item.assetId}-${index}`}
                    // 全能参考下槽位号就是提示词里 {{image:N}} 的 N，必须露出来
                    label={
                      omniReferences
                        ? `#${index} ${t(REFERENCE_LABEL_KEYS[item.role])}`
                        : t(REFERENCE_LABEL_KEYS[item.role])
                    }
                    preview={studio.referencePreview(item.assetId)}
                  />
                ))}
              {draft.references.some((item) => item.role === 'first-frame') &&
              draft.references.some((item) => item.role === 'last-frame') ? (
                <button
                  type="button"
                  className="cs-toolbar-link"
                  onClick={() =>
                    studio.onDraftChange(id, {
                      references: swapFirstLastReferences(draft.references),
                    })
                  }
                >
                  {t('create.chip.swap')}
                </button>
              ) : null}
            </div>
          ) : null}

          {canAddReference ? (
            <button
              type="button"
              className="cs-toolbar-link cs-toolbar-add-ref"
              onClick={() => studio.onAddReference(id)}
            >
              {t('canvas.studio.addReference')}
            </button>
          ) : null}

          {node.type === 'text' ? (
            <p className="cs-toolbar-issue">{t('canvas.studio.textNodeHint')}</p>
          ) : (
            <>
              {node.type === 'image' ? (
                <div className="cs-toolbar-row">
                  <label className="cs-toolbar-field">
                    <span>{t('canvas.studio.referenceMode')}</span>
                    <select
                      className="cs-toolbar-select"
                      value={omniReferences ? 'omni-reference' : 'none'}
                      onChange={(event) => {
                        // 不清空已连的参考图：改主意时不该丢素材；多张而没开模式时提交会被明确挡住
                        const referenceMode =
                          event.target.value === 'omni-reference'
                            ? ('omni-reference' as const)
                            : undefined;
                        studio.onDraftChange(id, { settings: { referenceMode } });
                      }}
                    >
                      <option value="none">{t('canvas.studio.referenceMode.none')}</option>
                      <option value="omni-reference">{t('canvas.studio.referenceMode.omni')}</option>
                    </select>
                  </label>
                  {omniReferences ? (
                    <span className="cs-toolbar-static">
                      {draft.references.length === 0
                        ? t('canvas.studio.referenceMode.omniEmpty')
                        : t('canvas.studio.referenceMode.mentionHint', {
                            count: draft.references.length - 1,
                          })}
                    </span>
                  ) : null}
                </div>
              ) : null}
              <div className="cs-toolbar-row">
                <label className="cs-toolbar-field">
                  <span>{t('create.more.aspect')}</span>
                  <select
                    className="cs-toolbar-select"
                    value={canvasAspectRatio(node)}
                    onChange={(event) => {
                      const next = event.target.value as '16:9' | '9:16' | '1:1';
                      const tier = canvasResolutionTier(node);
                      studio.onDraftChange(id, {
                        settings: {
                          aspectRatio: next,
                          resolution:
                            node.type === 'image'
                              ? resolveImageSize(next)
                              : resolveTargetSize(next, tier),
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
                  {node.type === 'image' ? (
                    <span className="cs-toolbar-static">
                      {canvasResolution(node).width}×{canvasResolution(node).height}
                    </span>
                  ) : (
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
                  )}
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

              <div className="cs-toolbar-actions">
                {mediaUrl === null ? null : (
                  <a
                    className="cs-toolbar-link"
                    href={mediaUrl}
                    download={`${preview?.output.assetId ?? 'canvas-output'}.${downloadExt}`}
                  >
                    {t('common.download')}
                  </a>
                )}
                {preview === null ||
                (preview.output.kind !== 'image' && preview.output.kind !== 'video') ? null : (
                  <button
                    type="button"
                    className="cs-toolbar-link"
                    onClick={() => studio.onContinueFromVersion(id)}
                  >
                    {t('canvas.studio.continueAsReference')}
                  </button>
                )}
                {preview === null ? null : (
                  <button
                    type="button"
                    className="cs-toolbar-link"
                    onClick={() => studio.onReuseBatch(id, preview.batch.id)}
                  >
                    {t('canvas.studio.reuseBatchParams')}
                  </button>
                )}
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

              {issue === 'active-task' && unknown !== undefined ? (
                unknown.request === undefined ? (
                  <p className="cs-toolbar-issue">{t('canvas.studio.recoverNoRequest')}</p>
                ) : (
                  <button
                    type="button"
                    className="cs-toolbar-link"
                    onClick={() => studio.onRecover(id, unknown.id)}
                  >
                    {t('canvas.studio.recoverSubmit')}
                  </button>
                )
              ) : null}

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

      {/* 连接柄：只有能当上游（图片/视频）的节点有右侧出口；只有视频节点能接收参考（左侧入口） */}
      {node.type === 'image' || node.type === 'video' ? (
        <Handle type="source" position={Position.Right} className="cs-handle" />
      ) : null}
      {node.type === 'video' ? (
        <Handle type="target" position={Position.Left} className="cs-handle" />
      ) : null}
    </div>
  );
}

/**
 * 参考 chip（2026-10-24「引用缩略图」）。
 *
 * 有封面就显示封面（与即梦一致：参考是"看得见的那张图"），没有就退回纯文字标签。
 * 两种情况都必须能点/能读 —— **不得**因为取不到封面就隐藏这条参考，
 * 也不得显示破图占位（`onError` 只退化这一次，不重试）。
 */
function ReferenceChip({
  label,
  preview,
}: {
  label: string;
  preview: ReferencePreview | null;
}): ReactNode {
  const [broken, setBroken] = useState(false);
  const src = preview === null ? null : resolveMediaUrl(preview.url);
  const showThumb = src !== null && !broken;

  return (
    <span className={`cs-ref${showThumb ? ' cs-ref--media' : ''}`} title={label}>
      {showThumb ? (
        <img
          className="cs-ref-thumb"
          src={src}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : null}
      <span className="cs-ref-label">{label}</span>
    </span>
  );
}
