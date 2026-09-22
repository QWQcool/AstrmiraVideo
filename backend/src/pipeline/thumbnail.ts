import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { runMediaTool } from '../lib/ffmpeg.js';

/**
 * 成片首帧缩略图（V1.9）——画廊的 `poster`。
 *
 * ## 为什么要在服务端抽帧
 * 画廊原先用 `<video preload="metadata">` 当缩略图：50 条历史 = **50 个媒体元素**，
 * 每个都要发一次请求并解析 moov（206 也得先握手）。JPEG 首帧是一张图，浏览器可缓存、
 * 可懒加载，画廊滚动不再卡。抽帧本身只在任务成功时跑一次，成本一次性的。
 *
 * ## 三条边界
 * 1. **尽力而为**：抽帧失败（工具缺失 / 成片编码不可解码）只写日志，**不影响任务成功**
 *    —— 缩略图是体验优化，不是任务结果的一部分（`TaskProgress.thumbnailUrl` 可选）；
 * 2. **路径只由服务端生成**：输入取自 `/media/<taskId>.mp4` 的 basename，
 *    拒绝任何非 `/media/` 前缀与含 `..` 的值（与 `resolveMediaUrl` 同一套口径）；
 * 3. **失败不留半成品**：先删目标文件再抽帧，失败时再删一次（否则画廊会加载到 0 字节的图）。
 */

export const THUMBNAIL_DIR_NAME = 'thumbs';

/** 缩略图宽度：画廊卡片显示宽度 84px，480 足够 3 倍屏清晰，体积仍在数十 KB 级 */
const THUMBNAIL_WIDTH = 480;

/** 缩略图的同源直链（与成片一样落在 `outputs/` 下，由 `GET /media/*` 服务） */
export function thumbnailUrlOf(taskId: string): string {
  return `/media/${THUMBNAIL_DIR_NAME}/${taskId}.jpg`;
}

/**
 * `/media/<name>` → `outputs/` 内的绝对路径。
 * 非 `/media/` 前缀或含 `..` 一律返回 `null`（**不**接受任意 URL 当本地路径）。
 */
export function resolveLocalVideoPath(outputsDir: string, videoUrl: string): string | null {
  if (!videoUrl.startsWith('/media/')) return null;
  if (videoUrl.includes('..')) return null;

  const name = path.basename(videoUrl);
  if (name === '' || name === '.' || name === '..') return null;
  return path.join(outputsDir, name);
}

export interface CreateThumbnailOptions {
  outputsDir: string;
  taskId: string;
  /** provider 返回的同源直链（`/media/<taskId>.mp4`） */
  videoUrl: string;
}

/**
 * 抽首帧为 JPEG，返回同源直链。
 * @throws 抽帧失败时抛出（调用方负责降级 —— 见本文件头部第 1 条）
 */
export async function createTaskThumbnail(options: CreateThumbnailOptions): Promise<string> {
  const source = resolveLocalVideoPath(options.outputsDir, options.videoUrl);
  if (source === null) {
    throw new Error(`成片地址不是同源 /media/ 直链，跳过抽帧：${options.videoUrl}`);
  }

  const dir = path.join(options.outputsDir, THUMBNAIL_DIR_NAME);
  await mkdir(dir, { recursive: true });

  const target = path.join(dir, `${options.taskId}.jpg`);
  await rm(target, { force: true });

  try {
    await runMediaTool(
      'ffmpeg',
      [
        '-y',
        // 首帧足够代表这条片子；`-ss 0` 显式写出，避免日后有人以为漏了参数
        '-ss',
        '0',
        '-i',
        source,
        '-frames:v',
        '1',
        '-vf',
        `scale=${THUMBNAIL_WIDTH}:-2`,
        '-q:v',
        '5',
        target,
      ],
      { timeoutMs: 30_000 },
    );
  } catch (err) {
    await rm(target, { force: true });
    throw err;
  }

  return thumbnailUrlOf(options.taskId);
}
