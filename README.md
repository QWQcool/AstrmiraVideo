# AstrmiraVideo

> **一个人自用的 AI 视频 / 图片生成工作台**：自然语言 + 参考图 → 出片；引擎是你自己的 ComfyUI（本机显卡或租来的 GPU），
> 交互按**即梦**的样子做（画布编排、主体复用、素材条、时间轴剪辑）。

> **定位（说清楚，避免误会）**：这不是对外服务的产品 —— 没有注册登录、没有多租户、没有客户交付。
> 一台服务器当门面（站点 + 任务表 + 产物存储），算力挂在另一台 GPU 机器上（改一行 `COMFYUI_SERVERS_FILE` 即可扩到多台）。
> 站点前面有一层**站点自带的访问口令**（Caddy basic auth），不是用户体系，也**不打算改**。

[![Backend](https://img.shields.io/badge/backend-Node%2022%20%2B%20Fastify%205%20%2B%20SQLite-3178c6)](docs/CONTRACT.md)
[![Frontend](https://img.shields.io/badge/frontend-React%2019%20%2B%20Vite%206-61dafb)](docs/CONTRACT.md)
[![Contract](https://img.shields.io/badge/CONTRACT-V2.111-success)](docs/CONTRACT.md)

## 现在能做什么

**生成**

- **本地轨 `host-comfyui`**：ComfyUI 是你自己装的，模型/模板也由你决定 —— 本仓只做接口适配。
  文生视频 / 图生视频 / **首尾帧** / 文生图 / 参考图驱动，都走**模板**（`COMFYUI_TEMPLATE_DIR` 里放 JSON，占位符替换成参数）。
  可配多台（一台 3080 跑 480p、一台 5090 跑 720p，界面分别选）。
  实测口径（2026-10-30，RTX 4080 32GB + ComfyUI 0.43）：H3 **i2v** 首帧 SSIM 0.968、**fl2v** 608×352×124 帧 **173s**（热）/294.7s（冷）；
  MOSS **t2i** 1024×576。耗时随「分辨率 × 帧数 × 步数」走，界面会按真机系数给预期。
- **云端轨 `cloud-volcano-seedance`**：火山方舟 Seedance，**BYOK** —— Key 只存在你自己的浏览器，服务端过手不留存。
  需要账号**开通对应模型**，没开通时它如实报错（不是静默失败）。
- **提交前估价**：按公开价目算一个"大约多少钱"，纯前端算、不落库。真实扣费以方舟账单为准。

**画布与编排**

- `#/canvas`：节点图编辑与生成；参考图可来自素材库或**主体库**（主体 = 名字 + 参考图，拖进节点后落成一条带 `subjectId` 的引用，
  删掉主体也不会把节点弄坏，只显示"未知主体"）。
- `#/plan`：编排独立页 —— 建节点、连边、看拓扑执行顺序与**每个节点的阻塞原因**、运行、单节点重试。
  幂等键确定性（连点不会重复计费），重跑/重试显式换代。
- `#/stats`：耗时 p50/p95、失败码分布、ComfyUI 进度通道连接事实。**成本只在这里说清口径**，不给金额。

**声音（V2.103 起）**

- 剪辑台右侧「③ 声音」面板：写台词 → **配音**，写描述 → **配乐 / 音效**；生成完**自动落到音效轨**
  （超出片长裁齐、配乐不够长自动循环铺满、配乐默认音量 0.35 压在旁白下面）。
- 两条引擎，**数据去向不同**且界面如实标注：配音走 **MiMo TTS（第三方云，文本会出网）**；
  配乐/音效跑在**你自己的 ComfyUI**（Stable Audio 3 Small，不出机器）。
- 引擎不可用时**点之前就说明缺什么**（`GET /api/audio/engines` 查的是"配置 + 权重都在吗"），
  接口层也是 503 而不是"先接单再失败"。

**成片之后**

- 浏览器端剪辑台（多轨时间轴 · 转场/字幕/音效 · 导出即入库），导出走 WebCodecs，不占服务器算力。
- 视频库 / 操作日志 / 项目维度（多项目隔离，切项目即切素材与历史）。
- **画布不会悄悄丢东西**：打开不白写、每次修改串行落盘（`revision` 乐观锁）、响应丢失时同内容重放算成功、
  画布被别处删除时给「另存为新画布」、两个标签同时编辑会互相提示、提交后没拿到任务号的批次在顶栏报「待核对」。

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
pnpm smoke:ui                    # 可选：真 Chrome 跑一遍生产形态的 UI 冒烟（**不在 CI 门禁里**，见 AGENTS.md 第 1 条）
```

**验收命令一览**（每条都写明"证明什么"，见 [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)）：

```bash
pnpm smoke:image      --seed <原始照片>   # 超清 2× / 蒙版重绘（内外 PSNR）/ 扩图（几何 + 新区域）
pnpm smoke:audio      # 旁白 + 配乐两层声音真的在成片里（窄带频谱归因）
pnpm smoke:audio:panel# 面板一条龙：文本 → 音频 → 自动落轨 → 导出
pnpm smoke:audio:prod --base <部署地址>   # 部署上的两个音频引擎能不能出音频
pnpm smoke:fl2v       --base <ComfyUI> --first A.png --last B.png   # 首尾帧接线 + 相对 SSIM 归属
pnpm smoke:canvas:save# 画布不白写 / 第一次修改必落盘 / 跨标签提示 / 删除后救援 / 待核对徽章
pnpm smoke:offline    --base <部署地址>   # GPU 关机时：该 503 的 503、云端配音照常
```

本地轨要显式开启（默认关）：

```bash
EXPOSE_HOST_LOCAL_TRACK=1
COMFYUI_BASE_URL=http://127.0.0.1:8188
COMFYUI_TEMPLATE_DIR=./comfy-templates     # 模板 JSON 放这里
PUBLIC_BASE_URL=http://127.0.0.1:3000      # 引用 task: 产物给上游下载时必填

# 声音（可选，两件独立的事）
COMFYUI_AUDIO_BASE=http://127.0.0.1:8190   # 配乐/音效用：装了 Stable Audio 权重的那台 ComfyUI
MIMO_API_KEY=...                           # 配音用：第三方云，文本会离开这台机器（放不放由你决定）
```

引擎能不能用，不用猜 —— 面板会显示真实状态；也可以直接问：

```bash
curl -s http://127.0.0.1:3000/api/audio/engines
# {"engines":[
#   {"engine":"mimo-tts","available":true},
#   {"engine":"host-stable-audio","available":false,"reason":"连不上 http://127.0.0.1:8190 —— …"}
# ]}
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

## 文档地图

**完整清单与每篇的状态见 [docs/README.md](docs/README.md)**（唯一位置，含"哪篇是权威、哪篇是历史快照"）。
最常看的四篇：

| 文档 | 什么时候看 |
|---|---|
| [docs/GUIDE.md](docs/GUIDE.md) | 上手：怎么用界面（含**声音面板**与**画布的数据安全**，带截图） |
| [docs/CONTRACT.md](docs/CONTRACT.md) | 改接口/请求体/画布文档结构前（**协议唯一真相**，先改它再改代码） |
| [docs/PLAN.md](docs/PLAN.md) | 看进度、决策、待办（§5 台账 / §6 决策 / §9 backlog） |
| [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) | 验收"某个能力真的能用"的命令与判据 |

## 协作约定（给未来的自己和 AI 会话）

1. **契约先行**：任何请求体 / 文档结构 / 路由变化，先改 CONTRACT（版本号递增），再改代码。
2. **不假装可用**：没有能力就给"为什么 + 怎么办"，不做无反应的按钮，不造假进度与假金额。
3. **数字必须真实**：耗时、成本、成功率都从真实记录来；口径句由服务端下发，界面不自己写一版。
4. **原子提交**：一项一个 commit，写完就推；不攒一坨。
5. **注释写"为什么"**，不写"做了什么"。
6. **门禁**：`pnpm lint && pnpm type && pnpm test:contract && pnpm test:coverage && pnpm --filter frontend test && pnpm build`
   （与 CI 一致）。**`pnpm smoke:ui` 与视觉自检不在门禁里** —— 见 [AGENTS.md](AGENTS.md) 第 1 条，
   它们是本地可选项，别拿它们当提交前的必过关卡。
7. **删功能要连根**：路由 / 契约 / 表 / 字典 / 验收断言一起删，否则会留"半个功能"。
8. **做好测什么、不测什么**：只测"错了会丢数据 / 花错钱 / 给出错结论"的东西，
   UI 观感与开屏耗时**不测**（[AGENTS.md](AGENTS.md) 第 1 条）。

## License

个人项目，不对外提供服务。第三方素材与工具的来源与许可登记见 [NOTICE](NOTICE)。
