# AstrmiraVideo · 产品与开发规划（PLAN V8.2）

> **修订说明（V8.2，2026-09-22）**
> 1. 落地 Step 2 开工前的四项架构决策：**探针降级**（D22：取消一切自动硬件扫描，Tier 改「推荐配置说明」「不参与自动锁定」）、**BYOK Key 客户端持有**（D23：`X-Provider-Key` 过手不留存）、**供应商聚合边界**（D24：文本侧单实现 + 未配置显式拒绝）、**D21 拆分时点**（D25：限流键先 IP 单键）；
> 2. §6 追加 **D22 ~ D28**；§1 架构图与「双轨调度原则」、§3 防线 1 / 防线 3 补入本地轨 **scope 分裂**（host = Step 2；client = 台账 B1）的落点；§4 Step 2 任务行与 **AC6 / AC9**、Step 5 **AC2** 按新口径改写；
> 3. §7-1 密钥管理措辞改写（Key 客户端持有、服务端过手不留存；D3 措辞同步修正），§7-3 / §7-4 / §7-5 补白名单与时点口径；
> 4. **新增 §9 待优化台账（B1 ~ B15）**：本次主动降级项与延后项的**唯一权威位置**，含每项「何时必须做」；
> 5. 施工入口：Step 2 ~ Step 5 的施工步骤以 `docs/EXEC-STEP2-5.md` 为**全仓唯一施工权威**（一次性手册，Step 5 验收后归档删除）。**〔2026-09-22 更新：Step 2-AC2 与 Step 4 仍阻塞于同一把 Key，手册据此**继续保留**（不提前归档）；其中仍然生效的验收口径已补入 §4 各 Step 的 AC〕**

> **修订说明（V8.1，2026-09-22）**
> 1. 新增 §7-4 ~ §7-6 安全加固（公网最小鉴权 / 限流键定义 / 上传与静态面加固），§6 追加 D18 ~ D21；
> 2. §4 补入 **Step 1.5 地基整改**索引；Step 2 补齐防线 5 与上传加固的任务与 AC；Step 3 承接视觉收口（keyframes / 索引号 / 水印）；
> 3. 正文与版本标签统一为 V8.1（此前 §7 已标注「V8.1 新增」但标题仍为 V8.0，属一致性缺口）。

> **修订说明（V8.0）**
> 1. 合并原 ROADMAP.md：进度日志、Step 清单、接力信息统一收归本文，全项目仅此一份进度权威；
> 2. 全文脱敏占位符化：真实 IP / 路径 / 凭证只存本地 `.env`（模板见根目录 `.env.example`）；
> 3. 每个 Step 补齐验收标准（AC）与验证方式；
> 4. 新增 §6 决策记录，关键取舍的 why 留档，后续删改有据可查；
> 5. 引入三级标记：**【已验证】**＝实测确认；**【待验证】**＝数字/能力未经实测；**【规划】**＝文件/功能尚不存在，不得当作事实引用。

---

## 1. 架构总览：双轨生成中枢

```
                           【客户端浏览器】 (React 19 + Astrmira 视觉)
           - Prompt 输入（带字数提示）+ ✨一键扩写
           - 参考图上传（带 32 倍数裁切预览）
           - BYOK 云端 Key 输入 / 本地 Worker 目录配置
           - localStorage 任务 ID 持久化（刷新自动重挂载）
                                       │
                                       ▼ HTTP（轮询；SSE 为【规划】）
┌────────────────────────────────────────────────────────────────────────┐
│                        【Fastify 后端调度中枢】                         │
│  ├─ 图像清洗网关 (防线 4：EXIF 方向 / CMYK→sRGB / 大图下采样 / 32 倍数规整)  │
│  ├─ 短窗口防抖限流 (60s 冷却，防连点刷 Token)                           │
│  ├─ 磁盘防护 (中间帧即时删除；画廊**手动删除**释放磁盘——容量淘汰暂缓，见 §9-B22) │
│  ├─ 任务存储 (SQLite：任务状态 + 参数快照 + 画廊元数据)                 │
│  └─ 双轨调度器（cloud 并发 / host-local 互斥 Concurrency=1）；          │
│     client-local 轨为旁路，服务端不调度（台账 B1）                      │
└───────────────────┬────────────────────────────────┬───────────────────┘
                    │                                │
                    ▼                                ▼
         【云端 API 引擎】                      【本地推理 Worker】
       火山方舟 (Seedance API)                MiniMax H3 (DiffSynth-Studio)
    - 用户自备 Key (BYOK)                 - 单机或局域网私有 GPU
    - 异步轮询任务获取成片直链             - 单卡排队互斥执行
    - 无需本地显卡                        - 0 Token 成本，原生立体声对白
                    │                                │
                    └────────────────┬───────────────┘
                                     ▼
                     【流式输出】HTTP 206 断点续传播放器 + MP4 下载
```

**双轨调度原则**：状态端点（`GET /api/providers/status`）**只报告本服务已配置的本地引擎自检结果**（D22），**不替访问者判断设备能力**——它不扫描、不广播、不返回任何未经显式配置的硬件信息，也**不得**用"你的设备 / 你没有显卡"这类措辞；本地轨由部署者**显式配置启用**（`EXPOSE_HOST_LOCAL_TRACK`，默认关闭，D26）。Tier 0~3 降级为**推荐配置说明**（[GUIDE.md](GUIDE.md) §一），**不参与任何自动锁定或置灰**。**不硬编码任何具体显卡型号或本机路径。**

---

## 2. Phase 1 MVP 功能特性（P0）

### 2.1 核心工作流
1. **多模态输入控制台**
   - 文本提示词输入（双引号对白可生成带语音视频，带字数安全指示）；
   - ✨ 提示词扩写助手：一键补充景深、光影、运镜描述词；
   - 参考图拖拽槽：起始帧（I2V）/ 结束帧（FL2V），自动 32 倍数居中裁切；
   - 参考视频拖拽槽：动作/风格参考（V2V）；
   - 画幅与模式切换：16:9 / 9:16（MVP）；1:1 为云端可选项（【待验证】本地 H3 支持度）。
2. **双模执行引擎**
   - 云端模式（BYOK）：设置抽屉填入火山方舟 Key 即可出片；
   - 本地模式（H3）：配置 `<LOCAL_H3_DIR>`（env `H3_WORKDIR`，默认 `%USERPROFILE%\Desktop\MiniMaxH3`），或输入已有 ComfyUI 地址，单卡互斥锁保护。
3. **沉浸式视窗与画廊**
   - 播放视窗：全屏 / 循环 / 音量 / MP4 下载；
   - 历史画廊：参数一键回填、单片删除释放磁盘。

### 2.2 健壮性要求
全部见 §3 七道防线，本节不重复。

---

## 3. 七道业务防线（全项目唯一详写处，其他文档只准链接本节）

| # | 防线 | 机制 |
|---|---|---|
| 1 | 本地单卡排队互斥锁 | **host scope**（本地引擎跑在部署主机上，Step 2）：服务端 `local` 轨 Concurrency = 1，后续任务进入 `queued`；**client scope**（本地引擎跑在访问者自己的机器上，台账 B1）：worker 自身单并发锁，服务端不调度 |
| 2 | 刷新断线不丢任务 | 任务状态落 SQLite（`data/app.db`），前端 `localStorage` 存任务 ID，刷新自动重挂载进度 |
| 3 | 磁盘空间防护 | 合成结束立即物理清理中间帧与临时音频（**host scope** → `outputs/.tmp/<taskId>/`；**client scope** → 落在用户机器、由 worker 清理并回报 `tmpCleaned`，写入 `warnings[]`；服务端无法强制验证该事实，UI 文案不得声称"已由服务端清理"）；画廊**手动删除释放磁盘**（**容量淘汰暂缓**，见 §9-B22）；前端一键删除。⚠️ 现状：清理机制已就位，但**当前生产链路没有中间帧生产者**（`outputs/.tmp` 尚无写入方），属预留兜底 |
| 4 | 图像格式清洗网关 | **已落地**（`pipeline/imageSanitize.ts`）：EXIF 方向矫正 / CMYK→sRGB / 超大图下采样（长边 ≤ 2048）/ 32 倍数规整 / 剥离元数据；带透明通道保 PNG、其余转 JPEG。`.heic`（HEVC）按实测能力**诚实拒绝**（415 + 转格式指引，见 §9-B21） |
| 5 | 短窗口防抖限流 | 提交后 60s 冷却，防连点刷光云端 Token |
| 6 | 台词长度友好引导 | 双引号对白建议 ≤ 20 字，匹配 5 秒镜头节奏 |
| 7 | **付费不确定性不自动重提** | 已提交但无法确认结果 → `UNCERTAIN_RESULT`，**禁止任何自动重提**，走人工核对路径；配套幂等键 + 提交前 `submitting` 落库（细则见 CONTRACT §5 / §6） |

---

## 4. 实施步骤（任务 + 验收标准 + 验证方式）

```
[Step 1 骨架] ──► [Step 1.5 地基整改] ──► [Step 2 双轨中枢] ──► [Step 3 前端工作台] ──► [Step 4 本地验收] ──► [Step 5 公网部署]
```

### Step 1：全栈骨架与设计 Token 落地
- **任务**：`backend/`（Fastify + TS + tsx + zod + pino）；`frontend/`（Vite + React 19 + TS）；`tokens.css` 落地 Astrmira 19 个 CSS Tokens；根目录 `pnpm dev` 并行启动脚本。
- **AC1**：`pnpm dev` 一条命令同时拉起前后端，前端能拿到后端 `GET /api/health` 的 200 响应。
- **AC2**：前端页面渲染出 Astrmira 暗色基底（`#090c12`）与金色点缀，无默认白页。
- **验证**：人工开箱 + `curl /api/health`。

### Step 1.5：地基整改（**已完成**，验收记录见 §5 进度日志）
- **范围**：占位探针去硬编码（T1）· `packages/shared` 契约包（T2）· zod 路由校验（T3）· 真实 inject 测试（T4）· 前端 token 化 + 字体 / eyebrow 修正（T5）· `JobQueue` 接口骨架（T6）；
- **不变量**：不实现任何 provider、不实现队列 / 幂等 / 防抖、不拆前端组件、不做 keyframes 落位；
- **前置**：本 Step 全部 AC 通过并记录于 §5 后，Step 2 方可开工（**已满足**）。

### Step 2：双轨 Provider 与核心调度
- **实施顺序（已定）**：`OI-2 夹具 provider` → 公共链路（存储 / 画廊 / 206 / 磁盘 / 幂等键）→ `Seedance`（AC2，真金白银）→ `OI-1 素材`。理由：公共链路是所有 provider 的共同地基；OI-2 是唯一「无 Key、无网、无 GPU、零成本、结果确定」的 provider，而 AC4（重启恢复）与 AC7（不确定不重提）需要**反复制造故障**，只有用夹具 provider 才能不花钱地反复跑。
- **任务**：`pipeline/smartCrop.ts`（32 倍数居中裁切）；`pipeline/imageSanitize.ts`（防线 4 图像清洗网关）；`providers/VolcanoSeedanceProvider.ts`（提交+轮询+下载）；`providers/LocalH3Provider.ts`（子进程调度+互斥锁，**host scope**）；`providers/registry.ts`（provider 唯一注册点）；`providers/statusProbe.ts`（**本地引擎配置自检**——读 env 做一次轻量校验并写内存缓存，**非硬件扫描**；到达路径 = 配 env + 重启，细则见 §6-D22 / §7-2）；**凭据中间件（`X-Provider-Key` 解析 + 掩码 + pino `redact`，见 CONTRACT §5「凭据传递约定」）**；**三态错误码与幂等键**（CONTRACT §5 / §6）；**开发期故障注入层**（见下方「Step 2 补充」）；**CI 三件套（lint / type / test）** 及 `pnpm test:contract` 契约层脚本；**防线 5 防抖限流（60s 冷却落 SQLite，键 = 来源 IP + BYOK Key 指纹的**复合键**；台账 B8 已随 Step 5 前置落地）**；**`/api/upload` 上传加固（≤20MB × ≤4 个、魔数嗅探、类型白名单、路径不含用户输入）**；**公网最小鉴权中间件骨架（Step 5 前强制启用；回环免鉴权，细则 §7-4）**；`/api/prompt/enhance`（**已实现（CONTRACT V2.0 / V8.3 批次 4）**：OpenAI 兼容单实现 + `LLM_PRESETS`；前端 ✨ **未配置文本 Key 时不可用、配置后可用**，**纯 BYOK：服务端不设兜底 Key**）；路由挂载 `/api/generate`、`/api/tasks/:taskId`、`/api/providers/status`、`/api/upload`、`/api/history`；SQLite 任务存储；`packages/shared` 契约包随契约变更同步。
- **AC1**：契约层测试全绿（`pnpm test:contract`，覆盖 CONTRACT.md 全部路由与错误码，含三态 `disposition` 穷举）。
- **AC2**：Seedance 真实冒烟出片 1 次，记录实际耗时与费用，回填 §8 成本表（消除【待验证】标记）。**硬要求：冒烟必须走 `X-Provider-Key` 通道**（用 env 兜底 Key 绕开 = 等于没验证 BYOK 通道，见 §6-D23）；并逐项核对 `backend/src/providers/seedanceProtocol.ts` 中标【待验证】的上游字段（请求体结构 / `--` 尾缀参数 / `status` 枚举 / `content.video_url` 位置）。
  **【T2V 已完成 2026-09-23】**：`scripts/smoke-seedance-paid.mjs`（走产品路径：本地后端 + `X-Provider-Key` + 2s 轮询）用 `doubao-seedance-2-0-mini-260615` / 720p / 5s 出片成功 —— 提交→终态 **86.5s**、成片 **5.09s / 1280×720 / h264 + AAC 2ch**、2.23MB、`/media` **206 Range 正常**、封面抽帧成功、画面**无水印**；四项【待验证】上游字段全部落地（见协议层文件头的证据表）；§8 成本表已回填（金额待账单核对）。
  **仍待**：`image_url` 的 `role` 语义（首/尾/参考帧）需一次真实 **I2V / FL2V / V2V** 冒烟（同脚本 `--i2v <图>`），以及 `failed`/`cancelled` 枚举的真实样本。
