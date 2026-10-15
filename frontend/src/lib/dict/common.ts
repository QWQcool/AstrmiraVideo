/**
 * **跨视图共享**的文案（模式名 / 任务状态 / 素材种类 / 算力归属）。
 *
 * ## 为什么单独成域
 * 这些词在**多个视图**里出现（创作入口、工作台、视频库、画布、成本台账），
 * 而且是"同一件事的同一个名字"—— 各视图各写一份中文，迟早会出现
 * "这边叫『图生视频』、那边叫『图片生视频』"这种漂移。放进 common 域 = **一处定义**。
 *
 * ## 迁移进度
 * 本域在**创作入口批次**建立（2026-10-15）；画布 / 工作台 / 视频库那几个视图
 * 会在各自的批次里**改成引用这里**（它们现在还有自己的那一份，见 `canvas/labels.ts`）。
 */

export const COMMON_ZH = {
  // ── 生成模式（`GenerationMode`）──
  'common.mode.t2v': '文生视频',
  'common.mode.i2v': '图生视频',
  'common.mode.fl2v': '首尾帧',
  'common.mode.v2v': '视频参考',

  // ── 任务状态（`TaskProgress['status']`）──
  'common.status.queued': '排队中',
  'common.status.running': '生成中',
  'common.status.succeeded': '已完成',
  'common.status.failed': '失败',
  'common.status.cancelled': '已取消',

  // ── 素材种类 ──
  'common.kind.image': '图片',
  'common.kind.video': '视频',

  // ── 算力归属（"这一段跑在哪"）──
  'common.scope.cloud': '云端',
  'common.scope.local': '本地',
  'common.engine.cloud': '云端 Seedance',
};

export const COMMON_EN = {
  'common.mode.t2v': 'Text to video',
  'common.mode.i2v': 'Image to video',
  'common.mode.fl2v': 'First/last frame',
  'common.mode.v2v': 'Video reference',

  'common.status.queued': 'Queued',
  'common.status.running': 'Generating',
  'common.status.succeeded': 'Done',
  'common.status.failed': 'Failed',
  'common.status.cancelled': 'Cancelled',

  'common.kind.image': 'image',
  'common.kind.video': 'video',

  'common.scope.cloud': 'Cloud',
  'common.scope.local': 'Local',
  'common.engine.cloud': 'Cloud Seedance',
};
