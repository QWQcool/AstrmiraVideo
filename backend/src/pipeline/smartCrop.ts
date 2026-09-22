import type { AspectRatio } from '@astrmira/shared';

/**
 * 尺寸规整与居中裁切（**纯函数**，无 IO）。
 *
 * 两条使用约定（两段共用同一组函数，避免规则分叉）：
 * - **上传阶段**（S6）：只做「清洗 + 下采样 + 规整到 32 倍数（保持原纵横比）」——
 *   上传时**不知道**目标画幅；
 * - **生成阶段**（S1）：按 `aspectRatio` 做居中裁切。
 */

/** DiT 类模型对尺寸敏感，统一规整为 32 的倍数 */
export const SIZE_ALIGNMENT = 32;

/** 向下规整到 32 的倍数，且不小于一个对齐单位 */
export function snapTo32(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`snapTo32 需要正数，收到：${value}`);
  }
  return Math.max(SIZE_ALIGNMENT, Math.floor(value / SIZE_ALIGNMENT) * SIZE_ALIGNMENT);
}

/** 尺寸是否已是 32 的倍数 */
export function isAlignedTo32(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value % SIZE_ALIGNMENT === 0;
}

/** `'16:9'` → `16 / 9` */
export function parseAspectRatio(aspect: AspectRatio): number {
  const [w, h] = aspect.split(':').map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    throw new RangeError(`无法解析画幅：${aspect}`);
  }
  return w / h;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * 把 `width × height` **居中裁切**到目标画幅，并规整为 32 的倍数。
 * 保证返回值 **不大于** 输入尺寸（否则 ffmpeg 的 crop 会失败）。
 */
export function cropToAspect(width: number, height: number, aspect: AspectRatio): Size {
  const target = parseAspectRatio(aspect);
  const current = width / height;

  const rawWidth = current > target ? height * target : width;
  const rawHeight = current > target ? height : width / target;

  const snappedWidth = Math.min(snapTo32(rawWidth), snapTo32(width));
  const snappedHeight = Math.min(snapTo32(rawHeight), snapTo32(height));

  return { width: snappedWidth, height: snappedHeight };
}

/** 保持原纵横比，仅把两侧规整到 32 的倍数（上传阶段用，S6 接入） */
export function snapSize(width: number, height: number): Size {
  return { width: snapTo32(width), height: snapTo32(height) };
}
