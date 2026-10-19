import { describe, expect, it } from 'vitest';
import {
  ModelCapabilitySchema,
  checkCapability,
  estimateCostCny,
  type ModelCapability,
} from '@astrmira/shared';

function cap(overrides: Partial<ModelCapability> = {}): ModelCapability {
  return {
    modelId: 'seedance-mini',
    label: 'Seedance 2.0 mini',
    provider: 'cloud-volcano-seedance',
    modes: ['t2v', 'i2v', 'fl2v'],
    referenceModes: ['none', 'first-last-frame'],
    maxReferences: 2,
    referenceKinds: ['image'],
    aspectRatios: ['16:9', '9:16'],
    resolutions: [{ width: 1280, height: 720, label: '720P' }],
    durations: [5, 10],
    maxCount: 1,
    cost: { source: 'provider', unit: 'per-second', amountCny: 0.2 },
    ...overrides,
  };
}

describe('ModelCapability', () => {
  it('fixture 本身通过 schema（防止测试用的假数据漂移）', () => {
    expect(() => ModelCapabilitySchema.parse(cap())).not.toThrow();
  });

  it('不可用时只返回 model-unavailable，不再逐项挑错', () => {
    expect(checkCapability(cap({ unavailableReason: '未配置模型' }), { mode: 't2v' })).toBe(
      'model-unavailable',
    );
  });

  it('参数组合全部合法时返回 null', () => {
    expect(
      checkCapability(cap(), {
        mode: 'fl2v',
        referenceMode: 'first-last-frame',
        references: [{ role: 'first-frame' }, { role: 'last-frame' }],
        aspectRatio: '16:9',
        resolution: { width: 1280, height: 720 },
        durationSec: 5,
        count: 1,
      }),
    ).toBeNull();
  });

  it.each([
    ['mode', { mode: 'v2v' }, 'mode-unsupported'],
    ['referenceMode', { referenceMode: 'omni-reference' }, 'reference-mode-unsupported'],
    ['aspectRatio', { aspectRatio: '1:1' }, 'aspect-unsupported'],
    ['resolution', { resolution: { width: 1920, height: 1080 } }, 'resolution-unsupported'],
    ['durationSec', { durationSec: 8 }, 'duration-unsupported'],
    ['count', { count: 2 }, 'count-exceeded'],
  ])('拒绝不支持的 %s', (_name, input, issue) => {
    expect(checkCapability(cap(), input)).toBe(issue);
  });

  it('参考数量与素材类型分别判定（超限优先于类型）', () => {
    expect(
      checkCapability(cap(), {
        references: [{ role: 'first-frame' }, { role: 'last-frame' }, { role: 'reference-image' }],
      }),
    ).toBe('too-many-references');
    expect(checkCapability(cap(), { references: [{ role: 'reference-video' }] })).toBe(
      'reference-kind-unsupported',
    );
  });

  it('估算：本地为 0，无报价为 null（界面显示待核算），按秒/按张/按次分别计算', () => {
    expect(estimateCostCny(cap({ cost: { source: 'local', unit: 'unknown' } }), 5)).toBe(0);
    expect(estimateCostCny(cap({ cost: { source: 'unknown', unit: 'unknown' } }), 5)).toBeNull();
    expect(estimateCostCny(cap(), 5)).toBe(1);
    expect(
      estimateCostCny(
        cap({ cost: { source: 'provider', unit: 'per-image', amountCny: 0.35 } }),
        2,
      ),
    ).toBe(0.7);
    expect(
      estimateCostCny(cap({ cost: { source: 'provider', unit: 'per-run', amountCny: 3 } }), 99),
    ).toBe(3);
  });
});
