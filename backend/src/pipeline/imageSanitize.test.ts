import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  describeImageFailure,
  ImageSanitizeError,
  JPEG_QUALITY,
  MAX_LONG_EDGE,
  sanitizeImage,
} from './imageSanitize.js';
import { SIZE_ALIGNMENT, isAlignedTo32, snapTo32 } from './smartCrop.js';

/**
 * 防线 4 图像清洗网关（PLAN §5 的 **S6** 条目 / PLAN §4 Step 4-AC2）。
 *
 * 断言口径说明：
 * - 尺寸一律**钉死具体数字**（不是 ≤ 某值），因为规整规则是纯函数（`snapSize` = 向下取 32 倍数），
 *   确定性可算；写"范围断言"等于把规则漂移放过去；
 * - `HEIF 容器`用 AVIF 覆盖（同一条解码路径、预编译版可写可读）；**HEVC 编码的 `.heic` 走人工验证**：
 *   预编译 libvips 没有 HEVC 解码器，仓库又不宜放 700KB 二进制样本 —— 真实样本的实测结论
 *   写在 PLAN §5 的 S6 条目里，本文件用 `describeImageFailure` 的单测钉住"报错怎么说人话"；
 * - `metadata()` **能读容器头 ≠ 能解码**（第一版结论就是这么误判的），因此这里的用例全部
 *   `await sanitizeImage(...)` 走完整管线，不接受"仅 metadata 通过"这种假绿；
 * - `JPEG_QUALITY` 只用来核对导出参数确实被引用（避免"改常量不生效"这类静默漂移）。
 */

function solid(width: number, height: number, background = { r: 200, g: 120, b: 40 }) {
  return sharp({ create: { width, height, channels: 3, background } });
}

function withAlpha(width: number, height: number) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 10, g: 200, b: 90, alpha: 0.5 },
    },
  });
}

describe('sanitizeImage · 下采样与 32 倍数规整', () => {
  it('超大图：长边压到 MAX_LONG_EDGE，且两侧都是 32 的倍数', async () => {
    const input = await solid(3000, 2000).png().toBuffer();
    const out = await sanitizeImage(input);

    // 3000 → 2048（等比缩放后高 1365.33 → 1365）→ 规整：2048×1344
    expect(out.width).toBe(2048);
    expect(out.height).toBe(1344);
    expect(isAlignedTo32(out.width)).toBe(true);
    expect(isAlignedTo32(out.height)).toBe(true);
    expect(out.mime).toBe('image/jpeg');
    expect(out.ext).toBe('jpg');
    expect(out.buffer.length).toBeLessThan(input.length);
    expect(out.actions.join(' / ')).toContain('下采样');
  });

  it('非 32 倍数（831×479）：规整为 800×448，不裁切只轻微缩放', async () => {
    const input = await solid(831, 479).png().toBuffer();
    const out = await sanitizeImage(input);

    expect(out.width).toBe(800);
    expect(out.height).toBe(448);
    expect(out.actions.join(' / ')).toContain('规整到 32 的倍数');
  });

  it('已经合规的图（64×64）：尺寸原样、不产生多余动作', async () => {
    const out = await sanitizeImage(await solid(64, 64).png().toBuffer());

    expect(out.width).toBe(64);
    expect(out.height).toBe(64);
    expect(out.actions).toHaveLength(0);
  });
});

