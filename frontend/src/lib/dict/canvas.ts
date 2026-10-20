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
 *
 * ## 英文侧的空格与括号**按英文排版来**（不照搬中文）
 * 中文原文里 `（…）` 前后通常没有空格（全角括号自带视觉间距），英文写成 ` (…)` 才正常。
 * 所以**同一条键的中英值允许空格不同** —— 这是翻译的事实，不是"抄漏了"。
 * 反过来，**中文侧的边界空格一律照抄原文**（如 `'； 上游…'` / `'条可跑 （空提示词'`）：
 * 那些是 JSX 把跨行文本合成一个空格的结果，改了就与迁移前不一致。
 */

export const CANVAS_ZH = {
  'canvas.studio.new': '新建画布',
  'canvas.studio.delete': '删除画布',
  'canvas.studio.empty': '还没有画布',
  'canvas.studio.emptyHint': '新建一个画布，从左侧添加节点开始',
  'canvas.studio.saved': '已保存',
  'canvas.studio.unsaved': '未保存',
  'canvas.studio.saving': '保存中…',
  'canvas.studio.saveFailed': '保存失败',
  'canvas.studio.retrySave': '重试保存',
  'canvas.studio.reload': '重载画布（丢弃本地修改）',
  'canvas.studio.conflict': '画布已在别处更新或已删除：请重载后再编辑',
  'canvas.studio.saveBlocked': '保存失败：已留在当前画布，请重试后再切换',
  'canvas.studio.counts': '{nodes} 个节点 · {edges} 条连线',
  'canvas.studio.add': '添加节点',
  // ── 节点创作与编辑器（S3-B3；CONTRACT §21-10）──
  'canvas.studio.fromAssets': '资产库',
  'canvas.studio.upload': '上传',
  'canvas.studio.uploading': '上传中…',
  'canvas.studio.uploadMissing': '有 {count} 个上传文件没能从资产库回读到，未建节点',
  'canvas.studio.generate': '✨ 生成',
  'canvas.studio.promptPlaceholder': '描述你想生成的内容…',
  'canvas.studio.textPlaceholder': '写点什么（文本节点不提交生成）',
  'canvas.studio.textNodeHint': '文本节点只保存文字；要生成请用图片 / 视频节点',
  'canvas.studio.batches': '{count} 轮',
  'canvas.studio.progress': '{status} · {percent}%',
  'canvas.studio.noOutput': '还没有产物',
  'canvas.studio.submitUnknown': '提交中断（结果未知）',
  'canvas.studio.submitNotSent': '提交意图保存失败：请求没有发出，请先恢复保存再重试',
  'canvas.studio.submitUnknownNotice':
    '提交结果未知：提交意图已保存。请点「核对提交结果」确认，不要直接重新提交',
  'canvas.studio.recoverSubmit': '核对提交结果',
  'canvas.studio.recoverNoRequest': '这条批次没有保存提交内容，无法核对；只能等它失败后重新提交',
  'canvas.studio.recoverUnknown': '仍未确认提交结果：请检查网络后再核对一次，不要直接重新提交',
  'canvas.studio.recoverDone': '已核对到提交记录，继续等待任务结果',
  'canvas.studio.submitFailed': '提交未成功：{reason}',
  'canvas.studio.undo': '撤销',
  'canvas.studio.redo': '重做',
  'canvas.studio.copy': '复制',
  'canvas.studio.duplicate': '复制一份',
  'canvas.studio.paste': '粘贴',
  'canvas.studio.deleteNode': '删除节点',
  'canvas.studio.newNode': '新建{type}',
  'canvas.studio.guard.submitting': '正在提交生成 —— 等响应回来再切换/新建/删除（否则任务可能找不到归属）',
  'canvas.studio.guard.canvasActive': '这个画布还有任务在跑（或有提交结果待核对）—— 等任务结束或核对后再删除',
  'canvas.studio.guard.activeDelete': '这个节点还有任务在跑 —— 等它结束再删除（否则产物没有地方写回）',
  'canvas.studio.guard.activeUndo': '这次撤销会撤掉仍有任务在跑的节点 —— 先等任务结束再撤销',
  'canvas.studio.issue.emptyPrompt': '先写一句提示词',
  'canvas.studio.issue.activeTask': '这个节点还有任务在跑 —— 等它结束再提交（避免重复计费）',
  'canvas.studio.issue.references': '有参考素材当前服务端没有通道，不会被发送 —— 先移除它再提交',
  'canvas.studio.issue.imageLocal': '图片只能走本地 ComfyUI 或声明了 t2i 的远程服务',
  'canvas.studio.issue.imageUnavailable': '本地 ComfyUI 未配置：需要 COMFYUI_BASE_URL 与 EXPOSE_HOST_LOCAL_TRACK=1',
  'canvas.studio.issue.modeUnsupported': '这个引擎没有声明支持当前模式 —— 换一个引擎或重新自检',
  'canvas.studio.issue.cloudKey': '云端未配置 Key —— 去「凭据设置」填，或改用本地引擎',
  'canvas.studio.issue.provider': '这个引擎当前不可用（见设置里的引擎状态）',
  'canvas.studio.openByok': '去设置',
  'canvas.studio.priceLocal': '本地轨：无 API 费用',
  'canvas.studio.pricePending': '待核算',
  'canvas.studio.pickerTitle': '从资产库添加',
  'canvas.studio.pickerNodeNote': '所选条目会添加为「新节点」，不会改写现有节点的参考；来源会标为上传素材 / 首页产物 / 画布产物。',
  'canvas.studio.pickerSearch': '搜索名字或资产 id',
  'canvas.studio.pickerEmpty': '资产库里还没有素材',
  'canvas.studio.pickerLoading': '读取资产库…',
  'canvas.studio.pickerError': '资产库读取失败：{reason}',
  'canvas.studio.filterAll': '全部',
  'canvas.studio.selected': '已选 {count} 项',
  'canvas.studio.confirmAssets': '添加 {count} 项',
  'canvas.studio.close': '关闭',
  'canvas.studio.cancel': '取消',
  'canvas.studio.engine': '引擎',
  // ── 来源边（S3-B4；CONTRACT §21-11）──
  'canvas.studio.deleteEdge': '删除来源边',
  'canvas.studio.role.firstFrame': '首帧',
  'canvas.studio.role.lastFrame': '尾帧',
  'canvas.studio.role.referenceImage': '参考图',
  'canvas.studio.role.referenceVideo': '参考视频',
  'canvas.studio.role.referenceAudio': '参考音频',
  'canvas.studio.lineage.nodeMissing': '节点已不存在（刷新一下再试）',
  'canvas.studio.lineage.self': '不能连到节点自己',
  'canvas.studio.lineage.duplicate': '这两个节点已经连过（或同一产物已在参考里）',
  'canvas.studio.lineage.cycle': '会形成环 —— 来源边不能绕回上游',
  'canvas.studio.lineage.sourceNoOutput': '上游还没有产物 —— 先让它出片，再连来源',
  'canvas.studio.lineage.sourceAudio': '音频上游当前没有参考通道',
  'canvas.studio.lineage.sourceNotMedia': '上游产物不是图片或视频',
  'canvas.studio.lineage.targetNotVideo': '只有视频节点能接收参考',
  'canvas.studio.lineage.roleTaken': '首帧 / 尾帧 / 参考视频已经占满',
  // ── 旧血缘图下线（S3-B4）──
  'canvas.legacy.title': '血缘图已并入创作画布',
  'canvas.legacy.body':
    '旧只读血缘图已下线。现在来源关系直接画在创作画布上：从上游节点右侧的连接柄拖到下游视频节点即可。',
  'canvas.legacy.action': '打开创作画布',
  'canvas.node.text': '文本',
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

  // ── 边的图例（`views/CanvasView.tsx` 的 `EDGE_STYLE`）──
  'canvas.edge.edit': '剪辑自',
  'canvas.edge.extract': '抽帧',
  'canvas.edge.reference': '素材参考',
  'canvas.edge.taskRef': '成片参考',

  // ── 画布工具条（`views/CanvasView.tsx`）──
  // 带计数的那几条**刻意分成两个键**（`label` / `labelWithCount`）：括号是**全角还是半角**
  // 属于各语言的排版事实，不能由代码统一拼（英文用 ` (N)`、中文用 `（N）`）。
  'canvas.tool.togglePlan.off': '回到只读的事实图（编排本身会保留在本机）',
  'canvas.tool.togglePlan.on': '进入编排模式：自己摆节点、连线，然后一次提交',
  'canvas.tool.togglePlan.labelFact': '👁 事实图',
  'canvas.tool.togglePlan.labelPlan': '✎ 编排',
  'canvas.tool.addNode.title': '在视口中心加一个生成节点（加完在右侧写提示词）',
  'canvas.tool.addNode.label': '＋ 节点',
  'canvas.tool.run.noneRunnable': '没有能跑的节点（空提示词 / 被阻断的都不能跑 —— 点节点看原因）',
  'canvas.tool.run.title': '按依赖顺序提交 {count} 条任务（同一编排重复点不会重复计费）',
  'canvas.tool.run.running': '⏳ 运行中…',
  'canvas.tool.run.label': '▶ 运行编排',
  'canvas.tool.run.labelWithCount': '▶ 运行编排（{count}）',
  // 刻意**拆成两段字面量**（与原文那句 `+` 拼接同形）：这样每一段在源码里都是连续的，
  // 忠实性核对能真正把它当"整句"验一遍（不拆的话它会落进"跨边界核对不到"那一类）。
  'canvas.tool.rerun.title':
    '整张图再来一遍：换一代幂等键 → 会新建 {count} 条任务（真的计费）。' +
    '当前是第 {seq} 轮；跑完变成第 {next} 轮',
  'canvas.tool.rerun.label': '🔁 重跑全部',
  'canvas.tool.export.title':
    '把这份编排导出为 JSON 文件（含产物 ID 注记：它们只在本机部署有意义；不含凭据）',
  'canvas.tool.export.label': '⤓ 导出编排',
  'canvas.tool.import.title':
    '从 JSON 文件导入一份编排（会替换当前编排；当前非空时先确认，不会静默覆盖）',
  'canvas.tool.import.label': '⤒ 导入编排',
  'canvas.tool.earlier.loading': '正在取更早的任务…',
  'canvas.tool.earlier.more': '把更早的任务也画进来（每次 {size} 条）',
  'canvas.tool.earlier.none': '已经没有更早的任务了',
  'canvas.tool.earlier.labelLoading': '⏳ 加载中…',
  'canvas.tool.earlier.labelMore': '⏮ 加载更早',
  'canvas.tool.earlier.labelDone': '⏮ 已全部加载',
  'canvas.tool.zoomSelection.hint': '先在画布上框选节点，或按住 Shift 点选多个节点',
  'canvas.tool.zoomSelection.title': '把选中的 {count} 个节点填满视口',
  'canvas.tool.zoomSelection.label': '◎ 缩放到选区',
  'canvas.tool.zoomSelection.labelWithCount': '◎ 缩放到选区（{count}）',
  'canvas.tool.addNote.title': '在视口中心贴一张便签（写清「这是哪条链、为什么这么做」）',
  'canvas.tool.addNote.label': '＋ 便签',
  'canvas.tool.fitAll.title': '缩放到全部节点（等同左下角控件里的适配按钮）',
  'canvas.tool.fitAll.label': '⤢ 全部',

  // ── 视图壳（`views/CanvasView.tsx`）──
  'canvas.title.plan': '画布编排',
  'canvas.title.lineage': '血缘画布',
  'canvas.legend.aria': '边的图例',
  // 编排顶栏那段说明：句子里夹了两个 `<strong>` 与一个 `<b>` → 按本仓惯例拆段
  // （拼起来：连线 = 数据流…一次提交 —— **重复点不会重复计费**（…）。「🔁 重跑」则相反…—— **会新建任务（真的计费）**；
  //   在节点面板里可以只重跑 **一段**（它和它的下游，上游沿用上次产物））
  'canvas.plan.hint.part1': '连线 = 数据流（只有 v2v 能接上游）；「▶ 运行编排」按依赖顺序一次提交 ——',
  'canvas.plan.hint.part2': '重复点不会重复计费',
  'canvas.plan.hint.part3': '（同一编排同一节点用的幂等键是固定的）。',
  'canvas.plan.hint.part4': '「🔁 重跑」则相反：它换一代幂等键 ——',
  'canvas.plan.hint.part5': '会新建任务（真的计费）',
  // ⚠️ `part6` 开头的"； "里那个空格是**原文的样子**（JSX 把跨行文本合成一个空格），别顺手删
  'canvas.plan.hint.part6': '； 在节点面板里可以只重跑',
  'canvas.plan.hint.part7': '一段',
  'canvas.plan.hint.part8': '（它和它的下游，上游沿用上次产物）',
  'canvas.plan.runSeq': '（当前第 {seq} 轮）',

  // ── 检查器抽屉：留痕（`NodeLogList`）──
  'canvas.trail.error': '留痕读取失败：{reason}',
  'canvas.trail.loading': '正在读取留痕…',
  'canvas.trail.empty': '没有留痕（这条任务早于操作日志功能，或已被日志保留策略清掉）。',

  // ── 检查器抽屉（`CanvasInspector`）──
  'canvas.insp.aria': '节点详情',
  'canvas.insp.close': '关闭详情',
  'canvas.insp.ghost': '这个对象已不在当前列表里（删除过或超出最近 50 条）——仅作为血缘占位显示。',
  'canvas.insp.imageAlt': '本次生成的图片产物',
  'canvas.insp.section.prompt': '提示词',
  'canvas.insp.noSnapshot': '（无快照）',
  'canvas.insp.kv.mode': '模式',
  'canvas.insp.kv.aspect': '画幅',
  'canvas.insp.kv.duration': '时长',
  'canvas.insp.kv.engine': '引擎',
  'canvas.insp.kv.seed': '种子',
  'canvas.insp.seedRandom': '随机',
  'canvas.insp.kv.output': '产物',
  'canvas.insp.outputDone': '已出片',
  'canvas.insp.outputNone': '无',
  'canvas.insp.section.inputs': '输入素材',
  'canvas.insp.input.firstFrame': '首帧图',
  'canvas.insp.input.lastFrame': '尾帧图',
  'canvas.insp.input.referenceVideo': '视频参考',
  'canvas.insp.jump.missing': '这个引用不在当前画布上',
  'canvas.insp.jump.go': '跳到这个节点',
  'canvas.insp.jump.offCanvas': '（画布外）',
  'canvas.insp.section.cost': '成本',
  // ⚠️ 原文里那两个 `**` 是作者写粗体时**留在了界面上**的 —— 迁移照抄（要修另开条目，见 dict/byok.ts 同一处理）
  'canvas.insp.cost.unrecorded': '未记录成本（老任务或尚未结算）。金额口径见 CONTRACT §13，**以方舟账单为准**。',
  'canvas.insp.cost.note': '（{source}）',
  'canvas.insp.cost.noteFallback': '（{source} · 未命中单价表，按兜底价）',
  'canvas.insp.cost.model': '模型 {model} · {seconds}s · {width}×{height}',
  'canvas.insp.section.warnings': '警告（{count}）',
  'canvas.insp.section.error': '错误',
  'canvas.insp.error.disposition': '处置：{text}',
  'canvas.insp.section.trail': '这条任务发生了什么',
  'canvas.insp.trail.all': '去操作日志页看全部 →',
  'canvas.insp.section.asset': '资产',
  'canvas.insp.kv.assetKind': '类型',
  'canvas.insp.kv.assetSize': '体积',
  'canvas.insp.kv.assetCreated': '上传于',
  'canvas.insp.section.lineage': '血缘',
  'canvas.insp.lineage.upstream': '↑ 上游',
  'canvas.insp.lineage.downstream': '↓ 下游',
  'canvas.insp.action.reuse': '⟲ 复用参数',
  'canvas.insp.action.toEdit': '✂ 送剪辑台',
  'canvas.insp.action.asReference': '🎬 设为视频参考',
  'canvas.insp.action.asFirstFrame': '🖼 当作首帧（I2V）',
  'canvas.insp.action.openOriginal': '⧉ 打开原文件',
  'canvas.insp.export.done': '已导出：{tasks} 条任务 · {assets} 个资产',
  'canvas.insp.export.doneWithOmitted':
    '已导出：{tasks} 条任务 · {assets} 个资产 · {omitted} 个对象已不在画布上（记在 omitted）',
  'canvas.insp.export.failed': '导出失败：{reason}',
  'canvas.insp.exportPack.title': '把这条片子的上游配方链导出为 JSON（不含凭据与 provider 私有参数）',
  'canvas.insp.exportPack.label': '⤓ 导出配方包',

  // ── 成本来源（`COST_SOURCE_KEYS`）──
  'canvas.costSource.estimate': '预估（公开价目）',
  'canvas.costSource.localFree': '本地轨 · 免费',
  'canvas.costSource.upstream': '上游真实值',

  // ── 编排的提示与通知（`CanvasView` 的运行 / 文件两条线）──
  'canvas.plan.brokenNotice': '本机有一份读不出来的编排（可能是更新版本写的）—— 原文已保留，你一旦改动就会被覆盖',
  'canvas.plan.broken.title': '本机的编排读不出来',
  'canvas.plan.broken.body': '它可能是更新版本写的 —— 原文已保留；你一旦改动（加节点 / 连线）就会覆盖它。',
  'canvas.plan.notice.cycle': '图里有环（{count} 个节点参与）—— 一个都没提交，先解开环再跑',
  'canvas.plan.notice.submitted': '已提交 {count} 条任务',
  'canvas.plan.notice.kept': '{count} 条沿用上次产物',
  'canvas.plan.notice.bad': '{count} 条跳过或失败（原因在节点卡上）',
  'canvas.plan.notice.rerunHead': '第 {seq} 轮（显式重跑：这些是新建的任务）—— ',
  'canvas.plan.notice.runFailed': '运行失败：{reason}',
  /** 列表分隔符也是**排版事实**（中文全角逗号 / 英文半角逗号 + 空格）→ 进字典，不写死在代码里 */
  'canvas.plan.notice.separator': '，',
  'canvas.plan.file.exported':
    '已导出「{name}」：{nodes} 个节点 · {edges} 条连线（文件里 {notes} 条注记，含"这份文件不含什么"）',
  'canvas.plan.file.imported':
    '已导入「{name}」：{nodes} 个节点 · {edges} 条连线（新的编排身份 —— 首次「▶ 运行编排」会新建任务）',
  'canvas.plan.file.importRejected': '导入失败：{reason}（当前编排未变动）',
  'canvas.plan.file.importUnreadable': '导入失败：读不到文件内容（{reason}）',
  'canvas.plan.importConfirm.part1': '导入会',
  'canvas.plan.importConfirm.part2': '替换当前编排',
  'canvas.plan.importConfirm.part3':
    '（现在有 {nodes} 个节点 · {edges} 条连线；文件里是「{name}」{fileNodes} 个节点）—— 想留一份的话，先「⤓ 导出编排」。',
  'canvas.plan.importConfirm.yes': '确认导入',
  'canvas.plan.importConfirm.cancel': '取消',
  // ⚠️ "条可跑" 与 "（空提示词" 之间那个空格同样是**原文的样子**（跨行文本合成）——别删
  'canvas.plan.count':
    '编排：{nodes} 个节点 · {edges} 条连线 · {runnable} 条可跑 （空提示词 / 被阻断的都不会提交 —— 点节点看原因）。位置与参数存在本机浏览器、按项目隔离。',

  // ── 事实图的加载 / 空态 / 状态栏 / 窄屏提示 ──
  'canvas.load.error': '画布数据读取失败',
  'canvas.load.loading': '正在读取血缘数据…',
  'canvas.empty.title': '这里还是一张白纸',
  'canvas.empty.body': '还没有任何生成记录 —— 去创作入口写下第一句话，成片与它的派生关系会自动出现在这里。',
  'canvas.empty.action': '去创作',
  'canvas.graph.summary':
    '{nodes} 个节点 · {edges} 条派生边（列 = 派生顺序，行 = 时间倒序）。 只读视图：点节点看详情与动作；拖动只是挪位置，不保存。',
  'canvas.status.allOk': '✓ 没有失败/待核对的任务',
  'canvas.status.problems': '⚠ {count} 个节点异常',
  'canvas.status.onlyProblems.title': '把非异常节点调暗（不删图），方便一眼看出哪里不对',
  'canvas.status.showAll': '显示全部',
  'canvas.status.onlyProblems': '只看异常',
  'canvas.status.queue': '队列中 {count} 条',
  'canvas.status.queueOldest': '（最久已等 {seconds}s）',
  'canvas.status.queueSingle': '· 本机一次只跑 1 条',
  'canvas.mobile.part1': '画布在窄屏上不好用：请到桌面端查看，或先去',
  'canvas.mobile.library': '视频库',
  'canvas.mobile.part2': '看列表。',

  // ── 编排文件（`lib/canvasPlanFile.ts`；语言迁移第十八批——它从共享包搬来前端）──
  // 这一层的每一句都是**导入失败时直接显示给用户的原因**（含"该怎么做"）。
  // ⚠️ 文件里那四条 `notes` **没进字典**：它们是**产物内容**（写进导出的 JSON，接收方按格式读）
  // —— 与交付包里的 `交付清单.json` 同一条口径（产物不跟界面语言走）。
  /** 列举 id / 边时用的**列表分隔符**（中文顿号 vs 英文逗号 + 空格：排版事实） */
  'canvas.file.listSeparator': '、',
  /** 多条结构问题之间的分隔符（同样进字典，不写死在代码里） */
  'canvas.file.issueSeparator': '；',
  'canvas.file.issue.duplicateNodes': '有重复的节点 id：{ids}',
  'canvas.file.issue.danglingEdges': '有连到不存在节点的边：{ids}',
  'canvas.file.issue.selfLoops': '有自己连自己的边（自环）：{ids}',
  'canvas.file.issue.repeatedEdges': '有重复的边（同向同端点）：{ids}',
  'canvas.file.reason.notJson': '这不是一份 JSON 文件（解析失败）—— 请选择本产品「⤓ 导出编排」导出的文件',
  'canvas.file.reason.notObject': '文件顶层不是对象 —— 不像本产品导出的编排文件',
  'canvas.file.reason.notPlanFileKind':
    '这不是编排文件（kind = {kind}）—— 本产品导出的编排文件 kind 应为 {expected}',
  'canvas.file.reason.notPlanFileNoKind':
    '这不是编排文件（文件里没有 kind 标识）—— 请选择本产品「⤓ 导出编排」导出的文件',
  'canvas.file.reason.newerVersion':
    '这份编排文件来自更新的版本（v{fileVersion} > 本机 v{localVersion}）：请升级本机版本后再打开',
  'canvas.file.reason.migrationBroken': '内部错误：迁移链没把 v{fromVersion} 带到 v{toVersion}',
  'canvas.file.reason.invalidPlan': '编排内容不完整或格式不对',
  'canvas.file.reason.invalidPlanDetail': '编排内容不完整或格式不对：{detail}',
  'canvas.file.reason.badGraph': '编排里的图不成立：{issues}',
  'canvas.file.note.noVersion': '文件里没有版本号，按 v1 处理',

  // ── 血缘图（`lib/lineage.ts`；语言迁移第十五批）──
  // 幽灵节点的标签是**界面文案**（画布上真会显示"任务 7f3a12b0 / 不在最近记录里"），走字典；
  // 而导出包里那两条 `notes` 是**产物内容**（写进 JSON，且会被下游按格式读），**保持中文**
  // （`lib/lineage.ts` 行内有 `i18n-exempt` 标记说明）。
  'canvas.lineage.nodeMissing': '画布上没有这个节点：{id}',
  'canvas.lineage.ghostTaskLabel': '任务 {id}',
  'canvas.lineage.ghostTaskSub': '不在最近记录里（已删除或超出列表）',
  'canvas.lineage.ghostAssetLabel': '资产 {id}',
  'canvas.lineage.ghostAssetSub': '不在资产库里（已清理或超出列表）',
  'canvas.lineage.editOutput': '剪辑产物',
};

