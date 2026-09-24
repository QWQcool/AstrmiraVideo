import React, { useRef, useState } from 'react';
import type { TaskProgress } from '@astrmira/shared';
import { resolveMediaUrl } from '../lib/api';
import {
  DEFAULT_TRANSITION_FRAMES,
  TRACK_KIND_LABELS,
  clipEndFrame,
  findClip,
  previewDurationFrames,
  type EditClipSource,
} from './model';
import { probeVideoMeta } from './mediaProbe';
import { seekToFrame } from './playerRef';
import type { EditStore } from './store';
import { MAX_PX_PER_FRAME, MIN_PX_PER_FRAME, useEditStore } from './store';
import { formatTimecode } from './time';
import { TimelineClip } from './TimelineClip';

/**
 * 时间轴（B34 · P1 建，P3 扩展到四轨）。
 *
 * - 轨道行按模型顺序渲染（镜头 / 转场 / 字幕 / 音效），**空轨也显示**（否则不知道往哪加）；
 * - 轨道头固定 120px，右侧内容区宽度 = 时长 × 缩放（pxPerFrame），横向滚动；
 * - 播放头竖线是**唯一订阅 playheadFrame 的时间轴组件**；
 * - 工具栏：素材下拉（加镜头/音效）、＋字幕、＋转场（需选中视频片段）、删除、适配、缩放。
 */

const HEADER_W = 120;

/** 标尺刻度步长（帧）：从密到疏试，取第一个「间隔 ≥ 56px」的档位 */
function rulerStepFrames(ppf: number, fps: number): number {
  const seconds = [0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60];
  for (const sec of seconds) {
    const frames = Math.max(1, Math.round(sec * fps));
    if (frames * ppf >= 56) return frames;
  }
  return 60 * fps;
}

/** 标尺：点击 / 拖动 = 移动播放头（同时驱动 Player seek） */
const Ruler: React.FC<{ store: EditStore; durationFrames: number }> = ({ store, durationFrames }) => {
  const ppf = useEditStore(store, (s) => s.pxPerFrame);
  const fps = useEditStore(store, (s) => s.project.fps);
  const rulerRef = useRef<HTMLDivElement>(null);

  const seekFromPointer = (clientX: number): void => {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    const frame = Math.max(0, Math.round((clientX - rect.left) / store.getState().pxPerFrame));
    seekToFrame(frame);
    store.setPlayhead(frame);
  };

  const onPointerDown = (event: React.PointerEvent): void => {
    if (event.button !== 0) return;
    seekFromPointer(event.clientX);
    const onMove = (moveEvent: PointerEvent): void => seekFromPointer(moveEvent.clientX);
    const onUp = (): void => window.removeEventListener('pointermove', onMove);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };

  const step = rulerStepFrames(ppf, fps);
  const ticks: number[] = [];
  for (let frame = 0; frame <= durationFrames; frame += step) ticks.push(frame);

  // 刻意不做 role="slider"：播放头的高频更新只进 PlayheadLine（性能纪律），
  // 标尺不订阅它 —— aria-valuenow 若挂在标尺上必然过期，比没有更糟。
  return (
    <div
      ref={rulerRef}
      className="ed-ruler"
      onPointerDown={onPointerDown}
      title="点击 / 拖动移动播放头"
    >
      {ticks.map((frame) => (
        <span key={frame} className="ed-ruler-tick" style={{ left: frame * ppf }}>
          {formatTimecode(frame, fps)}
        </span>
      ))}
    </div>
  );
};

/** 播放头竖线：唯一订阅 playheadFrame 的时间轴组件（播放中每帧只动它） */
const PlayheadLine: React.FC<{ store: EditStore }> = ({ store }) => {
  const playhead = useEditStore(store, (s) => s.playheadFrame);
  const ppf = useEditStore(store, (s) => s.pxPerFrame);
  return (
    <div className="ed-playhead" style={{ left: HEADER_W + playhead * ppf }}>
      <div className="ed-playhead-cap" />
    </div>
  );
};

