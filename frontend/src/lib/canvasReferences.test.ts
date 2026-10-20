import { describe, expect, it } from 'vitest';
import type { CanvasReference } from '@astrmira/shared';
import {
  addReferencesToDraft,
  allowedKindsForReferenceTarget,
} from './canvasReferences';

const image = (assetId: string): CanvasReference => ({
  assetId,
  role: 'first-frame',
  order: 0,
});

describe('S5-Ac 节点参考添加', () => {
  it('图片按首帧/尾帧顺序填充，最多 2 张；第三张如实 ignored', () => {
    const result = addReferencesToDraft([], [
      { ref: 'a1', kind: 'image' },
      { ref: 'a2', kind: 'image' },
      { ref: 'a3', kind: 'image' },
    ], 'video');
    expect(result.references).toEqual([
      { assetId: 'a1', role: 'first-frame', order: 0 },
      { assetId: 'a2', role: 'last-frame', order: 1 },
    ]);
    expect(result.added).toBe(2);
    expect(result.ignored).toBe(1);
  });

  it('已有首帧时只补尾帧，不覆盖已有槽', () => {
    const existing: CanvasReference[] = [{ assetId: 'old', role: 'first-frame', order: 2 }];
    const result = addReferencesToDraft(existing, [{ ref: 'a2', kind: 'image' }], 'video');
    expect(result.references).toEqual([
      { assetId: 'old', role: 'first-frame', order: 2 },
      { assetId: 'a2', role: 'last-frame', order: 3 },
    ]);
  });

  it('参考视频与图片不混用；已选视频时只接受视频', () => {
    const existing: CanvasReference[] = [
      { assetId: 'v1', role: 'reference-video', order: 0 },
    ];
    const result = addReferencesToDraft(existing, [
      { ref: 'a1', kind: 'image' },
      { ref: 'v2', kind: 'video' },
    ], 'video');
    expect(result.references).toHaveLength(1);
    expect(result.added).toBe(0);
    expect(result.ignored).toBe(2);
    expect(allowedKindsForReferenceTarget(existing)).toEqual(['video']);
  });

  it('空节点第一选择决定图片或视频；音频忽略；重复忽略', () => {
    const videoFirst = addReferencesToDraft([], [
      { ref: 'v1', kind: 'video' },
      { ref: 'a1', kind: 'image' },
    ], 'video');
    expect(videoFirst.references).toEqual([
      { assetId: 'v1', role: 'reference-video', order: 0 },
    ]);
    expect(videoFirst.ignored).toBe(1);

    const imageFirst = addReferencesToDraft([], [
      { ref: 'a1', kind: 'image' },
      { ref: 'v1', kind: 'video' },
    ], 'video');
    expect(imageFirst.references).toEqual([
      { assetId: 'a1', role: 'first-frame', order: 0 },
    ]);
    expect(imageFirst.ignored).toBe(1);

    const audio = addReferencesToDraft([], [{ ref: 'audio-1', kind: 'audio' }], 'video');
    expect(audio.added).toBe(0);
    expect(audio.ignored).toBe(1);

    const duplicate = addReferencesToDraft([image('a1')], [{ ref: 'a1', kind: 'image' }], 'video');
    expect(duplicate.added).toBe(0);
    expect(duplicate.ignored).toBe(1);
  });

  it('图片/文本节点不接受生成参考（不制造不支持的引用）', () => {
    expect(
      addReferencesToDraft([], [{ ref: 'a1', kind: 'image' }], 'image').ignored,
    ).toBe(1);
    expect(
      addReferencesToDraft([], [{ ref: 'a1', kind: 'image' }], 'text').ignored,
    ).toBe(1);
  });
});
