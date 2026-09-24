import { AbsoluteFill, Audio, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';

/**
 * 逐帧渲染原型：把抽帧得到的 PNG 序列逐帧贴回，并叠加一个字卡。
 *
 * 这是"放弃 ffmpeg、改 Remotion 逐帧渲染"方案的核心验证点：
 * - 每一帧 = 一张 PNG（`<Img>` 贴全屏）；
 * - 字卡 = 绝对定位的 `<div>`（第 24~72 帧 = 1~3s 淡入淡出）—— 这是 ffmpeg 的 drawtext 做不好的事；
 * - 音轨 = `<Audio>`（单独提取的 AAC）—— 验证音轨能否保留。
 */
export const Video: React.FC = () => {
  const frame = useCurrentFrame();
  // 帧文件名是 1-based（0001.png ~ 0121.png），useCurrentFrame 是 0-based
  const src = staticFile(`frames/${String(frame + 1).padStart(4, '0')}.png`);

  // 字卡：第 24~72 帧（1~3s）淡入淡出
  const captionOpacity = interpolate(frame, [24, 36, 60, 72], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />

      {/* 字卡（Remotion 的核心价值：ffmpeg 的 drawtext 做不到这种排版与淡入淡出） */}
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

      <Audio src={staticFile('audio.aac')} />
    </AbsoluteFill>
  );
};
