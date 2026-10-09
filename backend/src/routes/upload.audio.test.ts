import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UploadResponse } from '@astrmira/shared';
import { createAssetRoutes } from './assets.js';
import { MAX_AUDIO_BYTES, MAX_FILE_BYTES, createUploadRoutes, type ContainerStreams } from './upload.js';

/**
 * V2.10（台账 B57）· 音频素材上传的**端到端口径**（走真实 multipart → 落盘 → 复读）。
 *
 * 本文件钉住四件事（都是"不测就会悄悄错"的地方）：
 * 1. **音频判定不能只看容器**：实测 `file-type` 对 `.m4a` 与 `.mp4` 都返回 `video/mp4`，
 *    所以服务端形态是「容器嗅探 + ffprobe 流类型复核」——这里用**注入的复核桩**把三种分支
 *    （纯音频 / 真视频 / 复核不可用）都跑一遍，不依赖 CI 机器上 ffprobe 的具体行为；
 * 2. **音频体积闸门是 20MB**，且超限时**撤回已落盘的文件**（不留残渣）；
 * 3. **`/api/assets` 的 kind 以 sidecar 为准**：纯音频 mp4 的容器兜底会判 video，
 *    而 sidecar 里记的是 audio —— 这正是 V2.10 的关键断言；
 * 4. 音频**原样落盘**（不像图像那样走清洗网关），响应与磁盘字节数对账一致。
 */

const TMP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-audio-data-'));
const TMP_OUTPUTS_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-audio-out-'));
const ASSETS_DIR = path.join(TMP_OUTPUTS_DIR, 'assets');

/** 写入一条**可被 file-type 嗅探**的音频字节（44 字节 WAV 头；实测 audio/wav） */
function wavBytes(padding = 0): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + padding, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(8000, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(padding, 40);
  return Buffer.concat([header, Buffer.alloc(padding, 0)]);
}

/** 最小可嗅探 MP3：帧同步字（实测含 ID3 头但无合法帧的文件会判未知，所以用帧同步） */
function mp3Bytes(padding = 16): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(padding, 0)]);
}

/** 最小可嗅探 MP4 容器（ftyp isom）—— 纯音频 mp4 与真视频的**容器字节完全一样**（这正是坑） */
function mp4ContainerBytes(padding = 16): Buffer {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftyp', 'ascii'),
    Buffer.from('isom', 'ascii'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from('isom', 'ascii'),
    Buffer.from('mp42', 'ascii'),
    Buffer.alloc(padding, 0),
  ]);
}

type App = Awaited<ReturnType<typeof makeApp>>;

/** 可注入复核桩的最小 app：只挂 multipart + upload + assets（不碰主 app 的 SQLite） */
async function makeApp(probeStreams?: (filePath: string) => Promise<ContainerStreams | null>) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(multipart, { limits: { fileSize: MAX_FILE_BYTES } });
  await app.register(createUploadRoutes({ outputsDir: TMP_OUTPUTS_DIR, probeStreams }));
  await app.register(createAssetRoutes({ outputsDir: TMP_OUTPUTS_DIR }));
  await app.ready();
  return app;
}

