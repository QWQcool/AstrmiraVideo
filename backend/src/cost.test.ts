import { describe, expect, it } from 'vitest';
import {
  COST_BILLING_FPS,
  COST_DEFAULT_USD_TO_CNY,
  COST_UNKNOWN_MODEL_USD_PER_MILLION,
  VIDEO_MODEL_PRICES,
  VIDEO_MODEL_PRESETS,
  estimateCostFromRequest,
  estimateVideoCost,
  findVideoModelPrice,
  formatYuan,
} from '@astrmira/shared';

/**
 * 计价口径（V2.12 / 台账 B48）。
 *
 * 基线来自 **PLAN §8 已实测的算式**：`5s × 1280×720 × 24fps ÷ 1024 ≈ 108,000 token`。
 * 这条数字是"公式写对了没有"的唯一硬锚点 —— 算错了它，后面所有金额都是错的。
 */
describe('计价公式（对齐 PLAN §8 的实测基线）', () => {
  it('5s / 720p / 24fps → 108,000 token（§8 的原式）', () => {
    const cost = estimateVideoCost({
      model: 'doubao-seedance-2-0-mini-260615',
      width: 1280,
      height: 720,
      outputSeconds: 5,
      track: 'cloud',
      usdToCny: 7.1,
    });
    expect(cost).not.toBeNull();
    expect(cost?.tokens).toBe(108_000);
    expect(cost?.usdPerMillionTokens).toBe(3.24);
    // $0.108M × 3.24 = $0.34992 → ¥2.4844
    expect(cost?.usd).toBeCloseTo(0.3499, 4);
    expect(cost?.yuan).toBeCloseTo(2.4844, 4);
    expect(cost?.source).toBe('estimate');
    expect(cost?.fromPriceTable).toBe(true);
    expect(cost?.fps).toBe(COST_BILLING_FPS);
    // 算式必须写进记录（审计要能倒推，别只存一个数字）
    expect(cost?.formula).toContain('108000 token');
  });

  it('输入时长与输出时长**都计入**（V2V 参考视频会抬高 token 量）', () => {
    const withInput = estimateVideoCost({
      model: 'doubao-seedance-2-0-mini-260615',
      width: 1280,
      height: 720,
      outputSeconds: 5,
      inputSeconds: 5,
      track: 'cloud',
    });
    expect(withInput?.tokens).toBe(216_000);
    // 没有输入时长时**如实说明**可能低估（不是悄悄少算）
    expect(withInput?.notes.some((note) => note.includes('未计入参考视频'))).toBe(false);
    const withoutInput = estimateVideoCost({
      model: 'doubao-seedance-2-0-mini-260615',
      width: 1280,
      height: 720,
      outputSeconds: 5,
      track: 'cloud',
    });
    expect(withoutInput?.notes.some((note) => note.includes('未计入参考视频'))).toBe(true);
  });

  it('本地轨 = 0 元且来源为 local-free（"没花钱"≠"不知道花了多少"）', () => {
    const cost = estimateVideoCost({
      width: 1280,
      height: 720,
      outputSeconds: 5,
      track: 'local',
    });
    expect(cost?.yuan).toBe(0);
    expect(cost?.tokens).toBe(0);
    expect(cost?.source).toBe('local-free');
    expect(cost?.formula).toContain('无 API 费用');
  });

  it('取不到分辨率 / 时长 → **null**（不编数字）', () => {
    expect(estimateVideoCost({ outputSeconds: 5, track: 'cloud' })).toBeNull();
    expect(estimateVideoCost({ width: 1280, height: 720, outputSeconds: 0, track: 'cloud' })).toBeNull();
    expect(estimateVideoCost({ width: 0, height: 0, outputSeconds: 5, track: 'cloud' })).toBeNull();
  });

  it('未知模型（自定义接入点）→ 按兜底单价 + 显著标注 fromPriceTable=false', () => {
    const cost = estimateVideoCost({
      model: 'ep-20260101-custom',
      width: 1280,
      height: 720,
      outputSeconds: 5,
      track: 'cloud',
    });
    expect(cost?.fromPriceTable).toBe(false);
    expect(cost?.usdPerMillionTokens).toBe(COST_UNKNOWN_MODEL_USD_PER_MILLION);
    expect(cost?.notes.some((note) => note.includes('不在单价表内'))).toBe(true);
  });

  it('汇率可覆盖（部署参数），缺省用 shared 的默认值', () => {
    const base = { width: 1280, height: 720, outputSeconds: 5, track: 'cloud' as const };
    const dflt = estimateVideoCost(base);
    const doubled = estimateVideoCost({ ...base, usdToCny: COST_DEFAULT_USD_TO_CNY * 2 });
    expect(dflt?.usdToCny).toBe(COST_DEFAULT_USD_TO_CNY);
    expect(doubled?.yuan).toBeCloseTo((dflt?.yuan ?? 0) * 2, 3);
  });
});

describe('单价表与档位表（两张表不许飘）', () => {
  it('单价表逐条对应档位表（少一行就会有档位永远按兜底价估算）', () => {
    expect(VIDEO_MODEL_PRICES.length).toBe(VIDEO_MODEL_PRESETS.length);
    for (const preset of VIDEO_MODEL_PRESETS) {
      expect(findVideoModelPrice(preset.id), `缺 ${preset.id} 的单价`).not.toBeNull();
    }
  });

  it('每条单价都写了依据（不许出现"大概/反正"这种来历不明的数字）', () => {
    for (const price of VIDEO_MODEL_PRICES) {
      expect(price.basis.length).toBeGreaterThan(10);
      expect(price.usdPerMillionTokens).toBeGreaterThan(0);
    }
  });
});

describe('从请求快照估算（提交前预估与结算共用同一条路径）', () => {
  const request = {
    resolution: { width: 1280, height: 720 },
    params: { durationSec: 5 },
    options: { model: 'doubao-seedance-2-0-mini-260615' },
  };

  it('正常快照 → 有金额', () => {
    expect(estimateCostFromRequest(request, { track: 'cloud' })?.tokens).toBe(108_000);
  });

  it('缺 resolution / model 不是字符串 → **null**（窄化对着契约做，不硬取字段崩掉）', () => {
    expect(estimateCostFromRequest({ params: {}, options: {} } as never, {})).toBeNull();
    const oddModel = estimateCostFromRequest(
      { ...request, options: { model: { nested: true } } } as never,
      { track: 'cloud' },
    );
    expect(oddModel?.fromPriceTable).toBe(false);
    expect(oddModel?.modelId).toBe('default');
  });
});

describe('金额显示', () => {
  it('小额不显示成 ¥0（否则会被读成免费）', () => {
    expect(formatYuan(0)).toBe('¥0');
    expect(formatYuan(0.0035)).toBe('¥0.0035');
    expect(formatYuan(0.35)).toBe('¥0.350');
    expect(formatYuan(12.3456)).toBe('¥12.35');
    expect(formatYuan(1234.5)).toBe('¥1,235');
  });
});
