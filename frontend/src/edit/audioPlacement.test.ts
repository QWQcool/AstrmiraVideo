import { describe, expect, it } from 'vitest';
import {
  AUDIO_BED_VOLUME,
  AUDIO_FADE_IN_MAX,
  AUDIO_FADE_OUT_MAX,
  planAudioPlacement,
} from './audioPlacement';

/**
 * 音频自动落轨的排布规则（V2.106）。
 *
 * 这组断言存在的理由：**"配乐比片子短"这种错在界面上看不出来**，导出后才发现后半段没声音。
 */
describe('音频自动落轨的排布', () => {
  it('配音比片子短 → 只放一次，不循环，音量 1.0', () => {
    const placement = planAudioPlacement(150, 90, false);
    expect(placement.segments).toHaveLength(1);
    expect(placement.segments[0]).toMatchObject({ atFrame: 0, frames: 90 });
    expect(placement.volume).toBe(1);
    expect(placement.coveredFrames).toBe(90);
  });

  it('配音比片子长 → 裁到片长（导出时长不会被一条旁白撑长）', () => {
    const placement = planAudioPlacement(150, 300, false);
    expect(placement.segments).toHaveLength(1);
    expect(placement.segments[0]?.frames).toBe(150);
    expect(placement.coveredFrames).toBe(150);
  });

  it('配乐(30s) 比片子(90s) 短 → 铺 3 段首尾相接，只有首尾有淡入淡出', () => {
    const placement = planAudioPlacement(2700, 900, true);
    expect(placement.segments.map((segment) => segment.atFrame)).toEqual([0, 900, 1800]);
    expect(placement.segments.map((segment) => segment.frames)).toEqual([900, 900, 900]);
    // 中间那段两端都不淡：每段都淡一次的话，听感是"每 30 秒断一下"
    expect(placement.segments[1]?.fadeInFrames).toBe(0);
    expect(placement.segments[1]?.fadeOutFrames).toBe(0);
    expect(placement.segments[0]?.fadeInFrames).toBeGreaterThan(0);
    expect(placement.segments[2]?.fadeOutFrames).toBeGreaterThan(0);
    expect(placement.volume).toBe(AUDIO_BED_VOLUME);
    expect(placement.coveredFrames).toBe(2700);
  });

  it('铺不满一整段时，最后一段按剩余长度裁齐（覆盖正好等于片长）', () => {
    // 片长 1000 帧、音频 400 帧 → 3 段：400 + 400 + 200
    const placement = planAudioPlacement(1000, 400, true);
    expect(placement.segments.map((segment) => segment.frames)).toEqual([400, 400, 200]);
    expect(placement.segments.at(-1)?.atFrame).toBe(800);
    expect(placement.coveredFrames).toBe(1000);
  });

  it('配乐比片子长 → 只放一段并裁到片长', () => {
    const placement = planAudioPlacement(150, 900, true);
    expect(placement.segments).toHaveLength(1);
    expect(placement.segments[0]?.frames).toBe(150);
    expect(placement.segments[0]?.fadeInFrames).toBeGreaterThan(0);
    expect(placement.segments[0]?.fadeOutFrames).toBeGreaterThan(0);
  });

  it('淡入淡出不超过上限（短片段不该被淡成"没有声音"）', () => {
    // 20 帧的极短音效：淡入 min(8, 5)=5、淡出 min(15, 6)=6，都小于片段本身
    const placement = planAudioPlacement(20, 20, true);
    const segment = placement.segments[0]!;
    expect(segment.fadeInFrames).toBeLessThanOrEqual(AUDIO_FADE_IN_MAX);
    expect(segment.fadeOutFrames).toBeLessThanOrEqual(AUDIO_FADE_OUT_MAX);
    expect(segment.fadeInFrames + segment.fadeOutFrames).toBeLessThan(segment.frames);
  });

  it('没片子 / 没音频 → 空排布（不放任何东西）', () => {
    expect(planAudioPlacement(0, 90, true).segments).toHaveLength(0);
    expect(planAudioPlacement(150, 0, true).segments).toHaveLength(0);
    expect(planAudioPlacement(-5, -5, false).coveredFrames).toBe(0);
  });
});
