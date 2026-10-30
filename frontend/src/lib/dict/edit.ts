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

  // ══ 剪辑台 UI（语言迁移第十七批）════════════════════════════════════
  // 域里的**词汇**（操作名 / 轨道名 / 字幕预设 / 转场名 / 日志动作名）在上面，
  // 这里是**这一屏自己的文案**。

  'edit.title': '剪辑台',
  'edit.title.withSource': '剪辑 · {id}',
  'edit.back': '← 返回视频库',
  'edit.loading': '读取中…',
  'edit.sourceClip': '源片',
  /** 源片槽里那三档状态（`EditView` 的源片卡） */
  'edit.source.ok': '源片',
  'edit.source.bad.title': '源片不可剪辑',
  'edit.source.missing.before': '剪辑台需要一个源片：到 ',
  'edit.source.missing.link': '视频库',
  'edit.source.missing.after': ' 里挑一条成片，点卡片上的 ✂ 进来。',
  /** 剪辑页的状态词：**只有"剪辑中"这一档与别处不同**（生成页说"生成中"）——
   *  其余四档与 `common.status.*` 同词，所以那张键表里直接引用 common（一处定义）。 */
  'edit.status.running': '剪辑中',
  'edit.draft.unreadable.title': '草稿读不出来，已保留原文',
  // ⚠️ 原文里那两个 `**` 是作者写粗体时**留在了界面上**的 —— 迁移照抄（要修另开条目）
  'edit.draft.unreadable.body':
    '{problem} —— 这份草稿**没有被删掉**（可在浏览器存储里找到），本次按新工程打开；想放弃它就到「草稿历史」里清空后刷新。',
  'edit.draft.migrationNotes': '草稿迁移说明：{notes}',
  /** 草稿迁移说明里那条"逐条拼接"的分隔符（排版事实：中文「；」/ 英文 `, `）→ 也走字典 */
  'edit.draft.migrationNotes.separator': '；',
  'edit.history.error': '历史加载失败',
  'edit.history.title': '本片剪辑历史',
  'edit.history.empty': '这条还没有剪辑记录。',
  'edit.history.loadTitle': '载入这条剪辑结果继续编辑',
  'edit.player.aria': '剪辑台预览',
  'edit.player.error.title': '预览播放器没能加载',
  'edit.player.error.body': '时间轴与导出仍然可用（它们不依赖这个播放器）。{reason}',
  'edit.player.retry': '重试加载',
  'edit.player.playing': '播放中',
  'edit.player.paused': '已暂停',
  'edit.player.hint': '{state} · 空格播放/暂停 · 点预览画面也可以',
  'edit.player.toStart': '回到开头',
  'edit.timeline.hint':
    '多轨时间轴（Remotion 预览，所见即所得）：拖动移动片段、左右缘拖拽裁剪、Delete 删除、空格播放/暂停。',
  'edit.timeline.hint2':
    '导出在下一批接入（浏览器端渲染，不占服务器算力）；字幕 / 转场 / 音效轨随后开放。',

  // ── 时间轴（`edit/Timeline.tsx`）──
  'edit.tl.playhead.title': '点击 / 拖动移动播放头',
  'edit.tl.error.audioOnly': '音频素材只能加到音效轨（用「＋音效」）',
  'edit.tl.error.audioNotVideo': '音频素材不能进镜头轨（用「＋音效」）',
  'edit.tl.pick.aria': '选择要添加的素材',
  'edit.tl.pick.placeholder': '选择素材…',
  'edit.tl.pick.groupClips': '成片',
  'edit.tl.pick.groupAudio': '音频素材',
  'edit.tl.add.clip.title': '在时间轴末尾追加一段镜头（源片/剪辑产物）',
  'edit.tl.add.clip.loading': '读取素材…',
  'edit.tl.add.clip.label': '＋镜头',
  'edit.tl.add.audio.title':
    '把素材的音轨作为音效轨片段（不显示画面）：成片取音轨，音频素材直接进场',
  'edit.tl.add.audio.label': '＋音效',
  'edit.tl.add.caption.title': '在播放头处添加一条字幕（默认 2s）',
  'edit.tl.add.caption.label': '＋字幕',
  'edit.tl.add.transition.needClip': '先选中一个视频片段（它后面要有首尾相接的下一段）',
  'edit.tl.add.transition.title':
    '在选中片段与下一段之间加转场（默认 0.5s，可在属性面板改类型与时长）',
  'edit.tl.add.transition.label': '＋转场',
  'edit.tl.remove.title': '删除选中片段（Delete）',
  'edit.tl.remove.label': '🗑 删除片段',
  'edit.tl.summary': '{count} 个片段 · 总长 {time}',
  'edit.tl.fit.title': '缩放到适配全部内容',
  'edit.tl.fit.label': '⤢ 适配',
  'edit.tl.zoom': '缩放',
  'edit.tl.zoom.aria': '时间轴缩放',

  // ── 草稿历史（`edit/DraftHistory.tsx`）──
  'edit.draft.agoSeconds': '{count} 秒前',
  'edit.draft.agoMinutes': '{count} 分钟前',
  'edit.draft.agoHours': '{count} 小时前',
  'edit.draft.agoDays': '{count} 天前',
  'edit.draft.saved': '已存一个版本',
  'edit.draft.duplicate': '与最新一份相同，未重复保存',
  'edit.draft.restored': '已从历史版本恢复',
  'edit.draft.restoredKeep': '已恢复该版本（当前状态也存了一份）',
  'edit.draft.aria': '草稿历史',
  'edit.draft.heading': '⏱ 草稿历史',
  'edit.draft.close': '关闭',
  // ⚠️ 原文里那两个 `**` 同样照抄（见上）
  // ⚠️ 「，」后面那个**空格**是原文的样子（JSX 把两行文本合成一个空格）—— 删了就与迁移前不一致
  'edit.draft.note':
    '自动快照最多 {limit} 份（编辑时节流保存）。历史只存在**这台浏览器**里， 不上传服务端。',
  'edit.draft.saveLabel': '＋ 存一个版本',
  'edit.draft.cleared': '历史已清空（当前草稿保留）',
  'edit.draft.clear': '清空历史',
  'edit.draft.broken': '⚠ 有 {count} 份早期快照读不出来（版本过旧或已损坏），已跳过 —— 其余照常可用。',
  'edit.draft.empty': '还没有历史快照：点「＋ 存一个版本」或继续编辑（会自动存）。',
  'edit.draft.clipCount': '{count} 个片段',
  'edit.draft.restore': '恢复',

  // ── 导出面板（`edit/ExportPanel.tsx`）──
  'edit.export.unsupported':
    '这台浏览器当前无法渲染：{reasons}（需要支持 WebCodecs 的现代浏览器）',
  'edit.export.unknownReason': '未知原因',
  'edit.export.frameNoAsset': '抽帧上传未返回任何资产',
  'edit.export.section': '导出',
  'edit.export.note': '浏览器端渲染（WebCodecs 硬件编码）：不占服务器算力，产物直接下载到本机。',
  'edit.export.progress': '渲染中 {percent}% · 已渲染 {rendered}/{total} 帧 · 已编码 {encoded} 帧',
  'edit.export.result': '{size} · {time} · 渲染耗时 {seconds}s',
  'edit.export.download': '⤓ 下载 MP4',
  'edit.export.archive.title':
    '把成片与多轨工程一起归档到服务端（出现在「本片剪辑历史」，可继续编辑 / 抽帧）',
  'edit.export.archive.busy': '入库中…',
  'edit.export.archive.label': '📥 入库',
  'edit.export.archive.done': '已入库 {id}（下方「本片剪辑历史」可继续编辑）',
  'edit.export.failed': '导出失败',
  'edit.export.cancelled': '已取消导出（未产生文件）。',
  'edit.export.actionFailed': '操作失败',
  'edit.export.cancel': '取消',
  'edit.export.render.title': '用浏览器硬件编码渲染 MP4（与预览同一套合成）',
  'edit.export.render.label': '🎬 导出成片（浏览器渲染）',
  'edit.export.frame.title':
    '渲染播放头那一帧（与预览同构图，含字幕/转场）→ 落为参考资产并切到 I2V 首帧',
  'edit.export.frame.busy': '抽帧中…',
  'edit.export.frame.label': '📸 抽帧为参考资产',
  'edit.export.foot':
    '渲染在你的浏览器里完成（不占服务器算力）；「入库」才会上传到服务端归档 · 渲染期间请保持本页在前台',

  // ── 属性面板的字段表（`edit/clipProperties.ts`）──
  // 这几个是**字段描述符**里的 label / hint（表格里的数据，不是 JSX 文本）→ 只能存键，
  // 由面板在渲染时取（`fieldLabel()` / `fieldHint()`，与 `statusLabel` 同一手法）。
  'edit.field.label': '标签',
  'edit.field.label.hint': '留空则显示来源任务号',
  'edit.field.speed': '变速',
  'edit.field.speed.hint': '上限受源片余量约束（裁掉一些才能加速）',
  'edit.field.volume': '音量',
  'edit.field.volume.hint': '0 = 静音',
  'edit.field.text': '字幕文本',
  'edit.field.position': '位置',
  'edit.field.preset': '动效',
  'edit.field.preset.hint': '逐词入场 / 打字机的动效技法借鉴 video-shotcraft（Apache-2.0）',
  'edit.field.fadeIn': '淡入',
  'edit.field.fadeIn.hint': 'BGM 起手不突兀；0 = 不淡。上限由片段时长收口（model 钳制）',
  'edit.field.fadeOut': '淡出',
  'edit.field.fadeOut.hint': '广告片收尾必需；与淡入重叠时取较小值（不会叠加放大）',
  'edit.field.transition': '类型',
  'edit.field.duration': '时长',
  'edit.field.duration.hint': '改时长会同步调整后继片段的左移量（重叠区 = 转场窗口）',
  'edit.field.unit.frames': '帧',
  /** 单位的括号也是**排版事实**（中文全角、英文半角 + 前置空格） */
  'edit.field.unitWrap': '（{unit}）',

  // ── 属性面板壳（`edit/InspectorPanel.tsx`）──
  'edit.insp.title': '属性',
  'edit.insp.unselected': '未选中',
  'edit.insp.empty': '在时间轴上点选一个片段（镜头 / 转场 / 字幕 / 音效）来编辑它的属性。',
  'edit.insp.kind.video': '视频片段',
  'edit.insp.kind.caption': '字幕',
  'edit.insp.kind.audio': '音效',
  'edit.insp.kind.transition': '转场',
  'edit.insp.fact.start': '起点',
  'edit.insp.fact.duration': '时长',
  'edit.insp.fact.source': '来源',
  'edit.insp.fact.trim': '源片',
  'edit.insp.fact.trimValue': '{total} · 裁入 {trim}',
  'edit.insp.fact.transition': '类型',
  'edit.insp.removeTransition.title': '移除转场并把后继片段右移还原',
  'edit.insp.removeTransition.label': '移除转场',

  // ── 时间轴片段的角标（`edit/TimelineClip.tsx`）──
  'edit.clip.muted': '静音',
  'edit.clip.volume': '音量×{value}',
  'edit.clip.effect': '动效',

  // ── 编辑器的提示语（`edit/store.ts`）──
  'edit.store.pickVideoFirst': '先在时间轴上选中一个视频片段',
  'edit.store.notTransition': '选中的不是转场片段',
  'edit.store.transitionRemoved': '这次编辑已移除受影响的转场（转场要求两段首尾相接）',

  // ── 素材探测（`edit/mediaProbe.ts`）──
  'edit.probe.timeout': '读取素材元数据超时（素材可能已被清理或网络异常）',
  'edit.probe.unreadable': '无法读取素材（文件可能已被清理，或浏览器不支持该编码）',

  // ── 草稿解析（`edit/draft.ts`）──
  'edit.draftProblem': '草稿不是有效的 JSON（可能是手改过或写入中断）',

  // ── 配音 / 配乐面板（V2.103 / Phase 2「声音」，`edit/AudioPanel.tsx`）──
  'edit.audio.section': '声音',
  'edit.audio.filmLength': '片长 {seconds}s',
  'edit.audio.modeAria': '选择声音类型',
  'edit.audio.text.label': '台词（要念出来的字）',
  'edit.audio.text.placeholder': '例：雪停以后，院子里只剩那枚红苹果。',
  'edit.audio.voice.label': '音色',
  'edit.audio.style.label': '情绪 / 风格指令',
  'edit.audio.style.placeholder': '例：纪录片旁白，低沉克制',
  'edit.audio.prompt.label': '描述（给音乐模型）',
  'edit.audio.prompt.placeholder': '例：warm cinematic ambient score, soft piano, no vocals',
  'edit.audio.seconds.label': '时长',
  'edit.audio.seconds.hint': '1–{max} 秒；建议与片长一致',
  'edit.audio.generate': '生成并落到音效轨',
  'edit.audio.busy': '生成中… 已等 {seconds}s',
  'edit.audio.placing': '落轨中…',
  'edit.audio.autoPlace': '生成完成后自动落到音效轨 0 帧：超出片长会裁到片长，并加淡入淡出。',
  'edit.audio.engine': '引擎：{engine}',
  'edit.audio.executedBy.cloud': '第三方云',
  'edit.audio.executedBy.local': '本机',
  'edit.audio.localTtsMissing':
    '本机配音（GPT-SoVITS）本轮未接线（/infer_single 首调实测 300s 未返回），所以配音只有云端一条路。',
  'edit.audio.placed': '已落到音效轨（{seconds}s，含淡入淡出）',
  'edit.audio.failed': '生成失败',
  'edit.audio.error.noOutput': '任务成功了，但没有音频产物地址',
  'edit.audio.error.failed': '音频生成失败（任务终态失败）',
  'edit.audio.error.timeout': '等待超时：音频还没出结果，稍后可在生成历史里查看',
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

  'edit.title': 'Edit desk',
  'edit.title.withSource': 'Edit · {id}',
  'edit.back': '← Back to the library',
  'edit.loading': 'Loading…',
  'edit.sourceClip': 'Source clip',
  'edit.source.ok': 'Source clip',
  'edit.source.bad.title': 'This source clip cannot be edited',
  'edit.source.missing.before': 'The edit desk needs a source clip: pick one in the ',
  'edit.source.missing.link': 'library',
  'edit.source.missing.after': ' and click ✂ on its card.',
  'edit.status.running': 'Editing',
  'edit.draft.unreadable.title': 'The draft could not be read; the raw text was kept',
  'edit.draft.unreadable.body':
    '{problem} — this draft was **not deleted** (it is still in browser storage); it is opened as a new project this time. To drop it, clear the history in 「Draft history」 and refresh.',
  'edit.draft.migrationNotes': 'Draft migration notes: {notes}',
  'edit.draft.migrationNotes.separator': ', ',
  'edit.history.error': 'Could not load the history',
  'edit.history.title': 'Edit history of this clip',
  'edit.history.empty': 'No edits recorded for this clip yet.',
  'edit.history.loadTitle': 'Load this edit result and keep working',
  'edit.player.aria': 'Edit desk preview',
  'edit.player.error.title': 'The preview player failed to load',
  'edit.player.error.body':
    'The timeline and export still work (they do not depend on this player). {reason}',
  'edit.player.retry': 'Retry loading',
  'edit.player.playing': 'Playing',
  'edit.player.paused': 'Paused',
  'edit.player.hint': '{state} · Space to play/pause · clicking the preview works too',
  'edit.player.toStart': 'Back to the start',
  'edit.timeline.hint':
    'Multi-track timeline (Remotion preview, WYSIWYG): drag to move clips, drag either edge to trim, Delete to remove, Space to play/pause.',
  'edit.timeline.hint2':
    'Export arrives in the next batch (browser-side rendering, no server compute); captions / transitions / SFX tracks open up after that.',

  'edit.tl.playhead.title': 'Click / drag to move the playhead',
  'edit.tl.error.audioOnly': 'Audio assets can only go on the SFX track (use 「＋ SFX」)',
  'edit.tl.error.audioNotVideo': 'Audio assets cannot go on a shot track (use 「＋ SFX」)',
  'edit.tl.pick.aria': 'Choose the asset to add',
  'edit.tl.pick.placeholder': 'Choose an asset…',
  'edit.tl.pick.groupClips': 'Clips',
  'edit.tl.pick.groupAudio': 'Audio assets',
  'edit.tl.add.clip.title': 'Append a shot at the end of the timeline (source clips / edit output)',
  'edit.tl.add.clip.loading': 'Loading asset…',
  'edit.tl.add.clip.label': '＋ Shot',
  'edit.tl.add.audio.title':
    'Use the asset’s audio track as an SFX clip (no picture): clips take their audio, audio assets go in as is',
  'edit.tl.add.audio.label': '＋ SFX',
  'edit.tl.add.caption.title': 'Add a caption at the playhead (2s by default)',
  'edit.tl.add.caption.label': '＋ Caption',
  'edit.tl.add.transition.needClip':
    'Select a video clip first (it needs a next clip that touches its end)',
  'edit.tl.add.transition.title':
    'Add a transition between the selected clip and the next one (0.5s by default; type and duration are editable in the properties panel)',
  'edit.tl.add.transition.label': '＋ Transition',
  'edit.tl.remove.title': 'Delete the selected clip (Delete)',
  'edit.tl.remove.label': '🗑 Delete clip',
  'edit.tl.summary': '{count} clips · total {time}',
  'edit.tl.fit.title': 'Zoom to fit everything',
  'edit.tl.fit.label': '⤢ Fit',
  'edit.tl.zoom': 'Zoom',
  'edit.tl.zoom.aria': 'Timeline zoom',

  'edit.draft.agoSeconds': '{count}s ago',
  'edit.draft.agoMinutes': '{count}m ago',
  'edit.draft.agoHours': '{count}h ago',
  'edit.draft.agoDays': '{count}d ago',
  'edit.draft.saved': 'Saved a version',
  'edit.draft.duplicate': 'Identical to the latest one — not saved again',
  'edit.draft.restored': 'Restored from a history version',
  'edit.draft.restoredKeep': 'Restored that version (the current state was saved as well)',
  'edit.draft.aria': 'Draft history',
  'edit.draft.heading': '⏱ Draft history',
  'edit.draft.close': 'Close',
  'edit.draft.note':
    'Up to {limit} automatic snapshots (throttled saves while editing). The history lives only in **this browser** and is never uploaded.',
  'edit.draft.saveLabel': '＋ Save a version',
  'edit.draft.cleared': 'History cleared (the current draft is kept)',
  'edit.draft.clear': 'Clear history',
  'edit.draft.broken':
    '⚠ {count} early snapshots could not be read (too old or damaged) and were skipped — everything else still works.',
  'edit.draft.empty': 'No snapshots yet: click 「＋ Save a version」 or keep editing (it saves automatically).',
  'edit.draft.clipCount': '{count} clips',
  'edit.draft.restore': 'Restore',

  'edit.export.unsupported':
    'This browser cannot render right now: {reasons} (a modern browser with WebCodecs is required)',
  'edit.export.unknownReason': 'unknown reason',
  'edit.export.frameNoAsset': 'The frame upload returned no asset',
  'edit.export.section': 'Export',
  'edit.export.note':
    'Rendered in the browser (WebCodecs hardware encoding): no server compute, the file downloads straight to this machine.',
  'edit.export.progress':
    'Rendering {percent}% · {rendered}/{total} frames drawn · {encoded} frames encoded',
  'edit.export.result': '{size} · {time} · rendered in {seconds}s',
  'edit.export.download': '⤓ Download MP4',
  'edit.export.archive.title':
    'Archive the clip together with the multi-track project on the server (it shows up under 「Edit history of this clip」 and can be edited / extracted again)',
  'edit.export.archive.busy': 'Archiving…',
  'edit.export.archive.label': '📥 Archive',
  'edit.export.archive.done': 'Archived {id} (keep editing from 「Edit history of this clip」 below)',
  'edit.export.failed': 'Export failed',
  'edit.export.cancelled': 'Export cancelled (no file was produced).',
  'edit.export.actionFailed': 'Action failed',
  'edit.export.cancel': 'Cancel',
  'edit.export.render.title': 'Render MP4 with browser hardware encoding (same composition as the preview)',
  'edit.export.render.label': '🎬 Export clip (browser rendering)',
  'edit.export.frame.title':
    'Render the playhead frame (same framing as the preview, captions/transitions included) → save it as a reference asset and switch to the I2V first frame',
  'edit.export.frame.busy': 'Extracting…',
  'edit.export.frame.label': '📸 Extract frame as reference',
  'edit.export.foot':
    'Rendering happens in your browser (no server compute); only 「Archive」 uploads to the server · keep this page in the foreground while rendering',

  'edit.field.label': 'Label',
  'edit.field.label.hint': 'Leave empty to show the source task id',
  'edit.field.speed': 'Speed',
  'edit.field.speed.hint': 'The upper bound depends on the spare source length (trim some to go faster)',
  'edit.field.volume': 'Volume',
  'edit.field.volume.hint': '0 = muted',
  'edit.field.text': 'Caption text',
  'edit.field.position': 'Position',
  'edit.field.preset': 'Effect',
  'edit.field.preset.hint':
    'The word-slide / typewriter techniques are borrowed from video-shotcraft (Apache-2.0)',
  'edit.field.fadeIn': 'Fade in',
  'edit.field.fadeIn.hint':
    'So the BGM does not start abruptly; 0 = no fade. The upper bound is capped by the clip length (clamped in the model)',
  'edit.field.fadeOut': 'Fade out',
  'edit.field.fadeOut.hint':
    'Required for a proper ad ending; when it overlaps the fade-in the smaller value wins (they never add up)',
  'edit.field.transition': 'Type',
  'edit.field.duration': 'Duration',
  'edit.field.duration.hint':
    'Changing it shifts the following clips left accordingly (the overlap is the transition window)',
  'edit.field.unit.frames': 'frames',
  'edit.field.unitWrap': ' ({unit})',

  'edit.insp.title': 'Properties',
  'edit.insp.unselected': 'Nothing selected',
  'edit.insp.empty':
    'Click a clip on the timeline (shot / transition / caption / SFX) to edit its properties.',
  'edit.insp.kind.video': 'Video clip',
  'edit.insp.kind.caption': 'Caption',
  'edit.insp.kind.audio': 'SFX',
  'edit.insp.kind.transition': 'Transition',
  'edit.insp.fact.start': 'Start',
  'edit.insp.fact.duration': 'Duration',
  'edit.insp.fact.source': 'Source',
  'edit.insp.fact.trim': 'Source clip',
  'edit.insp.fact.trimValue': '{total} · trimmed in {trim}',
  'edit.insp.fact.transition': 'Type',
  'edit.insp.removeTransition.title': 'Remove the transition and shift the following clips back',
  'edit.insp.removeTransition.label': 'Remove transition',

  'edit.clip.muted': 'Muted',
  'edit.clip.volume': 'Vol×{value}',
  'edit.clip.effect': 'Effect',

  'edit.store.pickVideoFirst': 'Select a video clip on the timeline first',
  'edit.store.notTransition': 'The selection is not a transition clip',
  'edit.store.transitionRemoved':
    'This edit removed the affected transitions (a transition needs two clips that touch)',

  'edit.probe.timeout': 'Timed out reading the asset metadata (the asset may be gone, or the network is off)',
  'edit.probe.unreadable':
    'Could not read the asset (the file may be gone, or the browser cannot decode it)',

  'edit.draftProblem': 'The draft is not valid JSON (edited by hand, or the write was interrupted)',

  // ── Voice-over / music panel (V2.103 / Phase 2 "sound", `edit/AudioPanel.tsx`) ──
  'edit.audio.section': 'Sound',
  'edit.audio.filmLength': 'Film {seconds}s',
  'edit.audio.modeAria': 'Pick a sound type',
  'edit.audio.text.label': 'Script (the words to speak)',
  'edit.audio.text.placeholder': 'e.g. After the snow stopped, only that red apple was left in the yard.',
  'edit.audio.voice.label': 'Voice',
  'edit.audio.style.label': 'Emotion / style direction',
  'edit.audio.style.placeholder': 'e.g. documentary narration, low and restrained',
  'edit.audio.prompt.label': 'Description (for the music model)',
  'edit.audio.prompt.placeholder': 'e.g. warm cinematic ambient score, soft piano, no vocals',
  'edit.audio.seconds.label': 'Length',
  'edit.audio.seconds.hint': '1–{max} seconds; matching the film length is usually right',
  'edit.audio.generate': 'Generate and drop on the audio track',
  'edit.audio.busy': 'Generating… {seconds}s elapsed',
  'edit.audio.placing': 'Placing…',
  'edit.audio.autoPlace':
    'When it finishes it lands on frame 0 of the audio track: trimmed to the film length when longer, with fade in/out.',
  'edit.audio.engine': 'Engine: {engine}',
  'edit.audio.executedBy.cloud': 'third-party cloud',
  'edit.audio.executedBy.local': 'this machine',
  'edit.audio.localTtsMissing':
    'Local voice-over (GPT-SoVITS) is not wired this round (/infer_single did not answer in 300s), so cloud is the only voice path.',
  'edit.audio.placed': 'Placed on the audio track ({seconds}s, with fades)',
  'edit.audio.failed': 'Generation failed',
  'edit.audio.error.noOutput': 'The task succeeded but carries no audio URL',
  'edit.audio.error.failed': 'Audio generation failed (task reached a failed terminal state)',
  'edit.audio.error.timeout': 'Timed out waiting: check the generation history in a moment',
};
