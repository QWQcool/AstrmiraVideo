import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslate } from '../../lib/i18n';
import { resolveMediaUrl } from '../../lib/api';

/**
 * V2.78：局部重绘的蒙版画笔（画在节点当前产物上）。
 *
 * 三条实现取向：
 * 1. **蒙版画布 = 原图尺寸**（不是显示尺寸）：上传给服务端的 PNG 与底图逐像素对齐，
 *    所以不用再做缩放换算 —— 这类"差一个像素就糊一片"的地方不引入插值；
 * 2. **黑底白笔**：白=重画、黑=保留（与 CONTRACT §1 `assets.maskImage` 口径一致）；
 * 3. 只做必要的手感：笔刷大小、清除、提交前提示"空白蒙版不会重画任何东西"。
 */
export interface MaskEditorProps {
  imageUrl: string;
  /** 提交按钮是否可用（提示词为空时置灰：inpaint 需要描述"要画成什么"） */
  canSubmit: boolean;
  promptHint?: string;
  onCancel(): void;
  onConfirm(mask: Blob, size: { width: number; height: number }): void;
}

export function MaskEditor({
  imageUrl,
  canSubmit,
  promptHint,
  onCancel,
  onConfirm,
}: MaskEditorProps): ReactNode {
  const t = useTranslate();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [brush, setBrush] = useState(48);
  const [dirty, setDirty] = useState(false);
  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  /** 底图加载完就把画布尺寸定成原图尺寸（之后所有坐标都是原图坐标） */
  const setupCanvas = useCallback((element: HTMLImageElement) => {
    const width = element.naturalWidth;
    const height = element.naturalHeight;
    if (width === 0 || height === 0) return;
    const canvas = canvasRef.current;
    if (canvas === null) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (context !== null) {
        context.fillStyle = '#000';
        context.fillRect(0, 0, width, height);
      }
      setDirty(false);
    }
    setSize({ width, height });
  }, []);

  useEffect(() => {
    // 换图时重置画布尺寸（否则会沿用上一张的宽高，蒙版就错位了）
    const canvas = canvasRef.current;
    if (canvas !== null) {
      canvas.width = 0;
      canvas.height = 0;
    }
    setSize(null);
    setDirty(false);
  }, [imageUrl]);

  const toImagePoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    // 显示尺寸 ≠ 画布尺寸：按比例换算回原图坐标
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  };

  const paint = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const context = canvasRef.current?.getContext('2d');
    if (context === null || context === undefined) return;
    context.strokeStyle = '#fff';
    context.fillStyle = '#fff';
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = brush;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    // 单点也要有圆点（只点一下不拖动时 lineTo 画不出东西）
    context.beginPath();
    context.arc(to.x, to.y, brush / 2, 0, Math.PI * 2);
    context.fill();
  };

  return (
    <div className="cs-mask-backdrop" role="dialog" aria-modal="true" aria-label={t('canvas.mask.title')}>
      <div className="cs-mask-panel">
        <header className="cs-mask-head">
          <strong>{t('canvas.mask.title')}</strong>
          <span className="cs-mask-hint">{t('canvas.mask.hint')}</span>
        </header>

        <div className="cs-mask-stage">
          <img
            className="cs-mask-image"
            src={resolveMediaUrl(imageUrl) ?? imageUrl}
            alt=""
            onLoad={(event) => setupCanvas(event.currentTarget)}
          />
          <canvas
            ref={canvasRef}
            className="cs-mask-canvas"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              drawing.current = true;
              const point = toImagePoint(event);
              lastPoint.current = point;
              paint(point, point);
              setDirty(true);
            }}
            onPointerMove={(event) => {
              if (!drawing.current) return;
              const point = toImagePoint(event);
              const from = lastPoint.current ?? point;
              paint(from, point);
              lastPoint.current = point;
            }}
            onPointerUp={(event) => {
              drawing.current = false;
              lastPoint.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerLeave={() => {
              drawing.current = false;
              lastPoint.current = null;
            }}
          />
        </div>

        <div className="cs-mask-controls">
          <label className="cs-toolbar-field">
            <span>{t('canvas.mask.brush')}</span>
            <input
              type="range"
              min={8}
              max={160}
              step={4}
              value={brush}
              onChange={(event) => setBrush(Number(event.target.value))}
            />
          </label>
          <button
            type="button"
            className="cs-toolbar-link"
            onClick={() => {
              const canvas = canvasRef.current;
              const context = canvas?.getContext('2d');
              if (canvas === null || context === null || context === undefined) return;
              context.fillStyle = '#000';
              context.fillRect(0, 0, canvas.width, canvas.height);
              setDirty(false);
            }}
          >
            {t('canvas.mask.clear')}
          </button>
          <span className="cs-mask-size">
            {size === null ? '' : `${size.width}×${size.height}`}
          </span>
        </div>

        {!dirty ? <p className="cs-mask-warn">{t('canvas.mask.empty')}</p> : null}
        {canSubmit ? null : <p className="cs-mask-warn">{promptHint ?? t('canvas.mask.needPrompt')}</p>}

        <footer className="cs-mask-actions">
          <button type="button" className="wb-btn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="wb-btn wb-btn-primary"
            disabled={!dirty || !canSubmit || size === null}
            onClick={() => {
              const canvas = canvasRef.current;
              if (canvas === null || size === null) return;
              canvas.toBlob((blob) => {
                if (blob === null) return;
                onConfirm(blob, size);
              }, 'image/png');
            }}
          >
            {t('canvas.mask.confirm')}
          </button>
        </footer>
      </div>
    </div>
  );
}
