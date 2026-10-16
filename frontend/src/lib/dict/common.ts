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

  /**
   * 状态名的**第二套口径**（`lib/format.ts` 的 `statusLabel`：徽章 / 时间码行 / 画廊卡）。
   *
   * 为什么两套并存而不是合并：它们**修的语感不同** —— 徽章说"失败"（一个判定），
   * 中央视窗说"**未完成**"（它连成片都没有，说"失败"过重；用户可能在别处还能看到成片）。
   * 合并会**改掉界面文案**，而迁移不改文案。差异写在这里，免得后来者当它是笔误。
   */
  'common.statusLabel.queued': '排队中',
  'common.statusLabel.running': '生成中',
  'common.statusLabel.succeeded': '已完成',
  'common.statusLabel.failed': '未完成',
  'common.statusLabel.cancelled': '已取消',

  // ── 素材种类 ──
  'common.kind.image': '图片',
  'common.kind.video': '视频',

  // ── 算力归属（"这一段跑在哪"）──
  'common.scope.cloud': '云端',
  'common.scope.local': '本地',
  'common.engine.cloud': '云端 Seedance',

  /**
   * ── 执行位置 `executedBy` 的显示名（V2.27 / 台账 B11；语言迁移第十二批收敛）──
   *
   * 这三对（短标签 + 完整说法）原先来自 `@astrmira/shared` 的 `EXECUTED_BY_LABELS` /
   * `EXECUTED_BY_TITLES`，**三处前端都在用它**（画布节点卡 / 工作台画廊卡 / 视频库）——
   * 那正是"两处各写一遍必然漂移"的形态，只是漂移发生在**共享包与界面语言之间**：
   * 共享包里的是中文常量，英文界面下只能显示中文。
   *
   * 收敛做法：**前端改用这份字典**；共享包那两个常量**保留**（它们是"前后端唯一一份"的声明，
   * 后端将来要用仍可用）。为了不让两份中文**悄悄漂移**，`lib/format.test.ts` 里有一条
   * **逐字比对**的断言（把字典的中文与共享常量对拍）—— 改一边而忘了另一边会立刻变红。
   *
   * ⚠️ **完整说法那三句比标签重要**：三个位置对"数据去了哪"的含义完全不同，
   * 用户有权一眼看到（`title` 悬停）。中英语气必须同样明确，不能弱化成 "probably local"。
   */
  'common.executedBy.cloud': '云端',
  'common.executedBy.hostLocal': '本机',
  'common.executedBy.clientWorker': '你的电脑',
  'common.executedBy.title.cloud': '产物在云端生成：提示词与参考图会发到上游服务商',
  'common.executedBy.title.hostLocal': '在本服务所在机器上跑：数据不出这台机器',
  'common.executedBy.title.clientWorker':
    '在你的设备上执行（含浏览器端渲染的剪辑产物）：服务端不持有中间产物',

  // ── 通用动作 / 状态 ──
  'common.remove': '移除',
  'common.uploading': '上传中…',
  'common.submit.pending': '提交中…',
  'common.delete': '删除',

  // ── 产物来源的**行内前缀**（引用弹层 / 成片下拉都用同一对）──
  'common.origin.editBadge': '✂ 剪辑产物 · ',
  'common.origin.renderBadge': '成片 · ',

  // ── 费用（**口径与后缀**：创作入口与工作台显示的是同一件事，必须同一份）──
  'common.cost.title': '按公开价目与上游计费式估算；实际以方舟账单为准',
  'common.cost.estimated': '预计花费 {amount}',
  'common.cost.localFree': '（本地轨：无 API 费用）',
  'common.cost.estimateOnly': '（预估）',
  'common.cost.customTier': '（自定义档按 2.0 标准口径估算）',
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

  'common.statusLabel.queued': 'Queued',
  'common.statusLabel.running': 'Generating',
  'common.statusLabel.succeeded': 'Done',
  'common.statusLabel.failed': 'Not finished',
  'common.statusLabel.cancelled': 'Cancelled',

  'common.kind.image': 'image',
  'common.kind.video': 'video',

  'common.scope.cloud': 'Cloud',
  'common.scope.local': 'Local',
  'common.engine.cloud': 'Cloud Seedance',

  'common.executedBy.cloud': 'Cloud',
  'common.executedBy.hostLocal': 'This machine',
  'common.executedBy.clientWorker': 'Your device',
  'common.executedBy.title.cloud':
    'Produced in the cloud: the prompt and reference images are sent to the upstream provider',
  'common.executedBy.title.hostLocal':
    'Runs on the machine hosting this service: data never leaves it',
  'common.executedBy.title.clientWorker':
    'Runs on your device (including browser-rendered edit output): the server holds no intermediate files',

  'common.remove': 'Remove',
  'common.uploading': 'Uploading…',
  'common.submit.pending': 'Submitting…',
  'common.delete': 'Delete',

  'common.origin.editBadge': '✂ Edited · ',
  'common.origin.renderBadge': 'Render · ',

  'common.cost.title': 'Estimated from public pricing and upstream billing; your Ark bill is authoritative',
  'common.cost.estimated': 'Estimated cost {amount}',
  'common.cost.localFree': ' (local track: no API cost)',
  'common.cost.estimateOnly': ' (estimate)',
  'common.cost.customTier': ' (custom tier estimated at the 2.0 rate)',
};
