import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  TaskProgress,
  UploadResponse,
  VideoGenerateRequest,
  VideoProvider,
} from '@astrmira/shared';
import { buildApp } from '../index.js';
import { __clearProviderTestOverrides, __setProviderForTesting } from '../providers/registry.js';
import { MAX_FILE_BYTES, MAX_FILES } from './upload.js';

/**
 * S4 集成测试：防线 5 限流（AC9）+ 上传加固（AC10）+ 安全头 + 鉴权免鉴权口径。
 *
 * 用 `remoteAddress` 指定来源 IP 来隔离用例（inject 默认 127.0.0.1 会全部落进同一个冷却桶）。
 */

const TMP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-step4-'));
const TMP_OUTPUTS_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-step4-out-'));

const TMP_IMAGE_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-step4-img-'));
const SAMPLE_PNG = path.join(TMP_IMAGE_DIR, 'sample.png');

/**
 * 真实 PNG（由 ffmpeg 现场生成）。
 * 不能手拼魔数：`file-type` 对 PNG 会继续校验 IHDR chunk，"只有 8 字节魔数"会被判为未知类型。
 */
function realPngBytes(): Buffer {
  return readFileSync(SAMPLE_PNG);
}

const GIF_HEADER = Buffer.from('GIF89a', 'ascii'); // 白名单外（真类型 image/gif）

/** 手工拼 multipart body（避免引入 form-data 依赖） */
function multipartBody(
  files: { filename: string; contentType: string; content: Buffer }[],
): { boundary: string; payload: Buffer } {
  const boundary = '----astrmiraS4Boundary';
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

class StubProvider implements VideoProvider {
  readonly id = 'fixture-local' as const;
  readonly name = 'step4-stub';

  async checkHealth(): Promise<{ available: boolean }> {
    return { available: true };
  }

  async submit(request: VideoGenerateRequest): Promise<{ taskId: string }> {
    return { taskId: `up-${request.prompt.length}` };
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
    };
  }

  async cancel(): Promise<boolean> {
    return false;
  }
}

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;

function generateBody(prompt: string): VideoGenerateRequest {
  return {
    prompt,
    mode: 't2v',
    aspectRatio: '16:9',
    provider: 'fixture-local',
    params: { durationSec: 3 },
  };
}

async function postGenerate(prompt: string, remoteAddress: string, idempotencyKey: string) {
  return app.inject({
    method: 'POST',
    url: '/api/generate',
    remoteAddress,
    headers: { 'idempotency-key': idempotencyKey },
    payload: generateBody(prompt),
  });
}

async function postUpload(
  files: { filename: string; contentType: string; content: Buffer }[],
  remoteAddress = '198.51.100.200',
) {
  const { boundary, payload } = multipartBody(files);
  return app.inject({
    method: 'POST',
    url: '/api/upload',
    remoteAddress,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload,
  });
}

beforeAll(async () => {
  // 现场生成一张真实 PNG：`file-type` 会继续校验 IHDR chunk，只有魔数会被判为未知类型
  execFileSync(process.env.FFMPEG_PATH ?? 'ffmpeg', [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=64x64',
    '-frames:v',
    '1',
    '-y',
    SAMPLE_PNG,
  ]);

  process.env.DATA_DIR = TMP_DATA_DIR;
  process.env.OUTPUT_DIR = TMP_OUTPUTS_DIR;
  __setProviderForTesting('fixture-local', new StubProvider());
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  __clearProviderTestOverrides();
  // Windows 上 SQLite 的 WAL 句柄可能延迟释放：清理失败不应让测试失败
  for (const dir of [TMP_DATA_DIR, TMP_OUTPUTS_DIR, TMP_IMAGE_DIR]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* 临时目录残留无碍 */
    }
  }
});

