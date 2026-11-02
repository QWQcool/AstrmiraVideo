import type { CanvasDoc } from '@astrmira/shared';

/**
 * 画布保存的**三个判断**（V2.108 / 台账 B85 片 A）—— 纯函数，从视图里摘出来好被断言。
 *
 * 为什么值得单独成文件：这三条原来都是视图里的内联条件，而视图在本仓**没有渲染测试**
 * （不引 jsdom，见 PLAN 的测试纪律）。后果是"判断写错"既没有测试症状、也不会报错，
 * 只会在某次切换/关闭标签时**静默少存一次**。
 */

/**
 * 这份 doc 该不该排进保存队列。
 *
 * 原实现用一次性布尔闸门（`skipSaveRef`）：打开/新建后置真，由保存 effect 消费掉。
 * 问题在于它**不绑文档**——只要 effect 的消费比别人慢一步，被吃掉的就是**用户的第一次真实修改**，
 * 而且顶栏仍会显示"已保存"。
 *
 * 现在比的是**对象身份**：刚读回来的那份 doc 是服务端给的同一个对象，不写回；任何真实修改
 * 都经过不可变更新产生新对象，必然 ≠ 它。没有闸门要消费，也就没有"被谁吃掉"这回事。
 */
export function shouldScheduleSave(doc: CanvasDoc | null, loadedDoc: CanvasDoc | null): boolean {
  if (doc === null) return false;
  return doc !== loadedDoc;
}

/**
 * 关标签/刷新时要不要再补一发 `keepalive` PUT。
 *
 * 只在**没有请求在飞**时补：两条 PUT 会用**同一个 revision**，服务端接受先到的、后到的必然 409 ——
 * 也就是说补发那一发（带着更新的内容）会被**丢掉**，等于把最后一次修改弄丢。
 * 有请求在飞时交给 `beforeunload` 的确认框：用户取消就能让在飞请求跑完。
 */
export function shouldSendPageHideSave(flags: { isDirty: boolean; hasInFlight: boolean }): boolean {
  return flags.isDirty && !flags.hasInFlight;
}

/** 视口是否没变（`onMoveEnd` 会在恢复视口时也被触发，没必要为此写一次盘） */
export function isViewportUnchanged(
  current: { x: number; y: number; zoom: number },
  next: { x: number; y: number; zoom: number },
  epsilon = 0.001,
): boolean {
  return (
    Math.abs(current.x - next.x) < epsilon &&
    Math.abs(current.y - next.y) < epsilon &&
    Math.abs(current.zoom - next.zoom) < epsilon
  );
}
