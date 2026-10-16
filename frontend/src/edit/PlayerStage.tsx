import React, { useEffect, useMemo, useRef } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { EditComposition } from './Composition';
import { previewDurationFrames } from './model';
import { seekToFrame, setPlayerRef } from './playerRef';
import type { EditStore } from './store';
import { useEditStore } from './store';
import { formatTimecode } from './time';
import { useTranslate } from '../lib/i18n';

/**
 * 预览舞台（B34 · P1）：@remotion/player 实时预览。
 *
 * 本模块是 Remotion 的**唯一 import 边界** —— EditView 用 `React.lazy` 加载它，
 * 主 bundle 因此不含 Remotion（只在进入剪辑台时才拉这段 chunk）。
 * P2 的导出（@remotion/web-renderer）也从这个边界复用 `EditComposition`。
 *
 * 播放头同步采用 shotcraft 同款纪律：Player 的 frameupdate 事件 → store.playheadFrame，
 * 只有走带时间码与时间轴播放头竖线订阅它（播放中的每帧更新不会波及整个界面）。
 */

/** 走带控制：唯一订阅 playheadFrame / playing 的预览端组件 */
const Transport: React.FC<{ store: EditStore }> = ({ store }) => {
  const t = useTranslate();
  const playhead = useEditStore(store, (s) => s.playheadFrame);
  const playing = useEditStore(store, (s) => s.playing);
  const fps = useEditStore(store, (s) => s.project.fps);
  const width = useEditStore(store, (s) => s.project.width);
  const height = useEditStore(store, (s) => s.project.height);
  const duration = previewDurationFrames(useEditStore(store, (s) => s.project));

  return (
    <div className="ed-transport">
      <button
        type="button"
        className="wb-btn lib-icon"
        title={t('edit.player.toStart')}
        onClick={() => {
          seekToFrame(0);
          store.setPlayhead(0);
        }}
      >
        ⏮
      </button>
      <span className="ed-timecode">
        {formatTimecode(playhead, fps)} <span className="ed-timecode-dim">/ {formatTimecode(duration, fps)}</span>
      </span>
      <span className="ed-transport-hint">
        {t('edit.player.hint', {
          state: t(playing ? 'edit.player.playing' : 'edit.player.paused'),
        })}
      </span>
      <span className="ed-transport-size">
        {width}×{height} · {fps}fps
      </span>
    </div>
  );
};

const PlayerStage: React.FC<{ store: EditStore }> = ({ store }) => {
  const project = useEditStore(store, (s) => s.project);
  const playerRef = useRef<PlayerRef>(null);

  // Player 事件 → store（播放头 / 播放态）；同时把实例登记进 playerRef 供时间轴 seek
  useEffect(() => {
    const player = playerRef.current;
    if (player === null) return;
    setPlayerRef(player);
    const onFrame = (event: { detail: { frame: number } }): void => {
      store.setPlayhead(event.detail.frame);
    };
    const onPlay = (): void => store.setPlaying(true);
    const onPause = (): void => store.setPlaying(false);
    player.addEventListener('frameupdate', onFrame);
    player.addEventListener('play', onPlay);
    player.addEventListener('pause', onPause);
    return () => {
      player.removeEventListener('frameupdate', onFrame);
      player.removeEventListener('play', onPlay);
      player.removeEventListener('pause', onPause);
      setPlayerRef(null);
    };
  }, [store]);

  const inputProps = useMemo(
    () => ({ project, mediaBaseUrl: window.location.origin }),
    [project],
  );

  return (
    <div className="ed-stage">
      <div
        className="ed-stage-box"
        style={{ aspectRatio: `${project.width} / ${project.height}` }}
      >
        <Player
          ref={playerRef}
          component={EditComposition}
          inputProps={inputProps}
          durationInFrames={previewDurationFrames(project)}
          compositionWidth={project.width}
          compositionHeight={project.height}
          fps={project.fps}
          loop
          controls={false}
          clickToPlay
          // 0 = 不预创建共享 audio 标签。那些标签会加载一个静音占位 data-URI mp3，
          // 在 headless Chromium 里解码失败刷 console.error（冒烟实测 16 条）；
          // P1 也没有多路 Audio 同时播放的场景（P3 音频轨开放时再评估）。
          numberOfSharedAudioTags={0}
          style={{ width: '100%', height: '100%' }}
          acknowledgeRemotionLicense
        />
      </div>
      <Transport store={store} />
    </div>
  );
};

export default PlayerStage;
