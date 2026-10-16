/**
 * **画布域**的文案（语言迁移第九批 · 片 A：节点卡与编排检查器）。
 *
 * ## 为什么单独成域
 * 画布是本仓最大的一屏（`views/CanvasView.tsx` 一个文件就 71KB），文案分散在
 * **视图壳 + 四种节点卡 + 检查器抽屉 + 几份画布专属纯函数**里。单独成域是为了让
 * "画布还剩多少没迁"在一个文件里看得清（`dict/index.ts` 的进度注释同步指过来）。
 *
 * ## 片 A / 片 B 的分界（按**依赖**切，不是按文件大小）
 * 节点卡与检查器是**自包含组件**（文案全在自己内部，改文案不动别人）→ 片 A 一次迁完；
 * 而 `canvas/labels.ts` 是**被视图消费的映射表**、`lib/canvasPlan*.ts` 的返回值是
 * **视图要显示的字符串**，两者都要改调用点 → 与 `views/CanvasView.tsx` 同批（片 B）。
 *
 * ## 句内加粗：按本仓既有惯例拆段（`before` / `emphasis` / `after`）
 * `PlanInspector` 有两段话在句子中间夹了 `<strong>`。字典值只能是纯文本，所以拆成
 * `part1..partN`，**加粗由 JSX 保留** —— 拆段的边界把原来的空格**写进字典值里**
 * （如 `'只对 '` 尾随空格），这样渲染出来的字符串与迁移前**逐字节一致**。
 * 每组的键名上方都写了一句"拼起来是哪句话"，免得维护者对着 7 个片段猜。
 *
 * ## ⚠️ 迁移**不改文案**：本域里有一处内部术语（下一批会一起迁的 `lib/canvasPlan.ts` 里还有一处）
 * 原样写的是"**片 A 的编排**只支持这两种…"—— "片 A"是**本项目的开发术语**，用户看不懂。
 * 这是**迁移中发现的问题，不是迁移造成的**，按本仓纪律**照抄原文、另开条目修**
 * （与 `dict/byok.ts` 里那两个 `**` 同一条处理）。
 */

