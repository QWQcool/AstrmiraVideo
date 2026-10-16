import React, { useRef, useState } from 'react';
import type { AssetListEntry, TaskProgress } from '@astrmira/shared';
import { resolveMediaUrl } from '../lib/api';
import { getLanguage, translate } from '../lib/i18n';
import {
  DEFAULT_TRANSITION_FRAMES,
  TRACK_KIND_KEYS,  clipEndFrame,
  findClip,
  previewDurationFrames,
  type EditClipSource,
} from './model';
import { probeAudioDurationFrames, probeVideoMeta } from './mediaProbe';
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
 * - 工具栏：素材下拉（加镜头/音效）、{translate(getLanguage(), 'edit.tl.add.caption.label')}、{translate(getLanguage(), 'edit.tl.add.transition.label')}（需选中视频片段）、删除、适配、缩放。
 *
 * V2.10（台账 B57）：素材下拉分两组 —— **成片**（value = 裸 taskId，与既有行为/断言一致）
 * 与**音频素材**（value = `asset:<assetId>`，来自 `GET /api/assets` 的 kind=audio）。
 * 音频素材只能进音效轨（＋镜头对它置灰并给出原因），音效轨片段带淡入淡出。
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
      title={translate(getLanguage(), 'edit.tl.playhead.title')}
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

/** 音频素材在素材下拉里的 value 前缀（成片仍用裸 taskId，避免改动既有断言与草稿） */
const ASSET_VALUE_PREFIX = 'asset:';

