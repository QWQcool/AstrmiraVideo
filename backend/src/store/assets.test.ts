import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseTaskRef, TASK_REF_PREFIX } from '@astrmira/shared';
import {
  createAssetUrlResolver,
  createTaskVideoUrlResolver,
  type TaskVideoResolverOptions,
} from './assets.js';
import type { TaskRecord } from './taskStore.js';

/**
 * `task:<taskId>` 引用解析（V2.6 / 台账 B37：成片与剪辑产物直接当 V2V 参考）。
 *
 * 三个失败态必须分开（错误码与文案都不同）：
 * - `not_found` / `no_output` → provider 层归 `TASK_NOT_FOUND`；
 * - `no_public_base` → provider 层归 `INVALID_ASSET` + PUBLIC_BASE_URL 指引
 *   （视频没有 data URL 退路 —— 上游明文拒绝，见 CONTRACT §1）。
 */

function makeStore(record: TaskRecord | null): TaskVideoResolverOptions['store'] {
  return { get: () => record };
}

function succeededRecord(outputVideoUrl?: string): TaskRecord {
  return {
    taskId: 'task-ref-1',
    track: 'local',
    provider: 'browser-remotion',
    status: 'succeeded',
    progressPercent: 100,
    requestSnapshot: {
      prompt: '源片',
      mode: 't2v',
      aspectRatio: '16:9',
      provider: 'cloud-volcano-seedance',
    },
    ...(outputVideoUrl === undefined ? {} : { outputVideoUrl }),
    warnings: [],
    submitting: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('parseTaskRef（shared 常量形态）', () => {
  it('`task:` 前缀解析出 taskId；普通资产 id 与空前缀返回 null', () => {
    expect(parseTaskRef(`${TASK_REF_PREFIX}abc-123`)).toBe('abc-123');
    expect(parseTaskRef('a-asset-id')).toBeNull();
    expect(parseTaskRef(TASK_REF_PREFIX)).toBeNull();
  });
});

describe('createTaskVideoUrlResolver', () => {
  it('成功：已出片任务 + 公网基址 → 拼出 /media 直链', async () => {
    const resolve = createTaskVideoUrlResolver({
      store: makeStore(succeededRecord('/media/task-ref-1.mp4')),
      publicBaseUrl: 'https://video.example.com/',
    });
    // 基址尾斜杠要被剥掉（与 createAssetUrlResolver 同口径）
    await expect(resolve('task-ref-1')).resolves.toEqual({
      ok: true,
      url: 'https://video.example.com/media/task-ref-1.mp4',
    });
  });

  it('任务不存在 → not_found', async () => {
    const resolve = createTaskVideoUrlResolver({
      store: makeStore(null),
      publicBaseUrl: 'https://video.example.com',
    });
    await expect(resolve('ghost')).resolves.toEqual({ ok: false, reason: 'not_found' });
  });

  it('任务未出片（无成片 / 未成功）→ no_output', async () => {
    const resolve = createTaskVideoUrlResolver({
      store: makeStore(succeededRecord()),
      publicBaseUrl: 'https://video.example.com',
    });
    await expect(resolve('task-ref-1')).resolves.toEqual({ ok: false, reason: 'no_output' });

    const running = createTaskVideoUrlResolver({
      store: makeStore({ ...succeededRecord('/media/x.mp4'), status: 'running' }),
      publicBaseUrl: 'https://video.example.com',
    });
    await expect(running('task-ref-1')).resolves.toEqual({ ok: false, reason: 'no_output' });
  });

  it('未配 PUBLIC_BASE_URL → no_public_base（视频没有 data URL 退路）', async () => {
    const resolve = createTaskVideoUrlResolver({
      store: makeStore(succeededRecord('/media/task-ref-1.mp4')),
    });
    await expect(resolve('task-ref-1')).resolves.toEqual({ ok: false, reason: 'no_public_base' });
  });

  // S9 修正（真机全链路实测暴露）：t2i 任务的产物在 outputImageUrl——i2v 首帧引用图片任务必须可用
  it('t2i 任务（只有 outputImageUrl）→ 返回图片地址，不判 no_output', async () => {
    const imageRecord: TaskRecord = {
      ...succeededRecord(),
      outputVideoUrl: undefined,
      outputImageUrl: '/media/28028f63.png',
    };
    const resolve = createTaskVideoUrlResolver({
      store: makeStore(imageRecord),
      publicBaseUrl: 'http://127.0.0.1:3100',
    });
    await expect(resolve('task-ref-1')).resolves.toEqual({
      ok: true,
      url: 'http://127.0.0.1:3100/media/28028f63.png',
    });
  });

  it('视频与图片并存时优先视频（i2v 参考视频语义不变）', async () => {
    const both: TaskRecord = {
      ...succeededRecord('/media/clip.mp4'),
      outputImageUrl: '/media/first-frame.png',
    };
    const resolve = createTaskVideoUrlResolver({
      store: makeStore(both),
      publicBaseUrl: 'http://127.0.0.1:3100',
    });
    await expect(resolve('task-ref-1')).resolves.toEqual({
      ok: true,
      url: 'http://127.0.0.1:3100/media/clip.mp4',
    });
  });
});

/**
 * V2.78 修正：资产目录里同时存在 `<id>.png` 与 `<id>.json`（sidecar），
 * 解析器**必须拿到媒体文件** —— 早先用 `startsWith('<id>.')` 会随机命中 sidecar。
 * 实测症状：局部重绘把 83 字节的 `{"name":"mask.png",…}` 当图片发给 ComfyUI，
 * 上游报 `cannot identify image file`。
 */
describe('参考资产 URL 解析（侧车文件不能当成资产）', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const makeAssetsDir = (): string => {
    const dir = mkdtempSync(path.join(tmpdir(), 'astrmira-assets-'));
    dirs.push(dir);
    return dir;
  };

  it('同名 sidecar 存在时仍返回 PNG（不是 .json）', async () => {
    const dir = makeAssetsDir();
    const assetId = '625b0f3d-b042-4013-90c8-1d130d576633';
    // 故意让 .json 排在前面（readdir 顺序在不同机器上不一样，这里把"最坏顺序"钉死）
    writeFileSync(path.join(dir, `${assetId}.json`), '{"name":"mask.png"}');
    writeFileSync(path.join(dir, `${assetId}.png`), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const resolve = createAssetUrlResolver({ assetsDir: dir, publicBaseUrl: 'http://127.0.0.1:3100' });
    await expect(resolve(assetId)).resolves.toBe(
      `http://127.0.0.1:3100/media/assets/${assetId}.png`,
    );
  });

  it('只有 sidecar、没有媒体文件 → null（不把 JSON 当资产）', async () => {
    const dir = makeAssetsDir();
    const assetId = 'no-media-1';
    writeFileSync(path.join(dir, `${assetId}.json`), '{}');

    const resolve = createAssetUrlResolver({ assetsDir: dir });
    await expect(resolve(assetId)).resolves.toBeNull();
  });
});
