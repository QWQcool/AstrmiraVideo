import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../index.js';
import { MAX_LISTED_ASSETS, createAssetRoutes } from './assets.js';

/**
 * `GET /api/assets`（CONTRACT §5 / V2.7；台账 B41）—— 资产库清单的**三条口径**：
 * ① 空目录（从未上传）→ 200 + 空数组，**不是 404**；
 * ② 条目事实来自落盘：魔数嗅探定 kind/mime、stat 定 size、`<uuid>.<ext>` 命名过滤；
 * ③ 排序（新在前）与截断（上限 MAX_LISTED_ASSETS）。
 *
 * 边界样本刻意包括：**改错后缀**的资产（.jpg 里是 PNG 魔数 → 以嗅探为准）、
 * 非 UUID 命名的杂文件（跳过）、目录里的子目录（跳过）。
 */

const TMP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-assets-data-'));
const TMP_OUTPUTS_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-assets-out-'));
const ASSETS_DIR = path.join(TMP_OUTPUTS_DIR, 'assets');

/** 最小可嗅探 PNG：签名 + IHDR chunk（file-type 会校验 IHDR，只有 8 字节签名会判未知） */
function pngBytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0x00, 0x00, 0x00, 0x0d]),
    Buffer.from('IHDR', 'ascii'),
    Buffer.alloc(13, 0),
    Buffer.alloc(4, 0),
  ]);
}

/** 最小可嗅探 MP4：ftyp box（isom / mp42） */
function mp4Bytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftyp', 'ascii'),
    Buffer.from('isom', 'ascii'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from('isom', 'ascii'),
    Buffer.from('mp42', 'ascii'),
  ]);
}

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;

beforeAll(async () => {
  process.env.DATA_DIR = TMP_DATA_DIR;
  process.env.OUTPUT_DIR = TMP_OUTPUTS_DIR;
  mkdirSync(ASSETS_DIR, { recursive: true });

  // ② 事实来自落盘：PNG 内容刻意存成 `.jpg` 后缀 —— 列表必须以嗅探结果为准（image/png）
  writeFileSync(path.join(ASSETS_DIR, `${UUID_A}.jpg`), pngBytes());
  writeFileSync(path.join(ASSETS_DIR, `${UUID_B}.mp4`), mp4Bytes());
  // 非 UUID 命名的杂文件与子目录：一律跳过
  writeFileSync(path.join(ASSETS_DIR, 'readme.txt'), 'not an asset');
  mkdirSync(path.join(ASSETS_DIR, 'subdir'));

  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  for (const dir of [TMP_DATA_DIR, TMP_OUTPUTS_DIR]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* 临时目录残留无碍 */
    }
  }
});

describe('GET /api/assets · 资产库清单（V2.7）', () => {
  it('返回落盘资产的清单：嗅探定 kind/mime、stat 定 size、url 为同源 /media/assets 直链', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/assets' });
    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      assets: Array<{
        assetId: string;
        kind: string;
        mime: string;
        size: number;
        url: string;
        createdAt: number;
      }>;
    };

    const byId = new Map(body.assets.map((asset) => [asset.assetId, asset]));
    expect(byId.size).toBe(2);

    const image = byId.get(UUID_A)!;
    // 后缀是 .jpg 但内容是 PNG —— 嗅探事实优先（与 /api/upload 同一口径）
    expect(image.kind).toBe('image');
    expect(image.mime).toBe('image/png');
    expect(image.size).toBe(pngBytes().length);
    expect(image.url).toBe(`/media/assets/${UUID_A}.jpg`);
    expect(image.createdAt).toBeGreaterThan(0);

    const video = byId.get(UUID_B)!;
    expect(video.kind).toBe('video');
    expect(video.mime).toBe('video/mp4');
    expect(video.size).toBe(mp4Bytes().length);
    expect(video.url).toBe(`/media/assets/${UUID_B}.mp4`);
  });

  it('非 UUID 命名 / 非媒体内容不进列表（只认 /api/upload 的落盘命名与魔数）', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/assets' });
    const body = response.json() as { assets: Array<{ assetId: string }> };
    const ids = body.assets.map((asset) => asset.assetId);
    expect(ids).not.toContain('readme');
    expect(ids).not.toContain('subdir');
  });

  it('新在前；超过上限时只返回最近 MAX_LISTED_ASSETS 个（上限是契约常量）', async () => {
    // 造一批新资产：mtimeMs 由写入顺序决定（同一毫秒可能并列，排序断言只钉"最新的一定在"）
    for (let index = 0; index < 3; index += 1) {
      const id = `4444444${index}-4444-4444-8444-444444444444`;
      writeFileSync(path.join(ASSETS_DIR, `${id}.png`), pngBytes());
    }

    const response = await app.inject({ method: 'GET', url: '/api/assets' });
    const body = response.json() as { assets: Array<{ createdAt: number }> };
    expect(body.assets.length).toBeLessThanOrEqual(MAX_LISTED_ASSETS);
    for (let index = 1; index < body.assets.length; index += 1) {
      expect(body.assets[index - 1]!.createdAt).toBeGreaterThanOrEqual(body.assets[index]!.createdAt);
    }
  });

  it('V2.9：有 sidecar → 透出原始文件名；没有 / 坏掉 → 不带 name（不猜、不填占位）', async () => {
    writeFileSync(
      path.join(ASSETS_DIR, `${UUID_A}.json`),
      JSON.stringify({ name: '海边 参考图.png', uploadedAt: 1 }),
    );
    const UUID_C = '33333333-3333-4333-8333-333333333333';
    writeFileSync(path.join(ASSETS_DIR, `${UUID_C}.png`), pngBytes());
    writeFileSync(path.join(ASSETS_DIR, `${UUID_C}.json`), '{ this is not json');

    const response = await app.inject({ method: 'GET', url: '/api/assets' });
    const body = response.json() as {
      assets: Array<{ assetId: string; url: string; name?: string }>;
    };
    const byId = new Map(body.assets.map((asset) => [asset.assetId, asset]));

    expect(byId.get(UUID_A)?.name).toBe('海边 参考图.png');
    expect(byId.get(UUID_B)).not.toHaveProperty('name');
    expect(byId.get(UUID_C)).not.toHaveProperty('name');

    // sidecar 自己**不是**资产（json 无魔数）——它只是同目录的元数据
    expect(body.assets.some((asset) => asset.url.endsWith('.json'))).toBe(false);
  });

  it('空目录（从未上传）→ 200 + 空数组，不是 404', async () => {
    // 独立最小 app + 注入空目录：不碰主 app 的 DATA_DIR（避免双连接抢同一 SQLite）
    const emptyOut = mkdtempSync(path.join(tmpdir(), 'astrmira-assets-empty-'));
    const mini = Fastify();
    mini.setValidatorCompiler(validatorCompiler);
    mini.setSerializerCompiler(serializerCompiler);
    await mini.register(createAssetRoutes({ outputsDir: emptyOut }));
    await mini.ready();
    try {
      const response = await mini.inject({ method: 'GET', url: '/api/assets' });
      expect(response.statusCode).toBe(200);
      expect((response.json() as { assets: unknown[] }).assets).toEqual([]);
    } finally {
      await mini.close();
      rmSync(emptyOut, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
});
