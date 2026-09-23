import { PlaceholderView } from './PlaceholderView';

/** 总览（V9 · B3 填）：四卡 + 最近成片九宫格 + 最近操作 feed */
export function OverviewView() {
  return (
    <PlaceholderView
      title="总览"
      eyebrow="Overview"
      until="此视图在 B3 上线：今日生成 / 成功率 / 队列中 / 存储占用（带去清理入口）四卡 + 最近成片九宫格 + 最近操作 feed——全部聚合自现有 /api/history 与 /api/logs（方案 A 的最小契约增量：createdAt / outputSizeBytes / storage）。"
    />
  );
}
