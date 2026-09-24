import { AbsoluteFill, interpolate, OffthreadVideo, staticFile, useCurrentFrame } from 'remotion';

/**
 * **正确的接入路径**：`<OffthreadVideo>` 直接嵌入 MP4 —— **不抽帧**。
 *
 * 与 `Video.tsx`（抽帧→PNG 序列→逐帧贴回）对比，这条路径：
 * - 不产生 27 倍的 PNG 中间帧存储；
 * - Remotion 内部用 ffmpeg 逐帧解码源视频（对我们透明）；
 * - 裁剪（`startFrom`/`endAt`）、变速（`playbackRate`）、音量（`volume`）都是组件属性。
 *
 * 这才是剪辑台该用的方式（MP4 成片直接进时间轴，不是先抽成帧）。
 */
export const VideoOffthread: React.FC = () => {
  const frame = useCurrentFrame();

  // 裁剪：源片的 1s~4s（frame 24~96），本 composition 共 72 帧（3s）
  // 字卡：本片的第 12~48 帧（0.5~2s）淡入淡出
  const captionOpacity = interpolate(frame, [12, 24, 40, 48], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <OffthreadVideo
        src={staticFile('input.mp4')}
        startFrom={24}
        endAt={96}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 64,
          textAlign: 'center',
          opacity: captionOpacity,
          color: '#fff',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 44,
          fontWeight: 600,
          textShadow: '0 2px 16px rgba(0,0,0,0.8)',
        }}
      >
        雨停了，我们走吧。
      </div>
    </AbsoluteFill>
  );
};
