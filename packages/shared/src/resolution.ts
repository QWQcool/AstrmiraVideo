import { z } from 'zod';
import type { AspectRatio } from './request.js';

/**
 * 清晰度档 → 目标尺寸（**全项目唯一一张表**）。
 *
 * ## 为什么要收进 shared
 * 2026-10 之前这件事有两份实现：前端 `lib/format.ts` 里有一张对齐好的表（832×480 / 1280×704 /
 * 1920×1056），后端 `creationRunEngine` 里另写了一个 `Math.round(base*16/9)` 的算式
 * （853×480 / 1280×720 / 1920×1080）。两份结果**不一致**，而且后一份：
 * ① 三条边都不是 32 的倍数（ComfyUI 要求 32 对齐，会被 provider 再缩一次，
 *    于是"实际出的片"和"界面承诺的尺寸"不是同一个数）；
 * ② 1080p 的 1920×1080 超出本表给 1080p 定的预算（1920×1056），等于悄悄突破档位。
 *
 * 现在只有这一张表：前端显示用它、后端按它提交、测试逐格断言 32 对齐。
 *
 * ## 边界（如实）
 * - 这是**目标**尺寸，不是产物尺寸承诺：上游可能返回别的尺寸（云端按自己的档位规则、
 *   本地按模板约束），差异必须由调用方如实展示，不能拿这张表当"实际产物"的证据。
 * - 1080p 的短边（1056）刻意小于 1080，理由与 720p 的 704 相同：32 对齐后略降一点，
 *   避免为凑整把像素预算顶破。
 */
export const ResolutionTierSchema = z.enum(['480p', '720p', '1080p']);
export type ResolutionTier = z.infer<typeof ResolutionTierSchema>;

/** 默认档（与历史行为一致：480p 是 10GB 卡跑视频的实测上限） */
export const DEFAULT_RESOLUTION_TIER: ResolutionTier = '480p';

/** ComfyUI 与多数视频模型要求边是 32 的倍数 */
export const RESOLUTION_ALIGN = 32;

export interface TargetSize {
  width: number;
  height: number;
}

export const TIER_TARGET_SIZES: Record<ResolutionTier, Record<AspectRatio, TargetSize>> = {
  '480p': {
    '16:9': { width: 832, height: 480 },
    '9:16': { width: 480, height: 832 },
    '1:1': { width: 480, height: 480 },
  },
  '720p': {
    '16:9': { width: 1280, height: 704 },
    '9:16': { width: 704, height: 1280 },
    '1:1': { width: 704, height: 704 },
  },
  '1080p': {
    '16:9': { width: 1920, height: 1056 },
    '9:16': { width: 1056, height: 1920 },
    '1:1': { width: 1056, height: 1056 },
  },
};

/** 目标渲染尺寸 = 画幅 × 清晰度档 */
export function resolveTierSize(
  tier: ResolutionTier = DEFAULT_RESOLUTION_TIER,
  aspect: AspectRatio,
): TargetSize {
  return TIER_TARGET_SIZES[tier][aspect];
}

/**
 * 由像素尺寸反推档位（参数一键回填用：快照里存的是 `resolution` 像素，不是档位名）。
 * 归档口径按**短边**，与后端 `seedanceProtocol.resolutionToTier` 一致。
 */
export function tierForSize(width: number, height: number): ResolutionTier {
  const shortSide = Math.min(width, height);
  if (shortSide >= 1000) return '1080p';
  if (shortSide >= 640) return '720p';
  return '480p';
}

/** 边是否落在 32 的倍数上（单纯取模，不做取整） */
export function isAlignedTo32(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value % RESOLUTION_ALIGN === 0;
}

/**
 * 把任意尺寸**向下**对齐到 32 的倍数（只缩不放）。
 *
 * 为什么向下：向上会让"对齐"变成"悄悄加像素"，超出档位预算后上游可能直接拒绝
 * （ComfyUI 会按自己的预算再缩一次，用户看到的又是第三个尺寸）。宁可差几像素，
 * 也不要在预算上做没写进契约的加法。
 */
export function alignDownTo32(size: TargetSize): TargetSize {
  return {
    width: Math.max(RESOLUTION_ALIGN, Math.floor(size.width / RESOLUTION_ALIGN) * RESOLUTION_ALIGN),
    height: Math.max(RESOLUTION_ALIGN, Math.floor(size.height / RESOLUTION_ALIGN) * RESOLUTION_ALIGN),
  };
}
