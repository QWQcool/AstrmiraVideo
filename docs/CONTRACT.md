# 数据契约与接口定义（CONTRACT）

> **状态：V2.21 · 已冻结（变更需先改本文，再改代码）**
> **V2.21 修订（2026-10-10）**：**剪辑工程版本化与草稿历史（台账 B66）** —— **纯前端、无新路由、无新错误码**：
>   ① 新增 `migrateEditProject`（shared 纯函数）：**旧草稿必须能被打开**、**来自更新版本明确拒绝**、
>   迁移留痕进 `notes`；② 草稿读不出来时**保留原文 + 说明原因**（改口径：原先"就地删除"= 数据丢失）；
>   ③ 草稿**版本历史**（localStorage，最多 8 份，编节流 + 去重 + 恢复前保底）。细则见 §11-2 末尾。
>
> **状态（上一版）：V2.20 · 已冻结**
> **V2.20 修订（2026-10-10）**：**新增 §11-4 配方包文件格式 `astrmira.recipe-pack`（台账 B65 画布导出）** ——
>   纯前端产物（浏览器下载），**无新路由、无新错误码**。三条口径：只导**上游闭包**、
>   **不含 provider 私有参数与凭据**（`options.baseUrl` 可能是内网地址）、ghost 如实进 `omitted`。
>
> **状态（上一版）：V2.19 · 已冻结**
> **V2.19 修订（2026-10-10）**：**操作日志新增 `?taskId=` 筛选（台账 B62 节点检查器）** —— 纯增量，
>   无新路由、无新错误码。为什么加：任务终态 / 提交 / 取消 / 渲染入库都带 `task_id`，
>   而"用关键词搜提示词去捞这条任务发生了什么"只能碰运气；画布检查器要一条直路。
>   影响面：§10 的查询筛选（新增 `taskId`），**清空（`DELETE /api/logs`）复用同一套筛选**故同时受益。
>
> **状态（上一版）：V2.18 · 已冻结**
> **V2.18 修订（2026-10-10）**：**操作日志保留策略（台账 B23）** —— 无新路由、无新错误码，
>   只把 §10 里那句"全量保留、由用户手动删"改成**默认保留 90 天 / 20 万条**（`LOG_RETENTION_DAYS` /
>   `LOG_MAX_ROWS` 可覆盖，`0` = 关闭该判据），并新增 `log.prune` 动作。为什么现在做：私有化部署是长跑，
>   而 §16 的 `database.size` 告警会**先于**任何人注意到日志在涨；**只删日志，业务数据一条不动**。
>
> **状态（上一版）：V2.17 · 已冻结**
> **V2.17 修订（2026-10-10）**：**备份与恢复（台账 B52 片 A）** —— 无新路由，但新增了一份
>   **运维契约**（§17）：数据布局（含 `data/server.lock` 服务进程锁）、备份产物形状（`manifest.json`）、
>   恢复的三道安全闸门。为什么它值得进契约：备份/恢复的**语义**决定了"客户的片子会不会丢"，
>   而它比任何接口都更难事后补救。
>
> **状态（上一版）：V2.16 · 已冻结**
> **V2.16 修订（2026-10-10）**：**可观测与 SLA 基线（台账 B53）** —— 纯增量：三个新端点 + 一个新章节，
>   **既有 `/api/health` 的响应一字不改**（它是 V1.7 起的存活探针，CI/CD 与免鉴权名单都依赖它）。
>   ① **§16 新增**：live / ready 分级、`MetricsResponse` 快照、告警阈值与判定口径（`METRICS_*` env 可覆盖）；
>   ② **§5**：新增 `GET /api/health/live`、`/api/health/ready`、`/api/metrics`；
>   ③ **§8**：明确 `/api/health` = **存活（liveness）**语义（不含依赖检查）；
>   ④ **免鉴权名单**只放开 `/api/health` 与 `/api/health/live`；ready 与 metrics **刻意要鉴权**。
>
> **状态（上一版）：V2.15 · 已冻结**
> **V2.15 修订（2026-10-10）**：**Webhook 终态回调（台账 B51 片 A）** —— 纯增量：五个新路由 +
>   一个新错误码，**不改任何既有响应**。
>   ① **§15 新增**：事件与签名口径（`task.terminal`；`X-Astrmira-Signature: sha256=<hex>` 对**原始请求体**）；
>   ② **§5**：新增 `GET|POST|PATCH|DELETE /api/webhooks` 与 `GET /api/webhooks/:id/deliveries`；
>   ③ **§6**：新增 `WEBHOOK_NOT_FOUND`（**不静默 200**）；
>   ④ **§7**：新增 `webhooks` / `webhook_deliveries` 两张表 —— `secret` 落库（服务端要签 HMAC）但**永不回读**；
>   ⑤ 为什么**不做内联触发**（只做扫描补投）写在 §15：一处覆盖全部终态写入点 + 重启补投，代价是最多一个扫描间隔的延迟。
>
> **状态（上一版）：V2.14 · 已冻结**
> **V2.12 修订（2026-10-10）**：**成本台账（台账 B48）** —— 向后兼容的扩展：新增一份**只读**的聚合响应，
>   既有响应只多一个**可选**字段。
>   ① **§13 新增**：`CostRecord` + `GET /api/costs/summary` 的完整形状与**计价口径**（上游计费公式 + 公开价目表）；
>      **这是估算，不是账单** —— 固定文案 `COST_DISCLAIMER` 由服务端下发，界面不得改写措辞；
>   ② **§4**：`TaskProgress` 增**可选** `cost`（**只有成功任务在终态结算时写入**；缺省 = 未结算 ——
>      "不知道花了多少"与"本地轨 0 元"必须能分开，因此**不给默认值 0**）；
>   ③ **§5**：新增 `GET /api/costs/summary`（可选 `?project=` / `?from=` / `?to=`）；
>      **`?project=` 省略 = 默认项目**（与 `history` / `assets` 同口径）、字面量 **`all` = 跨项目汇总**
>      （唯一刻意允许跨项目的地方："这台机器一共花了多少"是部署方的问题）；
>   ④ **口径改口（重要）**：V9 时代刻意"不造成本数字"（当时是 C 端定位、怕误导）；
>      **D41 转 B 端后必须反过来** —— 成本可见是采购的硬要求。因此本版把"预估 + 以账单为准"
>      写成契约条款，并要求**未结算条数与不确定条数必须与金额并列出现**（只给金额会被读成全量）；
>   ⑤ **§7**：`tasks` 增 `cost_yuan` / `cost_source` / `cost_detail` 三列（结算一次即入账，
>      历史单价变动**不改写**已发生的成本）。
> **V2.11 修订（2026-10-10）**：**项目维度（台账 B47，用户 2026-10-10 拍板"成员角色先不做"）** —— 向后兼容的扩展。
>   ① **§12 新增**：`ProjectEntry` + 项目 CRUD 四条路由；**默认项目 `default` 永远存在**（老数据的归属，
>      也是"调用方没传项目"时的落点）—— 因此**老客户端行为不变**；
>   ② **§1**：`VideoGenerateRequest` 增**可选** `projectId`（**我们的元数据、不透传给上游**），
>      且必须进幂等指纹（否则同一提示词在两个项目会被去重成同一条任务）；
>   ③ **§5**：`POST /api/upload` 新增可选 multipart 字段 `projectId`、`GET /api/history` 与
>      `GET /api/assets` 新增可选 `?project=`；**三者省略一律 = 默认项目**（不是"全部项目"）；
>      `POST /api/edits/renders` 新增可选 multipart 字段 `projectId`（剪辑产物与其源片同属一个项目）；
>   ④ **§5 / §4**：`AssetListEntry` 增**必填** `projectId`（sidecar 缺失即默认项目 —— 如实归属，不猜）；
>      sidecar（`<assetId>.json`）相应增可选 `projectId` 与必填 `kind` 的写入口径（见 §7）；
>   ⑤ **§6**：新增 `PROJECT_NOT_FOUND`（`terminal`）—— 显式指定了不存在的项目时**报错而不是静默落到默认项目**；
>      `INVALID_REQUEST` 复用为「项目名为空 / 重名 / 删除非空项目 / 删除默认项目」四种请求级拒绝；
>   ⑥ **§7**：`projects` 表与 `tasks.project_id` 的迁移口径（`bootstrapProjects`：建默认项目 + 回填 NULL，幂等）；
>   ⑦ **角色（管理员/创作者/查看者）不在本版**：没有用户身份系统就做角色只是假门禁（违反"不假装可用"），
>      登记为独立待办（与 §B50 协作审批同批）。
> **V2.10 修订（2026-10-09）**：**音频素材与 BGM（台账 B57）** —— 向后兼容的扩展（新增一类资产，不改既有语义）。
>   ① **§5**：`POST /api/upload` 白名单新增 **mp3 / wav / m4a**（魔数嗅探 + **ffprobe 流类型复核**）；
>      **实测事实（2026-10-09）**：`file-type` 对 `.m4a` 与 `.mp4` **都返回 `video/mp4`**（无论 brand 怎么写），
>      容器嗅探**无法**区分"纯音频 mp4"与"带画面的 mp4"——因此判 `audio` 不能只看容器，必须由 ffprobe
>      复核「无视频流且有音频流」。音频**原样落盘**（不走防线 4 清洗，与视频同规则），体积上限
>      `MAX_AUDIO_BYTES = 20MB`（BGM 量级；视频仍 100MB）；sidecar 增**可选** `kind` 字段（见 ②）；
>   ② **§5 / §4**：`UploadedAsset.kind` / `AssetListEntry.kind` 由 `image|video` 扩为 **`image|video|audio`**；
>      `GET /api/assets` 的 kind **优先读 sidecar**（`outputs/assets/<assetId>.json`，上传时已算出真相），
>      无 sidecar 时按容器嗅探兜底（`audio/*` → audio；`video/*` → video，**不猜** —— 老资产与抽帧产物走这条）；
>   ③ **§7**：「上传的参考资产」扩展名补 `.mp3|.wav|.m4a`；音频资产的生命周期与**参考资产完全同规则**
>      （同一 `<assetId>.` 前缀清理、不参与容量淘汰），**不新增任何清理路径**；
>   ④ **§11-2**：`EditClipSource` 增**可选** `assetId` / `name`（`taskId` 转为**可选**，二者**至少有一个**）——
>      音效轨要能取自**上传的音频素材**（此前只能取成片的音轨）；`AudioClip` 增**可选** `fadeInFrames` /
>      `fadeOutFrames`（0~`durationFrames`，默认 0）供广告片收尾的淡入淡出。
> **V2.9 修订（2026-10-08）**：**Step 10 批（台账 B43 资产元数据；B32 无需契约变更）** —— 向后兼容。
>   ① **§5**：`POST /api/upload` 落一份**资产元数据 sidecar**（`<assetId>.json`：原始文件名 + 上传时间）——
>      `@` 提及弹层要"按名字认素材"，而此前只有 assetId；原始文件名**只落本地**（不进上游、不进日志、
>      不进任务快照），且只存 sanitize 后的 basename（截断 120 字符）；
>   ② **§5 / §4**：`GET /api/assets` 的条目新增**可选** `name`（有 sidecar 才有；抽帧产物没有原始文件名）；
>   ③ **§7**：「上传的参考资产」一行补注 sidecar 的清理规则（按既有的 `<assetId>.` 前缀规则自动覆盖，
>      **不新增任何清理路径**）；
>   ④ **B32（真人素材体验收敛）不改契约**：错误码仍 `UPSTREAM_ERROR` + `terminal`（§6 闭集不动），
>      只把上游隐私拒绝的**文案**改为可执行指引 + 前端加前置提示 —— 文案不属于冻结面。
> **V2.8 修订（2026-10-08）**：**Step 9 运维保命批（台账 B22 / B25）** —— 均为**向后兼容**的补充。
>   ① **§5**：`POST /api/providers/keys/verify` 与 `GET /api/logs` 挂**独立限流桶**（内存突发窗口：
>      **10 秒内 5 次 / 30 次**，429 `RATE_LIMITED` + `Retry-After`；桶口径与理由见该行 ——
>      `keys/verify` 会向上游发真实探测请求，被刷等于拿部署者的服务器当探针）；
>   ② **§7**：**容量淘汰（LRU）落地** —— 把此前的"暂缓"改为实现口径：阈值/目标水位/淘汰顺序/
>      三类保护规则/只淘汰成片与缩略图（不动参考资产与任务记录）；
>   ③ **§4**：`outputVideoUrl` / `thumbnailUrl` 补一条既成纪律的推广 —— **文件不存在时省略该字段**
>      （与 `outputSizeBytes` 同纪律：不填一个必然 404 的 URL）；
>   ④ **§10**：`LOG_ACTIONS` 新增 `storage.evict`（容量淘汰发生后写一条，`method: 'STORAGE'`）。
> **V2.7 修订（2026-10-08）**：**Step 8 · P3（one-for-all 创作入口，台账 B41）的契约支撑** —— 纯新增，向后兼容。
>   ① **§5**：新增 `GET /api/assets` —— **资产库清单**（只读）：`@` 提及素材弹层需要"以前上传过的图/视频"的枚举能力，
>      而资产 ID 此前只存在于上传响应与任务快照里；
>   ② **§7**：「上传的参考资产」一行补注该端点（只读列举，不改变生命周期与清理规则）。
> **V2.6 修订（2026-09-24）**：**Step 8 立项批（台账 B36 / B37，用户拍板）** —— 均为**向后兼容**的扩展。
>   ① **§5**：`/api/upload` 与 `/api/edits/renders` 的体积上限由 20MB 提到 **100MB**（反代 `request_body.max_size` 同步；PLAN §7-9 口径同步）；
>   ② **§5**：`GET /api/history?kind=edit` 的 `source` 参数改为**可选** —— 不带时返回**全部剪辑产物**（剪辑台素材候选与 L2 画布用；带 `source` 仍只回某源片的剪辑历史）；
>   ③ **§1**：`assets.referenceVideo` 除上传资产 ID 外，新增接受 **`task:<taskId>`** 引用（直接引用一条已出片任务——含剪辑产物——的成片作为 V2V 参考；服务端解析为 `/media/*` 公网地址，复用既有"公网 URL"守卫）。
> **V2.5 修订（2026-09-24）**：**剪辑台改版（台账 B34）的契约迁移** —— 剪辑从「EDL 操作序列」升级为「**多轨工程 `EditProject`**」，渲染**搬到用户浏览器**（`@remotion/web-renderer`，WebCodecs 硬件编码；服务器零 CPU）。
>   ① **§4 / §11-2**：`TaskProgress.origin` 的 `edit` 分支新增**可选** `project`（多轨工程）；`script` 同步改为**可选** —— 两者**至少有一个**（旧记录只有 `script`，新记录只有 `project`，都要能读）；
>   ② **§5**：新增 `POST /api/edits/renders` —— 浏览器端渲染产物**入库**（multipart：MP4 + 工程 JSON；服务端**只归档不渲染**）；
>   ③ **§11-2 重写**为多轨工程契约（模型 / 转场语义 / 渲染归属 / 闭环），原 EDL 契约降为 **§11-3（API-only，UI 不再暴露）**；
>   ④ **§7**：新增「浏览器端渲染产物」一行（落 `outputs/<taskId>.mp4`，与生成产物同生命周期）。
>   ⑤ **§10**：`LOG_ACTIONS` 新增 `edit.render`（渲染入库）。
> **V2.4 修订（2026-09-24）**：**用户验收发现的两个缺陷修复**（均为**向后兼容**的扩展，无破坏性变更）。
> **V2.4 修订（2026-09-24）**：**用户验收发现的两个缺陷修复**（均为**向后兼容**的扩展，无破坏性变更）。
>   ① **§5**：`GET /api/history` 新增**可选**查询参数 `?kind=edit&source=<taskId>` —— 默认（不带参数）只返回**生成产物**（剪辑产物因复用源片提示词，混在画廊里像"重复记录"）；带参数则返回某源片的**剪辑产物**（剪辑台"本片剪辑历史"用）。剪辑产物的删除仍走 `DELETE /api/history/:taskId`（不按类别过滤）。
>   ② **§10**：`LOG_ACTIONS` 新增 4 个语义动作 —— `edit.submit`（`POST /api/edits`）与**任务终态三态** `task.complete` / `task.fail` / `task.uncertain`。为什么加：`POST /api/edits` 返回 200 只代表"入队成功"，执行是异步的，**终态失败原本不产生任何 HTTP 请求、操作日志里无迹可查**（用户在剪辑台看到失败、翻日志却全是 200）。现在 `SqliteJobQueue` 的终态会写一条 `method: 'TASK'` 的日志（剪辑任务带 `detail.kind: 'edit'`）。**对生成任务同样生效**。
> **V2.3 修订（2026-09-23）**：**V9 B3 的最小数据增量**（方案 A；用户 2026-09-23 在 B1 闸门确认"确认做吧"）。
>   ① **§4**：`TaskProgress` 新增 `createdAt`（epoch ms —— 直接暴露 `tasks.created_at`，**列本就存在、零迁移**）与可选 `outputSizeBytes`（成片字节数，服务端 `stat` 落盘文件得出）；
>   ② **§5**：`GET /api/history` 的响应由 `{ items }` 扩为 `{ items, storage }`，`storage` 是 `outputs/` 的**目录级聚合**（成片 / 缩略图 / 参考资产）——老数据同样准确，不依赖逐条累加；`StorageUsage` 形状见 §4 末尾。
>   为什么加：V9 总览页四卡（今日生成 / 成功率 / 队列中 / 存储占用）与视频库"按时间 / 大小排序"此前**算不出来**（history 既无时间戳也无体积）——这是 Step 6-AC2「不许出现算不出来的指标」的落地前提。
>   纪律：只暴露**已有列**、只做**只读聚合**；不新增表、不新增路由、不引入后台任务。
> **V2.2 修订（2026-09-23）**：**V9 前端改版的接口规划**（PLAN §4 Step 6，决策 D33~D38）。本节内容当时均为**【规划】**；**现状（2026-09-23 追加）**：**全部四项已实现** —— §3 的 `recipeId` 与 §11-1 配方库 = **B8**；§5 的 `POST /api/edits` 与 §11-2 剪辑台 = **B9**。
>   ① **§3**：`PromptEnhanceRequest` 新增可选 `recipeId`（配方库作为扩写的风格上下文）；
>   ② **§5**：路由表新增 `POST /api/edits`（轻剪辑台，本地 ffmpeg，**零上游调用**）；
>   ③ **新增 §11**「配方库与轻剪辑台」：`RecipeCard` 与 `EditScript` 的完整形状、`/api/edits` 的状态映射、剪辑产物与 EDL 的生命周期。
> **V2.1 修订（2026-09-23）**：线上故障修复（模型被服务端 env 静默覆盖 → 上游 404）+ 操作日志上线。
>   ① **§1**：`options` 的语义**收紧为白名单**并明确优先级——视频轨承认 `model` / `baseUrl` /
>      `seedanceResolution` / `seedanceWatermark`；**请求里的 `model` / `baseUrl` 优先于服务端 env**。
>      这是本次故障的根因修复：此前注册点只读 env，界面上"切模型"根本没有效果。
>   ② **§5**：新增 `POST /api/providers/keys/verify`（原【规划·B2】，现实现，见 §9）；
>      新增 `GET /api/logs` / `DELETE /api/logs/:id` / `DELETE /api/logs`（见 §10）。
>   ③ **新增 §9**（凭据与模型校验）、**§10**（操作日志）。
>   ④ 错误码字典不变（12 个码，无新增）：模型不存在仍归 `UPSTREAM_ERROR` + `terminal`，
>      只是**消息里现在会带上"实际用了哪个模型、来源在哪"**。
>   ⑤ 转发与日志的凭据纪律不变：`packages/shared/src/verify.ts` 的校验接口也**只从请求头取 Key**，
>      响应与日志中的一切上游文本先过 `security/redact.ts`。
> **V2.0 修订（2026-09-22）**：**§3 提示词扩写由【规划】转为已实现**（PLAN §6-D24 / 台账 B3，落地见 §5 的 V8.3 批次 4），并据此新增 **§2 的 `llm` 能力位**。
>   ① **§2**：`ProviderStatus` 新增 `llm` 段（`available` / `acceptsClientKey` / `reason`）。
>      口径与 `cloud` 一致：`available` 只说**服务端视角**（env 兜底 Key 是否存在），
>      前端合成实际能力 = `acceptsClientKey && 本地有 LLM Key`。
>      **纯 BYOK 下 `available` 恒为 `false`** —— 服务端刻意不设文本侧兜底 Key；
>      若前端据此把 ✨ 置灰，就会复刻 V1.6 那个「用户填了 Key 也用不了」的漏洞（§2 V1.8 的教训）。
>   ② **§3**：`LlmConfig` / `PromptEnhanceRequest.llm?` / `PromptEnhanceResponse.engine`（**必填**）与 `notice?`；
>      凭据走请求头 `X-LLM-Key`（§5「凭据传递约定」），**服务端不设兜底 Key**；
>      错误状态映射：未带 Key → **501 `LLM_NOT_CONFIGURED`**、空/超长提示词 → **400 `PROMPT_REJECTED`**、
>      上游拒绝凭据 → **401 `KEY_INVALID`**、其余上游故障（含超时）→ **502 `UPSTREAM_ERROR`**（`retryable`，见 §6 硬规则 2 的 V1.8 收窄）。
>   ③ **§5**：`POST /api/prompt/enhance` 行由"demo 版返回 501"改写为已实现的状态映射。**未新增路由**。
> **V1.9 修订（2026-09-22）**：**§4 新增 `TaskProgress.thumbnailUrl?`**（成片首帧缩略图，画廊封面）。
>   动机是可观测的性能事实：画廊此前对每条历史挂一个 `<video preload="metadata">`，
>   50 条历史 = 50 个媒体元素各发一次请求并解析 moov；被抽成 JPEG 后可懒加载、可缓存。
>   实现口径：**成功出片后**由调度器抽帧落 `outputs/thumbs/<taskId>.jpg`（宽度 480），
>   经既有 `GET /media/*` 服务（**不新增路由**）；**抽帧失败不影响任务成功**（该字段可选），
>   `DELETE /api/history/:taskId` 同时删除成片与缩略图（§7 的磁盘释放口径不变）。
> **V1.8 修订（2026-09-22）**：探针降级与 BYOK 通道定稿（D22 / D23 / D27），文本侧 LLM 配置缺口登记为 V2.0【规划】（D24），三态适用范围收窄（D28）。
>   ① **§2**：`cloud.available` 口径收窄为「服务端视角（仅 env）」；`keySource` 收窄为可选字面量 `'env'`；新增 `acceptsClientKey`（服务端是否接受 `X-Provider-Key`，恒 true，托管场景可关）；`local` 段**删除** `gpuName` / `vramFreeGB`，`tier` 改为可选且语义为「**显式配置并自检通过**的引擎档位」——本端点在 V1.8 起为**纯配置事实陈述**，不含任何自动硬件扫描。
>   ② **§3**：LLM 配置与 `engine` 字段登记为 **V2.0【规划】**；demo 版 `/api/prompt/enhance` 以 `501 LLM_NOT_CONFIGURED` 诚实落地（禁止静默降级 / 规则引擎冒充）。
>   ③ **§5**：路由表新增 `GET /media/*`（`outputs/` 的 Range 静态媒体服务）；`POST /api/providers/keys/verify` 为【规划·B2】，**尚未列入下表、也未实现**（实现时须先在本节登记，避免"修订说明说新增了、表格里没有"这类自相矛盾）。新增「**凭据传递约定**」注记段——`X-Provider-Key` / `X-LLM-Key` 仅走请求头，禁 query / URL / body；服务端**零留存**（不落库、不入日志、不回显）。
>      **补登（S2 落地时）**：`/api/generate`、`/api/tasks/:taskId`、`/cancel`、`/api/history`、`DELETE /api/history/:taskId` 的**响应形状**已随实现补入路由表，类型以 `packages/shared/src/api.ts` 为单一事实源（此前只写语义描述、无形状定义）。
>      **补登（S6 落地时，2026-09-22）**：`/api/upload` 的 `mime` / `size` 语义收紧为「**防线 4 清洗后的产物事实**」（图像会被转码 / 下采样 / 32 倍数规整）；清洗失败与 `.heic`（HEVC 编码，本构建无解码器）均归 **415 `INVALID_ASSET`**。响应形状（`UploadResponseSchema`）不变。
>   ④ **§6**：新增 `LLM_NOT_CONFIGURED` / `KEY_INVALID` / `KEY_MISSING`（均 `terminal`）；**硬规则 2 适用范围收窄**为「有持久副作用的任务型上游」，无副作用调用（文本生成）不适用（D28）。
>   ⑤ **§7**：存储表新增「BYOK Key：**服务端零留存**」一行；「中间帧 / 临时音频」行补 client 本地轨落点（【规划】，见 PLAN §6-D26）。
> **V1.7 修订（2026-09-22）**：新增 §8 `HealthResponse`，补齐 `/api/health` 的响应契约——此前路由表只写「存活探针」而无响应形状定义，`packages/shared` 契约包（PLAN §6-D18）无法为它定义 schema（原为 T2 的施工阻塞点）。
> **V1.6 修订（2026-09-22）**：`ProviderStatus.cloud` 新增 `keySource?: 'env' | 'session'`，并明确 `cloud.available` 的判定语义为「env `VOLCANO_API_KEY` **或** 会话内存中的 BYOK Key 任一存在」——修复「available 仅由 env 驱动 → 前端设置抽屉填入的 Key 无法激活云端轨」的语义漏洞（BYOK 双入口见 GUIDE §二轨道 B）；`available: true` 时 `keySource` 必填，`reason` 需能区分两种缺失/来源情形。
> **V1.5 修订（2026-09-22）**：`ProviderType` 联合类型补入 OI provider（`'stock-local' | 'fixture-local'`），修复「§4 要求 OI 实现同一 `VideoProvider` 接口、但 `id: ProviderType` 闭联合集在类型层面无法承载 OI id」的自相矛盾；OI id 为开发期校验专用，默认关闭，不得出现在产品线能力位。配套 PLAN §6-D18。
> **V1.4 修订（2026-09-22）**：`TaskProgress` 新增 `warnings?: string[]`——用户可见的**非阻断告警**通道（与进度 `message` 职责分离、可并存多条、随任务记录持久化并在画廊展示）。引入原因：可选实现项 OI-1 的「素材短于请求时长 → 循环拉伸」与「循环后音轨静音」会**同时产生两条告警**，单字段 `message` 无法承载（§4、§7）。
> 本规范是前后端接口的**唯一权威**，定义核心数据流：【文本描述 + 参考图/参考视频 → 云端API(火山Seedance) / 本地推理(MiniMax H3) → 视频产出】。
> 任何文档或代码与本文冲突时，以本文为准。
> **V1.3 修订（2026-09-22）**：① 错误码由 `retryable: boolean` 升级为三态 `ErrorDisposition`，新增 `UNCERTAIN_RESULT` 且**禁止自动重提**（§6）；② 新增幂等键与提交前 `submitting` 标记（§5、§7）；③ `VideoGenerateRequest` 新增 provider 私有参数 `options`（§1）；④ 明确可选实现项（OI）的实现边界（§4）。改动同步落 PLAN §3 防线 7 与 §4「Step 2 补充」。