export const CANVAS_EN = {
  'canvas.studio.new': 'New canvas',
  'canvas.studio.delete': 'Delete canvas',
  'canvas.studio.empty': 'No canvas yet',
  'canvas.studio.emptyHint': 'Create one, then add nodes from the left rail',
  'canvas.studio.saved': 'Saved',
  'canvas.studio.unsaved': 'Unsaved',
  'canvas.studio.saving': 'Saving…',
  'canvas.studio.saveFailed': 'Save failed',
  'canvas.studio.retrySave': 'Retry save',
  'canvas.studio.reload': 'Reload canvas (discard local changes)',
  'canvas.studio.conflict': 'The canvas changed elsewhere or was deleted — reload before editing',
  'canvas.studio.saveBlocked': 'Save failed: staying on this canvas — retry before switching',
  'canvas.studio.counts': '{nodes} nodes · {edges} edges',
  'canvas.studio.add': 'Add node',
  'canvas.studio.fromAssets': 'Assets',
  'canvas.studio.upload': 'Upload',
  'canvas.studio.uploading': 'Uploading…',
  'canvas.studio.uploadMissing': '{count} uploaded file(s) could not be read back from the library; no node was created',
  'canvas.studio.generate': '✨ Generate',
  'canvas.studio.promptPlaceholder': 'Describe what you want to generate…',
  'canvas.studio.textPlaceholder': 'Write something (text nodes do not generate)',
  'canvas.studio.textNodeHint': 'Text nodes only store text; use an image / video node to generate',
  'canvas.studio.batches': '{count} run(s)',
  'canvas.studio.progress': '{status} · {percent}%',
  'canvas.studio.noOutput': 'No output yet',
  'canvas.studio.submitUnknown': 'Submit interrupted (result unknown)',
  'canvas.studio.submitNotSent': 'The submission intent could not be saved; the request was not sent. Restore saving and try again',
  'canvas.studio.submitUnknownNotice':
    'Submit result unknown: the intent is saved. Use “Reconcile submission” instead of submitting again',
  'canvas.studio.recoverSubmit': 'Reconcile submission',
  'canvas.studio.recoverNoRequest': 'This batch has no saved request, so it cannot be reconciled; wait for it to fail, then submit again',
  'canvas.studio.recoverUnknown': 'Still unconfirmed: check the network and reconcile again; do not submit a new task',
  'canvas.studio.recoverDone': 'Submission record found; waiting for the task result',
  'canvas.studio.submitFailed': 'Submit failed: {reason}',
  'canvas.studio.undo': 'Undo',
  'canvas.studio.redo': 'Redo',
  'canvas.studio.copy': 'Copy',
  'canvas.studio.duplicate': 'Duplicate',
  'canvas.studio.paste': 'Paste',
  'canvas.studio.deleteNode': 'Delete node',
  'canvas.studio.newNode': 'New {type}',
  'canvas.studio.guard.submitting':
    'A generation is being submitted — wait for the response before switching, creating or deleting (otherwise the task may lose its project)',
  'canvas.studio.guard.canvasActive':
    'This canvas still has a running task (or a submission to reconcile) — wait for it before deleting',
  'canvas.studio.guard.activeDelete': 'This node still has a running task — wait for it before deleting (otherwise the output has nowhere to go)',
  'canvas.studio.guard.activeUndo': 'This undo would remove a node with a running task — wait for the task to finish first',
  'canvas.studio.issue.emptyPrompt': 'Write a prompt first',
  'canvas.studio.issue.activeTask': 'This node still has a running task — wait for it before submitting (avoids double billing)',
  'canvas.studio.issue.references': 'Some references have no channel on this server and would not be sent — remove them before submitting',
  'canvas.studio.issue.imageLocal':
    'Images can only run on the local ComfyUI or a remote service that declares t2i',
  'canvas.studio.issue.imageUnavailable': 'Local ComfyUI is not configured: set COMFYUI_BASE_URL and EXPOSE_HOST_LOCAL_TRACK=1',
  'canvas.studio.issue.modeUnsupported': 'This engine has not declared support for the current mode — switch engines or run the self-check again',
  'canvas.studio.issue.cloudKey': 'Cloud has no key — open Credentials to add one, or switch to a local engine',
  'canvas.studio.issue.provider': 'This engine is unavailable right now (see the engine status in settings)',
  'canvas.studio.openByok': 'Open settings',
  'canvas.studio.priceLocal': 'Local track: no API cost',
  'canvas.studio.pricePending': 'Not priced',
  'canvas.studio.pickerTitle': 'Add from assets',
  'canvas.studio.pickerNodeNote': 'Selections become new nodes and do not modify existing node references; each item is labelled uploaded asset, home output or canvas output.',
  'canvas.studio.pickerSearch': 'Search by name or asset id',
  'canvas.studio.pickerEmpty': 'No assets yet',
  'canvas.studio.pickerLoading': 'Loading assets…',
  'canvas.studio.pickerError': 'Could not load assets: {reason}',
  'canvas.studio.filterAll': 'All',
  'canvas.studio.selected': '{count} selected',
  'canvas.studio.confirmAssets': 'Add {count}',
  'canvas.studio.close': 'Close',
  'canvas.studio.cancel': 'Cancel',
  'canvas.studio.engine': 'Engine',
  'canvas.studio.deleteEdge': 'Delete source edge',
  'canvas.studio.role.firstFrame': 'First frame',
  'canvas.studio.role.lastFrame': 'Last frame',
  'canvas.studio.role.referenceImage': 'Reference image',
  'canvas.studio.role.referenceVideo': 'Reference video',
  'canvas.studio.role.referenceAudio': 'Reference audio',
  'canvas.studio.lineage.nodeMissing': 'That node no longer exists (reload and try again)',
  'canvas.studio.lineage.self': 'A node cannot connect to itself',
  'canvas.studio.lineage.duplicate': 'These two nodes are already connected (or the output is already a reference)',
  'canvas.studio.lineage.cycle': 'That would create a cycle — source edges cannot loop back upstream',
  'canvas.studio.lineage.sourceNoOutput': 'The upstream node has no output yet — generate first, then connect',
  'canvas.studio.lineage.sourceAudio': 'Audio sources have no reference channel right now',
  'canvas.studio.lineage.sourceNotMedia': 'The upstream output is neither image nor video',
  'canvas.studio.lineage.targetNotVideo': 'Only video nodes can receive references',
  'canvas.studio.lineage.roleTaken': 'First frame / last frame / reference video are already taken',
  'canvas.legacy.title': 'The lineage view is now part of the studio canvas',
  'canvas.legacy.body':
    'The old read-only lineage view has been retired. Source relationships are drawn on the studio canvas: drag from the right handle of an upstream node to a downstream video node.',
  'canvas.legacy.action': 'Open the studio canvas',
  'canvas.node.text': 'Text',
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

  'canvas.edge.edit': 'Edited from',
  'canvas.edge.extract': 'Frame grab',
  'canvas.edge.reference': 'Asset reference',
  'canvas.edge.taskRef': 'Render reference',

  'canvas.tool.togglePlan.off': 'Back to the read-only fact graph (the plan itself stays on this machine)',
  'canvas.tool.togglePlan.on': 'Enter plan mode: place nodes, connect them, then submit in one go',
  'canvas.tool.togglePlan.labelFact': '👁 Fact graph',
  'canvas.tool.togglePlan.labelPlan': '✎ Plan',
  'canvas.tool.addNode.title': 'Add a generate node at the viewport center (write its prompt on the right)',
  'canvas.tool.addNode.label': '＋ Node',
  'canvas.tool.run.noneRunnable':
    'No runnable nodes (empty prompts / blocked ones cannot run — click a node to see why)',
  'canvas.tool.run.title':
    'Submit {count} tasks in dependency order (clicking again on the same plan will not double-charge)',
  'canvas.tool.run.running': '⏳ Running…',
  'canvas.tool.run.label': '▶ Run plan',
  'canvas.tool.run.labelWithCount': '▶ Run plan ({count})',
  'canvas.tool.rerun.title':
    'Run the whole graph again: a new idempotency-key generation → {count} new tasks (billed for real). Currently round {seq}; it becomes round {next} when done',
  'canvas.tool.rerun.label': '🔁 Rerun all',
  'canvas.tool.export.title':
    'Export this plan as a JSON file (includes output-ID notes: they only mean something on this deployment; no credentials)',
  'canvas.tool.export.label': '⤓ Export plan',
  'canvas.tool.import.title':
    'Import a plan from a JSON file (replaces the current plan; asks first when the current one is not empty — never overwrites silently)',
  'canvas.tool.import.label': '⤒ Import plan',
  'canvas.tool.earlier.loading': 'Fetching earlier tasks…',
  'canvas.tool.earlier.more': 'Also draw earlier tasks ({size} per click)',
  'canvas.tool.earlier.none': 'No earlier tasks left',
  'canvas.tool.earlier.labelLoading': '⏳ Loading…',
  'canvas.tool.earlier.labelMore': '⏮ Load earlier',
  'canvas.tool.earlier.labelDone': '⏮ All loaded',
  'canvas.tool.zoomSelection.hint': 'Box-select nodes on the canvas first, or Shift-click several nodes',
  'canvas.tool.zoomSelection.title': 'Fill the viewport with the selected {count} nodes',
  'canvas.tool.zoomSelection.label': '◎ Zoom to selection',
  'canvas.tool.zoomSelection.labelWithCount': '◎ Zoom to selection ({count})',
  'canvas.tool.addNote.title':
    'Pin a note at the viewport center (write down: which chain is this, why this way)',
  'canvas.tool.addNote.label': '＋ Note',
  'canvas.tool.fitAll.title': 'Zoom to all nodes (same as the fit button in the bottom-left controls)',
  'canvas.tool.fitAll.label': '⤢ All',

  'canvas.title.plan': 'Canvas plan',
  'canvas.title.lineage': 'Lineage canvas',
  'canvas.legend.aria': 'Edge legend',
  'canvas.plan.hint.part1':
    'Connections = data flow (only v2v can take an upstream); 「▶ Run plan」 submits everything in dependency order —',
  'canvas.plan.hint.part2': 'clicking it again does not double-charge',
  'canvas.plan.hint.part3': ' (the idempotency key for a plan node is fixed).',
  'canvas.plan.hint.part4': '「🔁 Rerun」 is the opposite: it uses a new idempotency-key generation —',
  'canvas.plan.hint.part5': 'it creates new tasks (billed for real)',
  'canvas.plan.hint.part6': '; in the node panel you can rerun just ',
  'canvas.plan.hint.part7': 'one segment',
  'canvas.plan.hint.part8': ' (it and its downstream, upstream keeps its previous output)',

  'canvas.plan.runSeq': '(round {seq} right now)',

  'canvas.trail.error': 'Could not read the trail: {reason}',
  'canvas.trail.loading': 'Reading the trail…',
  'canvas.trail.empty': 'No trail (this task predates the activity log, or its records were cleaned up).',

  'canvas.insp.aria': 'Node details',
  'canvas.insp.close': 'Close details',
  'canvas.insp.ghost':
    'This object is no longer in the current list (deleted, or beyond the latest 50) — shown as a lineage placeholder only.',
  'canvas.insp.imageAlt': 'The generated still image',
  'canvas.insp.section.prompt': 'Prompt',
  'canvas.insp.noSnapshot': '(no snapshot)',
  'canvas.insp.kv.mode': 'Mode',
  'canvas.insp.kv.aspect': 'Aspect',
  'canvas.insp.kv.duration': 'Duration',
  'canvas.insp.kv.engine': 'Engine',
  'canvas.insp.kv.seed': 'Seed',
  'canvas.insp.seedRandom': 'Random',
  'canvas.insp.kv.output': 'Output',
  'canvas.insp.outputDone': 'Produced',
  'canvas.insp.outputNone': 'None',
  'canvas.insp.section.inputs': 'Input assets',
  'canvas.insp.input.firstFrame': 'First frame',
  'canvas.insp.input.lastFrame': 'Last frame',
  'canvas.insp.input.referenceVideo': 'Reference video',
  'canvas.insp.jump.missing': 'This reference is not on the current canvas',
  'canvas.insp.jump.go': 'Jump to this node',
  'canvas.insp.jump.offCanvas': ' (off canvas)',
  'canvas.insp.section.cost': 'Cost',
  'canvas.insp.cost.unrecorded':
    'No cost recorded (old task or not settled yet). For the pricing basis see CONTRACT §13; **the Ark bill is authoritative**.',
  'canvas.insp.cost.note': ' ({source})',
  'canvas.insp.cost.noteFallback': ' ({source} · price-table miss, using the fallback rate)',
  'canvas.insp.cost.model': 'Model {model} · {seconds}s · {width}×{height}',
  'canvas.insp.section.warnings': 'Warnings ({count})',
  'canvas.insp.section.error': 'Error',
  'canvas.insp.error.disposition': 'Handling: {text}',
  'canvas.insp.section.trail': 'What happened to this task',
  'canvas.insp.trail.all': 'See everything in the activity log →',
  'canvas.insp.section.asset': 'Asset',
  'canvas.insp.kv.assetKind': 'Kind',
  'canvas.insp.kv.assetSize': 'Size',
  'canvas.insp.kv.assetCreated': 'Uploaded',
  'canvas.insp.section.lineage': 'Lineage',
  'canvas.insp.lineage.upstream': '↑ Upstream',
  'canvas.insp.lineage.downstream': '↓ Downstream',
  'canvas.insp.action.reuse': '⟲ Reuse parameters',
  'canvas.insp.action.toEdit': '✂ Send to edit desk',
  'canvas.insp.action.asReference': '🎬 Use as reference video',
  'canvas.insp.action.asFirstFrame': '🖼 Use as first frame (I2V)',
  'canvas.insp.action.openOriginal': '⧉ Open the original file',
  'canvas.insp.export.done': 'Exported: {tasks} tasks · {assets} assets',
  'canvas.insp.export.doneWithOmitted':
    'Exported: {tasks} tasks · {assets} assets · {omitted} objects are no longer on the canvas (listed under omitted)',
  'canvas.insp.export.failed': 'Export failed: {reason}',
  'canvas.insp.exportPack.title':
    'Export the upstream recipe chain of this clip as JSON (no credentials, no provider-private parameters)',
  'canvas.insp.exportPack.label': '⤓ Export recipe pack',

  'canvas.costSource.estimate': 'Estimated (public pricing)',
  'canvas.costSource.localFree': 'Local track · free',
  'canvas.costSource.upstream': 'Upstream actual',

  'canvas.plan.brokenNotice':
    'There is a plan on this machine that cannot be read (maybe written by a newer version) — the original text is kept; any change you make will overwrite it',
  'canvas.plan.broken.title': 'The plan on this machine cannot be read',
  'canvas.plan.broken.body':
    'It may have been written by a newer version — the original text is kept; any change you make (adding nodes / connections) will overwrite it.',
  'canvas.plan.notice.cycle':
    'The graph has a cycle ({count} nodes involved) — nothing was submitted; break the cycle and run again',
  'canvas.plan.notice.submitted': 'Submitted {count} tasks',
  'canvas.plan.notice.kept': '{count} reuse their previous output',
  'canvas.plan.notice.bad': '{count} were skipped or failed (reason on the node card)',
  'canvas.plan.notice.rerunHead': 'Round {seq} (explicit rerun: these are newly created tasks) — ',
  'canvas.plan.notice.runFailed': 'Run failed: {reason}',
  'canvas.plan.notice.separator': ', ',
  'canvas.plan.file.exported':
    'Exported 「{name}」: {nodes} nodes · {edges} connections (with {notes} notes in the file, including "what this file does not contain")',
  'canvas.plan.file.imported':
    'Imported 「{name}」: {nodes} nodes · {edges} connections (a new plan identity — the first 「▶ Run plan」 creates new tasks)',
  'canvas.plan.file.importRejected': 'Import failed: {reason} (the current plan was left untouched)',
  'canvas.plan.file.importUnreadable': 'Import failed: could not read the file ({reason})',
  'canvas.plan.importConfirm.part1': 'Importing will ',
  'canvas.plan.importConfirm.part2': 'replace the current plan',
  'canvas.plan.importConfirm.part3':
    ' (you have {nodes} nodes · {edges} connections right now; the file holds 「{name}」 with {fileNodes} nodes) — export first with 「⤓ Export plan」 if you want to keep a copy.',
  'canvas.plan.importConfirm.yes': 'Confirm import',
  'canvas.plan.importConfirm.cancel': 'Cancel',
  'canvas.plan.count':
    'Plan: {nodes} nodes · {edges} connections · {runnable} runnable (empty prompts / blocked nodes are never submitted — click a node to see why). Position and parameters live in this browser, isolated per project.',

  'canvas.load.error': 'Could not load canvas data',
  'canvas.load.loading': 'Loading lineage data…',
  'canvas.empty.title': 'This is still a blank page',
  'canvas.empty.body':
    'No generation records yet — write your first line in Create, and the clips plus their lineage will show up here automatically.',
  'canvas.empty.action': 'Go to Create',
  'canvas.graph.summary':
    '{nodes} nodes · {edges} derived edges (columns = derivation order, rows = newest first). Read-only: click a node for details and actions; dragging only moves it and is not saved.',
  'canvas.status.allOk': '✓ No failed / to-verify tasks',
  'canvas.status.problems': '⚠ {count} nodes look wrong',
  'canvas.status.onlyProblems.title':
    'Dim the healthy nodes (without deleting them) so problems stand out',
  'canvas.status.showAll': 'Show all',
  'canvas.status.onlyProblems': 'Problems only',
  'canvas.status.queue': '{count} in queue',
  'canvas.status.queueOldest': ' (oldest waiting {seconds}s)',
  'canvas.status.queueSingle': '· this machine runs 1 at a time',
  'canvas.mobile.part1': 'The canvas is hard to use on a narrow screen: open it on a desktop, or go to the ',
  'canvas.mobile.library': 'library',
  'canvas.mobile.part2': ' for a list.',

  'canvas.file.listSeparator': ', ',
  'canvas.file.issueSeparator': '; ',
  'canvas.file.issue.duplicateNodes': 'Duplicate node ids: {ids}',
  'canvas.file.issue.danglingEdges': 'Edges pointing at nodes that do not exist: {ids}',
  'canvas.file.issue.selfLoops': 'Edges from a node to itself: {ids}',
  'canvas.file.issue.repeatedEdges': 'Duplicate edges (same direction and endpoints): {ids}',
  'canvas.file.reason.notJson':
    'This is not a JSON file (parse failed) — pick a file exported by 「⤓ Export plan」',
  'canvas.file.reason.notObject':
    'The file is not an object at the top level — it does not look like a plan file from this product',
  'canvas.file.reason.notPlanFileKind':
    'This is not a plan file (kind = {kind}) — a plan file exported by this product should have kind = {expected}',
  'canvas.file.reason.notPlanFileNoKind':
    'This is not a plan file (no kind marker in the file) — pick a file exported by 「⤓ Export plan」',
  'canvas.file.reason.newerVersion':
    'This plan file comes from a newer version (v{fileVersion} > local v{localVersion}): upgrade this deployment first',
  'canvas.file.reason.migrationBroken':
    'Internal error: the migration chain did not bring v{fromVersion} to v{toVersion}',
  'canvas.file.reason.invalidPlan': 'The plan content is incomplete or malformed',
  'canvas.file.reason.invalidPlanDetail': 'The plan content is incomplete or malformed: {detail}',
  'canvas.file.reason.badGraph': 'The graph inside the plan does not hold up: {issues}',
  'canvas.file.note.noVersion': 'The file has no version number; treating it as v1',

  'canvas.lineage.nodeMissing': 'No such node on the canvas: {id}',
  'canvas.lineage.ghostTaskLabel': 'Task {id}',
  'canvas.lineage.ghostTaskSub': 'Not in the recent records (deleted or beyond the list)',
  'canvas.lineage.ghostAssetLabel': 'Asset {id}',
  'canvas.lineage.ghostAssetSub': 'Not in the asset library (cleaned up or beyond the list)',
  'canvas.lineage.editOutput': 'Edit output',
};
