/**
 * **创作入口**（`views/CreateView.tsx`：一句话开场那张卡）的文案。
 *
 * ## 两条边界（都写在这里，免得后来者以为是"漏了"）
 * 1. **配方 / 行业模板的名字与骨架不进字典**：`card.title` / `template.industry` /
 *    `template.title` / `template.skeleton` 是**内容**（写出来的素材），不是界面文案 ——
 *    它们要双语得先给数据加字段并逐条写英文，那是**内容双语**，另立项（见 PENDING-DECISIONS）。
 *    英文界面下它们**仍是中文**，这是如实的状态，不是 bug；
 * 2. **引擎的显示名（`option.label`）来自服务端** `/status`（部署者配置的实例名）——
 *    同样属内容，不进字典。本文件只管**我们自己写的**那些词
 *    （"云端 Seedance" / "本地" / "云端"）。
 */

export const CREATE_ZH = {
  // ── 开场 ──
  'create.hero.eyebrow': '创作 · 一句话开场',
  'create.hero.title': '描述你想要的画面',
  'create.hero.sub.before': '写一句话，或拖入一张图 / 一段视频；用 ',
  'create.hero.sub.after': ' 引用历史成片（含剪辑产物）当参考。',

  // ── 输入 ──
  'create.input.placeholder': '例如：雨夜街头，女孩撑伞回头微笑着说：我们终于成功了。电影感光影',
  'create.hint.mention': '＠ 引用素材 / 成片',
  'create.hint.mentionNote': '或在框里直接输入 @；也可以把图 / 视频拖进来、直接粘贴',
  'create.hint.submit': 'Enter 换行 · Ctrl/⌘ + Enter 生成',
  'create.type.aria': '创作类型',
  'create.type.label': '创作类型',
  'create.type.video': '视频',
  'create.type.image': '图片',
  'create.type.pending': '待接入',
  'create.type.imagePendingHint': '图像模型待配置：接入后即可在这里出图，当前不会提交任务。',
  'create.modeUnsupported': '这个引擎最近一次自检没有声明支持当前模式 —— 换引擎或重新自检',
  // （"上传中…" 提升到 `common.uploading`：素材槽与创作入口都要用同一句）
  'create.chip.remove': '移除素材',
  'create.chip.imageShort': '图',
  'create.chip.firstFrame': '首帧',
  'create.chip.lastFrame': '尾帧',
  'create.chip.referenceImage': '参考图',
  'create.chip.referenceVideo': '参考视频',
  'create.chip.referenceAudio': '参考音频',
  'create.chip.swap': '交换首尾',
  'create.chip.retry': '重试上传',
  'create.chip.uploadFailed': '上传失败',
  'create.chip.missing': '素材已失效',
  'create.realperson': '提示：含真人 / 拟真人脸的图做首帧·尾帧会被上游隐私检测拒绝 —— 可换非人物素材（风景 / 物体 / 动漫风格），或改用文字描述人物（T2V）。',

  // ── 引用弹层 ──
  'create.mention.select': '选择素材',
  'create.mention.search': '搜素材 / 成片…（Enter 选第一条，Esc 关闭）',
  'create.mention.empty': '没有匹配的素材。可以把图/视频直接拖进来上传，或先去工作台生成一条成片。',
  // （"✂ 剪辑产物 · " / "成片 · " 这两个行内前缀提升到 `common.origin.*Badge`：
  //   左栏的成片下拉也要用同一对）
  'create.mention.assetLine': '资产 · {kind} · {name}',

  // ── 配方 / 模板 ──
  'create.recipes.aria': '配方快捷',
  'create.recipes.all': '全部配方 →',
  'create.templates.aria': '行业模板',
  'create.templates.label': '行业模板',
  'create.templates.title': '{summary}\n推荐：{mode} · {ratio} · {duration}s{needImage}\n（会覆盖当前输入框内容）',
  'create.templates.needImage': ' · 需先拖入参考图',
  'create.templates.applied': '已套用「{industry} · {title}」起手式：推荐 {mode} · {ratio} · {duration}s · {tier}（可直接改）',

  // ── 更多设置 ──
  'create.more.aspect': '画幅',
  'create.more.duration': '时长',
  'create.more.resolution': '清晰度',
  'create.more.engine': '引擎',
  'create.more.seed': 'seed（留空随机）',
  'create.more.seedPlaceholder': '如 42',
  'create.more.enginesAria': '本地 ComfyUI 实例',
  'create.more.expand': '更多设置 ▼',
  'create.more.collapse': '收起设置 ▲',

  // ── 模式行 / 操作行 ──
  'create.modeLine': '将按「{mode}」生成',
  'create.modeLine.pending': '素材上传中，完成后即可提交。',
  'create.needsKey': '未配置 Key 且服务端无兜底：',
  'create.needsKey.action': '去填写凭据',
  // 费用**整组**（口径 / 后缀 / 金额句式）提升到 `common.cost.*`：
  // 创作入口与工作台显示的是同一件事，两处各写一份必然漂移
  'create.actions.note': '提交后停留在本页，进度与成片会出现在下方。',
  // （"提交中…"提升到 `common.submit.pending`：工作台的提交按钮也要用同一句）
  'create.submit': '✦ 生成',

  // ── 就地告警（标题；正文来自接口，不译）──
  'create.alert.uploadFailed': '素材上传未成功',
  'create.alert.poolFailed': '素材库读取失败',
  'create.alert.submitFailed': '提交未成功',
  'create.alert.pollFailed': '任务状态读取失败',

  // ── 任务卡 ──
  'create.task.idLine': '任务 {id} · {prompt}',
  'create.task.toWorkbench': '去专业模式查看',
  'create.task.failedFallback': '任务失败（详情见操作日志）',
  // V2.40：产物可能是图片（`t2i`）—— 文案不再写死 "MP4"
  'create.task.download': '⤓ 下载',
  'create.task.imageAlt': '本次生成的图片产物',
  'create.task.toEditor': '✂ 送剪辑台',
  'create.task.again': '↺ 再来一条',

  // ── 拖入 / 上传时的就地说明（逻辑层，用户同样看得见）──
  'create.upload.audioNotRef': '音频素材不作为生成参考：请到剪辑台的音效轨添加（造梦盒只收图片 / 视频）',
  'create.upload.noAsset': '上传未返回任何资产',
  'create.upload.noVisual': '这个文件里没有画面（纯音频）：请到剪辑台的音效轨使用',

  // ── `@` 提及素材的溢出提示（`lib/mentions.ts`；语言迁移第十五批）──
  // 两条都**必须说清"多余的那几个被丢了"**，并给出下一步（删 chip 才能换）——
  // 静默丢素材会让人以为服务端吃下了全部。
  'create.mentions.videoOverflow':
    '视频参考只允许第一个视频：另外 {count} 个素材不会参与本次生成，提交已停用 —— 请先删除对应 chip。',
  'create.mentions.imageOverflow':
    '首尾帧只允许前两张图片：另外 {count} 张不会参与本次生成，提交已停用 —— 请先删除对应 chip。',
};

