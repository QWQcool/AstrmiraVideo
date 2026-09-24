import React from 'react';
import {
  EDIT_TRANSITION_LABELS,
  applySnap,
  clipEndFrame,
  clipGeometry,
  collectSnapTargets,
  type EditClip,
} from './model';
import type { EditStore } from './store';
import { useEditStore } from './store';

/**
 * 时间轴上的 clip 块（B34 · P1 建，P3 泛化到四类轨道）。
 *
 * 交互模式借鉴 video-shotcraft 的 ClipView（Apache-2.0，自研零第三方拖拽库）：
 * - pointerdown 后把 move/up 挂到 `window`（拖出 clip 区域不丢手势）；
 * - 拖动吸附：0 点 / 播放头 / 其他 clip 首尾，容差 6 屏幕像素换算成帧；
 * - 裁剪：左缘动起点与裁入点、右缘动时长，约束全在 `model.trimClip`（纯函数），
 *   拖拽以其**起点处的几何快照**为基准（增量钳制会累积误差）。
 *
 * P3 起 **转场块是不可拖动的**：它的位置由两端片段（和时长）决定，
 * 拖动它没有语义 —— 点击选中后在属性面板改类型/时长。
 */

const SNAP_PX = 6;

export const TimelineClip: React.FC<{
  store: EditStore;
  clip: EditClip;
}> = ({ store, clip }) => {
  const ppf = useEditStore(store, (s) => s.pxPerFrame);
  const fps = useEditStore(store, (s) => s.project.fps);
  const selected = useEditStore(store, (s) => s.selectedClipId === clip.id);

  const movable = clip.kind !== 'transition';

  const onBodyDown = (event: React.PointerEvent): void => {
    if (event.button !== 0) return;
    event.stopPropagation();
    store.select(clip.id);
    if (!movable) return;
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
    if (!movable) return;
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

  const durationSec = (clip.durationFrames / fps).toFixed(1);

  let label: string;
  switch (clip.kind) {
    case 'video':
      label = clip.label ?? clip.source.taskId.slice(0, 8);
      break;
    case 'caption':
      label = clip.text;
      break;
    case 'audio':
      label = clip.source.taskId.slice(0, 8);
      break;
    case 'transition':
      label = EDIT_TRANSITION_LABELS[clip.transition];
      break;
  }

  return (
    <div
      className={`ed-clip ed-clip-${clip.kind}${selected ? ' selected' : ''}${movable ? '' : ' ed-clip-locked'}`}
      data-clip-id={clip.id}
      data-clip-kind={clip.kind}
      data-start-frame={clip.startFrame}
      data-duration-frames={clip.durationFrames}
      data-transition={clip.kind === 'transition' ? clip.transition : undefined}
      style={{ left: clip.startFrame * ppf, width: Math.max(8, clip.durationFrames * ppf) }}
      onPointerDown={onBodyDown}
    >
      <div className="ed-clip-label">
        <span className="ed-clip-name">{label}</span>
        <span className="ed-clip-meta">
          {durationSec}s
          {clip.kind === 'video' && clip.speed !== 1 ? <em className="ed-badge">×{clip.speed}</em> : null}
          {clip.kind === 'video' && clip.trimStartFrames > 0 ? (
            <em className="ed-badge">✂{(clip.trimStartFrames / fps).toFixed(1)}s</em>
          ) : null}
          {clip.kind === 'video' && clip.volume !== 1 ? (
            <em className="ed-badge">{clip.volume === 0 ? '静音' : `音量×${clip.volume}`}</em>
          ) : null}
          {clip.kind === 'audio' && clip.volume !== 1 ? (
            <em className="ed-badge">{clip.volume === 0 ? '静音' : `音量×${clip.volume}`}</em>
          ) : null}
          {clip.kind === 'caption' && clip.preset !== 'plain' ? <em className="ed-badge">动效</em> : null}
        </span>
      </div>
      {movable ? (
        <>
          <div className="ed-trim ed-trim-l" onPointerDown={onTrimDown('left')} />
          <div className="ed-trim ed-trim-r" onPointerDown={onTrimDown('right')} />
        </>
      ) : null}
    </div>
  );
};

/** 供时间轴计算轨道内容宽度等使用（避免各组件重复实现） */
export function trackContentEnd(clips: readonly EditClip[]): number {
  return clips.reduce((end, clip) => Math.max(end, clipEndFrame(clip)), 0);
}
