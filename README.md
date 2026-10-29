# AstrmiraVideo

> **一个人自用的 AI 视频 / 图片生成工作台**：自然语言 + 参考图 → 出片；引擎是你自己的 ComfyUI（本机显卡或租来的 GPU），
> 交互按**即梦**的样子做（画布编排、主体复用、素材条、时间轴剪辑）。

> **定位（说清楚，避免误会）**：这不是对外服务的产品 —— 没有注册登录、没有多租户、没有客户交付。
> 一台服务器当门面（站点 + 任务表 + 产物存储），算力挂在另一台 GPU 机器上（改一行 `COMFYUI_SERVERS_FILE` 即可扩到多台）。
> 站点前面有一层**站点自带的访问口令**（Caddy basic auth），不是用户体系，也**不打算改**。

[![Backend](https://img.shields.io/badge/backend-Node%2022%20%2B%20Fastify%205%20%2B%20SQLite-3178c6)](docs/CONTRACT.md)
[![Frontend](https://img.shields.io/badge/frontend-React%2019%20%2B%20Vite%206-61dafb)](docs/CONTRACT.md)
[![Contract](https://img.shields.io/badge/CONTRACT-V2.100-success)](docs/CONTRACT.md)

## 现在能做什么

**生成**

- **本地轨 `host-comfyui`**：ComfyUI 是你自己装的，模型/模板也由你决定 —— 本仓只做接口适配。
  文生视频 / 图生视频 / 首尾帧 / 文生图 / 参考图驱动，都走**模板**（`COMFYUI_TEMPLATE_DIR` 里放 JSON，占位符替换成参数）。
  可配多台（一台 3080 跑 480p、一台 5090 跑 720p，界面分别选）。
- **云端轨 `cloud-volcano-seedance`**：火山方舟 Seedance，**BYOK** —— Key 只存在你自己的浏览器，服务端过手不留存。
  需要账号**开通对应模型**，没开通时它如实报错（不是静默失败）。
- **提交前估价**：按公开价目算一个"大约多少钱"，纯前端算、不落库。真实扣费以方舟账单为准。

**画布与编排**

- `#/canvas`：节点图编辑与生成；参考图可来自素材库或**主体库**（主体 = 名字 + 参考图，拖进节点后落成一条带 `subjectId` 的引用，
  删掉主体也不会把节点弄坏，只显示"未知主体"）。
- `#/plan`：编排独立页 —— 建节点、连边、看拓扑执行顺序与**每个节点的阻塞原因**、运行、单节点重试。
  幂等键确定性（连点不会重复计费），重跑/重试显式换代。
- `#/stats`：耗时 p50/p95、失败码分布、ComfyUI 进度通道连接事实。**成本只在这里说清口径**，不给金额。

**成片之后**

- 浏览器端剪辑台（多轨时间轴 · 转场/字幕/音效 · 导出即入库），导出走 WebCodecs，不占服务器算力。
- 视频库 / 操作日志 / 项目维度（多项目隔离，切项目即切素材与历史）。

## 明确不做（与做了的一样重要）

| 不做 | 原因 |
|---|---|
| 账号体系 / 多租户 / 对外交付 | 只有我一个人用（2026-10-28 拍板）。交付包、Webhook、成本台账、备份恢复**已从代码里删除** |
| 集成"开箱即用"的模型 | 模型与工作流由你在 ComfyUI 里决定 —— 本仓不绑定任何具体模型 |
| 假装能跑的能力 | 没有模板、没有模型、没有 Key 时一律**明确拒绝并给下一步**，不做点了没反应的按钮、不编造假进度 |
| 演示引擎冒充真实生成 | 夹具 provider 只用于 CI/冒烟，界面上必须显示它的身份 |

## 快速开始

```bash
cp .env.example .env          # 至少填 COMFYUI_BASE_URL（或用 X-Provider-Key 走云端）
pnpm install
pnpm dev                      # backend + frontend（Vite 热更）

# 按"线上那份形态"在本机验收（单进程托管 API + /media + 前端产物）
pnpm build && pnpm serve:local   # → http://127.0.0.1:3000（--fixture 可零成本造验收数据）
pnpm smoke:ui                    # 真 Chrome 跑一遍生产形态的 UI 冒烟
```

本地轨要显式开启（默认关）：

```bash
EXPOSE_HOST_LOCAL_TRACK=1
COMFYUI_BASE_URL=http://127.0.0.1:8188
COMFYUI_TEMPLATE_DIR=./comfy-templates     # 模板 JSON 放这里
PUBLIC_BASE_URL=http://127.0.0.1:3000      # 引用 task: 产物给上游下载时必填
```

配完重启，用左栏「🔍 检测本地引擎」确认——它会**真的连一次**并逐台报告。
Node 版本：**22 = 事实源**（`.nvmrc` + CI + 生产镜像三处同源）。

## 架构一屏

```
浏览器 ── HTTPS ──> Caddy（站点口令 + 反代）
                      │
                      ├── /api/*  ──> Fastify（任务表 SQLite / 产物 / 调度 / 模板注入）
                      └── /media/* ──> 产物直链（Range 可拖动）

Fastify ── HTTP ──> 你的 ComfyUI（本机 3080 或租来的 5090，可多台）
        └─ HTTPS ─> 火山方舟（BYOK：Key 来自请求头，不落库）
```

站点不需要 GPU；GPU 机器上只要跑 ComfyUI + 放模型。租卡时的选型、权重清单、验证步骤见
[docs/LOCAL-GPU-DEPLOY.md](docs/LOCAL-GPU-DEPLOY.md)，部署流程见 [docs/DEPLOYMENT-RUNBOOK.md](docs/DEPLOYMENT-RUNBOOK.md)。

## 项目结构

```
packages/shared/   契约（zod）+ 前后端共用纯函数：请求、任务视图、画布文档、编排、主体、观测
backend/src/       Fastify 路由 / provider（comfyui、volcano）/ 队列 / store / 观测
frontend/src/      React 视图（创作、总览、视频库、画布、编排、观测、技能、会话、日志）+ 画布引擎
scripts/           本地托管、UI 冒烟、ComfyUI 验收、部署
```
契约（[docs/CONTRACT.md](docs/CONTRACT.md)）是**协议唯一真相**：改请求体/文档结构先改它，再改代码。
后端 zod 会把未知字段**静默剥掉**，所以"只改前端"必然表现成功能没生效。

## 文档地图（每个知识点只有一个所有者）

| 文档 | 独占的内容 |
|---|---|
| [docs/CONTRACT.md](docs/CONTRACT.md) | 数据契约与接口（请求/响应/错误码/画布文档/编排/主体库/观测） |
| [docs/PLAN.md](docs/PLAN.md) | 当前计划（§4 分片与 AC）、决策记录（§6）、安全（§7）、成本（§8）、待办台账（§9）、待拍板（§10） |
| [docs/GUIDE.md](docs/GUIDE.md) | 上手指南：档位、双轨接入、四种工作流、界面导览、FAQ、日志与巡检 |
| [docs/LOCAL-GPU-DEPLOY.md](docs/LOCAL-GPU-DEPLOY.md) | 租卡资料：H3 选型/权重/网络、FLUX、多实例调度 |
| [docs/DEPLOYMENT-RUNBOOK.md](docs/DEPLOYMENT-RUNBOOK.md) | 部署与升级步骤、线上自检清单 |
| [docs/JIMENG-REFERENCE.md](docs/JIMENG-REFERENCE.md) | 即梦观测与差距审计（要复刻什么、已复刻多少） |
| [docs/CREATION-EXPERIENCE-DESIGN.md](docs/CREATION-EXPERIENCE-DESIGN.md) | 交互定稿（布局/层级/文案规格） |
| [docs/REFERENCES.md](docs/REFERENCES.md) | 外部参考（n8n / infOS / 上游台账 / MOSS 评估） |
| [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) | 验收命令及适用条件 |

## 协作约定（给未来的自己和 AI 会话）

1. **契约先行**：任何请求体 / 文档结构 / 路由变化，先改 CONTRACT（版本号递增），再改代码。
2. **不假装可用**：没有能力就给"为什么 + 怎么办"，不做无反应的按钮，不造假进度与假金额。
3. **数字必须真实**：耗时、成本、成功率都从真实记录来；口径句由服务端下发，界面不自己写一版。
4. **原子提交**：一项一个 commit，写完就推；不攒一坨。
5. **注释写"为什么"**，不写"做了什么"。
6. **门禁**：`pnpm lint && pnpm type && pnpm test:contract && pnpm --filter backend test && pnpm --filter frontend test`；
   改前端后必须 `pnpm build` 再 `pnpm smoke:ui`（冒烟跑的是 dist）。
7. **删功能要连根**：路由 / 契约 / 表 / 字典 / 冒烟断言 / 视觉自检清单一起删，否则会留"半个功能"。

## License

个人项目，不对外提供服务。第三方素材与工具的来源与许可登记见 [NOTICE](NOTICE)。
