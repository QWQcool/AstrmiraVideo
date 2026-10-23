import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TaskProgress } from '@astrmira/shared';
import { withOutputFileFacts } from './storageUsage.js';

/**
 * 落盘事实投影（CONTRACT §4：V2.3 补体积 / **V2.8 补"文件不存在"**）。
 *
 * 这条纪律的意义：**不填一个必然 404 的直链**。容量淘汰（B22）之后，
 * 任务记录仍在、文件已不在——若照旧返回 `/media/xxx.mp4`，画廊会渲染出一个
 * 永远播不出来的播放器，用户看到的是"坏了"而不是"成片已清理"。
 */

let outputsDir: string;

function task(partial: Partial<TaskProgress> & { taskId: string }): TaskProgress {
  return {
    status: 'succeeded',
    progressPercent: 100,
    requestSnapshot: {
      prompt: 'x',
      mode: 't2v',
      aspectRatio: '16:9',
      provider: 'fixture-local',
    },
    createdAt: 1,
    ...partial,
  };
}

beforeAll(async () => {
  outputsDir = await mkdtemp(path.join(tmpdir(), 'astrmira-facts-'));
  await mkdir(path.join(outputsDir, 'thumbs'), { recursive: true });
  await mkdir(path.join(outputsDir, 'assets'), { recursive: true });
  await writeFile(path.join(outputsDir, 'has.mp4'), Buffer.alloc(2048));
  await writeFile(path.join(outputsDir, 'thumbs', 'has.jpg'), Buffer.alloc(64));
  // 有成片但**没有**缩略图的样本（抽帧失败 / 旧记录）
  await writeFile(path.join(outputsDir, 'no-thumb.mp4'), Buffer.alloc(512));
  // P3/P4：导入资产落在 outputs/assets/，不能按根目录误判“文件不存在”
  await writeFile(path.join(outputsDir, 'assets', 'import.png'), Buffer.alloc(333));
  await writeFile(path.join(outputsDir, 'thumbs', 'import.jpg'), Buffer.alloc(32));
});

afterAll(async () => {
  await rm(outputsDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe('withOutputFileFacts（V2.8）', () => {
  it('文件都在 → 补 outputSizeBytes，两个直链原样保留', async () => {
    const result = await withOutputFileFacts(
      task({
        taskId: 'has',
        outputVideoUrl: '/media/has.mp4',
        thumbnailUrl: '/media/thumbs/has.jpg',
      }),
      outputsDir,
    );

    expect(result.outputSizeBytes).toBe(2048);
    expect(result.outputVideoUrl).toBe('/media/has.mp4');
    expect(result.thumbnailUrl).toBe('/media/thumbs/has.jpg');
  });

  it('成片文件不在（容量淘汰后）→ 省略 outputVideoUrl 与缺失的 thumbnailUrl', async () => {
    const result = await withOutputFileFacts(
      task({
        taskId: 'evicted',
        outputVideoUrl: '/media/evicted.mp4',
        thumbnailUrl: '/media/thumbs/evicted.jpg',
      }),
      outputsDir,
    );

    expect(result.outputVideoUrl).toBeUndefined();
    expect(result.thumbnailUrl).toBeUndefined();
    expect(result.outputSizeBytes).toBeUndefined();
    // 任务本身没被改动（返回的是新对象，调用方的记录不受影响）
    expect(result.taskId).toBe('evicted');
  });

  it('导入资产在 outputs/assets/：保留 /media/assets 直链与 assetId 缩略图', async () => {
    const result = await withOutputFileFacts(
      task({
        taskId: 'import-task',
        outputImageUrl: '/media/assets/import.png',
        thumbnailUrl: '/media/thumbs/import.jpg',
      }),
      outputsDir,
    );
    expect(result.outputImageUrl).toBe('/media/assets/import.png');
    expect(result.thumbnailUrl).toBe('/media/thumbs/import.jpg');
    expect(result.outputSizeBytes).toBe(333);
  });

  it('缩略图单独缺失 → 只省略 thumbnailUrl（成片照常）', async () => {
    // 缩略图的存在性按**命名规则**判定：`outputs/thumbs/<taskId>.jpg`（V1.9）
    const result = await withOutputFileFacts(
      task({
        taskId: 'no-thumb',
        outputVideoUrl: '/media/no-thumb.mp4',
        thumbnailUrl: '/media/thumbs/no-thumb.jpg',
      }),
      outputsDir,
    );

    expect(result.outputVideoUrl).toBe('/media/no-thumb.mp4');
    expect(result.outputSizeBytes).toBe(512);
    expect(result.thumbnailUrl).toBeUndefined();
  });
});