export const CANVAS_ZH = {
  // ── 便签（`canvas/NoteCard.tsx`）──
  'canvas.note.deleteAria': '删除便签',
  'canvas.note.placeholder': '写点什么：这是哪条链 / 为什么这么做 / 待办…',
  'canvas.note.editTitle': '点一下编辑',
  'canvas.note.empty': '（空便签）',

  // ── 编排节点卡（`canvas/PlanNodeCard.tsx`）──
  'canvas.planNode.emptyPrompt': '（还没写提示词）',
  'canvas.planNode.submitted': '✓ 已提交 {id}',
  'canvas.planNode.pinned': '📌 已固定 {id}',

  // ── 编排检查器（`canvas/PlanInspector.tsx`）──
  'canvas.inspector.title': '编排节点',
  'canvas.inspector.collapse': '收起',
  'canvas.inspector.subtitle': '这张卡是"打算做什么"；点「▶ 运行编排」才会变成真实任务。',
  'canvas.inspector.ready': '✓ 可以跑（写好了就点运行）',
  'canvas.inspector.blocked': '现在不能跑：{reason}',

  'canvas.inspector.run.title': '执行',
  'canvas.inspector.rerun.blockedHint': '先修好这条节点（原因见上）',
  'canvas.inspector.rerun.hint':
    '从这条节点开始重跑：它和它的下游都会新建任务（真的计费）；上游沿用上次产物',
  'canvas.inspector.rerun.action': '🔁 重跑此节点及下游',
  // 拼起来：换一代幂等键 → **这条与它的下游会新建任务（真的计费）**； 上游不在范围内、沿用上次产物。…
  'canvas.inspector.rerun.note.part1': '换一代幂等键 → ',
  'canvas.inspector.rerun.note.part2': '这条与它的下游会新建任务（真的计费）',
  'canvas.inspector.rerun.note.part3':
    '； 上游不在范围内、沿用上次产物。若某个上游本机没有产物记录，下游会如实跳过并说明原因。',

  'canvas.inspector.artifact.title': '产物',
  'canvas.inspector.pin.none': '还没有产物可固定 —— 先运行一次，出片之后就能把这一段钉住',
  'canvas.inspector.pin.lastTask': '上次产物 {id}（固定 = 之后任何运行都不再重提交它）',
  'canvas.inspector.pin.action': '📌 固定这条的产物',
  'canvas.inspector.pin.pinned':
    '📌 已固定 {id} —— 之后任何运行（含「重跑全部」）都不会再动这一段，下游一律引用它',
  'canvas.inspector.unpin.action': '🔓 取消固定',

  'canvas.inspector.retry.title': '失败重试',
  'canvas.inspector.retry.attempts': '提交失败最多试',
  'canvas.inspector.retry.option1': '1 次（不重试）',
  'canvas.inspector.retry.optionN': '{n} 次',
  // 拼起来：只对 **5xx / 网络错误**重试；参数错误（4xx）与**冷却（429）不重试**（后者的意思是"等一下再点"）。重试**沿用同一个幂等键** —— 不会因此多花一次钱。
  'canvas.inspector.retry.note.part1': '只对 ',
  'canvas.inspector.retry.note.part2': '5xx / 网络错误',
  'canvas.inspector.retry.note.part3': '重试；参数错误（4xx）与',
  'canvas.inspector.retry.note.part4': '冷却（429）不重试',
  'canvas.inspector.retry.note.part5': '（后者的意思是"等一下再点"）。重试',
  'canvas.inspector.retry.note.part6': '沿用同一个幂等键',
  'canvas.inspector.retry.note.part7': ' —— 不会因此多花一次钱。',

  'canvas.inspector.prompt.title': '提示词',
  'canvas.inspector.prompt.placeholder': '写清这一镜要什么（参考图/参考视频由连线给）',
  'canvas.inspector.mode.title': '模式',
  'canvas.inspector.mode.note': '片 A 的编排只支持这两种：i2v / fl2v 需要素材槽（选图上传），属后续片。',
  'canvas.inspector.size.title': '画幅与时长',
  'canvas.inspector.duration.label': '时长（秒，1~10）',
  'canvas.inspector.seed.label': 'seed（留空 = 随机）',
  'canvas.inspector.lastRun.title': '上次运行',
  'canvas.inspector.lastRun.submitted': '✓ 已提交：{id}',
  'canvas.inspector.remove': '删除节点',

  // ── 编排纯函数给出的原因（`lib/canvasPlan.ts`）──
  // 这些字符串**不是装饰**：它们是"不能跑"的全部解释 —— 每一个都必须能照着做下一步。
  'canvas.plan.block.notFound': '节点不存在（图刚被改过？）',
  'canvas.plan.block.emptyPrompt': '提示词为空',
  'canvas.plan.block.unsupportedMode':
    '模式 {mode} 不受编排支持（i2v / fl2v 需要素材槽，片 A 只支持 t2v / v2v）',
  'canvas.plan.block.tooManyUpstream':
    '有 {count} 条入边：v2v 只能接一个上游（不猜哪一个 —— 猜错就是拿错误输入烧钱）',
  'canvas.plan.block.t2vWithUpstream': '模式是 t2v 但接了一个上游：只有 v2v（视频参考）能引用上游产物',

  // ── 编排运行结果里的原因（`lib/canvasPlanRunner.ts`）──
  // `{short}` 是任务 id 的前 8 位（卡片上一行放不下完整 id）。
  'canvas.run.upstreamMissing':
    '引用的产物 {short} 在本服务上不存在（来自导入的编排，或任务记录已被清理）—— ' +
    '先重跑这一段（被固定的先取消固定），或直接重跑引用它的那个节点',
  'canvas.run.upstreamQueryFailed': '查询引用的产物 {short} 失败（{reason}）—— 稍后重试这次运行',
  'canvas.run.upstreamNoOutput': '上游 {short} 成功了但没有成片文件（可能已被容量淘汰清理）',
  'canvas.run.upstreamFailed': '上游 {short} 以 {status} 结束（没有可用成片）',
  'canvas.run.upstreamTimeout':
    '等待上游 {short} 出片超时（本地轨可能要很久：可在视频库看进度，出片后再点一次运行）',
  'canvas.run.keptPinned': '已固定：本次不重跑，下游引用固定的那份产物',
  'canvas.run.keptOutOfScope': '不在本次重跑范围内：沿用上次产物',
  'canvas.run.upstreamNotSubmitted':
    '上游没有提交成功 —— 本节点不带着错误输入去跑（上游那条的原因见它自己）',
  'canvas.run.upstreamNoRecord':
    '上游本次不在重跑范围、本机也没有它上次的产物记录 —— 先单独跑一次它，或把它固定住',
};

