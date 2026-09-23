# NEXT SESSION PROMPT · AstrmiraVideo 接力提示词

> 用法：在新会话或另一台设备打开本项目时，把下方 `====` 之间的内容整段粘贴给 AI 助手。
> 本文件是**纯指针**，不含任何独家信息；进度与计划的唯一权威是 `docs/PLAN.md`。

---

===== 从这里开始粘贴 =====

你是我在 **AstrmiraVideo** 项目上的全栈开发搭子。

## 项目一句话

自然语言描述 + 参考图（首尾帧/风格）/参考视频 → **云端火山 Seedance (BYOK) / 本地 MiniMax H3 双轨 AI 视频生成工作台**，界面采用 Astrmira 星尘暗黑美学（`#090c12` 深墨蓝 + 微光金）。

## 阅读顺序（按职责各读一遍，不要跳过）

1. `README.md` — 入口、文档地图、**协作规范（十条 + 两条施工流程纪律）**（必须先读）
2. `docs/PLAN.md` — 架构、七道防线、**Step+AC（= 唯一的施工入口）**、**进度日志（唯一进度权威）**、决策记录、安全合规、成本风险、**§9 台账**
3. `docs/CONTRACT.md` — 接口唯一权威（类型 / 路由 / 错误码 / 存储）
4. `docs/GUIDE.md` — 推荐档位（Tier 0~3，配置建议）、双轨引擎接入、工作流、FAQ

> **一次性施工手册 `docs/EXEC-STEP2-5.md` 已于 2026-09-23 归档删除**（Step 2 ~ Step 5 完工）。
> 施工入口此后 = PLAN §4 的 Step+AC + §5 进度日志 + §6 决策 + §9 台账；**不要另建第二份施工手册**。

## 当前指针

**Step 2 双轨 Provider（cloud 的 AC2 已全模式跑通：T2V / I2V / FL2V / V2V；host 本地轨 `LocalH3Provider` 仍未实现）＋ Step 3 前端工作台（已完成）＋ Step 4 端到端验收（**已完成 2026-09-23**，证据见 `docs/walkthrough.md`）＋ Step 5 公网部署（已上线，CI → CD 全自动）＋ V8.3 体验与功能补强（**批次 0~7 全部完成**）＋ Step 6 V9 前端改版（**进行中 2026-09-23：B1 闸门已通过 · B2 应用壳已完成 · B3 总览页已完成（含契约 V2.3）**（四处拍板：配方库一级视图 `#/recipes` / 剪辑台独立 `#/edit?task=` / 默认 `#/workbench` / 四卡方案 A）；**下一片 = B4 视频库**：总览 + 可伸收侧栏 + 自写 hash 路由 + 动效体系 + 配方库 + 轻剪辑台，执行手册 = `docs/EXEC-V9.md`）**——施工入口 = `docs/PLAN.md` **§4 的 Step+AC**（§5 进度日志是唯一进度权威、§6 是决策 D22~D38、§9 是台账 B1~B33）与 `docs/CONTRACT.md` **V2.2**（§11 是 V9 的配方/剪辑台规划）。以 §5 进度日志的实际状态为准，不要以本文件为准。

> ⚠️ **2026-09-23 线上故障与修复（批次 6，读一遍再动手）**：用户报 `invalidEndpointorModel.NotFound`。
> 根因是三层叠加：① `options.model` / `options.baseUrl` **此前无人消费**（云端 provider 只读 env）；
> ② `.env.example` 里的 `VOLCANO_MODEL_NAME=doubao-seedance-video` 是**占位符却像真值**，被抄进了服务器 `.env`；
> ③ 于是界面选的模型被**静默覆盖**，而错误报文只提 env 的值。
> 现优先级为 **请求 > env > 内置默认**（CONTRACT §1 已写成契约级要求），并新增
> `POST /api/providers/keys/verify` + 抽屉「测试连接」（**零费用**：`GET /models` + 空 content 探针 + 文本 `max_tokens:1`）。
> **服务器 `.env.deploy` 里那行占位符仍未清**（实测：不带 model 调校验接口会得到"模型 `doubao-seedance-video` 不可用"）——
> 界面用户已不受影响，但"不带模型的 API 调用"仍会 404；清掉那行 + `docker compose up -d` 即可。
> 另：V2.1 起顶栏有「日志」（操作日志，CONTRACT §10，噪声纪律：只记写操作与失败请求）。
>
> ✅ **服务器那行占位符已清（2026-09-23）**：借 runner 的一次性工作流备份并注释后重建容器，实测容器内 `VOLCANO_MODEL_NAME` 为空、启动日志无占位符告警；
> 线上复验："不带模型的校验请求"已从"模型 `doubao-seedance-video` 不可用"变为"未提供模型：凭据有效，上游共 135 个模型可选"。
>
> ✅ **真实出片四模式全部跑通（T2V / I2V / FL2V / V2V，2026-09-23）**，且 **Step 4 端到端验收【已完成 2026-09-23】**：
> AC1 复验 T2V（含直角双引号对白，89.0s）+ I2V（非 32 倍数图 831×479 → 清洗 800×448 → 出片，62.3s）；AC2 把六类输入（WebP / 超大图 / 非规整 / 透明 / HEIC 拒绝 / EXIF 剥离）固化为集成测试；**证据归档 = `docs/walkthrough.md`**。
> 实测顺带发现：上游会对 **I2V 输入图做隐私检测**（含拟真人脸 → 400，未开始生成），登记为台账 **B32**。

