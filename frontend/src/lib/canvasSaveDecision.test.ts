import { describe, expect, it } from 'vitest';
import { createEmptyCanvasDoc } from '@astrmira/shared';
import {
  isViewportUnchanged,
  shouldScheduleSave,
  shouldSendPageHideSave,
} from './canvasSaveDecision';

/**
 * 画布保存的三个判断（V2.108 / B85 片 A）。
 *
 * 这三个判断原来都是 `CanvasStudioView` 里的内联条件，而视图**没有渲染测试**（不引 jsdom）——
 * 写错了既不会报错也没有测试症状，只会在某次切换/关标签时**静默少存一次**。
 * 摘成纯函数之后，下面每一条都能直接对拍。
 */
describe('保存判断（V2.108）', () => {
  it('刚读回来的那份 doc 不写回；任何新对象都写', () => {
    const loaded = createEmptyCanvasDoc('p1', '画布');
    // 同一个对象 = 服务端刚给的那份
    expect(shouldScheduleSave(loaded, loaded)).toBe(false);
    // 内容相同但**是新对象** = 发生过一次不可变更新（用户改动/撤销），必须存
    expect(shouldScheduleSave({ ...loaded }, loaded)).toBe(true);
    // 另一个画布
    expect(shouldScheduleSave(createEmptyCanvasDoc('p2', '另一个'), loaded)).toBe(true);
  });

  it('没有文档 → 不排保存', () => {
    expect(shouldScheduleSave(null, null)).toBe(false);
  });

  it('基准被清空后，哪怕是"同一个对象"也要存（撤销回到旧对象的情形）', () => {
    // 视图在 `applyDoc` 里把基准清成 null：撤销栈可能把**刚读回来的那个对象**原样吐回来，
    // 若继续拿身份比，那次撤销就会被当成"刚加载"而**不落盘**。
    const loaded = createEmptyCanvasDoc('p1', '画布');
    expect(shouldScheduleSave(loaded, loaded)).toBe(false);
    expect(shouldScheduleSave(loaded, null)).toBe(true);
  });

  it('关标签补发：只有"脏且没有在飞请求"才发', () => {
    // 脏 + 没在飞 → 发（这是唯一安全的情形：不会与另一条 PUT 撞同一个 revision）
    expect(shouldSendPageHideSave({ isDirty: true, hasInFlight: false })).toBe(true);
    // 有请求在飞 → **不发**：两条同 revision 的 PUT 后到的必然 409，被丢掉的是更新的那份
    expect(shouldSendPageHideSave({ isDirty: true, hasInFlight: true })).toBe(false);
    // 干净 → 不用发
    expect(shouldSendPageHideSave({ isDirty: false, hasInFlight: false })).toBe(false);
    expect(shouldSendPageHideSave({ isDirty: false, hasInFlight: true })).toBe(false);
  });

  it('视口没变就不写（恢复视口也会触发 onMoveEnd）', () => {
    const viewport = { x: 120, y: -40, zoom: 0.8 };
    expect(isViewportUnchanged(viewport, { ...viewport })).toBe(true);
    // 亚像素抖动也算没变（否则每次开画布都白写一次盘）
    expect(isViewportUnchanged(viewport, { x: 120.0004, y: -40, zoom: 0.8 })).toBe(true);
    // 真的平移/缩放
    expect(isViewportUnchanged(viewport, { x: 121, y: -40, zoom: 0.8 })).toBe(false);
    expect(isViewportUnchanged(viewport, { x: 120, y: -40, zoom: 0.81 })).toBe(false);
  });
});
