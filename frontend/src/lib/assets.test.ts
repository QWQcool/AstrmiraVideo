import { describe, expect, it } from 'vitest';
import {
  assetsForMode,
  emptyAssetSlots,
  missingAssetHint,
  modeAfterSlotClear,
  modeAfterSlotUpload,
  type AssetSlots,
} from './assets';

/**
 * 三槽（首帧 / 尾帧 / 参考视频）与四种生成模式的映射（V8.3 批次 3-⑤）。
 *
 * 这一层值得单独测，因为它编码的是**请求契约的映射关系**：
 * 哪个槽填了、当前模式该发哪个字段、缺素材时到底缺哪一格。
 * 出错的代价不是"界面不好看"，而是**真的把错误的素材类型发给上游**
 * （上一版就发生过：上传 mp4 被当成 `first_frame` 发出去），以及云端按错模式计费。
 */

function slots(partial: Partial<AssetSlots>): AssetSlots {
  return { ...emptyAssetSlots(), ...partial };
}

const asset = (assetId: string): AssetSlots['firstFrame'] => ({
  assetId,
  meta: null,
  previewUrl: null,
});

describe('emptyAssetSlots', () => {
  it('三格都是空的，且每次返回新对象（避免共享可变状态）', () => {
    const first = emptyAssetSlots();
    expect(first).toEqual({ firstFrame: null, lastFrame: null, referenceVideo: null });

    first.firstFrame = asset('a-1');
    expect(emptyAssetSlots().firstFrame).toBeNull();
  });
});

describe('assetsForMode · 只发该模式用得到的槽', () => {
  const all = slots({
    firstFrame: asset('first'),
    lastFrame: asset('last'),
    referenceVideo: asset('video'),
  });

  it('t2v 恒为空 —— 残留素材不得随文生视频发出（否则上游真的会拿它当起点）', () => {
    expect(assetsForMode('t2v', all)).toBeUndefined();
    expect(assetsForMode('t2v', slots({}))).toBeUndefined();
  });

  it('i2v 只发 firstFrameImage', () => {
    expect(assetsForMode('i2v', all)).toEqual({ firstFrameImage: 'first' });
  });

  it('i2v 缺首帧 → undefined（提交按钮同时是灰的）', () => {
    expect(assetsForMode('i2v', slots({ lastFrame: asset('last') }))).toBeUndefined();
  });

  it('fl2v 同时发首尾帧', () => {
    expect(assetsForMode('fl2v', all)).toEqual({
      firstFrameImage: 'first',
      lastFrameImage: 'last',
    });
  });

  it('fl2v 缺任意一帧 → undefined（只给一帧不是"降级成 i2v"，是参数不完整）', () => {
    expect(assetsForMode('fl2v', slots({ firstFrame: asset('first') }))).toBeUndefined();
    expect(assetsForMode('fl2v', slots({ lastFrame: asset('last') }))).toBeUndefined();
  });

  it('v2v 只发 referenceVideo', () => {
    expect(assetsForMode('v2v', all)).toEqual({ referenceVideo: 'video' });
  });

  it('上传中（assetId 为空串的乐观预览态）视为缺失 —— 空串发上去等于"带了但不存在"', () => {
    expect(assetsForMode('i2v', slots({ firstFrame: asset('') }))).toBeUndefined();
    expect(assetsForMode('v2v', slots({ referenceVideo: asset('') }))).toBeUndefined();
  });
});

describe('missingAssetHint · 必须说清缺哪一格', () => {
  it('素材齐全的模式没有提示', () => {
    expect(missingAssetHint('t2v', slots({}))).toBeNull();
    expect(missingAssetHint('i2v', slots({ firstFrame: asset('f') }))).toBeNull();
    expect(missingAssetHint('fl2v', slots({ firstFrame: asset('f'), lastFrame: asset('l') }))).toBeNull();
    expect(missingAssetHint('v2v', slots({ referenceVideo: asset('v') }))).toBeNull();
  });

  it('缺首帧 / 缺尾帧 / 缺参考视频分别给出不同文案（不是同一句泛化提示）', () => {
    expect(missingAssetHint('i2v', slots({}))).toContain('首帧');
    expect(missingAssetHint('fl2v', slots({ lastFrame: asset('l') }))).toContain('缺首帧');
    expect(missingAssetHint('fl2v', slots({ firstFrame: asset('f') }))).toContain('缺尾帧');
    expect(missingAssetHint('v2v', slots({}))).toContain('参考视频');
  });

  it('上传中同样按"缺"处理（与 assetsForMode 同一判据，不会一个说行一个说不行）', () => {
    expect(missingAssetHint('i2v', slots({ firstFrame: asset('') }))).not.toBeNull();
  });
});

describe('modeAfterSlotUpload · 上传即切模式', () => {
  it('往首帧槽放图 → 图生视频', () => {
    expect(modeAfterSlotUpload('t2v', 'firstFrame')).toBe('i2v');
  });

  it('已在首尾帧模式时补首帧 → 保持首尾帧（不能把用户打回图生视频）', () => {
    expect(modeAfterSlotUpload('fl2v', 'firstFrame')).toBe('fl2v');
  });

  it('往尾帧槽放图 → 首尾帧；往视频槽放视频 → 视频参考', () => {
    expect(modeAfterSlotUpload('i2v', 'lastFrame')).toBe('fl2v');
    expect(modeAfterSlotUpload('t2v', 'referenceVideo')).toBe('v2v');
  });
});

describe('modeAfterSlotClear · 清素材要把模式带回落', () => {
  it('清首帧：首尾帧/图生视频都退回文生视频（缺首帧的模式是悬空状态）', () => {
    expect(modeAfterSlotClear('t2v', 'firstFrame')).toBe('t2v');
    expect(modeAfterSlotClear('i2v', 'firstFrame')).toBe('t2v');
    expect(modeAfterSlotClear('fl2v', 'firstFrame')).toBe('t2v');
  });

  it('清尾帧：首尾帧退回图生视频（首帧还在，i2v 仍然成立）', () => {
    expect(modeAfterSlotClear('fl2v', 'lastFrame')).toBe('i2v');
  });

  it('清参考视频：视频参考退回文生视频', () => {
    expect(modeAfterSlotClear('v2v', 'referenceVideo')).toBe('t2v');
  });

  it('清掉与当前模式无关的槽 → 模式不动（避免"清了尾帧却把 v2v 也改了"这类误伤）', () => {
    expect(modeAfterSlotClear('v2v', 'lastFrame')).toBe('v2v');
    expect(modeAfterSlotClear('i2v', 'lastFrame')).toBe('i2v');
  });
});
