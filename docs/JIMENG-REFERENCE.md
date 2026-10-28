# 参考底稿：即梦（Jimeng）画布与工作流

> 合并自三份 2026-10 的观测/审计文档（原文件随文档瘦身删除）：
> `JIMENG-AGENT-OBSERVATION.md`（Agent 与画布公开 UI 观察）、`JIMENG-GAP-AUDIT.md`（画布/资产/分镜差距审计）、
> `JIMENG-PROTOCOL-2026-10-27.md`（实测抓包）。
>
> **怎么用这份文件**：定位是"一个人自用的仿即梦工作台"，所以这里记录的是**要复刻什么、已经复刻了多少、差在哪**。
> 交互规格（颜色/间距/层级/文案）不在本文，在 [CREATION-EXPERIENCE-DESIGN.md](CREATION-EXPERIENCE-DESIGN.md)。
>
> 三份原文按顺序拼接，未改写 —— 观测事实的价值就在于"当时看到什么就写什么"。

---



<!-- 原文：docs/JIMENG-AGENT-OBSERVATION.md -->

# 即梦 Agent / 画布公开 UI 观察（2026-10-22）

> 目的：只读观察**公开页面与交互**，确认 Agent 模式放在哪、文案怎么说、与画布节点如何关联。
> 边界：没有读私有接口响应体、没有反编译前端脚本、没有把观察当成即梦内部契约。
> 方法：已登录 Edge + REA CDP 页面观察 + 受控 Playwright 交互；未生成图片/视频。

## 1. 观察对象

| 页面 | 入口 | 观察动作 |
|---|---|---|
| 创作首页 `#/home` | 顶部/侧栏「创作」 | 查看 Agent 模式、技能、输入框 |
| Agent 会话 `/ai-tool/generate?workspace=...` | 首页输入框选择「Agent 模式」→ 生成 | 提交一条“先给分镜和画布方案，不要直接生成”的请求 |
| 画布 `/ai-tool/ai-canvas/<id>` | 已有 12 节点、6 条边的公开画布 | 打开「与 AI 对话」侧栏，提交只读总结请求 |

公开页面的 REA 检查证据：`ev_208132c2ed3a5e9a9e58292f938d63803c9005c99ecf91a793bdfc7990d33bb5`。

## 2. 观察到的事实

### 2.1 首页 Agent 模式

- 「Agent 模式」不是独立页面，而是 composer 里 **创作类型（combobox）** 的一个选项，和生成模式放在同一工具栏。
- 提交后进入 **独立会话页** `/ai-tool/generate?workspace=...`，左侧会话名自动变成「雨夜霓虹街道分镜方案」。
- 运行过程显示：
  - 「思考中」/「思考完成」
  - 「已加载技能：视频创作」
  - 可展开的思考摘要
- 最终输出是 **聊天回复 + 表格**：画幅、时长、模型、分辨率、整体调性、三段分镜、声音建议、两个待确认点。
- 回复底部只有「继续 / 重新生成」，**没有「应用到画布」「创建节点」按钮**。
- 用户明确说“不要直接生成”后，Agent 只给了方案，没有产出视频；也没有自动创建画布。

### 2.2 画布里的 Agent

- 画布右上有「与 AI 对话」侧栏（`canvas-sidecar-launcher`），不是首页 Agent 的同一会话。
- 侧栏有：
  - 「新会话」「新建会话」「收起」
  - 技能快捷项：`/ 视频反解`、`/ 创作分镜`、`/ 全流程广告片导演`、`/ 剧本开发`、`/ 剧情短片`
  - composer：`@` 引用参考、从本地/画布/资产库添加、使用技能、发送消息
- 侧栏能读取当前画布上下文：一次只读请求中，Agent 显示了工具步骤「搜索画布节点」「查询画布节点」，然后输出：
  - 12 个节点、2 个分组
  - 7 个视频创作节点 + 3 个视频编辑节点
  - 各节点是否有产物、引用连线关系
  - 「以上内容由 AI 生成 | 本次消耗 0 积分」
- 这次只读请求 **没有改变节点数量**（仍是 12），也没有生成媒体。

### 2.4 画布 Agent 的写操作与权限（第二轮）

在**新建的空白画布**（0 nodes）里发：

> 请新增一个文本节点，内容为「REA 观察测试」，不要生成任何图片或视频

观察：

- 侧栏进入「正在执行中」→「编辑画布中」。
- 出现工具步骤「创建文本节点」。
- 没有确认弹窗/计划卡；用户发完消息即执行。
- 节点数 **0 → 1**，侧栏回显「已成功创建内容为…的文本节点」，画布显示 1 node、已保存。
- 没有生成任何图片/视频任务。

随后发：

> 请删除刚才创建的「REA 观察测试」文本节点，不要动其他节点，也不要生成

观察：

