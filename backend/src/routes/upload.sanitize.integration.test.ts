import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp, { type Metadata } from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UploadResponse } from '@astrmira/shared';
import { buildApp } from '../index.js';
import { MAX_LONG_EDGE } from '../pipeline/imageSanitize.js';
import { isAlignedTo32 } from '../pipeline/smartCrop.js';
import { sanitizeOriginalName } from './upload.js';

/**
 * Step 4-AC2 的**集成层**证据：上传的**落盘产物**合规（PLAN §4 Step 4-AC2）。
 *
 * 为什么单测（`pipeline/imageSanitize.test.ts`）不足以交这条 AC：
 * - 单测直接调 `sanitizeImage(buffer)`，绕过了 `/api/upload` 的类型嗅探、体积闸门与落盘命名；
 * - AC2 的原文要求"**断言以落盘产物为准**（ffprobe / sharp 元数据复核），不看响应字段自证"——
 *   也就是说**必须从磁盘把那文件读回来量**，而不是相信响应体里的 `mime` / `size`。
 *
 * 本文件覆盖 AC2 点名的输入类型（WebP / 超大图 / 非规整尺寸 / 透明通道）：
 * 每条用例都走**真实 multipart HTTP**（`app.inject` 走完整路由链）→ 清洗网关 → `outputs/assets/`，
 * 然后对**落盘文件**做 sharp 元数据断言，并额外与响应字段**对账**（响应说的 = 磁盘上的）。
 *
 * `HEIC`（HEVC 编码）不在此重复：预编译 libvips 无 HEVC 解码器 → 按实测能力走"诚实拒绝"，
 * 真实样本的实测报文已记在 PLAN §5 的 S6 条目，`describeImageFailure` 的文案由单测钉住。
 */

const TMP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-ac2-'));
const TMP_OUTPUTS_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-ac2-out-'));

function assetsDir(): string {
  return path.join(TMP_OUTPUTS_DIR, 'assets');
}

/** 读**落盘产物**的元数据：AC2 的"不看响应自证"就靠它 */
function probe(filePath: string): Promise<Metadata> {
  return sharp(filePath).metadata();
}

