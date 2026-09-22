import { rm } from 'node:fs/promises';
import path from 'node:path';

/**
 * 防线 3（磁盘空间防护）：中间帧 / 临时音频目录 `outputs/.tmp/<taskId>/`
 * 在合成结束后**立即物理删除**。
 *
 * 注意：断言口径必须用「目录不存在」，不能用"日志里打印了已清理"——日志不是事实
 * （施工单 §12-7）。
 */

export function resolveTmpRoot(): string {
  const override = process.env.OUTPUT_DIR;
  const base =
    typeof override === 'string' && override.trim() !== ''
      ? override.trim()
      : path.join(process.cwd(), 'outputs');
  return path.join(base, '.tmp');
}

export function taskTmpDir(taskId: string, tmpRoot: string = resolveTmpRoot()): string {
  return path.join(tmpRoot, taskId);
}

/** 幂等清理：目录不存在也算成功 */
export async function cleanupTaskTemp(
  taskId: string,
  tmpRoot: string = resolveTmpRoot(),
): Promise<void> {
  await rm(taskTmpDir(taskId, tmpRoot), { recursive: true, force: true });
}