---

## 1. 任务请求契约 `VideoGenerateRequest`

```ts
export type GenerationMode = 't2v' | 'i2v' | 'fl2v' | 'v2v';
export type AspectRatio = '16:9' | '9:16' | '1:1'; // 1:1 仅云端可选，本地 H3 支持度【待验证】
// V1.5：补入 OI provider id。'stock-local' / 'fixture-local' 为开发期校验专用（PLAN §4「Step 2 补充」），
// 默认关闭、不出现在产品线能力位；前端不得为它们硬编码任何分支。
export type ProviderType =
  | 'cloud-volcano-seedance'
  | 'local-minimax-h3'
  | 'stock-local'
  | 'fixture-local';

export interface VideoGenerateRequest {
  // 核心文本描述（可配合 LLM 扩写）
  prompt: string;

  // 生成模式：文生视频 | 首帧图生 | 首尾帧 | 视频参考
  mode: GenerationMode;

  // 参考资产（服务端分配的资产 ID，见 §7 资产生命周期）
  assets?: {
    firstFrameImage?: string;     // i2v 和 fl2v 必需
    lastFrameImage?: string;      // fl2v 专用尾帧
    // v2v 风格/动作迁移参考。⚠️ 【已验证 2026-09-23】上游把视频参考当**另一种元素**处理
    // （`video_url` + 角色 `reference_video`），且**只接受公网 URL、不接受 data URL**
    // （原文：`reference_video must be provided as a web url`）。
    // 因此未配置 `PUBLIC_BASE_URL` 的部署（本地/内网）必须**在提交前**报
    // `INVALID_ASSET`（terminal）并说明去哪配，不得发一个注定 400 的请求。
    //
    // V2.6：取值两种形态 —— ① 上传资产 ID（`/api/upload` 返回的 assetId，原口径）；
    // ② `task:<taskId>` —— 直接引用一条已出片任务（**含剪辑产物**，台账 B37）的成片作为参考。
    // 服务端解析 `task:` 引用：任务不存在 / 无成片 → 404 `TASK_NOT_FOUND`；
    // 解析出的 `/media/<taskId>.mp4` 与上传资产走**同一条**公网 URL 守卫（无 `PUBLIC_BASE_URL` → 提交前 400）。
    referenceVideo?: string;
  };

  // 画面规格（自动对齐为 32 的整数倍）
  aspectRatio: AspectRatio;
  resolution?: {
    width: number;
    height: number;
  };

  // 推理参数
  params?: {
    durationSec?: number;         // 默认 5s，上限 10s（公网部署防线）
    frames?: number;              // 本地 H3 默认 124 帧
    steps?: number;               // 采样步数（默认 50）
    seed?: number;                // 随机种子（-1 表示随机）
    seedLocked?: boolean;         // 是否锁定种子
  };

  // 执行引擎（无卡环境服务端强制覆写为 cloud-volcano-seedance）
  provider: ProviderType;

  // provider 私有参数。仅对声明支持该字段的 provider 生效，
  // 未识别的键必须被忽略而非报错（默认引擎不得因该字段而改变行为）。
  // 用途：承接可选实现项 OI-1（素材）/ OI-2（CI 夹具）的参数，避免污染公共字段。
  //
  // V2.1：**云端的模型与地址也走这里**（BYOK 的一部分），且**优先级高于服务端 env**：
  //   model      —— 上游模型 / 接入点 id（优先级：请求 > VOLCANO_MODEL_NAME > 协议层默认）
  //   baseUrl    —— 上游基址（优先级：请求 > VOLCANO_BASE_URL > 协议层默认）
  //   seedanceResolution / seedanceWatermark —— 云端轨的高级参数
  //   fixtureClip —— OI-2 夹具选片（开发期）
  // 背景：2026-09-23 线上故障正是"请求里的 model 无人消费、被 env 覆盖"导致的 404，
  // 因此"请求优先"这条是**契约级**要求，不是实现细节。
  options?: Record<string, unknown>;

  // V2.11（台账 B47）：任务归属的项目（见 §12）。
  // ⚠️ 这是**我们的元数据**，**不透传给上游**（provider 必须忽略它）。
  // 缺省 = 默认项目（`DEFAULT_PROJECT_ID = 'default'`）；显式给了不存在的项目 → 404 PROJECT_NOT_FOUND。
  // 它**必须进幂等指纹**：否则"同一提示词在两个项目各提交一次"会被去重成同一条任务，
  // 用户在第二个项目里将看不到自己刚提交的东西。
  projectId?: string;
}
```

---

## 2. 算力状态检测契约 `ProviderStatus`

**V1.8 语义（PLAN §6-D22 / D27）**：本端点**不是硬件探针**——它只报告**本服务自身**的配置事实：env 是否提供兜底 Key、本地引擎是否被部署者**显式配置并启用**。它**不扫描硬件**、**不返回任何未经显式配置的硬件信息**，也**不替访问者判断设备能力**（不得出现「你的设备 / 你没有显卡」类文案）。Tier 0~3 已降级为「推荐配置说明」（GUIDE §一），**不参与任何自动锁定或置灰**。

