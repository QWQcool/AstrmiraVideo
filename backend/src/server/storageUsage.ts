import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { StorageUsage, TaskProgress } from '@astrmira/shared';

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

/** 读一次输出目录占用（成片 + 缩略图 + 参考资产） */
export async function readStorageUsage(outputsDir: string): Promise<StorageUsage> {
  const [videos, thumbs, assets] = await Promise.all([
    sumDir(outputsDir, (name) => name.endsWith('.mp4')),
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

/**
 * 给单条任务补上成片体积（`TaskProgress.outputSizeBytes`，CONTRACT §4 V2.3）。
 *
 * 契约口径：**文件已清理时省略该字段**（不填 0 —— 0 会被读成"空文件"，那是在撒谎）。
 * `toTaskProgress` 保持纯映射（零 IO），补体积这件事在路由层显式做一次。
 */
export async function withOutputSize(task: TaskProgress, outputsDir: string): Promise<TaskProgress> {
  const url = task.outputVideoUrl;
  if (url === undefined || url === '') return task;

  try {
    const info = await stat(path.join(outputsDir, path.basename(url)));
    if (!info.isFile()) return task;
    return { ...task, outputSizeBytes: info.size };
  } catch {
    return task;
  }
}
