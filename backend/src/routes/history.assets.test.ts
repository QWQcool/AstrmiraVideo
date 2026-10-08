import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import type { TaskProgress, UploadResponse, VideoGenerateRequest, VideoProvider } from '@astrmira/shared';
import { buildApp } from '../index.js';
import { __clearProviderTestOverrides, __setProviderForTesting } from '../providers/registry.js';

/**
 * 删除任务时清理**参考资产**（CONTRACT §7 / V8.3 批次 3）。
 *
 * 两条分支都要钉住：
 * 1. 资产只被这一条任务引用 → 连同资产文件一起删掉（释放磁盘）；
 * 2. 资产被**其它任务复用**（参数一键回填的常见结果）→ 只能删任务，资产必须留着，
 *    否则会顺手毁掉另一条任务的参考图。
 */

const TMP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-assets-data-'));
const TMP_OUTPUTS_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-assets-out-'));

class ImmediateProvider implements VideoProvider {
  readonly id = 'fixture-local' as const;
  readonly name = 'assets-stub';

  async checkHealth(): Promise<{ available: boolean }> {
    return { available: true };
  }

  async submit(request: VideoGenerateRequest): Promise<{ taskId: string }> {
    return { taskId: `up-${request.prompt.slice(0, 8)}` };
  }

  async queryStatus(taskId: string): Promise<TaskProgress> {
    return {
      taskId,
      status: 'succeeded',
      progressPercent: 100,
      requestSnapshot: {
        prompt: 'x',
        mode: 't2v',
        aspectRatio: '16:9',
        provider: 'fixture-local',
      },
      outputVideoUrl: `/media/${taskId}.mp4`,
      createdAt: Date.now(), // V2.3：桩上游也要满足契约形状
    };
  }

  async cancel(): Promise<boolean> {
    return false;
  }
}

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;

function multipartBody(file: { filename: string; content: Buffer }): {
  boundary: string;
  payload: Buffer;
} {
  const boundary = '----astrmiraAssetsBoundary';
  return {
    boundary,
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.filename}"\r\n` +
          `Content-Type: image/png\r\n\r\n`,
        'utf8',
      ),
      file.content,
      Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
    ]),
  };
}

async function uploadPng(remoteAddress: string): Promise<string> {
  const png = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .png()
    .toBuffer();

  const { boundary, payload } = multipartBody({ filename: 'ref.png', content: png });
  const response = await app.inject({
    method: 'POST',
    url: '/api/upload',
    remoteAddress,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload,
  });

  expect(response.statusCode, response.body).toBe(200);
  return (response.json() as UploadResponse).assets[0]?.assetId as string;
}

/** 提交一条引用该资产的任务（走真实路由，拿到任务后由桩 provider 立即"完成"） */
async function submitTaskWithAsset(
  assetId: string,
  remoteAddress: string,
  idempotencyKey: string,
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/generate',
    remoteAddress,
    headers: { 'idempotency-key': idempotencyKey },
    payload: {
      prompt: `资产清理用例 ${idempotencyKey}`,
      mode: 'i2v',
      aspectRatio: '16:9',
      provider: 'fixture-local',
      assets: { firstFrameImage: assetId },
      params: { durationSec: 2 },
    } satisfies VideoGenerateRequest,
  });

  expect(response.statusCode, response.body).toBe(200);
  return (response.json() as { taskId: string }).taskId;
}

/**
 * 资产目录里与某 assetId 相关的文件，分成两栏（V2.9 / B43 起）：
 * - `media`：媒体文件本身（扩展名由防线 4 决定——不透明图 → jpg）；
 * - `meta`：**sidecar** `<assetId>.json`（原始文件名等元数据；与资产同前缀，天然被同一条清理规则覆盖）。
 */
function assetFiles(assetId: string): { media: string[]; meta: string[] } {
  const dir = path.join(TMP_OUTPUTS_DIR, 'assets');
  if (!existsSync(dir)) return { media: [], meta: [] };
  const all = readdirSync(dir).filter((name) => name.startsWith(`${assetId}.`));
  return {
    media: all.filter((name) => !name.endsWith('.json')),
    meta: all.filter((name) => name.endsWith('.json')),
  };
}

beforeAll(async () => {
  process.env.DATA_DIR = TMP_DATA_DIR;
  process.env.OUTPUT_DIR = TMP_OUTPUTS_DIR;

  __setProviderForTesting('fixture-local', new ImmediateProvider());
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  __clearProviderTestOverrides();
  for (const dir of [TMP_DATA_DIR, TMP_OUTPUTS_DIR]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* 临时目录残留无碍 */
    }
  }
});

describe('删除任务 · 参考资产清理', () => {
  it('资产只被这一条任务引用 → 删任务时一并删掉资产文件（媒体 + sidecar）', async () => {
    const assetId = await uploadPng('198.51.100.71');
    // V2.9：上传同时写了媒体文件与 sidecar（原始文件名只落本地）
    expect(assetFiles(assetId).media).toHaveLength(1);
    expect(assetFiles(assetId).meta).toHaveLength(1);

    const taskId = await submitTaskWithAsset(assetId, '198.51.100.72', 'assets-case-1');
    const removed = await app.inject({ method: 'DELETE', url: `/api/history/${taskId}` });

    expect(removed.statusCode).toBe(200);
    // 契约 §7：sidecar 落在同一条 `<assetId>.` 前缀清理规则里——不新增清理路径，也不留孤儿
    expect(assetFiles(assetId).media).toHaveLength(0);
    expect(assetFiles(assetId).meta).toHaveLength(0);
  });

  it('资产被其它任务复用 → 删一条任务**不能**删掉资产', async () => {
    const assetId = await uploadPng('198.51.100.73');

    // 同一资产被两条任务引用 = 参数一键回填后的常见状态
    const first = await submitTaskWithAsset(assetId, '198.51.100.74', 'assets-case-2a');
    await submitTaskWithAsset(assetId, '198.51.100.75', 'assets-case-2b');

    const removed = await app.inject({ method: 'DELETE', url: `/api/history/${first}` });
    expect(removed.statusCode).toBe(200);
    expect(assetFiles(assetId).media, '资产仍被另一条任务引用，必须保留').toHaveLength(1);
    expect(assetFiles(assetId).meta, 'sidecar 与资产同生共死').toHaveLength(1);
  });
});