```ts
export type HardwareTier = 0 | 1 | 2 | 3; // 推荐档位定义见 GUIDE.md §一

export interface ProviderStatus {
  cloud: {
    // V1.8：口径收窄为「服务端视角」——仅表示 env 兜底 Key 是否存在。
    // 前端合成实际能力：cloudEffective = cloud.available || (cloud.acceptsClientKey && hasLocalKey())
    available: boolean;
    provider: 'volcano-seedance';
    // V1.8：仅标记服务端来源；available=true 时必填。
    // 客户端持有的 Key 不在本端点表达（状态端点无凭据上下文，见 §5「凭据传递约定」）
    keySource?: 'env';
    // V1.8：服务端是否接受客户端携带的 Key（恒 true；托管场景可置 false 禁用 BYOK）
    acceptsClientKey: boolean;
    // 需能区分「服务端未配置兜底 Key」等**自身**情形；不描述访问者设备
    reason?: string;
  };
  local: {
    available: boolean;
    provider: 'minimax-h3';
    // V1.8：语义 = 部署者显式配置并自检通过的引擎档位；未配置时缺省。
    // 不再是硬件扫描结论，也不得用于"自动锁定/置灰"判定
    tier?: HardwareTier;
    // V1.8：删除 gpuName / vramFreeGB —— 面向访客的端点不得携带硬件型号与显存数字（D27）
    // reason 两类口径（文案纪律见 PLAN §3 铁律 2）：
    //  - 「本服务未配置本地引擎」（未配 env）
    //  - 「本服务未向访客开放本地轨」（EXPOSE_HOST_LOCAL_TRACK=0，默认）
    reason?: string;
  };
  llm: {
    // V2.0：文本轨（提示词扩写）能力位。口径与 cloud 相同：本字段只表示**服务端视角**。
    // 前端合成实际能力：llmEffective = acceptsClientKey && hasLocalLlmKey()
    // ⚠️ 纯 BYOK 下 available 恒为 false（服务端不设文本侧兜底 Key）——
    //    **不得**用它判断"能不能扩写"，否则会复刻 V1.6「填了 Key 也用不了」的漏洞。
    available: boolean;
    provider: 'openai-compatible';
    acceptsClientKey: boolean; // 恒 true；托管场景可置 false 禁用 BYOK
    reason?: string;           // 例：「本服务不提供文本侧兜底 Key（纯 BYOK）」
  };
  defaultProvider: ProviderType; // 初始建议值（V1.8：不再由 Tier 判定推导）
}
```

> **`EXPOSE_HOST_LOCAL_TRACK`（V1.8 新增）**：env 开关，**默认 `0`**。为 `0` 时本地轨对访客不可用（`local.available:false` + 上述第二类 `reason`）；部署者自用需显式置 `1` 并配置 `H3_WORKDIR` / `COMFYUI_BASE_URL`（白名单校验见 PLAN §7-2）。host 本地轨的 scope 与防线落点见 PLAN §6-D26。

---

## 3. 提示词扩写接口契约 `PromptEnhance`

> **V2.0 状态：已实现**（PLAN §6-D24 / 台账 B3，落地见 PLAN §5「V8.3 批次 4」）。
> **纯 BYOK**：凭据走请求头 `X-LLM-Key`，**服务端不设文本侧兜底 Key** ——
> 没带 Key 就是 **`501` + `LLM_NOT_CONFIGURED`**（"没配"的诚实回答），**不得**用任何"规则引擎"冒充 AI（静默降级红线，PLAN §3 铁律 4）。
> **`engine` 是必填字段**：它是"是否静默降级"在测试层面**唯一可证伪**的标记；本实现只可能返回 `'llm'`。

```ts
/** 文本端点配置（请求体可选；缺省回落到 LLM_PRESETS 的第一项） */
export interface LlmConfig {
  preset?: string;   // LLM_PRESETS 的 id，或 'custom'（自定义，无默认值，必须填 baseUrl + model）
  baseUrl?: string;  // 覆盖预设地址（自建代理 / 兼容端点）
  model?: string;    // 覆盖预设模型名
}

export interface PromptEnhanceRequest {
  originalPrompt: string;
  style?: 'cinematic' | 'anime' | 'commercial' | 'realistic';
  mode?: GenerationMode;
  llm?: LlmConfig;   // V2.0：**凭据绝不在此字段**
  recipeId?: string; // V2.2【规划】→ **V9 · B8 已实现**：配方 id（见 §11-1）；服务端把该卡的 `skeleton + pitfalls` 注入 system prompt；**未知 id → 400 PROMPT_REJECTED**（不静默按普通扩写跑）
}

export interface PromptEnhanceResponse {
  enhancedPrompt: string;
  cameraMovementSuggested?: string;
  lightingSuggested?: string;
  engine: 'llm' | 'rules';  // V2.0 必填；本服务只返回 'llm'
  notice?: string;          // 例：「上游返回的不是 JSON，已按纯文本采用」
}
```

**状态映射（本路由的唯一权威口径）**：

| 情形 | HTTP | code | disposition |
|---|---|---|---|
| 请求头无 `X-LLM-Key`（或仅空白） | `501` | `LLM_NOT_CONFIGURED` | `terminal` |
| `originalPrompt` 为空 / 超 `MAX_PROMPT_CHARS`（2000，与 `/api/generate` 共用常量） | `400` | `PROMPT_REJECTED` | `terminal` |
| 自定义预设未填全 `baseUrl` / `model`，或地址非法 | `501` | `LLM_NOT_CONFIGURED` | `terminal` |
| 上游 `401` / `403` | `401` | `KEY_INVALID` | `terminal` |
| 上游其它非 2xx / 超时 / 网络异常 / 空内容 | `502` | `UPSTREAM_ERROR` | `retryable` |

> **为什么超时不是 `UNCERTAIN_RESULT`**：§6 硬规则 2 的适用范围（V1.8 收窄）是
> **有持久副作用的任务型上游**。文本扩写没有副作用、重试不会重复计费，
> 因此按 PLAN §6-D28 归 `UPSTREAM_ERROR`（可重试）。
> **响应与日志中不得出现 Key 明文**：上游错误体常回显 Key，服务端在拼装消息前必须擦除（§5）。

---

## 4. 任务进度与统一 Provider 接口

```ts
export interface TaskProgress {
  taskId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progressPercent: number;        // 0 ~ 100
  currentStep?: number;
  totalSteps?: number;
  message?: string;
  outputVideoUrl?: string;        // 成功后的视频访问直链
                                  // V2.8：**文件不存在时省略该字段**（容量淘汰 / 手动删除后）——
                                  // 与 `outputSizeBytes` 同纪律：不填一个必然 404 的 URL
  thumbnailUrl?: string;          // V1.9：成片首帧缩略图（同源 `/media/thumbs/<taskId>.jpg`），画廊封面用
                                  // 可选：抽帧失败 / 旧记录缺该字段时界面回落为 `<video preload="metadata">`
  warnings?: string[];            // 用户可见的非阻断告警（如"素材短于请求时长，已循环播放"、"循环素材自带音轨，已静音"）
                                  // 与 message（进度描述）职责分离：可并存多条、不随进度刷新被覆盖、随任务记录持久化
  requestSnapshot: VideoGenerateRequest; // 完整请求快照，供画廊一键回填
  createdAt: number;               // V2.3：任务创建时间（epoch ms）——总览"今日生成"与视频库"按时间排序"的数据源
                                   // 直接暴露 `tasks.created_at`（该列与索引本就存在，零迁移）
  outputSizeBytes?: number;        // V2.3：成片字节数（成功且文件仍在磁盘上时，服务端 stat 得出）
                                   // 用途：视频库"按大小排序"、详情抽屉的"文件大小"；
                                   // 文件已被清理时**省略该字段**（不填 0 —— 0 会被读成"空文件"）
  cost?: CostRecord;               // V2.12：成本记录（见 §13）。**只有成功任务在终态结算时写入**；
                                   // 缺省 = 未结算（V2.12 之前的老任务 / 无法估算的任务）——
                                   // "不知道花了多少"与"花了 0 元"（本地轨）必须能分开，故不给默认值 0
  error?: {
    code: ErrorCode;              // 见 §6 错误码字典
    message: string;
    disposition: ErrorDisposition; // 见 §6；'uncertain' 时禁止任何自动重提
  };
}

export interface VideoProvider {
  readonly id: ProviderType;
  readonly name: string;
  checkHealth(): Promise<{ available: boolean; reason?: string }>;
  submit(req: VideoGenerateRequest): Promise<{ taskId: string }>;
  queryStatus(taskId: string): Promise<TaskProgress>;
  cancel(taskId: string): Promise<boolean>;
}

/**
 * V2.3：`GET /api/history` 响应里的**输出目录聚合**（不是逐条累加——老数据同样准确）。
 * 对账口径：与 `du -sb outputs/` 一致（成片 + 缩略图 + 参考资产）。
 * 实现：`backend/src/server/storageUsage.ts`（只读扫描，可选 5s 缓存）。
 */
export interface StorageUsage {
  totalBytes: number;   // 三项之和
  videoBytes: number;   // 成片（`outputs/*.mp4`）
  videoCount: number;
  thumbBytes: number;   // 缩略图（`outputs/thumbs/*.jpg`）
  assetBytes: number;   // 参考资产（`outputs/assets/*`）
  assetCount: number;
}

/**
 * V2.7：`GET /api/assets` 的条目与响应（B41 `@` 提及素材弹层的枚举能力）。
 * 与上传响应同一口径：`mime` / `size` 是**落盘产物事实**（含抽帧产物——同目录同规则）；
 * `url` 为同源 `/media/assets/<文件>` 直链；`createdAt` = 文件 mtime（epoch ms）。
 * **V2.9（台账 B43）**：新增可选 `name` —— 用户原始文件名的 sanitize 结果
 * （来自 `<assetId>.json` sidecar；抽帧产物没有该字段）。它**只落本地**，见 §5 与 §7。
 * **V2.10（台账 B57）**：`kind` 扩 `audio`；kind **优先读 sidecar**（上传时由 ffprobe 判定），
 * 无 sidecar 时按容器嗅探兜底（`audio/*` → audio、`video/*` → video）。
 * 实现：`backend/src/routes/assets.ts`（目录扫描 + sidecar 优先 + 魔数嗅探兜底，只读）。
 */
