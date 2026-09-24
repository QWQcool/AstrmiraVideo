/**
 * 剪辑台（Remotion 改版，PLAN §9 台账 B34）的时间工具。
 *
 * 时间基约定：**工程内部一切时间量都是「工程帧」**（`project.fps` 下的帧序号），
 * 与 Remotion 的 `Sequence from` / `<Video trimBefore>` 是同一单位 ——
 * 预览（@remotion/player）与导出（@remotion/web-renderer）因此天然逐帧一致。
 * 秒只出现在 UI 文案边界（时间码、提示语）。
 */

export function secondsToFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

export function framesToSeconds(frames: number, fps: number): number {
  return frames / fps;
}

/** 时间码 `mm:ss.ff`（ff = 秒内帧序号，两位补零） */
export function formatTimecode(frames: number, fps: number): string {
  const safeFps = Math.max(1, fps);
  const totalSeconds = Math.floor(frames / safeFps);
  const mm = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const ss = (totalSeconds % 60).toString().padStart(2, '0');
  const ff = (frames % safeFps).toString().padStart(2, '0');
  return `${mm}:${ss}.${ff}`;
}
