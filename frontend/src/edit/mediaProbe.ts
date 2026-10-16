/**
 * 素材元数据探测（B34 · P1）：用离屏 `<video preload="metadata">` 读真实时长与尺寸。
 *
 * 为什么必须探测而不是信请求参数：`TaskProgress.requestSnapshot.params.durationSec`
 * 是"请求时长"，不是成片事实（实测成片 5.09s vs 请求 5s）。裁剪上限必须以真实时长为准。
 * 探测失败如实报错（文件被清理 / 格式不支持），不做静默兜底。
 */

import { getLanguage, translate } from '../lib/i18n';

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
      reject(new Error(translate(getLanguage(), 'edit.probe.timeout')));
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
      reject(new Error(translate(getLanguage(), 'edit.probe.unreadable')));
    };

    video.src = url;
  });
}

/**
 * 音频素材的时长探测（V2.10 / 台账 B57）。
 *
 * 复用 `probeVideoMeta`：浏览器对**纯音频**资源同样会在 `<video>` 上触发 `loadedmetadata`
 * 并给出 `duration`（此时 `videoWidth/Height` 为 0，而音频只需要时长）。
 * 单独包一层是为了让调用点的意图明确 —— 也让"音频为什么要用 video 元素探测"这件事
 * 有一个带解释的落点（否则下一个维护者会以为是写错了元素）。
 */
export async function probeAudioDurationFrames(
  url: string,
  fps: number,
  timeoutMs = 15_000,
): Promise<number> {
  const meta = await probeVideoMeta(url, fps, timeoutMs);
  return meta.durationFrames;
}