export interface AssetListEntry {
  assetId: string;
  kind: 'image' | 'video' | 'audio';
  mime: string;
  size: number;
  url: string;
  createdAt: number;
}
export interface AssetListResponse {
  assets: AssetListEntry[];   // 最近 200 个，新的在前；目录不存在 → []
}
```

> **可选实现项（OI）的实现边界**：`stock-local`（素材）与 `fixture-local`（CI 夹具）**必须实现与上面完全相同的接口**，不得新增专属请求字段、不得改变接口形状、不得要求调用方分支判断；其私有参数一律走 `options`。注册点为 `providers/registry.ts`，默认关闭（env `ENABLE_STOCK_PROVIDER`），能力位由 `GET /api/providers/status` 下发——前端不得硬编码具体 provider。详见 PLAN §4「Step 2 补充」。

---

## 5. 前后端 REST API 路由（唯一路由权威）

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| `GET` | `/api/health` | 存活探针（响应形状见 §8；**任何来源**均免鉴权，见 PLAN §7-4） |
| `GET` | `/api/providers/status` | **本服务本地引擎配置状态**（V1.8：纯配置事实陈述，非硬件探测；**旧名 `/api/system/probe` 已废弃**） |
| `GET` | `/media/*` | **V1.8 新增**：`outputs/` 静态媒体服务（成片直链，播放器与下载的 **206 Range** 载体）；路径只含服务端生成的随机 ID，不含任何用户输入 |
| `POST` | `/api/generate` | 创建视频生成任务（凭据经 `X-Provider-Key`，见下方注记段）。**200 → `{ taskId }`**（幂等：同一 `Idempotency-Key` 或缺省指纹重复提交返回同一 `taskId`）；提示词为空或超过 2000 字符 → **400 `PROMPT_REJECTED`**（terminal）；引擎未实现 / 未启用 → **503 `PROVIDER_UNAVAILABLE`**；60s 防抖限流 → 429。**V2.11（B47）**：body 可带可选 `projectId`（缺省 = 默认项目）；**显式给了不存在的项目 → 404 `PROJECT_NOT_FOUND`**（不静默落到默认项目）；`projectId` 进幂等指纹 |
| `GET` | `/api/tasks/:taskId` | 轮询任务状态与结果。**200 → `TaskProgress`（§4）**；不存在或已清理 → **404 `TASK_NOT_FOUND`** |
| `POST` | `/api/tasks/:taskId/cancel` | 取消任务（仅 `queued` / `running` 可取消；已在终态 → `{ ok: false }`）。**200 → `{ ok, taskId }`**。语义是**尽力而为**：服务端把任务置 `cancelled`（此后调度器**不再推进**、也不会被 heartbeat 覆盖），并**通知上游停止**；上游是否真的停止、是否已产生费用，本服务无法代上游保证 —— 前端文案必须如实说明并指向服务商后台核对 |
| `POST` | `/api/prompt/enhance` | 提示词扩写助手（**V2.0 已实现**，凭据经 `X-LLM-Key`，见下方注记段）。**200 → `PromptEnhanceResponse`（§3，含必填 `engine`）**；无 Key → **501 `LLM_NOT_CONFIGURED`**；空 / 超长提示词 → **400 `PROMPT_REJECTED`**；上游拒绝凭据 → **401 `KEY_INVALID`**；其余上游故障（含超时）→ **502 `UPSTREAM_ERROR`**。状态映射的完整口径见 §3 |
| `POST` | `/api/upload` | 上传参考图/视频/**音频**（multipart，**V2.6 起** ≤100MB × ≤4（**V2.10 起音频 ≤20MB**），**按魔数嗅探判定类型**、不信任 `Content-Type`）：**200 → `{ assets: [{ assetId, kind, mime, size }] }`**——**图像须过防线 4 清洗网关**，返回的 `mime` / `size` 因此是**清洗后的产物事实**（HEIC/WebP → JPEG、带透明通道保 PNG；视频原样落盘），不是客户端声明的类型；超体积 / 超数量 → **413**；白名单外 / 伪造类型 / **清洗失败**（含 `.heic` 的 HEVC 编码——按实测能力诚实拒绝）→ **415 `INVALID_ASSET`**（细则见 PLAN §7-6 与 §5 的 S6 条目）。**V2.9**：落一份 sidecar `<assetId>.json`（`{ name?, uploadedAt }`）—— `name` = 用户原始文件名的 **sanitize 结果**（`basename` + 去控制字符 + 截断 120 字符），**只落本地**：不进上游请求、不进操作日志、不进任务快照；写失败不阻断上传（元数据是增强，不是事实源）。**V2.10（B57）**：白名单新增 **mp3 / wav / m4a**（`audio/mpeg` / `audio/wav` / 容器为 `video/mp4` 的纯音频文件），音频体积上限 **20MB**（`MAX_AUDIO_BYTES`，超限 413）、**原样落盘**（不走防线 4 图像清洗）；判 `audio` 的口径 = 容器嗅探 + **ffprobe 流类型复核**（见上「V2.10 修订」①，容器嗅探对 m4a 不可靠）；sidecar 增**可选** `kind`（`image`/`video`/`audio`，供 `/api/assets` 免探测复读）。**V2.11（B47）**：新增可选 multipart 字段 `projectId`（缺省 = 默认项目）→ 写进 sidecar 的项目归属；**显式给了不存在的项目 → 400 `INVALID_REQUEST` + 撤回本次已落盘的媒体文件**（不留孤儿）。⚠️ 字段可能在文件之后到达（multipart 顺序由客户端决定），因此 sidecar **统一在字段读完后写**（不支持"边收边写"会产生"资产在 A 项目、sidecar 写着默认项目"的错位） |
| `GET` | `/api/assets` | **V2.7 新增**：**资产库清单（只读）**。**200 → `AssetListResponse`（§4 末尾）**（最近 200 个，新的在前；`mime` 为**魔数嗅探事实**，与 `/api/upload` 同口径；`url` 为同源 `/media/assets/<文件>` 直链；`createdAt` = 文件 mtime）。**V2.9**：条目新增可选 `name`（来自 sidecar；抽帧产物没有原始文件名 → 无该字段），弹层据此"按名字认素材"。**目录不存在**（从未上传过）→ 200 + 空数组，**不是 404**。用途：`@` 提及素材弹层（B41）与后续资产管理视图；不改变任何生命周期与清理规则（见 §7）。**V2.10（B57）**：`kind` 扩展为 `image|video|audio` —— **优先读 sidecar 的 `kind`**（上传时已由 ffprobe 算准，免去逐文件探测），sidecar 缺失 / 无该字段时按容器嗅探兜底（`audio/*` → audio、`video/*` → video；**不猜**——老资产与抽帧产物走这条，其中 `.m4a` 老资产会被兜底判为 video，属如实边界）。**V2.11（B47）**：条目新增**必填** `projectId`（sidecar 的 `projectId` 缺失即默认项目 —— 如实归属，不猜）；可选 `?project=<projectId>` 过滤，**省略 = 默认项目**（与 `/api/history` 同口径） |
| `GET` | `/api/costs/summary` | **V2.12 新增（台账 B48）**：**成本台账汇总（只读）**。`?project=` —— **省略 = 默认项目**（与 `history` / `assets` 同口径）、字面量 **`all` = 跨项目汇总**（唯一刻意允许跨项目的读端点）；`?from=` / `?to=`（epoch ms，含端点）。**200 → `CostSummaryResponse`（§13）**：项目 / 按天 / 按模型三个维度的桶 + `uncertainCount`（`disposition='uncertain'` 的条数，**可能已产生费用**）+ `unsettledCount`（成功但无成本记录）+ `budget`（仅 `all` 档且配了 `MONTHLY_BUDGET_YUAN` 时非 null）+ `disclaimer`。**金额是预估**（公开价目 × 上游计费式），口径见 §13。扫描上界 20000 行，触界时 `truncated: true`（此时金额只是**部分之和**）；查询参数非法 → **400 `INVALID_REQUEST`**；无新错误码 |
| `GET` | `/api/projects` | **V2.11 新增（台账 B47）**：**项目清单（含用量）**。**200 → `ProjectListResponse`（§12）** —— 默认项目永远在列表里且排最前。`taskCount` 走 SQL、`assetCount` 读资产 sidecar 的项目归属（与 `/api/assets` 同一口径）。用途：项目切换器、项目级用量视图 |
| `POST` | `/api/projects` | **V2.11 新增**：新建项目（body `{ name }`，1~60 字符）。**200 → `{ project: ProjectEntry }`**（id 为服务端生成的 UUID）；名字为空 → **400 `INVALID_REQUEST`**；**重名 → 400 `INVALID_REQUEST`**（切换器里两个同名项目认不出来，这是可用性问题不是洁癖） |
| `PATCH` | `/api/projects/:projectId` | **V2.11 新增**：改项目名（body `{ name }`）。**200 → `{ project: ProjectEntry }`**；不存在 → **404 `PROJECT_NOT_FOUND`**；空名 / 重名 → **400 `INVALID_REQUEST`** |
| `DELETE` | `/api/projects/:projectId` | **V2.11 新增**：删除**空**项目。**200 → `{ deleted: true, projectId }`**；不存在 → **404 `PROJECT_NOT_FOUND`**；**默认项目 → 400 `INVALID_REQUEST`**（它是老数据与"未指定项目"的落点）；**项目非空 → 400 `INVALID_REQUEST`**（本项目**不做级联删除** —— 那会把任务与资产变成孤儿） |
| `GET` | `/api/webhooks` | **V2.15 新增（台账 B51 片 A）**：**Webhook 订阅清单**（只读）。`?project=` —— **省略 = 默认项目**（与全站同口径）；项目不存在 → **404 `PROJECT_NOT_FOUND`**。**200 → `{ webhooks: WebhookView[] }`** —— **永远不含明文 secret**（只有 `secretMasked`，形如 `whsec_01…cdef`）。用途：客户系统自检"我的订阅还在不在" |
| `POST` | `/api/webhooks` | **V2.15 新增**：新建订阅（body `{ projectId?, url, secret?, events? }`）。**201 → `{ webhook: WebhookView, secret }`** —— ⚠️ **明文 `secret` 只在这唯一一次响应里出现**（之后任何接口都只有掩码），客户必须自己存好；省略 `secret` 由服务端生成（推荐，手填弱 secret 是这条链路上最容易出的安全问题）；`events` 省略 = `['task.terminal']`。**URL 过 SSRF 准入**（只允许 http/https、不许带用户名密码、**默认拒绝环回 / 私网 / 链路本地 / 云元数据**，理由见 §15）→ 不通过 **400 `INVALID_REQUEST`**（文案含"部署者设 `WEBHOOK_ALLOW_PRIVATE=1` 可放行"）；项目不存在 → **404 `PROJECT_NOT_FOUND`** |
| `PATCH` | `/api/webhooks/:webhookId` | **V2.15 新增**：改地址 / 启停（body `{ url?, enabled? }`，至少给一项）。**200 → `{ webhook: WebhookView }`**（同样**不回显**明文 secret）；订阅不存在 → **404 `WEBHOOK_NOT_FOUND`**；新 URL 不过 SSRF 准入 → **400 `INVALID_REQUEST`** |
| `DELETE` | `/api/webhooks/:webhookId` | **V2.15 新增**：删订阅（**连带删掉它的投递流水** —— 留着一堆指向已删订阅的记录会让人以为"还有回调在跑"）。**200 → `{ deleted: true }`**；不存在 → **404 `WEBHOOK_NOT_FOUND`** |
| `GET` | `/api/webhooks/:webhookId/deliveries` | **V2.15 新增**：**投递流水**（最近 N 条，`?limit=` 1~200，默认 50）。**200 → `{ deliveries: WebhookDeliveryView[] }`**（`status` / `attempts` / `lastStatusCode` / `lastError` / `nextAttemptAt` / `deliveredAt`）—— 它是"客户到底收到没有"的唯一证据，也是排错入口。**空列表是 200 而不是 404**（订阅存在但还没到终态任务）；订阅不存在 → **404 `WEBHOOK_NOT_FOUND`** |
| `GET` | `/api/health/live` | **V2.16 新增（台账 B53）**：**存活探针**（与 `/api/health` **同语义**，新路径为了与 ready 成对）。**任何来源免鉴权**（编排器的 livenessProbe 不会带 Bearer）。**零依赖**：不碰数据库、不扫目录 —— 探针若在依赖故障时也变慢/失败，编排器会把"数据库卡住"当成"进程死了"并重启，把一次依赖故障放大成服务不可用。**200 → `HealthLiveResponse`（§16）** |
| `GET` | `/api/health/ready` | **V2.16 新增**：**就绪探针**（进程活着 ≠ 能干活）。检查项：数据库可读、输出目录**真写一次**、容量余量、媒体工具（见 §16）。**需鉴权**（回环免；它暴露部署内部细节 —— 探针自己带 `Authorization: Bearer <PUBLIC_API_TOKEN>`）。`required` 检查失败 → **503**（响应体**照样**给完整 `checks`：排错要看原因，不是只看状态码）；**非 required** 失败（ffmpeg 缺失、容量接近阈值、凭据未配）**不降级** —— BYOK / 纯云端部署下它们不影响力 |
| `GET` | `/api/metrics` | **V2.16 新增**：**运维快照**（任务按状态 / 队列积压 / 存储 / 数据库体积 / Webhook 投递 / 告警 / 生效阈值）。**需鉴权**（回环免）。**200 → `MetricsResponse`（§16）**。⚠️ 它含**一次目录扫描**（毫秒级，本项目规模下），因此**不做服务端自动轮询** —— 调用方自己决定频率（建议 15~60s）。无新错误码 |
| `GET` | `/api/history` | 历史视频列表（含完整参数快照用于回填）。**200 → `{ items: TaskProgress[], storage: StorageUsage }`**（`items` 最近 50 条；**V2.3 起**每条含 `createdAt` / `outputSizeBytes?`，响应另带 `storage` 目录级聚合，形状见 §4 末尾）。**V2.4 起**：默认只返回**生成产物**（剪辑产物不进历史，避免提示词与源片相同造成的"重复"观感）；查询参数 `?kind=edit`：**V2.6 起 `source` 可选** —— 带 `source=<taskId>` 返回某源片的剪辑产物（剪辑台"本片剪辑历史"用）；**不带 `source` 返回全部剪辑产物**（剪辑台素材候选 / L2 血缘画布用，同样受最近 50 条上限约束）。**V2.11（B47）**：可选 `?project=<projectId>` —— **省略 = 默认项目**（不是"全部项目"：界面的心智模型是"我在哪个项目里"）；`storage` 聚合仍是**目录级全局**（它描述磁盘，不描述项目） |
| `DELETE` | `/api/history/:taskId` | 删除单条历史并**释放磁盘**。**200 → `{ ok, taskId }`**；不存在 → 404 `TASK_NOT_FOUND` |
| `POST` | `/api/providers/keys/verify` | **V2.1 新增（原【规划·B2】）**：凭据与模型校验，**零费用**。请求头按轨取（视频 `X-Provider-Key` / 文本 `X-LLM-Key`）；**200 → `KeyVerifyResponse`（§9）**；未带 Key → **501 `KEY_MISSING`**；凭据被上游拒绝 → **401 `KEY_INVALID`**；上游不可达 → **502 `UPSTREAM_ERROR`**；**V2.8 起**：独立限流桶 `verify`（同一来源 IP **10 秒内最多 5 次**，内存突发窗口）→ 429 `RATE_LIMITED` + `Retry-After`。为什么：本端点**会向上游发真实请求**（`/models` + 空 content 探针），没有限流时被刷等于把部署者的服务器当免费探针——与生成任务的 60s 冷却（防线 5）分开计桶，互不影响。**为什么是"窗口 N 次"而不是"最小间隔"**：间隔语义会误伤正常交互（连点两次"测试连接"切轨道验证），窗口语义对"人"无感、对"脚本"生效；它是底线防护，真正的防线仍是 Caddy 登录 + `PUBLIC_API_TOKEN` |
| `GET` | `/api/logs` | **V2.1 新增**：操作日志查询（筛选 + 分页，见 §10）。**200 → `{ items, total }`**；**V2.8 起**：独立限流桶 `logs`（同一来源 IP **10 秒内最多 30 次**，内存突发窗口）→ 429 `RATE_LIMITED` + `Retry-After`。为什么：日志页挂载 + 轮询 + 连续筛选的请求量远低于该配额（正常使用**完全无感**），但脚本级高频扫描会被挡住（读接口也要有一道底线）；同样独立计桶。**两个 DELETE 刻意不挂桶**（写操作、频率天然低，避免误伤"连续手删"） |
| `DELETE` | `/api/logs/:id` | **V2.1 新增**：删单条日志。**200 → `{ ok, deleted }`**（删除不存在的条目**不是错误**：DELETE 幂等，`deleted: 0`） |
| `DELETE` | `/api/logs` | **V2.1 新增**：按当前筛选清空日志（不带筛选即全清）。**200 → `{ ok, deleted }`** |
| `POST` | `/api/edits` | **V2.2【规划】→ V9 · B9 已实现（V2.5 起降为 API-only，UI 不再暴露）**：基础剪辑 EDL（本地 ffmpeg，**零上游调用**、**不走防线 5 冷却**）。**200 → `{ taskId }`**（复用 §4 的 `GET /api/tasks/:taskId` 轮询与画廊；任务走 `local` 轨 = 本地互斥 1）；操作序列非法（含 `endSec ≤ startSec`、连续两次拼接、转场未跟在拼接之后）→ **400 `INVALID_REQUEST`**；源任务不存在 / 无成片 / 拼接素材不可用 → **404 `TASK_NOT_FOUND`**；ffmpeg 缺失 → **503 `PROVIDER_UNAVAILABLE`**。完整契约见 §11-3 |
| `POST` | `/api/edits/renders` | **V2.5 新增**：**浏览器端渲染产物入库**（B34 剪辑台改版）。multipart 字段：`file` = 渲染出的 MP4、`sourceTaskId` = 本次剪辑的源片、`project` = 多轨工程 JSON。服务端**不做任何渲染**（渲染在用户浏览器完成），只做校验与归档：产物落 `outputs/<taskId>.mp4` → 成为一条 `status:'succeeded'` 的剪辑任务（`origin.kind='edit'` + `origin.project`）并抽封面。**200 → `{ taskId }`**；工程 JSON / 字段不合法 → **400 `INVALID_REQUEST`**；源任务不存在或无成片 → **404 `TASK_NOT_FOUND`**；文件非 MP4（魔数嗅探）→ **415 `INVALID_ASSET`**；**> 100MB（V2.6 起，原 20MB）** → **413**（与 `/api/upload` 同口径，也受反代请求体上限约束，见 §11-2） |

**幂等键与「即将提交」标记（V1.3 新增）**：
- `POST /api/generate` 必须接受幂等键（请求头 `Idempotency-Key`；缺省时服务端按 `provider + 请求指纹` 生成）。同一幂等键重复提交返回**同一 `taskId`**，不得产生第二次上游调用。
- 服务端在**真正向上游提交之前**先落库一条 `submitting` 标记，提交成功后写回上游 `taskId`。进程重启或网络中断后，凭该标记即可判定「到底提交出去没有」。
- 这是 §6 `UNCERTAIN_RESULT` 与 PLAN §3 防线 7 能够落地的**前提**：没有 `submitting` 标记，就无法区分「没提交」与「提交了但不知道结果」。

**凭据传递约定（V1.8 新增，决策 PLAN §6-D23）**：
- **唯一载体是请求头**：视频轨 `X-Provider-Key`、文本轨 `X-LLM-Key`（**V2.0 起已启用**，两条轨的 Key **相互独立**，前端可一键复用但服务端始终分别读取）。**禁止**出现在 query、URL path、body 或 cookie 中。
- **服务端零留存**：只用不存——不落 SQLite、不写日志（pino `redact` 必须覆盖相应请求头）、不回显明文；错误响应也必须保证不含 Key 片段。日志或响应中出现 Key 明文 = **发布级缺陷**。
- **状态端点不表达客户端凭据**：`GET /api/providers/status` 无凭据上下文，其 `cloud.available` 只表示 env 兜底 Key 是否存在；"前端是否持有 Key"由前端自行合成（§2 的 `acceptsClientKey` + 本地存储）。
- **写入 / 清除无服务端路由**：Key 存于浏览器，清除即清本地存储。凭据校验路由（`keys/verify`）已于 **V2.1 实现**（见 §9）；本地引擎运行时自检（`local/verify`）**仍未实现**，属 PLAN §9 台账 **B4**；实现时必须先在本节登记。
- `Idempotency-Key` 与上述两个凭据头一样，必须在 CORS `allowedHeaders` 中显式放行，否则浏览器预检直接失败（本地 curl 通、浏览器必失败）。
- **访问鉴权（V1.8 补充口径，细则见 PLAN §7-4）**：公网部署时，除「**回环来源**（127.0.0.1 / ::1）的全部请求」与「**任何来源**的 `/api/health`」两层免鉴权外，**其余全部路径**（含 `/api/*`、`/media/*` 与前端产物 `/`）一律要求 `Authorization: Bearer <PUBLIC_API_TOKEN>`——钩子是全局 `onRequest`，线上由 Caddy 把站点登录凭据换成 Bearer。鉴权未通过返回 **401**。

**通信方式**：MVP 使用轮询（`GET /api/tasks/:taskId`，建议 2s 间隔）；SSE 实时推送为【规划】，Step 4 后评估（决策记录 PLAN §6-D7）。

---

## 6. 错误码字典 `ErrorCode` 与三态处置 `ErrorDisposition`

```ts
// V1.3：由 retryable: boolean 升级为三态。所有错误分支必须可归入其中之一，不允许"视情况而定"。
export type ErrorDisposition =
  | 'retryable'   // 可安全自动重试：重试不会产生副作用
  | 'terminal'    // 终态失败：重试无意义，需用户改参数或换引擎
  | 'uncertain';  // 不确定：已可能产生上游副作用，禁止自动重提，必须人工核对
```

| code | 触发场景 | disposition |
| :--- | :--- | :--- |
| `PROVIDER_UNAVAILABLE` | 所选引擎健康检查失败（如无卡选本地） | `terminal`（换引擎） |
| `GPU_BUSY` | 本地队列已有任务在执行 | `retryable`（自动排队，无需手动重试） |
| `RATE_LIMITED` | 60s 防抖窗口内重复提交 | `retryable`（等待冷却） |
| `INVALID_ASSET` | 资产格式无法清洗 / 32 倍数规整失败 | `terminal` |
| `PROMPT_REJECTED` | 提示词为空 / 超长 / 台词超长引导未确认 | `terminal` |
| `UPSTREAM_ERROR` | 上游**明确返回**错误（4xx/5xx 响应体可读） | `retryable`（有限次退避后转 `terminal`） |
| `UNCERTAIN_RESULT` | 已提交但无法确认结果：轮询中断 / 进程重启 / 上游超时无响应 | **`uncertain`（禁止自动重提）** |
| `TASK_NOT_FOUND` | taskId 不存在或已清理 | `terminal` |
| `DISK_FULL` | 输出目录磁盘不足 | `terminal`（清理后手动重试） |
| `LLM_NOT_CONFIGURED` | 扩写未配置 LLM（V2.0 起：请求未携带 `X-LLM-Key`，或自定义端点没配全 → `/api/prompt/enhance` 返回 `501`；服务端**不设**文本侧兜底 Key，见 §3） | `terminal` |
| `KEY_INVALID` | 凭据被上游拒绝（真实调用与 `POST /api/providers/keys/verify` 两处产生，见 §9） | `terminal` |
| `KEY_MISSING` | 需要凭据的端点既未收到 `X-Provider-Key`，服务端也无 env 兜底 Key（也用于访问令牌缺失） | `terminal` |
| `PROJECT_NOT_FOUND` | **V2.11 新增（台账 B47）**：请求显式指定的 `projectId`（正文 / 查询参数）在项目表里不存在。用于 `POST /api/generate` 与 `PATCH` / `DELETE /api/projects/:projectId`。**刻意不静默落到默认项目** —— 那会让用户在"默认项目"里看到本不属于它的东西，而他以为自己选中的项目并没有接住这条任务 | `terminal`（改 id 或先建项目） |
| `WEBHOOK_NOT_FOUND` | **V2.15 新增（台账 B51）**：`/api/webhooks/:webhookId` 系列指定的订阅不存在（含"刚被删"）。**刻意不静默 200** —— 客户系统据此知道配置已被删（否则它会一直以为回调还在生效） | `terminal`（改 id 或重新创建订阅） |
| `INVALID_REQUEST` | **V2.3 登记（V9 · B9 落地时补齐）**：请求**形状合法但值/组合不合法** —— 如剪辑台 `endSec ≤ startSec`、连续两次「拼接」、转场未跟在拼接之后。⚠️ 本码在 V2.2 的 §11-2 里就被引用过，但当时**没有登记进本字典**（契约内部不自洽）；B9 实现时按"契约优先且必须自洽"补齐，契约测试的双向校验（实现 ↔ 文档）会一直盯着这件事 | `terminal` |

**V1.3 三条硬规则**：

1. **`uncertain` 是唯一必须人工核对的分支**。任何自动重试都可能造成上游**重复计费**。前端必须提示「**可能已产生费用，请到服务商后台核对后手动处理**」，并提供「标记为已核对 / 放弃任务」动作（Step 3 落地）。
2. **适用范围（V1.8 收窄，决策 PLAN §6-D28）**：本规则仅适用于**有持久副作用的任务型上游**（视频生成、素材下载）。对**无副作用调用**（文本生成 / LLM 扩写等，重试不产生重复计费）**不适用**——此类调用的超时 / 断连一律归 `UPSTREAM_ERROR`（`retryable`），不得归 `UNCERTAIN_RESULT`。
   在适用范围内：**上游无响应 / 超时一律归 `UNCERTAIN_RESULT`，不得归入 `UPSTREAM_ERROR`**；后者仅用于上游**明确返回**错误响应的场景——这条区分是三态护栏能否生效的关键。
3. 三态与 PLAN §3 **防线 7（付费不确定性不自动重提）**配套，二者改动必须同时进行。

---

## 7. 存储与资产生命周期（PLAN §6-D5 的落地细则）

| 数据 | 存储 | 生命周期 |
| :--- | :--- | :--- |
| 任务状态 + 参数快照 + 画廊元数据 | SQLite（`data/app.db`，better-sqlite3） | 持久，服务重启可恢复 |
| **项目（V2.11 落地，台账 B47）** | SQLite（同上）：`projects(project_id, name, created_at, updated_at)`；任务归属 = `tasks.project_id` | **默认项目 `default` 由启动引导保证存在**（`bootstrapProjects`：`INSERT ... ON CONFLICT DO NOTHING`），并**回填** `project_id IS NULL` 的老行为 `default`（幂等，每次启动跑一次）。删除只允许**空项目**且**默认项目不可删**（§5 / §12）；**不做级联删除** —— 任务与资产不随项目消失 |
| 幂等键 → taskId 映射 | SQLite（同上） | 持久；同一键重复提交返回同一任务（§5） |
| 任务告警 `warnings[]` | SQLite（同上） | 随任务记录持久化，画廊 / 结果卡展示（V1.4 §4）；**仅写服务端日志不算告警** |
| `submitting` 提交标记 | SQLite（同上） | 提交前写入、成功后写回上游 taskId；重启后据此判定是否已提交（§5，防线 7 前提） |
| 成片 MP4 | `outputs/`（已入 .gitignore） | **前端一键删除释放磁盘**（`DELETE /api/history/:taskId`）；**V2.8 起容量淘汰（LRU）已落地**，见下一行 |
| **容量淘汰（V2.8 落地，台账 B22）** | 后台扫描 `outputs/`（`server/storageEvict.ts`，默认每 5 分钟一次 + 启动时一次） | **触发**：`totalBytes`（成片 + 缩略图 + 参考资产）超过 `OUTPUTS_MAX_BYTES`（默认 4GiB，env 可调）；**目标水位**：淘汰到 `OUTPUTS_TARGET_RATIO`（默认 0.8）以下即停。**淘汰顺序**：最旧的**已成功**任务先淘汰（只删 `outputs/<taskId>.mp4` 与 `outputs/thumbs/<taskId>.jpg` 两个文件，**保留任务记录**——画廊显示"成片已清理"、血缘画布显示 ghost，历史与血缘不因此断裂）。**三类保护规则**：① `queued/running/submitting` 的任务不淘汰（正在用）；② 被其它任务以 `task:<taskId>` 引用当参考的成片不淘汰（否则"参数一键回填"再提交会 404）；③ **参考资产（`outputs/assets/`）不参与容量淘汰**（体积小且属用户数据，只在任务删除时按既有保护规则清理）。每次淘汰后写一条 `storage.evict` 操作日志（§10） |
| 成片缩略图（V1.9） | `outputs/thumbs/<taskId>.jpg` | 成功出片后由调度器抽首帧生成（宽度 480，`/media/thumbs/...` 直链）；**尽力而为**：抽帧失败只记日志，任务仍为 `succeeded`；随任务删除一并物理删除 |
| 上传的参考资产 | `outputs/assets/<assetId>.<jpg\|png\|mp3\|wav\|m4a>` | 关联任务删除时一并清理（`DELETE /api/history/:taskId`）；**保护规则**：若该 `assetId` 仍被其它任务引用（「参数一键回填」会复用资产），则只删任务、保留资产 —— 否则会毁掉另一条任务的参考图。扩展名由防线 4 的清洗结果决定，因此按 `<assetId>.` 前缀匹配删除。**V2.7**：可由 `GET /api/assets` **只读列举**（含抽帧产物——它与上传资产同目录同规则）；列举不改变上述任何清理规则。**V2.9**：每个上传资产可带一份 sidecar `outputs/assets/<assetId>.json`（原始文件名 + 上传时间）；它**天然被同一条 `<assetId>.` 前缀规则覆盖**（删资产即删 sidecar、不新增清理路径），也不参与容量淘汰（与资产同规则）。**V2.10**：扩展名补 `.mp3` / `.wav` / `.m4a`（音频素材，台账 B57）—— 与参考资产**完全同规则**：同一 `<assetId>.` 前缀清理、不参与容量淘汰；sidecar 增可选 `kind`（`/api/assets` 免探测复读，见 §5） |
| 中间帧 / 临时音频 | host 轨：`outputs/.tmp/<taskId>/`；client 轨（【规划】，PLAN §6-D26）：落在用户机器、由 worker 清理 | 合成结束立即物理删除（防线 3）；client 轨须回报 `tmpCleaned` 并写入 `warnings[]`，服务端无法强制验证该事实 |
| **Webhook 订阅与投递流水（V2.15 落地，台账 B51）** | SQLite（同上）：`webhooks(webhook_id, project_id, url, secret, enabled, events, created_at, updated_at)` + `webhook_deliveries(delivery_id, webhook_id, task_id, event, status, attempts, last_status_code, last_error, next_attempt_at, delivered_at, created_at, updated_at)`；唯一索引 `(webhook_id, task_id, event)` | **订阅的 `secret` 落库**（服务端要它签 HMAC）但**永不回读**：只有创建响应给一次明文，其余接口只有掩码（§15）。删订阅**连带删它的投递流水**（不留指向已删订阅的记录）。流水**不做自动清理**（与操作日志同策略：量小、排错要靠它；若要清理另立台账） |
| **BYOK Key（`X-Provider-Key` / `X-LLM-Key`）** | **服务端零留存（无此数据）** | V1.8：仅存在于单次请求的内存上下文；不落库、不入日志、不回显（见 §5「凭据传递约定」）；env 兜底值由部署者自管 |
| 前端任务 ID 锚点 | 浏览器 `localStorage` | 刷新后凭 ID 向服务端重挂载进度 |

---

## 8. 辅助响应类型 `HealthResponse`

```ts
// V1.7：/api/health 的响应形状。此前路由表仅写「存活探针」而无响应契约，
// shared 契约包（PLAN §6-D18）无法为它定义 schema——本节补齐该缺口。
export interface HealthResponse {
  status: 'ok';
  name: string;        // 服务标识，如 'AstrmiraVideo Backend'
  version: string;     // 服务版本号
  timestamp: string;   // ISO 8601
}
```

> 该类型同样以 `packages/shared` 的 zod schema 为唯一事实源（`HealthResponseSchema`），本节代码块为文档投影。
>
> **⚠️ 语义澄清（V2.16 / 台账 B53）**：`/api/health` 是**存活（liveness）**探针 ——
> 它**刻意不检查任何依赖**（不碰数据库、不扫目录），只要进程能响应就返回 `ok`。
> "能不能干活"由 **`/api/health/ready`** 回答（见 §16）；两者不要混用：
> 把依赖检查塞进存活探针，会让"数据库卡住"被编排器读成"进程死了"并触发重启。

---

## 9. 凭据与模型校验 `POST /api/providers/keys/verify`（V2.1 新增）

**它解决什么**：2026-09-23 的线上故障里，用户是**花了一次真实提交**才拿到"模型不存在"（上游 404）。
"Key 行不行 / 模型在不在 / 有没有开通"这三件事本可以在提交之前零成本回答。

```ts
export type KeyVerifyTrack = 'video' | 'text';

export interface KeyVerifyRequest {
  track: KeyVerifyTrack;
  model?: string;    // 待校验的模型 / 接入点 id（缺省时只校验凭据本身）
  baseUrl?: string;  // 覆盖端点（自建代理 / 兼容端点）
  preset?: string;   // 文本轨预设 id（与 LLM_PRESETS 同一套）
}

export interface KeyVerifyResponse {
  keyValid: boolean;
  totalModels: number | null;    // 上游 /models 返回的模型总数；端点不提供时为 null
  modelListed: boolean | null;   // 是否出现在该清单里（存在 ≠ 已开通）
  modelAvailable: boolean | null; // **能不能用**：true 可用 / false 不存在或未开通 / null 未探测
  message: string;               // 一句话结论（成功与失败都必须能直接照做）
}
```

**两条探测路径（都要求"零费用"，这是硬约束）**：

| 轨 | 探测 | 判据 |
| :--- | :--- | :--- |
| 视频 | ① `GET {baseUrl}/models`；② `POST {baseUrl}/contents/generations/tasks` 带**空 `content`** | ② 返回 **400**（参数校验先失败）= 模型存在且已开通；**404** = 不存在/未开通。**不会创建任务** |
| 文本 | `POST {baseUrl}/chat/completions` 带 `max_tokens: 1` | **200** = 可用（费用近乎 0）；**404** = 模型未开通 |

> **安全网（必须保留）**：视频轨的探测请求在协议未来变化时**有可能真的创建任务**。
> 实现里对此的处理是：一旦响应里出现任务 id，**立刻 `DELETE` 取消**，并把
> 「意外创建了任务 X，已立刻取消；请到控制台确认无残留计费」写进 `message` —— 不许静默留下一个计费任务。

**凭据与红线**：与两条轨的实际调用完全一致 —— 只从请求头取（`X-Provider-Key` / `X-LLM-Key`），
不回落 query / body；响应中的一切上游文本先过 `security/redact.ts`。

---

## 10. 操作日志（V2.1 新增）

**定位**：开发者排错用的"**谁、何时、对什么、做了什么、结果如何**"。
与另外两处严格分工 —— pino/stdout 给运维看技术细节，`tasks` 表给用户看单任务结果，本表给开发者看操作序列。

**权限（用户 2026-09-23 拍板）**：**全员可见，不加额外权限**；公网仍由 Caddy 登录 + `PUBLIC_API_TOKEN` 两层保护（PLAN §7-4）。

**写入规则（噪声纪律，见 `backend/src/server/requestLog.ts`）**：

- **记**：所有 `/api/*` 的**写**请求（POST / PUT / PATCH / DELETE）与**任何失败**的请求（`status >= 400`，含读操作失败）；
- **记（V2.4 新增）**：**任务终态**（`task.complete` / `task.fail` / `task.uncertain`）—— 它不是 HTTP 请求，而是 `SqliteJobQueue` 在任务到达终态时写入（`method: 'TASK'`、`path: /api/tasks/<taskId>`，剪辑任务带 `detail.kind: 'edit'`）。为什么：异步任务的失败原本不产生 HTTP 请求，日志里无迹可查（剪辑失败但日志全是 200 的缺口）；
- **不记**：`/media/*`（一次播放几十条 Range）、`/api/health`（探活）、`/api/logs*`（日志页自身轮询，否则自我增殖）、`OPTIONS` 预检、以及**成功**的读请求（任务进度每 2s 轮询一次，记下来会把日志淹掉）。
- **动作清单补登（V2.5）**：`edit.render`（`POST /api/edits/renders` —— 浏览器端渲染产物入库；它是写操作，按上面的规则本来就会记，这里显式登记动作 id 以便日志页筛选）。
- **动作清单补登（V2.8）**：`storage.evict`（**容量淘汰**，台账 B22）—— 它不是 HTTP 请求，而是后台扫描
  真正删了文件之后写一条（`method: 'STORAGE'`、`path: /api/storage/evict`、`detail` 含释放字节数与被淘汰的
  taskId 列表截断）。为什么必须记：文件是**被系统删掉的**，用户"片子怎么没了"时日志里必须有据可查；
  没淘汰则不写（噪声纪律：无事发生就不要留痕）。
- **动作清单补登（V2.18）**：`log.prune`（**日志保留策略**，台账 B23）—— 同样不是 HTTP 请求，
  而是后台按保留策略**真删了日志**之后写一条（`method: 'LOG'`、`path: /api/logs/prune`，
  `detail` 含 `deleted` / `deletedByAge` / `deletedByCount` / `remaining` / `policy`）。
  没删则不写；这条痕迹本身会随下一次保留策略到期而被删（正常 —— 它记录的是"当时发生了什么"）。

**字段**：

```ts
export interface EventLogEntry {
  id: number;
  ts: number;                 // 毫秒时间戳（前端按本机时区渲染）
  requestId?: string;         // 服务端请求 id；同时回写在响应头 x-request-id，报错截图可直接搜
  ip?: string;                // **明文**（用户拍板；仅存服务端 SQLite，随服务端备份一起走）
  method: string;
  path: string;
  action?: string;            // 语义动作 id（清单见 packages/shared/src/logs.ts 的 LOG_ACTIONS）
  statusCode?: number;
  durationMs?: number;
  taskId?: string;
  provider?: string;
  errorCode?: string;
  disposition?: string;
  userAgent?: string;
  body?: string;              // 截断后的请求体（JSON 原文；multipart 只记大小与类型摘要）
  detail?: Record<string, unknown>; // 白名单诊断字段：本次模型、上游 request id、上游报文截断
}
```

**查询筛选**（`GET /api/logs` 的 query，与前端筛选器一一对应）：`?limit=`（≤500）/ `?offset=` /
`?ip=` / `?action=` / `?errorCode=` / `?q=`（关键词匹配 path / body / detail / ip / action）/
`?since=` / `?until=`（epoch ms）；**V2.19 新增 `?taskId=`**（台账 B62）—— 取**某条任务的全部留痕**。
为什么加它：任务终态（`task.complete` / `task.fail` / `task.uncertain`）、提交、取消、渲染入库都带 `task_id`，
而"用关键词搜提示词去捞这条任务发生了什么"只能碰运气；画布的**节点检查器**要一条直路
（点节点 → 这条任务的全部事件）。**清空（`DELETE /api/logs`）复用同一套筛选**（不带筛选即全清）。

**存储与生命周期**：落 `data/app.db` 的 `event_log` 表（`ts` 倒序索引）。

- **V2.18（台账 B23）起有自动保留策略**：默认**保留 90 天 / 最多 20 万条**，
  两条判据**各自可用 `0` 关闭**（`LOG_RETENTION_DAYS` / `LOG_MAX_ROWS`；两个都给 0 = 策略关闭，
  **启动时会警告** —— 那种配置下先被吃掉的是日志，运维往往直到冒烟才发现）；
- **只删操作日志**：任务、项目、Webhook 订阅与投递流水都是业务数据，保留策略一条都不动
  （这是"保留策略"与"数据清理"的分界线）；
- **条数判据用"水位"**：删到 `maxRows × 0.8` 以下就停，而不是"删到刚好等于上限" ——
  前者避免"每来一条新日志就删一次"的读写放大；运维要的是"别无限长"，不是"永远精确 20 万条"；
- **真删了才留痕**（`log.prune` 操作日志，见下）：写入"删了多少 / 按哪条判据删的 / 还剩多少 / 生效策略"——
  这是"我的日志怎么少了"的唯一答案；
- **用户手动删仍然可用**：单条删除与按筛选清空不变（保留策略只是**外加**的兜底）；
- **凭据永不入库**：请求体与上游文本写入前一律过 `security/redact.ts`。

---

## 11. 配方库与剪辑台（V2.2 新增；**§11-1 配方库 = V9 · B8 已实现**；**§11-2 多轨工程 = B34 剪辑台改版（V2.5 重写）**；**§11-3 基础剪辑 EDL = B9 遗留，API-only**）

> 背景与决策：PLAN §4 Step 6、§6-D36（配方库双入口）/ D37（剪辑台 MVP、剪映导出砍掉）/ D38（抽帧→生成闭环）。
> **零 API 成本红线**：本节的一切都是本地 ffmpeg 或静态数据，**不产生任何上游调用**。

### 11-1 配方卡 `RecipeCard`（静态数据，放 `packages/shared/src/recipes.ts`）

配方是**数据，不是路由**：随前端 bundle 下发，前端直接读，**不设 `/api/recipes`**（要筛选用前端本地过滤；若日后要服务端筛选/自定义配方再加路由，并先改本节）。

```ts
export const RecipeCategorySchema = z.enum(['camera', 'lighting', 'mood', 'rhythm']); // 运镜/光线/氛围/节奏

export const RecipeCardSchema = z.object({
  id: string,                    // 'camera-push-in-slow' 之类，稳定、不可复用旧 id
  title: string,                 // 展示名（中文）
  category: RecipeCategorySchema,
  modes: GenerationMode[],       // 适用模式（如 ['t2v','i2v']）
  durationHint?: string,         // 建议时长文案，如 '5s 以内'
  skeleton: string,              // 「插入骨架」落到提示词框的文本（**逐字**，单测钉住）
  paramsHint?: {                 // 参数建议（只是建议，不强制改表单）
    aspectRatio?: AspectRatio;
    resolutionTier?: '480p' | '720p' | '1080p';
  };
  pitfalls?: string[],           // 已知坑（如实写，例如"该运镜在 5s 内容易走不完"）
});
```

- **双入口**（B8 实现时把口径钉死）：① 插入骨架 = 把 `skeleton` **原样追加**到提示词框**末尾**（框为空则直接写入；**刻意不做替换** —— 覆盖用户已写的主体描述属数据丢失，比"插不进去"更糟）；② ✨ 扩写 = 请求带 `recipeId`，服务端把该卡的 `skeleton + pitfalls` 注入 system prompt（§3），**用户原文仍原样作为 user message**。
- **诚实标记**：配方是"经验骨架"，**不得**在 UI 上承诺"用了就出大片"；`pitfalls` 为空时不得编造。

### 11-2 多轨工程 `EditProject` 与浏览器端渲染入库（V2.5 重写；B34 剪辑台改版）

**定位**：剪辑从"顺序 EDL"升级为**多轨时间轴工程**（项目 → 轨道 → 片段）；渲染在**用户浏览器**完成
（`@remotion/web-renderer`：WebCodecs 硬件编码 + Mediabunny 封装 MP4，**服务器零 CPU**）。
服务端只做两件事：**归档渲染产物**（`POST /api/edits/renders`）与**按源片查询剪辑历史**（`GET /api/history?kind=edit&source=`）。

```ts
// 工程 = 前端编辑态的唯一真相；zod schema 在 packages/shared/src/editProject.ts（本文为文档投影）。
// 所有时间量的单位都是**工程帧**（fps 由工程给出，默认 30）。
export interface EditProject {
  version: 1;
  fps: number;
  width: number;
  height: number;
  /** 数组顺序 = UI 阅读顺序（镜头 / 转场 / 字幕 / 音效）；**渲染层级由轨道类型决定**（视频在下、字幕在上） */
  tracks: EditTrack[];
}
export interface EditTrack {
  id: string;
  kind: 'video' | 'caption' | 'transition' | 'audio';
  clips: EditClip[];
  muted?: boolean;
}
export type EditClip = VideoClip | CaptionClip | TransitionClip | AudioClip;