- **AC3**：本地并发提交 2 个任务，第 2 个任务状态为 `queued`，无第二个推理进程被拉起。
- **AC4**：服务重启后，进行中的任务能从 SQLite 恢复状态，前端刷新可重挂载。
- **AC5**：可选实现项 OI-2（`fixture-local`）产出真实可播 MP4，`ffprobe` 校验通过，全程零外网依赖、零配额消耗；见下方「Step 2 补充」。
- **AC6**：`/api/providers/status` **不得返回任何未经显式配置的硬件信息**；未显式配置本地引擎时返回 `local.available: false` + `reason`，文案只能是「本服务未配置本地引擎 / 未启用本地轨」一类**对自身的事实陈述**，**不得出现"你的设备 / 你没有显卡"这类对访问者的判断**；`EXPOSE_HOST_LOCAL_TRACK=0`（默认）时 `reason` 为「本服务未向访客开放本地轨」；**任何情况下不得返回硬编码型号**；Step 1 的占位实现同步移除（§6-D22 / D27）。
- **AC7**：注入 `uncertain` 故障后任务归 `UNCERTAIN_RESULT`，**不发生任何自动重提**（硬断言：上游调用次数 = 1）；同一幂等键重复提交返回同一 `taskId`。
- **AC8**：CI 三件套就位，`pnpm test` 同时覆盖契约层与真实产物层（AC1 + AC5）。
- **AC9**：防线 5 落地——60s 冷却按 **IP + BYOK Key 指纹的复合键**计数（台账 B8，已随 Step 5 前置落地；未带 Key 的访客退化为纯 IP 键）；冷却状态落 SQLite，**服务重启后窗口不丢失**（断言：重启前后同一 IP 提交仍被拒且返回 `RATE_LIMITED`）。
- **AC10**：`/api/upload` 上传加固——超限（单文件 > 20MB / 总数 > 4）被拒；伪造 `Content-Type` 的文件被**魔数嗅探**识破并拒；白名单外类型被拒；产物路径不含任何用户输入片段（防路径穿越）。

### Step 3：前端 Astrmira 工作台
- **任务**：左栏（Prompt + ✨扩写 + 拖拽槽 + 画幅 + BYOK 抽屉）；中栏（播放视窗 + 进度环 + 下载）；右栏（任务队列 + 画廊回填/删除）；**视觉收口**——8 个 keyframes 全部落到功能位（生成中 `mira-breathe` 替代 spinner / 完成 `star-gather` 可重播 / logo `mira-orbit-turn`）、卡片补 3 位索引号、空态与页脚补低对比字标水印（字体与 eyebrow 体系已在 Step 1.5 T5 完成，此处不重复）；`UNCERTAIN_RESULT` 的人工核对提示与「标记已核对 / 放弃」动作。
- **AC1**：T2V 全流程可在界面完成，无需任何手工 API 调用。
- **AC2**：生成中刷新页面，进度条自动恢复（localStorage 重挂载）。
- **AC3**：画廊【复用参数】点击后，prompt / mode / 参考图 / seed 完整还原至控制台。
- **AC4**：提交后 60s 内生成按钮置灰。
- **AC5**：**8 个 keyframes 全部存在实际使用位（无孤置）**，且在 `prefers-reduced-motion: reduce` 下全部降级为无动效。
- **AC6**：分区标题、面板标题与卡片统一使用 eyebrow 标签体系（极小字 + 大字母间距 + 3 位索引号），无新引入的硬编码字号 / 字距。
- **AC7**：任务归 `UNCERTAIN_RESULT` 时，界面展示「可能已产生费用，请到服务商后台核对后手动处理」，且**不提供任何一键重跑入口**。

### Step 4：端到端验收与体验打磨
- **AC1**：T2V（含双引号台词人声）与 I2V（含 32 倍数裁切）各跑通 1 次完整链路，**必须用真实云端轨**（本地轨全量出片 7~10 小时/条，不作为验收手段，见 §8）。**当前阻塞：与 Step 2-AC2 同一把 Key。**
- **AC2**：WebP / 超大图各上传 1 次，清洗网关**输出合规**（sRGB、32 倍数、长边 ≤ 2048、透明通道保留）——**断言以落盘产物为准**（`ffprobe` / sharp 元数据复核），不看响应字段自证；**HEIC 按实测能力走"诚实拒绝"**：`.heic`（HEVC）返回 **415 `INVALID_ASSET`** + 可执行转格式指引，**不得**静默放行、也不得假装成功（实测：预编译 libvips 与 ffmpeg 都没有 HEVC 解码器，见 §5 的 S6 条目；让它真正可用的路径见台账 B21）。
- **AC3**：项目级 DoD 达成——后端契约测试全绿 + 上述两条 e2e 全绿。
- **AC4**：CI 以 OI-2（`fixture-local`）跑通端到端并产出可播 MP4（**已完成**：`backend/src/e2e/` 走真实 TCP + `/media` 206 Range + `ffprobe` 校验，见 §5 的 B9 条目）；OI-1（`stock-local`）已按非目标跳过（台账 B7），**不参与验收**——验收记录必须如实写明，不得含糊带过。
- **产出**：`walkthrough.md` 验收记录【规划】。

### Step 5：公网部署与交付
- **任务**：`Dockerfile` + `docker-compose.yml`；反向代理 + HTTP 206；部署至 `DEPLOY_HOST`（值在本地 `.env`，勿写入文档）。
- **AC1**：外部手机浏览器访问公网地址，无卡环境下默认云端轨出片成功。
- **AC2**：状态端点返回 `local.available: false`，前端**展示推荐配置说明**，本地开关**保持可选（不置灰）**；选择未配置的本地轨提交时返回 `PROVIDER_UNAVAILABLE`（`terminal`）。
- **AC3**：`.env`、SQLite、outputs 均不入镜像、不入 git。

---

### Step 2 补充 · 可选实现项（OI，可整块删除）

> 定位：**开发初期校验用，不属于产品线**；默认关闭，不进入 README 电梯陈述与 GUIDE 工作流清单。
> 不需要时按下方「删除动作清单」整体移除，主干不受影响。多镜头相关内容一律不出现在本文以外的文档。

**OI-1 `stock-local`：单镜头素材 provider**
- 形状与其余 provider 完全同构（`checkHealth` / `submit` / `queryStatus` / `cancel`），**一次调用对应一条输出**，不引入多镜头概念；
- 流程：`prompt` → 检索候选（**在检索期即按 `durationSec` 与 `aspectRatio` 过滤**）→ 选片 → 下载 → 清洗 / 对齐 `durationSec` → 落盘输出；
- **时长对齐规则（已定）**：候选长于 `durationSec` → 裁切；**短于 `durationSec` → 循环拉伸（loop）并产生一条告警**（说明"素材短于请求时长，已循环播放"）。因检索期已按最短时长过滤，该分支是兜底而非常态；
- **告警通道（已定）**：走 `TaskProgress.warnings?: string[]`（CONTRACT V1.4）——与进度 `message` 职责分离、可并存多条、随任务记录持久化并在画廊展示；**只打服务端日志不算告警**（用户看不到即等于没有）；
- **音轨处理（已定）**：循环拉伸时若素材自带音轨 → **静音**（或交叉淡化）并追加一条告警说明，避免环境音重复播放；
- **选片规则（已定，必须确定性，否则 CI 不可复现）**：
  1. **硬过滤**：朝向匹配 `aspectRatio`、时长 ≥ `durationSec`、分辨率 ≥ 目标档；
  2. **稳定排序**：`分辨率降序 → 时长升序 → id 升序`，取第一条（同一 query 结果确定）；
  3. **硬过滤为空** → 放宽一级（去掉时长限制）→ 此时才可能触发 loop + 告警；
  4. **全空** → 显式报错 `PROVIDER_UNAVAILABLE`，**不得静默降级**；
- **适配层注意（禁止透传）**：Pexels `orientation = landscape|portrait|square`；Pixabay 视频端点为横向/纵向类枚举，且另有 `video_type`（Pexels 侧对应 `size`）——两家参数集**不是一一对应**，适配器必须显式映射；
- 数据源：Pexels 为主（默认配额 200 次/小时、20000 次/月）、Pixabay 备用（官方宣称不限次；其视频库偏空镜与动态背景，人物剧情向素材较少）。两家均要求先下载到自有服务器、不允许永久 hotlink，与本项目「下载归档 + 落盘」路线一致；
- 价值：在**无 Key、无 GPU、零现金成本**的条件下，实测防线 2 / 3 / 4 / 5 四条公共链路（任务落库与刷新重挂载 / 磁盘 LRU / 图像清洗网关 / 防抖限流），并用**真实视频**替代 mock 产出（防线 7 由下方故障注入层覆盖；防线 1 属本地轨、防线 6 属提示词侧）。

**OI-2 `fixture-local`：CI 专用夹具 provider**
- 读取 `tests/fixtures/clips/`，实现同一 provider 接口；
- **CI 用合成片**：由 `scripts/make-fixture-clips.mjs` 用 ffmpeg 现场合成（`testsrc2` / `smptebars` + 正弦音轨），**二进制不入库**，仓库只存脚本。理由是纯工程性的，与素材站无关：**确定性**（帧数 / 时长 / 尺寸 / 音轨全部已知，断言可钉死）、**体积**（脚本约 5KB vs 真实片段 2–5MB/段；二进制在 git 无增量存储，每次替换永久留在历史）、**边界覆盖**（真实素材提供不了下表的边界）；
- **演示与观感走查用真实素材**：另置少量精选片段（3–5 段），只服务人工演示与 OI-1 离线调试，**不进 CI 流水线**；⏳ 选片**待 OI-1 跑通后补选**（须先看到真实检索质量，否则是盲挑；**不阻塞 Step 2**）；
- 用途：CI / E2E 产出真实可播 MP4（`ffprobe` 校验），同时是将来验证 OI-3 的最小素材集。

**CI 必须覆盖的边界用例（合成片不可替代的价值）**

| 用例 | 生成方式 | 断言重点 |
| :--- | :--- | :--- |
| 基线 720p 横屏 5s + 音轨 | 标准参数 | 宽高 / 时长 / 音轨齐全 |
| 竖屏 9:16 | 尺寸互换 | 画幅分支正确 |
| **短于请求**（0.5s vs 请求 5s） | `duration=0.5` | **已定：循环拉伸 + 告警**；断言输出时长 = `durationSec` 且 `warnings` 至少 1 条 |
| **短于请求且素材带音轨** | `duration=0.5` + 正弦音轨 | 断言循环后音轨被静音（或交叉淡化），且 `warnings` **同时含两条**（循环 + 静音） |
| **长于请求**（30s vs 请求 5s） | `duration=30` | 必须裁切到 `durationSec`，不许多出 |
| **无音轨** | `-an` | 拼接音轨链路不崩 |
| 32 倍数不规整（如 831×479） | 交给 `smartCrop` | 补边 / 居中裁切后必为 32 倍数 |
| 极短 / 单帧 | `-frames:v 1` | 边界不崩 |
| **损坏文件**（截断 moov） | 截断字节 | 归 `INVALID_ASSET` 或 `UPSTREAM_ERROR`，**且不进重试死循环** |

**OI-3 多镜头编排层（暂缓，不在 Step 2 范围内）**
- 形态：N 次单镜头 provider 调用 + TTS + 字幕 + ffmpeg 拼接；**位于 provider 之上，不改 `VideoGenerateRequest`、不改 provider 契约、不改队列与存储**；
- 触发条件：出现「成片时长超过单段素材可得时长」的需求时再评估；
- 落地方式：开实验分支实现，验证后决定合并或废弃；
- 备注：长片多镜头化对云端 / 本地生成轨同样适用，因此该层未来属于公共能力，不是 OI-1 的附属设施。

**可插入 / 可废弃的四条设计约束**
1. **唯一注册点**：provider 只在 `providers/registry.ts` 注册一次；删除 = 删一行 + 删一个目录；
2. **前端零硬编码**：引擎选项由 `GET /api/providers/status` 的能力位动态渲染，前端不认识具体 provider → 删除时前端零改动；
3. **专属字段不外泄**：`VideoGenerateRequest` 不新增仅服务于此项的字段；provider 私有参数走 `options?: Record<string, unknown>`（已在 CONTRACT V1.3 §1 落地）；
4. **默认关闭**：env `ENABLE_STOCK_PROVIDER`（默认 off）决定能力位是否出现在探针返回值中。

**删除动作清单**：去 `registry.ts` 注册 → 删 `providers/stock/`、`providers/fixture/` 目录 → 删 env 项 → 删对应单测 → 前端无改动。

---

### Step 2 补充 · 开发期故障注入（默认关闭）

**位置**：provider 与调度器之间加一层薄包装 `withFaultInjection(provider, plan)`，**仅在 `FAULT_INJECT=1` 时挂载**（默认 off；非本地环境启动直接拒绝挂载）→ 主干零成本、生产无法误开。

**为什么不能用 mock 代替**：mock 不产生真实的 HTTP 流、真实文件与真实落盘，而「流中断 / 半包 / 磁盘写满」恰是要验的对象。故障注入必须发生在**真实 provider 调用链路**上。

| 注入项 | 验证目标 |
| :--- | :--- |
| `delay:ms` | 前端轮询进度与超时表现 |
| `rate_limit` | 防线 5：限流与前端 60s 冷却置灰 |
| `upstream_5xx` | `UPSTREAM_ERROR` 的有限次退避与转 `terminal` |
| `stream_cut@40%` | **下载中断 / 半包**（素材为流式下载，mock 无法覆盖） |
| `disk_full` | `DISK_FULL` 分支与清理提示 |
| `slow_progress` | 进度推进与刷新重挂载（防线 2） |
| `uncertain` | **防线 7**：`UNCERTAIN_RESULT` 不自动重提 |

