import type { PlayerRef } from '@remotion/player';

/**
 * Player 实例的模块级引用（shotcraft 同款模式）。
 *
 * 为什么需要它：时间轴（主 bundle）要驱动预览（懒 chunk 里的 @remotion/player）
 * 的 seekTo / 播放暂停，但不想为了这个把 player 类型引进主 bundle ——
 * 本文件只用 `import type`（编译期擦除，零运行时依赖）。
 * 剪辑台单实例挂载（离开 `#/edit` 即卸载），所以模块级单引用是安全的。
 */

let current: PlayerRef | null = null;

export function setPlayerRef(ref: PlayerRef | null): void {
  current = ref;
}

export function seekToFrame(frame: number): void {
  current?.seekTo(frame);
}

export function togglePlayback(): void {
  if (current === null) return;
  if (current.isPlaying()) {
    current.pause();
  } else {
    current.play();
  }
}