export const CANVAS_EN = {
  'canvas.note.deleteAria': 'Delete note',
  'canvas.note.placeholder': 'Write something: which chain is this / why this way / to-do…',
  'canvas.note.editTitle': 'Click to edit',
  'canvas.note.empty': '(empty note)',

  'canvas.planNode.emptyPrompt': '(no prompt yet)',
  'canvas.planNode.submitted': '✓ Submitted {id}',
  'canvas.planNode.pinned': '📌 Pinned {id}',

  'canvas.inspector.title': 'Plan node',
  'canvas.inspector.collapse': 'Collapse',
  'canvas.inspector.subtitle':
    'This card is "what we intend to do"; it becomes a real task only after you click 「▶ Run plan」.',
  'canvas.inspector.ready': '✓ Ready to run (click Run once the prompt is written)',
  'canvas.inspector.blocked': 'Cannot run yet: {reason}',

  'canvas.inspector.run.title': 'Run',
  'canvas.inspector.rerun.blockedHint': 'Fix this node first (reason above)',
  'canvas.inspector.rerun.hint':
    'Rerun starting from this node: it and its downstream nodes create new tasks (billed for real); upstream keeps its previous output',
  'canvas.inspector.rerun.action': '🔁 Rerun this node and downstream',
  'canvas.inspector.rerun.note.part1': 'A new idempotency-key generation → ',
  'canvas.inspector.rerun.note.part2': 'this node and its downstream nodes create new tasks (billed for real)',
  'canvas.inspector.rerun.note.part3':
    '; upstream is out of scope and keeps its previous output. If an upstream node has no output record on this machine, its downstream is skipped with the reason stated.',

  'canvas.inspector.artifact.title': 'Output',
  'canvas.inspector.pin.none': 'No output to pin yet — run once; once a video exists you can pin this node',
  'canvas.inspector.pin.lastTask': 'Previous output {id} (pinning = no future run will resubmit it)',
  'canvas.inspector.pin.action': '📌 Pin this node’s output',
  'canvas.inspector.pin.pinned':
    '📌 Pinned {id} — no run (including "Rerun all") will touch this node again; downstream always references it',
  'canvas.inspector.unpin.action': '🔓 Unpin',

  'canvas.inspector.retry.title': 'Retry on failure',
  'canvas.inspector.retry.attempts': 'On submit failure, try up to',
  'canvas.inspector.retry.option1': 'Once (no retry)',
  'canvas.inspector.retry.optionN': '{n} attempts',
  'canvas.inspector.retry.note.part1': 'Retry only on ',
  'canvas.inspector.retry.note.part2': '5xx / network errors',
  'canvas.inspector.retry.note.part3': '; parameter errors (4xx) and ',
  'canvas.inspector.retry.note.part4': 'cool-down (429) are not retried',
  'canvas.inspector.retry.note.part5': ' (the latter means "click again in a moment"). Retries ',
  'canvas.inspector.retry.note.part6': 'reuse the same idempotency key',
  'canvas.inspector.retry.note.part7': ' — so they never cost you an extra charge.',

  'canvas.inspector.prompt.title': 'Prompt',
  'canvas.inspector.prompt.placeholder':
    'Describe what this shot needs (reference image/video comes from the connections)',
  'canvas.inspector.mode.title': 'Mode',
  'canvas.inspector.mode.note':
    'The plan in slice A supports only these two: i2v / fl2v need an asset slot (pick & upload) and come in a later slice.',
  'canvas.inspector.size.title': 'Aspect ratio & duration',
  'canvas.inspector.duration.label': 'Duration (seconds, 1~10)',
  'canvas.inspector.seed.label': 'seed (blank = random)',
  'canvas.inspector.lastRun.title': 'Last run',
  'canvas.inspector.lastRun.submitted': '✓ Submitted: {id}',
  'canvas.inspector.remove': 'Delete node',

  'canvas.plan.block.notFound': 'Node not found (was the graph just edited?)',
  'canvas.plan.block.emptyPrompt': 'Prompt is empty',
  'canvas.plan.block.unsupportedMode':
    'Mode {mode} is not supported by the plan (i2v / fl2v need an asset slot; slice A supports only t2v / v2v)',
  'canvas.plan.block.tooManyUpstream':
    '{count} incoming edges: v2v accepts only one upstream (we do not guess which — guessing means burning money on wrong input)',
  'canvas.plan.block.t2vWithUpstream':
    'Mode is t2v but an upstream is connected: only v2v (video reference) can reference an upstream output',

  'canvas.run.upstreamMissing':
    'Referenced output {short} does not exist on this deployment (came from an imported plan, or the task record was cleaned up) — ' +
    'rerun this node first (unpin it if it is pinned), or rerun the node that references it',
  'canvas.run.upstreamQueryFailed': 'Querying referenced output {short} failed ({reason}) — retry this run later',
  'canvas.run.upstreamNoOutput':
    'Upstream {short} succeeded but has no video file (it may have been evicted by the capacity limit)',
  'canvas.run.upstreamFailed': 'Upstream {short} ended as {status} (no usable video)',
  'canvas.run.upstreamTimeout':
    'Timed out waiting for upstream {short} to produce a video (the local track can take a long while: watch it in the library, then click Run again)',
  'canvas.run.keptPinned': 'Pinned: not rerun in this run; downstream references the pinned output',
  'canvas.run.keptOutOfScope': 'Out of this rerun scope: reuses its previous output',
  'canvas.run.upstreamNotSubmitted':
    'The upstream did not submit successfully — this node will not run on top of bad input (see that node for its own reason)',
  'canvas.run.upstreamNoRecord':
    'The upstream is out of this rerun scope and this machine has no record of its previous output — run it on its own first, or pin it',
};