**验收**：每个注入项至少 1 条自动化断言；其中 `uncertain` 必须有「上游调用次数 = 1」的硬断言，防止该护栏日后被静默改回自动重试。

---

## 5. 进度日志（唯一进度权威，其他文档只准链接本节）

**截至 2026-09-22 · 当前指针：Step 2 仅剩 AC2（真实出片冒烟，待一把可用 Key）＋ Step 4（端到端验收，阻塞于同一把 Key）；Step 1 / 1.5 / 3 已完成、Step 5 已上线且 CI → CD 全自动（施工入口仍见 [EXEC-STEP2-5.md](EXEC-STEP2-5.md)）**

- [x] 架构纠偏：淘汰素材拼贴路线，确立【描述 + 参考图/视频 → 双轨生成】多模态管线（见 §6-D1）；
- [x] 本地算力验证【已验证】：MiniMax H3 NF4 在 Tier 2 机器（16GB 显存）全量缓存并跑通 T2V / I2V / 双引号立体声台词；
- [x] 云端调研：火山方舟 Seedance API 与 BYOK 模式对齐（实际耗时/费用【待验证】，Step 2-AC2 回填）；
- [x] Astrmira 视觉：19 CSS Tokens + 8 Keyframes 提取，三张概念设计图归档（`docs/assets/`）；
- [x] 文档体系 V8.0 整改：9 → 6 份、脱敏占位符化、Step 补 AC、单一事实源确立；
- [x] **Step 1 全栈骨架与设计 Token 落地【已验证】**：Fastify 后端 + React 19 前端 + Astrmira 19 Tokens 就绪，前后端**联通探针**通过，构建无报错；⚠️ `/api/providers/status` 为**占位实现（硬编码显卡型号）**，真实算力探测排入 Step 2（见 §6-D12）；
- [x] 可选实现项定稿【规划】：素材能力降级为开发期校验 provider（OI-1 `stock-local` / OI-2 `fixture-local`），多镜头编排列暂缓项（OI-3）——见 §4「Step 2 补充」与 §6-D8 ~ D10；
- [x] 付费护栏补齐【规划】：错误码升级为三态 `ErrorDisposition`，新增 `UNCERTAIN_RESULT`、幂等键与提交前 `submitting` 标记，配套防线 7（CONTRACT V1.3）；
- [x] 开发期校验方案定稿【规划】：真实素材（演示走查）与 CI 合成片（8 条边界用例）分工、故障注入层 7 项注入清单；
- [x] OI-1 规则定稿【规划】：时长对齐（长→裁切 / 短→循环拉伸 + 告警）、循环时音轨静音、四步确定性选片规则、告警走 `warnings[]`（CONTRACT V1.4）；
- [x] Step 2 实施顺序定稿：OI-2 夹具 → 公共链路 → Seedance → OI-1；
- [x] 文档/代码纪律分叉整改【文档侧已完成】：README 过期标记修正 + 新增协作规范 6（进度回检）、CONTRACT 升 V1.5（`ProviderType` 补 OI id）、§7 安全补鉴权/限流键/上传加固、§6 新增 D18~D21、立项一次性整改手册（Step 1.5 完成后已归档删除）；
- [x] 文档收口【文档侧已完成】：PLAN 升 V8.1（版本标签与正文统一）、§4 补 Step 1.5 索引、Step 2 补防线 5 / 上传加固 / 鉴权中间件的任务与 AC9~AC10、Step 3 承接 keyframes 与索引号等视觉收口（AC5~AC7）、CONTRACT 升 V1.7（§8 补 `HealthResponse`）、EXEC 修编号与 AC 可执行性并把字体 / eyebrow 并入 T5（P1-5 / P1-6）；
- [x] **Step 1.5 地基整改【已验证】**（T1~T6 全部 AC 通过；一次性执行手册 `EXEC.md` 已按定位归档删除，历史可从 git 取回）：
      - **T1** 占位探针去硬编码：`local` 恒 `available:false` + `tier:0`，全文件禁止型号与显存数字；`cloud.available` 按 CONTRACT §2（V1.6）以「env Key 或会话内存 BYOK Key」双入口判定，会话存储未就位时以恒空 stub 占位；
      - **T2** `packages/shared` 契约包：CONTRACT §1 / §2 / §3 / §4 / §6 / §8 逐节翻译为 zod schema，schema 即单一事实源、类型一律 `z.infer`，tsc 直出 `dist`（禁 bundler）；破坏性验证「改字段名 → 前后端 tsc 同时失败」通过；
      - **T3** 路由级 schema 校验（`fastify-type-provider-zod`）：`/api/health`、`/api/providers/status` 挂 response schema，路由拆分至 `backend/src/routes/`；CORS 由 `origin:true` 收紧为 `CORS_ORIGINS` 白名单（未配置时默认 `http://localhost:5173`）；破坏性验证「schema 外字段被序列化剥离」通过；
      - **T4** 真实 `app.inject()` 测试替换假测试：`buildApp()` 装配与 `listen` 分离，tsx / `node dist` 双形态实测可 listen；含「响应体不得出现显卡型号」回归断言；
      - **T5** 前端 token 化 + 字体修正：`--serif` 去 Cinzel 改大小写混排高对比衬线、新增 `--serif-caps` 仅供全大写 eyebrow；eyebrow 标签体系落位（`--fs-eyebrow` / `--track-caps`）；`App.tsx` 内 hex 色值与字体名零残留；
      - **T6** `JobQueue` 接口骨架（只立契约，无实现）：`requeue`（仅限未提交上游）与 `markUncertain`（已提交但结果不明）分列，防线 7 在接口层落地；
      - 依赖事实：`fastify-type-provider-zod@7.0.0` 的 peer 要求 `zod >= 4.1.5`，故 zod 由 3 升至 **4.6.5**——Step 1 期间 zod 为「已装零使用」，major 切换无迁移成本；
- [ ] **Step 2 双轨 Provider 与核心调度【两条轨未完成：cloud 待 AC2、host-local 未实现】**：架构决策定稿（§6-**D22 ~ D28**、CONTRACT **V1.8**、新增 §9 台账）；S1 ~ S5b / S7 全部完成（见下）。**未完成项有两块**：① **AC2**（真实出片冒烟 + §8 成本表回填）阻塞于一把可用的火山方舟 Key；② **host 本地轨 `LocalH3Provider.ts` 尚未实现**（`registry.ts` 里 `'local-minimax-h3' → null`）——选本地轨会如实返回 `503 PROVIDER_UNAVAILABLE`，`GUIDE §二·轨道 A` 描述的工作目录自检与【测试连接】按钮属台账 B4，**文档已按【规划】标注**（此前"仅剩 AC2"的写法是错的，见 V8.3 批次 0）；施工手册 `docs/EXEC-STEP2-5.md` **继续保留**（一次性手册，Step 5 验收后归档删除），实施顺序与切片以该手册 §6 为准。
      - [x] **S1 · OI-2 夹具 provider【已验证】**（AC5）：`scripts/make-fixture-clips.mjs`（ffmpeg 现场合成 9 条边界片，二进制不入库）、`lib/ffmpeg.ts`（工具缺失中文指引 + `-nostdin`/超时 + 探测失败统一包装）、`pipeline/smartCrop.ts`（32 倍数规整 + 居中裁切纯函数）、`providers/registry.ts`（唯一注册点）、`providers/fixture/FixtureLocalProvider.ts`（四方法 + 时长对齐 + 循环/静音双告警）；**38 项测试全绿**（9 条边界用例逐条断言 + 4 项破坏性验证回归）。
      - [x] **S2 · 公共链路【已验证】**（AC3 / AC4 / AC7 幂等半边）：`store/db.ts`（SQLite + 建表：任务 / 幂等键 / 冷却）、`store/taskStore.ts`（CRUD + 参数快照 + `warnings` + `submitting` + 原子领取，含防线 7 的 SQL 排除条件）、`queue/SqliteJobQueue.ts`（实现既有 `JobQueue` 接口 + `requeue` 守卫）、`queue/dispatcher.ts`（双轨调度，local 并发 1 + 防线 3 收尾清理）、`routes/generate|tasks|history.ts`、`pipeline/cleanup.ts`、`server/staticOutputs.ts`（`/media/*` 的 206 载体）；**54 项测试全绿**（幂等上游计数 = 1、并发第 2 个保持 `queued`、重启恢复、206 Range、画廊删除、防线 7 双护栏、防线 3 目录不存在）；CONTRACT §5 补登各路由响应形状。
      - [x] **S3 · 三态错误码 + 故障注入层【已验证】**（AC7 的 uncertain 半边）：`errors.ts`（12 码 → 三态的**穷举映射表**，`satisfies Record<ErrorCode, ErrorDisposition>` 编译期钉死 + `resolveTaskError` 唯一归类入口）、`providers/withFaultInjection.ts`（7 项注入 + `FAULT_INJECT` 默认关闭 + 生产挂载直接拒绝）、dispatcher 补**上报轮询循环**（进度 heartbeat 落库 + 超时归 `UNCERTAIN_RESULT`）；`packages/shared` 的 `ErrorCodeSchema` 同步到 V1.8 的 12 个码（修掉 R 段的遗漏）；**87 项测试全绿**；AC7 的「上游调用次数 = 1」硬断言经破坏性验证（把 `markUncertain` 临时改成 `requeue` → 断言精确变红）钉住；判据修正为「是否**已进入提交阶段**」（`submitting` 语义），而非「是否拿到 upstreamTaskId」。
      - [x] **S4 · 防线 5 限流 + 上传加固 + 鉴权骨架【已验证】**（AC9 / AC10）：`security/rateLimit.ts`（`rateLimitKey` 预留 `keyFingerprint?` 复合键位；60s 冷却**落 SQLite**，重启不丢窗口）、`security/auth.ts`（Bearer + 两层免鉴权：回环来源全部 + 任何来源 `/api/health`；生产未配 Token **启动即拒**）、`routes/upload.ts`（≤20MB × ≤4、**魔数嗅探**定类型、白名单、路径只含服务端随机 ID）、`index.ts` 挂安全响应头；`packages/shared` 补上传响应形状、CONTRACT §5 同步；**116 项测试全绿**；两项破坏性验证均命中（嗅探换读 `Content-Type` → 伪造类型用例红；冷却换内存 Map → 重启用例红）。测试基建：`backend/vitest.config.ts` 设 `fileParallelism: false`（集成测试经 env 指定配置，并行文件会互相覆盖）。
      - [x] **S5a · 本地引擎配置自检【已验证】**（AC6）：`providers/statusProbe.ts`（**只读 env 的配置自检**——不扫描硬件、不返回型号/显存/路径明文；`COMFYUI_BASE_URL` 白名单仅回环与 RFC1918、`H3_WORKDIR` 要求存在的绝对目录；档位由 `H3_TIER` **显式声明**，不由探测推导）、`index.ts` 启动时写内存缓存；**133 项测试全绿**；破坏性验证命中（reason 临时夹带型号 → 正则取反断言 `not to match /(RTX|GTX|A100|H100|[0-9]+\s?GB)/i` 精确变红）。
      - [x] **S5b · Seedance 云端 provider【已完成；AC2 真实冒烟待一把可用 Key】**（用户裁定 **B 方案**：进程内暂存至终态）：新增 `security/keyVault.ts`（凭据按 taskId 进程内暂存：**入队前写入**、调度器领取时取出、终态 `finally` 释放；不落库 / 不落日志 / 不落盘；自检只报条数，类型层面就没有枚举 Key 的能力）、`providers/seedanceProtocol.ts`（**协议适配层**：端点 / 请求体 / `--` 尾缀参数 / 状态枚举 / 错误归类集中一处，逐项标注**【已确认】与【待验证】**——上游改字段只动这一个文件）、`providers/VolcanoSeedanceProvider.ts`（提交 → 轮询 → **流式下载到 outputs**，对外只暴露同源 `/media/<taskId>.mp4`，规避上游临时地址 24h 失效）、`store/assets.ts`（资产 → 上游可访问地址：配 `PUBLIC_BASE_URL` 走公网 URL，否则 data URL；assetId 做 UUID 形状校验防路径穿越）、`store/reconciliation.ts`（**补 S2 遗留缺口**：进程中途退出会遗留永远停在 `running` 的任务），以及 registry / dispatcher / generate / index 的接线（provider **每任务一份**，凭据由调度器注入）。
        - **测试**：新增 **47 项**（协议 18 / provider 17 / vault 6 / 调解 6），后端总量 144 → **192 全绿**；`lint 0 warning / type 0 error`。provider 全部走桩 `fetch`，**零真实调用**。
        - **凭据优先级**：请求头里的用户 BYOK Key > `VOLCANO_API_KEY`（部署者兜底）。顺序不可颠倒——反了会让用户以为在烧自己的额度、实际烧部署者的。`cloud.available:true` 的语义正是"存在 env 兜底"。
        - **无凭据的两条分支**（都显式、都不许静默）：`submit()` 报 `KEY_MISSING`（还没提交，谈不上不确定）；`queryStatus()` 报 `UNCERTAIN_RESULT`（**已提交过**，只是查不了 → 人工核对，禁止自动重提）。
        - **启动调解的归类**：有 `upstreamTaskId` 或 `submitting=true` → `UNCERTAIN_RESULT`；干净现场 → `UPSTREAM_ERROR`（retryable，但**我们仍不自动重跑**，等用户决定）。
        - **B 方案的已知代价（明确记录，不是缺陷）**：进程重启清空暂存 Key → 在途已提交任务归 uncertain。**任何情况下都不会自动重提**。
        - **⚠️ 尚未证明的事**：上游字段名、`content` 数组结构、`--` 尾缀参数、`status` 枚举、`content.video_url` 位置**均未实测**（仓库无可用 Key；官方文档页是 SPA，静态抓取拿不到正文——仅有端点被官方公开信息确认）。协议细节已全部隔离在 `seedanceProtocol.ts`，AC2 冒烟时逐项核对即可，改动面为一个文件。**不得**把这批字段当成已验证事实引用。
      - [x] **S6 · 图像清洗网关（防线 4）【已验证】**（2026-09-22，`pipeline/imageSanitize.ts`）：新增 `backend/src/pipeline/imageSanitize.ts`（`sharp` 0.35.4 / libvips 8.18.6）—— **EXIF 方向矫正**（orientation 5~8 会交换宽高，先按"人看到的方向"算目标尺寸再烘焙进像素）、**CMYK/AdobeRGB → sRGB**、**超大图下采样**（长边 > `MAX_LONG_EDGE=2048` 等比缩小）、**32 倍数规整**（复用生成阶段的 `snapSize`，两段共用同一组纯函数）、**剥离元数据**（EXIF/ICC，含可能的 GPS）；透明通道保 PNG、其余统一 JPEG(q90)；接进 `/api/upload`（**只有图像走清洗，视频原样落盘**，失败 → 415 `INVALID_ASSET` + 可读原因）。`actions[]` 逐条记账做了哪些处理，不做静默改图。
        - **测试**：新增 `imageSanitize.test.ts` **15 项**（尺寸钉死具体数字：3000×2000 → **2048×1344**；831×479 → **800×448**；已合规图不产生多余动作；WebP→JPEG；HEIF 容器（AV1/AVIF）→JPEG；CMYK→srgb；透明保 PNG；EXIF orientation=6 宽高交换且方向标记被清；元数据剥离；过小图 / 损坏字节显式报错；`MAX_LONG_EDGE % 32 === 0` 的常量守卫）；上传集成用例同步改为断言**清洗后的产物事实**（mime / size / 落盘 `<uuid>.jpg` + `ffprobe` 复核 32 倍数）。后端 199 → **214 项**。
        - **破坏性验证**：把 `MAX_LONG_EDGE` 临时调到 9999 → 两条断言精确变红（`expected 2976 to be 2048`；`expected 15 to be +0`，即常量不再是 32 的倍数），还原后全绿。
        - **⚠️ HEIC 的真实结论（实测，与第一版判断相反）**：拿真实样本（libheif 仓库 `examples/example.heic`，1280×854，HEVC 编码）走**完整管线**实测，预编译 libvips **没有 HEVC 解码器**（`heif: Error while loading plugin: Support for this compression format has not been built in`）；本机 ffmpeg 也没有 heic 解码器 → **不存在 ffmpeg 兜底**。所以按手册允许的"或**诚实拒绝**"分支落地：`.heic` 上传返回 **415 `INVALID_ASSET`** + 可执行指引（"该 HEIC 用的是 HEVC 编码，本服务图像库未编译该解码器；请改 JPEG/PNG（iPhone：设置 → 相机 → 格式 → 兼容性最佳）"），**实测报文已复现**。
          - **踩坑留痕**：`sharp(buf).metadata()` 对同一份 HEIC **成功返回 1280×854** —— 它只读容器头，**不能作为"能解码"的证据**；第一版结论就是这样误判的，直到走完整管线才暴露。因此单测一律 `await sanitizeImage(...)` 走全链路，不接受"仅 metadata 通过"。**§4 Step 4-AC2 的措辞据此按事实改写**（见 §4）。
          - HEIF 容器本身可用：AV1 编码的 AVIF 走同一路径实测通过（已在单测覆盖）；缺的只是 HEVC 那一支。真正支持 `.heic` 的两条候选路径见台账 **B21**。
        - ⚠️ **编号勘误（2026-09-22）**：本条此前被误写成「S6 · OI-1 `stock-local` 素材 provider【跳过】」——把 **OI-1**（属台账 B7）放进了 **S6** 槽位，于是手册里真正的 S6（图像清洗网关）在进度日志中**没有任何记录**，"没做"被"已跳过"掩盖。现按手册 §6 的编号归位：OI-1 只作台账 B7，S6 就是图像清洗网关。
      - [x] **OI-1 `stock-local` 素材 provider【跳过：非目标】**：本次**明确不做**（PLAN §1-2 非目标），已转 §9 台账 **B7**（**不占 S6 编号**）。
      - [x] **S7 · 契约层测试 + CI 三件套【已验证】**（AC1 / AC8）：`contract.test.ts` **直接解析 `docs/CONTRACT.md` 校验实现**（§5 全部路由经 `app.hasRoute` 覆盖；§6 错误码**双向**比对——"契约有实现缺"与"实现有契约缺"都会红）；补 `POST /api/prompt/enhance` 的 **501 + `LLM_NOT_CONFIGURED`** 诚实兜底（demo 版不做 LLM，禁止规则引擎冒充）；根脚本 `lint`（oxlint `--deny-warnings`）/ `type`（三包 `tsc --noEmit`）/ `test:contract`；新增 `.github/workflows/ci.yml`（install → apt ffmpeg → shared build → lint → type → test:contract → test）；**144 项测试全绿 + lint 0 warning**；破坏性验证两处均命中（删映射表一项 → 编译期 `TS7053 Property 'UNCERTAIN_RESULT' does not exist`；删 CONTRACT 一行 → `实现中的 KEY_MISSING 未写入 CONTRACT §6`）。
