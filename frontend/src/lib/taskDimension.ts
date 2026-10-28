import type { TaskProgress } from '@astrmira/shared';

/**
 * 产物**实测尺寸**与请求**计划尺寸**是否不一致（B98 片 B）。
 *
 * 为什么要在界面上说出来：`requestSnapshot.resolution` 是"我要的"，`outputDimension` 是
 * "实际出的"。上游按自己的档位规则出别的尺寸是**允许的**（云端尤其常见），但如果界面只显示
 * 计划值，用户会以为拿到的是那个尺寸 —— 那是撒谎。这里只在**两边都有且确实不同**时返回 true：
 * - 没探到实际尺寸（老任务 / 文件已清理 / 编码不认）→ false：无话可说就不要说；
 * - 请求没写 resolution（老客户端）→ false：没有可比的对象。
 */
export function requestedDimensionMismatch(task: Pick<TaskProgress, 'requestSnapshot' | 'outputDimension'>): boolean {
  const actual = task.outputDimension;
  const planned = task.requestSnapshot.resolution;
  if (actual === undefined || planned === undefined) return false;
  return actual.width !== planned.width || actual.height !== planned.height;
}