describe('sanitizeImage · 格式与色彩空间', () => {
  it('WebP → JPEG（视频模型只吃常规图）', async () => {
    const input = await solid(128, 64).webp().toBuffer();
    const out = await sanitizeImage(input);

    expect(out.mime).toBe('image/jpeg');
    expect((await sharp(out.buffer).metadata()).format).toBe('jpeg');
  });

  it('HEIF 容器（AV1/AVIF）→ JPEG：容器解码可用；不可用的是 HEVC 那一支', async () => {
    const input = await solid(128, 64).avif().toBuffer();
    expect((await sharp(input).metadata()).format).toBe('heif');

    const out = await sanitizeImage(input);

    expect(out.mime).toBe('image/jpeg');
    expect(out.width).toBe(128);
    expect(out.height).toBe(64);
  });

  it('CMYK 输入 → 输出 sRGB（不偏色）', async () => {
    const input = await solid(64, 64).toColorspace('cmyk').jpeg().toBuffer();
    expect((await sharp(input).metadata()).space).toBe('cmyk');

    const out = await sanitizeImage(input);
    const meta = await sharp(out.buffer).metadata();

    expect(meta.space).toBe('srgb');
    expect(meta.channels).toBe(3);
  });

  it('带透明通道 → 保持 PNG（不把 alpha 拍成白底）', async () => {
    const out = await sanitizeImage(await withAlpha(96, 48).png().toBuffer());
    const meta = await sharp(out.buffer).metadata();

    expect(out.mime).toBe('image/png');
    expect(out.ext).toBe('png');
    expect(meta.hasAlpha).toBe(true);
  });

  it('JPEG 导出质量取自 JPEG_QUALITY 常量', async () => {
    const input = await solid(256, 256).png().toBuffer();
    const out = await sanitizeImage(input);
    const meta = await sharp(out.buffer).metadata();

    // 只做"参数确实生效"的间接核对：质量 90 的产物应小于无损 PNG 的原图
    expect(meta.format).toBe('jpeg');
    expect(JPEG_QUALITY).toBeGreaterThan(0);
    expect(out.buffer.length).toBeLessThan(input.length);
  });
});

describe('sanitizeImage · EXIF 与元数据', () => {
  it('EXIF 方向 6：宽高按"人看到的方向"交换，且方向标记被清掉', async () => {
    // 存储 96×64 + orientation=6 → 人看到的是 64×96
    const input = await solid(96, 64).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect((await sharp(input).metadata()).orientation).toBe(6);

    const out = await sanitizeImage(input);

    expect(out.width).toBe(64);
    expect(out.height).toBe(96);
    expect(out.actions.join(' / ')).toContain('EXIF 方向矫正');

    const meta = await sharp(out.buffer).metadata();
    expect(meta.orientation ?? 1).toBe(1);
    expect(meta.width).toBe(64);
    expect(meta.height).toBe(96);
  });

  it('元数据一律剥离（EXIF 里可能带 GPS）', async () => {
    const input = await solid(64, 64).jpeg().withMetadata({ orientation: 1 }).toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const out = await sanitizeImage(input);

    expect((await sharp(out.buffer).metadata()).exif).toBeUndefined();
    expect(out.actions.join(' / ')).toContain('剥离元数据');
  });
});

describe('sanitizeImage · 拒收路径（不静默放行）', () => {
  it('过小的图（短边 < 32）→ 显式报错并说明原因', async () => {
    const input = await solid(16, 16).png().toBuffer();

    await expect(sanitizeImage(input)).rejects.toThrowError(ImageSanitizeError);
    await expect(sanitizeImage(input)).rejects.toThrowError(/过小/);
  });

  it('损坏 / 非图像字节 → 显式报错并给出转格式指引', async () => {
    const broken = Buffer.from('这显然不是一张图', 'utf8');

    await expect(sanitizeImage(broken)).rejects.toThrowError(ImageSanitizeError);
    await expect(sanitizeImage(broken)).rejects.toThrowError(/JPEG \/ PNG/);
  });
});

describe('describeImageFailure · 把底层报错翻成"用户能照着做"的话', () => {
  it('实测到的 HEVC-HEIC 报错 → 说清缺解码器 + 给出 iPhone 转格式路径', () => {
    // 真实报错串（2026-09-22 用 libheif 的 example.heic 实测所得），钉住以免映射悄悄失效
    const raw = new Error(
      'heif: Error while loading plugin: Support for this compression format has not been built in (11.6003)',
    );

    const message = describeImageFailure(raw);

    expect(message).toContain('HEVC');
    expect(message).toContain('JPEG / PNG');
    expect(message).toContain('兼容性最佳');
  });

  it('其它解码失败 → 通用兜底，且不把 libvips 的噪声甩给用户', () => {
    const message = describeImageFailure(new Error('VipsJpeg: premature end of JPEG image'));

    expect(message).toContain('图像解码失败');
    expect(message).not.toContain('VipsJpeg');
  });
});

describe('与生成阶段共用同一组尺寸规则', () => {
  it('规整结果 == snapTo32 的纯函数结果（两段不会分叉）', async () => {
    const out = await sanitizeImage(await solid(900, 500).png().toBuffer());

    expect(out.width).toBe(snapTo32(900));
    expect(out.height).toBe(snapTo32(500));
    expect(SIZE_ALIGNMENT).toBe(32);
    expect(MAX_LONG_EDGE % SIZE_ALIGNMENT).toBe(0);
  });
});
