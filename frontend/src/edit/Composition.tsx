import React from 'react';
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from 'remotion';
import { Audio, Video } from '@remotion/media';
import {
  TRACK_RENDER_ORDER,
  transitionWindow,
  type AudioClip,
  type CaptionClip,
  type EditProject,
  type TransitionClip,
  type VideoClip,
} from './model';

/**
 * 剪辑台合成（B34）：把 `EditProject` 渲染成 Remotion TSX —— 预览与导出共用的唯一真相。
 *
 * 三条 P0/P2 实测约定（勿改）：
 * 1. **不用 `<OffthreadVideo>`**（web-renderer 不支持），一律 `@remotion/media` 的 `<Video>`；
 * 2. `<Video src>` 用**绝对 URL**（`mediaBaseUrl` 由调用方给 `location.origin`）；
 * 3. `trimBefore` / `trimAfter` 单位是**帧**（与模型的工程帧同口径）。
 *
 * P3 追加：
 * - **渲染层级由轨道类型决定**（`TRACK_RENDER_ORDER`：视频在下 → 字幕在上），
 *   不依赖 `tracks` 数组顺序（那是 UI 阅读顺序）；
 * - **转场**：窗口 = `[A.end - d, A.end]`，A 播它的最后 d 帧、B 播它的前 d 帧，
 *   两侧各按类型做过渡（与模型里的"左移 d"一起构成 WYSIWYG）；
 * - **字幕动效预设**：`wordSlide` / `typewriter` 的技法借鉴 video-shotcraft 的
 *   `demos/typography`（Apache-2.0，见 docs/UPSTREAM.md），文案与实现按我们的字幕场景重写。
 */

export interface EditCompositionProps {
  project: EditProject;
  /** 站点源（预览侧传 `window.location.origin`），用于把 `/media/*` 绝对化 */
  mediaBaseUrl: string;
}

function resolveClipUrl(mediaBaseUrl: string, url: string): string {
  return new URL(url, mediaBaseUrl).href;
}

/** easeOutCubic（与 shotcraft `demos/_fixtures/Motion.tsx` 的 E.outCubic 同形） */
function easeOutCubic(p: number): number {
  return 1 - Math.pow(1 - p, 3);
}

function segment(value: number, from: number, to: number, ease = easeOutCubic): number {
  if (value <= from) return 0;
  if (value >= to) return 1;
  return ease((value - from) / (to - from));
}

// ── 视频片段（含转场过渡） ────────────────────────────────────────────────

const FADE_WINDOW = 8;

interface TransitionStyle {
  opacity: number;
  clipPath: string | undefined;
  transform: string | undefined;
}

/**
 * 计算当前帧的过渡样式：
 * - `fade`：A 淡出、B 淡入；
 * - `wipeleft`（左揭幕）：A 从左侧被"揭开"（B 静态垫在下面）；
 * - `slideright`（右滑入）：B 从左侧滑入。
 * 非窗口期返回全不透明 + 无变换。
 */
function transitionStyle(
  role: 'from' | 'to',
  kind: TransitionClip['transition'],
  localFrame: number,
  durationFrames: number,
  windowFrames: number,
): TransitionStyle {
  const inWindow =
    role === 'from'
      ? localFrame >= durationFrames - windowFrames
      : localFrame < windowFrames;
  if (!inWindow) return { opacity: 1, clipPath: undefined, transform: undefined };
  const p =
    role === 'from'
      ? segment(localFrame, durationFrames - windowFrames, durationFrames)
      : segment(localFrame, 0, windowFrames);

  if (kind === 'fade') {
    return { opacity: role === 'from' ? 1 - p : p, clipPath: undefined, transform: undefined };
  }
  if (kind === 'wipeleft') {
    return role === 'from'
      ? { opacity: 1, clipPath: `inset(0 0 0 ${(p * 100).toFixed(2)}%)`, transform: undefined }
      : { opacity: 1, clipPath: undefined, transform: undefined };
  }
  // slideright
  return role === 'to'
    ? { opacity: 1, clipPath: undefined, transform: `translateX(${((1 - p) * -100).toFixed(2)}%)` }
    : { opacity: 1, clipPath: undefined, transform: undefined };
}

