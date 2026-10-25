# 交接审计证据（2026-10-25）

> 审计代码基线：`35cd070`。本文保存问题、复现方法和证据解释；进度与实测门禁只记在 [PLAN §5](PLAN.md#handoff-audit-status)，待办只记在 [PLAN §9](PLAN.md#handoff-audit-backlog)，实施 AC 见 [PLAN §4](PLAN.md#handoff-next-slice)，产品选项只记在 [PENDING](PENDING-DECISIONS.md#handoff-open-decisions)。本轮没有修改业务实现或重新定义接口。

## 证据范围

核对 README、PLAN 的实施标准/日志/决策/台账、CONTRACT V2.69、PENDING，以及即梦观察记录和本地截图；沿分镜展开、会话执行、ComfyUI 模板、画布保存与助手、备份路径核对代码和测试。即梦比较是已有截图的复核，不是本日在线产品全量调查，也不能从按钮推断其模型质量。

本地原始证据位于被 git 忽略的 `.tmp/handoff-audit/`：`gates.jsonl`、各门禁日志、`reproductions.json`、`browser-results.json`、`backup-results.json`、`project-results.json`、真实会话日志及媒体核验。脚本与数据只操作独立审计目录；受控 provider/HTTP 响应在下文明确标注，不充当真模型产物。原有应用和用户数据未被替换。

## 可复现的问题

### F1 · P1：创建会话即可能消耗算力，未等待显式启动【已验证】

- 触发：只调用 `POST /api/agent/runs`，不调用 `/start`，等待一个服务定时周期。
- 受控 fixture 应用实测：创建返回 `planned`；等待 6.2 秒后变 `running`，已有 taskId；`startCalls = 0`。
- 根因：`backend/src/runs/runStore.ts:listActive` 包含 planned；`backend/src/index.ts` 每 5 秒 tick；`creationRunEngine.ts:tick` 自行将 planned 改为 running。与 CONTRACT §29「由 POST /start 触发」矛盾，重启恢复也受影响。
- 测试盲区：路由测试只断言创建瞬间；引擎测试甚至将「tick planned 自动执行」写成预期。全绿不能证明用户启动边界正确。

### F2 · P1：参考模板缺失时退回普通文生图，参考图被静默丢弃【已验证】

- 触发：仅配置普通 FLUX t2i 模板，提交带 `assets.firstFrameImage` 的 t2i 请求。
- 受控网络实测：图片上传 1 次，`/prompt` 被接受，但工作流无 LoadImage / ReferenceLatent，参考未消费。
- 根因：`ComfyUiProvider.ts:pickTemplateForMode` 在 referenceImage 精确匹配为空时回退整个 candidates。modes 可用不代表该实例支持参考编辑。
- 修复约束：缺能力必须在生成提交前明确拒绝；不能以上传成功、普通图成功替代参考编辑成功。既有参考语义已足够支持这一修复，无需重新拍板。

<a id="reference-routing"></a>

### F3 · P1：「剧本 + 用户参考图」在带首帧生成的会话中没有完整消费链【已验证：纯转换 + provider 代码】

- `frontend/src/lib/storyboardLanding.ts:buildCreationRunInput` 给 image 步写空 `referenceAssetIds`；用户参考只传 video 步。
- 输入一镜、一个 imagePrompt、一个用户参考：image 请求没有 assets；video 请求为 `mode: i2v`，生成首帧进入 firstFrameImage，用户图被挤入 lastFrameImage。
- `creationRunEngine.ts:buildStepRequest` 不切 fl2v；ComfyUI 提交只上传首帧，尾帧没有消费路径。schema 接受最多 4 个参考/依赖，但消费并不覆盖全部。
- 结论：S9-A1 的「生成的首镜作为定妆锚点」确有实现；这不等于用户上传主体图已经参与定妆。S9-A1 的边界可以保留，接受后静默忽略输入不能保留。先显式拒绝无法表达的组合；主体锚点扩展取决于 PENDING N9。

### F4 · P1：切换画布会用 A 的助手历史覆盖 B 的历史【已验证：真实浏览器】

- 准备两个独立审计画布及不同 localStorage 历史；在 A 打开助手，保持助手打开，切到 B。
- 实测 B 显示 A 的文本，且 B 对应存储键也被写成 A 的文本。
- 根因：`CanvasAgentPanel.tsx` 的 useState 只在挂载时 load；保存 effect 却随 doc.projectId 更新。`CanvasStudioView.tsx` 的面板没有按画布重挂载；另一个输入框上的 key 不能保护它。
- PLAN S9-B「组件随视图卸载」不足以覆盖画布选择器切换，应偿还当时挂起的浏览器验收。纯函数存储测试只能证明键隔离，不能证明组件生命周期隔离。

### F5 · P1：备份校验成功，但不包含新画布文档【已验证】

- 在独立 DATA_DIR/canvas 创建审计文档，执行 `createBackup` 和 `verifyBackup`。
- 实测源文档存在；备份根只有 app.db、manifest.json；canvas 缺失；verify 仍返回成功。
- `backend/src/ops/backup.ts` 的备份/恢复只处理数据库和可选 outputs。CONTRACT §17 的老备份范围没有跟随 §21 的文件画布存储扩展。
- 影响：换机恢复不能还原这些画布；原机恢复可能留下与数据库时间点不一致的画布。本轮没有对用户数据执行 restore，也不声称已发生用户数据丢失。
- 后续必须先改备份契约，明确画布文档/墓碑/索引、旧备份兼容和恢复前保护，再用临时目录做完整恢复核验。

### F6 · P1（确认）/P2（关闭）：会话页缺少可操作的媒体闭环【已验证：真实浏览器 + 受控会话响应】

- awaiting-confirmation 详情提示逐镜检查，但只有截断产物 ID；本例 DOM 中图片、视频、链接均为 0。成功态也只显示拼接任务 ID，没有直接播放/下载入口。
- 已有「重出这张首帧」按钮，说明文案仍让用户到会话外重出。
- 点击关闭详情后，selectedId 未清除；下一轮轮询又展开详情，浏览器已复现。
- 375px 的本次两步骤样例没有横向溢出；没有据此宣称所有长标题/大量步骤移动端通过或失败。

### F7 · P1：自动拼接产物脱离原项目【已验证：隔离 fixture 全链路】

- 新建非默认业务项目，在该项目创建两个视频步骤的会话并跑到自动拼接。
- 生成任务继承原 projectId；拼接任务的 requestSnapshot 仍指向原项目，但 task.projectId 为 default。
- 根因：`backend/src/index.ts:runPorts.submitEdit` 调 queue.submit 漏传 projectId。项目筛选/交付归属因此不一致。
- 另一个静态缺口：CanvasAgentPanel 提交未传业务项目，RunsView 列表未传 project 筛选。注意 CanvasDoc.projectId 是画布标识，不应直接拿来填业务 projectId。

### F8 · P2：分辨率约束存在两次丢失【已验证，观测与确定性复现分开】

- 本次真模型剧本明确要求 480p，二次规划却输出全部 720p。这是一次实测；分镜表没有档位字段，展开请求只带 plan 和 references，不能假设自然语言参数会一直保留。
- `planComfyDimensions` 纯函数：1280×720、像素上限 921600 → 1280×736，warnings 为空；32 对齐后越过上限。480p 的默认预算也会将 853×480 缩为 832×480（这一分支有告警）。
- 因此「720p 一律落模板默认尺寸」不是当前代码的准确描述。应核对规划约束、请求尺寸、对齐预算、最终媒体四层；不能只改模板默认值。

### F9 · P2：自动拼接失败缺少会话内恢复路径【代码确认，未注入真实 ffmpeg 故障】

引擎以 `failure.stepId = assembly` 表达拼接失败，但 assembly 不在 steps；retry 路由只接受 steps 中失败的步骤。所有镜头已成功时无法只重试拼接，重建会话会浪费生成成果。需要独立拼接 attempt/幂等语义及失败后只重拼的验收；不能把重试键永久固定为 a0 后声称支持重试。

### F10 · P1：自动拼接重复首镜，成功状态没有保证正确成片【已验证：真模型媒体 + 代码】

- 本次 3 个镜头各 49 帧、24fps、2.041667 秒；无转场时应约 6.125 秒。实际成片 196 帧、8.166667 秒，恰好多一整段。
- `creationRunEngine.ts:buildAssemblyScript` 将首镜设为 sourceTaskId，却又把全部 taskIds 放进 concat。`pipeline/editExecutor.ts` 按 `[current, ...pendingConcat]` 拼接，实际顺序为首镜、首镜、第二镜、第三镜。
- CONTRACT §11 的 concat 明确是「追加到当前时间轴之后，不含源片自身」。应修会话 EDL 构造，不改旧剪辑器的追加语义。转场分支也会带上重复片段。
- 引擎单测目前断言了错误的 taskIds；J6 只验证成功及媒体字节数，没有镜头数量/顺序/时长断言。历史实测「3 镜×3 秒但成片 12 秒」也值得按同一原因回查，不能用可播放证明拼接正确。
- 建议同片 AC：2/3 个可区分 fixture 镜头，逐段核验顺序且每镜恰好一次；硬切总时长等于输入和（帧容差内）；转场总时长扣除正确接缝数；单镜不拼接。无需再次调用模型即可回归此问题。

## 契约、测试与文档的漂移

1. **契约测试能力被高估。** `backend/src/contract.test.ts` 验证 §5 声明路由已注册，以及 §6 错误码/处置等；路由没有完整「实现反查文档」校验，更没有解析所有类型字段和状态迁移。§29 的 F1、重试语义、summary 字段不会自动被它发现。
2. **CONTRACT 内部不同步。** §29 标题称已实现，局部路由表仍有【规划】且 retry 只写失败态；§5 已包含 S9-D。§29 未完整投影 totalStepCount；§21-11 的会话消费计划边/形成事实边描述，与 §29-1 的不改 CanvasDoc 边界需要统一。V2.67 修订行重复、V2.68 修订记录缺席；§19 模板数量及 sidecar 模式/参考声明也落后于代码。这里登记矛盾，不以审计名义偷偷改变接口。
3. **进度导航落后于日志。** PLAN §4 Step 11/12 标题仍带实施中，B76–B91 仍有旧阶段触发语句；以 §5 为准，不能据此重新做一次已完成工作。D75 正文写 steps≤16，但实现与 §29 是视频≤16、总步数≤32，属于需更正的措辞，不应把图+视频误减为 8 镜。
4. **入口描述滞后。** README 的旧契约版本徽章、旧工作台/成本台/编排与当前导航不完全一致；PENDING 尾部仍称 N5 开放。此次只修不涉及产品语义的指针，完整投影清理列入台账。
5. **641 个前端测试不是 641 个浏览器行为测试。** 纯转换、存储、视觉静态检查有价值；当前 smoke-ui 没有会话页面/分镜展开/助手会话切换路径。S8-E J6 是 HTTP fixture 会话，也不替代上述浏览器路径。按 D52 补 Playwright，不引入 jsdom。
6. **无图片步骤的首帧确认档。** 纯函数复现 readySteps 在 confirmedAt 缺省时仍返回 video（`!hasImages` 放行）；§29 的「无依赖视频也等确认」没有写此例外。补齐无图会话的契约口径与对应测试，不以 fixture 只跑视频掩盖差异。

## fixture 与真实执行之间的证据缺口

- fixture 可证明队列/状态/拼接，不证明模型库存、ReferenceLatent 被使用、实际宽高时长、峰值显存、采样中途图与角色一致性。
- `deepseek-run-e2e.mjs` 当前传 `references: []`，并没有把分镜转场填入会话；这次成功也不能为「上传参考图参与生成」或 S9-C 转场背书。
- 脚本自动 confirm，不是人的逐镜确认；start/confirm 没有检查 HTTP 状态；成功后只取任务 URL，不校验媒体。此次额外核验媒体，后续应补到可重复的验收工具。
- 分镜转场目前取首个识别结果、统一应用到接缝，是 S9-C 已登记的简化；不能把它当成任意逐镜转场支持，也不重复报成新缺陷。
- S9-D 重出定妆锚点不自动重出已成功后继：可能使首镜与后镜参考不同版本。是否传播失效涉及显式生成费用和现有「成功步不重跑」口径，见 N10。

## 技术债判断与不应误报的边界

- **CanvasDoc.version 与 revision：D70 正确。** 前者管文件格式，后者管并发写；不要合并。待补的是旧客户端读取新字段再保存的兼容验证；同为 version=1 时 schema 丢未知字段与 CAS 解决的是不同问题。
- **资产生命周期【待验证】**：storageEvict 的引用保护查询任务引用；尚未看到针对暂停会话/草稿 CanvasDoc 的完整引用保护。应做独立目录的小配额淘汰用例后再判断损失范围，本轮未执行破坏性淘汰。
- **未知创建结果【待验证】**：步骤幂等键含 runId，不能天然防止创建请求断线后再 POST 出两个 run。需要创建意图的恢复协议，不能用「确定性步骤 ID」证明跨会话去重。
- H3 作为远程 ComfyUI 实例是 D67；接上实例可以复用已支持协议，不等于满血模型所有 fl2v/v2v/音频能力都能零代码接通。租机后仍按 RUNBOOK G1–G14 验证具体工作流。
- D54 不做伪免费试跑；D55/D56 延后真实付费上游、客户专用交付包；D59/D60 不做身份/充值/协作；D62 不恢复旧独立工作台/成本台；D63 不迁移退役编排图；这些不算缺陷。独立剪辑台与画布不做一体时间线也是当前边界。
- 主体库与像素编辑是本次用户明确提出的新能力方向；扩图、蒙版重绘、超分需要真实工作流及能力门控，不能把自然语言参考派生改名为三项完成。

## 后续阅读

即梦逐项比较见 [JIMENG-GAP-AUDIT](JIMENG-GAP-AUDIT.md#handoff-comparison)。排序及下一片 AC 只维护在 [PLAN §4](PLAN.md#handoff-next-slice)；新产品选择只维护在 [PENDING N9–N11](PENDING-DECISIONS.md#handoff-open-decisions)。本审计不触发部署、付费 Seedance 测试或旧决策变更。