/** V2.10（B57）：片段来源 —— 成片（task）或上传资产（asset），**二者至少有一个** */
export interface EditClipSource {
  taskId?: string;   // 成片来源（<TaskProgress.taskId>）
  assetId?: string;  // 上传资产来源（音频素材；B57 新增）
  url: string;       // 恒为同源 /media/* 相对地址
  durationFrames: number;  // 由 <video>/<audio> 元数据探测得出（裁剪上限的唯一依据）
  name?: string;     // 资产的可读名字（sidecar 的 name，仅显示用；B57）
}

export interface VideoClip {
  kind: 'video'; id: string; startFrame: number; durationFrames: number;
  source: EditClipSource;
  trimStartFrames: number;   // 裁入点（对应 <Video trimBefore>，帧）
  speed: number;             // 0.25~4；源片消耗 = durationFrames × speed
  volume: number;            // 0~2（0 = 静音）
  label?: string;
}
export interface CaptionClip {
  kind: 'caption'; id: string; startFrame: number; durationFrames: number;
  text: string;                                   // 1~200 字
  position: 'bottom' | 'center' | 'top';
  preset: 'plain' | 'fade' | 'wordSlide' | 'typewriter';  // 动效预设（技法借鉴 video-shotcraft，见 UPSTREAM #11）
}
export interface TransitionClip {
  kind: 'transition'; id: string; startFrame: number; durationFrames: number;
  transition: 'fade' | 'wipeleft' | 'slideright';
  fromClipId: string; toClipId: string;           // 两端视频片段（同轨相邻）
}
export interface AudioClip {
  kind: 'audio'; id: string; startFrame: number; durationFrames: number;
  source: EditClipSource;      // V2.10：可取自**上传的音频素材**（此前只能取成片的音轨）
  trimStartFrames: number; volume: number;
  fadeInFrames?: number;       // V2.10（B57）：淡入帧数，0~durationFrames，默认 0
  fadeOutFrames?: number;      // V2.10（B57）：淡出帧数，0~durationFrames，默认 0
}
```

**音频淡入淡出（V2.10 / 台账 B57）**：音量是**时间的函数**（预览与导出**同一套**实现，都在
`packages/shared/src/editProject.ts` 的纯函数里，渲染层只调用不另写一套）——第 `f` 帧的音量 =
`volume × fadeFactor`，其中淡入段线性 `f/fadeInFrames`、淡出段线性 `(durationFrames-f)/fadeOutFrames`，
两段重叠时取**较小值**（不会因两段叠加而放大）。`fadeIn + fadeOut > durationFrames` 时**不报错**，
按"两段各自钳制到 `durationFrames`、取较小值"渲染（曲线的语义是"最多这么长"，不是"必须这么长"）。

**转场语义（与渲染严格一致，不许两套口径）**：
- 转场坐在**两个同轨相邻视频片段**的接缝上（加转场前要求 `to.startFrame === from.endFrame`）；
- 添加转场把 `to` 及其后片段**左移 d 帧**：重叠区 = 转场窗口 `[from.endFrame-d, from.endFrame]`，
  窗口内两段同时在画面（`fade` 交叉淡化 / `wipeleft` 左揭幕 / `slideright` 右滑入），**总时长随之缩短 d** ——
  时间轴显示与渲染结果**逐帧一致**（不是"时间轴不动、成片偷偷变短"）；
- **任何破坏相邻性的编辑**（移动 / 裁剪 / 删除参与方）都会**移除该转场并把被左移的片段还原**
  （界面给出提示，**不静默**）；`d` 上限 = `min(60 帧, fps×2, 两端片段时长-1)`。
- 值与组合不合法 → **`400 INVALID_REQUEST`**（形如"两段之间有空隙，先把后一段拖到紧贴"）。

**渲染入库 `POST /api/edits/renders`**（multipart 字段）：

| 字段 | 说明 |
|---|---|
| `file` | 浏览器渲染出的 MP4；**魔数嗅探**必须为 `video/mp4`；≤ 100MB（V2.6 起，与 `/api/upload` 同口径；反代请求体上限同样是 100MB，超出会被反代先拦） |
| `sourceTaskId` | 本次剪辑的**源片**（剪辑历史按它归档——「本片剪辑历史」用它查） |
| `project` | 多轨工程 JSON（服务端用 `EditProjectSchema` 校验；**只存不改**） |

成功 → **200 `{ taskId }`**，并产生一条 `status:'succeeded'` 的剪辑任务：
`outputVideoUrl=/media/<taskId>.mp4`、`thumbnailUrl`（服务端抽首帧）、
`origin = { kind: 'edit', sourceTaskId, project }`、`requestSnapshot` 复用源片快照（画廊回填用）。

**服务端不提供渲染**：没有"提交渲染任务"的异步流程，不需要队列与冷却；浏览器渲染失败时**不会产生任何服务端记录**（没有半成品）。
**`TaskProgress.origin` 的 `edit` 分支**：`script` 与 `project` **均为可选、至少有一个** —— 旧记录（EDL）与
新记录（工程）都能读；界面据此显示"剪辑自 xxx"徽标并渲染对应的历史条目。

**闭环（PLAN §6-D38：抽帧 → 生成）**：抽帧走**浏览器端**（`renderStillOnWeb` 取播放头画面，与预览同构图）
+ 既有 `POST /api/upload` 落为参考资产 → `#/workbench?frameAsset=<assetId>` 直接把该资产填进"首帧"槽并切到 I2V。
**不新增服务端路由**。