- [x] **Step 3 前端 Astrmira 工作台（F1~F6，AC2~AC7 已验证；AC1 待云端 provider）**：`frontend/src/lib/`（`api.ts` 契约驱动 + 响应过 zod + Key 只进请求头 / `storage.ts` 键集中登记且永不抛 / `byok.ts` 默认 sessionStorage、显式勾选才落本机、HTTPS 守卫 / `assets.ts` 参数复用时允许元数据缺失而不是伪造 / `format.ts` 32 倍数目标尺寸与 3 位索引号）、`components/`（`Eyebrow` 索引号体系 / `LeftPanel` / `AssetDropZone` 含 32 倍数裁切预览 / `ByokDrawer` / `CenterPanel`+`ProgressRing` / `RightPanel`+`GalleryCard` / `UncertainNotice`）、`hooks/useTaskPolling.ts`（2s 间隔；终态即停；契约错误即停；网络抖动续试）、`styles/workbench.css`（8 个 keyframes 全部落功能位）、`scripts/visual-selfcheck.mjs`（AC5/AC6 变成可执行断言）；`vite.config.ts` 补 `/media` 代理。
      - **Playwright 实机验证（localhost:5173）**：AC2 刷新后进度环 64% 自动重挂载 ✓；AC3 复用参数完整还原（提示词 / 文生视频 / 9:16 / 云端 Seedance / seed=123456）✓；AC4 提交后按钮「冷却中 59s」且 `disabled=true` ✓；AC7 注入 `UNCERTAIN_RESULT` → 「可能已产生费用，请到服务商后台核对后手动处理」+「标记已核对 / 放弃任务」，**无任何一键重跑入口** ✓；AC6 3 位索引号（001/002/003）与 eyebrow 体系 ✓；页面截图 3 张存 `.tmp/step3-0*.png`。
      - **破坏性验证**：视觉自检临时移除 `flow` 功能位 + 塞一处 `fontSize: '14px'` → 两项均精确报错（含行号）后恢复 ✓。
      - **顺手修掉的两个真实缺陷**：① React StrictMode 双挂载下 `AbortController.abort()` 的报错被当作"后端未连通"（只有实机才暴露，单测抓不到）；② `vite.config.ts` 缺 `/media` 代理会导致"任务成功但播放器黑屏"（请求落到 SPA fallback 拿回 `index.html`，HTTP 还是 200）。
      - **AC1 待补**：端到端 T2V 需云端 provider（S5b 阻塞中），本轮以 mock 验证了「提交 → 轮询 → 冷却」链路。
- [x] **Step 5 公网部署【已上线；CI → CD 全自动】**
      - **线上地址**：`https://<DEPLOY_HOST>/`（当前为 IP 档：自签证书需浏览器信任一次 + 站点级 Basic Auth 登录）。主机 / 端口 / 口令只存在于**服务器本地 `.env.deploy`** 与 **GitHub Secrets**，不入仓库、不入文档。
      - **CD（本片新增）**：`.github/workflows/ci.yml` 的 `deploy` job —— `needs: verify`（**CI 全绿才部署**）、仅 `push` 到 main 触发、`concurrency` 串行且 `cancel-in-progress: false`（不取消进行中的部署，半途取消会留下"解压完但没重启"的中间态）。代码走 **scp 上传**（实测目标服务器**访问不了 github.com**，但 runner → 服务器的入站 SSH 是通的，方向反过来即可），镜像在服务器本地构建。
      - **GitHub Secrets（4 项）**：`DEPLOY_HOST` / `DEPLOY_PORT` / `DEPLOY_USER` / **`SSH_PASSWORD`**。
      - **⚠️ CD 认证改用密码（实测结论，别改回密钥）**：曾用 ed25519 私钥（`SSH_PRIVATE_KEY`），在 runner 上稳定失败于 `Load key ...: error in libcrypto` → `Permission denied (publickey)`。**决定性证据**：同一个 job 内、同一份文件，`ssh-keygen -y` 接受它而 `ssh` 拒绝它；base64 传输 / `tr -d '\r'` / `IdentitiesOnly=yes` 三样都试过，全无效。故改用 `sshpass -f`（密码先 `tr -d '\r\n'` 落成 0600 文件，各步从文件读 —— 既避开命令行，也避开下面那个 CR 陷阱）。想换回密钥只需替换那两步的连接方式，其余逻辑不动。
      - **⚠️ 同一个 CR 陷阱踩了两次（写 Secret 时务必避开）**：用 **PowerShell 管道**喂 `gh secret set` 会给值附加 CRLF，而两种表现完全不像同一个原因 —— 私钥里是 `error in libcrypto`，密码里是服务端回一句 `Permission denied, please try again.`（看起来像密码填错了）。正确做法：`Start-Process -RedirectStandardInput <无 CR 的文件>`。
      - **实测（2026-09-22，CD 首次全绿）**：`verify` + `deploy` 双绿；`docker ps` → `astrmiravideo-app-1 | Up (healthy)`；站点返回 `Content-Security-Policy`（生产启用）+ `X-Content-Type-Options` / `X-Frame-Options` / `Referrer-Policy`；`/api/health` 由 401 转 200（Caddy 的 health 豁免随镜像生效）；六项语义判定全对（无凭据 401 / 深链回退 200 / 未定义 API 与不存在媒体均为 404 JSON，未与 SPA fallback 混淆）；首页稳态 **33~39ms**（首次含完整 TLS 握手 ~200ms）。
      - **实测**（从外网用 Node 的 TLS 栈复测，§5 下方列出六条路径的判定）：`/`（带登录）200 + HTML；`/`（无凭据）**401**；`/api/providers/status` 200 且 `cloud.available:false`（未配兜底 Key，符合 AC6）；SPA 深链 200 回退同一 `index.html`；`/api/nonexistent` 与 `/media/nonexistent.mp4` 均 **404**（未被 fallback 吞成 200 HTML）；容器 `healthy`。
      - **部署过程中修掉的四个真实问题**（都属于"不看日志绝对猜不到"的那类）：① **pnpm 版本漂移** → `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`（Docker 里 corepack 装的是最新 pnpm，对同一份 lockfile 的判定与本地/CI 不同）→ 根 `package.json` 钉 `packageManager: pnpm@10.30.3`；② **`deb.debian.org` 只有 ~60KB/s**，ffmpeg 那 134MB 依赖要 37 分钟 → 换国内镜像（实测快约 30 倍）；③ **`better-sqlite3` 无 prebuilt 需现场编译**，而 slim 运行层没有编译器 → 临时装 `python3 make g++` 编译后立刻卸掉；④ **IP 访问时客户端不发 SNI**（RFC 6066 规定 SNI 只承载域名），Caddy 选不出证书直接以 `tlsv1 alert internal error` 失败 → 加 `default_sni`（**症状是浏览器连登录框都看不到**，完全不像证书问题）。另修 `/api/health` 被站点登录挡住的偏差（该端点应公开，与后端 `ALWAYS_PUBLIC_PATHS` 口径一致）→ Caddy 对探针豁免登录。
      - **✅ 三项输入已提供并配置完成**（服务器地址 / 端口 / SSH 凭据）；**火山方舟 Key 仍待补**（它是 Step 2-AC2 真实冒烟与 Step 4 端到端验收的共同前置；不补也能跑，只是访客必须自带 BYOK Key）。原始清单如下，供后续换机参考：
        0. **（历史记录）**
        1. **服务器地址** `DEPLOY_HOST`（域名或 IP）；
        2. **对外 HTTPS 端口** `DEPLOY_PORT`（建议 443）；
        3. **火山方舟 API Key** `VOLCANO_API_KEY` —— **可选**（这是服务端兜底 Key，供访客未带 BYOK Key 时使用；不填也能跑，只是 `cloud.available:false`，访客必须自带 Key 才能出片）；
        4. **另需告知"有没有域名"**，用以决定 HTTPS 档位（有域名 → Caddy + Let's Encrypt 自动证书；只有 IP → Caddy 本地 CA 自签，浏览器会告警一次需手工信任）。前两项里其实已隐含这项信息，`scripts/deploy.mjs` 会自动分档，告知只是为了确认。
      - 已就绪的交付物：`Dockerfile`（多阶段；运行层装 ffmpeg；`data`/`outputs` 走卷）、`deploy/compose.yaml`（app **不映射任何宿主端口**，只经 Caddy，避免"绕过 HTTPS 的明文入口"；caddy 挂 80 供 ACME 挑战）、`deploy/Caddyfile.domain` 与 `deploy/Caddyfile.ip`（两种 TLS 档，按 `DEPLOY_HOST` 自动选择）、`scripts/deploy.mjs`（校验三项 → 推导 `PUBLIC_BASE_URL`/`CORS_ORIGINS` → `docker compose up -d --build`；支持 `--dry-run` / `--logs`）、`.env.deploy.example`、`.dockerignore`、`backend/src/server/spa.ts`（**单进程形态**：一个 Fastify 同时托管 `/api` + `/media` + 前端产物与 SPA fallback）。
      - **AC3（.env / SQLite / outputs 不入镜像不入 git）的达成方式**：这四类路径同时被 `.gitignore` 与 `.dockerignore` 排除。两道防线职责不同——前者防入仓库，后者防入镜像——缺任一都可能漏。
      - **反代三个坑已在配置内消除**：请求体上限 ≥20M（否则参考图被**静默**拦掉）、**刻意不写 `encode`**（任何视频压缩都会破坏 206 Range，用"不写"而非"写排除规则"，因为没法被误配置的东西才安全）、`X-Forwarded-For` + `TRUST_PROXY=1`（否则防线 5 的 IP 冷却退化成全局锁，症状是"别人提交过我就被限流"）。
      - **实测**：单进程形态三条路径已验证（`GET /` → 200 HTML、SPA 深链回退 → 同一 index.html、`/api/nonexistent` 与 `/media/nonexistent.mp4` → **404 且不被 fallback 吞成 200 HTML**）；`deploy.mjs` 四类拦截已验证（缺配置文件 / 缺必填项 / `DEPLOY_HOST` 端口与 `DEPLOY_PORT` 不一致 / domain·ip 自动分档 + 自签告警）。
      - **镜像与构建已实测**：多阶段构建在目标服务器上跑通（`astrmiravideo:latest` 约 1.5GB），两个容器 `healthy`。**仍未回填**：ffmpeg 的具体版本号与许可证结论（`docs/UPSTREAM.md` 中标注为【待验证】，需在服务器上 `docker run --rm astrmiravideo:latest ffmpeg -version` 后补）。
