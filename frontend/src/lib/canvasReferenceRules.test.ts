import { describe, expect, it } from 'vitest';
import {
  CANVAS_MAX_REFERENCES,
  canvasReferenceLimit,
  checkCanvasReferenceComposition,
  scanCanvasMentions,
  sortCanvasReferences,
  type CanvasReference,
} from '@astrmira/shared';

function ref(assetId: string, role: CanvasReference['role'], order: number): CanvasReference {
  return { assetId, role, order };
}

describe('参考组成：模式 × role（B 路线冻结规则）', () => {
  it('未声明模式（旧文档）只守结构上限，不判 role 组成', () => {
    const refs = [ref('a', 'first-frame', 0), ref('b', 'reference-video', 1)];
    expect(checkCanvasReferenceComposition({ mode: undefined, references: refs })).toEqual({
      ok: true,
      limit: CANVAS_MAX_REFERENCES,
    });
    const many = Array.from({ length: 13 }, (_, index) => ref(`a${index}`, 'reference-image', index));
    expect(checkCanvasReferenceComposition({ mode: undefined, references: many })).toMatchObject({
      ok: false,
      problem: 'too-many',
    });
  });

  it('none：有任何参考就是模式冲突', () => {
    expect(checkCanvasReferenceComposition({ mode: 'none', references: [] }).ok).toBe(true);
    expect(
      checkCanvasReferenceComposition({ mode: 'none', references: [ref('a', 'reference-image', 0)] }),
    ).toMatchObject({ ok: false, problem: 'mode-conflict' });
  });

  it('first-last-frame：首尾各一合法；只有尾帧报缺首帧；两张首帧报超量', () => {
    expect(
      checkCanvasReferenceComposition({
        mode: 'first-last-frame',
        references: [ref('a', 'first-frame', 0), ref('b', 'last-frame', 1)],
      }).ok,
    ).toBe(true);

    expect(
      checkCanvasReferenceComposition({
        mode: 'first-last-frame',
        references: [ref('b', 'last-frame', 0)],
      }),
    ).toMatchObject({ ok: false, problem: 'missing-first-frame' });

    expect(
      checkCanvasReferenceComposition({
        mode: 'first-last-frame',
        references: [ref('a', 'first-frame', 0), ref('b', 'first-frame', 1)],
      }),
    ).toMatchObject({ ok: false, problem: 'too-many' });

    expect(
      checkCanvasReferenceComposition({
        mode: 'first-last-frame',
        references: [ref('a', 'first-frame', 0), ref('b', 'reference-image', 1)],
      }),
    ).toMatchObject({ ok: false, problem: 'mode-conflict' });
  });

  it('omni-reference：多张 reference-image 合法，混入首帧即冲突', () => {
    const ok = [ref('a', 'reference-image', 0), ref('b', 'reference-image', 1), ref('c', 'reference-image', 2)];
    expect(checkCanvasReferenceComposition({ mode: 'omni-reference', references: ok }).ok).toBe(true);
    expect(
      checkCanvasReferenceComposition({
        mode: 'omni-reference',
        references: [ref('a', 'reference-image', 0), ref('b', 'first-frame', 1)],
      }),
    ).toMatchObject({ ok: false, problem: 'mode-conflict' });
  });

  it('omni-reference：重复素材、重复槽位分别报出来', () => {
    expect(
      checkCanvasReferenceComposition({
        mode: 'omni-reference',
        references: [ref('a', 'reference-image', 0), ref('a', 'reference-image', 1)],
      }),
    ).toMatchObject({ ok: false, problem: 'duplicate-asset' });

    expect(
      checkCanvasReferenceComposition({
        mode: 'omni-reference',
        references: [ref('a', 'reference-image', 0), ref('b', 'reference-image', 0)],
      }),
    ).toMatchObject({ ok: false, problem: 'duplicate-order' });
  });

  it('能力上限比结构上限小时取小（12 是产品上限，不是模型真值）', () => {
    const four = Array.from({ length: 4 }, (_, index) => ref(`a${index}`, 'reference-image', index));
    expect(
      checkCanvasReferenceComposition({ mode: 'omni-reference', references: four, capacity: 4 }).ok,
    ).toBe(true);
    expect(
      checkCanvasReferenceComposition({ mode: 'omni-reference', references: four, capacity: 3 }),
    ).toMatchObject({ ok: false, problem: 'too-many', limit: 3 });
    expect(canvasReferenceLimit(4)).toBe(4);
    expect(canvasReferenceLimit(64)).toBe(CANVAS_MAX_REFERENCES);
    expect(canvasReferenceLimit(undefined)).toBe(CANVAS_MAX_REFERENCES);
  });
});

describe('提示词提及 {{image:N}}', () => {
  it('0 起编号，N 对应 order 排序后的下标', () => {
    const references = sortCanvasReferences([
      ref('b', 'reference-image', 1),
      ref('a', 'reference-image', 0),
    ]);
    expect(references.map((item) => item.assetId)).toEqual(['a', 'b']);
    expect(scanCanvasMentions('把 {{image:0}} 放进 {{image:1}}', 2).mentions).toEqual([
      { index: 0, raw: '{{image:0}}' },
      { index: 1, raw: '{{image:1}}' },
    ]);
  });

  it('越界记为问题，但不改写原文', () => {
    const prompt = '拿 {{image:5}} 和 {{image:1}}';
    const scan = scanCanvasMentions(prompt, 2);
    expect(scan.problems).toEqual([{ index: 5, raw: '{{image:5}}', problem: 'out-of-range' }]);
    expect(scan.mentions).toHaveLength(1);
    expect(prompt).toContain('{{image:5}}');
  });

  it('大小写不合规不解析（与即梦实测一致：{{Image 4}} 不被识别）', () => {
    expect(scanCanvasMentions('拿 {{Image 4}} 和 {{image:x}}', 3)).toEqual({ mentions: [], problems: [] });
  });

  it('没有参考时任何提及都越界', () => {
    expect(scanCanvasMentions('{{image:0}}', 0).problems).toHaveLength(1);
  });
});
