import { runMediaTool } from './ffmpeg.js';

/**
 * 探测媒体**尺寸**（B98 片 B：把"目标尺寸"变成"可核对的产物事实"）。
 *
 * 为什么不复用 `probeMedia`：那个函数要求 `format.duration` 可解析（它服务于视频拼接/时长校验），
 * 而**图片没有时长** —— 拿它探 PNG 会抛"未能解析时长"，测出来的是"这是张图"，不是尺寸。
 *
 * 这里只问 `stream=width,height`，视频与图片都能答；且**失败一律返回 null**：
 * 尺寸是"补充事实"，探不到不该让任务从 succeeded 变成 failed（那种处理会把好事变成坏事）。
 */
export async function probeMediaDimension(
  filePath: string,
): Promise<{ width: number; height: number } | null> {
  try {
    const { stdout } = await runMediaTool('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-print_format',
      'json',
      filePath,
    ]);
    const parsed = JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number }> };
    const stream = parsed.streams?.[0];
    const width = stream?.width;
    const height = stream?.height;
    if (typeof width !== 'number' || typeof height !== 'number') return null;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width, height };
  } catch {
    // 工具缺失、文件被淘汰、编码不认 —— 都当作"不知道"，不给推测值
    return null;
  }
}
