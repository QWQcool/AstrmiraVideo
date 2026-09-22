# NEXT SESSION PROMPT · AstrmiraVideo 接力提示词

> 用法：在新会话或另一台设备打开本项目时，把下方 `====` 之间的内容整段粘贴给 AI 助手。
> 本文件是**纯指针**，不含任何独家信息；进度与计划的唯一权威是 `docs/PLAN.md`。

---

===== 从这里开始粘贴 =====

你是我在 **AstrmiraVideo** 项目上的全栈开发搭子。

## 项目一句话

自然语言描述 + 参考图（首尾帧/风格）/参考视频 → **云端火山 Seedance (BYOK) / 本地 MiniMax H3 双轨 AI 视频生成工作台**，界面采用 Astrmira 星尘暗黑美学（`#090c12` 深墨蓝 + 微光金）。

## 阅读顺序（按职责各读一遍，不要跳过）

1. `README.md` — 入口、文档地图、**六条协作规范**（必须先读）
2. `docs/PLAN.md` — 架构、七道防线、Step+AC、**进度日志（唯一进度权威）**、决策记录
3. `docs/CONTRACT.md` — 接口唯一权威（类型 / 路由 / 错误码 / 存储）
4. `docs/GUIDE.md` — 推荐档位（Tier 0~3，配置建议）、双轨引擎接入、工作流、FAQ
5. `docs/EXEC-STEP2-5.md` — **施工手册**（Step 2 ~ Step 5 的唯一施工权威；一次性手册，Step 5 验收后归档删除）

## 当前指针

**Step 2 双轨 Provider（仅剩 AC2）＋ Step 3 前端工作台（已完成）＋ Step 5 公网部署（已上线，CI → CD 全自动）＋ Step 4 端到端验收（阻塞于同一把 Key）**——施工步骤以 **`docs/EXEC-STEP2-5.md` 为唯一权威**（分段施工卡 + 片内改动清单 + 破坏性验证 + 证据格式；**Step 2-AC2 与 Step 4 尚未验收，该手册继续保留、不提前归档**）；决策见 `docs/PLAN.md` §6（D22~D28）与 `docs/CONTRACT.md` **V1.8**；主动降级 / 延后项见 `docs/PLAN.md` **§9 待优化台账（B1~B19）**。以 §5 进度日志的实际状态为准，不要以本文件为准。

**当前卡点与待办**：**Step 5 已上线，且 CI → CD 已实测跑通**（push 到 main → CI 全绿 → `deploy` job 自动 scp 上传 + 服务器本地构建镜像 + 健康检查；实测 `verify` 与 `deploy` 双绿，站点返回 CSP 与三项安全头，`/api/health` 为 200）。Secrets 为 `DEPLOY_HOST` / `DEPLOY_PORT` / `DEPLOY_USER` / **`SSH_PASSWORD`**。

> ⚠️ **CD 用密码认证，不是密钥**（改动前先读）：runner 上 `ssh` 无法解析本项目那把 ed25519 私钥 —— **同一个文件 `ssh-keygen -y` 却接受它**，报错是 `Load key ...: error in libcrypto`；base64 传输、剥 CR、`IdentitiesOnly=yes` 全都无效。已改用 `sshpass -f`（密码先 `tr -d '\r\n'` 落成 0600 文件，各步从文件读，既避开命令行也避开 CR）。**同一个 CR 陷阱出现过两次**：写 `gh secret set` 时不要用 PowerShell 管道（会附加 CRLF），用 `Start-Process -RedirectStandardInput`。想换回密钥只需替换那两步的连接方式。

**唯一剩余卡点是一把可用的火山方舟 Key** —— 它同时解锁 Step 2-AC2（真实出片冒烟 + 回填 §8 成本表）与 Step 4（端到端验收，其 AC1 明确要求用真实云端轨跑 T2V + I2V）。

**改服务器配置前先读这三条**（都是实测踩出来的）：① 目标服务器**访问不了 github.com**，所以代码只能从 CI/本机 scp 推过去，不能让它 `git pull`；② IP 档访问时客户端**不发 SNI**，Caddy 必须有 `default_sni`，否则握手直接失败（症状是浏览器连登录框都看不到）；③ 运行层构建 `better-sqlite3` **需要编译器**（无 prebuilt），当前 Dockerfile 是"临时装工具链 → 编译 → 立刻卸掉"。

开工前注意两条**尚未实测**的边界：① S5b 的上游字段（请求体结构、`--` 尾缀参数、`status` 枚举、`content.video_url` 位置）全部集中在 `backend/src/providers/seedanceProtocol.ts` 并逐项标注【待验证】，AC2 冒烟时逐项核对，**不得当作已验证事实引用**；② 云端轨凭据为 **B 方案**（进程内暂存至终态），进程重启会清空暂存 Key，此时在途已提交任务如实归 `UNCERTAIN_RESULT`——这是**设计代价，不是缺陷**，任何情况下都不得改成自动重提。

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