- Agent 明确回答：
  > 抱歉，目前我还没有直接删除画布节点的权限，请你手动在画布上选中…进行删除
- 节点数仍为 1。

**结论（仅就本次可见行为）：**

| 操作 | 是否允许 | 是否有确认 |
|---|---|---|
| 读取节点/连线/产物 | 允许 | 不需要 |
| 创建文本节点 | 允许 | **没有**，直接执行 |
| 删除节点 | **拒绝** | 无删除工具/权限，要求手动 |
| 更新/连线节点 | 未测 | 未验证 |

### 2.5 首页 Agent 的后续轮次：能否启动画布

在同一首页会话继续发：

> 现在请把刚才的分镜方案直接创建到画布节点里，不要生成视频；如果需要新建画布就直接新建

观察：

- 思考摘要明确说「**我没有专用画布节点创建工具**」。
- 随后加载 `story-video` 技能。
- 实际产物是两个 **Markdown 文档**：
  - `雨夜霓虹街道_故事板.md`
  - `雨夜霓虹街道_用户要求.md`
- 回复却写成「**画布节点已建好**」，但 URL 仍是 `/ai-tool/generate?workspace=...`，没有新画布，也没有节点。
- 再追问「请直接打开画布页面」时，Agent 回答：
  > 我没有一个独立的可视化画布编辑器可以直接在你屏幕上打开…故事板 Markdown 就是画布节点。
- 它把「文件/故事板」称为「画布节点」，与本产品的可视化画布是**两个概念**。

这是一次明确的 **模型过度声称**：文字说“已建好”，实际只写了文件。不能把这种文案当成执行成功。

### 2.3 两者的关系

**没有观察到“首页 Agent 方案一键变成画布节点”的按钮或自动动作。**

更准确的描述是：

1. 首页 Agent 是**创作对话/规划器**，输出方案文本/文档，落在会话里；
2. 画布 Agent 是**画布上下文侧栏**，通过画布工具读取节点/连线/产物，并且有受限的“创建文本节点”工具；
3. 两者是**不同会话、不同入口**；画布侧栏不是首页会话的延续；
4. 首页 Agent **没有直接打开/创建可视化画布的工具**；它会把“画布”误解为 Markdown 故事板；
5. 画布 Agent **能读、能创建文本节点，但不能删除**；写操作没有确认步骤。

## 3. 文案与交互观察

| 位置 | 即梦用法 | 可借鉴/不照搬 |
|---|---|---|
| 创作类型 | 「Agent 模式」放在 composer 的创作类型里 | 我们可保留「让 Agent 规划」入口，但不必把它做成独立页 |
| 运行态 | 「认真思考中…」「思考完成」「已加载技能」 | 我们应该显示当前阶段和已用技能，不假装已完成 |
| 结果 | 聊天回复 + 表格 + 待确认点 + 建议追问 | 我们的计划卡比纯文本更适合审阅/应用 |
| 画布侧栏 | 「与 AI 对话」「新会话」「@ 引用参考」「使用技能」 | 我们可以在 CanvasStudioView 加同构侧栏，但要先做只读 |
| 只读成本 | 画布总结显示「本次消耗 0 积分」 | 文本 token 仍可能有成本；我们不能把 0 积分当通用承诺 |
| 写操作 | 创建文本节点直接执行，无确认；删除被拒绝 | 我们不照搬“无确认直接写”；创建/更新/连线都先计划卡确认 |
| 首页后续轮次 | 无画布工具，写 Markdown 却称“画布节点已建好” | 不能信文字声明；必须读回画布状态做成功判定 |

## 4. 对我们后续计划的影响

### 4.1 保留的

- 我们的 **计划卡 + 显式「在画布中创建草稿」** 比即梦首页 Agent 更明确，不改成自动落节点。
- 应用阶段仍**不提交生成**；画布节点仍是草稿，用户显式生成才执行。
- 首页 Agent 和画布 Agent 不强行合并成一个“万能会话”。

### 4.2 新增/调整

1. **S7-D1：Canvas Agent 只读侧栏（优先）**
   - 在 `CanvasStudioView` 增加「与 AI 对话」侧栏；
   - 只读工具：`list nodes` / `list edges` / `node outputs` / `selected node`；
   - 输出带工具步骤与上下文摘要；不允许改节点、不允许生成；
   - 文本成本单独显示；没有 Key 时明确不可用。

2. **S7-D2：Canvas Agent 写工具 + 确认**
   - 第一版只开放 **创建文本节点** 这一种低风险写操作，且必须先展示计划卡，用户确认后才落画布；不照搬即梦“直接执行”；
   - **默认不开放删除**；删除继续由画布 UI 的显式选择 + Delete 完成；
   - 更新/连线节点后续再开，每一项都要单独确认和读回校验；
   - 写操作不自动提交生成；
   - 与现有 `AgentPlan` 的 `apply-skill`/`add-reference` 映射复用，不新造第二套执行引擎；
   - 记录操作前后的节点数，失败不产生半份结构；
   - **成功判定以 `CanvasDoc` 读回为准**，不以模型说“已创建”为准；工具调用失败/模型过度声称时显示失败。

