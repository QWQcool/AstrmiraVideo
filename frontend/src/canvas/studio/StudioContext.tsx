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
/**
 * 参考的缩略图（2026-10-24「引用缩略图」）。
 *
 * 与即梦一致的取向：参考在输入区里**看得见图**，而不是一串 id。
 * `url` 一定是同源 `/media/*`（调用方已做校验），组件层不再拼路径。
 */
export interface ReferencePreview {
  kind: 'image' | 'video';
  url: string;
}

export interface StudioServices {
  doc: CanvasDoc;
  /** 运行中的任务（只用于显示百分比；**不落盘**，见 CONTRACT §21-10） */
  live: Record<string, TaskProgress>;
  /** 正在等提交响应的节点（按钮转圈 + 防连点） */
  submitting: ReadonlySet<string>;
  onDraftChange(nodeId: string, patch: CanvasDraftPatch): void;
  onSubmit(nodeId: string): void;
  /**
   * V2.77：把节点**当前可见产物**放大（`mode:'upscale'`）。
   * 不复用草稿参考 —— "超清"是对已经出来的那张图动手，不是对输入再生成一次。
   */
  onUpscale(nodeId: string, scale: 2 | 4): void;
  /**
   * V2.78：拿蒙版做局部重绘。`mask` 是**原图尺寸**的 PNG（白=重画），
   * 上传与尺寸校验都在实现侧，组件只负责画笔。
   */
  onInpaint(nodeId: string, mask: Blob, size: { width: number; height: number }): void;
  /** V2.81（分组）：点组标题 → 选中全部成员 */
  onSelectGroup(groupId: string): void;
  /** 双击标题改名 */
  onRenameGroup(groupId: string, title: string): void;
  /** 解散分组（**只删组，不删节点**） */
  onRemoveGroup(groupId: string): void;
  /**
   * V2.79：扩图（`mode:'outpaint'`）。`size` 是底图真实宽高，`expand` 是四边外扩像素
   * （调用方已按 8 对齐；服务端会再校验一次）。
   */
  onOutpaint(
    nodeId: string,
    expand: { left: number; top: number; right: number; bottom: number },
    size: { width: number; height: number },
  ): void;
  /**
   * 按 assetId 取参考缩略图；**取不到就返回 null**（上传素材、抽帧失败、外部导入都可能没有）。
   * 组件层必须能退化回纯文字标签 —— 不假装有图。
   */
  referencePreview(assetId: string): ReferencePreview | null;
  /** V2.49：核对“提交结果未知”的批次（用原请求 + 原幂等键重放） */
  onRecover(nodeId: string, batchId: string): void;
  /** S5-Ac：从资产库给节点添加参考（不新建节点、不复制文件） */
  onAddReference(nodeId: string): void;
  /** S5-B3：选择节点预览的批次版本（只允许成功且有产物的批次） */
  onSelectBatch(nodeId: string, batchId: string): void;
  /** S5-B3b：用当前可见版本创建一个邻近草稿节点（不提交） */
  onContinueFromVersion(nodeId: string): void;
  /** S5-B3d：把选中批次的真实 request 回填到当前节点草稿（不提交） */
  onReuseBatch(nodeId: string, batchId: string): void;
  /** S5-B4f：窄屏底部抽屉的关闭（取消这个节点的选中态） */
  onDeselect(nodeId: string): void;
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
