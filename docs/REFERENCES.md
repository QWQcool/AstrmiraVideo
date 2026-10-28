# 外部参考与复刻台账（合并档）

> 合并自四份 2026-10 的调研文档（原文件随文档瘦身删除）：
> `N8N-REFERENCE.md`（n8n 可借鉴设计）、`INFOS-REVIEW.md`（infOS / Pictoria 源码复核）、
> `UPSTREAM.md`（上游参考与复刻台账）、`MOSS-IMAGE-EVALUATION.md`（MOSS-Image 量化版评估）。
>
> **只留"还能用到什么"**：已落地的结论在 CONTRACT / PLAN 里，这里保留的是**判断依据**（谁怎么做的、代价是什么），
> 免得下次重新调研一遍。原文按顺序拼接，未改写。

---



<!-- 原文：docs/N8N-REFERENCE.md -->

# n8n 参考：可借鉴的设计清单与落地映射（2026-10-10 立项）

> **本文的唯一职责**：把 [n8n](https://github.com/n8n-io/n8n) 里**值得学的设计**逐条列清、映射到我们的台账编号、
> 标明成本与依赖。**它不是施工手册**（施工入口仍是 PLAN §4 的 Step+AC + §9 台账）。
>
> 立项背景：用户 2026-10-10 提出"n8n 的画布系统做得好，我们当前的画布只可读，能不能把它的画布抄过来"，
> 并要求"1~9 都列为下一步开发计划"。本文是那次讨论的落点。

---

## 一、先说结论（三句话）

1. **源码不抄，设计全学**。n8n 的画布引擎不是它自己写的 —— 它用的是 **`@vue-flow/core`**，
   而 Vue Flow 与我们在用的 **`@xyflow/react` 是同一个团队（xyflow）的兄弟项目**。
   也就是说**我们和 n8n 站在同一层画布引擎上**，差距在**它自己写的那一层交互编排**（Vue 组件 + Pinia）。
2. **那层交互编排是 Vue 3**，我们是 React 19 → 它对我们**本来就不是可直接复用的代码**，
   而是**参考对象**。这条比许可证更实际：就算许可证允许，逐字搬过来也跑不起来。
3. **真正该学的是"产品语义层"**：节点检查器、执行态可视化、Pin/部分重跑、模板与版本化、无人值守凭据模型。
   其中**"Pin 产物 + 只重跑下游"是省钱刚需**（对应 B48 成本台账），也是这份清单里最值钱的一条。

---

## 二、许可证与"怎么参考"（三条纪律）

**事实**（2026-10-10 核对仓库本体）：

| 项 | 事实 |
|---|---|
| 许可证 | **Sustainable Use License 1.0**（fair-code / source-available）；`.ee.` 目录需企业许可；非 master 分支未授权 |
| 是否 OSI 开源 | **不是**（限制"仅内部业务或非商业用途"，与 OSD 第 1/3/6 条冲突） |
| 包级证据 | `packages/frontend/editor-ui/package.json` 的 `license` = **`LicenseRef-n8n-sustainable-use`** |
| 允许 | 自己内部/个人使用、阅读、修改（改动需标注"已修改"） |
| 不允许 | 收费分发、作为商业化产品对外提供、用 MIT 再授权 |
| 技术栈证据 | Vue 3 + Pinia + `@vue-flow/core` 1.48.0（+ background / controls / minimap / node-resizer）、`@dagrejs/dagre`（布局） |

**因此我们按这三条办**（写进 PLAN §6-D48）：

1. **读源码学设计**：允许且鼓励（这是最省的"站在别人肩膀上"）；
2. **独立实现**：用 React 重写，**不逐字拷贝文件**；参考了具体实现思路的，在**文件头注明灵感出处**；
3. **留退路**：本仓库是 **公开的 MIT 仓库**，而产品方向是 B 端对外交付 —— 这三条**不增加任何开发工作量**，
   但让"将来要商用"时不必回头返工。⚠️ 若将来真要**直接采用 n8n 的某段代码**，那是一次显式决策：
   要么放弃 MIT 声明该文件并遵守 SUL，要么换成"等价的公开实现/自研"。

---

## 三、借鉴清单（A 画布交互 / B 产品语义 / C 工程与交付 / D 明确不借鉴）

### A. 画布与编辑器交互（用户点名看好的部分）

| # | n8n 的做法 | 为什么好 | 我们的对应 |
|---|---|---|---|
| A1 | **节点详情面板（NDV）**：点节点 → 独立视图看输入/输出/耗时/错误/二进制预览 | "图只是索引，细节有处可查"，避免卡片里塞满信息 | 已登记 **B62** |
| A2 | **执行态可视化**：节点边框状态（运行中转圈 / 成功 / 失败）+ 连线数据流动画 | 一眼看出"跑到哪、断在哪" | 已登记 **B63** |
| A3 | **导航控件**：minimap + 缩放控制条 + fit view / 缩放到选区 | 大图必备；且这些是**画布库自带的现成组件** | 已登记 **B64** |
| A4 | **Sticky notes（画布便签）+ 节点分组 + 对齐/分布 + 多选** | 图长大之后，**组织能力**比自动布局更重要 | 已登记 **B67** |
| A5 | **从连线拖出 → 空白处松开弹出节点搜索器**；**在连线上点 "+" 插入节点** | 编排的最自然入口（"我要接一个什么"） | 已登记 **B70**（属 L3 可编排画布，与 OI-3 同批） |
| A6 | **键盘优先**：F2 改名、Ctrl+D 复制、Ctrl+A 全选、方向键移动、撤销/重做 | 高频用户的效率上限由键盘决定 | 并入 **B67** |
| A7 | **表达式编辑器 `{{ }}`**：可引用其它节点的输出字段，带自动补全 | "把上游产物喂给下游"的可视化写法 | 我们已有 `@` 提及 + 模板变量，**并入 B62 的检查器里做"引用上游产物"入口** |

### B. 产品语义（真正值钱的一层）

| # | n8n 的做法 | 为什么好 | 我们的对应 |
|---|---|---|---|
| B1 | **Pin data / 部分重跑（partial execution）**：固定某些节点的输出，只重跑下游 | ⭐ **最省钱**的特性：不必为一次参数微调重跑整条链 | 已登记 **B68**（最值钱、也最重；与 **B48 成本台账**联动） |
| B2 | **"只执行这一步"（test step）** | 调试/试提示词的最小代价 | 已登记 **B69**（⚠️ 需先厘清与我们**幂等指纹**的关系：我们的去重是"同一提交只跑一次"，而"重跑"是显式要它再跑一次 → 需要一个显式入口） |
| B3 | **节点类型版本化**（node type version）：旧工作流在新版本下仍能打开 | 存档的东西**必须能被未来版本打开**（B 端交付的硬要求） | 已登记 **B66**（给剪辑工程 / 配方 / 交付包加 `schemaVersion` + 迁移 + "旧文件能打开"的断言） |
| B4 | **模板库**：可搜索、可预览、一键导入 | 行业模板是 B 端的**销售材料**（客户看"你这个行业的模板长什么样"） | 已登记 **B71**（与配方库 **B30 行业维**合并考虑） |
| B5 | **版本历史**（命名版本 + 对比 + 恢复） | "上周那版更好，回去" 是真实需求 | 我们现在只有**单份草稿**（`editDraft`）→ 并入 **B66** 之后一起做 |
| B6 | **导入/导出 JSON**（工作流即文件，git 友好） | 可复现归档、可评审、可交接 | 已登记 **B65**（与 **B49 交付包**同族） |
| B7 | **错误工作流 / 失败可挂钩子** | 失败不只"记日志"，而是"触发一段处理" | 我们已有 Webhook（B51 片 A）+ 操作日志（§10）+ 指标告警（§16）→ **已覆盖，不另立** |
| B8 | **执行列表**：可筛选、可重试、可删除、可看每次运行的输入/输出 | 排错第一站 | 我们有 history + 操作日志 → **并入 B62/B69**，不另立 |
| B9 | **凭据作为一等实体**（服务端加密存储、跨节点共享、可测试连接） | 让工作流能**无人值守**跑（定时/触发） | ⚠️ **与我们的铁律冲突**（"Key 零留存"只走请求头）→ 登记 **B72**：**这是一个决策项，不是实现项**。B 端私有部署迟早会需要"定时出片/任务触发"，那时必须回答"服务端要不要持有凭据" |

### C. 工程与交付（它的"成熟度"其实在这里）

| # | n8n 的做法 | 为什么值得学 | 我们的对应 |
|---|---|---|---|
| C1 | 组件库 / 设计系统独立成包，token 与基础件集中 | 我们已有 `tokens.css` + 静态自检（零硬编码字号/色值、对比度门限）→ **已达标，不另立** | — |
| C2 | **用真实工作流当测试夹具**（e2e 跑模板仓库里的工作流） | 与我们"夹具 provider + 真实浏览器冒烟"同思路，但他们的夹具是**用户可见的真实产物** | 我们已有夹具与 10 个冒烟段 → **已覆盖**；可选增量：把"某条模板"也纳入冒烟 |
| C3 | 上游 API 客户端由 OpenAPI 生成、契约驱动 | 与我们"`packages/shared` 的 zod schema 即契约、Fastify 直接当 validator"同思想 | **已达标，不另立** |
| C4 | 队列模式（Redis + 多 worker） | 吞吐 | **不借鉴**：我们是单机私有部署，本地轨并发=1（防线 1），加 Redis 只增运维面 |

### D. 明确不借鉴（避免"看什么都想学"）

| 项 | 原因 |
|---|---|
| i18n 多语言框架 | 我们的界面与客户都是中文单语；引入 i18n 只会给每个字符串加一层包装 |
| `ag-grid` / `chart.js` 等重型表格与图表 | 产品形态不同（我们是媒体工作台，不是数据表工具）；我们已有 KPI 卡与画廊形态 |
| `wa-sqlite` / `web-tree-sitter` / 代码节点 | 与"视频生成"无关 |
| Vue 生态与 Pinia | 我们的技术栈已定（React 19 + 自研 store，见 D46） |
| 企业版特性（多租户 / SSO / RBAC / 外部密钥管理） | 与 D42（一家一套私有部署）+ B58（角色待身份系统）的现状不符 |
| 逐字拷贝任何 n8n 源码 | 见 §二（许可证 + 语言栈双重不成立） |

---

## 四、落地顺序建议（成本 × 依赖 × 价值）

> **进度（2026-10-10）**：**第一批（B64 / B62 / B63 / B65）+ 第二批（B67）+ 第三批（B66 / B71）全部完成** ——
> 用户点名的 1~9 里**不碰执行链的 7 项已收官**。
> **剩余三项需要产品决策或改动执行链，刻意未做**：**B68**（Pin 产物 + 部分重跑，最值钱也最重）、
> **B69**（"只跑这一步" + 显式重跑 —— 需先厘清与**幂等指纹**的关系）、**B70**（连线拖出 → 节点搜索器
> = **L3 可编排画布**立项）。三项的取舍见 PLAN §9 对应行。
> 每阶段的证据在 PLAN §5（含冒烟断言与门禁数字）。

**第一批（纯前端、不碰契约、不碰执行链）** —— 先把"看图"变成"能查、能导航"：

| 台账 | 内容 | 成本 | 依赖 |
|---|---|---|---|
| **B64** | MiniMap + Controls + 缩放到选区（**画布库自带现成组件**） | 极低 | 无 |
| **B62** | 节点检查器抽屉（提示词快照 / 输入 / 产物预览 / 耗时 / 成本 / warnings / 该任务的日志 / 上下游跳转） | 低 | 我们数据已全（任务对象 + `/api/logs?taskId`） |
| **B63** | 执行态与失败链可视化（状态点 + 流动 + 失败链标红） | 低 | 复用现有动效 token 与任务状态 |
| **B65** | 画布导出 JSON（把一条链导出为可复用配方包） | 中 | 与 B49 交付包口径对齐 |

**第二批（组织与规模）**：**B67**（便签/分组/对齐/多选/快捷键）→ 与 **B44**（画布规模）同批。

**第三批（内容资产）**：**B66**（schema 版本化 + 旧文件可打开 + 版本历史）→ **B71**（模板库/行业模板）。

**第四批（要动执行链，最值钱也最重）**：**B68**（Pin + 部分重跑）→ **B69**（只跑这一步 / 显式重跑）。

**随时可做（低风险，§五 的第二轮产出）**：**B73**（执行数据按结果差异保留）、
**B75**（两态执行：试跑 vs 正式出片 —— **建议早于 B68 做**，因为它是 B68 省钱逻辑的"轻量版"）。

**与批量提交同批**：**B74**（声明式错误策略）。

**待决策（不排期）**：**B72**（服务端凭据模型 —— 与"Key 零留存"铁律的取舍）。

**与 L3 同批**：**B70**（连线拖出 → 节点搜索器），它其实就是"可编排画布（OI-3）"的入口。

---

## 四·五、怎么验（给用户的逐条走查清单）

```bash
pnpm build && pnpm serve:local --fixture   # 生产形态；--fixture 可零成本造数据（画廊/画布有内容）
# → http://127.0.0.1:3000
```

| # | 去哪儿 | 做什么 | 期望看到 |
|---|---|---|---|
| 1 | `#/canvas` | 看右下角与左上角 | **小地图**在右下；左上工具条有「◎ 缩放到选区」「＋ 便签」「⤢ 全部」 |
| 2 | `#/canvas` | 点任意节点 | 右侧**检查器**：提示词全文 / 参数 / 输入素材 / **成本**（或"未记录"）/ 警告 / 错误 / **这条任务发生了什么**（留痕）/ **血缘上下游**（点了能跳） |
| 3 | `#/canvas` | 造一条会失败的任务（或看已有失败任务） | 节点**红点 + 红边框**；顶部状态条显示「⚠ N 个节点异常」+「只看异常」（点一下无关节点变暗、可逆） |
| 4 | `#/canvas` | 点检查器里的「⤓ 导出配方包」 | 下载一个 JSON；`kind: astrmira.recipe-pack`、含 tasks/assets/edges；**不含** options / baseUrl |
| 5 | `#/canvas` | 点「＋ 便签」→ 写点东西 → 刷新 | 便签还在（存在本机浏览器，按项目隔离）；`Ctrl/Cmd+A` 全选 → 「缩放到选区」可用，`Esc` 取消 |
| 6 | `#/edit?task=<某条成片>` | 页头「⏱ 草稿历史」→「＋ 存一个版本」→ 随便改几下 →「恢复」 | 回到了那一版；**恢复前会自动把当前也存一份**（恢复错了还能回来） |
| 7 | `#/create` | 看提示词框下方第二排 chips | 「行业模板」四个（灯具/餐饮/服装/家居）；点一个 → **整段提示词骨架填入** + 一条"推荐 X · 9:16 · 5s"提示 |

**验收时值得特意试的两个"防呆"**：① 便签是**会话间持久**的，但**数据节点位置不持久**（D40 只读语义）——
这是刻意的；② 剪辑台**刷新不会丢**（草稿 500ms 防抖 + `pagehide` 兜底）。

---

## 五、画布之外的"高价值设计"（第二轮探讨的产出）

这些不在用户点名的 1~9 里，但同样值得学（按"能不能马上用"排序）：

| # | n8n 的做法 | 我们的现状 | 可学的地方 |
|---|---|---|---|
| E1 | **执行数据的"差异保留"**：成功的执行留得短、**失败的执行留得久**（社区版 `EXECUTIONS_DATA_PRUNE` 一类策略） | 我们做完 **B23**（统一 90 天）后**又做了 B73**：保留策略已改为**分级** —— 正常 30 天 / **异常 180 天**（失败留久、成功留短） | ⭐ **立刻可用**：失败记录是排错资产、成功记录是噪声 —— 按结果分级保留（例如失败 180 天、成功 30 天）。登记 **B73** |
| E2 | **两态执行**："手动跑这一次"（Manual）与"激活后在线上自动跑"（Production）明确分开 | 我们只有一种"提交"：点了就真花钱（幂等去重只防重复，不防试错） | ⭐ **产品级洞见**：`试跑（夹具/低成本档，零或极低成本）` vs `正式出片` 两态化 —— 与 **B48 成本台账**联动，是 B 端最直接的省钱形态。登记 **B75** |
| E3 | **声明式错误策略**：节点级 `continue on fail` / `retry on fail`，失败分支可继续走 | 我们有防线 2（重启后如实归 failed/uncertain）+ warnings，但"链上一段失败、其余段照跑"没有声明式表达 | 多镜头批量出片时，"第 3 条失败不该让整批停" 是真需求。登记 **B74** |
| E4 | **Wait / 暂停等外部事件（可恢复）** | 我们有"不确定态 + 启动调解"，但没有"**停在某一步等人确认**" | 与 **B50（协作与审批）**结合：把"客户审片通过才继续"画进图里 —— 不另立编号，**归入 B50 的形态设计** |
| E5 | **排队语义对用户可见**（队列模式会明确告诉你在等什么） | `/api/metrics` 有 `queue.oldestQueuedAgeSec`（B53），但**界面上没告诉用户"我前面还有几条、大概等多久"** | 本地轨并发=1（防线 1）是硬约束，**把它如实讲给用户**比让他干等更专业。并入 **B63**（执行态可视化）一起做 |
| E6 | **节点说明（notes）**：每个节点可写一段人话说明 | 我们有 `warnings` 与提示词快照，但没有"这一步为什么这么做" | 交付归档（**B49**）需要"解释给客户听"的材料 → 并入 **B65/B67** |
| E7 | **同一份数据三种视图**：JSON / 表格 / Schema | 任务对象字段很全，界面只显示一部分 | 产物检视做成"预览 + 元数据表"两种视图即可（**B62** 里定） |
| E8 | **首启用模板引导"跑通第一条"**（onboarding） | 我们首启是空态 + 引导文案 | B52 的**首启配置向导**可抄这个思路："用一条零成本模板先跑通"，比让客户对着空界面填 Key 更容易成功 |

**⚠️ 一条反例（不学）**：n8n 的"执行数据保留"在社区版里**默认会把数据删掉**，导致用户"跑完就找不到了"—— 我们的 B23 特意选了**默认 90 天且明确写在契约里**，B73 又进一步改成**分级**（正常 30 / **异常 180** ——
失败反而留更久），这条比它做得对，不要为了"像 n8n"而调短默认值。

---

## 六、词汇对照（读 n8n 源码时用得上）

| n8n 的词 | 我们的对应物 |
|---|---|
| Workflow / node / connection | 血缘链 / 任务·素材节点 / 派生边（我们是"已发生的事实"，它是"待执行的步骤"） |
| NDV（Node Details View） | 节点检查器（B62） |
| Pin data | 固定产物（B68） |
| Execution | 任务（`tasks` 表）+ 操作日志（`event_log`） |
| Credentials | BYOK 凭据（只走请求头、不落库）→ 与 B72 的张力点 |
| Template | 配方 / 交付包（B30 / B49 / B71） |
| Node type version | 工程与模板的 `schemaVersion`（B66） |
| Sticky note | 画布便签（B67） |

<!-- 原文：docs/INFOS-REVIEW.md -->

# infOS / Pictoria 源码复核与可借鉴清单

> 复核对象：`https://github.com/YoKONCy/infOS`，本地 `C:\Users\v_chchsli\Desktop\infOS`。
> 本地与 `upstream/main` 一致：`4fa1424`（v0.9.4 后的发布/CI 修复）；`9afeb1e` 是 v0.9.4 的功能发布提交。
> 许可证：Apache-2.0。本文只记录**设计与可借鉴点**；若直接复制代码，按 Apache-2.0 在 NOTICE 记来源。
> 本轮只读源码，没有运行 infOS 的构建/测试。

## 1. 结论摘要

1. **Pictoria 是 infOS 的“画布 + 工作流”子应用**，核心不是画布本身，而是三件事：
   - **声明式外部服务** `ServiceProfile`：一个 JSON 描述 submit/poll/cancel/outputs/timeout/幂等；
   - **提交回执 + 不确定态**：`SubmissionJournal` + `uncertain` 节点状态 + `TaskRecovery` 弹层；
   - **Step/Workflow 的 schema、绑定、版本与发布**：技能/Agent 计划的现成结构参考。
2. **源码里没有内置 H3/MiniMax 视频模型**。内置视频模型是 Wan 2.6 / Grok Video 3 / Veo 3.1；`DEVELOPMENT.md` 明确写“尚无模型下载安装或 GPU 进程管理”。
   你们测通 H3 的路径大概率是 **`service.save` 自定义服务指向算力服务器**（或本地未提交的适配），不是 infOS 内置 H3 档。
3. 这与 D67 一致：**算力服务器跑模型 + HTTP 任务接口，应用只做提交/轮询/取产物**。本轮先落地一个**配置型 HTTP 任务服务**，把 submit → poll → output → cancel 用 mock 打通；H3 的真实工作流等拿到服务器协议后再填配置。

## 2. Pictoria 关键实现（源码位置）

| 能力 | 位置 | 做法 |
|---|---|---|
| 服务描述 | `packages/apps/pictoria/src/domain.ts:139-196` | `baseUrl`、认证、`submit`（path/body/bodyFormat/fields/taskIdField/outputs）、`poll`（stateField/success/failed）、`cancel`、`timeoutMs`、`recoveryWindowMs`、`idempotencyHeader/window` |
| 字段映射/请求 | `packages/apps/pictoria/src/serviceClient.ts:28-55,459-...` | 点路径 `field/assign`；`value/text/data_url/file` 四种格式；multipart；origin 固定；认证与普通 header 分离 |
| 提交回执 | `packages/apps/pictoria/src/submissionJournal.ts:6-62` | `prepared/sending/received/rejected` + payload fingerprint + 凭据 hash；发送前写回执；结果不明不自动重发 |
| 执行/恢复 | `packages/apps/pictoria/src/execution.ts:27-167,221-276,352-559` | 节点 `pending/running/submitted/saving/completed/failed/uncertain/cancelled/skipped`；退避、恢复窗口、持久化失败暂停、取消诚实 |
| 恢复 UI | `client/src/components/TaskRecovery.vue:58-95,163-185` | 待核验节点；填远程任务 ID 或勾选“已核验，需要重新提交（可能再次计费）”；两者都空时禁用 |
| 步骤/工作流 | `src/domain.ts:6-109`、`src/workflows.ts:58-129`、`src/workflowValidation.ts:205-230` | Step 三种实现（service/llm/workflow）、Workflow 节点绑定 stepRevision、typed input/output、循环/必填校验、发布 |
| 参考素材条 | `client/src/components/ReferenceInput.vue:89-160` | 序号、前移/后移、移除、数量上限、素材库选择器 |
| 资源库 | `src/library.ts:7-19,44-90` | prompt / materials / artworks；`final`、`favorite`、`tags`、`runId/stepId/model/inputs` 溯源 |
| 单 Agent 工具 | `src/manifest.ts:84-104` | 只投影一个 `pictoria` 工具；操作 `catalog/run/get/list/cancel/resume/canvas`；能力门控 |

## 3. 本轮直接落地的“通用 HTTP 任务服务”

### 3.1 范围（刻意最小）

- **只做后端 provider + 配置文件 + `/status`**；不做服务编辑器 UI、不做资产删除、不做协作。
- 支持的协议：`POST/GET submit → taskId → GET/POST poll → outputs`，也支持**同步**（submit 直接返回产物）。
- 支持 `image` / `video` 产物（写 `/media/<file>`），不支持独立音频/多产物。
- 认证：`tokenEnv` 指向环境变量；JSON 里**不落 token**。
- 地址：沿用 `isAllowedEngineUrl`（回环 / RFC1918）；公网算力服务器走 VPN/Tailscale 或后续单独加白名单，不直接放开。
- 幂等：配置 `idempotencyHeader` 时把服务端 taskId 作为幂等键发给上游；不回执/自动重发（回执/uncertain 留给 S4-R2）。

### 3.2 配置形状（`HTTP_SERVICES_FILE`）

```json
[
  {
    "name": "h3-gpu",
    "label": "H3 算力服务器",
    "baseUrl": "http://10.0.0.12:9000",
    "modes": ["t2v", "i2v"],
    "tokenEnv": "H3_GPU_TOKEN",
    "authHeader": "Authorization",
    "authPrefix": "Bearer ",
    "submit": {
      "path": "/v1/jobs",
      "method": "POST",
      "body": { "model": "minimax-h3" },
      "fields": {
        "prompt": { "from": "prompt", "format": "text" },
        "aspect_ratio": { "from": "aspectRatio" },
        "duration": { "from": "durationSec" },
        "first_frame": { "from": "assets.firstFrameImage", "format": "data_url" }
      },
      "taskIdField": "id"
    },
    "poll": {
      "path": "/v1/jobs/{id}",
      "stateField": "status",
      "success": ["succeeded"],
      "failed": ["failed", "cancelled"]
    },
    "cancel": { "path": "/v1/jobs/{id}/cancel", "method": "POST" },
    "outputs": {
      "video": { "path": "result.video_url", "kind": "video" }
    },
    "idempotencyHeader": "Idempotency-Key",
    "timeoutMs": 1800000,
    "requestTimeoutMs": 60000
  }
]
```

- `modes` 决定 `/status` 与前端引擎过滤；未声明的模式在提交时如实拒绝。
- `fields.from` 支持：`prompt`、`mode`、`aspectRatio`、`width`、`height`、`durationSec`、`frames`、`steps`、`seed`、`assets.firstFrameImage`、`assets.lastFrameImage`、`assets.referenceVideo`。
- `format`：`value`（原值）、`text`（字符串）、`data_url`（下载为 data URL）、`file`（multipart）。
- `outputs.kind` 只接受 `image` / `video`；`path` 为空表示整个响应体就是媒体字节。

### 3.3 与 AstrmiraVideo 现有契约的差异

- 新增 provider 基类型 `http-service`，具名实例 `http-service:<name>`；
- `/status` 新增 `httpServices` 段（id/label/modes/available/reason，不下发地址与 token）；
- `executedBy` 新增 `remote`（“远程服务”），队列仍走 `cloud` 并发桶（`TrackId` 不改）；
- 不新增错误码：复用 `PROVIDER_UNAVAILABLE / KEY_MISSING / KEY_INVALID / UPSTREAM_ERROR / UNCERTAIN_RESULT / TASK_NOT_FOUND`；
- 契约版本 **V2.47**；S4-R1b 的 revision/409 顺延为 **V2.48**（尚未实施）。

## 4. 后续可借鉴（不本轮做）

| 时点 | 借鉴点 | 落点 |
|---|---|---|
| **S4-R2（P0）** | `SubmissionJournal` 的 `prepared/sending/received/rejected` + `uncertain` + `TaskRecovery` 交互 | 提交回执表、批次“待核验”、填远程 ID/确认重试；不自动新建任务 |
| **S4-R2（P0）** | 退避/恢复窗口/取消诚实 | 只对安全请求重试；取消未确认时如实说明 |
| **S6-A（P1）** | Step/Workflow/binding/publish/校验 | 技能 = 版本化 step/workflow；应用只填草稿；Agent 计划用同一套校验 |
| **S6-B（P1）** | 单工具 + 操作枚举 + 能力门控 | 一个画布工具，不暴露一堆私有工具 |
| **S5-B1（P1）** | `ReferenceInput` 的编号/排序/上限/选择器 | 首帧/尾帧/参考视频的可见顺序；不扩“全能参考” |
| **S5-A/B3（P2）** | `final`、参数溯源、prompt/material/output 分库 | “最终稿”与参数来源；不扩成三类库 |

## 5. 不照搬

- Electron / NodeHost / ApplicationLease / 每应用 SQLite：我们是单进程后端，不需要。
- 500 轮 ReAct、终端托管、社交/NapCat、Vue 组件：与视频创作无关。
- 把画布改成通用 DAG 执行器：Pictoria 的工作流编辑器是它的产品核心；我们的画布是媒体编辑 + 生成任务。
- 通用 service 层在没有真实端点前继续膨胀（服务编辑器、模型市场、GPU 进程管理）——本轮只做配置与调用。

## 6. 来源与许可

- infOS：Apache-2.0；复核基线 `4fa1424`。
- 本仓若直接复制/改写其代码，按 Apache-2.0 在 `NOTICE` 保留来源与许可证指针；只在概念层借鉴的部分在实现注释里指回本节。

<!-- 原文：docs/UPSTREAM.md -->

# 上游参考与复刻台账（UPSTREAM）

> 本文记录本项目参考、复刻及直接引用的优质开源项目与组件，方便团队追溯实现来源与快速借鉴。

---

## 核心参考与复刻清单

| # | 项目 | 用途与复刻范围 | 参考链接 |
|---|---|---|---|
| 1 | **DiffSynth-Studio** | 本地 MiniMax H3 NF4 推理调用封装、Disk Offload 显存配置、Windows 段错误规避逻辑 | [ModelScope/DiffSynth-Studio](https://github.com/modelscope/DiffSynth-Studio) |
| 2 | **MiniMax H3** | 官方提示词工程规范、双引号台词音频合成语法、FL2V 处理器配置 | [MiniMax-AI/MiniMax-H3](https://github.com/MiniMax-AI/MiniMax-H3) |
| 3 | **Volcano ModelArk SDK** | 火山方舟（Seedance）异步生成任务提交、轮询与成片下载参考 | [火山方舟 API 文档](https://www.volcengine.com/) |
| 4 | **ComfyUI-VideoHelperSuite** | 视频帧预处理、32 倍数智能补边与居中裁切算法 (Smart Pad/Crop) | [ComfyUI-VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite) |
| 5 | **React Flow / @xyflow/react** | 交互节点与画布组件（用于后续进阶流程视图） | [xyflow/xyflow](https://github.com/xyflow/xyflow) |
| 6 | **WebLockShot** | 视频播放器组件、重试/退避策略 (`retry.ts`)、本地文件存储管理 | 自有参考项目 |
| 7 | **AI-SVWF** | 任务队列状态机、事件流设计、视频生成参数归一化 | 自有参考项目 |
| 8 | **Pexels API** | 可选实现项 OI-1 的主素材数据源：检索参数、多档尺寸与时长字段；要求先下载到自有服务器、禁止永久 hotlink。⚠️ `orientation = landscape\|portrait\|square`，与 Pixabay 枚举不通用，适配层必须显式映射 | [Pexels API](https://www.pexels.com/api/) |
| 9 | **Pixabay API** | 可选实现项 OI-1 的备用素材数据源（官方宣称不限次；视频库偏空镜与动态背景）。⚠️ 视频端点为横向/纵向类枚举，且另有 `video_type`（Pexels 侧对应 `size`），参数集与 Pexels 非一一对应 | [Pixabay API](https://pixabay.com/api/docs/) |
| 11 | **video-shotcraft** | 提示词配方库的**卡片结构借鉴**（"用途 / 建议时长 / 参数 / 已知坑"这种字段组织方式）。⚠️ **只借鉴结构、不抄内容**：它的 157 张卡是 Remotion 参数导向（TSX 组件 + 缓动时序 + 动态样片），我们的配方是**生成提示词骨架**导向（`skeleton` 是要粘进提示词框的中文文本、`pitfalls` 是生成经验），两者内容不通用 —— 因此 `packages/shared/src/recipes.ts` 的 20 张卡**文本全部自写**。<br>**剪辑台动效借鉴（B34 · P3，2026-09-24）**：字幕动效预设「逐词入场」（`wordSlide`：y 位移 + blur + opacity 三通道同步收敛的逐词 reveal）与「打字机」（`typewriter`）的**技法**来自其 `demos/typography/blur-slide` 与 `demos/typography/typewriter-moves`（逐帧确定性、归一化进度驱动的写法）；实现按我们的字幕场景重写（`frontend/src/edit/Composition.tsx`），**未复制其 `_fixtures` 框架**（DesignStage / Motion 工具链不引入）。时间轴交互模式（pointer 事件 + 吸附 + 裁剪手柄）亦参考其 `workbench/src/timeline/` | [Vincentwei1021/video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft)（**Apache-2.0**；2026-09-23 实测核对：仓库根有 License 文件与侧栏标识，README 正文未提及许可证） |
| 12 | **seedance-prompt-skill** | 配方库扩充（20→40 张）的**词库维度借鉴**：运镜 / 角度 / 节奏 / 焦点 / 光影 / 色调的**分类覆盖**（即"配方应该覆盖哪些维度"），以及**平台级坑清单**（Seedance 2.0 不支持写实真人脸部素材 —— 与我们踩到的上游隐私检测一致）。⚠️ 它是**即梦平台**（字节 C 端）的提示词规范，我们用**火山方舟 API**：`@图片1` 引用语法、视频延长 / 编辑 / 音频输入等即梦特有能力**不通用**，因此只借鉴**通用的运镜 / 风格词汇与分类维度**，每张卡的 `skeleton` / `pitfalls` **文本全部自写** | [songguoxs/seedance-prompt-skill](https://github.com/songguoxs/seedance-prompt-skill)（**MIT**；2026-09-24 核对：单文件 `SKILL.md`，词库在其"镜头语言词汇库 / 风格词汇库"两节） |
| 10 | **Astrmira（视觉语言）** | UI 视觉方向参考（深墨蓝 + 微光金的设计语言；`docs/assets/01~03` 三张概念图为其风格参照）。**已获作者许可**参考其设计风格；本项目与其站点无隶属关系，但不作"未授权参考"声明 | [Astrmira](https://www.astrmira.com/) |
| 13 | **Remotion**（剪辑台渲染引擎，**SDK 引入**） | **V9 剪辑台改版（台账 B34）的渲染引擎**：`@remotion/player`（预览）+ `@remotion/web-renderer`（浏览器端导出）+ `@remotion/media`（`<Video>` 组件）。**用法与 shotcraft 一致 = 纯 SDK 引入**（npm 依赖），不 fork、不复制框架源码；shotcraft 的 `demos/` 动效是**建立在 Remotion SDK 之上的 .tsx 业务组件**，可 copy 进我们的 composition 使用（其仓库 Apache-2.0）。<br>**⚠️ 一处源码级改动（用户 2026-09-24 明确决策，须随项目生命周期维护）**：用 pnpm `patchedDependencies` 把 `@remotion/web-renderer` 的 `sendUsageEvent` 短路为 no-op —— **移除浏览器导出时的遥测**（该遥测即使不设 licenseKey 也会把**终端用户的 IP 与站点域名** POST 到 `remotion.pro` 做许可审计；本项目测试环境对这类外发敏感）。**合规边界与补救路径**：① 我们属 Remotion 免费资格（≤3 人小团队、不商业化）；② 删遥测的版本**仅自用、不公开分发**；③ **本项目开源时须加回遥测**（删补丁即还原）；④ **商业化时须申请 Remotion 商业许可证**。改动点与还原方法见 `experiments/remotion-proto/REPORT.md` §五-c。<br>**✅ 正式落地（2026-09-24，B34 · P2）**：补丁文件 = `patches/@remotion__web-renderer@4.0.484.patch`（`pnpm-workspace.yaml` 的 `patchedDependencies` 注册，安装期自动生效）；**守卫断言** = `frontend/src/edit/webRendererPatch.test.ts`（版本升级 / 锁文件变化导致补丁静默失效时该测试变红——表现不会报错，只会让终端用户 IP 又外发，所以必须机器盯）；**还原 = 删 `patches/` 该文件 + `pnpm-workspace.yaml` 的 `patchedDependencies` 两行**。 | [remotion-dev/remotion](https://github.com/remotion-dev/remotion)（**Remotion License**，source-available 非 OSI：个人 / ≤3 人营利组织 / 非营利免费，>3 人营利公司需购 Company License；2026-09-24 核对 LICENSE.md 与 docs/telemetry） |

| 14 | **seedance-chain** | **链式接龙 + 批量分镜的参考实现**（2026-10-09 侦察；B 端样片/多镜头编排的方法论来源）：① **尾帧自动作为下一段首帧**的接龙（我们已有 D38 抽帧闭环的"手动一半"——抽帧 → I2V；它把这一步自动化）；② **多镜头批量提交**（一次编剧、批量出片）。⚠️ **只借这两条方法论**：它跑 Seedance **1.5 Pro**、并提到"API 相比网页端审核更少"——后半句**明确不借鉴**（我们如实透传上游审核，不做规避）；③ 它的"半自动导演"形态与我们 L3（多镜头编排）同题，可作为 L3 设计时对照。**未引用任何代码** | [PCPrincipal67/seedance-chain](https://github.com/PCPrincipal67/seedance-chain)（许可证**待核对**） |
| 15 | **ComfyUI 官方 Seedance 2.0 工作流**（FLF2V 首尾帧 / 多帧拼接） | **FLF2V 的"正统做法"参照**（2026-10-09 侦察）：① `ByteDance2FirstLastFrameNode`（首帧 + 尾帧 → 合成中间运动）被官方描述为**减少身份漂移 / 闪烁 / 构图偏移**的手段 —— 印证我们 FL2V 路线（Step 2-AC2 已实测）；② **多帧拼接**（两关键帧之间生成过渡、再 `ImageBatch`/`CreateVideo` 组装）是"分镜之间缝合"的工程手法，直接可用于 B56 样片的**镜头接龙**与 L3 的分镜编排。⚠️ 形态差异：Comfy 节点图 = **模型推理图**（可执行），我们的画布 = **血缘只读图**（不可执行）——只借"关键帧驱动 + 链式拼接"的方法论与参数经验（如 Seedance 2.0 支持 4~15s 时长区间【待我方实测核对】）。**未引用任何代码/工作流 JSON** | [comfy.org 工作流：Seedance2.0 首尾帧](https://comfy.org/zh/workflows/api_seedance2_0_flf2v-dc1311a65bc4) / [多帧拼接](https://comfy.org/zh/workflows/d833dc5abe59-d833dc5abe59)（ComfyUI 本体为 GPL-3.0，**工作流 JSON 的再分发条款待核对**） |
| 16 | **OpenMontage** | **"生产线 = 管线 + 工具 + 技能库"的产品形态参考**（2026-10-09 侦察）：自称开源 agentic 视频生产系统（12 条生产管线 / 100+ 工具 / 700+ agent 技能）。与本项目的关系：我们的**配方库（40 张卡）+ 技能 chips + 画布**是同一思想的轻量版；它可作为**B 端"批量管线"**（B49/B54）设计时对照"管线该怎么切分"。⚠️ 仅作**形态**参考，不引代码、不引提示词内容 | [calesthio/OpenMontage](https://github.com/calesthio/OpenMontage)（许可证**待核对**） |
| 17 | **Open WebUI** | **私有部署 UX 参考**（2026-10-09 侦察，服务 B52）：面向企业的**离线自托管** AI 平台形态 —— 首启引导、模型/凭据配置页、完全离线运行、单机多用户。我们的 `serve:local` / `deploy/` 要长成"客户能自助装"的形态时，**照它的信息架构抄体验**（不引代码） | [open-webui/open-webui](https://github.com/open-webui/open-webui)（**BSD-3-Clause**，2026-10-09 按其仓库首页标注；仅作 UX 参考） |
| 18 | **GitKraken Self-Hosted** | **"私有部署的许可与更新模型"的商业表达参考**（2026-10-09 侦察，服务 B52）：其官方表述"Self-Hosted 与 Serverless **功能集相同**，差别只在部署与许可模型"——这正是"一家客户一套私有部署"（D42）要讲清楚的三件事：**许可（谁有权用/几台机器）、更新通道（怎么升级/回滚）、功能对等（私有版不阉割）**。⚠️ 非开源，**只借商业模型表述**，不涉任何代码或资源 | [GitKraken Self-Hosted 文档](https://help.gitkraken.com/gitkraken-desktop/self-hosted/)（专有软件，仅文档参考） |

---

## 二进制 / 外部程序依赖（随镜像分发）

> 这些不是"参考的源码项目"，而是**随产物 / 镜像一起分发的外部程序与二进制资源**（如字体）。
> 因为分发物里**包含**它们，许可证影响必须逐项登记（部署任务见 PLAN §4 Step 5）。

| 工具 | 引入方式 | 版本 | 许可证 | 影响与说明 |
|---|---|---|---|---|
| `ffmpeg` / `ffprobe` | ① 生产镜像运行层 `apt-get install -y ffmpeg`（Debian bookworm，走镜像站）；② 开发机自行安装；③ CI runner `apt-get install -y ffmpeg`（ubuntu-latest） | ① 生产镜像 **`5.1.9-0+deb12u1`**【已验证实测】（2026-09-22 容器内 `ffmpeg -version` + `dpkg -s ffmpeg`；`ffprobe` 同版本，`dpkg` 版本串 `7:5.1.9-0+deb12u1`）；② 开发机 **`n8.1.2-50-g1a748fe2cd-20260831`**【已验证实测】（winget `Gyan.FFmpeg`）；③ CI **`6.1.1-3ubuntu5`**【已验证实测】（2026-09-22 的 CI 日志，`ffprobe` 同版本） | **GPL**：三个构建的 `configuration` 行都启用了 `--enable-gpl`（含 `libx264` 等 GPL 组件，而本项目合成命令固定用 `-c:v libx264`）——**三处均已实测确认**（生产镜像的配置行随该次实测一并核对） | 调用方式为**子进程**（`backend/src/lib/ffmpeg.ts` 用 `execFile`），不链接、不修改其源码。但镜像内**包含** GPL 二进制，再分发时需一并满足 GPL 的源码提供义务（Debian 侧源码获取见 <https://sources.debian.org/>；以 Debian / FFmpeg 官方许可说明为准）。 |
| `Cinzel`（woff2，latin + latin-ext 子集，字重 500） | 前端静态资源 `frontend/public/fonts/cinzel-*.woff2`，**随产物与镜像分发**（不是外链 CDN） | **v26**（2026-09-22 取自 google/fonts 的 `ofl/cinzel`，两个子集合计约 23KB）【已验证实测：随产物分发，且在 `NODE_ENV=production` 的 CSP 下正常加载（UI 冒烟 `scripts/smoke-ui.mjs`）】 | **SIL OFL 1.1**（允许再分发，**要求随字体附许可证文本**） | 用途：`--serif-caps`（全大写 eyebrow 标签）。许可证文本已随资源分发（`frontend/public/fonts/OFL.txt`）。**这类资源必须自托管**：生产 CSP 是 `style-src 'self'` / `font-src 'self'`，任何跨源字体/样式都会被浏览器拦掉（2026-09-22 实测踩过：外链 `fonts.googleapis.com` 自上线起就没生效，见 PLAN §5 的 B9 条目 ⑤）。 |
| `sharp` + 随包分发的 **libvips** | 后端运行时依赖（`backend/package.json` → 平台包 `@img/sharp-<platform>`，生产镜像内即为 `@img/sharp-linux-x64`） | **sharp 0.35.4 / libvips 8.18.6**【已验证实测：本机 `sharp.versions` 读数；生产为同族预编译包，标【待验证】】 | **Apache-2.0 AND LGPL-3.0-or-later**（平台包 `package.json` 原文；Apache 覆盖 sharp 代码，**LGPL 覆盖随包分发的 libvips**） | 用途：防线 4 图像清洗网关（`pipeline/imageSanitize.ts`）。调用方式是 **Node 原生绑定**（不是子进程），故镜像内**包含 LGPL 的原生库**（本机层面为 `libvips-42.dll` 约 17.8MB）——再分发时需按 LGPL 提供该库的源码获取途径与可替换性说明。**能力边界（实测）**：预编译 libvips **没有 HEVC 解码器**，`.heic` 当前走诚实拒绝（见 PLAN §5 的 S6 条目与台账 B21）；AVIF(AV1) 可用。 |

**三处各自怎么测**（避免下次再出现「文档标着待验证，而答案其实早就跑在机器上」）：

```bash
# ① 生产镜像（在部署机上执行；容器名以 docker ps 为准）
docker exec astrmiravideo-app-1 ffmpeg -version | head -1   # configuration 行也在此输出里
docker exec astrmiravideo-app-1 dpkg -s ffmpeg | grep ^Version  # Debian 打包版本（含 epoch/修订号）

# ② 开发机
ffmpeg -version | head -1

# ③ CI：`ci.yml` 的「安装 ffmpeg / ffprobe」步骤已打印 `ffmpeg -version | head -n 1`，查 run 日志即可
```

---

## 上游模型的 id 台账（云端轨）

> 模型 id **带日期后缀、随时上新**，且**可用性按账号**（方舟需先开通模型服务）。
> 所以这张表只记"我们已经在代码/文档里引用了哪些 id"以及**它们是怎么被验证的**，
> 而不是"方舟有哪些模型"（那会立刻过期）。

**验证方法（2026-09-23 实测，零费用）**：

```bash
# ① 列出该账号可见的全部模型（实测返回 135 项）
curl -s https://ark.cn-beijing.volces.com/api/v3/models -H "Authorization: Bearer $ARK_API_KEY"

# ② 判断某个模型是否**已开通可用**：空 content 探针
#    400 InvalidParameter（content 不能为空）= 模型存在且已开通
#    404 InvalidEndpointOrModel.NotFound        = 不存在或未开通
#    ⚠️ 这是"探测"不是"生成"：不会创建任务；若协议变化导致意外建任务，必须立刻 DELETE 取消
curl -s -X POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks \
  -H "Authorization: Bearer $ARK_API_KEY" -H 'content-type: application/json' \
  -d '{"model":"doubao-seedance-2-0-mini-260615","content":[]}'

# ③ 文本模型：max_tokens=1 的最小对话请求（200 = 可用）
curl -s -X POST https://ark.cn-beijing.volces.com/api/v3/chat/completions \
  -H "Authorization: Bearer $ARK_API_KEY" -H 'content-type: application/json' \
  -d '{"model":"doubao-seed-2-1-lite-260915","messages":[{"role":"user","content":"hi"}],"max_tokens":1}'
```

> 同一套逻辑已产品化为 `POST /api/providers/keys/verify`（CONTRACT §9）与凭据抽屉的「测试连接」——
> **不要在文档里写死可用性结论**，让用户点一下按钮拿到属于他账号的答案。

| 引用位置 | 值 | 验证状态 |
|---|---|---|
| `SEEDANCE_DEFAULT_MODEL`（协议层兜底） | `doubao-seedance-2-0-mini-260615` | **【已验证】开通状态 + 真实出片**（2026-09-23：T2V 5s/720p 出片成功，提交→终态 86.5s，产物 5.09s/1280×720/h264+AAC，无水印） |
| `VIDEO_MODEL_PRESETS`（抽屉下拉，6 档） | `doubao-seedance-2-0-mini-260615` / `1-0-pro-fast-251015` / `1-0-pro-250528` / `2-0-fast-260128` / `2-0-260128` / `2-5-260628` | **【已验证】**六档均通过空 content 探针（2026-09-23）；**价格说明仅为【待验证】**（官方活动页与公开报道，未经我方计费账单核对） |
| `LLM_PRESETS.volcano-ark.model`（文本轨） | `doubao-seed-2-1-lite-260915` | **【已验证】**`max_tokens:1` 返回 200（同账号另可用：`doubao-seed-2-0-mini-260215` / `deepseek-v4-flash-ga-260731` / `glm-5-3-flash-260828`） |
| 已淘汰的错值 | `doubao-seedance-video`（模板占位符，**非真实 id**） | **【已验证不可用】**404；曾导致线上故障，见 PLAN §5「V8.3 批次 6」 |
| **2026-10-09 复验（用户账号，零费用 `/models`，135 项）** | **视频族**：`doubao-seedance-2-5-260628` / `2-0-260128` / `2-0-fast-260128` / `2-0-mini-260615` / `1-5-pro-251215` / `1-0-pro-250528` / `1-0-pro-fast-251015` / `1-0-lite-t2v(与 i2v)-250428`；**图像族（本次新登记）**：`doubao-seedream-5-0-260128` / `5-0-flash-260915` / `5-0-pro-260628` / `4-5-251128` / `4-0-20260415` / `4-0-250828` / `3-0-t2i-250415`；**开源族**：`wan2-1-14b-t2v` / `-i2v` / `-flf2v-250417` | **【已验证】模型"可见"**（注意：可见 ≠ 已开通——可用性仍以空 content 探针为准，见上）；**图像族与 wan 族尚未接入本产品**（图像 = 台账 B31 / B54-③；wan 的 flf2v 与我们的 FL2V 同形，可作未来备选档）；本条同时是 B24（档位表维护）的一次事实输入 |
| **2026-10-09 开通探针（同一账号，零费用；**可见 ≠ 开通**的实证）** | **已开通**：视频 `doubao-seedance-2-5-260628`、`2-0-260128`（两者空 content → 400 `InvalidParameter`，即"接受请求但参数不全"）；图像 `doubao-seedream-5-0-pro-260628`、`5-0-flash-260915`（空 prompt → 400 `MissingParameter`）、`4-0-20260415`（400 `InvalidParameter`）。**未开通**（404 `InvalidEndpointOrModel.NotFound`）：`seedream-5-0-260128`、`4-5-251128`、`4-0-250828`、`3-0-t2i-250415` | 结论：**"生图 + 视频"两条链路在该账号都可跑通**（B56 样片的"参考图 → Seedream 竖版提清 → Seedance I2V"路线成立）；这条探针方法 = 本文件上方 ② 的空探针，**任何部署者的账号都应自己跑一次**而不是抄本文 |

<!-- 原文：docs/MOSS-IMAGE-EVALUATION.md -->

# MOSS-Image 8-step DMD / 量化版评估（2026-10-21）

> 结论：**可以跑通，文字/海报能力明显强于当前 FLUX.2 Klein；但不建议现在替换默认 t2i。**
> **算力服务器生产目标 = 满血 MOSS-Image SFT BF16 + 官方 50 步 / CFG 3**；本页的 10GB 量化 + 8-step DMD 只是**本地评估证据**，不作为生产部署。
> 满血 BF16 约 27.8GB 权重，建议 **48GB+ 显存**；32GB 只能靠 offload，不能算满血体验。

## 1. 实测环境

| 项 | 值 |
|---|---|
| GPU | RTX 3080 10GB（驱动 591.74） |
| 旧 ComfyUI | v0.36.0（生产实例，保持不动） |
| MOSS 测试实例 | **ComfyUI 0.42.0** 隔离副本，端口 8189 |
| 启动参数 | `--lowvram` |
| 模型 | `moss_image_sft_int8_convrot` + `qwen3.5_9b_w4a8_gptq` + `flux2-vae_small` + 社区 8-step DMD LoRA |
| 采样 | **8 步 / CFG 1 / euler / simple / LoRA 1.0** |

隔离方式：最新 ComfyUI 代码 + `moss-site` 新版前端/kitchen 包，用独立 launcher 启动；**没有升级或改动旧 v0.36.0**。测完已停止 8189，旧 8188 已恢复。

## 2. 权重与体积

| 文件 | 体积 |
|---|---:|
| `moss_image_sft_int8_convrot.safetensors` | 5.04 GB |
| `qwen3.5_9b_w4a8_gptq.safetensors` | 6.84 GB |
| `flux2-vae_small.safetensors` | 0.23 GB |
| `moss_image_sft_8steps_dmd.safetensors` | 1.11 GB |
| 合计（磁盘） | ~13.2 GB |

来源：
- `Comfy-Org/MOSS-Image`（官方 ComfyUI 打包，Apache-2.0）
- `lodestones/MOSS-Image-SFT-8-steps-dmd`（社区 DMD LoRA，Apache-2.0）

## 3. 结果

### 3.1 纯画面（雨夜霓虹橘猫）

![MOSS 1024×1024 雨夜霓虹橘猫](assets/moss-image-eval/moss-cat.jpg)

- 512×512 首次：**151s**（含模型加载/编译；8 步采样约 10 it/s）；
- 1024×1024 暖跑：**6s**；
- 1024 文件 1.29 MB；
- 观察显存：**9.55 GB / 10.24 GB**，空闲约 1.1 GB。

### 3.2 中文海报（同提示词对照）

MOSS-Image：

![MOSS 中文海报](assets/moss-image-eval/moss-poster-text.jpg)

当前 FLUX.2 Klein 4B（4 步，同提示词、1024）：

![FLUX.2 Klein 中文海报](assets/moss-image-eval/flux2-poster.jpg)

差异很直接：

- MOSS 主标题「雨夜霓虹」、副标题「2026 城市影像展」**都基本正确**；装饰性小字仍有错字。
- FLUX.2 Klein 的主标题已经错了（生成出近形字），副标题更明显。
- 这不是“MOSS 一定更好”的普遍结论，而是**中文文字/版式场景**上 MOSS 的明确优势。
- MOSS 10.2 中文海报暖跑约 **56s**（文本编码/编译开销高于纯画面）；FLUX.2 对照首次加载 + 4 步约 **111s**。

## 4. 与当前本地模型对比

| 维度 | MOSS-Image SFT int8 + w4a8 + 8-step DMD | FLUX.2 Klein 4B（当前默认） |
|---|---|---|
| 中文文字/排版 | **强**（主副标题基本正确） | 弱（近形字/错字） |
| 纯画面速度 | 暖跑 1024 约 6s | 4 步，暖跑也快 |
| 首次加载 | ~2.5 分钟（10GB 低显存 + 动态 offload） | 较轻，加载更快 |
| 显存 | 观察 9.55GB，余量 ~1.1GB | 4B 模型，余量更大 |
| 权重磁盘 | ~13.2GB | ~?（现有 flux 4B 文件） |
| 部署门槛 | ComfyUI >=0.42 + 新前端/kitchen 包 | 现有 v0.36 即可 |
| 适合 | 海报、带字排版、中文文字、布局 | 通用快速出图、日常迭代 |

**不是替代关系**：MOSS 更适合“带字/版式”场景，FLUX.2 更适合默认快速出图。两者都保留，按技能/用户选择切换。

## 5. 建议

1. **默认仍用 FLUX.2 Klein**，不自动切 MOSS；MOSS 作为可选 t2i 模板/独立引擎。
2. 部署到算力服务器时用**满血 BF16**：`moss_image_sft_bf16` + `qwen3.5_9b_bf16` + `flux2-vae`（约 27.8GB），建议 **48GB+ 显存**；10GB 量化版只留在本地评估。H3 与满血 MOSS 不要挤同一张 48GB 卡同时跑。
3. 可选模板已放在 `deploy/comfyui-templates/moss-image-t2i.*`；用独立 ComfyUI 实例 + `COMFYUI_TEMPLATE_DIR` 启用，具体见同目录 README。
4. 8-step DMD LoRA 是社区蒸馏，不是官方 50 步质量承诺；生产基线用官方 50 步，DMD 只作可选加速对照；文字/版式仍需人工复核。
5. 本次只验证了普通 prompt 和一张中文海报；**layout JSON/bbox 尚未实测**，不作为已支持能力。

## 6. 复现命令（隔离实例）

```bash
# 模型目录
ComfyUI/models/diffusion_models/moss_image_sft_int8_convrot.safetensors
ComfyUI/models/text_encoders/qwen3.5_9b_w4a8_gptq.safetensors
ComfyUI/models/vae/flux2-vae_small.safetensors
ComfyUI/models/loras/moss_image_sft_8steps_dmd.safetensors

# 最新 ComfyUI，独立端口
python main.py --listen 127.0.0.1 --port 8189 --lowvram
```

模板使用 `KSampler` 8 步、cfg 1、euler/simple；LoRA 强度 1.0。详细节点见 `deploy/comfyui-templates/moss-image-t2i.api.json`。

## 7. 未验/边界

- 没有官方速度/显存 benchmark，以上是本机观察值；
- 没有 FID/CLIP/人工偏好等定量评测；
- 只测了一张中文海报，文字仍有装饰性错字；
- layout JSON（bbox）没有实测；
- 8-step DMD 为社区版本，后续换 LoRA/权重需重测；
- 10GB 卡首次加载慢、显存余量小，不适合作为默认高并发服务；
- 满血 BF16 的显存/速度/50 步质量尚未在 48GB+ 机器上实测；本文只证明量化版能跑、文字能力有优势。
