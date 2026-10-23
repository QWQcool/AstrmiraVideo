import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { StorageUsage, TaskProgress } from '@astrmira/shared';
import { THUMBNAIL_DIR_NAME } from '../pipeline/thumbnail.js';

/**
 * 输出目录的**目录级聚合**（CONTRACT §4 末尾，V2.3）。
 *
 * 为什么是"扫目录"而不是"把每条任务的体积加起来"：
 * 1. **老数据同样准确**：V2.3 之前的任务根本没有体积字段，逐条累加会长期偏小；
 * 2. **参考资产不属于任何单条任务**（`outputs/assets/` 会被多条任务复用，见 §7），
 *    只有目录才是它的"家"；
 * 3. **对账口径是命令行的**：用户在服务器上 `du -sb outputs/` 得到同一个数
 *    （Step 6-AC2 的"数字逐一可对账"要的就是这个）。
 *
 * 纪律：只读、无副作用、**不做缓存**（每次请求都是真实值——缓存会让"删了任务但数字没变"变得难解释，
 * 而这三个目录的扫描在本项目的规模下是毫秒级）。任何单项失败都降级为计 0，统计不该让接口 500。
 */

async function sumDir(
  dir: string,
  filter?: (name: string) => boolean,
): Promise<{ bytes: number; count: number }> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return { bytes: 0, count: 0 }; // 目录不存在 = 还没有产出
  }

  const targets = filter === undefined ? entries : entries.filter((name) => filter(name));
  const results = await Promise.all(
    targets.map(async (name) => {
      try {
        const info = await stat(path.join(dir, name));
        return info.isFile() ? info.size : 0;
      } catch {
        return 0; // 并发删除 / 权限问题：跳过该文件
      }
    }),
  );

  const bytes = results.reduce((sum, size) => sum + size, 0);
  return { bytes, count: results.filter((size) => size > 0).length };
}

/**
 * 成片类产物的扩展名（V2.40：**视频或图片**）。
 *
 * 为什么要扩到图片：`t2i` 任务的产物是 `<taskId>.png` —— 只认 `.mp4` 会让
 * "输出目录占用"漏掉图片，进而让容量淘汰的阈值判断偏小（该淘汰时不淘汰）。
 * 计数字段沿用既有的 `videoBytes` / `videoCount`（形状不变，老客户端零影响），
 * 语义在契约 §4 里补一句"**成片类产物**（视频或图片）"。
 */
const MEDIA_EXTENSIONS = ['.mp4', '.webm', '.mkv', '.mov', '.avi', '.png', '.jpg', '.jpeg', '.webp'];

/** 读一次输出目录占用（成片类产物 + 缩略图 + 参考资产） */
export async function readStorageUsage(outputsDir: string): Promise<StorageUsage> {
  const [videos, thumbs, assets] = await Promise.all([
    sumDir(outputsDir, (name) => MEDIA_EXTENSIONS.some((extension) => name.endsWith(extension))),
    sumDir(path.join(outputsDir, 'thumbs')),
    sumDir(path.join(outputsDir, 'assets')),
  ]);

  return {
    totalBytes: videos.bytes + thumbs.bytes + assets.bytes,
    videoBytes: videos.bytes,
    videoCount: videos.count,
    thumbBytes: thumbs.bytes,
    assetBytes: assets.bytes,
    assetCount: assets.count,
  };
}

async function sizeIfFile(file: string): Promise<number | null> {
  try {
    const info = await stat(file);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

/**
 * 给单条任务补上**落盘事实**（CONTRACT §4，V2.3 补体积 / V2.8 补"文件不存在"）：
 *
 * - 成片文件在 → `outputSizeBytes`（契约：**文件已清理时省略该字段**，不填 0——0 会被读成"空文件"）；
 * - 成片文件不在（容量淘汰 / 手动删过文件）→ **省略 `outputVideoUrl`**：给一个必然 404 的直链是撒谎，
 *   前端据"没有直链"渲染成"成片已清理"（V2.8，台账 B22 的一半）；
 * - 缩略图同理（文件不在 → 省略 `thumbnailUrl`，界面回落为无封面，而不是一张碎图）。
 *
 * `toTaskProgress` 保持纯映射（零 IO），这两件事在路由层显式做一次——调用点 = history 与 tasks 两条查询。
 */
/**
 * `/media/...` 同源直链 → outputs 下的实际文件。
 *
 * 生成任务在 outputs 根；上传/导入资产在 outputs/assets；
 * 不能一律用 basename 拼根目录，否则导入历史会被误判“文件不存在”。
 */
export function resolveOutputFilePath(outputsDir: string, url: string): string {
  const name = path.basename(url);
  if (url.startsWith('/media/assets/')) return path.join(outputsDir, 'assets', name);
  return path.join(outputsDir, name);
}

export async function withOutputFileFacts(
  task: TaskProgress,
  outputsDir: string,
): Promise<TaskProgress> {
  let next = task;

  // V2.40：产物可能是**视频或图片** —— 两条走同一套"文件在不在"的口径
  for (const field of ['outputVideoUrl', 'outputImageUrl'] as const) {
    const url = next[field];
    if (url === undefined || url === '') continue;
    const size = await sizeIfFile(resolveOutputFilePath(outputsDir, url));
    if (size === null) {
      next = { ...next };
      delete next[field];
    } else {
      next = { ...next, outputSizeBytes: size };
    }
  }

  const thumb = next.thumbnailUrl;
  if (thumb !== undefined && thumb !== '') {
    // 任务缩略图是 <taskId>.jpg；导入资产缩略图是 <assetId>.jpg —— 都按 URL basename。
    const size = await sizeIfFile(
      path.join(outputsDir, THUMBNAIL_DIR_NAME, path.basename(thumb)),
    );
    if (size === null) {
      next = { ...next };
      delete next.thumbnailUrl;
    }
  }

  return next;
}
