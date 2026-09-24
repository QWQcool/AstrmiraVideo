import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { Audio, Video } from '@remotion/media';
import type { AudioClip, CaptionClip, EditProject, VideoClip } from './model';

/**
 * 剪辑台合成（B34）：把 `EditProject` 渲染成 Remotion TSX。
 *
 * 这是「预览即所得」的载体：P1 的 @remotion/player 预览与 P2 的
 * @remotion/web-renderer 导出**共用这一个组件**（P0 已实测同构图在两端逐帧一致）。
 *
 * 三条实测换来的约定：
 * 1. **不用 `<OffthreadVideo>`**（web-renderer 不支持），一律 `@remotion/media` 的 `<Video>`；
 * 2. `<Video src>` 用**绝对 URL**（web-renderer 内部渲染上下文的相对地址 origin 不确定），
 *    由调用方传入 `mediaBaseUrl`（预览侧 = `location.origin`），模型里存的 `/media/*` 在此绝对化；
 * 3. `trimBefore` / `trimAfter` 的单位是**帧**（与模型的工程帧天然对齐，不需要换算）。
 *
 * 样式全部走 CSS 类（`edit.css` 里的 token 引用）：web-renderer 实测挂载在**同一文档**
 * （`ReactDOM.createRoot(div)` → `document.body`），样式表与 CSS 变量在导出上下文同样生效；
 * 同时避免在 TSX 里写字面量字号/色值（视觉自检 ③⑨ 会拦）。
 */

export interface EditCompositionProps {
  project: EditProject;
  /** 站点源（预览侧传 `window.location.origin`），用于把 `/media/*` 绝对化 */
  mediaBaseUrl: string;
}

function resolveClipUrl(mediaBaseUrl: string, url: string): string {
  return new URL(url, mediaBaseUrl).href;
}

const VideoClipLayer: React.FC<{ clip: VideoClip; mediaBaseUrl: string }> = ({
  clip,
  mediaBaseUrl,
}) => (
  <Sequence from={clip.startFrame} durationInFrames={clip.durationFrames}>
    <Video
      className="ed-comp-media"
      src={resolveClipUrl(mediaBaseUrl, clip.source.url)}
      trimBefore={clip.trimStartFrames}
      playbackRate={clip.speed}
      volume={clip.volume}
      objectFit="contain"
    />
  </Sequence>
);

const CaptionClipLayer: React.FC<{ clip: CaptionClip }> = ({ clip }) => (
  <Sequence from={clip.startFrame} durationInFrames={clip.durationFrames}>
    <AbsoluteFill className="ed-comp-caption-layer">
      <div className="ed-comp-caption">{clip.text}</div>
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
  // UI 里 tracks[0] 是最上层轨 → 最后渲染（盖在下面轨道的画面上）
  const ordered = [...project.tracks].reverse();
  return (
    <AbsoluteFill className="ed-comp-root">
      {ordered.map((track) =>
        track.muted === true
          ? null
          : track.clips.map((clip) => {
              switch (clip.kind) {
                case 'video':
                  return <VideoClipLayer key={clip.id} clip={clip} mediaBaseUrl={mediaBaseUrl} />;
                case 'caption':
                  return <CaptionClipLayer key={clip.id} clip={clip} />;
                case 'audio':
                  return <AudioClipLayer key={clip.id} clip={clip} mediaBaseUrl={mediaBaseUrl} />;
                case 'transition':
                  // P3 才开放转场编辑与渲染；模型先占住形状
                  return null;
              }
            }),
      )}
    </AbsoluteFill>
  );
};
