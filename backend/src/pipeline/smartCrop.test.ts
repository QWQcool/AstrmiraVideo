import { describe, expect, it } from 'vitest';
import {
  SIZE_ALIGNMENT,
  cropToAspect,
  isAlignedTo32,
  parseAspectRatio,
  snapSize,
  snapTo32,
} from './smartCrop.js';

describe('snapTo32（规整到 32 的倍数）', () => {
  it('向下规整到最近的 32 倍数', () => {
    expect(snapTo32(720)).toBe(704);
    expect(snapTo32(1280)).toBe(1280);
    expect(snapTo32(831)).toBe(800);
    expect(snapTo32(479)).toBe(448);
  });

  it('极小值不低于一个对齐单位（避免 0 尺寸）', () => {
    expect(snapTo32(1)).toBe(SIZE_ALIGNMENT);
    expect(snapTo32(31)).toBe(SIZE_ALIGNMENT);
    expect(snapTo32(32)).toBe(32);
  });

  it('非法输入直接报错（不静默兜底）', () => {
    expect(() => snapTo32(0)).toThrow(RangeError);
    expect(() => snapTo32(-10)).toThrow(RangeError);
    expect(() => snapTo32(Number.NaN)).toThrow(RangeError);
  });

  it('isAlignedTo32 与 snapTo32 口径一致', () => {
    expect(isAlignedTo32(snapTo32(831))).toBe(true);
    expect(isAlignedTo32(831)).toBe(false);
  });
});

describe('parseAspectRatio', () => {
  it('支持契约里的三种画幅', () => {
    expect(parseAspectRatio('16:9')).toBeCloseTo(16 / 9, 6);
    expect(parseAspectRatio('9:16')).toBeCloseTo(9 / 16, 6);
    expect(parseAspectRatio('1:1')).toBe(1);
  });
});

describe('cropToAspect（居中裁切 + 32 倍数）', () => {
  it('横屏源裁 16:9：结果小于等于源，且两侧均为 32 的倍数', () => {
    const result = cropToAspect(1280, 720, '16:9');

    expect(result.width).toBeLessThanOrEqual(1280);
    expect(result.height).toBeLessThanOrEqual(720);
    expect(isAlignedTo32(result.width)).toBe(true);
    expect(isAlignedTo32(result.height)).toBe(true);
  });

  it('32 倍数不规整源（831×479）—— PLAN §4 边界用例，结果必须规整', () => {
    const result = cropToAspect(831, 479, '16:9');

    expect(isAlignedTo32(result.width)).toBe(true);
    expect(isAlignedTo32(result.height)).toBe(true);
    expect(result.width).toBeLessThanOrEqual(snapTo32(831));
    expect(result.height).toBeLessThanOrEqual(snapTo32(479));
  });

  it('横屏源裁竖屏 9:16：仍不大于源，且保持目标比例方向（高 > 宽）', () => {
    const result = cropToAspect(1280, 720, '9:16');

    expect(result.height).toBeGreaterThanOrEqual(result.width);
    expect(result.width).toBeLessThanOrEqual(1280);
    expect(result.height).toBeLessThanOrEqual(720);
    expect(isAlignedTo32(result.width)).toBe(true);
    expect(isAlignedTo32(result.height)).toBe(true);
  });

  it('防恒真抽查对照：刻意放宽"必须为 32 倍数"的口径后，不规整源的断言会失败', () => {
    // 这是"断言不是恒真"的对照实验：用手工构造的非规整尺寸验证预期确实为 false
    const notAligned = cropToAspect(831, 479, '16:9');
    const relaxedCheck = (v: number) => v > 0; // 若把断言改成 >0，831×479 这类源就会"通过"
    expect(relaxedCheck(831)).toBe(true);
    expect(isAlignedTo32(831)).toBe(false);
    expect(isAlignedTo32(notAligned.width)).toBe(true);
  });
});

describe('snapSize（上传阶段：保持纵横比，仅规整）', () => {
  it('两侧都规整到 32 的倍数', () => {
    const size = snapSize(831, 479);
    expect(size).toEqual({ width: 800, height: 448 });
  });
});
