import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import type { AspectRatio } from '@astrmira/shared';
import type { AssetState } from '../lib/assets';
import { formatBytes, resolveTargetSize, toCssAspectRatio } from '../lib/format';

/**
 * 参考资产上传槽（PLAN §4 Step 3：拖拽槽 + **32 倍数裁切预览**）。
 *
 * 预览的语义要说清：容器比例 = **目标画幅**、图片 `object-fit: cover`，
 * 因此看到的就是"服务端即将裁出来的那一块"，用户不必自己算 832×480 会不会切掉脸。
 * 真正的像素级裁切在服务端（`pipeline/smartCrop.ts`），前端不重复实现。
 *
 * V8.3 批次 3 起本组件**变成通用槽**（一个组件渲染三种角色）：
 * - `kind='image'`：首帧 / 尾帧（`accept` 图片，走裁切预览）；
 * - `kind='video'`：参考视频（`accept` 视频，预览用 `<video>` 而不是 `<img>`）。
 *
 * 为什么按 `kind` 而不是"三份复制粘贴的槽"：三者的上传 / 清空 / 错误 / 复用
 * 处理完全同构，复制三份必然出现"改了首帧忘了尾帧"这类漂移。
 * 差异只有两处（accept 与预览元素），因此收在一个 `kind` 分支里。
 */
export type AssetSlotKind = 'image' | 'video';

export interface AssetDropZoneProps {
  /** 槽位标题，如「参考首帧」「参考尾帧」「参考视频」 */
  label: string;
  /** 该槽在本模式下的角色说明（可选） */
  hint?: string;
  kind: AssetSlotKind;
  aspectRatio: AspectRatio;
  asset: AssetState | null;
  uploading: boolean;
  disabled?: boolean;
  error: string | null;
  onSelect: (file: File) => void;
  onClear: () => void;
}

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/heic';
const VIDEO_ACCEPT = 'video/mp4,video/quicktime';

export function AssetDropZone({
  label,
  hint,
  kind,
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
  const isVideo = kind === 'video';

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
        <span className="wb-label">{label}</span>
        {asset === null ? null : (
          <button type="button" className="wb-btn" onClick={onClear} disabled={disabled}>
            移除
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={isVideo ? VIDEO_ACCEPT : IMAGE_ACCEPT}
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
            {isVideo ? (
              // 视频槽不做裁切预览：它不参与 32 倍数裁切（参考视频原样透传给上游）
              <video src={asset.previewUrl} muted playsInline preload="metadata" />
            ) : (
              <img
                src={asset.previewUrl}
                alt={`${label}裁切预览`}
                onLoad={(event) => {
                  const image = event.currentTarget;
                  setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
                }}
              />
            )}
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
            {isVideo ? (
              <span className="wb-note">
                参考视频原样上传，不做裁切与转码；是否被上游接受取决于引擎
                （云端 `reference_image` 字段对视频的支持度属【待验证】，见 PLAN §5 批次 3-⑤）。
              </span>
            ) : (
              <>
                <span>
                  裁切为{' '}
                  <code>
                    {target.width}×{target.height}
                  </code>{' '}
                  （32 的倍数）
                </span>
                <span className="wb-note">预览即服务端即将裁出的区域（居中裁切）</span>
              </>
            )}
            {asset.meta === null ? null : (
              <span>
                {asset.meta.kind === 'video' ? '视频' : '图片'} · {asset.meta.mime} ·{' '}
                {formatBytes(asset.meta.size)}
              </span>
            )}
          </div>
        </div>
      ) : asset !== null ? (
        <div className="wb-preview">
          <div className="wb-preview-meta">
            <span>
              已复用参考资产 <code>{asset.assetId.slice(0, 8)}</code>
            </span>
            <span className="wb-note">
              参数复用只带回资产编号，本地没有这份素材 —— 预览不可用，直接提交仍会使用该资产。
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
          <span className="wb-dropzone-icon">{isVideo ? '🎬' : '🖼'}</span>
          <span className="wb-note">
            {uploading
              ? '上传中…'
              : isVideo
                ? '点击选择或拖拽视频到这里（mp4 / mov，≤100MB）'
                : '点击选择或拖拽图片到这里（≤100MB）'}
          </span>
          <span className="wb-note">服务端按魔数嗅探真实类型，不信任文件名与 Content-Type</span>
        </div>
      )}

      {hint === undefined ? null : <span className="wb-note">{hint}</span>}
      {error === null ? null : <span className="wb-warn">{error}</span>}
    </div>
  );
}
