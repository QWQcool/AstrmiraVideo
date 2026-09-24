import { Composition } from 'remotion';
import { Video } from './Video';
import { VideoOffthread } from './VideoOffthread';

/**
 * 两个 composition 对照：
 * - `Proto`（Video.tsx）：抽帧→PNG 序列→逐帧贴回（**重路径**，27 倍中间存储）
 * - `ProtoOffthread`（VideoOffthread.tsx）：`<OffthreadVideo>` 直接嵌 MP4（**正确路径**，不抽帧）
 */
export const FPS = 24;
export const TOTAL_FRAMES = 121;

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="Proto"
        component={Video}
        durationInFrames={TOTAL_FRAMES}
        fps={FPS}
        width={1280}
        height={720}
      />
      {/* OffthreadVideo 路径：裁剪源片 1s~4s（frame 24~96）= 72 帧（3s） */}
      <Composition
        id="ProtoOffthread"
        component={VideoOffthread}
        durationInFrames={72}
        fps={FPS}
        width={1280}
        height={720}
      />
    </>
  );
};
