import type {
  CanvasNodeBatch,
  CanvasNodeSettings,
  CanvasReference,
} from '@astrmira/shared';

/**
 * S5-B3d：从节点某一轮的真实 request 快照回填草稿。
 *
 * 只读 `batch.request`；没有记录就返回 null，界面必须如实说“这一轮没有参数记录”，
 * 不能拿当前草稿或别的批次冒充历史。
 */
export interface CanvasBatchReuse {
  prompt: string;
  settings: CanvasNodeSettings;
  references: CanvasReference[];
}

export function reuseFromBatch(batch: CanvasNodeBatch): CanvasBatchReuse | null {
  const request = batch.request;
  if (request === undefined) return null;

  const references: CanvasReference[] = [];
  const first = request.assets?.firstFrameImage;
  const last = request.assets?.lastFrameImage;
  const video = request.assets?.referenceVideo;
  if (first !== undefined) {
    references.push({ assetId: first, role: 'first-frame', order: 0 });
  }
  if (last !== undefined) {
    references.push({ assetId: last, role: 'last-frame', order: 1 });
  }
  if (video !== undefined) {
    references.push({ assetId: video, role: 'reference-video', order: 2 });
  }

  return {
    prompt: request.prompt,
    settings: {
      provider: request.provider,
      mode: request.mode,
      aspectRatio: request.aspectRatio,
      resolution: request.resolution,
      ...(request.params?.durationSec === undefined
        ? {}
        : { durationSec: request.params.durationSec }),
      // 节点草稿没有 seed 字段；不把 request.params.seed 假装成已回填
    },
    references,
  };
}
