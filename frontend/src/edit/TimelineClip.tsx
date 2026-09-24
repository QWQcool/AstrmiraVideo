import React from 'react';
import {
  applySnap,
  clipGeometry,
  collectSnapTargets,
  type EditClip,
} from './model';
import type { EditStore } from './store';
import { useEditStore } from './store';

/**
 * 时间轴上的 clip 块（B34 · P1）。
 *
 * 交互模式借鉴 video-shotcraft 的 ClipView（Apache-2.0，自研零第三方拖拽库）：
 * - pointerdown 后把 move/up 挂到 `window`（拖出 clip 区域不丢手势）；
 * - 拖动吸附：0 点 / 播放头 / 其他 clip 首尾，容差 6 屏幕像素换算成帧；
 * - 裁剪：左缘动起点与裁入点、右缘动时长，约束全在 `model.trimClip`（纯函数），
 *   拖拽以其**起点处的几何快照**为基准（增量钳制会累积误差）。
 */

const SNAP_PX = 6;

export const TimelineClip: React.FC<{
  store: EditStore;
  clip: EditClip;
}> = ({ store, clip }) => {
  const ppf = useEditStore(store, (s) => s.pxPerFrame);
  const fps = useEditStore(store, (s) => s.project.fps);
  const selected = useEditStore(store, (s) => s.selectedClipId === clip.id);

  const onBodyDown = (event: React.PointerEvent): void => {
    if (event.button !== 0) return;
    event.stopPropagation();
    store.select(clip.id);
    const startX = event.clientX;
    const origStart = clip.startFrame;
    let moved = false;
    const onMove = (moveEvent: PointerEvent): void => {
      moved = true;
      const ppfNow = store.getState().pxPerFrame;
      const delta = Math.round((moveEvent.clientX - startX) / ppfNow);
      const snapped = applySnap(
        Math.max(0, origStart + delta),
        clip.durationFrames,
        collectSnapTargets(store.getState().project, clip.id, store.getState().playheadFrame),
        SNAP_PX / ppfNow,
      );
      store.moveClip(clip.id, Math.max(0, snapped));
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      if (!moved) return; // 纯点击 = 只选中，不动位置
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };

  const onTrimDown = (side: 'left' | 'right') => (event: React.PointerEvent): void => {
    if (event.button !== 0) return;
    event.stopPropagation();
    store.select(clip.id);
    const startX = event.clientX;
    // 拖拽基准快照：trimClip 的约束（源片时长 / 最短时长 / 0 点）都以它为原点计算
    const base = clipGeometry(clip);
    const onMove = (moveEvent: PointerEvent): void => {
      const ppfNow = store.getState().pxPerFrame;
      const delta = Math.round((moveEvent.clientX - startX) / ppfNow);
      store.trimClip(clip.id, side, delta, base);
    };
    const onUp = (): void => window.removeEventListener('pointermove', onMove);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };

  const durSec = (clip.durationFrames / fps).toFixed(1);
  const label =
    clip.kind === 'video'
      ? (clip.label ?? `${clip.source.taskId.slice(0, 8)}`)
      : clip.kind === 'caption'
        ? clip.text
        : clip.kind === 'audio'
          ? clip.source.taskId.slice(0, 8)
          : clip.transition;

  return (
    <div
      className={`ed-clip ed-clip-${clip.kind}${selected ? ' selected' : ''}`}
      data-clip-id={clip.id}
      data-start-frame={clip.startFrame}
      data-duration-frames={clip.durationFrames}
      style={{ left: clip.startFrame * ppf, width: Math.max(8, clip.durationFrames * ppf) }}
      onPointerDown={onBodyDown}
    >
      <div className="ed-clip-label">
        <span className="ed-clip-name">{label}</span>
        <span className="ed-clip-meta">
          {durSec}s
          {clip.kind === 'video' && clip.speed !== 1 ? <em className="ed-badge">×{clip.speed}</em> : null}
          {clip.kind === 'video' && clip.trimStartFrames > 0 ? (
            <em className="ed-badge">✂{(clip.trimStartFrames / fps).toFixed(1)}s</em>
          ) : null}
          {clip.kind === 'video' && clip.volume !== 1 ? (
            <em className="ed-badge">{clip.volume === 0 ? '静音' : `音量×${clip.volume}`}</em>
          ) : null}
        </span>
      </div>
      <div className="ed-trim ed-trim-l" onPointerDown={onTrimDown('left')} />
      <div className="ed-trim ed-trim-r" onPointerDown={onTrimDown('right')} />
    </div>
  );
};
