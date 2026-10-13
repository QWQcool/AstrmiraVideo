import type { GenerationMode, ProviderType } from '@astrmira/shared';

/**
 * 画布层的显示文案（V2.26 / 台账 A5 片 A 收拢）。
 *
 * 为什么单独一个文件：编排模式的节点卡片与事实图节点卡片都要写"这是什么模式/引擎" ——
 * 两份文案各写一遍就会漂移（漂移的表现是同一个模式在两处叫不同名字，用户以为是两个东西）。
 * 这里是**画布内的唯一一份**；工作台/创作入口有自己的文案表（那是另一层，不在本次收拢范围）。
 */
export const CANVAS_MODE_LABELS: Record<GenerationMode, string> = {
  t2v: '文生视频',
  i2v: '图生视频',
  fl2v: '首尾帧',
  v2v: '视频参考',
};

export const CANVAS_PROVIDER_LABELS: Record<ProviderType, string> = {
  'cloud-volcano-seedance': '云端 Seedance',
  'local-minimax-h3': '本地 MiniMax H3',
  // V2.30（A1 片 B / D53）：用户自备的 ComfyUI（引擎与模型都由用户装）
  'host-comfyui': '本地 ComfyUI',
  'stock-local': '素材库（开发期）',
  'fixture-local': '夹具（开发期）',
};
