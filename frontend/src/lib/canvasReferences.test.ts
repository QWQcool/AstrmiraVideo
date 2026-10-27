import { describe, expect, it } from 'vitest';
import type { CanvasReference } from '@astrmira/shared';
import {
  addReferencesToDraft,
  allowedKindsForReferenceTarget,
  moveCanvasReference,
  removeCanvasReference,
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

describe('B 路线：图片节点的全能参考（V2.76）', () => {
  it('开了 omni-reference 后按 order 追加，role 统一 reference-image', () => {
    const result = addReferencesToDraft(
      [],
      [
        { ref: 'a1', kind: 'image' },
        { ref: 'a2', kind: 'image' },
      ],
      'image',
      { referenceMode: 'omni-reference' },
    );
    expect(result.added).toBe(2);
    expect(result.references).toEqual([
      { assetId: 'a1', role: 'reference-image', order: 0 },
      { assetId: 'a2', role: 'reference-image', order: 1 },
    ]);
  });

  it('非图片素材与重复素材被忽略，且不占槽位', () => {
    const existing = [{ assetId: 'a1', role: 'reference-image' as const, order: 0 }];
    const result = addReferencesToDraft(
      existing,
      [
        { ref: 'a1', kind: 'image' },
        { ref: 'v1', kind: 'video' },
        { ref: 'a2', kind: 'image' },
      ],
      'image',
      { referenceMode: 'omni-reference' },
    );
    expect(result.added).toBe(1);
    expect(result.ignored).toBe(2);
    expect(result.references.map((item) => item.assetId)).toEqual(['a1', 'a2']);
    expect(result.references[1]!.order).toBe(1);
  });

  it('没有声明模式时仍然忽略（旧行为不变）', () => {
    const result = addReferencesToDraft([], [{ ref: 'a1', kind: 'image' }], 'image');
    expect(result.added).toBe(0);
    expect(result.ignored).toBe(1);
  });
});

/** P1-2d：素材条的"直接操作"（移除 / 挪槽位）——纯函数，槽位号必须始终连续 */
describe('素材条操作：移除与挪位', () => {
  const omni = (ids: string[]): CanvasReference[] =>
    ids.map((assetId, order) => ({ assetId, role: 'reference-image' as const, order }));

  it('移除中间一张后槽位重排成 0..n-1（不留空洞）', () => {
    const next = removeCanvasReference(omni(['a', 'b', 'c']), 'b');
    expect(next.map((item) => item.assetId)).toEqual(['a', 'c']);
    expect(next.map((item) => item.order)).toEqual([0, 1]);
  });

  it('移除不存在的素材：内容不变（不报错、不乱序）', () => {
    const next = removeCanvasReference(omni(['a', 'b']), 'zzz');
    expect(next.map((item) => item.assetId)).toEqual(['a', 'b']);
  });

  it('往后挪一位：与后一个交换并保持槽位连续', () => {
    const next = moveCanvasReference(omni(['a', 'b', 'c']), 'a', 1);
    expect(next.map((item) => item.assetId)).toEqual(['b', 'a', 'c']);
    expect(next.map((item) => item.order)).toEqual([0, 1, 2]);
  });

  it('已在边界：原样返回（不绕回、不报错）', () => {
    const next = moveCanvasReference(omni(['a', 'b']), 'a', -1);
    expect(next.map((item) => item.assetId)).toEqual(['a', 'b']);
    const last = moveCanvasReference(omni(['a', 'b']), 'b', 1);
    expect(last.map((item) => item.assetId)).toEqual(['a', 'b']);
  });

  it('挪位不动 role（首尾帧交换请用 swapFirstLastReferences）', () => {
    const refs: CanvasReference[] = [
      { assetId: 'a', role: 'first-frame', order: 0 },
      { assetId: 'b', role: 'last-frame', order: 1 },
    ];
    const next = moveCanvasReference(refs, 'b', -1);
    expect(next).toEqual([
      { assetId: 'b', role: 'last-frame', order: 0 },
      { assetId: 'a', role: 'first-frame', order: 1 },
    ]);
  });

  it('带空洞的旧数据在挪位后也被紧凑化', () => {
    const refs: CanvasReference[] = [
      { assetId: 'a', role: 'reference-image', order: 0 },
      { assetId: 'b', role: 'reference-image', order: 5 },
    ];
    const next = moveCanvasReference(refs, 'b', -1);
    expect(next.map((item) => item.order)).toEqual([0, 1]);
  });
});
