import { createContext, useContext } from 'react';
import type { CanvasDoc, TaskProgress } from '@astrmira/shared';
import type { CanvasDraftPatch } from '../../lib/canvasDocOps';

/**
 * 画布编辑器的共享服务（Step 11-S3 片 B3）。
 *
 * 为什么用 context 而不是把数据塞进 React Flow 的 `node.data`：
 * 节点卡要显示**最新的草稿与批次**，而 RF 的 nodes 数组只在布局变化时重建
 * （否则每 2 秒一次轮询都会重建节点、打断拖动）。把 `doc` 放在 context 里，
 * 节点卡永远读当前值，RF 只负责位置与选中。
 */
export interface StudioServices {
  doc: CanvasDoc;
  /** 运行中的任务（只用于显示百分比；**不落盘**，见 CONTRACT §21-10） */
  live: Record<string, TaskProgress>;
  /** 正在等提交响应的节点（按钮转圈 + 防连点） */
  submitting: ReadonlySet<string>;
  onDraftChange(nodeId: string, patch: CanvasDraftPatch): void;
  onSubmit(nodeId: string): void;
}

const StudioContext = createContext<StudioServices | null>(null);

export const StudioProvider = StudioContext.Provider;

export function useStudio(): StudioServices {
  const services = useContext(StudioContext);
  if (services === null) {
    // 开发者不变式（组件挂错地方），不是界面文案
    throw new Error('useStudio 必须在 <StudioProvider> 内使用（画布节点卡只在画布视图里渲染）');
  }
  return services;
}
