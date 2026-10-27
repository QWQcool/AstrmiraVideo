import { useState, type ReactNode } from 'react';
import { resolveMediaUrl } from '../../lib/api';
import { useTranslate } from '../../lib/i18n';

/**
 * V2.79：扩图的外扩设置（选四边各扩多少像素）。
 *
 * 三条约束来自服务端（`readOutpaintPad`），这里提前表达出来而不是等提交失败：
 * 1. 每边都是 **8 的整数倍**（VAE 潜空间步长），输入框直接按 8 步进；
 * 2. 至少一边 > 0；
 * 3. 外扩后的画布不超过 4096（10GB 卡的实际能力）—— 超了就不让点提交。
 */
export interface OutpaintDialogProps {
  imageUrl: string;
  canSubmit: boolean;
  promptHint?: string;
  onCancel(): void;
  onConfirm(
    expand: { left: number; top: number; right: number; bottom: number },
    size: { width: number; height: number },
  ): void;
}

const MAX_PAD = 2048;
const MAX_DIMENSION = 4096;
const STEP = 8;

/** 取 8 的整数倍（向下取整：宁可少扩，也不让用户填的 100 变成 104） */
const align8 = (value: number): number => Math.max(0, Math.floor(value / STEP) * STEP);

export function OutpaintDialog({
  imageUrl,
  canSubmit,
  promptHint,
  onCancel,
  onConfirm,
}: OutpaintDialogProps): ReactNode {
  const t = useTranslate();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [expand, setExpand] = useState({ left: 0, top: 0, right: 0, bottom: 0 });

  const setSide = (side: keyof typeof expand, raw: string) => {
    const value = Number.parseInt(raw, 10);
    setExpand((current) => ({
      ...current,
      [side]: Number.isFinite(value) ? Math.min(MAX_PAD, align8(value)) : 0,
    }));
  };

  const preset = (ratio: number, sides: Array<keyof typeof expand>) => {
    if (size === null) return;
    setExpand((current) => {
      const next = { ...current };
      for (const side of sides) {
        const base = side === 'left' || side === 'right' ? size.width : size.height;
        next[side] = align8(base * ratio);
      }
      return next;
    });
  };

  const anyPad = expand.left + expand.top + expand.right + expand.bottom > 0;
  const output =
    size === null
      ? null
      : {
          width: size.width + expand.left + expand.right,
          height: size.height + expand.top + expand.bottom,
        };
  const tooLarge = output !== null && (output.width > MAX_DIMENSION || output.height > MAX_DIMENSION);

  return (
    <div className="cs-mask-backdrop" role="dialog" aria-modal="true" aria-label={t('canvas.outpaint.title')}>
      <div className="cs-mask-panel">
        <header className="cs-mask-head">
          <strong>{t('canvas.outpaint.title')}</strong>
          <span className="cs-mask-hint">{t('canvas.outpaint.hint')}</span>
        </header>

        <div className="cs-outpaint-body">
          <img
            className="cs-outpaint-thumb"
            src={resolveMediaUrl(imageUrl) ?? imageUrl}
            alt=""
            onLoad={(event) =>
              setSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
          />
          <div className="cs-outpaint-fields">
            {(
              [
                ['left', t('canvas.outpaint.left')],
                ['top', t('canvas.outpaint.top')],
                ['right', t('canvas.outpaint.right')],
                ['bottom', t('canvas.outpaint.bottom')],
              ] as Array<[keyof typeof expand, string]>
            ).map(([side, label]) => (
              <label key={side} className="cs-toolbar-field">
                <span>{label}</span>
                <input
                  type="number"
                  min={0}
                  max={MAX_PAD}
                  step={STEP}
                  value={expand[side]}
                  onChange={(event) => setSide(side, event.target.value)}
                />
              </label>
            ))}
            <div className="cs-outpaint-presets">
              <button type="button" className="cs-toolbar-link" onClick={() => preset(0.25, ['left', 'right'])}>
                {t('canvas.outpaint.wide')}
              </button>
              <button type="button" className="cs-toolbar-link" onClick={() => preset(0.25, ['top', 'bottom'])}>
                {t('canvas.outpaint.tall')}
              </button>
              <button
                type="button"
                className="cs-toolbar-link"
                onClick={() => preset(0.15, ['left', 'top', 'right', 'bottom'])}
              >
                {t('canvas.outpaint.all')}
              </button>
            </div>
          </div>
        </div>

        <p className="cs-mask-size">
          {size === null || output === null
            ? ''
            : `${size.width}×${size.height} → ${output.width}×${output.height}`}
        </p>
        {tooLarge ? <p className="cs-mask-warn">{t('canvas.outpaint.tooLarge')}</p> : null}
        {anyPad ? null : <p className="cs-mask-warn">{t('canvas.outpaint.empty')}</p>}
        {canSubmit ? null : <p className="cs-mask-warn">{promptHint ?? t('canvas.mask.needPrompt')}</p>}

        <footer className="cs-mask-actions">
          <button type="button" className="wb-btn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="wb-btn wb-btn-primary"
            disabled={!anyPad || tooLarge || !canSubmit || size === null}
            onClick={() => {
              if (size === null) return;
              onConfirm(expand, size);
            }}
          >
            {t('canvas.outpaint.confirm')}
          </button>
        </footer>
      </div>
    </div>
  );
}