**生命周期**：渲染产物与原片同规则（`outputs/`、`DELETE /api/history/:taskId` 物理删除、
删任务连带工程 JSON 一起删）；「本片剪辑历史」= `GET /api/history?kind=edit&source=<taskId>`
（EDL 与工程两类剪辑产物都会返回）。

### 11-3 基础剪辑 EDL（B9 遗留；**API-only，界面不再暴露**）

> 为什么保留：它是"纯服务端基础剪辑"的完整能力（本地 ffmpeg、零上游调用），
> 且有独立的测试与冒烟覆盖；B34 改版后**界面入口撤掉**（导出统一走浏览器端），
> 但作为 API 能力继续可用（外部脚本 / 二次开发）。契约不变，见下。

```ts
// 编辑决策清单（EDL）：对**已有成片**的时间轴操作序列，按顺序应用
export const EditOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('trim'),    startSec: z.number().min(0), endSec: z.number().min(0) }),
  z.object({ type: z.literal('concat'),  taskIds: z.array(z.string()).min(1) }),      // 依次拼到当前时间轴之后（**不含**源片自身）
  z.object({ type: z.literal('xfade'),   transition: z.enum(['fade','wipeleft','slideright']), durationSec: z.number().min(0.1).max(2) }),
  z.object({ type: z.literal('volume'),  gain: z.number().min(0).max(2) }),           // 0 = 静音
  z.object({ type: z.literal('speed'),   factor: z.number().min(0.25).max(4) }),
  z.object({ type: z.literal('extractFrame'), atSec: z.number().min(0) }),            // 抽帧 → 落为参考资产（D38 闭环）
]);

export interface EditScript {
  sourceTaskId: string;                 // 源成片（必须 succeeded 且有成片文件）
  operations: EditOperation[];          // 1..8 个，按序执行
}

// POST /api/edits  请求体 = EditScript；响应 = { taskId }（**复用** §4 轮询，不新增进度路由）
```

**语义与约束**：
- 剪辑产物是一条**新的 `taskId`**；`origin = { kind: 'edit', sourceTaskId, script }`；画廊 / 剪辑台据此显示"剪辑自 xxx"。
- 执行器是**本地 ffmpeg**（复用 `lib/ffmpeg.ts` 的探测与中文报错），**并发 = 1**（与本地轨同一把互斥锁），无上游调用、无凭据需求、**不走防线 5 的 60s 冷却**。
- `extractFrame` 的产物落到 `outputs/assets/`（与上传资产同目录同规则），另记 `extractedAssetIds: string[]`；其余操作产物为 `outputs/<taskId>.mp4`（**重编码**）。
- **失败归类**：输入非法 → `400 INVALID_REQUEST`；源任务不存在/无成 → `404 TASK_NOT_FOUND`；ffmpeg 不存在 → `503 PROVIDER_UNAVAILABLE`；执行失败 → `500 UPSTREAM_ERROR`。**没有 `uncertain`**：本地操作没有"不知道结果"的状态。

**生命周期**：剪辑产物与原片同规则（`outputs/`、画廊可见、删除即物理删除）；**EDL 随任务落库**（`tasks.edit_script` 列），删任务连 EDL 一起删。

### 11-2 附：草稿版本化与版本历史（V2.21 新增；台账 B66）

> 这一节讲的是**只存在浏览器里**的东西（localStorage），服务端不知道它的存在 ——
> 但它的**格式与兼容规则**必须写清楚：草稿是用户唯一的编辑成果，丢一次就是真丢。

**三个存储位**（键名在 `frontend/src/lib/storage.ts` 统一登记，不在组件里拼字符串）：

| 键 | 内容 |
|---|---|
| `astrmira.editDraft.<sourceTaskId>` | 当前工程（**一份**，随编辑防抖覆盖） |
| `astrmira.editDraftHistory.<sourceTaskId>` | 版本历史（**最多 8 份**快照，最新在前） |
| （其余键见 `STORAGE_KEYS`） | BYOK / 主题 / 当前项目等 |

**迁移函数 `migrateEditProject(raw)`**（`packages/shared/src/editProject.ts`，前后端共用）：

- **只做前向兼容**：`version > EDIT_PROJECT_VERSION` → **明确拒绝**并给可执行提示
  （"请升级本机版本后再打开"）—— 假装能读一份未来格式 = 悄悄丢字段；