export const Timeline: React.FC<{
  store: EditStore;
  /** 可作为素材的成片（已成功且有产物；含源片自己 —— 同一片多次入场是合法剪辑手法） */
  candidates: TaskProgress[];
  /** V2.10（台账 B57）：上传的**音频素材**（`GET /api/assets` 里 kind=audio 的那些） */
  audioAssets: AssetListEntry[];
}> = ({ store, candidates, audioAssets }) => {
  const project = useEditStore(store, (s) => s.project);
  const ppf = useEditStore(store, (s) => s.pxPerFrame);
  const selectedClipId = useEditStore(store, (s) => s.selectedClipId);

  const [pendingValue, setPendingValue] = useState('');
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

  /** 下拉里的选中项 → 可添加的素材（成片或音频资产）；两者都解析不出 URL 时返回 null */
  const resolveSelection = (
    value: string,
  ): { kind: 'task' | 'asset'; url: string; label: string; source: Omit<EditClipSource, 'durationFrames'> } | null => {
    if (value.startsWith(ASSET_VALUE_PREFIX)) {
      const assetId = value.slice(ASSET_VALUE_PREFIX.length);
      const asset = audioAssets.find((item) => item.assetId === assetId);
      const url = resolveMediaUrl(asset?.url);
      if (asset === undefined || url === null) return null;
      return {
        kind: 'asset',
        url,
        label: asset.name ?? asset.assetId.slice(0, 8),
        // 资产来源没有 taskId：硬塞一个是伪造溯源（CONTRACT §11-2 的 EditClipSource）
        source: {
          assetId: asset.assetId,
          url,
          ...(asset.name === undefined ? {} : { name: asset.name }),
        },
      };
    }

    const task = candidates.find((item) => item.taskId === value);
    const url = resolveMediaUrl(task?.outputVideoUrl);
    if (task === undefined || url === null) return null;
    return { kind: 'task', url, label: task.taskId.slice(0, 8), source: { taskId: task.taskId, url } };
  };

  const selectedIsAudioAsset = pendingValue.startsWith(ASSET_VALUE_PREFIX);

  const addFromSelection = async (mode: 'video' | 'audio'): Promise<void> => {
    const resolved = resolveSelection(pendingValue);
    if (resolved === null) return;
    if (mode === 'video' && resolved.kind === 'asset') {
      // 音频素材只能进音效轨 —— 说清楚而不是静默忽略（不静默降级）
      setAddError(translate(getLanguage(), 'edit.tl.error.audioOnly'));
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      // 音频只要时长（`<video>` 元素同样能给音频的 duration）；视频仍走 probeVideoMeta
      const durationFrames =
        mode === 'audio' && resolved.kind === 'asset'
          ? await probeAudioDurationFrames(resolved.url, project.fps)
          : (await probeVideoMeta(resolved.url, project.fps)).durationFrames;
      const source: EditClipSource = { ...resolved.source, durationFrames };
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
          value={pendingValue}
          aria-label={translate(getLanguage(), 'edit.tl.pick.aria')}
          onChange={(event) => setPendingValue(event.target.value)}
        >
          <option value="">{translate(getLanguage(), 'edit.tl.pick.placeholder')}</option>
          {/* V2.10：成片与音频素材分组；成片的 value 仍是裸 taskId（既有断言与草稿不受影响） */}
          <optgroup label={translate(getLanguage(), 'edit.tl.pick.groupClips')}>
            {candidates.map((item) => (
              <option key={item.taskId} value={item.taskId}>
                {item.origin?.kind === 'edit' ? '✂ ' : ''}
                {item.taskId.slice(0, 8)} · {item.requestSnapshot.prompt.slice(0, 16)}
              </option>
            ))}
          </optgroup>
          {audioAssets.length === 0 ? null : (
            <optgroup label={translate(getLanguage(), 'edit.tl.pick.groupAudio')}>
              {audioAssets.map((asset) => (
                <option key={asset.assetId} value={`${ASSET_VALUE_PREFIX}${asset.assetId}`}>
                  🎵 {asset.name ?? asset.assetId.slice(0, 8)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button
          type="button"
          className="wb-btn"
          disabled={pendingValue === '' || adding || selectedIsAudioAsset}
          title={
            selectedIsAudioAsset
              ? translate(getLanguage(), 'edit.tl.error.audioNotVideo')
              : translate(getLanguage(), 'edit.tl.add.clip.title')
          }
          onClick={() => void addFromSelection('video')}
        >
          {adding ? translate(getLanguage(), 'edit.tl.add.clip.loading') : translate(getLanguage(), 'edit.tl.add.clip.label')}
        </button>
        <button
          type="button"
          className="wb-btn"
          disabled={pendingValue === '' || adding}
          title={translate(getLanguage(), 'edit.tl.add.audio.title')}
          onClick={() => void addFromSelection('audio')}
        >
          {translate(getLanguage(), 'edit.tl.add.audio.label')}
        </button>
        <span className="ed-tl-sep" />
        <button
          type="button"
          className="wb-btn"
          title={translate(getLanguage(), 'edit.tl.add.caption.title')}
          onClick={() => store.addCaption()}
        >
          {translate(getLanguage(), 'edit.tl.add.caption.label')}
        </button>
        <button
          type="button"
          className="wb-btn"
          disabled={transitionTarget === null}
          title={
            transitionTarget === null
              ? translate(getLanguage(), 'edit.tl.add.transition.needClip')
              : translate(getLanguage(), 'edit.tl.add.transition.title')
          }
          onClick={() => store.addTransitionAfterSelected('fade', DEFAULT_TRANSITION_FRAMES)}
        >
          {translate(getLanguage(), 'edit.tl.add.transition.label')}
        </button>
        <button
          type="button"
          className="wb-btn"
          disabled={selectedClipId === null}
          title={translate(getLanguage(), 'edit.tl.remove.title')}
          onClick={() => selectedClipId !== null && store.removeClip(selectedClipId)}
        >
          {translate(getLanguage(), 'edit.tl.remove.label')}
        </button>
        <span className="ed-tl-sep" />
        <span className="ed-tl-note">
          {translate(getLanguage(), 'edit.tl.summary', { count: clipCount, time: formatTimecode(duration, project.fps) })}
        </span>
        <span style={{ marginLeft: 'auto' }} />
        <button type="button" className="wb-btn" onClick={fit} title={translate(getLanguage(), 'edit.tl.fit.title')}>
          {translate(getLanguage(), 'edit.tl.fit.label')}
        </button>
        <span className="ed-tl-note">{translate(getLanguage(), 'edit.tl.zoom')}</span>
        <input
          type="range"
          className="ed-tl-zoom"
          min={MIN_PX_PER_FRAME}
          max={MAX_PX_PER_FRAME}
          step={0.1}
          value={ppf}
          aria-label={translate(getLanguage(), 'edit.tl.zoom.aria')}
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
                <span className="ed-track-name">{translate(getLanguage(), TRACK_KIND_KEYS[track.kind])}</span>
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
