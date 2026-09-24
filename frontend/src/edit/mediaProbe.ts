/**
 * 素材元数据探测（B34 · P1）：用离屏 `<video preload="metadata">` 读真实时长与尺寸。
 *
 * 为什么必须探测而不是信请求参数：`TaskProgress.requestSnapshot.params.durationSec`
 * 是"请求时长"，不是成片事实（实测成片 5.09s vs 请求 5s）。裁剪上限必须以真实时长为准。
 * 探测失败如实报错（文件被清理 / 格式不支持），不做静默兜底。
 */

export interface ProbedVideoMeta {
  /** 真实时长换算成工程帧（四舍五入，至少 1 帧） */
  durationFrames: number;
  width: number;
  height: number;
}

export function probeVideoMeta(url: string, fps: number, timeoutMs = 15_000): Promise<ProbedVideoMeta> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;

    const cleanup = (): void => {
      window.clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      // 释放对媒体资源的引用（.detach：清空 src 并触发 load 释放 fetch）
      video.removeAttribute('src');
      video.load();
    };

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('读取素材元数据超时（素材可能已被清理或网络异常）'));
    }, timeoutMs);

    video.onloadedmetadata = () => {
      const meta: ProbedVideoMeta = {
        durationFrames: Math.max(1, Math.round(video.duration * fps)),
        width: video.videoWidth,
        height: video.videoHeight,
      };
      cleanup();
      resolve(meta);
    };

    video.onerror = () => {
      cleanup();
      reject(new Error('无法读取素材（文件可能已被清理，或浏览器不支持该编码）'));
    };

    video.src = url;
  });
}
