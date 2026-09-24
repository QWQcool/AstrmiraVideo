import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Video } from '@remotion/media';
import { renderMediaOnWeb } from '@remotion/web-renderer';

/** 静态服务里成片的绝对地址（web-renderer 内部渲染上下文的 origin 不确定，用绝对 URL + CORS） */
const SOURCE_VIDEO = 'http://127.0.0.1:5198/input.mp4';

/**
 * P0 完整目标：**读成片 + 中文字幕 + 导出**。
 * OffthreadVideo 嵌源片（裁剪 1~4s = frame 24~96），叠加中文字幕。
 */
const VideoWithCaption: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [6, 12, 60, 66], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/* web-renderer 不支持 <OffthreadVideo>，要用 @remotion/media 的 <Video>
          （trimBefore/trimAfter 是**帧数**；裁剪源片 1~4s = frame 24~96） */}
      <Video
        src={SOURCE_VIDEO}
        trimBefore={24}
        trimAfter={96}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 64,
          textAlign: 'center',
          color: '#fff',
          fontSize: 52,
          fontWeight: 600,
          opacity,
          fontFamily: 'system-ui, sans-serif',
          textShadow: '0 2px 16px rgba(0,0,0,0.8)',
        }}
      >
        雨停了，我们走吧。
      </div>
    </AbsoluteFill>
  );
};

/**
 * P0 第一步：纯字幕 composition（无视频轨）—— 先验证 web-renderer 能在浏览器跑通
 * WebCodecs 编码 + Mediabunny 封装，且中文字幕渲染正常。跑通后再加 OffthreadVideo 视频轨。
 */
const CaptionOnly: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [6, 12, 60, 66], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#0b1a2c',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          color: '#fff',
          fontSize: 64,
          fontWeight: 600,
          opacity,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        雨停了，我们走吧。
      </div>
    </AbsoluteFill>
  );
};

function log(message: string): void {
  const el = document.getElementById('log');
  if (el) el.textContent += message + '\n';
}

const btn = document.getElementById('go');
if (btn) {
  btn.addEventListener('click', async () => {
    const mode = (document.getElementById('withVideo') as HTMLInputElement | null)?.checked ?? false;
    const component = mode ? VideoWithCaption : CaptionOnly;
    log(`开始浏览器导出（${mode ? '视频轨 + 字幕（读成片 input.mp4 裁剪 1~4s）' : '纯字幕（无视频轨）'}）…`);
    const start = performance.now();
    try {
      const result = await renderMediaOnWeb({
        composition: {
          component,
          id: mode ? 'VideoWithCaption' : 'CaptionOnly',
          width: 1280,
          height: 720,
          fps: 24,
          durationInFrames: 72,
        },
        licenseKey: null,
        logLevel: 'warn',
        onProgress: (p) => log(`  进度 ${(p.progress * 100).toFixed(0)}%`),
      });
      const blob = await result.getBlob();
      const url = URL.createObjectURL(blob);
      const video = document.getElementById('out') as HTMLVideoElement | null;
      if (video) {
        video.src = url;
        video.style.display = 'block';
      }
      const sec = ((performance.now() - start) / 1000).toFixed(1);
      log(`✓ 导出完成：${(blob.size / 1024 / 1024).toFixed(2)}MB · 耗时 ${sec}s · 类型 ${blob.type}`);
      (window as unknown as { __P0_DONE__: string }).__P0_DONE__ = `ok ${sec}s ${blob.size}`;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      log(`✗ 导出失败：${message}`);
      (window as unknown as { __P0_DONE__: string }).__P0_DONE__ = `fail ${message}`;
    }
  });
}
