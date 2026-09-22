import sharp, { type Metadata } from 'sharp';
import { SIZE_ALIGNMENT, snapSize } from './smartCrop.js';

/**
 * 防线 4：图像格式清洗网关（施工手册 **S6**）。
 *
 * ## 职责（只做这四件事，不多做）
 * 1. **解码 + EXIF 方向矫正**：手机直出的图带 orientation，不矫正的话"人看着是竖的、像素是横的"；
 * 2. **色彩空间统一为 sRGB**：CMYK / AdobeRGB 交给视频模型会偏色；
 * 3. **超大图下采样**：长边超过 `MAX_LONG_EDGE` 即等比缩小（防上游体积/额度与显存问题）；
 * 4. **32 倍数规整**：与生成阶段的裁切**共用同一组纯函数**（`snapSize`），避免两段规则分叉。
 *
 * ## 为什么这里**不裁切**
 * 上传阶段**不知道目标画幅**（16:9 / 9:16 / 1:1 是生成时才选的）。所以这里只做"清洗 + 规整"，
 * 按 `aspectRatio` 的**居中裁切发生在生成阶段**（`cropToAspect`）。两段共用同一套尺寸规则。
 *
 * ## 规整是"轻微缩放"而不是"裁掉多余像素"
 * `snapSize` 对两侧各自向下取 32 的倍数，所以会丢掉最多 31px/边 —— 这里用轻微缩放补齐
 * （而非裁切），因为上传阶段裁掉的像素在生成阶段可能恰恰是需要的。
 *
 * ## 元数据一律**剥离**
 * sharp 默认不写回元数据，于是 EXIF（含可能的 GPS）不会随资产落盘；这是防线 4 的附带收益，
 * 也在 `actions` 里如实记账（不做"静默改图"）。
 *
 * ## HEIC 的实测结论（2026-09-22，**别被 `metadata()` 骗了**）
 * 拿真实样本（libheif 仓库 `examples/example.heic`，1280×854，HEVC 编码）实测
 * `sharp 0.35.4` / `libvips 8.18.6`（Windows 预编译）：
 * - `sharp(buf).metadata()` **成功** —— 但它只读容器头，**不能作为"能解码"的证据**
 *   （第一版结论就是这么误判的，直到走完整个管线才暴露）；
 * - 真正解码时报 **`heif: Error while loading plugin: Support for this compression format
 *   has not been built in`** → 预编译版**没有 HEVC 解码器**（写 HEVC 也没有：`heifsave: Unsupported compression`）；
 * - 反面对照：**HEIF 容器本身可用**（AV1 编码的 AVIF 走同一路径实测通过，见单测），
 *   缺的只是 HEVC 那一支；
 * - 本机 ffmpeg 也没有 heic 解码器（`-decoders` 无 heic）→ **不存在 ffmpeg 兜底**，
 *   所以这里只能**诚实拒绝**：`/api/upload` 归 `INVALID_ASSET`（terminal）并给出转格式指引。
 *
 * 结论：`.heic`（iPhone 相机默认格式）当前**不被接受**，报错必须说清"为什么 + 怎么办"；
 * 生产镜像（同族 linux 预编译）标【待验证】，行为一致（同样走显式拒绝，不静默放行）。
 */

/** 长边上限：超过即等比下采样（2048 足够做首尾帧，又远小于 20MB 上传上限的典型体积） */
export const MAX_LONG_EDGE = 2048;

/** 统一输出 JPEG 的质量（PNG 走无损，不适用） */
export const JPEG_QUALITY = 90;

/** 清洗失败：调用方应归 `INVALID_ASSET`（terminal），并把 `message` 原样给用户看 */
export class ImageSanitizeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ImageSanitizeError';
  }
}

/**
 * 把底层解码错误翻译成**用户能照着做**的话。
 *
 * 为什么要单独成函数：`libvips` 的原始报错（`heif: Error while loading plugin: Support for
 * this compression format has not been built in (11.6003)`）对用户毫无意义，
 * 而这恰好是 iPhone 用户最容易踩的一格 —— 说清"是 HEVC 没编进来"和"怎么转"才有用。
 * 导出是为了让单测能钉住这段映射（含实测到的真实报错串）。
 */
