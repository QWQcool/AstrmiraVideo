import { describe, expect, it } from 'vitest';
import {
  alignDownTo32,
  DEFAULT_RESOLUTION_TIER,
  isAlignedTo32,
  RESOLUTION_ALIGN,
  resolveTierSize,
  tierForSize,
  TIER_TARGET_SIZES,
  type AspectRatio,
  type ResolutionTier,
} from '@astrmira/shared';

const TIERS: ResolutionTier[] = ['480p', '720p', '1080p'];
const ASPECTS: AspectRatio[] = ['16:9', '9:16', '1:1'];

/**
 * B98 · 档位 → 尺寸只允许有一张表。
 *
 * 这组用例钉的是 2026-10 修掉的一个真缺陷：后端 `creationRunEngine` 曾用
 * `Math.round(base*16/9)` 自己算（853×480 / 1280×720 / 1920×1080），与前端表
 * （832×480 / 1280×704 / 1920×1056）**不是同一组数**：
 * 非 32 对齐会被 ComfyUI 再缩一次、1080p 还越了档位预算。
 */
describe('B98 · 档位 → 目标尺寸（shared 唯一一张表）', () => {
  it('九格逐一落在 32 的倍数上', () => {
    for (const tier of TIERS) {
      for (const aspect of ASPECTS) {
        const size = resolveTierSize(tier, aspect);
        expect(isAlignedTo32(size.width), `${tier} ${aspect} 宽 ${size.width}`).toBe(true);
        expect(isAlignedTo32(size.height), `${tier} ${aspect} 高 ${size.height}`).toBe(true);
      }
    }
  });

  it('档位之间严格递增（同画幅下大档不会比小档小）', () => {
    for (const aspect of ASPECTS) {
      const px = TIERS.map((tier) => {
        const size = resolveTierSize(tier, aspect);
        return size.width * size.height;
      });
      expect(px[1]).toBeGreaterThan(px[0]!);
      expect(px[2]).toBeGreaterThan(px[1]!);
    }
  });

  it('短边与档名对得上（480 / 704 / 1056）', () => {
    for (const tier of TIERS) {
      for (const aspect of ASPECTS) {
        const size = resolveTierSize(tier, aspect);
        const shortSide = Math.min(size.width, size.height);
        expect(shortSide).toBe(tier === '480p' ? 480 : tier === '720p' ? 704 : 1056);
      }
    }
  });

  it('旧后端口径就是不达标的那个：853 与 1080 都不是 32 的倍数', () => {
    expect(isAlignedTo32(853)).toBe(false);
    expect(isAlignedTo32(1080)).toBe(false);
    // 现在走表：480p 16:9 = 832×480；1080p 16:9 = 1920×1056（短边 < 1080，不越预算）
    expect(resolveTierSize('480p', '16:9')).toEqual({ width: 832, height: 480 });
    expect(resolveTierSize('1080p', '16:9')).toEqual({ width: 1920, height: 1056 });
    expect(Math.min(resolveTierSize('1080p', '16:9').width, resolveTierSize('1080p', '16:9').height)).toBeLessThan(1080);
  });

  it('缺省档 = 480p（历史行为不变）', () => {
    expect(resolveTierSize(undefined, '16:9')).toEqual(
      TIER_TARGET_SIZES[DEFAULT_RESOLUTION_TIER]['16:9'],
    );
  });

  it('tierForSize 与表互相对得上（参数回填用）', () => {
    for (const tier of TIERS) {
      for (const aspect of ASPECTS) {
        const size = resolveTierSize(tier, aspect);
        expect(tierForSize(size.width, size.height), `${tier} ${aspect}`).toBe(tier);
      }
    }
  });

  it('alignDownTo32 只缩不放，结果总是 32 的倍数，且不塌到 0', () => {
    expect(alignDownTo32({ width: 853, height: 480 })).toEqual({ width: 832, height: 480 });
    expect(alignDownTo32({ width: 1920, height: 1080 })).toEqual({ width: 1920, height: 1056 });
    expect(alignDownTo32({ width: 832, height: 480 })).toEqual({ width: 832, height: 480 });
    expect(alignDownTo32({ width: 8, height: 8 })).toEqual({
      width: RESOLUTION_ALIGN,
      height: RESOLUTION_ALIGN,
    });
  });
});