function multipartBody(
  files: { filename: string; contentType: string; content: Buffer }[],
): { boundary: string; payload: Buffer } {
  const boundary = '----astrmiraAC2Boundary';
  const parts: Buffer[] = [];

  for (const file of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="files"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.contentType}\r\n\r\n`,
        'utf8',
      ),
    );
    parts.push(file.content);
    parts.push(Buffer.from('\r\n', 'utf8'));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));

  return { boundary, payload: Buffer.concat(parts) };
}

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;

/** 上传一张图并返回响应体（断言失败时把 body 带进消息，便于定位） */
async function uploadOne(file: {
  filename: string;
  contentType: string;
  content: Buffer;
}): Promise<UploadResponse> {
  const { boundary, payload } = multipartBody([file]);
  const res = await app.inject({
    method: 'POST',
    url: '/api/upload',
    remoteAddress: '198.51.100.150',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload,
  });

  expect(res.statusCode, res.body).toBe(200);
  return res.json() as UploadResponse;
}

function solid(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } });
}

function withAlpha(width: number, height: number) {
  return sharp({
    create: { width, height, channels: 4, background: { r: 10, g: 200, b: 90, alpha: 0.5 } },
  });
}

beforeAll(async () => {
  process.env.DATA_DIR = TMP_DATA_DIR;
  process.env.OUTPUT_DIR = TMP_OUTPUTS_DIR;
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  // Windows 上 SQLite 的 WAL 句柄可能延迟释放：清理失败不应让测试失败
  for (const dir of [TMP_DATA_DIR, TMP_OUTPUTS_DIR]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* 临时目录残留无碍 */
    }
  }
});

describe('Step 4-AC2 · WebP / 超大图上传后，落盘产物合规（以磁盘事实为准）', () => {
  it('WebP（32 倍数，320×256）→ 落盘 .jpg（JPEG + sRGB），响应与磁盘对账一致', async () => {
    const input = await solid(320, 256).webp().toBuffer();

    const body = await uploadOne({ filename: 'style.webp', contentType: 'image/webp', content: input });
    const asset = body.assets[0];

    expect(body.assets).toHaveLength(1);
    expect(asset?.kind).toBe('image');
    // 响应里声明的是"清洗后的产物事实"：WebP 不被上游接受 → JPEG
    expect(asset?.mime).toBe('image/jpeg');

    // —— 以下全部读磁盘上那个文件，不看响应自证 ——
    const storedPath = path.join(assetsDir(), `${asset?.assetId as string}.jpg`);
    expect(existsSync(storedPath)).toBe(true);

    const meta = await probe(storedPath);
    expect(meta.format).toBe('jpeg');
    expect(meta.space).toBe('srgb');
    // 320×256 已是 32 倍数：尺寸原样（规整不该改动合规尺寸）
    expect(meta.width).toBe(320);
    expect(meta.height).toBe(256);
    expect(isAlignedTo32(meta.width as number)).toBe(true);
    expect(isAlignedTo32(meta.height as number)).toBe(true);

    // 对账：响应里的 size 必须等于磁盘上的字节数（响应不撒谎）
    expect(asset?.size).toBe(statSync(storedPath).size);
    // 注：**不**断言"转码后必然更小"——纯色合成图的 WebP 比 JPEG 更小（实测 230B vs 759B），
    // 体积本来就不是防线 4 的判据（合规性才是）。
  });

  it('超大图（3000×2000 PNG）→ 落盘长边压到 2048、两侧 32 倍数（2048×1344）', async () => {
    const input = await solid(3000, 2000).png().toBuffer();

    const body = await uploadOne({ filename: 'huge.png', contentType: 'image/png', content: input });
    const asset = body.assets[0];

    const storedPath = path.join(assetsDir(), `${asset?.assetId as string}.jpg`);
    expect(existsSync(storedPath)).toBe(true);

    const meta = await probe(storedPath);
    expect(meta.format).toBe('jpeg');
    expect(meta.space).toBe('srgb');
    // 3000 →（等比）1365.33 →（32 倍数规整）2048×1344，与单测钉的是同一组数字
    expect(meta.width).toBe(MAX_LONG_EDGE);
    expect(meta.height).toBe(1344);
    expect(Math.max(meta.width as number, meta.height as number)).toBeLessThanOrEqual(MAX_LONG_EDGE);
    expect(isAlignedTo32(meta.width as number)).toBe(true);
    expect(isAlignedTo32(meta.height as number)).toBe(true);

    expect(asset?.mime).toBe('image/jpeg');
    expect(asset?.size).toBe(statSync(storedPath).size);
  });

  it('非 32 倍数（831×479 PNG）→ 落盘规整为 800×448（只轻微缩放，不裁切）', async () => {
    const input = await solid(831, 479).png().toBuffer();

    const body = await uploadOne({ filename: 'odd.png', contentType: 'image/png', content: input });
    const asset = body.assets[0];

    const storedPath = path.join(assetsDir(), `${asset?.assetId as string}.jpg`);
    const meta = await probe(storedPath);

    expect(meta.width).toBe(800);
    expect(meta.height).toBe(448);
    expect(isAlignedTo32(meta.width as number)).toBe(true);
    expect(isAlignedTo32(meta.height as number)).toBe(true);
  });

  it('带透明通道（512×512 PNG）→ 落盘 .png 且 alpha 保留（不拍成白底）', async () => {
    const input = await withAlpha(512, 512).png().toBuffer();

    const body = await uploadOne({ filename: 'alpha.png', contentType: 'image/png', content: input });
    const asset = body.assets[0];

    expect(asset?.mime).toBe('image/png');

    const storedPath = path.join(assetsDir(), `${asset?.assetId as string}.png`);
    expect(existsSync(storedPath)).toBe(true);

    const meta = await probe(storedPath);
    expect(meta.format).toBe('png');
    expect(meta.hasAlpha).toBe(true);
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
    expect(asset?.size).toBe(statSync(storedPath).size);
  });

  it('HEIC（HEVC 编码）→ 415 诚实拒绝 + 转格式指引，且不落盘半成品', async () => {
    // 样本说明（如实）：这里用**最小 ftyp 容器头**触发"魔数嗅探通过、解码失败"的路径。
    // 真实 HEVC-HEIC 样本（libheif `examples/example.heic`）的实测报文记在 PLAN §5 的 S6 条目：
    // 预编译 libvips 没有 HEVC 解码器 → 同一条拒绝路径（此处 sharp 的报文同样是 `heif:` 段）。
    // 本用例钉住的是"**不静默放行**"：进白名单 ≠ 能解码，解码失败必须 415 + 可执行指引。
    const heicLike = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from('ftyp', 'ascii'),
      Buffer.from('heic', 'ascii'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('mif1', 'ascii'),
      Buffer.from('heic', 'ascii'),
    ]);

    const before = readdirSync(assetsDir()).filter((name) => name.endsWith('.heic'));

    const { boundary, payload } = multipartBody([
      { filename: 'iphone.heic', contentType: 'image/heic', content: heicLike },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/upload',
      remoteAddress: '198.51.100.151',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });

    expect(res.statusCode, res.body).toBe(415);
    const body = res.json() as { code: string; message: string };
    expect(body.code).toBe('INVALID_ASSET');
    // 文案必须"说人话"：指出 HEIC 与转格式路径（iPhone 用户的下一步动作）
    expect(body.message).toContain('HEIC');
    expect(body.message).toMatch(/JPEG/);

    // 拒绝 = 不落盘任何半成品
    const after = readdirSync(assetsDir()).filter((name) => name.endsWith('.heic'));
    expect(after).toHaveLength(before.length);
  });

  it('EXIF 元数据被剥离：落盘产物里读不到 EXIF（含可能的 GPS）', async () => {
    // 造一张带 EXIF（orientation=1）的 JPEG：上传后落盘产物应当不含该元数据
    const input = await solid(256, 256).withExifMerge({ IFD0: { Copyright: 'ac2-probe' } }).jpeg().toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const body = await uploadOne({ filename: 'exif.jpg', contentType: 'image/jpeg', content: input });
    const asset = body.assets[0];

    const storedPath = path.join(assetsDir(), `${asset?.assetId as string}.jpg`);
    const meta = await probe(storedPath);

    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
  });
});

describe('资产元数据 sidecar（V2.9 / 台账 B43）', () => {
  it('上传写 sidecar（原始文件名只落本地）→ GET /api/assets 能按名字认出来', async () => {
    const jpeg = await solid(64, 64).jpeg().toBuffer();
    const uploaded = await uploadOne({
      filename: '海边 参考图.jpeg',
      contentType: 'image/jpeg',
      content: jpeg,
    });
    const assetId = uploaded.assets[0]?.assetId as string;

    // ① 落盘事实：`<assetId>.json` 与资产同目录（删除按 `<assetId>.` 前缀规则自动覆盖）
    const metaPath = path.join(assetsDir(), `${assetId}.json`);
    expect(existsSync(metaPath)).toBe(true);
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { name?: string; uploadedAt?: number };
    expect(meta.name).toBe('海边 参考图.jpeg');
    expect(typeof meta.uploadedAt).toBe('number');

    // ② 契约面：清单条目带 name（同一条 app：上传 → 列表）
    const list = await app.inject({ method: 'GET', url: '/api/assets' });
    const entry = (
      list.json() as { assets: Array<{ assetId: string; name?: string }> }
    ).assets.find((item) => item.assetId === assetId);
    expect(entry?.name).toBe('海边 参考图.jpeg');
  });

  it('sanitize 是纯函数：只取 basename、剥控制字符、截断 120、空名视为没有名字', () => {
    expect(sanitizeOriginalName('..\\..\\windows\\system32\\cmd.exe')).toBe('cmd.exe');
    expect(sanitizeOriginalName('/etc/passwd')).toBe('passwd');
    expect(sanitizeOriginalName('a\u0000b\u001fc.png')).toBe('abc.png');
    expect(sanitizeOriginalName('   ')).toBeUndefined();
    expect(sanitizeOriginalName(undefined)).toBeUndefined();
    expect(sanitizeOriginalName('x'.repeat(200))?.length).toBe(120);
  });
});