export function describeImageFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);

  if (/has not been built in|heif|hevc/i.test(raw)) {
    return (
      '暂不支持这种 HEIC：它用的是 HEVC 编码，而本服务的图像库未编译该解码器。' +
      '请改成 JPEG / PNG 再上传（iPhone：设置 → 相机 → 格式 → 兼容性最佳，或直接导出为 JPEG）。'
    );
  }

  return (
    '图像解码失败：文件可能损坏，或使用了本服务不支持的编码格式。' +
    '请改成 JPEG / PNG 再上传。'
  );
}

export interface SanitizedImage {
  buffer: Buffer;
  /** 清洗后的真实类型：HEIC/WebP/AVIF 一律转 JPEG；带透明通道的保持 PNG（不把 alpha 拍成白底） */
  mime: 'image/jpeg' | 'image/png';
  ext: 'jpg' | 'png';
  width: number;
  height: number;
  /** 实际做过的处理，逐条记账（如实，不静默） */
  actions: string[];
}

export async function sanitizeImage(input: Buffer): Promise<SanitizedImage> {
  let metadata: Metadata;

  try {
    metadata = await sharp(input).metadata();
  } catch (error) {
    // ⚠️ 这一步**只读容器头**：它成功不等于能解码（HEIC 就是这么骗过第一版结论的）。
    // 真正的解码闸门在下面的编码阶段 —— 那里再失败同样走同一个翻译器。
    throw new ImageSanitizeError(describeImageFailure(error), { cause: error });
  }

  if (metadata.width === undefined || metadata.height === undefined) {
    throw new ImageSanitizeError('图像缺少尺寸信息，无法清洗');
  }

  const actions: string[] = [];

  // EXIF 方向 5~8 会交换宽高：先按方向换算出"人看到的"尺寸，再算下采样目标
  const orientation = typeof metadata.orientation === 'number' ? metadata.orientation : 1;
  const rotated = orientation >= 5 && orientation <= 8;
  const sourceWidth = rotated ? metadata.height : metadata.width;
  const sourceHeight = rotated ? metadata.width : metadata.height;

  if (orientation !== 1) actions.push(`EXIF 方向矫正（orientation=${orientation}）`);

  if (sourceWidth < SIZE_ALIGNMENT || sourceHeight < SIZE_ALIGNMENT) {
    throw new ImageSanitizeError(
      `参考图过小：短边需 ≥ ${SIZE_ALIGNMENT}px（当前 ${sourceWidth}×${sourceHeight}）`,
    );
  }

  // ① 长边上限
  const longEdge = Math.max(sourceWidth, sourceHeight);
  let targetWidth = sourceWidth;
  let targetHeight = sourceHeight;

  if (longEdge > MAX_LONG_EDGE) {
    const scale = MAX_LONG_EDGE / longEdge;
    targetWidth = Math.round(sourceWidth * scale);
    targetHeight = Math.round(sourceHeight * scale);
    actions.push(`下采样（长边 ${longEdge} → ${MAX_LONG_EDGE}）`);
  }

  // ② 32 倍数规整（与生成阶段的裁切共用同一组纯函数）
  const snapped = snapSize(targetWidth, targetHeight);

  if (snapped.width !== targetWidth || snapped.height !== targetHeight) {
    actions.push(
      `尺寸规整到 32 的倍数（${targetWidth}×${targetHeight} → ${snapped.width}×${snapped.height}）`,
    );
  }

  // ③ 色彩空间统一（CMYK / AdobeRGB → sRGB）+ EXIF 方向烘焙进像素
  const pipeline = sharp(input)
    .rotate()
    .toColorspace('srgb')
    .resize({ width: snapped.width, height: snapped.height, fit: 'fill' });

  if (metadata.hasAlpha === true) {
    actions.push('保留透明通道（输出 PNG）');
  }

  const keepAlpha = metadata.hasAlpha === true;
  let buffer: Buffer;

  try {
    buffer = keepAlpha
      ? await pipeline.png().toBuffer()
      : await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer();
  } catch (error) {
    // 解码真正的失败点（HEIC/HEVC 就是走到这里才炸的）→ 翻译成可执行的指引
    throw new ImageSanitizeError(describeImageFailure(error), { cause: error });
  }

  if (metadata.exif !== undefined || metadata.icc !== undefined) {
    actions.push('剥离元数据（EXIF / ICC，含可能的 GPS）');
  }

  return {
    buffer,
    mime: keepAlpha ? 'image/png' : 'image/jpeg',
    ext: keepAlpha ? 'png' : 'jpg',
    width: snapped.width,
    height: snapped.height,
    actions,
  };
}