export const Timeline: React.FC<{
  store: EditStore;
  /** 可作为素材的成片（已成功且有产物；含源片自己 —— 同一片多次入场是合法剪辑手法） */
  candidates: TaskProgress[];
}> = ({ store, candidates }) => {
  const project = useEditStore(store, (s) => s.project);
  const ppf = useEditStore(store, (s) => s.pxPerFrame);
  const selectedClipId = useEditStore(store, (s) => s.selectedClipId);

  const [pendingTaskId, setPendingTaskId] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const duration = previewDurationFrames(project);
  const contentW = Math.ceil(duration * ppf) + 120;

  const clipCount = project.tracks.reduce((sum, track) => sum + track.clips.length, 0);

  /** 选中视频片段且后面有紧贴的邻居 → 允许加转场 */
  const transitionTarget = (() => {
    if (selectedClipId === null) return null;
    const found = findClip(project, selectedClipId);
    if (found === null || found.clip.kind !== 'video' || found.track.kind !== 'video') return null;
    const next = found.track.clips
      .filter((clip) => clip.kind === 'video' && clip.id !== found.clip.id)
      .sort((a, b) => a.startFrame - b.startFrame)
      .find((clip) => clip.startFrame >= clipEndFrame(found.clip));
    if (next === undefined || next.startFrame !== clipEndFrame(found.clip)) return null;
    return found.clip.id;
  })();

  const fit = (): void => {
    const width = scrollerRef.current?.clientWidth;
    if (width === undefined || width <= HEADER_W + 80) return;
    store.setZoom((width - HEADER_W - 80) / duration);
  };

  const resolveTask = (taskId: string): { task: TaskProgress; url: string } | null => {
    const task = candidates.find((item) => item.taskId === taskId);
    const url = resolveMediaUrl(task?.outputVideoUrl);
    return task === undefined || url === null ? null : { task, url };
  };

  const addFromTask = async (mode: 'video' | 'audio'): Promise<void> => {
    const resolved = resolveTask(pendingTaskId);
    if (resolved === null) return;
    setAdding(true);
    setAddError(null);
    try {
      const meta = await probeVideoMeta(resolved.url, project.fps);
      const source: EditClipSource = {
        taskId: resolved.task.taskId,
        url: resolved.url,
        durationFrames: meta.durationFrames,
      };
      if (mode === 'video') {
        store.addClip(source);
      } else {
        store.addAudio(source);
      }
    } catch (caught) {
      setAddError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="ed-timeline">
      <div className="ed-tl-toolbar">
        <select
          className="wb-input ed-tl-pick"
          value={pendingTaskId}
          aria-label="选择要添加的素材"
          onChange={(event) => setPendingTaskId(event.target.value)}
        >
          <option value="">选择素材…</option>
          {candidates.map((item) => (
            <option key={item.taskId} value={item.taskId}>
              {item.origin?.kind === 'edit' ? '✂ ' : ''}
              {item.taskId.slice(0, 8)} · {item.requestSnapshot.prompt.slice(0, 16)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="wb-btn"
          disabled={pendingTaskId === '' || adding}
          onClick={() => void addFromTask('video')}
        >
          {adding ? '读取素材…' : '＋镜头'}
        </button>
        <button
          type="button"
          className="wb-btn"
          disabled={pendingTaskId === '' || adding}
          title="把素材里的音频作为音效轨片段（不显示画面）"
          onClick={() => void addFromTask('audio')}
        >
          ＋音效
        </button>
        <span className="ed-tl-sep" />
        <button
          type="button"
          className="wb-btn"
          title="在播放头处添加一条字幕（默认 2s）"
          onClick={() => store.addCaption()}
        >
          ＋字幕
        </button>
        <button
          type="button"
          className="wb-btn"
          disabled={transitionTarget === null}
          title={
            transitionTarget === null
              ? '先选中一个视频片段（它后面要有首尾相接的下一段）'
              : '在选中片段与下一段之间加转场（默认 0.5s，可在属性面板改类型与时长）'
          }
          onClick={() => store.addTransitionAfterSelected('fade', DEFAULT_TRANSITION_FRAMES)}
        >
          ＋转场
        </button>
        <button
          type="button"
          className="wb-btn"
          disabled={selectedClipId === null}
          title="删除选中片段（Delete）"
          onClick={() => selectedClipId !== null && store.removeClip(selectedClipId)}
        >
          🗑 删除片段
        </button>
        <span className="ed-tl-sep" />
        <span className="ed-tl-note">
          {clipCount} 个片段 · 总长 {formatTimecode(duration, project.fps)}
        </span>
        <span style={{ marginLeft: 'auto' }} />
        <button type="button" className="wb-btn" onClick={fit} title="缩放到适配全部内容">
          ⤢ 适配
        </button>
        <span className="ed-tl-note">缩放</span>
        <input
          type="range"
          className="ed-tl-zoom"
          min={MIN_PX_PER_FRAME}
          max={MAX_PX_PER_FRAME}
          step={0.1}
          value={ppf}
          aria-label="时间轴缩放"
          onChange={(event) => store.setZoom(Number(event.target.value))}
        />
      </div>

      {addError === null ? null : <p className="ed-tl-error">{addError}</p>}

      <div className="ed-tl-scroller" ref={scrollerRef}>
        <div className="ed-tl-content" style={{ width: contentW + HEADER_W }}>
          <div className="ed-ruler-row">
            <div className="ed-tl-corner" style={{ width: HEADER_W }} />
            <Ruler store={store} durationFrames={duration} />
          </div>

          {project.tracks.map((track) => (
            <div className="ed-track-row" key={track.id} data-track-kind={track.kind}>
              <div className="ed-track-head" style={{ width: HEADER_W }}>
                <span className="ed-track-name">{TRACK_KIND_LABELS[track.kind]}</span>
                <span className="ed-track-count">{track.clips.length}</span>
              </div>
              <div
                className={`ed-lane ed-lane-${track.kind}`}
                style={{ width: contentW }}
                onPointerDown={() => store.select(null)}
              >
                {track.clips.map((clip) => (
                  <TimelineClip key={clip.id} store={store} clip={clip} />
                ))}
              </div>
            </div>
          ))}

          <PlayheadLine store={store} />
        </div>
      </div>
    </div>
  );
};
