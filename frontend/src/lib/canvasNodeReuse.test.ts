import { describe, expect, it } from 'vitest';
import type { CanvasNodeBatch } from '@astrmira/shared';
import { reuseFromBatch } from './canvasNodeReuse';

function batch(extra: Partial<CanvasNodeBatch> = {}): CanvasNodeBatch {
  return {
    id: 'b1',
    createdAt: 1,
    status: 'succeeded',
    outputs: [{ assetId: 'task:1', kind: 'video', url: '/media/1.mp4' }],
    ...extra,
  };
}

describe('S5-B3d 节点复用本轮参数', () => {
  it('只回填真实 request 的提示词/设置/参考；缺失记录返回 null', () => {
    expect(reuseFromBatch(batch())).toBeNull();

    const reused = reuseFromBatch(
      batch({
        request: {
          prompt: '雨夜街头',
          mode: 'fl2v',
          aspectRatio: '9:16',
          provider: 'host-comfyui',
          resolution: { width: 720, height: 1280 },
          params: { durationSec: 5, seed: 42 },
          assets: { firstFrameImage: 'a1', lastFrameImage: 'a2' },
        },
      }),
    );
    expect(reused).toEqual({
      prompt: '雨夜街头',
      settings: {
        provider: 'host-comfyui',
        mode: 'fl2v',
        aspectRatio: '9:16',
        resolution: { width: 720, height: 1280 },
        durationSec: 5,
      },
      references: [
        { assetId: 'a1', role: 'first-frame', order: 0 },
        { assetId: 'a2', role: 'last-frame', order: 1 },
      ],
    });
  });

  it('参考视频也按真实 assets 回填，不伪造其余槽', () => {
    const reused = reuseFromBatch(
      batch({
        request: {
          prompt: '参考视频',
          mode: 'v2v',
          aspectRatio: '16:9',
          provider: 'host-comfyui',
          assets: { referenceVideo: 'v1' },
        },
      }),
    );
    expect(reused?.references).toEqual([
      { assetId: 'v1', role: 'reference-video', order: 2 },
    ]);
  });
});