- **每一步留痕**：迁移做了什么写进 `notes`（如"文件没有版本号，按 v1 处理"），界面上如实展示；
- **失败返回原因、不抛异常、不返回半成品**（调用方决定"保留原文 / 提示用户"）。

**三条口径（V2.21 起）**：

1. **坏草稿不静默丢**：读不出来时**保留原文**并把原因摆到剪辑台页面上
   （旧口径是"就地删除并返回 null"—— 那是数据丢失，用户只会看到"我的剪辑怎么没了"）；
2. **历史快照走同一个迁移函数**：老快照也要能打开；读不出来的那份**跳过并计数**，由界面如实说明；
3. **恢复前先保底**：恢复某个历史版本之前，先把**当前**状态强制存一份（`force`）——
   恢复错了还能回去（与备份恢复 §17 同一纪律）。

**历史的三条节制**：`DRAFT_HISTORY_LIMIT = 8`（只留最近 8 份）、
`DRAFT_HISTORY_MIN_INTERVAL_MS = 5 分钟`（自动快照节流；编辑防抖是 500ms，不节流会瞬间刷满）、
**与最新一份完全相同则不重复存**。用户随时可以「＋ 存一个版本」（`force`）或「清空历史」（**不动当前草稿**）。

### 11-4 配方包文件格式 `astrmira.recipe-pack`（V2.20 新增；台账 B65）

> **它是什么**：从血缘画布把"**这条片子的完整配方链**"导出的一个 JSON ——
> 目的是**可复用**（换个人照着复现）与**可归档**（评审 / 交付留档）。
> 它是**文件格式**，不是接口：纯前端生成、浏览器下载，**零新路由、零契约调用**。

```ts
export interface RecipePack {
  kind: 'astrmira.recipe-pack';   // 固定标识（接收方据此判断"这是什么文件"）
  version: number;                // 格式版本（当前 1；B66 起旧文件必须仍能被打开）
  exportedAt: number;             // epoch ms
  rootTaskId: string;             // 导出时选中的那个节点（链的终点）
  tasks: RecipePackTask[];        // 根 + 它的**全部上游**
  assets: RecipePackAsset[];      // 链上用到的资产（只记 id 与元数据）
  edges: Array<{ from: string; to: string; kind: 'edit' | 'extract' | 'reference' | 'task-ref' }>;
  omitted: string[];              // 引用了但不在画布上的对象 id（ghost）——**如实列出，不静默丢**
  notes: string[];                // 写给接收方的话（含"这份文件不含什么"）
}
```

**三条口径（都是刻意的取舍）**：

1. **只导上游闭包**：不含下游 —— 下游是别的片子，把整张图倒出去等于把项目里无关的东西塞进归档；
2. **不含 `options`（provider 私有参数）与任何凭据**：`options.baseUrl` 可能是**内网地址**，
   而配方包是要发给别人、要进交付包的。凭据本来就不在服务端，但"不导出"要写成显式约定
   （与 README 协作规范第 9 条"Key 零留存"同一族）；
3. **不编造**：ghost 对象只登记 id 到 `omitted`，不回填元数据 —— 归档的价值恰恰在于"它当时就是这样"。

**如实边界**：资产与成片**只有 id 与相对路径**，换一台部署要真正复现，需要把对应媒体文件一起带上
（`notes` 里也写了这句）；本版**没有导入功能**（导入 = B66/B71 的地盘：要先有"旧文件仍能被打开"的保证）。

---

## 12. 项目维度 `Project`（V2.11 新增；台账 B47）

> **定位**：交付形态是**一家客户一套私有部署**（PLAN §6-D42），所以**没有** tenant / 跨租户隔离。
> 需要隔离的单位是**一个客户内部的多条片子 / 产品线** —— 那就是项目。
> **角色（管理员 / 创作者 / 查看者）不在本版**（用户 2026-10-10 拍板"先不做"）：
> 没有用户身份系统就做角色只是假门禁（违反"不许假装可用"），它需要独立的身份系统，登记为待办。

```ts
// 默认项目：**永远存在**，也是"调用方没传 projectId"时的落点。
// 老数据（V2.11 之前的任务）在启动时被回填到它 —— 因此老客户端与老测试的行为完全不变。
export const DEFAULT_PROJECT_ID = 'default';

export interface ProjectEntry {
  projectId: string;      // 'default' 或服务端生成的 UUID
  name: string;           // 1~60 字符，trim 后不得为空、**不得重名**
  createdAt: number;      // epoch ms
  updatedAt: number;
  isDefault: boolean;     // 默认项目：不可删除
  taskCount: number;      // 用量：项目内的任务条数（含剪辑产物与失败记录）
  assetCount: number;     // 用量：项目内的资产个数（口径 = sidecar 的 projectId，缺失算默认项目）
}

export interface ProjectListResponse { projects: ProjectEntry[] }   // 默认项目排最前
export interface ProjectResponse { project: ProjectEntry }
export interface CreateProjectRequest { name: string }              // POST 与 PATCH 同形
export interface DeleteProjectResponse { deleted: boolean; projectId: string }
```

**四条口径（都是"不静默"的具体化）**：

1. **缺失即默认项目**：`POST /api/generate` 的 body、`POST /api/upload` / `POST /api/edits/renders` 的 multipart 字段、
   `GET /api/history` / `GET /api/assets` 的查询参数 —— **省略一律 = 默认项目**（不是"全部项目"）。
   界面的心智模型是"我在哪个项目里"，而"跨项目看全部"不是一个需要在界面上出现的能力。
2. **显式给了不存在的项目 → 报错**：生成任务 **404 `PROJECT_NOT_FOUND`**、
   上传 **400 `INVALID_REQUEST` + 撤回本次已落盘的媒体文件**。绝不静默落到默认项目 ——
   那会让用户在"默认项目"里看到本不属于它的东西，而他以为自己选中的项目并没有接住它。
3. **删除只允许空项目**，且**默认项目不可删**：本项目**不做级联删除**（删一个还有任务/资产的项目
   等于把数据变成孤儿）。用量非零 → `400 INVALID_REQUEST`，文案报出真实的 `taskCount` / `assetCount`。
4. **项目名去重**：同名项目在切换器里根本认不出来（可用性问题，不是洁癖）→ `400 INVALID_REQUEST`。

**存储与迁移**（细则见 §7）：`projects` 表 + `tasks.project_id` 列；
启动引导 `bootstrapProjects` **幂等**地建默认项目并回填 NULL 归属，因此**升级不需要人工步骤**。
资产不走数据库：归属写在 sidecar（`outputs/assets/<assetId>.json` 的 `projectId`），
**没有 sidecar 的老资产按默认项目算** —— 这是如实的归属，不是猜一个。

---

## 13. 成本台账 `CostRecord` 与计价口径（V2.12 新增；台账 B48）

> **定位（先说清楚它不是什么）**：这是**预估**，不是账单。金额 = 公开价目 × 上游计费公式，
> **从未与我方方舟账单核对过**（PLAN §8 的单价一律标【待验证】）。所以：
> **每个金额旁边必须站着一句"以方舟账单为准"**（`COST_DISCLAIMER`，服务端下发，界面不得改写措辞）。
>
> **为什么现在做（口径改口）**：V9 时代刻意"不造成本数字"（当时 C 端定位，怕误导用户）；
> **D41 转 B 端后必须反过来** —— 成本可见是采购的硬要求。这不是加功能，是**改口径**，
> 因此它写进契约而不是写进界面文案。

```ts
export const COST_BILLING_FPS = 24;          // 上游计费式里的帧率（**不是**工程帧率 30）
export const COST_DEFAULT_USD_TO_CNY = 7.1;  // 可由部署参数 COST_USD_TO_CNY 覆盖
export const COST_DISCLAIMER =                // 固定文案；服务端下发，界面不许自己写一版
  '预估金额（按公开价目 × 上游计费公式折算），未与我方账单核对；实际扣费以火山方舟控制台账单为准。';

export interface CostRecord {
  yuan: number;                    // 预估金额（元）；本地轨为 0
  usd: number;                     // 折算前（美元）
  tokens: number;                  // 计费 token 量（上游计费式的输出）
  source: 'estimate' | 'local-free' | 'upstream';
                                   // estimate = 按公开价目估算（当前唯一在用的云端值）
                                   // local-free = 本地轨 / 浏览器内渲染，**无 API 费用**（显式记 0）
                                   // upstream = 上游返回的真实 usage（**保留位，尚未接线**）
  modelId: string;                 // 用于计价的模型（自定义档原样保留）
  fromPriceTable: boolean;         // false = 命中不了单价表（自定义 ep-…）→ 按兜底价估算，界面要标注
  usdPerMillionTokens: number;
  usdToCny: number;
  outputSeconds: number;           // 计费用的时长口径（来自请求 params.durationSec）
  inputSeconds: number;            // 参考视频输入时长（当前一律 0 —— 未落库，见下"如实边界"）
  width: number; height: number; fps: number;
  formula: string;                 // 人类可读算式（审计要能倒推；不参与计算）
  notes: string[];                 // 如实标注这次估算漏了什么（如"未计入参考视频输入时长"）
}

export interface CostBucket {      // 按项目 / 按天 / 按模型共用同一形状
  key: string;                     // projectId / 'YYYY-MM-DD' / modelId
  label: string;                   // 项目名 / 日期 / 档位标签
  yuan: number;
  taskCount: number;
  unsettledCount: number;          // **必须与 yuan 并列** —— 只给金额会被读成全量
}

export interface CostSummaryResponse {
  range: { from: number | null; to: number | null };
  projectId: string | null;        // null = 跨项目汇总（?project=all）
  totalYuan: number;
  taskCount: number;               // 区间内成功任务总数（含未结算）
  pricedTaskCount: number;         // 其中有成本记录的条数（totalYuan 是它们之和）
  unsettledCount: number;          // 成功但无成本记录（V2.12 之前的老任务）
  uncertainCount: number;          // disposition='uncertain' —— **可能已产生费用**（最容易被漏）
  byProject: CostBucket[];
  byDay: CostBucket[];
  byModel: CostBucket[];
  truncated: boolean;              // true = 触到扫描上界，金额只是**部分之和**
  budget: { monthlyYuan: number; monthToDateYuan: number; ratio: number; over: boolean } | null;
  disclaimer: string;              // = COST_DISCLAIMER
}
```

**计价口径（唯一一处详写；算式实现见 `packages/shared/src/cost.ts`）**：

```
token = (输入时长 + 输出时长) × 宽 × 高 × 帧率 ÷ 1024        // 帧率 = 24（上游计费式）
费用(元) = token ÷ 1e6 × 单价($/M token) × 汇率(USD→CNY)
```

验收基线（PLAN §8 已实测的样本）：**5s / 1280×720 / 24fps ≈ 108,000 token**，
按 mini 档 $3.24/M 与 7.1 汇率 ≈ **¥2.4844**。公式算错，后面所有金额都是错的，所以它是一条硬断言。

**五条口径（都是"不静默"的具体化）**：

1. **结算一次、聚合多次**：单条成本在**终态成功**那一刻算好并落库（`queue/SqliteJobQueue.complete`
   + `pricing.settleTaskCost`），汇总只做聚合。两处各算一套 = 早晚对不上。
   顺带的好处：**历史单价变动不改写已发生的成本**（"当时花了多少"是事实）。
2. **结算早于读取**：`cost` 在 `TaskProgress` 上是**可选**字段，缺省 = **未结算**。
   **绝不用 0 兜底** —— "不知道花了多少"与"本地轨 0 元"是两件不同的事，
   而后者（`local-free`）是真实的 0。
3. **失败任务不结算**：上游在参数校验阶段拒绝不产生费用（PLAN §8 实测）。
   但**已提交后结果不明**的任务（`disposition='uncertain'`）**可能已经花了钱** ——
   所以 `uncertainCount` 单独计数，且**跨项目 / 单项目档都给**（它不属于"某个项目的花销"，
   而是"这台部署的敞口"）。
4. **跨项目汇总只在显式的 `?project=all` 档**：界面的心智模型是"我在哪个项目里"，
   但"这台机器一共花了多少"是部署方的问题，与前者不冲突。
   **月度预算也只在 `all` 档给出**：项目花费 vs 全局预算是两个口径的数字，放一起只会误导。
5. **未配置就是 null**：没有 `MONTHLY_BUDGET_YUAN` 就不显示预算（不编一个默认预算 ——
   预算是客户的经营参数，不是我们的默认值）。

**如实边界（当前版本做不到的，**不要**读成已实现）**：

- **单价一律【待验证】**：除 mini 档（§8 口径）外，其余档位由官方/第三方的**定性描述折算**得出，
  每条单价在代码里都写了 `basis`（折算过程）。拿到真实账单后**逐行替换**即可，形状不变。
- **上游真实 usage 未接线**：`source: 'upstream'` 是保留位。当前一律 `estimate`。
- **参考视频（V2V）输入时长未计入**：它没有落库，所以 `inputSeconds` 一律 0 →
  此类任务的估算**偏低**，`notes` 里会明说。修它要先把参考视频时长入库（独立小活）。
- **本地轨的 0 元不含电费与设备折旧**：口径写在 `formula` 里，不假装它是"全成本"。
- **按天分桶用服务端本地时区**（不是 UTC）：跨时区部署时"今天"的定义会随机器走。

---

## 14. 交付物：命名、平台规格与归档清单（V2.13 新增；台账 B49）

> **没有新路由** —— 交付包**完全在浏览器端组装**（契约层面只约定"包长什么样"）：
> 成片与封面本来就在同源 `/media/*`，让 4 核小服务器去内存里拼几十 MB 的 zip 是拿服务器换客户的本机 CPU
> （与 §11-2 的"渲染在浏览器"同一取向）。因此本节是**格式契约**，不是接口契约。

**三项口径（都是"不假装"）**：

1. **不转码**。平台规格预设在这里是**命名与校验**（画幅是否匹配、时长是否超限、分辨率是否偏低），
   不是"帮你把 16:9 压成 9:16"。告警**只提示、不阻断**（客户有权按自己的判断交付）。
2. **每条预设都带 `basis`**（口径从哪来），与 §13 的单价表同一条纪律：**未经我方实测的数字不许当结论**。
3. **清单如实标注缺什么**：`packaged: false`（清单里有、包里没有）、`warnings[]`（规格提示）、
   `notes[]`（金额口径 + 未转码声明）。**交付包最糟糕的形态是"少了一条但没人知道"。**

**命名模板**（`buildDeliverableFileName` / `buildDeliverablePackageName`）：

```
成片：  <项目>-<YYYYMMDD>-<序号>-<档位标签>-<语义>.<ext>
包：    <项目>-<YYYYMMDD>-<档位标签>-<N>条.zip
清单：  交付清单.json
```

- **日期进文件名**：交付最常见的返工理由是"哪一版是最新的"，而文件系统只保证"修改时间"，
  客户把文件拷来拷去、用微信传之后时间戳早就没有意义了；
- **序号宽度按总数自适应**（9 条 → `1`；12 条 → `01`）→ 文件管理器按名字排序就是交付顺序；
- **归一化规则**：一段连续的"非字母非数字"折成单个 `-`（`\p{L}` / `\p{N}` 之外的一切，
  含 Windows 非法字符、空格、各类中英文标点），首尾横线与点去掉、超长截断 ——
  保证文件名**直接落进 Windows 与 macOS 都不报错**，且不会出现 `双十一-·-主推片` 这种别扭结果。

**ZIP 子集**（`frontend/src/lib/zipStore.ts`）：**store-only（不压缩）** + UTF-8 文件名标志（`0x0800`）+
DOS 时间戳（1980~2107 夹紧）+ 同名自动去重（`a (2).mp4`）。**不做 ZIP64**：单文件与总量超 4GB 时
**如实报错**，而不是写一个坏包。

