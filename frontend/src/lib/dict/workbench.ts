/**
 * **工作台**（专业模式）的文案：左栏参数面板（`components/LeftPanel.tsx`）
 * 与通用参考素材槽（`components/AssetDropZone.tsx`）。
 *
 * ## 为什么两个组件合成一个域
 * 它们是**同一屏的同一件事**：左栏把槽渲染出来、槽把左栏的标题与提示显示出来
 * （`label` / `hint` 都以 prop 从左栏传下来）。分两个域会让"参考首帧"这几个字
 * 相关的键散在两处，改一次要翻两个文件。
 *
 * ## 内容 vs 文案的边界（与 `create` 域同一条）
 * **不含**：配方 / 行业模板的名字与骨架（内容，见 `create.ts` 顶部那条）、
 * 引擎实例名（来自服务端 `/status`）。英文界面下它们**仍是中文**，那是如实的状态。
 */

export const WORKBENCH_ZH = {
  // ── 模式清单（label 走 `common.mode.*`；这里只有"这个模式干什么 / 需要什么"）──
  'workbench.mode.t2v.title': '仅凭文字描述生成',
  'workbench.mode.t2v.requirement': '不需要参考素材',
  'workbench.mode.i2v.title': '以参考首帧为起点生成',
  'workbench.mode.i2v.requirement': '需要「参考首帧」',
  'workbench.mode.fl2v.title': '给定首帧与尾帧，由模型补出中间运动',
  'workbench.mode.fl2v.requirement': '需要「参考首帧 + 参考尾帧」',
  'workbench.mode.v2v.title': '以参考视频做风格 / 动作迁移',
  'workbench.mode.v2v.requirement': '需要「参考视频」',
  'workbench.mode.t2i.title': '仅凭文字描述生成一张图片',
  'workbench.mode.t2i.requirement': '不需要参考素材（需要本地引擎装好图片模板）',

  // ── 左栏：创作输入 ──
  'workbench.section.create': '创作输入',
  'workbench.prompt.label': '提示词',
  'workbench.prompt.enhanceTitle': '用模型把提示词写得更完整',
  'workbench.prompt.enhancing': '扩写中…',
  'workbench.prompt.enhance': '✨ 扩写',
  'workbench.prompt.placeholder':
    '镜头运动、主体动作、氛围；对白写在引号里，例如：她笑着说“我们终于成功了！”',
  'workbench.prompt.dialogue': '对白引号内 {count} 字（5 秒镜头建议 ≤ 20 字）',
  'workbench.prompt.chars': '{count} 字符',

  // ── 左栏：三个参考槽（标题与提示都从右面这些键取）──
  'workbench.slot.firstFrame': '参考首帧',
  'workbench.slot.firstFrame.hintOptional':
    '可选：上传后会切到「图生视频」；仅文生视频可直接忽略此槽',
  'workbench.slot.firstFrame.hint':
    '必需：作为首帧（起点画面）。⚠️ 含真人 / 拟真人脸的图会被上游隐私检测拒绝 —— 可换非人物素材，或改用文生视频',
  'workbench.slot.lastFrame': '参考尾帧',
  'workbench.slot.lastFrame.hint':
    '必需：作为尾帧（终点画面）；与首帧一起交给上游补中间运动。⚠️ 含真人 / 拟真人脸的图会被上游隐私检测拒绝',
  'workbench.slot.video': '参考视频',
  'workbench.slot.video.hint': '必需：作为风格 / 动作迁移的参考（mp4 / mov）',
  'workbench.slot.pickFromLibrary': '从成片库选择参考视频',
  'workbench.slot.pickPlaceholder': '或直接从已有成片 / 剪辑产物选…',

  // ── 左栏：参数 ──
  'workbench.mode.label': '生成模式',
  'workbench.mode.optionTitle': '{title}（{requirement}）',
  'workbench.mode.upstreamPending': '；该模式的上游字段接受度待真实冒烟核对',
  'workbench.aspect.label': '画幅',
  'workbench.aspect.target': '渲染为 {width}×{height}',
  'workbench.aspect.squareCloudOnly': '方画幅仅云端引擎支持',
  'workbench.duration.label': '时长',
  'workbench.duration.note': '单段上限 10 秒（公网部署防线，CONTRACT §1）',
  'workbench.resolution.label': '清晰度',
  'workbench.resolution.note': '透传上游 `--resolution`；目标尺寸随之变化',
  'workbench.engine.label': '执行引擎',
  'workbench.engine.instancesAria': '本地 ComfyUI 实例',
  'workbench.engine.localUnknown': '本地 ComfyUI 状态未知',
  'workbench.engine.localReasonFallback': '本地引擎状态未知',

  // ── 左栏：运行时自检（B4）──
  'workbench.selfcheck.checkingHint': '正在连一次本地引擎（ComfyUI 的模型清单较大，通常一两秒）',
  'workbench.selfcheck.idleHint': '真的去连一次本机 / 内网的引擎，如实报告能不能跑、能跑哪些模式',
  'workbench.selfcheck.checking': '🔍 检测中…',
  'workbench.selfcheck.run': '🔍 检测本地引擎',
  'workbench.selfcheck.failed': '检测失败：{reason}',
  'workbench.selfcheck.entryOk': '可用',
  'workbench.selfcheck.checkedAt.before': '（{time} 检测 —— 它反映的是',
  'workbench.selfcheck.checkedAt.emphasis': '此刻',
  'workbench.selfcheck.checkedAt.after': '能不能连上，与上面那行“配没配”是两件事）',

  // ── 左栏：本地轨怎么配（含命令名，拆成多段以保住 `code` 样式）──
  'workbench.localConfig.before':
    '推荐配置（可选）：本服务自身配置 ComfyUI 后重启即可开放，需在服务端设置 ',
  'workbench.localConfig.mid1': '（已运行的 ComfyUI 地址，仅回环 / 内网；多台用 ',
  'workbench.localConfig.mid2': '），再置 ',
  'workbench.localConfig.after': '。在此之前选择本地轨提交，会如实返回 ',
  'workbench.localConfig.tail': '。',

  // ── 左栏：凭据与种子 ──
  'workbench.byok.open': '凭据设置（BYOK）',
  'workbench.seed.lock': '锁定复现',
  'workbench.seed.placeholderLocked': '填写整数种子',
  'workbench.seed.placeholderRandom': '未锁定：每次随机',
  'workbench.seed.note': '锁定后同种子同参数可复现；云端不锁定时由服务商侧随机。',

  // ── 工作台容器（`views/WorkbenchView.tsx`）：这里几乎全是**就地通知**（notice）──
  'workbench.notice.enhanceUnavailable':
    '未配置扩写模型：请在「凭据设置（BYOK）」里填入文本轨 Key（本服务不提供文本侧兜底 Key）',
  'workbench.prompt.demo': '竖屏短剧，女孩站在雨夜街头微笑着说：“我们终于成功了！”，电影感光影',
  'workbench.notice.framePicked': '已把剪辑台抽出的那一帧放进首帧（I2V）：补一句运动描述就能生成。',
  'workbench.notice.recipeContext': '已选用配方「{title}」作为扩写上下文（提示词未改动）。',
  'workbench.notice.recipeSkeleton': '已把配方「{title}」的骨架插入提示词末尾；扩写时也会带上它。',
  'workbench.notice.videoRefSet':
    '已把{origin} {id} 设为参考视频（V2V）；线上部署（已配 PUBLIC_BASE_URL）可直接提交。',
  'workbench.origin.edit': '剪辑产物',
  'workbench.origin.render': '成片',
  'workbench.enhanced.head': '已用模型扩写（engine={engine}）',
  'workbench.enhanced.camera': ' · 镜头建议：{value}',
  'workbench.enhanced.lighting': ' · 光线建议：{value}',
  'workbench.enhanced.notice': '（{value}）',
  'workbench.notice.enhanceFailed': '扩写失败：{reason}',
  'workbench.notice.cancelled':
    '已请求取消，并会通知上游停止；若上游已受理，仍可能产生费用，请到服务商后台核对。',
  'workbench.notice.cancelFailed': '取消失败：{reason}',
  'workbench.notice.noOutput': '该任务没有可播放的成片（未成功，或成片已被清理）。',
  'workbench.notice.paramsReused': '已复用该任务的参数（提示词 / 模式 / 画幅 / seed）。',
  'workbench.notice.paramsReusedWithAssets':
    '已复用参数，并带回 {count} 份参考资产编号；本地没有备份，因此不显示预览。',
  'workbench.notice.acknowledged': '已标记核对：请到服务商后台确认是否产生费用。',
  'workbench.notice.abandoned': '已放弃该任务：本服务不会自动重试，也不会再次向上游提交。',
  'workbench.submit.cooldown': '冷却中 {seconds}s',
  'workbench.submit.run': '立即生成视频',
  // V2.40：文生图（`t2i`）—— 产物是图片，按钮不该写"视频"
  'workbench.submit.runImage': '立即生成图片',
  'workbench.key.none': '未填写 Key：服务端将回落到其自身配置的兜底 Key（若未配置会返回 KEY_MISSING）。',
  'workbench.key.local': '已填写 Key · 明文保存在本机（仅限信任设备）',
  'workbench.key.session': '已填写 Key · 仅本次会话有效',
  'workbench.alert.submitFailed': '提交未成功',
  'workbench.footer.lead': '本地演示版本 ·',
  'workbench.footer.waiting': ' 等待任务',
  'workbench.footer.recent': ' 最近任务 {id} · 观察 {time}',

  // ── 中央视窗（`components/CenterPanel.tsx`）──
  'workbench.center.eyebrow': '实时视窗',
  'workbench.center.sizeNote': '{width}×{height} · 32 倍数对齐',
  'workbench.center.timecode': '{clock} · {status}',
  'workbench.center.cancel': '取消任务',
  'workbench.center.download': '下载 MP4',
  'workbench.center.unavailable': '任务不可用',
  'workbench.center.unavailableNote': '任务可能已被清理；可从右栏历史重新发起。',
  'workbench.center.waiting': '等待生成任务下发',
  // V2.40：不再写死按钮名（`t2i` 下那个按钮叫"生成图片"，写死就撒谎）
  'workbench.center.waitingNote': '在左侧配置提示词与参考素材，再点生成按钮。',
  'workbench.center.doneMark': '生成完成',
  'workbench.center.doneNoUrl': '任务已完成',
  'workbench.center.doneNoUrlNote':
    '但产物地址缺失（outputVideoUrl / outputImageUrl 都为空）。这属于异常，请检查服务端输出目录。',
  'workbench.center.imageAlt': '本次生成的图片产物',
  'workbench.center.uncertain': '结果不明',
  'workbench.center.failedTitle': '未完成 · {code}',
  'workbench.center.unknownError': '未知错误',
  'workbench.center.failedMessage': '任务失败',
  'workbench.center.retryable':
    '该错误属可重试类：确认外部条件（额度 / 限流 / 网络）后可用同一参数再次发起。',
  'workbench.center.fatal': '该错误属终止类：重复提交大概率仍会失败，请先修正参数或凭据。',
  'workbench.center.reuse': '复用参数',
  'workbench.center.cancelled': '任务已取消',
  'workbench.center.cancelledNote': '该任务不再继续执行。',
  'workbench.center.queued': '已入队 · 等待执行',
  'workbench.center.running': '生成中 · {status}',

  // ── 人工核对卡（`components/UncertainNotice.tsx`；`UNCERTAIN_RESULT` 那条防线）──
  'workbench.uncertain.title': '结果不明 · 需要人工核对',
  'workbench.uncertain.feeNote': '可能已产生费用，请到服务商后台核对后手动处理。',
  'workbench.uncertain.taskId.before': '任务编号 ',
  'workbench.uncertain.taskId.after':
    ' —— 该编号在上游不一定存在，若后台看不到对应记录，说明请求未真正受理。',
  'workbench.uncertain.noRetry.emphasis': '不会自动重试，也不提供一键重跑',
  'workbench.uncertain.noRetry.after':
    '：重复提交可能被上游重复计费。确认上游无扣费后，可点击下方按钮用同一参数重新发起一次新任务。',
  'workbench.uncertain.acknowledged': '已标记核对',
  'workbench.uncertain.acknowledge': '标记已核对',
  'workbench.uncertain.abandon': '放弃任务',

  // ── 画廊卡（`components/GalleryCard.tsx`）──
  // ✅ `executedBy` 的显示名已收敛（语言迁移第十二批）：三处前端（`GalleryCard` / `NodeCard` /
  //    `LibraryView`）统一走 `common.executedBy.*`（键表在 `lib/format.ts`）；
  //    共享包那两个中文常量**保留**，并由 `lib/format.test.ts` 的**逐字对拍**钉住"两份不许漂移"。
  'workbench.gallery.playTitle': '在中栏播放这条成片',
  'workbench.gallery.playAria': '播放第 {index} 条成片',
  'workbench.gallery.noOutput': '该任务没有可播放的成片',
  'workbench.gallery.emptyPrompt': '（无提示词）',
  'workbench.gallery.hasReference': ' · 含参考图',
  'workbench.gallery.executedAt': '▸ 执行于{label}',
  'workbench.gallery.deleting': '删除中…',

  // ── 右栏（`components/RightPanel.tsx`）──
  'workbench.right.eyebrow': '任务与画廊',
  'workbench.right.refreshing': '刷新中…',
  'workbench.right.refresh': '刷新',
  'workbench.right.current': '当前任务',
  'workbench.right.noCurrent': '暂无进行中的任务',
  'workbench.right.history': '历史成片（{count}）',
  'workbench.right.noHistory': '暂无历史成片',
  'workbench.right.noHistoryNote': '生成后的成片会在这里沉淀，支持参数一键回填。',

  // ── 素材槽（`AssetDropZone`）──
  'workbench.drop.previewAlt': '{label}裁切预览',
  'workbench.drop.naturalSize.before': '原图 ',
  'workbench.drop.videoNote':
    '参考视频原样上传，不做裁切与转码；是否被上游接受取决于引擎（云端 `reference_image` 字段对视频的支持度属【待验证】，见 PLAN §5 批次 3-⑤）。',
  'workbench.drop.cropTo.before': '裁切为 ',
  'workbench.drop.cropTo.after': ' （32 的倍数）',
  'workbench.drop.previewNote': '预览即服务端即将裁出的区域（居中裁切）',
  'workbench.drop.metaLine': '{kind} · {mime} · {size}',
  'workbench.drop.reused.before': '已复用参考资产 ',
  'workbench.drop.reusedNote':
    '参数复用只带回资产编号，本地没有这份素材 —— 预览不可用，直接提交仍会使用该资产。',
  'workbench.drop.reupload': '改为重新上传',
  'workbench.drop.pickVideo': '点击选择或拖拽视频到这里（mp4 / mov，≤100MB）',
  'workbench.drop.pickImage': '点击选择或拖拽图片到这里（≤100MB）',
  'workbench.drop.sniffNote': '服务端按魔数嗅探真实类型，不信任文件名与 Content-Type',

  // ── 素材槽的"缺什么"提示（`lib/assets.ts`；语言迁移第十五批）──
  // 它们说的是"这个模式需要什么素材"，所以**模式名跟着一起出现在句子里** ——
  // 翻译时别把模式名换成别的说法（`common.mode.*` 是那四个名字的唯一来源）。
  'workbench.assets.needFirstFrame': '「图生视频」需要参考首帧：请在上方上传首帧',
  'workbench.assets.needBothFramesNoFirst': '「首尾帧」需要参考首帧与参考尾帧：当前缺首帧',
  'workbench.assets.needBothFramesNoLast': '「首尾帧」需要参考首帧与参考尾帧：当前缺尾帧',
  'workbench.assets.needReferenceVideo': '「视频参考」需要参考视频：请在上方上传',
  // S5-B4e：退场说明（路由与功能保留一版）
  'workbench.retired.title': '专业工作台已下线',
  'workbench.retired.body':
    '创作输入、参数与结果动作已并入「创作」页；画布节点也使用同一套参数。此页保留一版，旧书签与历史深链仍可用。',
  'workbench.retired.toCreate': '去创作',
  'workbench.retired.toCanvas': '去画布',
};