- [x] **Step 5 补充 · 审计发现并补齐的两项台账阻断项（B8 / B15）**：§9 台账把这两项分别标为「**上线前必须做**」与「**Step 5 内落地（公网刚需）**」，而发现时 Step 5 已上线、两者都还没做 —— 属"文档明确要求、代码没做"的真实缺口（不是文档过时）。
      - **B8 复合限流键（IP + 凭据指纹）**：`rateLimitKey` 的签名早就预留了 `keyFingerprint`，但 `generate.ts` 只传了 IP。后果不是"洁癖"而是**用户可见的误伤**：共享出口（公司 NAT / 校园网 / 移动网络）下所有人同 IP，A 提交后 B 被「冷却中 60s」挡住，而 B **完全无法自查** —— 防线 5 的本意是防单人刷接口，不是防整栋楼。补 `fingerprintKey()`：SHA-256 前 8 位（足以区分、**不可逆**、不构成"存储凭据"），输入先 `trim()`（否则加个空格就能绕过冷却），并接进限流键；未带 Key 的访客退化纯 IP 键（他们本来也提交不了：无凭据 → `KEY_MISSING`）。
      - **B15 CSP + 零 `innerHTML` 断言**：CSP 落于 `backend/src/server/securityHeaders.ts`，**仅生产启用** —— 开发环境必须放开内联与 ws，否则 `pnpm dev` 直接白屏；而"为了安全把开发环境弄坏"的做法，最终结果一定是有人把 CSP 整段删掉。`innerHTML` 现状本已为零，已固化成 `visual-selfcheck.mjs` 的第 ⑦ 条断言，防止日后被写回来。
      - **验证**：后端 **190 项** + 前端 **24 项** + 视觉自检全绿；线上实测 `Content-Security-Policy` 头存在、三项安全头齐全。
- [x] **测试地基加固（台账 B9）＋ 顺手修掉两个真实缺陷【已验证】**（2026-09-22）：
      - **① 端到端固化（= Step 4-AC4 的 CI 半边）**：新增 `backend/src/e2e/fixturePipeline.e2e.test.ts` —— **真实 TCP**（`listen` + `fetch`，不用 `app.inject`）：提交 → 轮询至 `succeeded` → `/media` Range **206**（含 `content-range` / `accept-ranges`）→ 全量下载 + `ffprobe` 校验"真的可播"（时长 = 请求、尺寸 = `cropToAspect` 的 32 倍数结果、含音轨）→ 画廊参数快照可见 → 删除后文件**真的**消失且 `/media` 转 404；并断言中间帧目录不存在（防线 3）。基线：后端 18 → **19 文件 / 190 → 199 用例**。
      - **② 修掉「夹具 provider 忽略 `OUTPUT_DIR`」**（`providers/registry.ts` 改为按 `resolveOutputsDir()` 惰性构造）：旧行为把成片写进 `<repo>/outputs`，而 `/media/*` 服务的是 `OUTPUT_DIR` —— 分叉时的症状是「任务 succeeded 但播放器 404」，本地 `pnpm dev`（cwd = `backend/`）同样会分叉。破坏性验证：还原旧写法 → e2e 精确报「产物不在 OUTPUT_DIR 内」。
      - **③ 覆盖率（只给防线载体设文件级门限）**：`@vitest/coverage-v8` + `backend/vitest.config.ts` 的 glob 阈值（errors / taskStore / rateLimit / auth / credential / keyVault / smartCrop / cleanup / generate / seedanceProtocol）；CI 的测试步骤由 `pnpm test` 改为 `pnpm test:coverage`（门限与测试**同趟**判定）。实测总覆盖率 **89.04%**（语句）。破坏性验证：把 `errors.ts` 行覆盖阈值临时调到 99 → 精确报 `Coverage for lines (86%) does not meet "src/errors.ts" threshold (99%)`。顺带补齐 `resolveProviderKey` / `maskKey` / `LOG_REDACT_PATHS` 测试，`credential.ts` 覆盖率 75% → **100%**。
      - **④ 生产形态 UI 冒烟（B9 的视觉固化；用户拍板"不做像素比对"）**：`scripts/smoke-ui.mjs`（`pnpm smoke:ui`）—— 以 `NODE_ENV=production`（**生产 CSP 真的生效**）起单进程，chromium 打开首页并断言：三栏骨架 / 首屏与后端连通（头部徽章进「服务在线」）/ BYOK 抽屉可交互 / `document.fonts.load` 正向确认字体已加载 / **控制台零 error 且无未捕获异常**；截图存 `artifacts/ui-smoke/`（仅 artifact 留档，不参与判定）。CI 内新增构建 → 安装 chromium → 冒烟 → 上传截图四步。
      - **⑤ 顺手修掉一个「只有浏览器才看得见」的真实缺陷**：`frontend/index.html` 外链 `fonts.googleapis.com`，而生产 CSP 是 `style-src 'self'` / `font-src 'self'` → **线上 Cinzel 标题字其实一直没有生效**（开发环境按设计不开 CSP，所以是"本地正常、线上变形"）。修法：Cinzel 两个拉丁子集（合计 ~23KB，**SIL OFL 1.1**）自托管进 `frontend/public/fonts/`（含 `OFL.txt`，登记见 UPSTREAM）；`visual-selfcheck.mjs` 增加第 **⑧** 条静态断言「index.html 零跨源资源」（破坏性验证：加回外链 → 精确报错）。CSP 因此**保持严格**，也不再有任何第三方出网请求。
      - **⑥ 性能基准（只提供可复跑的手动脚本，CI 不设门）**：`scripts/bench.mjs`（`pnpm bench`）。本机实测：`/api/health` p50 0.6ms / p95 1.7ms、`/api/providers/status` p50 0.5ms、画廊查询 p50 0.6ms、夹具出片（2s 片，含 ffmpeg 转码）**1.1s**、`/media` Range 首字节 p95 3.9ms、回环下载 117.8MB/s（2026-09-22，node v24.14.0 / win32 / 未插桩）。**引用时必须带上测量条件**。
      - **余项转台账**：像素基线（B16）、性能门限（B17）、开发机与 CI / 镜像的 Node 版本对齐（**B18**：本机 v24.14.0 vs CI 与镜像 22）、中文衬线自托管策略（**B19**）。