```ts
export interface DeliverableManifest {   // 契约形状；schema = DeliverableManifestSchema
  manifestVersion: 1;
  generatedAt: number;
  project: { projectId: string; name: string };
  preset: { presetId: string; label: string; aspectRatio: string; width: number; height: number; maxDurationSec: number };
  items: Array<{
    taskId: string;
    fileName: string;          // 包内成片文件名（与 §14 模板一致）
    prompt: string;
    mode: string;
    aspectRatio: string;
    durationSec: number;       // 请求时长（与 §13 成本口径同一来源）
    createdAt: number | null;
    packaged: boolean;         // 视频是否真的进了包
    projectIncluded: boolean;  // 剪辑工程 JSON 是否随包（仅剪辑产物）
    transcoded: boolean;       // 是否**按平台规格重新渲染过**（V2.14 / 片 B）
    assets: string[];          // requestSnapshot.assets 的原样快照（可复现的关键）
    extractedAssetCount: number;
    costYuan: number | null;   // 来自 §13；null = 未结算（**不是 0**）
    warnings: string[];        // 规格提示（只提示不阻断）
  }>;
  notes: string[];             // 金额口径 + "未做平台转码" + 清单/包条数差异
}
```

**规格转码（V2.14 / 片 B）—— 复用导出链路，不引新依赖**：

转码 = 构造一个**目标画幅的单镜头工程**（`createProjectFromSource` + 预设的 width/height）再渲染一遍，
复用剪辑台的导出链路（Remotion composition → `@remotion/web-renderer` → WebCodecs → mediabunny 封装）。
**零新依赖、零服务器 CPU**；代价是耗时与片长成正比（进度条如实显示）。

四条口径：
1. **裁切而不是拉伸**：画幅不一致时按 `cover` 裁掉多余部分（`.ed-comp-media { object-fit: cover }`）。
   正常剪辑流程里工程画幅 = 源片画幅，`cover` 与 `fill` 等价 —— 只有转码这条路会走到裁切；
2. **时长不截断**：只对齐画幅与帧率，**不动时长**（截断是内容决定，工具不替客户剪；
   超过平台上限由 `presetWarnings` 提示）；
3. **帧率归一到工程帧率**（默认 30）—— 转码必然重采样，说清口径比假装没变化好；
4. **探测真实时长与尺寸**（`probeVideoMeta`），**不用**请求参数里的 `durationSec`
   （实测成片 5.09s vs 请求 5s，用请求值会把尾巴切掉 —— "看起来对、其实少帧"的那种错）。
   已对齐（尺寸与帧率都命中）→ **跳过渲染**，原文件进包并如实说明。

**水印：明确不做（D45，用户 2026-10-10 拍板）**。因此交付包与剪辑台导出**都没有水印开关**；
上游侧的 `--watermark` 仍固定 `false`（成片本身不带平台水印）。

**本版不做（如实登记）**：① **码率 / 编码参数对齐**（只对齐画幅与帧率，不按平台调码率）；
② 交付包的**断点续传 / 分片**（大包一次性内存拼装，几十 MB 量级够用）。

---

## 15. Webhook 终态回调（V2.15 新增；台账 B51 片 A）

> **定位**：客户系统目前只能轮询 `/api/tasks/:id`。集成方要的是"到终态推我一下" ——
> 这是"客户系统集成"里**成本最低、收益最直接**的一件，所以排在项目级 API Key / 批量提交之前。

**唯一事件：`task.terminal`**（任务进入 `succeeded` / `failed` / `cancelled`）。不预留"将来可能会有"的事件名 ——
那只会让订阅语义变模糊；真要扩事件，`WebhookEventSchema` 一处即可。

**请求形状**（`POST` 到客户配置的 URL，`content-type: application/json`）：

| 头 | 值 | 用途 |
|---|---|---|
| `X-Astrmira-Signature` | `sha256=<hex>` | HMAC-SHA256(**原始请求体**, secret)。**客户侧必须验签** |
| `X-Astrmira-Event` | `task.terminal` | 事件名（客户未来可用同一 URL 收多事件） |
| `X-Astrmira-Delivery` | `<deliveryId>` | 投递 id —— 客户可用它做**幂等键**（重试会带同一个 id） |

```js
// 客户侧验签（Node 示例；必须对**收到的字节**验，不要重新序列化）
const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
const got = req.headers['x-astrmira-signature'];
if (expected.length !== got.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got))) {
  return res.status(401).end();
}
```

**载荷**（`TaskTerminalPayload`，字段与 `TaskProgress` 同名同义，便于与轮询结果对账）：
`event` / `deliveryId` / `taskId` / `projectId` / `status` / `disposition?` / `errorCode?` / `message?` /
`outputVideoUrl?`（配了 `PUBLIC_BASE_URL` 时为**绝对 URL**，否则给相对路径）/ `thumbnailUrl?` /
`progressPercent` / `costYuan?`（**未结算 = 不出现，不是 0**，与 §13 同口径）/ `createdAt` / `terminatedAt`。

**投递语义**：

- **2xx = 成功**；其它状态码 / 网络错误 / 超时（默认 10s）**都算失败并重试**；
- 重试**上限 3 次**（首次 + 2 次），退避 **5s / 25s**，用尽后 `status='failed'` 且**不再自动重试**
  （客户系统长时间宕机时应自己拉历史补，而不是让我们无限重试）；
- **最多一个扫描间隔的延迟**（默认 2s）—— 实现是**扫描补投**而不是"终态时立刻推"，理由见下。

**订阅是 forward-only（从创建那一刻起生效）**：创建订阅**之前**就已终态的任务**不补投** ——
否则客户一接入就会收到最近 7 天所有终态任务的**事件洪峰**（那不是"欢迎"，是骚扰）。
想看历史走 `GET /api/history`（它本来就是为这个准备的）。兜底扫描窗口（7 天）只用于补"进程不在时到终态"的任务。

**为什么是扫描而不是内联触发**（这是本片最重要的一个取舍）：终态写入点有**三处**
（调度器成功 / 失败、剪辑入库直插），内联触发就要改三处、且漏掉"终态时进程正好重启"这种情形；
扫描版只有**一处**（`NOT EXISTS` 条件天然幂等），还顺带覆盖崩溃补投与"订阅是任务结束之后才建的"。
代价是最多 2 秒延迟 —— 而回调本来就是异步语义（客户系统不该指望"我提交后 0 毫秒就收到"）。

**SSRF 准入**（`checkWebhookUrl`）：只允许 http/https、URL 不许带用户名密码，**默认拒绝**
环回 / 私网（10/8、172.16/12、192.168/16、100.64/10）/ 链路本地 / 云元数据（169.254.169.254）。
B 端私有部署里"回调到客户内网"是真实需求，因此留了 **`WEBHOOK_ALLOW_PRIVATE=1`**（默认关，
= 部署者显式承担该决定）。⚠️ **如实说明**：判定是**字面量**的（IP 字面 + 主机名规则），
**不做 DNS 解析后再查** —— 那会引出"解析与请求之间地址变了"（DNS rebinding）的更大口子；
本服务是**单租户私有部署**（调用方本来就是部署者自己），真正的多租户场景需要固定出口代理，属另一个量级（已登记）。

**secret 的生命周期**：**创建响应里回显一次明文**，之后一切接口只给掩码（`whsec_ab…`）。
与 §9 的 BYOK 差别：provider Key 是**用户凭据**（服务端不持有）；webhook secret 是**双方共享的签名密钥**，
服务端**必须持有**才能签名 —— 所以它落库，但它**不可回读**。

**存储**（细则见 §7）：`webhooks`（订阅）+ `webhook_deliveries`（投递流水）；
`(webhook_id, task_id, event)` **唯一索引**保证幂等（重复扫描不会重复投递）。

---

## 16. 可观测：live / ready 分级与运维快照（V2.16 新增；台账 B53）

> **它解决什么**：私有化交付后，"服务是不是还行"必须有**可查的数字**，而不是"客户说卡"。
> 三个端点分工明确、**不许混用**：

| 端点 | 回答的问题 | 依赖 | 鉴权 |
|---|---|---|---|
| `GET /api/health` | 进程还在吗 | **零**（不碰数据库） | 任何来源免鉴权 |
| `GET /api/health/live` | 同上（与 ready 成对的新路径） | **零** | 任何来源免鉴权 |
| `GET /api/health/ready` | **能干活吗** | DB 可读 + 目录可写 | 需鉴权（回环免） |
| `GET /api/metrics` | 现在具体什么状况 | 全部（含一次目录扫描） | 需鉴权（回环免） |

**为什么 live 与 ready 必须分开**：探针若在依赖故障时也变慢或失败，编排器会把"数据库卡住"
当成"进程死了"并重启 —— 那会把一次依赖故障**放大**成服务不可用。

**readiness 检查项**（`MetricCheck`：`{ id, ok, required, detail }`）：

| id | required | 判据 |
|---|---|---|
| `database` | ✅ | 任务表可读（`countByStatus` 成功） |
| `storage.writable` | ✅ | **真写一个探针文件再删掉**（`stat` 成功 ≠ `write` 成功：只读挂载 / 磁盘满 / 权限位） |
| `storage.headroom` | ❌ | 是否已超 `OUTPUTS_MAX_BYTES`（超了淘汰器会动手，但服务仍能干活） |
| `media.tools` | ❌ | ffmpeg / ffprobe 是否可用（云端轨不需要它；本地轨与缩略图需要） |

`required` 里任一失败 → **503 + `status: 'degraded'`**，且响应体**照样给完整 `checks`**（排错要看原因）。
**非 required 失败不降级** —— BYOK 部署（服务端没有 Key）、纯云端部署（没装 ffmpeg）都不该被判"不健康"。

**告警阈值**（`alerts[]`，**没越线就不出现** —— 噪声纪律：常年挂着一条 info 的告警等于没有告警）：

| 告警 id | 默认阈值 | env 覆盖 |
|---|---|---|
| `storage.warn` / `storage.critical` | 用量 ≥ 85% / ≥ 95%（或已超 `OUTPUTS_MAX_BYTES`） | `METRICS_STORAGE_WARN_RATIO` / `METRICS_STORAGE_CRITICAL_RATIO` |
| `webhook.pending` | 存在超过 300s 未投出的终态事件 | `METRICS_WEBHOOK_PENDING_WARN_SEC` |
| `webhook.failed` | 有 ≥ 1 条永久失败的投递 | `METRICS_WEBHOOK_FAILED_WARN_COUNT` |
| `task.stuck` | 有任务 `running` 超过 1800s（上游挂住 / 本地卡死） | `METRICS_TASK_STUCK_WARN_SEC` |
| `database.size` | 库 + WAL ≥ 512MB | `METRICS_DATABASE_WARN_BYTES` |

每条告警都带 `value` 与 `threshold`（**可复核**）；`status: 'degraded'` 只表示"有告警"，
**不表示进程不健康**（那是 ready 的职责）。

```ts
export interface MetricsResponse {
  generatedAt: number; uptimeSec: number;
  status: 'ok' | 'degraded';
  service: { name; version; nodeVersion; pid; cpuCount; rssBytes; heapUsedBytes };
  tasks: { byStatus: Record<string, number>; running: { cloud; local }; uncertain: number;
           window24h: { succeeded; failed; total } };   // uncertain = 可能已产生费用（§13 同口径）
  queue: { queued: number; running: number; oldestQueuedAgeSec: number | null };
  storage: { totalBytes; videoBytes; thumbBytes; assetBytes; maxBytes; usageRatio; overThreshold };
  database: { fileBytes; walBytes };                     // **只给体积，不给路径**（快照会被贴进工单）
  webhooks: { enabled; pending; failed; oldestPendingAgeSec: number | null };
  alerts: SystemAlert[]; thresholds: Record<string, number>;
}
```

**本版不做（如实登记）**：
① **Prometheus / OpenMetrics 文本导出** —— 形态选择：JSON 快照能被 `curl`/`jq`/客户脚本直接消费，
且与其它端点同一套鉴权；真要接 Prometheus，用一个外部 exporter 抓 `/api/metrics` 转换即可（无需我们改约定）；
② **告警外发通道**（邮件 / IM / 再发一条 Webhook）—— 本版只把"越线的事实"暴露在快照里；
③ **历史趋势**（时序库）—— 本版是**当前快照**，趋势由调用方自己存；
④ **链路追踪**（OpenTelemetry）—— 操作日志（§10）+ `requestId` 已能回答"这一次请求发生了什么"。

---

## 17. 备份与恢复（V2.17 新增；台账 B52 片 A）

> **为什么进契约**：备份/恢复的语义决定"客户的片子会不会丢"，而它比任何接口都更难事后补救。

**数据布局**（部署者只需知道这四样）：

| 路径 | 是什么 | 备注 |
|---|---|---|
| `data/app.db` | 任务 / 项目 / 日志 / Webhook 订阅与投递流水 | WAL 模式（`-wal` / `-shm` 是**派生文件**） |
| `data/server.lock` | **服务进程锁**（`{ pid, startedAt, version }`） | 服务启动时写、`onClose` 释放；备份 CLI 靠它判断"能不能恢复" |
| `outputs/` | 成片 / 缩略图 / 参考资产 | 见 §7 的生命周期与淘汰规则 |
| `data/backups/`（约定位置） | 备份产物 | 默认落在这里；可用 `--out` 改 |

**备份产物 = 一个目录**（不是 tar/zip）：

```
backups/backup-20261010-160000/
├── app.db            # VACUUM INTO 的**一致性快照**
├── manifest.json     # 见下（"这一份是完整的"的标记，最后才写）
└── outputs/…         # 成片与资产（--no-outputs 时没有这一层）
```

```ts
export interface BackupManifest {
  backupVersion: number;      // > 本机版本 → 恢复前必须升级服务（明确报这句话）
  createdAt: number; appVersion: string;
  includeOutputs: boolean;
  database: { path: 'app.db'; bytes: number; sha256: string };
  outputs: Array<{ path: string; bytes: number }>;   // 大文件只记字节数（逐字节 hash 代价与收益不成比例）
  counts: { tasks: number; projects: number; webhooks: number };
}
```

**为什么必须是 `VACUUM INTO` 而不是 `cp data/app.db`**：WAL 模式下直接拷库可能拿到
**缺了最近事务、甚至内部不一致**的文件（最新数据还在 `-wal` 里）。`VACUUM INTO` 是 SQLite 原生的
一致性快照 —— 这是"备份能不能用来恢复"的分界线，而一份拷出来的坏库只有真要恢复的那天才会被发现。

**恢复的三道安全闸门**（缺一不可）：

1. **服务进程锁**：检测到 `server.lock` 里那个 PID **还活着** → 拒绝恢复（消息里带上 PID 与启动时间）。
   ⚠️ **这道闸门不能省**（实测教训）：第一版只检查"数据库写锁"，而**空闲的服务不持有写锁** →
   判定放行 → 在 Windows 上 `EBUSY`（响亮失败），在 **Linux（部署目标）上 unlink 会成功**，
   服务继续往被删除的 inode 写 —— 运维以为恢复成功，实际"新库"与"跑着的服务"从此刻起各写各的。
   **陈旧锁**（PID 已不存在，异常退出留下的）→ 明确提示并放行（拿一把陈旧锁挡住灾难恢复更糟）。
2. **`--yes`**：恢复是**不可逆的整体替换**，必须显式确认。
3. **校验不通过不动数据**：`manifest` 可解析 + 版本兼容 + `app.db` 的 sha256 + 逐文件字节数。
   另外恢复前**自动把当前状态备一份**（`pre-restore-*`）—— 恢复错了还能回去。

**⚠️ 一条运维必读**：**用服务打开一份备份快照会改写它**（`openDatabase` 的幂等迁移 + 启动引导会写库、
还会生成 `-wal`）→ 之后 sha256 校验必然失败。**先 `verify`，再决定要不要打开看**。

**CLI**（先 `pnpm build`）：`node backend/dist/ops/cli.js <backup|verify|restore>`，
或 `pnpm --filter backend ops:backup` / `ops:verify` / `ops:restore`。备份**可以在服务运行时做**
（一致性快照），**恢复必须在服务停止后做**。

**本版不做**：① 备份的**加密与异地存放**（产物是普通文件，交给客户的存储策略：对象存储 / rsync / 磁带）；
② **增量备份**（`VACUUM INTO` 是全量；outputs 可自行用 rsync 做增量）；③ **自动定时备份**
（本版只提供工具与闸门，调度交给客户已有的 cron/计划任务）；④ **跨版本数据迁移**（向前兼容由 `COLUMN_MIGRATIONS`
保证，但"回退到旧版本"不在支持范围 —— 回退请用恢复）。

