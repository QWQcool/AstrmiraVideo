import { describe, expect, it } from 'vitest';
import { taskOutput } from '@astrmira/shared';

/**
 * `taskOutput()`（V2.40）—— 产物读取的**唯一收口**。
 *
 * 为什么值得单测：它是 5 个渲染点（画廊卡 / 中央视窗 / 视频库 / 画布 / 创作入口）共同的判据，
 * 写错了症状是"图片任务显示成空白 / 视频任务被当成图片"，而单看某处分支很难发现。
 */
describe('taskOutput · 产物读取收口', () => {
  it('视频产物 → kind video', () => {
    expect(taskOutput({ outputVideoUrl: '/media/a.mp4' })).toEqual({
      kind: 'video',
      url: '/media/a.mp4',
    });
  });

  it('图片产物（`t2i`）→ kind image', () => {
    expect(taskOutput({ outputImageUrl: '/media/a.png' })).toEqual({
      kind: 'image',
      url: '/media/a.png',
    });
  });

  it('都没有 → none（未完成 / 失败 / 已被清理 / 空串）', () => {
    expect(taskOutput({})).toEqual({ kind: 'none' });
    expect(taskOutput({ outputVideoUrl: '', outputImageUrl: '' })).toEqual({ kind: 'none' });
  });

  it('**脏数据时视频优先**（契约是"至多一个"，但 V2.40 之前只存在过视频这一种形状）', () => {
    expect(taskOutput({ outputVideoUrl: '/media/a.mp4', outputImageUrl: '/media/b.png' })).toEqual({
      kind: 'video',
      url: '/media/a.mp4',
    });
  });
});