export const WORKBENCH_EN = {
  'workbench.mode.t2v.title': 'Generate from a text description alone',
  'workbench.mode.t2v.requirement': 'No reference material needed',
  'workbench.mode.i2v.title': 'Generate starting from a first frame',
  'workbench.mode.i2v.requirement': 'Needs a first frame',
  'workbench.mode.fl2v.title': 'Given first and last frames, the model fills in the motion',
  'workbench.mode.fl2v.requirement': 'Needs a first frame and a last frame',
  'workbench.mode.v2v.title': 'Style / motion transfer from a reference video',
  'workbench.mode.v2v.requirement': 'Needs a reference video',
  'workbench.mode.t2i.title': 'Generate a single still image from text alone',
  'workbench.mode.t2i.requirement': 'No reference material (needs an image template on the local engine)',

  'workbench.section.create': 'Creation input',
  'workbench.prompt.label': 'Prompt',
  'workbench.prompt.enhanceTitle': 'Use a model to write the prompt out more fully',
  'workbench.prompt.enhancing': 'Expanding…',
  'workbench.prompt.enhance': '✨ Expand',
  'workbench.prompt.placeholder':
    'Camera movement, subject action, mood; put dialogue in quotes, e.g. she smiles and says “we finally made it!”',
  'workbench.prompt.dialogue': '{count} characters inside quotes (≤ 20 is recommended for a 5s shot)',
  'workbench.prompt.chars': '{count} chars',

  'workbench.slot.firstFrame': 'First frame',
  'workbench.slot.firstFrame.hintOptional':
    'Optional: uploading one switches to Image-to-video; you can ignore this slot for text-only work',
  'workbench.slot.firstFrame.hint':
    'Required: the starting frame. ⚠️ Images with real or realistic human faces are rejected by upstream privacy checks — use non-human material or switch to text-to-video',
  'workbench.slot.lastFrame': 'Last frame',
  'workbench.slot.lastFrame.hint':
    'Required: the ending frame; upstream fills the motion between it and the first frame. ⚠️ Images with real or realistic human faces are rejected by upstream privacy checks',
  'workbench.slot.video': 'Reference video',
  'workbench.slot.video.hint': 'Required: the style / motion reference (mp4 / mov)',
  'workbench.slot.pickFromLibrary': 'Pick a reference video from your renders',
  'workbench.slot.pickPlaceholder': 'Or pick an existing render / edited clip…',

  'workbench.mode.label': 'Mode',
  'workbench.mode.optionTitle': '{title} ({requirement})',
  'workbench.mode.upstreamPending': '; upstream support for this field still needs a real smoke run',
  'workbench.aspect.label': 'Aspect',
  'workbench.aspect.target': 'Renders at {width}×{height}',
  'workbench.aspect.squareCloudOnly': 'Square is only supported by the cloud engine',
  'workbench.duration.label': 'Duration',
  'workbench.duration.note': 'Max 10 seconds per clip (public-deployment guardrail, CONTRACT §1)',
  'workbench.resolution.label': 'Resolution',
  'workbench.resolution.note': 'Passed through as upstream `--resolution`; target size follows',
  'workbench.engine.label': 'Engine',
  'workbench.engine.instancesAria': 'Local ComfyUI instances',
  'workbench.engine.localUnknown': 'Local ComfyUI: status unknown',
  'workbench.engine.localReasonFallback': 'Local engine: status unknown',

  'workbench.selfcheck.checkingHint':
    'Connecting to a local engine once (ComfyUI lists a lot of models, usually a second or two)',
  'workbench.selfcheck.idleHint':
    'Actually connect to an engine on this machine / LAN and report honestly what it can run',
  'workbench.selfcheck.checking': '🔍 Checking…',
  'workbench.selfcheck.run': '🔍 Check local engines',
  'workbench.selfcheck.failed': 'Check failed: {reason}',
  'workbench.selfcheck.entryOk': 'available',
  'workbench.selfcheck.checkedAt.before': '({time} — this reflects whether it is reachable ',
  'workbench.selfcheck.checkedAt.emphasis': 'right now',
  'workbench.selfcheck.checkedAt.after': ', which is a different question from “is it configured” above)',

  'workbench.localConfig.before': 'Recommended setup (optional): point this service at ComfyUI and restart. Set ',
  'workbench.localConfig.mid1': ' (the running ComfyUI address; loopback / LAN only; for several instances use ',
  'workbench.localConfig.mid2': '), then set ',
  'workbench.localConfig.after': '. Until then, submitting on the local track honestly returns ',
  'workbench.localConfig.tail': '.',

  'workbench.byok.open': 'Credentials (BYOK)',
  'workbench.seed.lock': 'Lock for reproducibility',
  'workbench.seed.placeholderLocked': 'Enter an integer seed',
  'workbench.seed.placeholderRandom': 'Unlocked: random each time',
  'workbench.seed.note':
    'Locked, the same seed and settings reproduce; on the cloud an unlocked seed is randomized upstream.',

  'workbench.notice.enhanceUnavailable':
    'No expansion model configured: add a text-track key in “Credentials (BYOK)” (this service ships no text-side fallback key)',
  'workbench.prompt.demo':
    'Vertical short drama: a girl on a rainy street at night smiles and says “we finally made it!”, cinematic light',
  'workbench.notice.framePicked':
    'Put the frame grabbed in the editor into the first frame (I2V): add one line of motion and you can generate.',
  'workbench.notice.recipeContext': 'Using recipe “{title}” as expansion context (your prompt is unchanged).',
  'workbench.notice.recipeSkeleton':
    'Appended the skeleton of recipe “{title}” to the prompt; expansion will include it too.',
  'workbench.notice.videoRefSet':
    'Set {origin} {id} as the reference video (V2V); on a deployed instance (PUBLIC_BASE_URL set) you can submit directly.',
  'workbench.origin.edit': 'edited clip',
  'workbench.origin.render': 'render',
  'workbench.enhanced.head': 'Expanded with a model (engine={engine})',
  'workbench.enhanced.camera': ' · camera suggestion: {value}',
  'workbench.enhanced.lighting': ' · lighting suggestion: {value}',
  'workbench.enhanced.notice': ' ({value})',
  'workbench.notice.enhanceFailed': 'Expansion failed: {reason}',
  'workbench.notice.cancelled':
    'Cancellation requested and upstream will be told to stop; if upstream already accepted it, you may still be charged — check your provider console.',
  'workbench.notice.cancelFailed': 'Cancel failed: {reason}',
  'workbench.notice.noOutput': 'This task has no playable output (it did not succeed, or the file was cleaned up).',
  'workbench.notice.paramsReused': 'Reused this task’s parameters (prompt / mode / aspect / seed).',
  'workbench.notice.paramsReusedWithAssets':
    'Reused the parameters and brought back {count} reference asset id(s); there is no local copy, so previews are unavailable.',
  'workbench.notice.acknowledged': 'Marked as checked: confirm in your provider console whether you were charged.',
  'workbench.notice.abandoned':
    'Abandoned this task: this service will not retry it and will not submit it upstream again.',
  'workbench.submit.cooldown': 'Cooling down {seconds}s',
  'workbench.submit.run': 'Generate video',
  'workbench.submit.runImage': 'Generate image',
  'workbench.key.none':
    'No key entered: the server falls back to its own key (if none is configured it returns KEY_MISSING).',
  'workbench.key.local': 'Key set · stored in plain text on this device (trusted devices only)',
  'workbench.key.session': 'Key set · valid for this session only',
  'workbench.alert.submitFailed': 'Submit failed',
  'workbench.footer.lead': 'Local demo build ·',
  'workbench.footer.waiting': ' waiting for a task',
  'workbench.footer.recent': ' latest task {id} · watching {time}',

  'workbench.center.eyebrow': 'Live viewport',
  'workbench.center.sizeNote': '{width}×{height} · aligned to a multiple of 32',
  'workbench.center.timecode': '{clock} · {status}',
  'workbench.center.cancel': 'Cancel task',
  'workbench.center.download': 'Download MP4',
  'workbench.center.unavailable': 'Task unavailable',
  'workbench.center.unavailableNote':
    'The task may have been cleaned up; start again from the history in the right column.',
  'workbench.center.waiting': 'Waiting for a generation task',
  'workbench.center.waitingNote':
    'Set the prompt and reference material on the left, then press the generate button.',
  'workbench.center.doneMark': 'Generation finished',
  'workbench.center.doneNoUrl': 'Task finished',
  'workbench.center.doneNoUrlNote':
    'but the output URL is missing (both outputVideoUrl and outputImageUrl are empty). That is abnormal — check the server output directory.',
  'workbench.center.imageAlt': 'The generated still image',
  'workbench.center.uncertain': 'Result unclear',
  'workbench.center.failedTitle': 'Not finished · {code}',
  'workbench.center.unknownError': 'unknown error',
  'workbench.center.failedMessage': 'Task failed',
  'workbench.center.retryable':
    'This error is retryable: check the external conditions (quota / rate limit / network) and you can submit the same parameters again.',
  'workbench.center.fatal':
    'This error is terminal: resubmitting will most likely fail again — fix the parameters or credentials first.',
  'workbench.center.reuse': 'Reuse parameters',
  'workbench.center.cancelled': 'Task cancelled',
  'workbench.center.cancelledNote': 'This task will not run any further.',
  'workbench.center.queued': 'Queued · waiting to run',
  'workbench.center.running': 'Generating · {status}',

  'workbench.uncertain.title': 'Unclear result · needs a manual check',
  'workbench.uncertain.feeNote':
    'You may already have been charged; check your provider console and sort it out by hand.',
  'workbench.uncertain.taskId.before': 'Task id ',
  'workbench.uncertain.taskId.after':
    ' — that id need not exist upstream: if the console shows no matching record, the request was never accepted.',
  'workbench.uncertain.noRetry.emphasis': 'No automatic retry, and deliberately no one-click resubmit',
  'workbench.uncertain.noRetry.after':
    ': resubmitting may be billed twice upstream. Once you have confirmed there was no charge, use the button below to start one new task with the same parameters.',
  'workbench.uncertain.acknowledged': 'Marked as checked',
  'workbench.uncertain.acknowledge': 'Mark as checked',
  'workbench.uncertain.abandon': 'Abandon task',

  'workbench.gallery.playTitle': 'Play this render in the centre column',
  'workbench.gallery.playAria': 'Play render #{index}',
  'workbench.gallery.noOutput': 'This task has no playable output',
  'workbench.gallery.emptyPrompt': '(no prompt)',
  'workbench.gallery.hasReference': ' · with reference image',
  'workbench.gallery.executedAt': '▸ ran on {label}',
  'workbench.gallery.deleting': 'Deleting…',

  'workbench.right.eyebrow': 'Tasks and gallery',
  'workbench.right.refreshing': 'Refreshing…',
  'workbench.right.refresh': 'Refresh',
  'workbench.right.current': 'Current task',
  'workbench.right.noCurrent': 'No task in progress',
  'workbench.right.history': 'Past renders ({count})',
  'workbench.right.noHistory': 'No past renders yet',
  'workbench.right.noHistoryNote':
    'Finished renders land here, and their parameters can be filled back in with one click.',

  'workbench.drop.previewAlt': '{label} crop preview',
  'workbench.drop.naturalSize.before': 'Source ',
  'workbench.drop.videoNote':
    'Reference videos are uploaded as-is, with no cropping or transcoding; whether upstream accepts them depends on the engine (cloud support for videos in `reference_image` is 【unverified】, see PLAN §5 batch 3-⑤).',
  'workbench.drop.cropTo.before': 'Crops to ',
  'workbench.drop.cropTo.after': ' (multiple of 32)',
  'workbench.drop.previewNote': 'The preview is the region the server is about to crop (centered)',
  'workbench.drop.metaLine': '{kind} · {mime} · {size}',
  'workbench.drop.reused.before': 'Reusing a reference asset ',
  'workbench.drop.reusedNote':
    'Parameter reuse only carries the asset id; this copy does not exist locally, so there is no preview — submitting still uses that asset.',
  'workbench.drop.reupload': 'Upload a different file',
  'workbench.drop.pickVideo': 'Click to pick, or drag a video here (mp4 / mov, ≤100MB)',
  'workbench.drop.pickImage': 'Click to pick, or drag an image here (≤100MB)',
  'workbench.drop.sniffNote': 'The server sniffs the real type from magic bytes, trusting neither filename nor Content-Type',

  'workbench.assets.needFirstFrame':
    '「Image to video」 needs a first frame: upload one above',
  'workbench.assets.needBothFramesNoFirst':
    '「First & last frame」 needs both frames: the first frame is missing',
  'workbench.assets.needBothFramesNoLast':
    '「First & last frame」 needs both frames: the last frame is missing',
  'workbench.assets.needReferenceVideo':
    '「Video reference」 needs a reference video: upload one above',
  'workbench.retired.title': 'The professional workbench is retired',
  'workbench.retired.body':
    'Prompt, parameters and result actions now live on the Create page; canvas nodes use the same parameter set. This page stays for one release so old bookmarks and deep links still work.',
  'workbench.retired.toCreate': 'Go to Create',
  'workbench.retired.toCanvas': 'Go to Canvas',
};