3. **会话边界**
   - 首页计划卡与画布侧栏是两个入口；
   - 可以通过 `agentCanvasHandoff` 把**已确认的计划**带进画布，但不把首页会话状态注入画布侧栏；
   - 画布侧栏需要自己的上下文/工具，不假装拥有首页对话记忆。

4. **不采用**
   - 不照搬即梦的纯聊天回复作为唯一计划形态；我们继续保留结构化计划卡。
   - 不把「0 积分」写进我们的 UI；文本模型成本未知时继续「待核算」。
   - 不在未确认写工具前，对外宣称“画布 Agent 能自动建节点”。
   - 不把 Markdown 故事板称作“画布节点”；画布节点必须真的出现在 `CanvasDoc` 里。
   - 不采用“模型说完成就算完成”；所有写操作以画布读回为准。
   - 不让首页 Agent 假装能打开可视化画布；首页只做计划/文档，画布由画布侧栏或显式交接进入。

5. **工具协议/节点结构的推测（不是观察到的内部协议）**
   - 从可见工具卡推测，画布 Agent 至少有 `search_canvas_nodes`、`query_canvas_nodes`、`create_text_node` 之类的能力；删除没有授权。
   - 上下文很可能是“画布快照 + 选中节点 + 用户消息 + 可用技能”；模型回合制调用工具，宿主把结果回填。
   - 节点至少在 UI 上包含：类型（文本/图片/视频/音频）、标题/正文、分组、产物/资源、连线（含引用角色）；内部字段名无法从公开 DOM 证明。
   - 首页 Agent 的计划没有暴露 JSON；可见形态是 Markdown/表格。我们不应该根据自己的观察编造“即梦计划 JSON 字段”，继续用我们自己的 `AgentPlan`。
   - 以上均为**推断**；没有读私有网络响应体或脚本，不能当契约。

### 4.3 与 GPU/算力计划的关系

本次观察不影响 MOSS/H3 的算力计划：

- 满血 MOSS 仍是 48GB+ 服务器的目标；
- H3 与 MOSS 不挤同一张 48GB 卡；
- 画布 Agent 的文本/工具调用不需要 GPU，可先做只读侧栏。

## 5. 未验证 / 未知

- 画布 Agent 更新已有节点、连接/断开边的写权限与确认机制；
- 删除为什么被拒绝：是产品级权限、工具未注册，还是当前会话/skill 限制；
- 首页 Agent 的“画布”概念是否还有其他入口能绕过 Markdown 产物；
- 会话持久化、跨设备、团队共享范围；
- 免费/会员额度与 0 积分文案的适用范围；
- 即梦内部计划 JSON、工具协议、节点数据结构的真实字段（没有逆向，也不应该据此实现）；
- 本次测试发生在新建临时画布，没有动已有 12/20 节点的画布。

<!-- 原文：docs/JIMENG-GAP-AUDIT.md -->

# 即梦画布/资产/分镜差距审计

> 数据形状与真实生成请求体见 [JIMENG-PROTOCOL-2026-10-27](JIMENG-REFERENCE.md)（实测抓包）；
> 本文只谈能力差距与优先级。

<a id="multi-reference-observation"></a>

## 2026-10-25 补充观察：多素材与双入口