function multipartPayload(file: { filename: string; contentType: string; content: Buffer }) {
  const boundary = '----astrmiraAudioBoundary';
  const parts: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="files"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.contentType}\r\n\r\n`,
      'utf8',
    ),
    file.content,
    Buffer.from('\r\n', 'utf8'),
    Buffer.from(`--${boundary}--\r\n`, 'utf8'),
  ];
  return { boundary, payload: Buffer.concat(parts) };
}

async function upload(
  app: App,
  file: { filename: string; contentType: string; content: Buffer },
) {
  const { boundary, payload } = multipartPayload(file);
  return app.inject({
    method: 'POST',
    url: '/api/upload',
    remoteAddress: '198.51.100.77',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload,
  });
}

async function uploadOk(
  app: App,
  file: { filename: string; contentType: string; content: Buffer },
): Promise<UploadResponse> {
  const res = await upload(app, file);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as UploadResponse;
}

/** 读 sidecar（断言"落盘元数据里到底记了什么"） */
function readSidecar(assetId: string): { name?: string; kind?: string } {
  return JSON.parse(readFileSync(path.join(ASSETS_DIR, `${assetId}.json`), 'utf8')) as {
    name?: string;
    kind?: string;
  };
}

let app: App;
/** 复核桩：默认"探测不可用"（= ffprobe 缺失），各用例按需覆写 */
let streamsResult: ContainerStreams | null = null;

beforeAll(async () => {
  mkdirSync(ASSETS_DIR, { recursive: true });
  app = await makeApp(async () => streamsResult);
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

describe('V2.10 · 音频上传（mp3 / wav / m4a）', () => {
  it('WAV（容器 mime 即音频）→ kind=audio、原样落盘 .wav、响应与磁盘对账一致', async () => {
    const input = wavBytes(64);
    const body = await uploadOk(app, { filename: 'bgm.wav', contentType: 'audio/wav', content: input });
    const asset = body.assets[0]!;

    expect(asset.kind).toBe('audio');
    expect(asset.mime).toBe('audio/wav');
    // 音频**不走**防线 4：落盘字节 = 上传字节（不是"清洗后的产物事实"）
    expect(asset.size).toBe(input.length);

    const stored = path.join(ASSETS_DIR, `${asset.assetId}.wav`);
    expect(existsSync(stored)).toBe(true);
    expect(statSync(stored).size).toBe(input.length);
    // 二进制原样（音频不做任何转码）
    expect(readFileSync(stored).equals(input)).toBe(true);

    // sidecar 记了 name 与 kind（`/api/assets` 靠它免探测）
    expect(readSidecar(asset.assetId)).toMatchObject({ name: 'bgm.wav', kind: 'audio' });
  });

  it('MP3（帧同步字）→ kind=audio', async () => {
    const body = await uploadOk(app, {
      filename: 'tone.mp3',
      contentType: 'audio/mpeg',
      content: mp3Bytes(512),
    });
    expect(body.assets[0]!.kind).toBe('audio');
    expect(body.assets[0]!.mime).toBe('audio/mpeg');
  });

  it('纯音频 mp4（容器=video/mp4 + 复核说"无视频流有音频流"）→ 判为 audio', async () => {
    streamsResult = { hasVideo: false, hasAudio: true };
    try {
      const body = await uploadOk(app, {
        filename: 'voice.m4a',
        contentType: 'audio/mp4',
        content: mp4ContainerBytes(128),
      });
      const asset = body.assets[0]!;
      // 容器 mime 仍是 video/mp4（嗅探事实就这么报，不美化），但 kind 被复核纠正为 audio
      expect(asset.mime).toBe('video/mp4');
      expect(asset.kind).toBe('audio');
      expect(readSidecar(asset.assetId).kind).toBe('audio');
    } finally {
      streamsResult = null;
    }
  });

  it('真视频（复核说"有视频流"）→ 仍是 video（复核不误伤视频）', async () => {
    streamsResult = { hasVideo: true, hasAudio: true };
    try {
      const body = await uploadOk(app, {
        filename: 'clip.mp4',
        contentType: 'video/mp4',
        content: mp4ContainerBytes(256),
      });
      expect(body.assets[0]!.kind).toBe('video');
    } finally {
      streamsResult = null;
    }
  });

  it('复核不可用（ffprobe 缺失 / 探测失败）→ 退回容器判定，如实归 video（不猜）', async () => {
    streamsResult = null;
    const body = await uploadOk(app, {
      filename: 'unknown.mp4',
      contentType: 'video/mp4',
      content: mp4ContainerBytes(64),
    });
    expect(body.assets[0]!.kind).toBe('video');
    expect(readSidecar(body.assets[0]!.assetId).kind).toBe('video');
  });

  it(`音频超 ${MAX_AUDIO_BYTES / 1024 / 1024}MB → 413 且**撤回已落盘的文件**（不留残渣）`, async () => {
    streamsResult = { hasVideo: false, hasAudio: true };
    try {
      const before = new Set(readdirSync(ASSETS_DIR));
      const response = await upload(app, {
        filename: 'huge-bgm.m4a',
        contentType: 'audio/mp4',
        content: mp4ContainerBytes(MAX_AUDIO_BYTES + 1024),
      });

      expect(response.statusCode, response.body).toBe(413);
      expect(response.json()).toMatchObject({ code: 'INVALID_ASSET' });

      // 关键：类型是"落盘之后"才确定的，所以必须确认文件被撤回
      // （只比"新增了什么"，因为前面的用例已经在这个目录里留下了别的 mp4）
      const added = readdirSync(ASSETS_DIR).filter((name) => !before.has(name));
      expect(added).toEqual([]);
    } finally {
      streamsResult = null;
    }
  });

  it('@ 提及弹层的枚举口径：/api/assets 的 kind **以 sidecar 为准**（纯音频 mp4 不再被判成 video）', async () => {
    streamsResult = { hasVideo: false, hasAudio: true };
    let assetId: string;
    try {
      const body = await uploadOk(app, {
        filename: 'song.m4a',
        contentType: 'audio/mp4',
        content: mp4ContainerBytes(96),
      });
      assetId = body.assets[0]!.assetId;
    } finally {
      streamsResult = null;
    }

    const response = await app.inject({ method: 'GET', url: '/api/assets' });
    expect(response.statusCode).toBe(200);
    const entries = (
      response.json() as {
        assets: Array<{ assetId: string; kind: string; url: string; name?: string }>;
      }
    ).assets;
    const entry = entries.find((item) => item.assetId === assetId)!;
    expect(entry.kind).toBe('audio');
    expect(entry.name).toBe('song.m4a');
    expect(entry.url).toBe(`/media/assets/${assetId}.mp4`);
  });
});
