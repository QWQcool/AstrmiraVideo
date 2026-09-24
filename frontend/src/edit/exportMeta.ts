import { contentEndFrame, type EditProject } from './model';

/**
 * 导出语义的纯函数（B34 · P2）——刻意与 `exporter.ts`（重桥接，import web-renderer）分开，
 * 这样「导出多长 / 叫什么名」这两条口径可以在**不加载 Remotion**的前提下单测。
 */

/**
 * 导出时长（帧）：**内容精确结束帧**，不含预览的 1s 编辑余量。
 *
 * 为什么与预览不同：预览时长（`previewDurationFrames`）= 内容末尾 + 1s 余量、最短 5s，
 * 是给剪辑留呼吸空间的；导出带上这段余量 = 成片尾部多 1s 黑屏。
 * 两者共用同一个 composition —— 导出只是预览时间轴上的一段**前缀**（逐帧一致）。
 */
export function exportDurationFrames(project: EditProject): number {
  return Math.max(1, contentEndFrame(project));
}

/**
 * 导出文件名：`astrmira-edit-<源片8位>-<时间戳>.mp4`。
 * 时间戳取 UTC（与文件名里的一切一样，只用于去重与识别，不做时区承诺）。
 */
export function exportFileName(sourceTaskId: string | null, now: number): string {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\..+$/, ''); // YYYYMMDDTHHMMSS
  const source = sourceTaskId === null ? 'project' : sourceTaskId.slice(0, 8);
  return `astrmira-edit-${source}-${stamp}.mp4`;
}
