import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import type { AspectRatio } from '@astrmira/shared';
import type { AssetState } from '../lib/assets';
import { formatBytes, resolveTargetSize, toCssAspectRatio } from '../lib/format';

/**
 * 参考资产上传槽（施工单 §7：拖拽槽 + **32 倍数裁切预览**）。
 *
 * 预览的语义要说清：容器比例 = **目标画幅**、图片 `object-fit: cover`，
 * 因此看到的就是"服务端即将裁出来的那一块"，用户不必自己算 832×480 会不会切掉脸。
 * 真正的像素级裁切在服务端（`pipeline/smartCrop.ts`），前端不重复实现。
 */
export interface AssetDropZoneProps {
  aspectRatio: AspectRatio;
  asset: AssetState | null;
  uploading: boolean;
  disabled?: boolean;
  error: string | null;
  onSelect: (file: File) => void;
  onClear: () => void;
}

export function AssetDropZone({
  aspectRatio,
  asset,
  uploading,
  disabled = false,
  error,
  onSelect,
  onClear,
}: AssetDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);

  const target = resolveTargetSize(aspectRatio);

  function handleFiles(files: FileList | null): void {
    const file = files?.[0];
    if (file === undefined) return;
    setNaturalSize(null);
    onSelect(file);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragActive(false);
    if (disabled) return;
    handleFiles(event.dataTransfer.files);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    handleFiles(event.target.files);
    // 允许重复选择同一文件（否则第二次选同名文件不触发 change）
    event.target.value = '';
  }

  return (
    <div className="wb-field">
      <div className="wb-field-head">
        <span className="wb-label">参考首帧（图生视频）</span>
        {asset === null ? null : (
          <button type="button" className="wb-btn" onClick={onClear} disabled={disabled}>
            移除
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/heic,video/mp4,video/quicktime"
        style={{ display: 'none' }}
        onChange={handleChange}
      />

      {asset !== null && asset.previewUrl !== null ? (
        <div className="wb-preview">
          <div
            className="wb-preview-frame"
            style={{
              width: aspectRatio === '9:16' ? 56 : 104,
              aspectRatio: toCssAspectRatio(aspectRatio),
            }}
          >
            <img
              src={asset.previewUrl}
              alt="首帧裁切预览"
              onLoad={(event) => {
                const image = event.currentTarget;
                setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
              }}
            />
          </div>

          <div className="wb-preview-meta">
            {naturalSize === null ? null : (
              <span>
                原图{' '}
                <code>
                  {naturalSize.width}×{naturalSize.height}
                </code>
              </span>
            )}
            <span>
              裁切为{' '}
              <code>
                {target.width}×{target.height}
              </code>{' '}
              （32 的倍数）
            </span>
            {asset.meta === null ? null : (
              <span>
                {asset.meta.kind === 'video' ? '视频' : '图片'} · {asset.meta.mime} ·{' '}
                {formatBytes(asset.meta.size)}
              </span>
            )}
            <span className="wb-note">预览即服务端即将裁出的区域（居中裁切）</span>
          </div>
        </div>
      ) : asset !== null ? (
        <div className="wb-preview">
          <div className="wb-preview-meta">
            <span>
              已复用参考资产 <code>{asset.assetId.slice(0, 8)}</code>
            </span>
            <span className="wb-note">
              参数复用只带回资产编号，本地没有这张图 —— 预览不可用，直接提交仍会使用该资产。
            </span>
            <button type="button" className="wb-btn" onClick={onClear} disabled={disabled}>
              改为重新上传
            </button>
          </div>
        </div>
      ) : (
        <div
          className={dragActive ? 'wb-dropzone wb-dropzone-active' : 'wb-dropzone'}
          role="button"
          tabIndex={0}
          aria-disabled={disabled}
          onClick={() => {
            if (!disabled) inputRef.current?.click();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !disabled) inputRef.current?.click();
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
        >
          <span className="wb-dropzone-icon">🖼</span>
          <span className="wb-note">
            {uploading ? '上传中…' : '点击选择或拖拽图片到这里（≤20MB，最多 4 个）'}
          </span>
          <span className="wb-note">服务端按魔数嗅探真实类型，不信任文件名与 Content-Type</span>
        </div>
      )}

      {error === null ? null : <span className="wb-warn">{error}</span>}
    </div>
  );
}