export const CREATE_EN = {
  'create.hero.eyebrow': 'Create · one-line brief',
  'create.hero.title': 'Describe the shot you want',
  'create.hero.sub.before': 'Write one line, or drop in an image / video; use ',
  'create.hero.sub.after': ' to reference past renders (edited ones included) as references.',

  'create.input.placeholder':
    'e.g. Rainy street at night; a girl turns with an umbrella and smiles: "we finally made it." Cinematic light',
  'create.hint.mention': '＠ Reference assets / renders',
  'create.hint.mentionNote': 'Or type @ in the box; you can also drag images / videos in, or paste them',
  'create.hint.submit': 'Enter for a new line · Ctrl/⌘ + Enter to generate',
  'create.type.aria': 'Creation type',
  'create.type.label': 'Type',
  'create.type.video': 'Video',
  'create.type.image': 'Image',
  'create.type.pending': 'Not ready',
  'create.type.imagePendingHint': 'Image model is not configured yet. Nothing will be submitted until it is connected.',
  'create.modeUnsupported': 'The engine has not declared support for the current mode — switch engines or run the self-check again',
  'create.chip.remove': 'Remove reference',
  'create.chip.imageShort': 'img',
  'create.chip.firstFrame': 'First frame',
  'create.chip.lastFrame': 'Last frame',
  'create.chip.referenceImage': 'Reference image',
  'create.chip.referenceVideo': 'Reference video',
  'create.chip.referenceAudio': 'Reference audio',
  'create.chip.swap': 'Swap first/last',
  'create.chip.retry': 'Retry upload',
  'create.chip.uploadFailed': 'Upload failed',
  'create.chip.missing': 'Asset missing',
  'create.realperson':
    'Heads-up: images with real or realistic human faces are rejected by upstream privacy checks when used as first/last frames — pick non-human material (landscape / objects / anime) or describe the person in words (T2V).',

  'create.mention.select': 'Pick a reference',
  'create.mention.search': 'Search assets / renders… (Enter picks the first, Esc closes)',
  'create.mention.empty':
    'No matching assets. You can drag images/videos in to upload, or generate a render in the Workbench first.',
  'create.mention.assetLine': 'Asset · {kind} · {name}',

  'create.recipes.aria': 'Recipe shortcuts',
  'create.recipes.all': 'All recipes →',
  'create.templates.aria': 'Industry templates',
  'create.templates.label': 'Industry templates',
  'create.templates.title': '{summary}\nRecommends: {mode} · {ratio} · {duration}s{needImage}\n(overwrites what is in the box)',
  'create.templates.needImage': ' · needs a reference image first',
  'create.templates.applied':
    'Applied the “{industry} · {title}” starter: recommends {mode} · {ratio} · {duration}s · {tier} (editable)',

  'create.more.aspect': 'Aspect',
  'create.more.duration': 'Duration',
  'create.more.resolution': 'Resolution',
  'create.more.engine': 'Engine',
  'create.more.seed': 'seed (blank = random)',
  'create.more.seedPlaceholder': 'e.g. 42',
  'create.more.enginesAria': 'Local ComfyUI instances',
  'create.more.expand': 'More settings ▼',
  'create.more.collapse': 'Hide settings ▲',

  'create.modeLine': 'Will generate in “{mode}”',
  'create.modeLine.pending': 'Uploading assets — you can submit once it finishes.',
  'create.needsKey': 'No key configured and the server has no fallback:',
  'create.needsKey.action': 'Add credentials',
  'create.actions.note': 'You stay on this page; progress and the render show up below.',
  'create.submit': '✦ Generate',

  'create.alert.uploadFailed': 'Asset upload failed',
  'create.alert.poolFailed': 'Could not read the asset library',
  'create.alert.submitFailed': 'Submit failed',
  'create.alert.pollFailed': 'Could not read task status',

  'create.task.idLine': 'Task {id} · {prompt}',
  'create.task.toWorkbench': 'Open in Workbench',
  'create.task.failedFallback': 'Task failed (see the activity log for details)',
  'create.task.download': '⤓ Download',
  'create.task.imageAlt': 'The generated still image',
  'create.task.toEditor': '✂ Send to editor',
  'create.task.again': '↺ Another take',

  'create.upload.audioNotRef':
    'Audio is not a generation reference: add it on the editor’s SFX track (the Create box only takes images / videos)',
  'create.upload.noAsset': 'The upload returned no asset',
  'create.upload.noVisual': 'This file has no picture (audio only): use it on the editor’s SFX track',

  'create.mentions.videoOverflow':
    'Only the first video is allowed as a reference: {count} more assets will not be sent, and submit is disabled — delete the extra chips first.',
  'create.mentions.imageOverflow':
    'Only the first two images are allowed as frames: {count} more will not be sent, and submit is disabled — delete the extra chips first.',
};