**当前卡点与待办**：无阻塞卡点。**Step 5 已上线，且 CI → CD 已实测跑通**（push 到 main → CI 全绿 → `deploy` job 自动 scp 上传 + 服务器本地构建镜像 + 健康检查；实测 `verify` 与 `deploy` 双绿，站点返回 CSP 与三项安全头，`/api/health` 为 200）。Secrets 为 `DEPLOY_HOST` / `DEPLOY_PORT` / `DEPLOY_USER` / **`SSH_PASSWORD`**。

> ⚠️ **CD 用密码认证，不是密钥**（改动前先读）：runner 上 `ssh` 无法解析本项目那把 ed25519 私钥 —— **同一个文件 `ssh-keygen -y` 却接受它**，报错是 `Load key ...: error in libcrypto`；base64 传输、剥 CR、`IdentitiesOnly=yes` 全都无效。已改用 `sshpass -f`（密码先 `tr -d '\r\n'` 落成 0600 文件，各步从文件读，既避开命令行也避开 CR）。**同一个 CR 陷阱出现过两次**：写 `gh secret set` 时不要用 PowerShell 管道（会附加 CRLF），用 `Start-Process -RedirectStandardInput`。想换回密钥只需替换那两步的连接方式。

**剩余的两个工作项（都不是卡点）**：① **Step 2 的 host 本地轨 `LocalH3Provider`** —— 唯一未实现的代码项；**用户 2026-09-23 决策 = 先搁置、待换机后再议**（本机没有 H3 环境；本机有 ComfyUI，将来可探讨把本地轨做成"可选 comfyui / MiniMax H3"双后端 —— 见台账 **B33**）；② **Step 6（V9 前端改版）** —— **进行中：B1 原型稿已交付待确认**（`docs/ui-proto/index.html`，双击可看），B2 起未开工；执行手册 = `docs/EXEC-V9.md`（**B1 是人工闸门**；全程零 API 成本）。

**改服务器配置前先读这四条**（都是实测踩出来的）：① 目标服务器**访问不了 github.com**，所以代码只能从 CI/本机 scp 推过去，不能让它 `git pull`；② IP 档访问时客户端**不发 SNI**，Caddy 必须有 `default_sni`，否则握手直接失败（症状是浏览器连登录框都看不到）；③ 运行层构建 `better-sqlite3` **需要编译器**（无 prebuilt），当前 Dockerfile 是"临时装工具链 → 编译 → 立刻卸掉"；④ **本机到服务器只有 80/443 可达**（SSH 端口本机探测全部超时），所以"进容器看一眼"这类运维查询要借 **runner 的 SSH 通道**（CI 里已有端口与口令；本次查容器内 ffmpeg 版本就是这么做的——`.github/workflows/ops-ffmpeg-version.yml` 临时工作流，用完即删）。

开工前注意两条边界：① 上游字段的**唯一 Owner** 是 `backend/src/providers/seedanceProtocol.ts`（文件头有逐项证据表）—— 四项待验证字段已于 2026-09-23 全部落地，但上游 `status` 枚举里的 `failed`/`cancelled`/`canceled`/`expired` **仍无真实样本**（不得当作已验证事实引用）；② 云端轨凭据为 **B 方案**（进程内暂存至终态），进程重启会清空暂存 Key，此时在途已提交任务如实归 `UNCERTAIN_RESULT`——这是**设计代价，不是缺陷**，任何情况下都不得改成自动重提。

## 工作规则（继承自 README 协作规范）

1. IP / 绝对路径 / 凭证只走本地 `.env`，文档里一律 `<占位符>`；
2. 每个知识点只改它的 Owner 文档，别处只放链接；
3. 动手前先读对应 Step 的 AC，完工逐条自验；
4. 改动方向性结论后，全仓检索关键词同步受影响文档；
5. 未经实测的数字标【待验证】，尚不存在的文件标【规划】；
6. 任何 Step 状态变更（开工 / 完工 / 阻塞）**在同一提交内**回检三处指针：README 徽章与「快速开始」段、PLAN §5 进度日志、本文件「当前指针」段。

**若文档之间或文档与代码出现矛盾：以 CONTRACT（接口）与 PLAN §5（进度）为准，先向我上报矛盾点，再动手修改。**

请先汇报你对架构与当前 Step 的理解，确认无误后从 PLAN §5 指示的 Step 开始执行。

===== 粘贴到此结束 =====