**证据分层**：本日通过 REA 6.5.0 CLI 接入既有、用户所有的即梦浏览器，取得首页画布态、生成/Agent 态、创作类型菜单、视频/图片生成态、参考方式菜单及媒体画布截图/可访问文本。先前 Codex 浏览器桥仍失败，但不妨碍这条既有 CDP 通道；没有修改 MCP 配置或新建调试实例。执行的界面动作是重载已选页面、切换生成入口/创作类型及展开参考菜单；没有上传素材、提交生成、购买、删除或修改画布内容。原始页面记录与账户截图仅保留在忽略目录 `.tmp/ui-reference/rea-live/`，不入库；精确验收与范围见 [PLAN §5](PLAN.md#multi-reference-reference-status)。

| 观察项 | 可核对的事实 | 对本项目的设计含义 |
|---|---|---|
| 双入口 | 登录态主区域是「生成 / 画布」；左侧分别有对话与画布列表；公开首页文本也有「对话 / 画布」字样 | 我们依用户要求使用明确的「对话 / 画布」切换；是本项目的信息架构选择，不宣称对方所有场景都叫同一名字 |
| 视频多素材 | 当前 Seedance 2.0 mini + 全能参考输入提示“最多12个参考素材”，支持文中提及图片、视频、音频；模式菜单与历史 05-reference-modes 可对照 | 同一输入框内组织素材、提示词、参考模式与参数；12 是特定模型界面提示，不固化为我们的契约上限，也未验证全部组合效果 |
| 按类型切换布局 | 本日视频菜单可见全能参考、首尾帧、智能多帧、智能编辑、超长视频；切到图片后为 Seedream 5.0 Pro、比例/2K/输出张数，无视频时长 | 类型、参考方式、输出参数分层；图片界面的“2张”是输出数量，不能误读为输入参考上限；图片多参考上限本轮未测 |
| 多参考画布布局 | 当前画布中场景、人物/物品参考卡位于结果卡左侧，多条细曲线汇入结果；没有每条边都常驻的粗箭头和文字 | 媒体居于主要位置，连线弱化装饰；实际来源和计划依赖仍按 D73 区分 |
| 拖动跟随 | 用户明确要求此行为；本次取得静态截图，未在对方画布做拖动写入 | 本项目 HTML 可直接测试跟随，生产 XYFlow 仍需行为验收；不能把截图当成即梦动态路径已测证据 |
| 多图、视频真正如何参与 | 未运行生成，也没有读取私有请求/响应体、脚本源或登录凭据 | 只借鉴可见布局，不推测内部协议；真实输入消费由我们的模板和端到端验证证明 |

**本仓引用能力事实（业务基线 `3314404`，仅文档变更承接审计）**：

- 图片节点：`canvasNodeSubmit.ts` / `canvasLineage.ts` 的 S9-A3 路径是单张 `reference-image`，映射到 t2i 的 `firstFrameImage`；不等于多图编辑。
- 普通视频：`mentions.ts` / `canvasNodeSubmit.ts` 支持一张首帧、两张首尾帧或单个 `referenceVideo` 的协议映射；图视频不混用，额外素材必须提示/阻止。协议通道存在不证明当前实例有对应模板；本机真模型基线验证的是单图 i2v，未验证 fl2v/v2v/混合。
- 剧本：二次展开可接收最多 20 个参考候选、每镜最多声明 4 个 ID；实际 `buildCreationRunInput` 仍有 F3 的丢失问题。不能将 schema 数量说成模型成功消费数量。
- 视频素材可入库/剪辑/作为协议引用候选；原生视频条件、视频抽帧作为图片、文本模型看视频须分别验收。上传成功本身不是任何一种生成能力的证明。

建议布局、白线视觉、分片顺序与验收只在 [设计规格](CREATION-EXPERIENCE-DESIGN.md#multi-reference-entry-design) 和 [PLAN §4](PLAN.md#multi-reference-entry-plan) 维护；N9/N12 只在 [PENDING](PLAN.md#open-decisions) 决策，不在此重复待办或进度。

<a id="handoff-comparison"></a>

## 2026-10-25 交接复核：按实际能力比较

> 以下是 `35cd070` 的能力证据快照；实现进度只看 [PLAN §5](PLAN.md#handoff-audit-status)，待办只看 [PLAN §9](PLAN.md#handoff-audit-backlog)。原始观察保留在下方，不能将其中「尚无」「待 P4/P5/P6」当作今天的状态。
>
> 图像证据来自 `.tmp/jimeng-shots/` 的 node-inspector、toolbar-hover、ai-sidecar、skill-storyboard、canvas-b、home 等截图。本次复看，没有重新登录或调用即梦。按钮可见只证明有入口，未验证其质量、费用或内部协议。

### 图片节点工具条（13 项）

| 即梦可见入口 | 本仓对应证据 | 判断 |
|---|---|---|
| 智能改图 | S9-A3 图片引用派生 + FLUX ReferenceLatent | **部分覆盖**：自然语言参考出图存在；没有区域蒙版控制，缺参考模板时还存在静默回退（审计 F2） |
| 720 全景 | 无专门工作流/输出契约 | **真差距**，不是将分辨率设为 720p |
| 扩图 | 无扩展画幅/边缘蒙版工作流 | **真差距** |
| 智能超清 | 无专用超分模板/倍率语义 | **真差距**；放大预览不算超分 |
| 抠图 | 无独立分割/透明产物链 | **真差距** |
| 预设 | 技能/配方可复用提示与参数 | **部分覆盖**，不能据此宣称即梦菜单内每项效果等价 |
| 多角度 | 可提示词派生，无专用多视角参数/模型承诺 | **真差距** |
| 智能打光 | 可提示词派生，无专用可控光照链 | **真差距** |
| 营销 | 行业模板/技能起手式 | **部分覆盖**；截图未展开子菜单，不推断完整功能 |
| 工具 | 本仓有媒体操作和独立剪辑台 | **未能逐项判断**：截图未展开子菜单 |
| AI 助手 | 画布助手、技能、分镜、展开/会话入口 | **功能骨架接近**，跨画布历史覆盖及确认页问题见 F4/F6 |
| 放大 | 节点媒体预览/全屏 | **基本覆盖入口**，不等于模型画质追平 |
| 下载 | 结果预览/资产媒体下载路径 | **基本覆盖已有结果**；会话详情缺直接交付出口（F6） |

### 创作流程与 B 端交付

| 维度 | 当前证据与界限 | 结论 |
|---|---|---|
| 节点详情 | CanvasNodeInspector 已有；旧报告「只有卡片」过时 | 基础能力已补，不重复立项 |
| 分镜→视频 | StoryboardPlan、二次规划、确定性会话、首帧确认、自动拼接 | 主链已有；用户参考消费、确认 UX 与首镜重复拼接仍有缺口（F3/F6/F10） |
| 资产与历史 | LibraryView、导入历史、来源信息已存在 | 旧报告「缺 UI / 无独立页」过时 |
| poster/版本/参数/引用 | 已有实现与既往验收；本轮全量 UI 冒烟通过，证据见 PLAN | 基础操作覆盖，未逐一与即梦做速度/画质 A/B |
| 主体库与 @主体 | 固定首镜作为一次会话锚点；没有跨画布/业务项目的命名主体实体 | 真差距；资产库不等于主体库，N9 先定参考语义 |
| 分组 | 无 group 数据模型 | 真差距但非当前第一片；不把假标签当分组 |
| 生成中体验 | 任务状态轮询；没有采样中间帧进入节点 | 真差距；不伪造本地百分比，预览能力需按实例门控 |
| 编排分享 | 旧 V2.35 格式存在；新 CanvasDoc 没有完整导出/导入入口 | 真差距；D63 不迁移旧编排仍有效，选择见 N11 |
| 时间线/导演台 | 独立浏览器剪辑台已有，画布没有内嵌时间线 | 当前模块边界，不按即梦外形重建一套 |
| 音频/TTS/音乐 | 尚未接成完整链 | 有差距但按既定选型/环境条件后置 |
| 项目、交付、Webhook、成本与恢复 | 已有后端基础；拼接项目串归属、备份缺画布为实质缺口（F5/F7）；上游 usage 未接不等于已有真实账单 | 方向符合私有部署，当前不能称「交付可靠性已收官」 |
| 身份/协作/公开社区/积分 | 已有明确不做或暂缓决策 | 不算本轮缺陷，也不因竞品有入口重开 |

优先级与下一片 AC 见 [PLAN §4](PLAN.md#handoff-next-slice)；产品选项见 [PENDING](PLAN.md#open-decisions)。本仓 B 端能力不据这些截图推断「即梦没有」，只评价本仓是否兑现自己的承诺。

## 2026-10-23 原始观察（历史证据）

> 目的：在 P1-P6 开工前做一次**公开 UI 只读审计**，只用于决定优先级；
> 不读私有接口体、不逆向内部 JSON、不批量下载素材。

## 观察对象

- 即梦已有画布：`/ai-tool/ai-canvas/246bbf0a-...`，12 nodes、6 edges、2 个 group；
- 即梦视频工作区：`/ai-tool/generate?workspace=23643819589132`；
- 本轮已导入的本人素材：6 张图片 + 1 个 5s 视频。

## 差距矩阵

| 能力 | 即梦可见事实 | 我们当前 | 差距/决定 |
|---|---|---|---|
| 画布分组 | `react-flow__node-group` 节点；文案 “Group 视频编辑, 3 members / Group 视频创作, 7 members” | `CanvasDoc` 无 group 字段，不能建组 | **大**：要动 schema + 拖拽 + 布局，P6 不做，留 P7 |
| 节点详情 | 节点卡显示资源状态、参考、产物；侧栏 Agent 可查询 | 新画布只有卡片，缺“这条怎么来的”只读出口 | **中**：P6 做只读检查器，不改 schema |
| 画布 Agent | 读节点/边/产物；可创建文本节点；**不能删除**；创建无确认 | 已有读、建、更新、分镜；写操作全部确认 | 我们更安全；不照搬无确认 |
| 分镜计划 | 首页 Agent 输出表格/故事板，非画布工具 | 尚无独立 StoryboardPlan；只有节点方案和自由发挥 | **中**：P5 做独立分镜表，不自动落节点 |
| 视频首帧 | 视频卡有大预览/播放器 | P1 已生成 poster；旧线上构建未部署 | 代码已补，等部署 |
| 历史/导入 | 工作区资产、生成历史、参考素材混在会话里 | P3 有 imported 历史端点；缺 UI/来源徽标 | **中**：P4 补资产库导入 + 徽标 |
| 资产库 | 画布工具栏有“资产库/上传/主体” | 资产弹层 + 上传；无独立资产页 | 可后补，不阻塞 |
| 时间线/导演台 | 工具栏有“时间线/主体/导演台” | 剪辑台独立，画布无时间线 | 大模块，后置 |
| 参考角色 | 连线/参考图可被 Agent 读取 | 有 references/roles + 边 | 基本对齐，继续用我们契约 |
| 生成参数/多版本 | 模型、画幅、时长、版本 | 已有批次/版本/参数 | 基本对齐 |
| 音频 | 即梦有音频相关入口 | 暂缓 TTS/音乐/音效 | 等 GPU/选型 |

## 审计结论

1. **P6 先做节点检查器，不做分组。**
   - 分组会改 `CanvasDoc` 和交互模型，风险高；
   - 检查器是只读、零 schema 变更，能先补“可解释性”。
2. **P5 分镜计划应与画布节点方案分离。**
   - 不把 StoryboardPlan 塞进 `CanvasNodeProposal`；
   - 不自动把分镜变成节点。
3. **P4 导入历史是当前最短闭环。**
   - 后端已有 `POST /api/history/import`；
   - 只缺资产库入口、`imported` 徽标与刷新。
4. **P1/P2 的视频 poster/守卫优先级高于继续扫即梦。**
   - 先让已有素材在画布和历史里如实显示；
   - 再继续产品差距审计。

## 不做/不照搬

- 不读即梦私有网络响应体；
- 不把小组件 class 名当作内部数据协议；
- 不采用“创建节点无确认”；
- 不把“分组”做成假标签而不改数据模型。

<!-- 原文：docs/JIMENG-PROTOCOL-2026-10-27.md -->

# 即梦画布协议观测记录（2026-10-27，实测抓包）

> 用途：给后续接手的模型/开发者一份**可直接引用**的事实底稿。本文只记录观测到的东西，
> 不做推断的也不写成结论；每条断言后面跟着它是怎么来的。
>
> 与 [JIMENG-GAP-AUDIT](JIMENG-REFERENCE.md) 的分工：那份是**能力差距对比**，这份是**数据与协议形状**。

---

## 0. 采集条件与边界

| 项 | 值 |
|---|---|
| 目标 | 即梦 AI 画布《故乡》斯坦茜（34 节点 / 45 边） |
| 接入 | 本机 Edge `Edg/156.0.4314.42`，独立配置目录 `.tmp/rea-edge-profile`，`--remote-debugging-port=9223`；Playwright 经 `connectOverCDP` 操作 |
| 登录态 | 复用该配置目录中已有的登录（81 积分 / 标准会员）；未读 Cookie/Token |
| 读到的层次 | ①画布节点/边对象（React fiber）②`/octo_api/v1/*` JSON 响应 ③前端 i18n 字符串 ④**两次真实生成请求体** |
| 写操作 | **只做了两次「生成」**（图片节点「图片 5」、视频节点「视频 6」各一次），未改提示词/参数/布局，未删任何节点 |
| 花费 | 图片 2K + 4 参考 = **8 积分**；视频 720p / 4s / 全能参考 = **56 积分**（81 → 73 → 17） |
| 未做 | 没抓首尾帧 / 智能多帧 / 智能编辑 / 超长视频的 mode 值；没测 3 张以上参考；没读私有 Token |

**复现方法**（下一个接手者照这个走）：
1. `msedge.exe --remote-debugging-port=9223 --user-data-dir=<独立目录>`，在该窗口登录即梦，从首页画布卡片点进去
   （**直接导航 `ai-canvas/<id>` 会被重定向回首页**，必须走卡片点击）；
2. Playwright `chromium.connectOverCDP('http://127.0.0.1:9223')` 后：
   - 节点/边：从 `.react-flow__node` 的 `__reactFiber$*` 向上找 `memoizedProps.nodes/edges`（序列化要跳过 DOM 与 fiber，否则循环引用）；
   - 请求体：`page.on('request')` 过滤 `POST` + host 含 `jianying`，`request.postData()`；
3. 选中节点用**合成事件**（`pointerdown/mousedown/pointerup/mouseup/click` 依次 dispatch），
   这样视口外的节点也能选中；`<video>` 只有在节点进入视口并选中后才挂载。

---

## 1. 画布数据模型：参考关系是**边**，不是节点属性

节点对象（实测，`type` 只有 `image` / `video` 两种在图里出现）：

```jsonc
{
  "id": "node_jpt9r6ew6n",
  "type": "video",                          // image | video
  "position": { "x": -153.54896637262928, "y": 764.5999755859366 },
  "width": 568.889, "height": 320,          // 所有节点统一 569×320
  "data": {
    "source": "model_generated",            // uploaded | model_generated
    "title": "视频 1",
    "resourceId": "59770617-…",             // 当前展示的那一个产物
    "resourceBatches": [                    // 一次生成出的多个结果
      { "id": "edd16e2f-…", "resourceIds": ["59770617-…"] }
    ],
    "totalResourceCount": 1,
    "renderMode": "compact",
    "mediaPreviewInViewport": true,
    "tagPresentation": { "activeMatch": false, "batchSelection": false, "editing": false, "locateMatch": false, "tagIds": [] },
    "targetConnectable": true
  }
}
```

边对象：

```jsonc
{
  "id": "edge_c372ew17bv",
  "source": "node_nzm31kqdrw",              // 素材
  "target": "node_wpb6tz3p0a",              // 生成节点
  "sourceHandle": "default",
  "targetHandle": "default",
  "type": "reference",                      // ← 边类型就是"参考连接"
  "selectable": true,
  "zIndex": 0,
  "ariaLabel": "Reference connection from 图片 node: 图片节点 4 (12).png to 图片 node: 图片 5"
}
```

**要点**：
- 节点**没有** `references` 数组；参考集合 = **指向它的所有 `type:"reference"` 入边**。
- 边**没有** role / order / 用途字段（`handle` 恒为 `default`），也无方向性标签。
- 实测扇入分布（34 节点 / 45 边）：1 条→7 个节点、2 条→6 个、3 条→6 个、**4 条→2 个**；
  边类型统计：`image→image` 20 条、`image→video` 25 条。

---

## 2. 生成请求体（**两次真实抓包**）

端点：`POST /octo_api/v1/node_generate?generate_id=gen-<uuid>&babi_param=<json>&os=…&msToken=…&a_bogus=…`

`babi_param` 是埋点上下文（`{"edit_type":"octo","tool_id":"octo","tab_name":"octo","enter_from":"octo","scene_lv1":"octo",…}`），与业务无关。

### 2.1 图片节点（4 参考，Seedream 5.0 pro / 2K，8 积分）

```jsonc
{
  "project_id": "8c9096d8-…",
  "op": 1,
  "initial": {
    "submit_id": "ba0e5334-…",                 // 幂等键
    "node_id": "node_wpb6tz3p0a",
    "items": [{
      "resource_id": "69afc9fc-…",             // 产物 id，客户端预分配
      "type": 1,                               // 1=image，2=video
      "reference_sources": [                   // ★ 多参考的正式表达（有序）
        { "material_idx": 0, "node_id": "node_nzm31kqdrw", "resource_id": "ab2cbdf1-…" },
        { "material_idx": 1, "node_id": "node_3wagm4x874", "resource_id": "3947e399-…" },
        { "material_idx": 2, "node_id": "node_w5xar464sm", "resource_id": "b11ef3b3-…" },
        { "material_idx": 3, "node_id": "node_nxmask23j1", "resource_id": "ee8c1b8c-…" }
      ],
      "params": { "image_params": {
        "mode": 2,                             // 图片参考生图（面板无模式文案，按 4 参考判定）
        "model_name": "seedream_5.0_pro",
        "resolution": "2K",
        "aspect_ratio": "16:9",
        "materials": [                         // 真正喂模型的素材，带 role
          { "type": 2, "role": 3, "image_uri": "tos-cn-i-tb4s082cfz/1568cbab…" },
          { "type": 2, "role": 3, "image_uri": "tos-cn-i-tb4s082cfz/1081f781…" },
          { "type": 2, "role": 3, "image_uri": "tos-cn-i-tb4s082cfz/8f4553bc…" },
          { "type": 2, "role": 3, "image_uri": "tos-cn-i-tb4s082cfz/2488a793…" }
        ],
        "prompt": "…院里{{image:3}} ，男孩（镜头）手里拿着得物盒子{{image:0}} \\{{Image 4}} 递给姥爷{{image:1}} …"
      }},
      "metric": "{\"sources\":{\"upload_material_array\":[{\"uri\":\"tos-cn-i-…\",\"material_type\":\"image\"}],\"quote_node_array\":[{\"node_id\":\"node_nzm31kqdrw\",\"node_type\":\"image\",\"resource_ids\":[\"ab2cbdf1-…\"]}]}}"
    }]
  }
}
```

### 2.2 视频节点（全能参考，1 参考，Seedance 2.0 VIP / 720p / 4s，56 积分）

```jsonc
"initial": {
  "node_id": "node_mze5xj4fms",
  "submit_id": "eea58efe-…",
  "items": [{
    "resource_id": "5ba19232-…",
    "type": 2,
    "commerce_selection": { "benefit_type": "seedance_20_pro_720p_output" },  // 计费档位
    "reference_sources": [
      { "material_idx": 0, "node_id": "node_h11rxvrbwq", "resource_id": "b4872d12-…" }
    ],
    "params": { "video_params": {
      "mode": 4,                                // ★ 实测「全能参考」= 4
      "model_name": "seedance_2.0_vip",
      "resolution": "720p",
      "aspect_ratio": "16:9",
      "duration_ms": 4000,
      "materials": [ { "type": 2, "image_uri": "tos-cn-i-…/62023978…" } ],   // 视频侧没有 role
      "meta_list": [                            // ★ 视频侧用分段表达"素材在文中的位置"
        { "type": 1, "text": "…整段提示词…" },
        { "type": 2, "material_idx": 0 }
      ],
      "prompt": "核心风格：电影级剧情片风格（实拍，不要CG感）…"
    }}
  }]
}
```

### 2.3 ack

```json
{"ret":"0","errmsg":"OK","data":{"results":[{"resource_id":"5ba19232-…","error_code":0,"state":1}]}}
```
`resource_id` 原样返回预分配的那个；后续进度靠 `POST /octo_api/v1/resource/generation/queue_status`（传 resource_ids）。

---

## 3. 字段语义（只列有证据的）

| 字段 | 含义 | 证据 |
|---|---|---|
| `initial.submit_id` | 幂等键 | 每次生成一个新 UUID |
| `items[].type` | 1=图片，2=视频 | 两次采样分别 1 / 2，与节点类型一致 |
| `items[].resource_id` | 产物 id，**客户端预分配** | ack 原样返回 |
| `reference_sources[].material_idx` | 素材在 `materials[]` 中的下标（**顺序即引用**） | 4 条入边 → idx 0..3 |
| `reference_sources[].node_id` | 来源节点（画布溯源） | 与入边 source 一致 |
| `reference_sources[].resource_id` | 来源节点那次使用的具体产物 | 与节点 `resourceId`/批次一致 |
| `image_params.materials[].role` | 图片素材角色（实测恒为 3） | 仅图片侧出现 |
| `video_params.mode` | 生成模式，**全能参考 = 4** | 与节点面板「生成模式: 全能参考」对照 |
| `image_params.mode` | 图片侧模式，实测 2 | 面板无文案，按 4 参考判定 |
| `commerce_selection.benefit_type` | 计费档位字符串 | 仅视频侧出现 |
| `prompt` 里的 `{{image:N}}` | 文中提及第 N 个素材（**小写**；`{{Image 4}}` 不会被解析） | 图片侧 prompt 实文 |
| `meta_list` | 视频侧的"分段表达"：`{type:1,text}` 文本段 + `{type:2,material_idx}` 素材段 | 视频侧请求体 |
| `metric` | 字符串化 JSON 埋点：`upload_material_array` + `quote_node_array` | 两次都有 |

**能力侧（前端 i18n 字符串，非请求字段）**：`video_omni_ref`=全能参考、`video_omni_reference_min`=请至少上传1个素材、
`video_omniref_max_cnt_pic`=最多使用 {N} 个参考图片、`…reference_video_total_duration_message`=参考视频总时长超过 {N} 秒、
`…reference_resource_unavailable_message`=参考素材不可用，请移除或替换。
→ 说明"能用几张、能不能混类型"由**模型元数据**裁决，且不满足时**阻止提交**而不是静默丢素材。

---

## 4. 未观测（不要当成已知）

- 首尾帧 / 智能多帧 / 智能编辑 / 超长视频 的 `mode` 取值；
- `role` 的其它取值（除 3 以外），以及它是否等价于"主体/场景/风格"；
- 音频参考、参考视频的字段形状；
- 参考数量超过模型上限时，是前端拦还是服务端拒（只看到了前端提示文案）；
- 画布文档本身的持久化接口（节点/边如何落库，走 WS 还是 REST —— 重载页面时未抓到画布详情接口，疑似走协作房间 WS）。

---

## 5. 与本仓契约的对照（供实现时参考）

| 即梦 | 本仓（CONTRACT §21） | 差异 |
|---|---|---|
| 节点只有 `resourceId` + `resourceBatches` | `data.batches[] + data.selectedBatchId` | 同构（我们多了 `request` 快照与 `failure`） |
| 边 `type:"reference"` 无 role | `edges[].kind` + `role` + `assetId` | 我们更"可解释"，但不能表达 N 张集合 |
| `settings.referenceMode` 等价物在**参数层**（`image_params.mode` / `video_params.mode`） | `data.draft.settings.referenceMode: 'none' \| 'first-last-frame' \| 'omni-reference'` | **我们已经预留了这个字段** |
| 模型能力（张数/类型/时长上限）由元数据裁决 | `ModelCapability.maxReferences / referenceModes / referenceKinds` + `checkCapability()` | 骨架已在，**画布侧尚未接线** |
| `reference_sources[].material_idx` 顺序 | `references[].order`（已存在 0..64） | 同构，1:1 可映射 |
| prompt 内联 `{{image:N}}` | 创作入口用 `@提及`（`lib/mentions.ts`），画布无提及语法 | 未定：要不要在画布做提及 |

结论一句话：**B 路线（生成模式）不需要推翻画布 schema —— `referenceMode` / `maxReferences` / `checkCapability` 早在契约里，缺的是把画布侧接上，并把 provider 从"上传一张"扩到"上传 N 张"。**