const VideoClipLayer: React.FC<{
  clip: VideoClip;
  mediaBaseUrl: string;
  inTransition: TransitionClip | null;
  outTransition: TransitionClip | null;
}> = ({ clip, mediaBaseUrl, inTransition, outTransition }) => {
  const frame = useCurrentFrame();
  // 一次 clip 最多参与两个转场（各自一次过渡样式）；叠乘是安全且确定的
  const styles: TransitionStyle[] = [];
  if (inTransition !== null) {
    styles.push(transitionStyle('to', inTransition.transition, frame, clip.durationFrames, inTransition.durationFrames));
  }
  if (outTransition !== null) {
    styles.push(
      transitionStyle('from', outTransition.transition, frame, clip.durationFrames, outTransition.durationFrames),
    );
  }
  const opacity = styles.reduce((acc, style) => acc * style.opacity, 1);
  const clipPath = styles.map((style) => style.clipPath).find((value) => value !== undefined);
  const transform = styles.map((style) => style.transform).find((value) => value !== undefined);

  return (
    <Sequence from={clip.startFrame} durationInFrames={clip.durationFrames}>
      <AbsoluteFill style={{ opacity, clipPath, transform }}>
        <Video
          className="ed-comp-media"
          src={resolveClipUrl(mediaBaseUrl, clip.source.url)}
          trimBefore={clip.trimStartFrames}
          playbackRate={clip.speed}
          volume={clip.volume}
          objectFit="contain"
        />
      </AbsoluteFill>
    </Sequence>
  );
};

// ── 字幕（含动效预设） ────────────────────────────────────────────────────

/** 按空白切词；无空白（中文）按字符切 —— 逐词/打字机动效对两种语言都要成立 */
function splitTokens(text: string): string[] {
  return /\s/.test(text) ? text.split(/\s+/).filter((token) => token !== '') : Array.from(text);
}

const CaptionText: React.FC<{ clip: CaptionClip }> = ({ clip }) => {
  const frame = useCurrentFrame();
  const total = clip.durationFrames;

  if (clip.preset === 'fade') {
    const opacity = interpolate(
      frame,
      [0, FADE_WINDOW, Math.max(FADE_WINDOW, total - FADE_WINDOW), total],
      [0, 1, 1, 0],
      { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
    );
    return <div style={{ opacity }}>{clip.text}</div>;
  }

  if (clip.preset === 'wordSlide') {
    const tLine = segment(frame, total * 0.06, total * 0.62);
    const tokens = splitTokens(clip.text);
    const gap = 0.055;
    return (
      <div className="ed-comp-caption-line">
        {tokens.map((token, index) => {
          const p = segment(tLine, index * gap, index * gap + 0.32);
          return (
            <span
              key={`${token}-${index}`}
              style={{
                opacity: p,
                transform: `translateY(${((1 - p) * 40).toFixed(2)}px)`,
                filter: `blur(${((1 - p) * 10).toFixed(2)}px)`,
              }}
            >
              {token}
            </span>
          );
        })}
      </div>
    );
  }

  if (clip.preset === 'typewriter') {
    const typing = segment(frame, total * 0.05, total * 0.7);
    const chars = Array.from(clip.text);
    const shown = Math.max(0, Math.round(typing * chars.length));
    const typingDone = shown >= chars.length;
    return (
      <div>
        {chars.slice(0, shown).join('')}
        {typingDone ? null : <span className="ed-comp-caret">▌</span>}
      </div>
    );
  }

  return <div>{clip.text}</div>;
};

const CaptionClipLayer: React.FC<{ clip: CaptionClip }> = ({ clip }) => (
  <Sequence from={clip.startFrame} durationInFrames={clip.durationFrames}>
    <AbsoluteFill className={`ed-comp-caption-layer ed-comp-caption-${clip.position}`}>
      <div className="ed-comp-caption">
        <CaptionText clip={clip} />
      </div>
    </AbsoluteFill>
  </Sequence>
);

const AudioClipLayer: React.FC<{ clip: AudioClip; mediaBaseUrl: string }> = ({
  clip,
  mediaBaseUrl,
}) => (
  <Sequence from={clip.startFrame} durationInFrames={clip.durationFrames}>
    <Audio
      src={resolveClipUrl(mediaBaseUrl, clip.source.url)}
      trimBefore={clip.trimStartFrames}
      volume={clip.volume}
    />
  </Sequence>
);

export const EditComposition: React.FC<EditCompositionProps> = ({ project, mediaBaseUrl }) => {
  const renderTracks = TRACK_RENDER_ORDER.map(
    (kind) => project.tracks.find((track) => track.kind === kind) ?? null,
  );
  return (
    <AbsoluteFill className="ed-comp-root">
      {renderTracks.map((track) => {
        if (track === null || track.muted === true) return null;
        return track.clips.map((clip) => {
          switch (clip.kind) {
            case 'video': {
              const windows = transitionWindow(project, clip.id);
              return (
                <VideoClipLayer
                  key={clip.id}
                  clip={clip}
                  mediaBaseUrl={mediaBaseUrl}
                  inTransition={windows.in}
                  outTransition={windows.out}
                />
              );
            }
            case 'caption':
              return <CaptionClipLayer key={clip.id} clip={clip} />;
            case 'audio':
              return <AudioClipLayer key={clip.id} clip={clip} mediaBaseUrl={mediaBaseUrl} />;
            case 'transition':
              // 转场不产生独立图层（它作用于两侧视频片段的过渡样式）
              return null;
          }
        });
      })}
    </AbsoluteFill>
  );
};