- [ ] **Step 4 端到端验收【阻塞：需一把可用 Key】**：见 §4。AC1 明确要求用**真实云端轨**跑通 T2V（含双引号台词人声）与 I2V（含 32 倍数裁切），因此与 AC2 共用同一把 Key —— 拿到 Key 后 Step 4 与 Step 2-AC2 可一并完成；**AC4 的 CI 半边已完成**（见上方 B9 条目 ①）。
- [~] **V8.3 体验与功能补强【进行中：批次 0~4 / 6 已完成，批次 5 待 Key】**（2026-09-22 立项）：起因是一次"文档 ↔ 代码"全面核对（11 条防线/功能项 + 10 条路由 + 12 个错误码产生点 + `process.env` 全量 + 存储生命周期，两路独立探查 + 逐条复核）。**批次 6 是 2026-09-23 的线上故障修复（用户报障驱动），插在批次 5 之前**。**以下顺序即批次**：
      - [x] **批次 0 · 文档对齐（零风险）【已完成】**：把"文档承诺 > 代码事实"的地方逐条改回事实 —— LRU 降级并登记 **B22**（`§1` 架构图 / `§3` 防线 3 / CONTRACT §7 三处）；防线 3 补注「当前生产链路**没有中间帧生产者**，清理属预留兜底」；防线 4 写实（已落地 + `.heic` 诚实拒绝）；**鉴权作用域写实**（钩子是全局 `onRequest`：除回环与 `/api/health` 外，`/media/*` 与前端产物同样要求 Bearer，线上由 Caddy 注入）；**限流复合键时点写实**（已落地，非"Step 5 才做"）；**Step 2 状态修正**（`LocalH3Provider.ts` 未实现 → 不再写"仅剩 AC2"）；CONTRACT 消除"修订说明说新增 `keys/verify`、表格里却没有"的自相矛盾；GUIDE 未实现项标注【规划】；README 删除视觉免责段（**已获 Astrmira 作者许可**，来源改登记在 UPSTREAM）。
        - **当场钉死的两条"未能确认"**：① `app.hasRoute({method:'GET',url:'/media/*'}) === true` → 契约测试对 `/media/*` 的断言口径**有效**，疑虑排除；② **`cancelled` 会被 dispatcher 覆盖 —— 实测确认是真缺陷**（桩上游场景：取消后 3 秒状态变回 `running 10%`，最终会走到 succeeded）→ 修复排入批次 3 首位（它直接关系到"用户以为取消了、实际仍在计费"）。
      - [x] **批次 1 · 生成参数与布局【已验证】**：左栏新增**时长**（3/5/8/10s，`DURATION_OPTIONS`，受 `DurationSecSchema` 的 ≤10 硬上限约束；`clampDurationSec` 夹取）与**清晰度档**（480p / 720p / 1080p）两个分段控件；两者**真的进请求**（`params.durationSec` + `resolution`，云端由 `seedanceProtocol` 翻成上游 `--duration` / `--resolution`）；**目标尺寸 = 画幅 × 档位**（`TARGET_SIZES` 三维表：480p 16:9→832×480、720p→1280×704、1080p→1920×1056，逐格 32 倍数），中栏顶部与左栏「画幅」旁同步显示；**一键回填**补上时长与档位（`tierForSize` 由像素短边反推）。**跨端一致性守卫**：前端 `format.test.ts` 复算后端分档阈值（短边 <640 / 640~999 / ≥1000），后端 `seedanceProtocol.test.ts` **逐格钉住 9 组预设尺寸** → 不会出现"界面说 720p、上游收 480p"。**大屏适配**：`.wb-main` 上限 1800 → **2400px**（2560 宽屏不再两侧留 ~380px 空白）+ 新增 `min-width: 1800px` 档（侧栏 360~420 / 340~400、画廊**双列**、卡片转纵向排布）。验证：前端 **32 项**（+8）/ tsc 0；**UI 冒烟新增第 4 节**实测「切 1080p → 顶部与左栏目标尺寸同步变 1920×1056」「切 10s → 选中态正确」。
      - [x] **批次 2 · 主题体系【已验证】**：① **收口硬编码**——组件层原有 **13 处 `rgba(...)`**（本质都是"token 色 + alpha"）全部收进 `tokens.css` 的派生 token（`--gold-soft/--gold-line/--danger-line/--canvas-veil/...`），**组件层现在零硬编码色值**（自检第 ⑨ 条钉住）；② **暗色略提亮**——按 `docs/assets/01~03` 三张参考图把底色 `#090c12 → #111726`、面板 `#10141c → #1a2130`、金线 `0.35 → 0.42`（**只向参考图靠一点**，星尘仍是内核）；③ **日间"现代简洁·蔚蓝"**——`:root[data-theme='day']` 只覆盖颜色：底 `#f4f7fb`、卡片 `#ffffff`、主色**把"金"整体换成蔚蓝 `#2f6fe0`**（暗色里 `--gold` 的 12 处引用自动跟着换，组件不认识主题）、放映区仍保持深色 `#0f1725`；④ **默认跟随系统** + 顶栏三档切换（跟随系统 / 星尘 / 日间）+ `localStorage` 持久化 + `prefers-color-scheme` 订阅（手动档不订阅）；脏值**自愈回落 system**；⑤ **对比度进 CI**——自检第 ⑩ 条按 WCAG 相对亮度公式核验**两套主题 × 6 对**（正文/次文字/主色/主按钮 ≥ 4.5:1；低对比水印字标按 AC5 的定位放宽到 3.0:1），改 token 立刻知道。验证：`theme.ts` 纯函数 6 项单测（默认跟随系统 / 脏值自愈 / 映射）；前端 **38 项**（+6）与自检全绿；**UI 冒烟新增第 5 节**实测「系统为暗色时不打 `data-theme`」「切日间 → 属性生效 + `.wb-shell` 计算样式变 `rgb(244,247,251)`（**轮询等过渡完成**）+ 偏好已持久化」「切回星尘 → 属性移除」，并留档 `artifacts/ui-smoke/day.png`。
      - [x] **批次 3 · 功能缺口【已完成】**：
        - [x] **① `/cancel` 真取消（修掉那条实测缺陷）**：调度器新增 `isCancellationRequested` 注入点（`index.ts` 接线为 `store.get(id)?.status === 'cancelled'`），**在每轮 heartbeat 之前**回读状态；命中则 `provider.cancel(upstreamTaskId)` 收口，落 `cancelled` 终态且文案分两种（上游接受/未确认，后者提醒核对费用）；另补"提交窗口期取消"（拿到 upstreamTaskId 后立刻收口）。前端「取消任务」**不再是只弹提示**，改为真调 `cancelTask`。测试 `dispatcher.cancel.test.ts`（2 项）：取消后**跨 3 个心跳周期状态保持 cancelled**（旧实现会变回 running）+ 上游恰好收到一次 cancel；终态再取消回 `ok:false` 且不再触达上游。
        - [x] **② assets 随任务删除清理**：`DELETE /api/history/:taskId` 现在同时清理该任务引用的参考资产；**带复用保护**——`taskStore.countTasksReferencingAsset()`（快照 LIKE 查询）判定"是否还有别的任务引用"，有则只删任务、保留资产（「参数一键回填」复用资产是常态，无脑删会毁掉别的任务）。文件按 `<assetId>.` 前缀匹配（扩展名由防线 4 决定）。测试 `history.assets.test.ts`（2 项）覆盖两条分支。
        - [x] **③ `PROMPT_REJECTED` 补上真实产生点**：`/api/generate` 校验提示词（空 / 纯空白 → 400；> `MAX_PROMPT_CHARS = 2000` → 400，错误信息带实际长度），路由响应 schema 增 400。测试 `generate.prompt.test.ts`（3 项，含"刚好到上限可提交"的边界）。`GPU_BUSY` 仍无产生点——它属于**未实现的 host 本地轨**（队列忙），随本地轨一起落地。
        - [x] **④ 画廊真缩略图【已验证】**（CONTRACT **V1.9**）：契约加 `TaskProgress.thumbnailUrl?`（可选 —— 抽帧失败不得影响任务终态）；服务端新增 `pipeline/thumbnail.ts`（成功出片后抽首帧 → `outputs/thumbs/<taskId>.jpg`，宽 480，经**既有** `/media/*` 服务，**不新增路由**），由调度器新增的 `createThumbnail` 注入点在 `queue.complete` **之前**调用（失败只记日志，任务仍 `succeeded`）；`DELETE /api/history/:taskId` 连封面一并物理删除。画廊改为「有封面用 `<img loading="lazy">` + ▶ 角标，没有则回落 `<video preload="metadata">`」——旧记录与抽帧失败的任务都不会空一块。**旧库升级**：`db.ts` 新增 `COLUMN_MIGRATIONS`（`pragma table_info` 判存在 + `ALTER TABLE`），因为 `CREATE TABLE IF NOT EXISTS` 对已存在的表**不会补列**，否则线上第一次写封面就会 `no such column`。
          - 测试：`pipeline/thumbnail.test.ts`（7 项：`/media/` 路径守卫 / 真实抽帧出 JPEG 且宽度 480 / 源片缺失时不留 0 字节半成品 / 多任务互不覆盖）、`store/db.test.ts`（2 项：V1.8 旧表被补列且不丢既有行 / 重复迁移幂等）、e2e 新增第 ⑥⑨ 段（**真实 HTTP** 取封面 200 + `image/jpeg` + `ffd8ff` 魔数；删除后封面文件与 URL 双 404）。覆盖率阈值补 `pipeline/thumbnail.ts`。
          - 破坏性验证两处均命中：① 停掉 `applyColumnMigrations` → `db.test.ts` 精确报 `expected [...] to include 'thumbnail_url'`；② 去掉历史删除里的封面 `rm` → e2e 精确报第 ⑨ 段的 `expected true to be false`。
        - [x] **⑤ FL2V / V2V 前端入口【已验证】**：前端从"一个资产入口"改为**三槽**（首帧 / 尾帧 / 参考视频，与 CONTRACT §1 的 `assets` 三字段一一对应），模式分段控件补齐四档（文生 / 图生 / 首尾帧 / 视频参考）。三条落地口径：① **上传即切模式**（`modeAfterSlotUpload`）—— 素材放错槽是真实发生过的（上传 mp4 被当 `first_frame` 发出去），把"往哪个槽放"与"用哪个模式"强绑定比指望用户先读模式说明可靠；② **只发该模式用得到的槽**（`assetsForMode`）—— 先传首帧再切回文生视频是常见试探动作，残留首帧若随请求发出，上游会**真的**拿它当起点（云端按图收费）；③ **清素材要把模式带回**（`modeAfterSlotClear`）—— 否则留下"首尾帧模式但没有尾帧"的悬空状态。三者都是 `lib/assets.ts` 里的**纯函数**（18 项单测覆盖含边界：`assetId === ''` 的上传中乐观预览态一律视为"缺"）。模式按钮**恒可点**（素材没传就点不了模式会把用户卡在"想选首尾帧 → 按钮灰着 → 不知该先传图"的循环里），缺素材时由提交按钮的禁用态 + **说清缺哪一格**的提示收口。`AssetDropZone` 由单一槽改为通用槽（`kind: 'image' | 'video'`，视频槽用 `<video>` 预览且不做裁切 —— 参考视频原样透传）。
          - **如实标注**：`referenceVideo` → 上游 `reference_image` 字段对**视频**的接受度仍属【待验证】（`seedanceProtocol.ts` 里同一批字段都要在 AC2 冒烟时逐项核对），界面已写明这一句，不冒充已支持。
          - 验证：前端 **56 项**（+18）；**UI 冒烟新增第 6 节**实测「四个模式入口都在」「切首尾帧 → 出现尾帧槽 + 提示缺首帧」「切视频参考 → 出现视频槽且 `accept` 只收 `video/mp4`」「造一条真实夹具任务后画廊卡片由 `<img>` 渲染封面并被浏览器解码（`naturalWidth > 0`）」「有封面时不再挂 `<video>`」；破坏性验证命中（把封面分支临时钉成 `false` → 冒烟精确报两条封面断言失败）。
      - [x] **批次 4 · 扩写（台账 B3）【已验证】**（CONTRACT **V2.0**）：**纯 BYOK——服务端不设兜底 Key**。
        - **服务端**：`providers/llm.ts`（**单一 OpenAI 兼容实现**：`POST {baseUrl}/chat/completions`；端点解析「请求体 > `LLM_PRESETS` > 内置默认」；模型没按 JSON 回答时**照实取纯文本**并回 `notice`，不用规则引擎补字段冒充）；`routes/enhance.ts` 由"恒 501"改为真实实现，状态映射 **501 `LLM_NOT_CONFIGURED` / 400 `PROMPT_REJECTED` / 401 `KEY_INVALID` / 502 `UPSTREAM_ERROR`**；`resolveLlmKey()` 进 `security/credential.ts`（与视频轨同一套读取规则）；`packages/shared` 增 `LLM_PRESETS` / `LlmConfig` / 必填 `engine`；`/api/providers/status` 增 `llm` 能力位。
        - **前端**：BYOK 抽屉分两段（视频轨 / 文本轨，文本段提供「复用视频 Key」）；`byok.ts` 增 `llmPreset/llmBaseUrl/llmModel/llmKey` 并**逐字段回落**（旧版本存下的配置没有这些字段）；✨ 按钮在未填文本 Key 时置灰，**同一屏内写明原因与去何处配置**（"只置灰不解释"与"点了才说不能用"一样糟）；扩写成功把提示词替换并回报 `engine` 与镜头/光线建议，失败**不动用户原文**。
        - **三条"看起来能用、实际会坑人"的地方已按事实处理**：① `available` 恒 `false`（纯 BYOK），故 ✨ 的门控**只**看本地有没有 Key —— 否则复刻 V1.6「填了 Key 也用不了」的漏洞；② 选了「自定义」预设却留空**不回落到别家地址**（最初实现 `findLlmPreset('custom') ?? LLM_PRESETS[0]` 会把请求打到 OpenAI，测试已钉住）；③ 上游错误体常回显 Key，**所有**进入 message 的上游文本先过 `redactSecrets`（含本次 Key 原文、`Bearer …`、`sk-…` 形态）。
        - **超时归 `UPSTREAM_ERROR`（retryable）而非 `UNCERTAIN_RESULT`**：按 §6-D28 收窄硬规则 2（文本调用无持久副作用，重试不重复计费），且超时单独识别给中文说明（`AbortSignal.timeout` 抛的是英文）。
        - 测试：`providers/llm.test.ts`（16 项：端点解析 / 出站请求形状 / JSON 与纯文本两路 / 401 与 5xx 的三态 / Key 擦除 / 空内容）+ `routes/enhance.test.ts`（10 项：两条 BYOK 分支、`engine` 由路由硬编码、提示词纪律、四种失败状态码）；前端 **66 项**（+10：`x-llm-key` 只走请求头、缺 `engine` 判契约错、两条轨 Key 互不串台、预设切换与旧配置回落）。
      - [x] **批次 6 · 线上故障修复 + 操作日志【已验证】**（2026-09-23，用户报障驱动；CONTRACT **V2.1**）
        - **故障现象**：朋友使用线上站点时报 `HTTP 404 [invalidEndpointorModel.NotFound]：The model or endpoint doubao-seedance-video does not exist`，且"界面上切模型没反应"。
        - **根因（三层，全部实测确认）**：① `options.model` / `options.baseUrl` **没有任何消费方** —— 云端 provider 的模型只来自 `process.env.VOLCANO_MODEL_NAME`（代码注释写着"以用户填的为准"，实现却相反）；② `.env.example` 里 `VOLCANO_MODEL_NAME=doubao-seedance-video` 是**模板占位符**，但它长得像真值，被部署者原样抄进服务器 `.env`；③ 于是用户在界面上选的模型**被服务端静默覆盖**，而错误报文只提后者 —— 用户完全看不出发生了什么。
        - **铁证**：线上 `/api/history` 那条任务的 `requestSnapshot.options.model` = `doubao-seedance-2-0-mini-260615`（用户填的），而 `error.message` 里上游拒的是 `doubao-seedance-video`（服务端 env）。**同一份记录里两个模型名不一致**，就是覆盖的直接证据。
        - **修复（P0）**：优先级改为**请求 > env > 协议层默认**（`registry.resolveEffectiveModel` + `ProviderResolutionContext.requestOptions`，dispatcher 从 `job.request.options` 透传）；`.env.example` / `.env.deploy.example` 的假值改注释态；启动时对"已知占位符"**精确告警**（`getEnvModelWarning`）；`checkHealth` 里写错的 env 名（`SEEDANCE_MODEL`）改回真实名。
        - **修复（P0-C/D）**：`SEEDANCE_DEFAULT_MODEL` 与前端默认值换成 **`doubao-seedance-2-0-mini-260615`**（实测该账号可用 + 最省钱档，用户明确要求"尽量用最省钱的模型"）；BYOK 抽屉的模型文本框改为**档位下拉 + 自定义**（`VIDEO_MODEL_PRESETS` 放 `packages/shared`，6 档全部经"空 content 探测"验证可用）；文本轨预设里未开通的 `doubao-seed-1-6-250615` 改为实测可用的 `doubao-seed-2-1-lite-260915`。
        - **修复（P1）**：`classifyHttpFailure` 接收模型上下文，**模型/接入点不存在**这一类错误的消息里现在会写清"实际请求的模型 + 来源（请求/env/默认）+ 你填的那个被谁覆盖了 + 下一步去哪改"。
        - **修复（P1'，新路由）**：`POST /api/providers/keys/verify`（台账 B2 落地）：`GET /models` + **空 content 探针**（400=已开通 / 404=未开通，**不创建任务**；万一意外建了任务立刻 DELETE 并如实上报），文本轨用 `max_tokens: 1` 的真实最小请求；前端抽屉两条轨各带「测试连接」。**这是本次故障最缺的那个能力：提交前零费用回答"Key 行不行、模型在不在、开没开通"。**
        - **修复（P1''，测试基建）**：新增 `providers/registry.cloud.test.ts` —— 本地起**假方舟**（`node:http`），零费用地把"请求配置优先于 env""404 诊断文案""提交→轮询→下载→`/media` 直链"整条云端链路钉进 CI（此前云端路径只能靠真花钱的冒烟验证）。
        - **操作日志（CONTRACT §10）**：`event_log` 表 + `EventLogStore`（增删查 + 筛选）+ `server/requestLog.ts` 钩子（**噪声纪律**：写操作与失败请求记；`/media`、`/api/health`、日志页自身、成功的读请求不记）+ `routes/logs.ts` + 前端顶栏「日志」全屏页（时间/IP/动作/错误码/关键词筛选、分页、展开详情、删单条、按筛选清空、自动刷新 3s 可关）。用户 2026-09-23 拍板：**明文 IP、全员可见不加权限、全保留可手删、记请求体**（multipart 只记摘要、JSON 截断 4KB）。
        - **验证**：后端 **31 文件 / 291 用例**（新增 43：假上游 11 / 校验路由 8 / 请求日志 8 / 日志存储 8 / 注册点门控 1 + 既有用例修订），前端 **74**（+8），UI 冒烟新增第 7 节（**界面提交的任务必须出现在操作日志里** + 日志页轮询不被自记）；覆盖率总 **90.8%**，新增模块带文件级门限（覆盖率还逼出了 `listAvailableProviders()` 这段**死代码**，已删）。
        - **顺手清掉的两处**：① `checkHealth` 提示里指向不存在的 env 名；② 前端 `api.test.ts` 复用同一个 `Response` 导致第二次读 body 抛错（测试自身的缺陷）。
      - [~] **批次 5 · 真实出片【T2V 已完成 2026-09-23】**（用户提供可用方舟 Key 后开跑）：
        - **已完成**：`scripts/smoke-seedance-paid.mjs`（新，付费冒烟工具，带 `--confirm-spend` 防误跑）用 `doubao-seedance-2-0-mini-260615` / T2V / 720p / 5s **真机出片 1 次**，走的是产品路径（本地后端 + **`X-Provider-Key` 请求头**，符合 AC2 的硬要求）。实测：提交→终态 **86.5s**；成片 **5.09s / 1280×720 / 24fps / h264 + AAC 2ch 32kHz**（上游自带音轨）；**2.23MB**；`/media` 段请求 **HTTP 206**（`content-range=bytes 0-1023/2337094`）；**封面抽帧成功**；画面**无水印**（`--watermark false` 生效）；`requestSnapshot.options.model` 就是请求下发的那个（**优先级修复在真机上成立**）。§8 成本表已回填。
        - **四项【待验证】上游字段全部落地**（证据表写进 `seedanceProtocol.ts` 文件头）：请求体结构 ✓、`--` 尾缀参数 ✓（5s/16:9/720p 全部生效）、`status` 枚举 ✓（queued→running→succeeded）、`content.video_url` ✓（成片成功下载）。
        - **顺带发现的真实缺陷（都已登记）**：① **跨镜头主体一致性**：同一盏灯在 0.3s（近方形灯罩）、2.4s（圆形底座特写）、4.6s（圆筒灯罩）三个镜头里形态略有漂移 —— 广告片要"同一产品"必须用 I2V/首尾帧锁形或参考图，**说明 3-⑤ 新增的模式入口有真实用武之地**；② **云端轨默认带音轨**：prompt 未要求声音却产出 AAC 2ch —— 不可再假定"云端无声"，相关文案已改（`GUIDE` Q1 只讲本地 H3 的双引号台词纪律）；③ **费用只能估算**：`TaskProgress` 不含上游 usage，脚本只能按官方计费公式推算（≈108k token ≈ 1~2.5 元），**要精确入账得去方舟账单**（已登记 B24）。
        - **仍待（同一批次内）**：**I2V / FL2V / V2V 各一次真实出片**（验 `image_url` 的 `role` 语义与 3-⑤ 的槽位映射，同脚本 `--i2v <图>` 即可）；Step 4 端到端验收（AC1 要求 T2V + I2V 各跑通完整链路）。

