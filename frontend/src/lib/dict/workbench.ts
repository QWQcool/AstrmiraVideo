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
};
