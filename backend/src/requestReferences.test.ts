import { describe, expect, it } from 'vitest';
import { GenerationAssetsSchema, MAX_GENERATION_REFERENCES } from '@astrmira/shared';

/**
 * §1 `assets.references[]`（V2.76 / B 路线）的校验口径。
 *
 * 三条被钉住的规则都对应真实故障形态：
 * - 与首尾帧混用 → "哪张是首帧"出现两份真相；
 * - role 放开 → 每种组合都要单独验，先只接 reference-image；
 * - order / assetId 重复 → 槽位冲突、同图喂两遍。
 */
const refs = (...specs: Array<[string, number]>) =>
  specs.map(([assetId, order]) => ({ assetId, role: 'reference-image' as const, order }));

describe('assets.references 校验', () => {
  it('1..12 张、order 递增：通过', () => {
    expect(() =>
      GenerationAssetsSchema.parse({
        references: refs(['a', 0], ['b', 1], ['c', 2], ['d', 3]),
      }),
    ).not.toThrow();
  });

  it('与 firstFrameImage 互斥', () => {
    expect(() =>
      GenerationAssetsSchema.parse({
        firstFrameImage: 'a',
        references: refs(['b', 0]),
      }),
    ).toThrow(/互斥/);
  });

  it('与 lastFrameImage 互斥', () => {
    expect(() =>
      GenerationAssetsSchema.parse({
        lastFrameImage: 'a',
        references: refs(['b', 0]),
      }),
    ).toThrow(/互斥/);
  });

  it('只接受 reference-image（首尾帧仍走独立字段）', () => {
    expect(() =>
      GenerationAssetsSchema.parse({
        references: [{ assetId: 'a', role: 'first-frame', order: 0 }],
      }),
    ).toThrow(/reference-image/);
  });

  it('order 重复 / 同一素材重复都拒绝', () => {
    expect(() =>
      GenerationAssetsSchema.parse({ references: refs(['a', 0], ['b', 0]) }),
    ).toThrow(/order 重复/);
    expect(() =>
      GenerationAssetsSchema.parse({ references: refs(['a', 0], ['a', 1]) }),
    ).toThrow(/重复引用/);
  });

  it('超过结构上限 12 张直接拒绝（不静默截断）', () => {
    const many = Array.from({ length: MAX_GENERATION_REFERENCES + 1 }, (_, index) => [`a${index}`, index] as [string, number]);
    expect(() => GenerationAssetsSchema.parse({ references: refs(...many) })).toThrow();
  });

  it('旧字段（没有 references）行为不变', () => {
    expect(() => GenerationAssetsSchema.parse({ firstFrameImage: 'a', lastFrameImage: 'b' })).not.toThrow();
    expect(() => GenerationAssetsSchema.parse({})).not.toThrow();
  });
});