---

## 6. 决策记录（ADR-lite，新的关键决策追加在此）

| # | 决策 | 理由 | 日期 |
|---|---|---|---|
| D1 | 弃素材拼接，改真实多模态生成 | 拼贴存量素材是"伪 AI"，无差异化价值 | 2026-09 |
| D2 | 双轨（云端 BYOK + 本地 H3）而非单轨 | 无卡用户零门槛体验；有卡用户 0 成本私密生成；共享大部分管线 | 2026-09 |
| D3 | BYOK 而非平台代付 | 个人项目无计费资质与资金兜底；Key 不出服务端、日志脱敏 | 2026-09 |
| D4 | Fastify + React 19 + 原生 CSS Tokens | 轻量、schema 校验一等公民；原生 Tokens 杜绝组件库与 AI 生成样式错位 | 2026-09 |
| D5 | 任务存储用 SQLite（better-sqlite3） | 零运维、单文件、重启可恢复任务；`data/` 已入 .gitignore | 2026-09-22 |
| D6 | 探针端点统一为 `/api/providers/status` | 原 `/api/system/probe` 与路由表矛盾，以语义更准者为准 | 2026-09-22 |
| D7 | MVP 通信用轮询，SSE 标记【规划】 | 轮询实现成本低且够用；长任务体验优化留待 Step 4 后评估 | 2026-09-22 |
| D8 | 素材能力降级为「可选开发期校验 provider」（OI-1 / OI-2），不做产品线 | 需要一条零成本、无 Key、无 GPU 的真实视频通道用于早期校验与回归；默认关闭 + 唯一注册点设计使其可整体删除，不构成架构负担 | 2026-09-22 |
| D9 | 多镜头编排层列为暂缓项（OI-3） | L1 优先：Step 2 只做单镜头；多镜头对云端 / 本地轨同样适用，属未来公共能力，需要时开分支验证后再决定合并 | 2026-09-22 |
| D10 | CI 夹具片段由 ffmpeg 合成；真实素材只用于演示走查 | 合成片确定性高、体积可控、可参数化覆盖边界（真实素材提供不了）；真实素材的价值在"给人看"而不在"给 CI 跑" | 2026-09-22 |
| D11 | 错误码升级三态（`retryable` / `terminal` / `uncertain`），新增 `UNCERTAIN_RESULT` | 付费轨无法确认结果时自动重提会造成**重复计费**；三态是"不确定性不自动重提"落地的唯一载体（CONTRACT V1.3 + 防线 7） | 2026-09-22 |
| D12 | `/api/providers/status` 改真实探测，禁止硬编码型号 | 占位实现恒真会让无卡机器误报本地可用，并使能力位开关（含 OI 的默认关闭）失去载体；探测不到必须显式 `available: false` + `reason` | 2026-09-22 |
| D13 | 开发期故障注入层（`FAULT_INJECT` 默认 off） | 流中断 / 半包 / 磁盘写满只能发生在真实调用链上，mock 无法覆盖；每个注入项配自动化断言 | 2026-09-22 |
| D14 | CI 三件套（lint / type / test）纳入 Step 2 范围 | Step 2 的全部 AC 依赖自动化验证；Step 1 骨架期不铺流水线，避免为未定型代码建 CI | 2026-09-22 |
| D15 | 告警走 `TaskProgress.warnings: string[]`，不复用 `message`（CONTRACT V1.4） | `message` 会被后续进度刷新覆盖，且**无法并存多条**；OI-1 的「循环拉伸」与「音轨静音」会同时产生两条；告警只打服务端日志等于没有 | 2026-09-22 |
| D16 | OI-1 采用四步确定性选片规则；短于请求走「循环拉伸 + 告警 + 音轨静音」 | 随机取首条会导致 CI 断言漂移、观感随机、loop 概率失控；确定性规则让 loop 成为**明确的降级路径**而非随机结果，并为 W2 的 LLM 选材打分留出替换位 | 2026-09-22 |
| D17 | Step 2 provider 实施顺序：OI-2 → 公共链路 → Seedance → OI-1 | 公共链路是三者共同地基；OI-2 零成本零依赖，适合反复制造故障来验 AC4 / AC7；Seedance 每次调用都是真钱，应放在地基稳定之后 | 2026-09-22 |
| D18 | 前后端类型单一事实源：`packages/shared` 契约包（zod schema 定义 + `z.infer` 导出类型），前后端经 workspace 依赖消费；CONTRACT.md 中的 TS 代码块降为「文档投影」 | 现状前后端三处手写接口类型（App.tsx / index.ts / CONTRACT.md），无共享必漂移；zod schema 同时充当运行时校验与类型来源，一份定义两处受益 | 2026-09-22 |
| D19 | 路由级 schema 校验采用 `fastify-type-provider-zod`，所有路由（含响应）挂 shared 包中的 zod schema | D4 选型理由「schema 校验一等公民」在 Step 1 未兑现（zod 已装零使用）；响应挂 schema 可让占位实现这类「文档外形状」在序列化期直接报错 | 2026-09-22 |
| D20 | 任务队列保留 SQLite 承载，但调度器面向 `JobQueue` 抽象接口编程（submit/claim/complete/fail/requeue）；BullMQ 仅作为「多实例公网部署」场景的替换实现预留，当前不引入 Redis | 本地轨 Concurrency=1 与单用户场景下 Redis 是纯运维负担（Windows 开发需 Docker/Memurai，违背 D5 零运维）；真正的生产级风险在幂等与 GPU 互斥而非队列中间件，SQLite 事务已可保证原子 claim | 2026-09-22 |
| D21 | 公网部署启用最小鉴权（单 Bearer Token + 回环免鉴权）；防抖限流键定义为「IP + Key 指纹」复合 | Step 5 公网无鉴权 + 限流键未定义 = 匿名刷接口口子；个人项目单 Token 足够，不引入用户体系（细则见 §7-4 / §7-5） | 2026-09-22 |
| D22 | **探针降级**：`/api/providers/status` 取消一切自动硬件扫描；`local` 段语义改为「本服务已配置的本地引擎自检结果」，只能由显式配置动作产生；Tier 0~3 改语义为「推荐配置说明」，**不参与任何自动锁定或置灰** | 探针是公开只读端点，其返回值会被所有访客读作"我的能力"——无卡服务器让访客以为"我的设备不行"、强配置服务器让访客误以为"我的设备能跑"；用户红线是不替用户假定硬件、不剥夺手选本地的权利。Tier 矩阵作为"选型建议"仍有价值，但自动分级必须有显存数字，而显存数字在浏览器侧不可得 | 2026-09-22 |
| D23 | **BYOK Key 由客户端持有**：浏览器存储 + 请求头 `X-Provider-Key` 传递，服务端过手不落地（零留存）；`cloud.keySource` 收窄为仅 `'env'`，新增 `cloud.acceptsClientKey`，前端自行合成实际能力；写入/清除**无**服务端路由 | V1.7 的 `keySource:'session'` 无任何可达路径（契约缺口），前端填入的 Key 无法激活云端轨；服务端会话存储需引入会话生命周期与多实例共享问题，成本高于客户端携带。附带收益：天然按访客隔离。如实代价：Key 必经服务端内存，第三方托管场景需明示信任边界 | 2026-09-22 |
| D24 | **供应商聚合边界**：文本侧单一 OpenAI 兼容实现 + `LLM_PRESETS` 预设表（放 `packages/shared`）；视频侧维持 `VideoProvider` 适配器；LLM 凭据独立（`X-LLM-Key`），不与视频 Key 共用但允许前端一键复用；**未配置 LLM 显式返回 `LLM_NOT_CONFIGURED`，禁止静默降级**；`PromptEnhanceResponse` 增加必填 `engine` | 不存在"OpenAI 兼容的视频生成标准"，强行统一会造出伪抽象；而文本侧各家兼容层已收敛到同一形状，一份实现即可覆盖。`engine` 字段是"是否静默降级"在测试层面唯一可证伪的诚实标记。**（2026-09-22 已按此实现：见 §5「V8.3 批次 4」与 CONTRACT V2.0）** | 2026-09-22 |
| D25 | **D21 拆分时点**：最小鉴权维持"Step 5 前"；限流键 Step 2 走 IP 单键（§7-5 已有退化路径），复合键（IP + Key 指纹）随 Step 5 落地；限流器签名**先预留** `keyFingerprint?` 参数 | 复合键的输入（Key）在 Step 2 尚无真实调用产生，强做只能造假键、等于假验收；而防线 5 的**机制**（60s 冷却 + 落 SQLite + 重启不丢窗口）不可简化——故障注入层的 `rate_limit` 项需要真实可测的限流器。签名预留避免 Step 5 的晚期结构性变更 | 2026-09-22 |
| D26 | **本地轨 scope 分裂**：`host` scope（本地引擎在部署主机，服务端 `local` 轨 Concurrency=1）Step 2 实现；`client` scope（本地引擎在**访问者本机**）为台账 **B1**——浏览器直连 `127.0.0.1`，服务端不调度，产物回传归档，防线 1 落于 worker 自锁、防线 3 落于用户机器（须回报 `tmpCleaned` 并写入 `warnings[]`） | 用户已拍板本地轨改用户本机 worker；但一次性实现会把防线 1 的落点从服务端队列拆到客户端，并牵动 JobQueue 轨模型与 Step 5 鉴权，而 Step 2 的 AC 与 S1/S2/S5 都不依赖 client 轨。分两段可保住 Step 2 不返工，同时把 worker 的形态 / 端口 / 协议在契约中先定死 | 2026-09-22 |
| D27 | **硬件细节只给部署者**：`local.gpuName` / `vramFreeGB` 从状态契约删除（面向访客的端点不得携带硬件型号）；部署者需要时在其自有设置面板查看自检结果 | 面向访客的状态面携带型号即等于广播部署方硬件信息；且 AC6 要求"不得返回硬编码型号"，最彻底的满足方式是**该端点不存在这类字段**（键集合断言已有先例） | 2026-09-22 |
| D29 | **主题体系：默认跟随系统 + 两套 token**（暗色=星尘内核，按参考图**略微提亮**；日间=现代简洁·蔚蓝，"金"整体映射为蔚蓝）；切换只读写 `<html data-theme>` 与一个 localStorage 键，**组件层不认识主题**；两套主题的对比度按 WCAG 公式进 CI 静态断言 | 用户反馈"目前有点太暗"，并确认 Astrmira 参考图可用但**不必完全趋同**；把颜色收进 token 而不是在组件里判断主题，是"以后加第三套主题零改动"的唯一廉价实现。对比度必须机器核：实测过一次"看着够、实际 3.64:1"的先例 | 2026-09-22 |
| D30 | **BYOK 配置优先级：请求 > env > 内置默认**（模型与端点同规则）。`options.model` / `options.baseUrl` 是 BYOK 的一部分，注册点必须消费它们；env 只是"用户没给"时的兜底 | 2026-09-23 线上故障的直接根因：注册点**只读 env**、请求里的模型无人消费，于是"界面切模型"完全无效；更糟的是错误报文只提 env 的值，用户完全看不出被覆盖。教训写进契约 §1 的 `options` 注释：**"请求优先"是契约级要求，不是实现细节** | 2026-09-23 |
| D31 | **"提交前可验证"是产品要求**：新增 `POST /api/providers/keys/verify`（台账 B2），用**零费用**手段回答"Key 行不行 / 模型在不在 / 开没开通"——视频轨 = `GET /models` + **空 content 探针**（400=开通 / 404=未开通，不建任务、意外建了立刻取消）；文本轨 = `max_tokens: 1` 的真实最小请求 | 本次故障里用户是**花了一次真实提交**才拿到"模型不存在"；而"模型 id 对不对"本可零成本提前问清。把它做成路由而不是前端本地猜测，是因为判断依据在上游（`/models` 与开通状态只有上游知道） | 2026-09-23 |
| D32 | **操作日志的噪声纪律**：只记**写操作**与**失败请求**；`/media/*`、`/api/health`、`/api/logs*` 与**成功的读请求**一律不记 | 任务进度与日志页自身都是 2~3s 轮询：把读操作也记下来，半天就能把"操作日志"变成"轮询日志"，真正的动作被埋掉 —— 那等于这个功能不存在。日志页不记自己尤其关键（否则自我增殖） | 2026-09-23 | 硬规则 2 原文"上游无响应 / 超时一律归 UNCERTAIN_RESULT"是为付费任务设计的；照搬到 LLM 会让"扩写失败"变成"需人工核对可能的费用"，属语义污染，并会让 `uncertain` 失去高警示等级的含义 | 2026-09-22 |

