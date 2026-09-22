import { describe, expect, it } from 'vitest';
import type { AspectRatio } from '@astrmira/shared';
import {
  DEFAULT_DURATION_SEC,
  DEFAULT_RESOLUTION_TIER,
  DURATION_OPTIONS,
  RESOLUTION_TIERS,
  clampDurationSec,
  dialogueLength,
  isMultipleOf32,
  resolveTargetSize,
  tierForSize,
  type ResolutionTier,
} from './format';

/**
 * 目标尺寸表 / 时长 / 档位的纯函数契约（V8.3 批次 1）。
 *
 * 这几条断言的意义不在"现在算得对"，而在**防止两处规则分叉**：
 * - 前端显示的目标尺寸 与 上游 `--resolution` 档位由**不同的代码**推导
 *   （前端 `resolveTargetSize`，后端 `seedanceProtocol.resolutionToTier`），
 *   所以这里把后端的分档阈值（短边 640 / 1000）**逐格复算一遍**；
 * - 时长选项必须落在契约 `DurationSecSchema = positive().max(10)` 之内。
 */

const ASPECTS: readonly AspectRatio[] = ['16:9', '9:16', '1:1'];

describe('清晰度档目标尺寸表', () => {
  it('每一格都是 32 的倍数（契约硬要求）', () => {
    for (const tier of RESOLUTION_TIERS) {
      for (const aspect of ASPECTS) {
        const size = resolveTargetSize(aspect, tier);
        expect(isMultipleOf32(size.width), `${tier} ${aspect} 宽 ${size.width}`).toBe(true);
        expect(isMultipleOf32(size.height), `${tier} ${aspect} 高 ${size.height}`).toBe(true);
      }
    }
  });

  it('短边落在与上游一致的分档区间（<640 → 480p；640~999 → 720p；≥1000 → 1080p）', () => {
    const bins: Record<ResolutionTier, (shortSide: number) => boolean> = {
      '480p': (s) => s < 640,
      '720p': (s) => s >= 640 && s < 1000,
      '1080p': (s) => s >= 1000,
    };

    for (const tier of RESOLUTION_TIERS) {
      for (const aspect of ASPECTS) {
        const { width, height } = resolveTargetSize(aspect, tier);
        const shortSide = Math.min(width, height);
        expect(bins[tier](shortSide), `${tier} ${aspect} 短边 ${shortSide}`).toBe(true);
      }
    }
  });

  it('默认档是 480p，且与历史上的固定值一致（默认行为不变）', () => {
    expect(DEFAULT_RESOLUTION_TIER).toBe('480p');
    expect(resolveTargetSize('16:9')).toEqual({ width: 832, height: 480 });
    expect(resolveTargetSize('9:16')).toEqual({ width: 480, height: 832 });
  });

  it('同一画幅下，档位越高尺寸越大（不出现交叉）', () => {
    for (const aspect of ASPECTS) {
      const areas = RESOLUTION_TIERS.map((tier) => {
        const { width, height } = resolveTargetSize(aspect, tier);
        return width * height;
      });
      expect(areas[1], `${aspect} 面积应递增`).toBeGreaterThan(areas[0] as number);
      expect(areas[2], `${aspect} 面积应递增`).toBeGreaterThan(areas[1] as number);
    }
  });

  it('tierForSize 与档位表互逆（一键回填靠它把像素反推回档位）', () => {
    for (const tier of RESOLUTION_TIERS) {
      for (const aspect of ASPECTS) {
        const { width, height } = resolveTargetSize(aspect, tier);
        expect(tierForSize(width, height), `${tier} ${aspect}`).toBe(tier);
      }
    }
  });
});

describe('时长选项', () => {
  it('全部是 1~10 的整数（契约 `DurationSecSchema` 上限定死 10）', () => {
    for (const seconds of DURATION_OPTIONS) {
      expect(Number.isInteger(seconds)).toBe(true);
      expect(seconds).toBeGreaterThanOrEqual(1);
      expect(seconds).toBeLessThanOrEqual(10);
    }
    expect(DURATION_OPTIONS).toContain(DEFAULT_DURATION_SEC);
  });

  it('clampDurationSec 夹进 1~10，非法输入回落默认值', () => {
    expect(clampDurationSec(0)).toBe(1);
    expect(clampDurationSec(-5)).toBe(1);
    expect(clampDurationSec(99)).toBe(10);
    expect(clampDurationSec(6.4)).toBe(6);
    expect(clampDurationSec(Number.NaN)).toBe(DEFAULT_DURATION_SEC);
    expect(clampDurationSec(Number.POSITIVE_INFINITY)).toBe(DEFAULT_DURATION_SEC);
  });
});

describe('对白长度提示（防线 6 的前端半边）', () => {
  it('中/英引号都算，且只统计引号内字数', () => {
    expect(dialogueLength('她笑着说“我们终于成功了！”')).toBe(8);
    expect(dialogueLength('她说"hi"')).toBe(2);
    expect(dialogueLength('没有对白')).toBe(0);
    expect(dialogueLength('“甲”“乙”')).toBe(2);
  });
});