describe('AC9 · 防线 5 防抖限流（60s 冷却，IP 单键）', () => {
  it('同一 IP 第二次提交 → 429 RATE_LIMITED / retryable', async () => {
    const ip = '198.51.100.11';

    const first = await postGenerate('限流用例 1', ip, 'rate-key-1');
    expect(first.statusCode).toBe(200);

    const second = await postGenerate('限流用例 2', ip, 'rate-key-2');
    expect(second.statusCode).toBe(429);

    const body = second.json() as { code: string; disposition: string };
    expect(body.code).toBe('RATE_LIMITED');
    expect(body.disposition).toBe('retryable');
  });

  it('不同 IP 互不影响', async () => {
    expect((await postGenerate('限流用例 3', '198.51.100.21', 'rate-key-3')).statusCode).toBe(200);
    expect((await postGenerate('限流用例 4', '198.51.100.22', 'rate-key-4')).statusCode).toBe(200);
  });

  it('幂等重放不消耗冷却：同键重复提交仍返回 200 + 同一 taskId', async () => {
    const ip = '198.51.100.31';

    const first = await postGenerate('幂等与限流', ip, 'rate-idem-1');
    const replay = await postGenerate('幂等与限流', ip, 'rate-idem-1');

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect((replay.json() as { taskId: string }).taskId).toBe(
      (first.json() as { taskId: string }).taskId,
    );
  });

  it('AC9 核心断言：冷却落 SQLite —— "重启"（重开连接 + 重新装配）后同一 IP 仍被拒', async () => {
    const ip = '198.51.100.41';

    const first = await buildApp();
    const ok = await first.inject({
      method: 'POST',
      url: '/api/generate',
      remoteAddress: ip,
      headers: { 'idempotency-key': 'rate-restart-1' },
      payload: generateBody('重启前'),
    });
    expect(ok.statusCode).toBe(200);
    await first.close();

    const second = await buildApp();
    const blocked = await second.inject({
      method: 'POST',
      url: '/api/generate',
      remoteAddress: ip,
      headers: { 'idempotency-key': 'rate-restart-2' },
      payload: generateBody('重启后'),
    });

    expect(blocked.statusCode).toBe(429);
    expect((blocked.json() as { code: string }).code).toBe('RATE_LIMITED');

    await second.close();
  });
});

describe('AC10 · 上传加固（体积 / 数量 / 魔数 / 白名单 / 路径）', () => {
  it('正常 PNG 上传成功，返回 assetId / kind / mime / size', async () => {
    const res = await postUpload([
      { filename: 'ok.png', contentType: 'image/png', content: realPngBytes() },
    ]);

    expect(res.statusCode).toBe(200);
    const body = res.json() as UploadResponse;
    expect(body.assets).toHaveLength(1);
    expect(body.assets[0]?.mime).toBe('image/png');
    expect(body.assets[0]?.kind).toBe('image');
    expect(body.assets[0]?.assetId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('单文件 > 20MB → 413（显式拒绝，不静默截断）', async () => {
    const res = await postUpload([
      {
        filename: 'huge.png',
        contentType: 'image/png',
        content: Buffer.concat([realPngBytes(), Buffer.alloc(MAX_FILE_BYTES + 1024, 0x41)]),
      },
    ]);

    expect(res.statusCode).toBe(413);
    expect((res.json() as { code: string }).code).toBe('INVALID_ASSET');
  });

  it(`文件数 > ${MAX_FILES} → 413`, async () => {
    const files = Array.from({ length: MAX_FILES + 1 }, (_unused, index) => ({
      filename: `many-${index}.png`,
      contentType: 'image/png',
      content: realPngBytes(),
    }));

    const res = await postUpload(files);

    // 失败时把响应体带进断言消息，便于定位（fastify 默认错误体含 code / message）
    expect(res.statusCode, res.body).toBe(413);
  });

  it('白名单外类型（真 GIF）→ 415', async () => {
    const res = await postUpload([
      { filename: 'anim.gif', contentType: 'image/gif', content: Buffer.concat([GIF_HEADER, Buffer.alloc(32)]) },
    ]);

    expect(res.statusCode).toBe(415);
    expect((res.json() as { code: string }).code).toBe('INVALID_ASSET');
  });

  it('伪造 Content-Type 被魔数识破（文本内容声称 image/png）→ 415', async () => {
    const res = await postUpload([
      {
        filename: 'fake.png',
        contentType: 'image/png', // 客户端声明
        content: Buffer.from('this is definitely not a png', 'utf8'),
      },
    ]);

    expect(res.statusCode).toBe(415);
  });

  it('产物路径只含服务端随机 ID：恶意文件名不参与落盘', async () => {
    const res = await postUpload([
      {
        filename: '../../evil.png',
        contentType: 'image/png',
        content: realPngBytes(),
      },
    ]);

    expect(res.statusCode).toBe(200);
    const assetId = (res.json() as UploadResponse).assets[0]?.assetId as string;

    const assetsDir = path.join(TMP_OUTPUTS_DIR, 'assets');
    const written = readdirSync(assetsDir);
    // 只有 <uuid>.png，没有 evil.png，也没有越出 assets 目录
    expect(written).toContain(`${assetId}.png`);
    expect(written.some((name) => name.includes('evil'))).toBe(false);
  });
});

describe('安全响应头（PLAN §7-4 加固）', () => {
  it('/api/health 带 nosniff / X-Frame-Options / Referrer-Policy', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });
});
