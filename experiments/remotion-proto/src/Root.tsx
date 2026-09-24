import { Composition } from 'remotion';
import { Video } from './Video';

/**
 * 原型 composition：5.09s × 24fps ≈ 121 帧，1280×720。
 *
 * 数据模型对比（shotcraft 用 `Track → Clip`，帧为单位；我们用 `EditOperation[]`，秒为单位）——
 * Remotion 天然是帧模型，所以"抽帧 → 逐帧渲染"链路在 Remotion 里是对齐的。
 */
export const FPS = 24;
export const TOTAL_FRAMES = 121;

export const Root: React.FC = () => {
  return (
    <Composition
      id="Proto"
      component={Video}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={1280}
      height={720}
    />
  );
};