---

## 7. 安全与合规（吸收原 COMPLIANCE.md，唯一详写处）

1. **密钥管理**：火山 Key 由**客户端（浏览器）持有**，随请求头 `X-Provider-Key` 传递（唯一载体，见 CONTRACT §5「凭据传递约定」）；服务端**过手不留存**——不落盘、不写日志、不回显明文；日志中 Token 强制掩码（如 `sk-****abcd`）；服务端仅在单次请求的内存上下文内接触该 Key。**如实声明**：Key 转发必经服务端内存，故"服务端绝不可信"的假设不成立——自建 / 信任场景无碍，第三方托管场景由前端文案明示信任边界（§6-D23）。
2. **本地模型边界**：MiniMax H3 全程本地离线，图像与音频不出本机；ComfyUI 仅限回环或受控局域网——服务端对 `H3_WORKDIR` / `COMFYUI_BASE_URL` 做白名单校验（仅回环地址 / RFC1918 内网 / 本机路径），拒绝任意外部地址，防 SSRF 与任意命令面暴露。
3. **公网部署形态**：默认路由云端轨，不开放任何本地 Shell 执行面；**不向访客开放 host 本地轨**（`EXPOSE_HOST_LOCAL_TRACK` 默认 `0`，见 §6-D26）；单任务时长上限 5~10s，防任务堆叠。
4. **公网最小鉴权（V8.1 新增，Step 5 前必须落地）**：公网部署时**除下面两层白名单外的全部路径**都要求 `Authorization: Bearer <PUBLIC_API_TOKEN>`（值在 `.env`）——鉴权钩子是**全局 `onRequest`**，因此 `/api/*`、`/media/*` 与前端产物 `/` 一并受保护（线上由 Caddy 把站点登录凭据换成 Bearer，见 `deploy/Caddyfile.*`）。**免鉴权名单（两层，口径唯一）**：① **回环来源**（127.0.0.1 / ::1）的全部请求免鉴权——保证单机开发零摩擦；② **任何来源**的 `/api/health` 免鉴权——存活探针。除这两层外一律要求 Bearer；无鉴权公网裸奔视为验收不通过。
5. **限流键定义（V8.1 新增）**：防线 5 的 60s 防抖按「来源 IP + BYOK Key 指纹（Key SHA-256 前 8 位；无 Key 时仅用 IP）」复合计数；本地部署无 Key 场景退化为 IP 单键。防抖状态存 SQLite，重启不丢失冷却窗口。**落地时点（已修正，2026-09-22）**：复合键**已落地**——限流器早先预留的 `keyFingerprint?` 参数已按 §9 台账 B8 接线（`generate.ts` 传 `fingerprintKey(providerKey)`），即"随 §6-D25 的最小鉴权在 Step 5 前置落地"这条已经兑现，文档此前仍写着"Step 2 先 IP 单键"，属文字陈旧。
6. **上传与静态面加固（V8.1 新增；V8.2 起含防线 4 清洗）**：`/api/upload` 限制单文件 ≤ 20MB、总数 ≤ 4，MIME 以魔数嗅探为准（不信任 Content-Type 头），白名单：jpg/png/webp/heic/mp4/mov；**图像必须过防线 4 清洗网关**（`pipeline/imageSanitize.ts`：EXIF 方向矫正、CMYK→sRGB、超大图下采样到长边 ≤ 2048、32 倍数规整、剥离元数据；透明通道保 PNG、其余统一 JPEG）——因此响应的 `mime` / `size` 是**清洗后的产物事实**而非客户端声明；`.heic`（HEVC）按实测能力**诚实拒绝**（415 `INVALID_ASSET` + 转格式指引，见台账 B21），视频原样落盘；`outputs/` 直链路径只含服务端生成的随机 ID，禁止任何用户输入拼入文件路径（防路径穿越）；CORS 由 `origin: true` 收紧为 `.env` 白名单（`CORS_ORIGINS`，本地开发默认 `http://localhost:5173`）；安全响应头（`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`）统一挂载。
7. **文档卫生**：IP / 绝对路径 / 凭证永不入 md（占位符化），真实值只存本地 `.env`；`.env`、`data/`、`outputs/`、媒体文件已入 `.gitignore`。
8. **视觉版权**：UI 视觉语言参考 Astrmira 的公开设计风格，**已获其作者许可**（来源登记见 UPSTREAM 第 10 条）；README 不再单列免责段。

---

## 8. 成本与风险

| 项 | 数字 | 标记 |
|---|---|---|
| 本地 H3 出片耗时 | 480x832 / 124 帧：Tier 2（16GB）实测 Disk Offload 单步耗时约 8~14 分钟，50 步全量生成约需 7~10 小时；不可用于实时交互，仅适合离线批处理 | 【已验证实测】详见 gen_drama.log |
| 云端 Seedance 耗时 | **提交→终态 86.5s**（`doubao-seedance-2-0-mini-260615` / T2V / 720p / 5s；其中排队与生成合计，轮询在 2s 内首次拿到 `queued`） | **【已验证实测】**2026-09-23，`scripts/smoke-seedance-paid.mjs` |
| 云端 Seedance 单次成本 | **约 1~2.5 元 / 条（5s @720p）【估算】**：按上游计费口径 `token = (输入时长+输出时长) × 宽 × 高 × 帧率 ÷ 1024` = 5×1280×720×24÷1024 ≈ **108,000 token**；mini 档第三方价目 $3.24/M（输入不含视频）→ ≈ $0.35。**实际扣费以方舟控制台账单为准**（未核对我方账单） | **【待验证】**金额待账单核对；**计算口径与耗时口径已实测** |

**风险登记**：
- R1：DiffSynth-Studio / H3 权重版本漂移 → 锁版本号并记录于 UPSTREAM.md；
- R2：Seedance API 变更 → Provider 接口隔离，变更只动 `VolcanoSeedanceProvider`；
- R3：画廊磁盘膨胀 → 防线 3（LRU + 一键删除）已在设计内；
- R4：素材站配额（Pexels 200 次/小时）被流水线反复消耗 → CI 一律走 OI-2 `fixture-local`，仅手动回归用例允许联网走 OI-1。

---

## 9. 待优化台账（backlog · 唯一权威位置）

> 本节的项**不在 Step 2 ~ Step 5 的实施范围内**；它们是本次架构决策中**主动降级 / 延后**的项与已识别但暂不处理的问题，逐项登记「何时必须做」，避免遗忘或临时拍脑袋。施工手册只引用本节（`docs/EXEC-STEP2-5.md` §13），**不复制内容**。
> **B16 ~ B21** 为 2026-09-22 随 B9 落地（端到端 / 覆盖率 / UI 冒烟 / 基准脚本）、UI 冒烟实测发现、S6 编号勘误与图像清洗网关落地后的追加项。

| # | 项 | 来源 | 何时必须做 |
|---|---|---|---|
| B1 | 用户本机 worker（`astrmira-worker/v1`：协议 / 端口 8765 / 浏览器直连 / 结果回传归档；防线 1 落于 worker 自锁、防线 3 落于用户机器） | §6-D26 | 出现「让有卡用户 0 成本自跑」的真实诉求时 |
| B2 | ~~`POST /api/providers/keys/verify`~~ → **已完成**（V2.1 / §6-D31：`GET /models` + 空 content 探针 + 文本 `max_tokens:1`；见 §5「V8.3 批次 6」）。**余项转 B25**（独立限流桶） | §6-D23 / D31 | — |
| B3 | ~~LLM 扩写全量~~ → **已完成**（`providers/llm.ts` + `LLM_PRESETS` + `X-LLM-Key` + 前端门控，CONTRACT V2.0；见 §5「V8.3 批次 4」） | §6-D24 | — |
| B4 | `POST /api/providers/local/verify` 运行时自检 + 设置抽屉「测试连接」 | §6-D22 | Step 3 做本地配置面板时 |
| B5 | ~~本地轨访客开关~~ → **不列台账**（已并入首发护栏：`EXPOSE_HOST_LOCAL_TRACK` 默认 `0`） | §6-D26 | — |
| B6 | Tier 推荐文案单一事实源（`packages/shared` 常量 + 文档投影 + 键集合断言） | §6-D22 连带 | 文案第二次修改前（**否则两处副本漂移必然发生**） |
| B7 | OI-1 `stock-local` 素材 provider（四步确定性选片、循环拉伸 / 音轨静音告警） | §4「Step 2 补充」 | 需要「无 Key 零成本真实视频」时 |
| B8 | 复合限流键（IP + BYOK Key 指纹 SHA-256 前 8 位） | §6-D25 | **上线前必须做**（NAT 共享出口下 IP 单键会互相误伤）【待验证：实际影响面】 |
| B9 | CI 三件套之外的视觉 / 端到端固化、覆盖率、性能基准 | §4 Step 4 | **CI 侧已完成**（真实 TCP 端到端 / 覆盖率文件级门限 / 生产形态 UI 冒烟 / 手动基准脚本，见 §5）；余项转 **B16 / B17** |
| B10 | SSE 实时推送（替代轮询） | §6-D7 | 轮询体验被投诉时 |
| B11 | `TaskProgress.executedBy` + 画廊诚实标注任务实际执行位置 | §6-D26 | 与 B1 同步 |
| B12 | 中间帧清理在 client 轨的审计（worker 回报 `tmpCleaned` 写入 `warnings[]`） | §6-D26 | 与 B1 同步 |
| B13 | Tier 表数值的实测验证（GUIDE §一 全列【待验证】） | GUIDE §一 | 有对应档位硬件可实测时 |
| B14 | worker 默认端口 8765 / 目录约定的冲突实测 | §6-D26 | 与 B1 同步 |
| B15 | CSP（`default-src 'self'`）与「数据路径零 `innerHTML`」的自动化断言 | §6-D23 | Step 5 内落地（公网刚需） |
| B16 | 浏览器级视觉的**像素基线**比对（当前只做语义冒烟 + 截图留档，**刻意不比像素**：跨平台字体渲染差异是长期 flaky 源） | §9-B9 余项 | UI 大改后想"冻结"视觉时（先定字体 / 亚像素差异的容忍度策略） |
| B17 | 性能基准的 **CI 门限**（当前只提供 `scripts/bench.mjs` 本地手动测量，CI 不设门） | §9-B9 余项 | 有自托管 runner，或出现性能投诉时 |
| B18 | 开发机与 CI / 镜像的 **Node 版本对齐**（本机实测 `v24.14.0`，CI 与 `Dockerfile` 均为 22；建议 `.nvmrc` + `engines` 收口） | 本次实测发现 | 下次出现「本地绿、CI 红」时立刻做（环境漂移类问题最难查） |
| B19 | **中文衬线字的自托管策略**：`--serif` 里的 `"Noto Serif SC"` 现仅是本机字体候选（不再从网络加载），中文衬线会回落系统字体；要统一观感需自托管 CJK 子集（体积大） | 本次实测发现（生产 CSP 拦掉外部字体引发） | 动视觉体系时（与 B16 一起做） |
| B20 | ~~防线 4 图像清洗网关未实现~~ → **已实现**（`backend/src/pipeline/imageSanitize.ts` + 接入 `/api/upload`，见 §5 的 S6 条目）；本行只留一条教训：**编号错位会让"没做"读成"已跳过"**（当时 S6 槽位被 OI-1 占用） | §3 防线 4 / §4 Step 2（S6） | — |
| B21 | 让 `.heic` **真正可用**（当前按实测能力走"诚实拒绝" 415 + 指引）。两条候选路径：① 镜像内加 Debian 的 `libheif-examples`（`heif-convert` CLI，走子进程，与 ffmpeg 同一套路）；② 换用带 HEVC 解码器的 libvips 构建（sharp 预编译不含 x265/libde265） | 本次实测发现（HEVC 解码器缺失） | 出现"iPhone 用户上传 HEIC"的真实诉求时；**在此之前保持 415 + 可执行指引**，不许静默放行 |
| B22 | 画廊**容量淘汰**（LRU / 阈值清理，替代"只增不减"）；当前只有 `DELETE /api/history/:taskId` 的手动删除与 `listRecent(50)` 的列表上限 | 文档/代码核对（§1 架构图、§3 防线 3、CONTRACT §7 曾写"LRU"，实际无实现） | 用户拍板**暂缓**：初期存储需求不大。触发条件 = `outputs/` 体积超阈值或出现磁盘告警 |
| B23 | **操作日志的容量与保留策略**：当前按用户拍板"全保留 + 手动删"（`event_log` 只增不减，无自动淘汰）。候选方案：按天数/条数自动裁剪、`VACUUM` 定时整理、导出为归档文件后清库 | §10 操作日志（V2.1） | `data/app.db` 体积超阈值或日志页翻页变慢时（噪声纪律已挡掉轮询，增长速度远慢于画廊） |
| B24 | **模型档位表（`VIDEO_MODEL_PRESETS`）的维护与价格实测**：档位 id 带日期后缀、方舟持续上新；表里的价格说明全部标【待验证】（来自官方活动页与公开报道，**未经我方计费账单核对**）。另：可用性**按账号**（需先开通模型服务） | §6-D31 / CONTRACT §9 | ① 出片冒烟（批次 5）后把实测单价回填 §8 成本表；② 方舟上新模型或某档下线时 |
| B25 | `keys/verify` 与 `logs` 两个新端点的**独立限流桶**（当前共用 60s 冷却逻辑之外无专门限制；`keys/verify` 会向上游发请求，被刷等于拿部署者的服务器当探针） | §6-D31 余项（B2 拆分） | 公网出现异常调用量时；`verify` 有幂等缓存更好（同 Key+模型的结果缓存数分钟） |
