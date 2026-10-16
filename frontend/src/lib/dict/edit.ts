/**
 * **剪辑台域**的文案（语言迁移第十六批；域随"跨包决策"落地而建）。
 *
 * ## 这一域的特殊之处：它的词表原先是 `@astrmira/shared` 里的中文常量
 * 那几张表（操作名 / 轨道名 / 字幕预设 / 字幕位置 / 转场名 / 日志动作名）当时的注释写着
 * "前端与后端共用一份，避免两处漂移" —— 但**后端只存 id、从不存中文**
 * （那句"避免中文进库后改文案要迁数据"就是原话）。于是它们实际上**只有前端在用**，
 * 而中文常量表**没法双语**：英文界面下只能显示中文。
 *
 * 判据是**"这句话给谁看"**：
 * - **给人看** → 搬进这里（键表在 `frontend/src/edit/model.ts` 与 `lib/format.ts`，
 *   `Record<id, MessageKey>` 带来一条编译期保证：**共享包里新增一个 id、前端忘了加键会直接编译不过**）；
 * - **给模型看**（配方分类名进提示词）→ 留在共享包，但**改名为"提示词用词"**
 *   （`RECIPE_CATEGORY_PROMPT_WORDS`），两份中文由对拍断言钉住一致；
 * - **数据形状**（`EditOriginLike` 等）→ 留在共享包（那才是真正的领域契约）。
 *
 * ⚠️ 未知动作**原样返回 id**（`logActionLabel` 的原有语义）：宁可显示 id 也不显示空白
 * —— 空白最容易被当成"没这回事"，而 id 至少能搜。
 */

export const EDIT_ZH = {
  // ── 剪辑操作名（原 `EDIT_OPERATION_LABELS`；界面显示在视频库详情的"剪辑来源"列表里）──
  'edit.op.trim': '裁剪',
  'edit.op.concat': '拼接',
  'edit.op.xfade': '转场',
  'edit.op.volume': '音量',
  'edit.op.speed': '变速',
  'edit.op.extractFrame': '抽帧',

  // ── 轨道名（时间轴左侧）──
  'edit.track.video': '镜头',
  'edit.track.caption': '字幕',
  'edit.track.transition': '转场',
  'edit.track.audio': '音效',

  // ── 字幕预设与位置（属性面板）──
  'edit.captionPreset.plain': '静态',
  'edit.captionPreset.fade': '淡入淡出',
  'edit.captionPreset.wordSlide': '逐词入场（位移+模糊）',
  'edit.captionPreset.typewriter': '打字机',
  'edit.captionPosition.bottom': '底部',
  'edit.captionPosition.center': '居中',
  'edit.captionPosition.top': '顶部',

  // ── 转场名（时间轴片段与属性面板；与契约 §11-2 的 xfade 同口径）──
  'edit.transition.fade': '淡入淡出',
  'edit.transition.wipeleft': '左揭幕',
  'edit.transition.slideright': '右滑入',

  // ── 剪辑来源的一句话摘要（原 `describeEditOrigin`）──
  // 它是**格式化**而不是词汇（中文"3 轨 · 12 个片段" / 英文"3 tracks · 12 clips"）——
  // 所以搬回前端，而不是留在共享包。
  'edit.origin.projectSummary': '{tracks} 轨 · {clips} 个片段',
  'edit.origin.scriptSummary': '{count} 步 EDL',
  'edit.origin.fallback': '剪辑产物',

  // ── 操作日志的动作名（原 `LOG_ACTION_LABELS`；三处共用：日志页 / 画布节点留痕 / 总览活动流）──
  'edit.logAction.generateSubmit': '提交生成',
  'edit.logAction.editSubmit': '提交剪辑',
  'edit.logAction.editRender': '渲染入库',
  'edit.logAction.taskCancel': '取消任务',
  'edit.logAction.taskComplete': '任务完成',
  'edit.logAction.taskFail': '任务失败',
  'edit.logAction.taskUncertain': '结果待核对',
  'edit.logAction.historyDelete': '删除历史',
  'edit.logAction.upload': '上传素材',
  'edit.logAction.enhance': '提示词扩写',
  'edit.logAction.keysVerify': '测试连接',
  'edit.logAction.logsDelete': '删除日志',
  'edit.logAction.logsClear': '清空日志',
  'edit.logAction.storageEvict': '容量淘汰',
  'edit.logAction.authFailed': '鉴权失败',
  'edit.logAction.requestError': '请求失败',
};

export const EDIT_EN = {
  'edit.op.trim': 'Trim',
  'edit.op.concat': 'Concat',
  'edit.op.xfade': 'Transition',
  'edit.op.volume': 'Volume',
  'edit.op.speed': 'Speed',
  'edit.op.extractFrame': 'Frame grab',

  'edit.track.video': 'Shots',
  'edit.track.caption': 'Captions',
  'edit.track.transition': 'Transitions',
  'edit.track.audio': 'SFX',

  'edit.captionPreset.plain': 'Static',
  'edit.captionPreset.fade': 'Fade in/out',
  'edit.captionPreset.wordSlide': 'Word slide (offset + blur)',
  'edit.captionPreset.typewriter': 'Typewriter',
  'edit.captionPosition.bottom': 'Bottom',
  'edit.captionPosition.center': 'Center',
  'edit.captionPosition.top': 'Top',

  'edit.transition.fade': 'Cross fade',
  'edit.transition.wipeleft': 'Wipe left',
  'edit.transition.slideright': 'Slide right',

  'edit.origin.projectSummary': '{tracks} tracks · {clips} clips',
  'edit.origin.scriptSummary': '{count}-step EDL',
  'edit.origin.fallback': 'Edit output',

  'edit.logAction.generateSubmit': 'Submitted a generation',
  'edit.logAction.editSubmit': 'Submitted an edit',
  'edit.logAction.editRender': 'Rendered & ingested',
  'edit.logAction.taskCancel': 'Cancelled a task',
  'edit.logAction.taskComplete': 'Task completed',
  'edit.logAction.taskFail': 'Task failed',
  'edit.logAction.taskUncertain': 'Result to verify',
  'edit.logAction.historyDelete': 'Deleted history',
  'edit.logAction.upload': 'Uploaded an asset',
  'edit.logAction.enhance': 'Enhanced a prompt',
  'edit.logAction.keysVerify': 'Tested a connection',
  'edit.logAction.logsDelete': 'Deleted a log entry',
  'edit.logAction.logsClear': 'Cleared the log',
  'edit.logAction.storageEvict': 'Evicted by capacity',
  'edit.logAction.authFailed': 'Auth failed',
  'edit.logAction.requestError': 'Request failed',
};
