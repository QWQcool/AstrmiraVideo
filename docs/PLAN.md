# AstrmiraVideo · 产品与开发规划（PLAN V8.5）

> **修订说明（V8.5，2026-09-23）**
> 1. **Step 4 端到端验收【已完成】**：AC1（真实云端轨 T2V / I2V 复验）与 AC2（上传清洗网关的**落盘产物**断言，固化为集成测试）全部通过；产出 [walkthrough.md](walkthrough.md)（§4 Step 4 各 AC 与 §5 进度日志已按结果更新）。
> 2. §8 成本表回填本轮实测（T2V 89.0s / I2V 62.3s / 上游隐私检测 8.1s 终态）。
> 3. §9 台账新增 **B32**（I2V / FL2V 真人输入的体验收敛）——源自本轮**真实踩到**的上游隐私检测（`InputImageSensitiveContentDetected.PrivacyInformation`）。
> 4. 上游行为知识同步进其唯一 Owner：`backend/src/providers/seedanceProtocol.ts` 文件头证据表（隐私检测 / 非 32 倍数输入链路 / 云端音轨）；GUIDE §三与 FAQ 补 Q10 的用户侧口径。

> **修订说明（V8.4，2026-09-23）**
> 1. **新增 §4 Step 6「V9 前端改版」**（总览页 + 可收展侧栏 + 自写 hash 路由 + 界面级动效体系 + 移动端响应式 + 提示词配方库 + 轻剪辑台 MVP），决策见 §6 的 **D33~D38**，全部接口规划落在 CONTRACT **V2.2**。
> 2. §9 台账新增 **B28~B31**（react-router 迁移触发 / 剪辑台增强 / 配方库行业维 / 图片生成入口）。**「剪映草稿导出」经讨论后明确砍掉**（理由见 D37，不再挂台账）。
> 3. 本轮由用户逐条拍板（顶栏精简保留 / HTML 高保真稿先行 / hash 路由 / 拆帧剪辑定位 / 配方库双入口 / 双主题保留 / 移动端同批做），施工执行手册为 `docs/EXEC-V9.md`（**一次性**，V9 验收后归档删除，沿用 Step 1.5 与 EXEC-STEP2-5 的生命周期惯例）。

> **修订说明（V8.3，2026-09-23）**

> **修订说明（V8.3，2026-09-23）**
> 1. **一次性施工手册 `docs/EXEC-STEP2-5.md` 已归档删除**（Step 2 ~ Step 5 的施工卡、片内改动清单、破坏性验证与证据格式都已完成使命，历史从 git 取回）。
>    它仍有效的口径**逐处迁入本文件**：§3 铁律 → README 协作规范；§2 开发前置 → §8 施工避坑；§9-3 部署硬要求 → **§7-9**；§12 已知坑 → §8 施工避坑；§13 台账指针 → §9；Step 3/4/5 的 AC 早已在本 §4。**此后不再有第二份施工入口**——动手前读 §4 的 Step+AC、§5 的进度日志、§6 的决策、§9 的台账即可。
> 2. **新增 §7-9「部署形态与三条硬要求」**（原手册 §9-1 / §9-3 的存档）。
> 3. §8 施工避坑表补入原手册 §2 的三条开发前置（ffmpeg 系统安装 / 依赖缺失的中文报错 / 目录与卷约定）。
> 4. 决策记录扩到 **D32**（V8.3 期间新增 D30 请求优先于 env、D31 提交前可验证、D32 操作日志噪声纪律）。

> **修订说明（V8.2，2026-09-22）**
> 1. 落地 Step 2 开工前的四项架构决策：**探针降级**（D22：取消一切自动硬件扫描，Tier 改「推荐配置说明」「不参与自动锁定」）、**BYOK Key 客户端持有**（D23：`X-Provider-Key` 过手不留存）、**供应商聚合边界**（D24：文本侧单实现 + 未配置显式拒绝）、**D21 拆分时点**（D25：限流键先 IP 单键）；
> 2. §6 追加 **D22 ~ D28**；§1 架构图与「双轨调度原则」、§3 防线 1 / 防线 3 补入本地轨 **scope 分裂**（host = Step 2；client = 台账 B1）的落点；§4 Step 2 任务行与 **AC6 / AC9**、Step 5 **AC2** 按新口径改写；
> 3. §7-1 密钥管理措辞改写（Key 客户端持有、服务端过手不留存；D3 措辞同步修正），§7-3 / §7-4 / §7-5 补白名单与时点口径；
> 4. **新增 §9 待优化台账（B1 ~ B15）**：本次主动降级项与延后项的**唯一权威位置**，含每项「何时必须做」；
> 5. 施工入口：Step 2 ~ Step 5 的施工步骤以 `docs/EXEC-STEP2-5.md` 为**全仓唯一施工权威**（一次性手册，Step 5 验收后归档删除）。**〔2026-09-23 更新：该手册已按生命周期条款归档删除，仍有效的口径全部迁入本文件（见 V8.3 修订说明）；此后施工入口 = §4 Step+AC + §5 进度日志 + §6 决策 + §9 台账〕**

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
  **【FL2V / V2V 已完成 2026-09-23】**（`scripts/smoke-seedance-paid.mjs` 扩成四种模式，模式由输入推断而非另传 `--mode`）：
  - **FL2V【已验证】**：首帧+尾帧两个资产（经清洗网关上传达 71KB JPEG）→ 出片成功，提交→终态 **100.4s**、5.09s / 1280×720 / h264+AAC / 2.50MB / 206 正常 / 封面正常；逐帧核对 **0.1s 起于首帧场景、4.9s 与给定尾帧几乎一致** → `last_frame` 角色语义成立。
  - **V2V【形态已验证 + 修掉两个真错误 + 线上端到端已跑通】**：
    - 错误一（请求形状）：原实现把视频塞进 `image_url` / 角色 `reference_image`，上游 400（`content[1].image_url is not valid`）。三次**参数级探测**（不产生成片费用）问出正确形态：`{type:'video_url', video_url:{url}, role:'reference_video'}`，且 **URL 必须是上游能抓的公网地址**（原文：`reference_video must be provided as a web url`；data URL 直接拒）。修法：协议层新增 `video_url` 元素与 `SeedanceVideoRole`；provider 拆出 `collectReferenceVideoUrl`（非 http(s) 地址 → 提交前报 `INVALID_ASSET` 并提示配置 `PUBLIC_BASE_URL`，**不发注定 400 的请求**）；CONTRACT §1 的 `referenceVideo` 字段补注。
    - 错误二（部署配置，**只有线上 V2V 会暴露**）：`PUBLIC_BASE_URL` / `CORS_ORIGINS` 虽由 `deploy.mjs` 推导，却**没写进 compose 的 `environment:`** —— `env_file` 只能搬运 `.env.deploy` 里的值（模板是空值），推导值永远进不了容器。后果是资产地址退化成 data URL：**图片能用、视频被上游拒**，所以此前没有任何路径暴露它。修法见 §7-9。
    - **最终验证（线上实例）**：`pnpm smoke:paid --server https://<站点> --creds-file … --video <参考片>` → 提交→终态 **116.7s**、成片 5.09s / 1280×720 / h264+AAC / 2.40MB、`/media` 206 正常；抽帧核对**画面确实按参考视频重绘**（2.5s 即参考片里"手指按开关 + 冒热气的茶杯 + 翻开的书"那一刻）。该成片同时留在线上画廊，可供人工查看。
    - 测试 +5（协议 2 / provider 3，含"视频给 data URL → 零上游调用"）。`smoke-seedance-paid.mjs` 因此扩出 `--server` / `--creds-file` / `--insecure`（自签 IP 档）与"线上模式先把成片取回再 ffprobe"。
  - **仍未实测**：上游 `status` 枚举里的 `failed` / `cancelled` / `canceled` / `expired` 四个**分支**（需要一次真实的上游失败或取消样本）。**2026-09-23 补**：**我们自己的任务终态 `failed`** 已获真实样本（I2V 输入图被上游隐私检测拒绝 → 400 → `UPSTREAM_ERROR` + `terminal`，提交→终态 8.1s；见 [walkthrough.md](walkthrough.md) §1-3a）——它与"上游 `status` 枚举"不是一回事，勿混。
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
> **状态【已完成 2026-09-23】**：AC1 ~ AC4 全部通过，证据归档 = [walkthrough.md](walkthrough.md)。以下 AC 原文保留（口径不变），括号内为本轮结果。
- **AC1**：T2V（含双引号台词人声）与 I2V（含 32 倍数裁切）各跑通 1 次完整链路，**必须用真实云端轨**（本地轨全量出片 7~10 小时/条，不作为验收手段，见 §8）。~~当前阻塞：与 Step 2-AC2 同一把 Key。~~ **【已完成】**：两条链路均于 2026-09-23 复验（走 `X-Provider-Key`，证据见 walkthrough §1）；**"双引号台词人声"是本地 H3 的能力、不在本轮范围**（本地轨未实现），云端音轨只做客观检测（能量 / 静音段）不做内容断言——验收记录已如实澄清。
- **AC2**：WebP / 超大图各上传 1 次，清洗网关**输出合规**（sRGB、32 倍数、长边 ≤ 2048、透明通道保留）——**断言以落盘产物为准**（`ffprobe` / sharp 元数据复核），不看响应字段自证；**HEIC 按实测能力走"诚实拒绝"**：`.heic`（HEVC）返回 **415 `INVALID_ASSET`** + 可执行转格式指引，**不得**静默放行、也不得假装成功（实测：预编译 libvips 与 ffmpeg 都没有 HEVC 解码器，见 §5 的 S6 条目；让它真正可用的路径见台账 B21）。**【已完成】**：六类输入（WebP / 超大图 / 非规整 / 透明 / HEIC / EXIF）已**固化为集成测试** `backend/src/routes/upload.sanitize.integration.test.ts`（走真实 `/api/upload` + 落盘断言），而非只留一次手工记录。
- **AC3**：项目级 DoD 达成——后端契约测试全绿 + 上述两条 e2e 全绿。**【已完成】**（见 walkthrough §3）。
- **AC4**：CI 以 OI-2（`fixture-local`）跑通端到端并产出可播 MP4（**已完成**：`backend/src/e2e/` 走真实 TCP + `/media` 206 Range + `ffprobe` 校验，见 §5 的 B9 条目）；OI-1（`stock-local`）已按非目标跳过（台账 B7），**不参与验收**——验收记录必须如实写明，不得含糊带过。
- **产出**：`walkthrough.md` 验收记录 —— **已产出**（[docs/walkthrough.md](walkthrough.md)）。

### Step 5：公网部署与交付
- **任务**：`Dockerfile` + `docker-compose.yml`；反向代理 + HTTP 206；部署至 `DEPLOY_HOST`（值在本地 `.env`，勿写入文档）。
- **AC1**：外部手机浏览器访问公网地址，无卡环境下默认云端轨出片成功。
- **AC2**：状态端点返回 `local.available: false`，前端**展示推荐配置说明**，本地开关**保持可选（不置灰）**；选择未配置的本地轨提交时返回 `PROVIDER_UNAVAILABLE`（`terminal`）。
- **AC3**：`.env`、SQLite、outputs 均不入镜像、不入 git。

### Step 6：V9 前端改版（总览 + 侧栏 + 路由 + 动效 + 配方库 + 轻剪辑台）

> 背景：单页三栏在"只有生成"时刚好够用，但操作日志、配方库、剪辑台进来后必然臃肿（用户原话）。方向由用户拍板：参考**即梦的可伸收侧栏**与**可灵的队列/资产管理**，保留我们自己的 Astrmira 视觉体系。视觉与布局参考图集中收在 `docs/assets/`（含索引 README）。
> **执行手册：`docs/EXEC-V9.md`（一次性，验收后归档删除）；接口契约 = CONTRACT V2.2 §3/§5/§7/§11；决策 = §6-D33~D38。**
> **零 API 成本红线：本 Step 全程不调用任何付费上游**（剪辑台是本地 ffmpeg；配方库是静态数据）。唯一的例外是主动跑 `pnpm smoke:paid` 验证剪辑台→生成的闭环，默认不做。

- **任务**（实施顺序 = B1~B10，见执行手册）：
  1. **HTML 高保真原型稿**：用真实 `tokens.css` + 字体写静态稿（总览 / 工作台 / 视频库三视图），**用户确认后才准进入实现**（AI 生成图已证明"看起来对"和"做起来对"是两回事，原型稿就是用来提前暴露这个差距的）；
  2. **应用壳重构**：左侧栏（默认展开，可收成 56px 图标栏，状态存 localStorage）+ **自写 hash 路由**（一级视图 = `#/overview` `#/workbench` `#/library` `#/recipes` `#/logs`；剪辑台 = `#/edit`（**不进侧栏**，源片经 hash 查询参数 `?task=<id>` 传入）——约 40 行 hook + 数据化的视图注册表（含 `hidden` 标志）；react-router 作为台账 B28 的扩展预留）+ 顶栏精简为「品牌 logo + 服务在线状态」（D33）；现有三栏原样成为"生成工作台"视图；
  3. **总览页**：今日生成数 / 成功率 / 队列中 / 存储占用（带"去清理"跳视频库按大小排序）四卡 + 最近成片九宫格 + 最近操作 feed —— **全部从现有 `/api/history` 与 `/api/logs` 聚合，不新增数据、不造成本数字**（成本在账单里，我们没有）；
  4. **视频库升级**：搜索（提示词模糊）/ 筛选（状态、模式）/ 排序（时间、大小）+ 详情抽屉（完整参数 + 复用/下载/删除 + **✂ 剪辑入口**）；
  5. **操作日志视图化**：从顶栏弹层改为一级视图（组件复用，过滤/导出不变）；
  6. **界面级动效体系**（D35）：侧栏收展过渡、视图切换 fade+slide、卡片级联入场、生成中呼吸+微光晕、完成 star-gather 提级到播放器中央、卡片 hover 浮起、骨架屏 shimmer —— **全部 transform/opacity，`prefers-reduced-motion` 下一律归零**（冒烟断言）；
  7. **移动端响应式**：≤768px 侧栏退化为汉堡唤出的 overlay 抽屉，工作台三栏纵向堆叠（Step 5-AC1 本就要求手机可用）；
  8. **提示词配方库**（D36）：`packages/shared` 里的**静态数据**（首批 ≥20 张，分类 = 运镜/光线/氛围/节奏；行业维暂不做，台账 B30）；UI 默认收起，两个入口 —— **「插入骨架到提示词」（主，透明可见）** 与 **「✨ 扩写时作为风格上下文」（次，请求带 `recipeId`，契约 §3）**；
  9. **轻剪辑台 MVP**（D37/D38）：**独立视图 `#/edit`**（用户 2026-09-23 拍板"更彻底的独立界面"；源片经 hash 查询参数 `?task=<id>` 传入——**不是路径参数**，因此不触发台账 B28 的 react-router 迁移；不进侧栏，无源片时显示空态引导）——视频库卡片 ✂ 入口跳转至此；**裁剪 / 拼接 / 转场（xfade）/ 静音·音量 / 变速 / 抽帧**（抽帧可直接落为参考资产，接入 I2V/FL2V 闭环）；本地 ffmpeg 执行、并发 1、EDL（编辑决策清单）落 SQLite 并可在详情抽屉查看"本片剪辑历史"；产物进画廊（`origin.kind='edit'`）。
- **AC1**：五个一级 hash 路由（`#/overview` `#/workbench` `#/library` `#/recipes` `#/logs`）+ 剪辑台 `#/edit`（不进侧栏，源片经 `?task=<id>` 传入）可切换、刷新保持当前视图、浏览器前进后退可用；默认视图 = **`#/workbench`**（2026-09-23 用户已拍板）。
- **AC2**：总览页四卡的数字与 `/api/history`、`/api/logs` 的原始数据**逐一可对账**（不许出现算不出来的指标）；空态有明确文案。
- **AC3**：侧栏收展、视图切换、卡片入场等 7 项动效真实存在且**无孤置 keyframes**；`prefers-reduced-motion: reduce` 下全部归零（UI 冒烟断言）。
- **AC4**：视频库搜索/筛选/排序结果正确；详情抽屉"复用参数"把提示词/模式/素材/参数完整回填到生成工作台。
- **AC5**：配方库 ≥20 张且每张「插入骨架」的文本与数据逐字一致；带 `recipeId` 的扩写请求在服务端 system prompt 中包含该配方要点（后端单测钉住）。
- **AC6**：剪辑台对一个 5s 夹具成片依次执行 trim → concat → xfade，产物经 `ffprobe` 校验可播且时长符合预期（±0.2s），走真实 HTTP + 206 Range；抽帧产物出现在参考资产位；详情抽屉可见该片的 EDL 历史。**全程零上游调用**（硬断言：云轨 fetch 桩调用数 = 0）。
- **AC7**：390×844（手机）与 1440×900（桌面）两档 viewport 的 UI 冒烟均通过；移动端侧栏为 overlay 抽屉形态。
- **AC8**：双主题在四个视图下均可用且对比度断言不回归（沿用 D29 的机器核对）。

> **Step 6 状态（2026-09-23）**：**AC1~AC8 全部达成**，逐条证据见 [v9-acceptance.md](v9-acceptance.md)；门禁终态 = lint 0 / type 0 / 前端 103 / 后端 321 / 契约 13 码双向一致 / 视觉自检 / UI 冒烟（含 390×844 档与动效双 context 对照）。**唯一待办 = 用户线上验收**；`docs/EXEC-V9.md` 等验收通过后再归档删除（沿用 EXEC.md 与 EXEC-STEP2-5.md 的惯例）。

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

**截至 2026-09-23 · 当前指针：Step 2 仅剩 host 本地轨 `LocalH3Provider` 未实现（AC2 已在真机跑通 T2V / I2V / FL2V / V2V 四种模式，均走 `X-Provider-Key` 通道，证据见 §4 Step 2-AC2）；Step 1 / 1.5 / 3 已完成；**Step 4 端到端验收【已完成】**（AC1 / AC2 于 2026-09-23 完成复验与固化，证据见 [walkthrough.md](walkthrough.md)）；Step 5 已上线且 CI → CD 全自动；Step 6（V9 前端改版）已立项【规划】，执行手册 = `docs/EXEC-V9.md`**

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
- [ ] **Step 2 双轨 Provider 与核心调度【只剩 host 本地轨未实现】**：架构决策定稿（§6-**D22 ~ D32**、CONTRACT **V2.1**、新增 §9 台账）；S1 ~ S5b / S7 全部完成（见下），**AC2 的真实出片冒烟已于 2026-09-23 在真机跑通**（T2V + I2V，走 `X-Provider-Key` 通道；见 §5「V8.3 批次 5」与 §8 成本表）。**唯一未完成项**：**host 本地轨 `LocalH3Provider.ts` 尚未实现**（`registry.ts` 里 `'local-minimax-h3' → null`）——选本地轨会如实返回 `503 PROVIDER_UNAVAILABLE`，`GUIDE §二·轨道 A` 描述的工作目录自检与【测试连接】按钮属台账 B4，**文档已按【规划】标注**（此前"仅剩 AC2"的写法是错的，见 V8.3 批次 0）。
      - [x] **S1 · OI-2 夹具 provider【已验证】**（AC5）：`scripts/make-fixture-clips.mjs`（ffmpeg 现场合成 9 条边界片，二进制不入库）、`lib/ffmpeg.ts`（工具缺失中文指引 + `-nostdin`/超时 + 探测失败统一包装）、`pipeline/smartCrop.ts`（32 倍数规整 + 居中裁切纯函数）、`providers/registry.ts`（唯一注册点）、`providers/fixture/FixtureLocalProvider.ts`（四方法 + 时长对齐 + 循环/静音双告警）；**38 项测试全绿**（9 条边界用例逐条断言 + 4 项破坏性验证回归）。
      - [x] **S2 · 公共链路【已验证】**（AC3 / AC4 / AC7 幂等半边）：`store/db.ts`（SQLite + 建表：任务 / 幂等键 / 冷却）、`store/taskStore.ts`（CRUD + 参数快照 + `warnings` + `submitting` + 原子领取，含防线 7 的 SQL 排除条件）、`queue/SqliteJobQueue.ts`（实现既有 `JobQueue` 接口 + `requeue` 守卫）、`queue/dispatcher.ts`（双轨调度，local 并发 1 + 防线 3 收尾清理）、`routes/generate|tasks|history.ts`、`pipeline/cleanup.ts`、`server/staticOutputs.ts`（`/media/*` 的 206 载体）；**54 项测试全绿**（幂等上游计数 = 1、并发第 2 个保持 `queued`、重启恢复、206 Range、画廊删除、防线 7 双护栏、防线 3 目录不存在）；CONTRACT §5 补登各路由响应形状。
      - [x] **S3 · 三态错误码 + 故障注入层【已验证】**（AC7 的 uncertain 半边）：`errors.ts`（12 码 → 三态的**穷举映射表**，`satisfies Record<ErrorCode, ErrorDisposition>` 编译期钉死 + `resolveTaskError` 唯一归类入口）、`providers/withFaultInjection.ts`（7 项注入 + `FAULT_INJECT` 默认关闭 + 生产挂载直接拒绝）、dispatcher 补**上报轮询循环**（进度 heartbeat 落库 + 超时归 `UNCERTAIN_RESULT`）；`packages/shared` 的 `ErrorCodeSchema` 同步到 V1.8 的 12 个码（修掉 R 段的遗漏）；**87 项测试全绿**；AC7 的「上游调用次数 = 1」硬断言经破坏性验证（把 `markUncertain` 临时改成 `requeue` → 断言精确变红）钉住；判据修正为「是否**已进入提交阶段**」（`submitting` 语义），而非「是否拿到 upstreamTaskId」。
      - [x] **S4 · 防线 5 限流 + 上传加固 + 鉴权骨架【已验证】**（AC9 / AC10）：`security/rateLimit.ts`（`rateLimitKey` 预留 `keyFingerprint?` 复合键位；60s 冷却**落 SQLite**，重启不丢窗口）、`security/auth.ts`（Bearer + 两层免鉴权：回环来源全部 + 任何来源 `/api/health`；生产未配 Token **启动即拒**）、`routes/upload.ts`（≤20MB × ≤4、**魔数嗅探**定类型、白名单、路径只含服务端随机 ID）、`index.ts` 挂安全响应头；`packages/shared` 补上传响应形状、CONTRACT §5 同步；**116 项测试全绿**；两项破坏性验证均命中（嗅探换读 `Content-Type` → 伪造类型用例红；冷却换内存 Map → 重启用例红）。测试基建：`backend/vitest.config.ts` 设 `fileParallelism: false`（集成测试经 env 指定配置，并行文件会互相覆盖）。
      - [x] **S5a · 本地引擎配置自检【已验证】**（AC6）：`providers/statusProbe.ts`（**只读 env 的配置自检**——不扫描硬件、不返回型号/显存/路径明文；`COMFYUI_BASE_URL` 白名单仅回环与 RFC1918、`H3_WORKDIR` 要求存在的绝对目录；档位由 `H3_TIER` **显式声明**，不由探测推导）、`index.ts` 启动时写内存缓存；**133 项测试全绿**；破坏性验证命中（reason 临时夹带型号 → 正则取反断言 `not to match /(RTX|GTX|A100|H100|[0-9]+\s?GB)/i` 精确变红）。
      - [x] **S5b · Seedance 云端 provider【已完成；AC2 真实冒烟已于 2026-09-23 跑通】**（用户裁定 **B 方案**：进程内暂存至终态）：新增 `security/keyVault.ts`（凭据按 taskId 进程内暂存：**入队前写入**、调度器领取时取出、终态 `finally` 释放；不落库 / 不落日志 / 不落盘；自检只报条数，类型层面就没有枚举 Key 的能力）、`providers/seedanceProtocol.ts`（**协议适配层**：端点 / 请求体 / `--` 尾缀参数 / 状态枚举 / 错误归类集中一处，逐项标注**【已确认】与【待验证】**——上游改字段只动这一个文件）、`providers/VolcanoSeedanceProvider.ts`（提交 → 轮询 → **流式下载到 outputs**，对外只暴露同源 `/media/<taskId>.mp4`，规避上游临时地址 24h 失效）、`store/assets.ts`（资产 → 上游可访问地址：配 `PUBLIC_BASE_URL` 走公网 URL，否则 data URL；assetId 做 UUID 形状校验防路径穿越）、`store/reconciliation.ts`（**补 S2 遗留缺口**：进程中途退出会遗留永远停在 `running` 的任务），以及 registry / dispatcher / generate / index 的接线（provider **每任务一份**，凭据由调度器注入）。
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
      - **✅ 三项输入已提供并配置完成**（服务器地址 / 端口 / SSH 凭据）；**服务端兜底 `VOLCANO_API_KEY` 仍未配置**（可选：不配也能跑，只是 `cloud.available:false`，访客必须自带 BYOK Key）——**冒烟与验收所需的 Key 已由用户提供（2026-09-23，仅本地使用，未写入任何文档与仓库）**，Step 2-AC2 与 Step 4 均已完成。原始清单如下，供后续换机参考：
        0. **（历史记录）**
        1. **服务器地址** `DEPLOY_HOST`（域名或 IP）；
        2. **对外 HTTPS 端口** `DEPLOY_PORT`（建议 443）；
        3. **火山方舟 API Key** `VOLCANO_API_KEY` —— **可选**（这是服务端兜底 Key，供访客未带 BYOK Key 时使用；不填也能跑，只是 `cloud.available:false`，访客必须自带 Key 才能出片）；
        4. **另需告知"有没有域名"**，用以决定 HTTPS 档位（有域名 → Caddy + Let's Encrypt 自动证书；只有 IP → Caddy 本地 CA 自签，浏览器会告警一次需手工信任）。前两项里其实已隐含这项信息，`scripts/deploy.mjs` 会自动分档，告知只是为了确认。
      - 已就绪的交付物：`Dockerfile`（多阶段；运行层装 ffmpeg；`data`/`outputs` 走卷）、`deploy/compose.yaml`（app **不映射任何宿主端口**，只经 Caddy，避免"绕过 HTTPS 的明文入口"；caddy 挂 80 供 ACME 挑战）、`deploy/Caddyfile.domain` 与 `deploy/Caddyfile.ip`（两种 TLS 档，按 `DEPLOY_HOST` 自动选择）、`scripts/deploy.mjs`（校验三项 → 推导 `PUBLIC_BASE_URL`/`CORS_ORIGINS` → `docker compose up -d --build`；支持 `--dry-run` / `--logs`）、`.env.deploy.example`、`.dockerignore`、`backend/src/server/spa.ts`（**单进程形态**：一个 Fastify 同时托管 `/api` + `/media` + 前端产物与 SPA fallback）。
      - **AC3（.env / SQLite / outputs 不入镜像不入 git）的达成方式**：这四类路径同时被 `.gitignore` 与 `.dockerignore` 排除。两道防线职责不同——前者防入仓库，后者防入镜像——缺任一都可能漏。
      - **反代三个坑已在配置内消除**：请求体上限 ≥20M（否则参考图被**静默**拦掉）、**刻意不写 `encode`**（任何视频压缩都会破坏 206 Range，用"不写"而非"写排除规则"，因为没法被误配置的东西才安全）、`X-Forwarded-For` + `TRUST_PROXY=1`（否则防线 5 的 IP 冷却退化成全局锁，症状是"别人提交过我就被限流"）。
      - **实测**：单进程形态三条路径已验证（`GET /` → 200 HTML、SPA 深链回退 → 同一 index.html、`/api/nonexistent` 与 `/media/nonexistent.mp4` → **404 且不被 fallback 吞成 200 HTML**）；`deploy.mjs` 四类拦截已验证（缺配置文件 / 缺必填项 / `DEPLOY_HOST` 端口与 `DEPLOY_PORT` 不一致 / domain·ip 自动分档 + 自签告警）。
      - **镜像与构建已实测**：多阶段构建在目标服务器上跑通（`astrmiravideo:latest` 约 1.5GB），两个容器 `healthy`。**ffmpeg 版本与许可证结论已回填**（2026-09-22 实测三处：生产镜像 `5.1.9-0+deb12u1` / 开发机 `n8.1.2` / CI `6.1.1-3ubuntu5`，三个构建均 `--enable-gpl`；登记见 `docs/UPSTREAM.md`）。〔2026-09-23 更正：本条此前写"仍未回填"属文字陈旧（UPSTREAM 已登记实测值），非新事实。〕
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
- [x] **Step 4 端到端验收【已完成 2026-09-23；证据归档 = [walkthrough.md](walkthrough.md)】**（原阻塞条件"需一把可用 Key"已解除，与 Step 2-AC2 共用同一把）：
      - **AC1【已完成】**：真实云端轨（`doubao-seedance-2-0-mini-260615` / 720p / 5s / 走 `X-Provider-Key`）复验两条链路 —— T2V 提交→终态 **89.0s**、成片 5.09s/1280×720/h264+AAC、2.80MB、206 正常、封面正常、**音轨 mean -15.8dB 且无 ≥0.3s 静音段**；I2V 用**非 32 倍数图**（831×479 → 清洗落盘 **800×448** → 出片）提交→终态 **62.3s**、5.09s/1280×720/2.81MB、成片首帧与输入图 **PSNR 40.22dB**（确实以首帧为起点）。**如实澄清**：云端成片自带音轨但"是否念出台词"属内容层、不做自动化断言；**双引号触发对白是本地 H3 的能力**，host 本地轨未实现故不在本轮范围。
      - **AC2【已完成】**：WebP / 超大图 / 非规整尺寸 / 透明通道 / HEIC 拒绝 / EXIF 剥离六项**固化为集成测试**（`backend/src/routes/upload.sanitize.integration.test.ts`，全部走真实 `/api/upload` + **落盘产物 sharp 元数据断言**）；破坏性验证命中（`MAX_LONG_EDGE` 2048→1024 → `expected 672 to be 1344`）。
      - **AC3 / AC4【已完成】**：契约层 11 全绿 + 真实 TCP e2e 全绿（`pnpm test:e2e`）；OI-1 按非目标跳过、不参与验收。
      - **本轮顺带实证的三条边界（都非 AC 要求）**：① **上游对 I2V 输入图做隐私检测** —— 含拟真人脸会被 `InputImageSensitiveContentDetected.PrivacyInformation` 拒绝（400 / 8.1s 终态 / 如实归 `UPSTREAM_ERROR`+terminal，未误归 uncertain），改进项登记台账 **B32**；② 防线 5 的 429 冷却在真实付费路径上自然复现（复合键）；③ "请求 > env > 内置默认"的模型优先级在真机成立（本地后端刻意未设 `VOLCANO_*`）。
- [~] **V8.3 体验与功能补强【进行中：批次 0~4 / 6 / 7 已完成，批次 5 剩 FL2V·V2V】**（2026-09-22 立项）：起因是一次"文档 ↔ 代码"全面核对（11 条防线/功能项 + 10 条路由 + 12 个错误码产生点 + `process.env` 全量 + 存储生命周期，两路独立探查 + 逐条复核）。**批次 6 与 7 都是 2026-09-23 用户报障驱动的修复，插在批次 5 之前**。**以下顺序即批次**：
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
        - **[x] 后续修复（同日，浏览器级复现后追加）**：**扩写在"模型 JSON 写坏"时会回填 JSON 外壳**——线上真实后果是用户把 `{"enhancedPrompt":"…"}` 整段当提示词提交去出片（画廊里那条"未完成"任务的提示词就是这段 JSON）。三处修：① 系统提示明确要求**单行 JSON + `\\n` 转义**；② 严格解析失败时**宽松抠正文**（`extractEnhancedPromptLoosely`，容忍字符串里的真换行）；③ 若连正文都拿不到（含"解析成功但没有 `enhancedPrompt` 字段"这一支），**保留用户原文**并说明原因，**绝不回填结构化外壳**。测试 +5（多行 JSON / 抠不出 / 外壳判定 / 保留原文）。
      - [x] **批次 7 · 用户报障三项修复【已验证】**（2026-09-23，全部浏览器级复现后修）
        - **① 历史成片没有播放入口（台账 B26）**：用户报"其它人跑的历史成片我无法预览"。浏览器复现：服务端一切正常（`/media/815ec687….mp4` → **206**、`content-range=bytes 0-1023/1571951`；封面 → 200 且 `naturalWidth=480`），但卡片按钮**只有 `["复用参数","删除"]`**，封面上的 ▶ 只是**装饰角标** —— 点卡片不产生任何 `<video>`、也不发任何 `/media/*.mp4` 请求。修法（用户拍板"点封面即载入中栏播放"）：`GalleryCard` 在"已成功且有成片"时把封面渲染成 `<button>`；`App.handlePreview` 仅**换一个 taskId**（`useTaskPolling` 拿到终态即停 → **零额外上游请求**），并清掉上一条任务的错误/提示；当前在中栏播放的那条加主色描边（避免"点了不知道在看哪条"）。
        - **② 日间模式下放映区文字不可见**：放映区（`.wb-viewport`）的 `--canvas` 在**两套主题下都是深色**，而区内文字取的是 `--faint`/`--text`/`--muted` —— 日间主题把它们换成了深色，于是"深底 + 深字"直接消失（用户截图即此）。修法：新增**放映区专用色** `--canvas-text` / `--canvas-muted` / `--canvas-danger`（两个主题块各自定义），把 `.wb-viewport` 内的 `.wb-note` / `.wb-empty-title` / `.wb-timecode` / `.wb-uncertain-*` 收到这三个 token 上；自检的对比度规则从 6 对加到 **9 对 × 2 套主题**，UI 冒烟再补一条**浏览器内实测计算样式**的断言（实测 **8.34:1**）。
        - **③ 线上参考图模式必失败（真缺陷，此前未验出）**：`deploy/Caddyfile.{ip,domain}` 把**全部路径**放在站点登录之后（只豁免 `/api/health`），而 `PUBLIC_BASE_URL` 指向的 `<base>/media/assets/<文件>` 正是**交给上游去抓**的那个地址 —— 没有凭据的上游只会收到 **401**（零费用实测：`/media/assets/does-not-exist.jpg` → `401 Basic realm="restricted"`）。本机之所以没暴露：`PUBLIC_BASE_URL` 为空时回落成 base64 data URL，不走网络。修法：两个 Caddyfile 都加 `@assets path /media/assets/*` 的**匿名可读**分支（成片与封面仍在登录之后）。**代价如实登记为台账 B27**：`assets/` 下变成"知道 URL 即可读"（文件名是服务端生成的随机 UUID，不含用户输入）；不接受时可把 `PUBLIC_BASE_URL` 留空走 data URL（请求体约 1.33 倍）。
        - **验证**：前端 66 用例 + 视觉自检 9 对 × 2 套全过；UI 冒烟新增两条（点封面 → 播放器 `videoWidth > 0` 且 `src` 为同源 `/media/…`；日间模式放映区对比度 ≥ 4.5）；**破坏性验证**：把区内的 `--canvas-muted` 临时换回 `--faint` 会让新断言精确变红。
      - [~] **批次 5 · 真实出片【T2V + I2V 已完成 2026-09-23】**（用户提供可用方舟 Key 后开跑）：
        - **已完成**：`scripts/smoke-seedance-paid.mjs`（新，付费冒烟工具，带 `--confirm-spend` 防误跑）用 `doubao-seedance-2-0-mini-260615` / T2V / 720p / 5s **真机出片 1 次**，走的是产品路径（本地后端 + **`X-Provider-Key` 请求头**，符合 AC2 的硬要求）。实测：提交→终态 **86.5s**；成片 **5.09s / 1280×720 / 24fps / h264 + AAC 2ch 32kHz**（上游自带音轨）；**2.23MB**；`/media` 段请求 **HTTP 206**（`content-range=bytes 0-1023/2337094`）；**封面抽帧成功**；画面**无水印**（`--watermark false` 生效）；`requestSnapshot.options.model` 就是请求下发的那个（**优先级修复在真机上成立**）。§8 成本表已回填。
        - **四项【待验证】上游字段全部落地**（证据表写进 `seedanceProtocol.ts` 文件头）：请求体结构 ✓、`--` 尾缀参数 ✓（5s/16:9/720p 全部生效）、`status` 枚举 ✓（queued→running→succeeded）、`content.video_url` ✓（成片成功下载）。
        - **顺带发现的真实缺陷（都已登记）**：① **跨镜头主体一致性**：同一盏灯在 0.3s（近方形灯罩）、2.4s（圆形底座特写）、4.6s（圆筒灯罩）三个镜头里形态略有漂移 —— 广告片要"同一产品"必须用 I2V/首尾帧锁形或参考图，**说明 3-⑤ 新增的模式入口有真实用武之地**；② **云端轨默认带音轨**：prompt 未要求声音却产出 AAC 2ch —— 不可再假定"云端无声"，相关文案已改（`GUIDE` Q1 只讲本地 H3 的双引号台词纪律）；③ **费用只能估算**：`TaskProgress` 不含上游 usage，脚本只能按官方计费公式推算（≈108k token ≈ 1~2.5 元），**要精确入账得去方舟账单**（已登记 B24）。
        - **[x] I2V 真实出片（同日第二次）【已验证】**：以上一条成片的首帧 JPEG（1280×720）经 `/api/upload`（过防线 4 清洗网关，产物 66KB JPEG）上传为资产 → I2V 出片成功。实测 **提交→终态 124.7s**、成片 5.09s / 1280×720 / **h264 + AAC 2ch** / 2.78MB、206 Range 正常、封面抽帧成功；**画面首尾与首帧灯型一致**（抽帧比对：0.1s 与输入首帧几乎相同，4.8s 拉远后灯罩形状不变）——**这正好解决 T2V 里发现的"跨镜头主体漂移"**。顺带确认 `image_url.url` **接受 base64 data URL**（本机 `PUBLIC_BASE_URL` 为空时的回落路径）。
        - **[x] FL2V 真实出片【已验证】**（同批次第四次）：首尾帧两资产 → 出片成功，提交→终态 **100.4s**、5.09s / 1280×720 / h264+AAC / 2.50MB；0.1s 起于首帧、4.9s 与尾帧几乎一致 → **`last_frame` 角色语义成立**。
        - **[x] V2V【已验证：线上端到端跑通】**：原实现把视频塞进 `image_url`+`reference_image` → 上游 400；三次参数级探测问出正确形态 `video_url` + `role='reference_video'`，且**必须公网 URL**（data URL 被拒）。修好请求形状后，线上验证又暴露**第二个真错误**：`PUBLIC_BASE_URL` 从未进容器（compose 只靠 `env_file`）→ 资产退化成 data URL。两处都修完后在**线上实例**跑通：提交→终态 **116.7s**、5.09s/1280×720/h264+AAC/2.40MB、206 正常，且**画面确实按参考视频重绘**（详见 §4 Step 2-AC2）。
        - **仍待（2026-09-23 更新）**：上游 `status` 枚举里的 `failed`/`cancelled`/`canceled`/`expired` 仍无真实样本；**Step 4 端到端验收已完成**（证据 = [walkthrough.md](walkthrough.md)；"含双引号台词人声"是本地 H3 的能力，已在验收记录里如实澄清）；任务终态 `failed` 已获真实样本（上游隐私检测拒绝，见 [walkthrough.md](walkthrough.md) §1-3a）。
- [x] **Step 6 · V9 前端改版【已完成 2026-09-23；B1~B10 全部交付，验收证据 = [v9-acceptance.md](v9-acceptance.md)】**（B1 原型稿闸门已通过 · B2 应用壳 · B3 总览页 · B4 视频库 · B5 日志视图化 · B6 动效体系 · B7 移动端 · B8 配方库 · B9 剪辑台 · B10 收尾文档）：方向由用户逐条拍板（顶栏精简保留 logo+服务状态 / HTML 高保真稿先行确认 / 自写 hash 路由、react-router 入台账 B28 / 拆帧剪辑定位=时间轴确定性操作 + 抽帧→生成闭环（D38）/ 配方库双入口（D36）/ 剪映导出**砍掉**（D37）/ 双主题保留 / 移动端响应式同批 / 存储占用卡带"去清理"入口）。任务与 AC 见 §4 Step 6；接口规划见 CONTRACT **V2.2**（§3 `recipeId`、§5 路由表、§11 配方与剪辑台契约）；决策 D33~D38；**执行手册 = `docs/EXEC-V9.md`（一次性，验收后归档删除）**。视觉参考：`docs/assets/`（索引在其 README）。**零 API 成本红线**：本 Step 全程不调付费上游。
      - **B1 交付物（2026-09-23）**：`docs/ui-proto/index.html` —— 单文件、**真实 token 值 + Cinzel base64 内联**（双击 `file://` 直开即见真实字体，不受 CSP 与跨源字体限制）；Playwright 实机验证 **27 项断言全绿**（字体加载 / 壳布局尺寸 / 五视图 + 兜底 / 侧栏两态 / 主题 / 剪辑子面板 / 控制台零 error）。
      - **实机抓到并修掉的两条真缺陷**（原型稿的价值就在这）：① CSS 定义了 `.app` 网格而 HTML **漏了包裹层** → 整个壳布局失效（侧栏不贴底、内容区跑到侧栏下方）；② SVG 的 presentation attribute 写 `stroke="var(--x)"` **静默失效** → 进度环不显示（`var()` 只在 `style` 里生效）。
      - **闸门结果（2026-09-23 用户确认，四处拍板）**：① 配方库为**第 5 个一级视图** `#/recipes`（不做工作台内的面板）；② 剪辑台为**更彻底的独立视图** `#/edit`（源片经 hash 查询参数 `?task=<id>`——**不是**路径参数，故**不触发**台账 B28；不进侧栏，空态引导）；③ 默认视图 = `#/workbench`；④ 总览四卡按**方案 A（最小契约增量 → CONTRACT V2.3）** 落地 —— 暴露 `TaskProgress.createdAt`（`tasks.created_at` 列本就存在，零迁移）+ `outputSizeBytes`（后端 stat）+ `/api/history` 的 `storage` 目录级聚合。
      - **B2 应用壳已完成（2026-09-23）**：`frontend/src/lib/router.ts`（自写 hash 路由：parseHash / navigate / useHashRoute）+ `views/registry.ts`（**数据化**注册表，含 `hidden` / `preferRail`）+ `components/Sidebar.tsx`（240px / 56px 两态，底部区 = 凭据 / 主题 / 折叠）+ 壳化 `App.tsx`（顶栏精简为品牌 + 服务状态；**工作台常驻隐藏不卸载**，切视图不丢提示词 / 参数 / 资产 / 进度）+ `views/`（总览 / 视频库 / 配方库 / 剪辑台占位 + 日志最小视图化 + 未知兜底）+ `lib/shell.ts`（跨视图依赖经 Context 下发，注册表保持无 props）。**破坏性验证命中**：临时删 `#/library` 注册项 → 访问落兜底（非白屏）；还原后冒烟全绿。**冒烟**：`scripts/smoke-ui.mjs` 新增 **[1b] 应用壳**断言组（默认视图 / 侧栏两态 / 五视图切换 + aria-current / 前进后退 / 刷新保持 / 剪辑台直达 / 未知兜底 / 回工作台）；[5] 主题与 [7] 日志的入口适配到新壳。门禁全绿：lint 0 / type 0 / 前端 74 / build / UI 冒烟。
      - **B3 总览页已完成（2026-09-23，含契约 V2.3 的最小增量）**：契约升 **V2.3** —— `TaskProgress.createdAt`（暴露既有列 `tasks.created_at`，零迁移）+ `outputSizeBytes?`（路由层 `stat`，文件已清理时省略而非填 0）+ `HistoryResponse.storage`（`StorageUsage` 目录级聚合，对账口径直接是 `du -sb outputs/`）。新增 `backend/src/server/storageUsage.ts`、`frontend/src/lib/overviewStats.ts`（纯函数 + 12 条单测）、`views/OverviewView.tsx`（四卡 + 最近成片九宫格 + 最近操作 feed，**全部聚合自现有 API、不新增后端路由**）。**心跳载荷收窄为 `TaskProgressUpdate`**（`Omit<…, 'createdAt'>`）—— 权威创建时间没有任何路径会被覆盖（provider 侧填的观测时刻只在内存里过手）。冒烟新增 **[6b] 总览对账**断言组：四卡数字与 `/api/history` **现算值逐一对账**（实测：今日 1 / 成功率 100% / 队列中 0 / 存储 619826B→「605 KB」/ 九宫格 1 = min(成功数, 9)）。破坏性验证命中：把"今日"改成 UTC 日界 → "今日计数"用例变红。另：视觉自检拦下一次硬编码字号（KPI 数字）→ 补语义 token `--fs-metric`。门禁：lint 0 / type 0 / 前端 86 / 后端 307 / 视觉自检 / UI 冒烟。
      - **B4 视频库已完成（2026-09-23）**：`frontend/src/lib/libraryFilter.ts`（筛选 / 排序纯函数 + 10 条单测）+ `views/LibraryView.tsx`（工具条 = 提示词模糊搜索 / 状态四档（"失败"含 `cancelled`）/ 排序三档（时间双向 + 体积降序、**无体积的排最后**）；卡片网格 = 缩略图 · 时长 · 状态点 · hover 四动作；详情抽屉 = 预览 + 参数快照 + `warnings` + 剪辑历史位 + 复用 / 剪辑 / 下载 / 删除）。**跨视图回填走 hash**：卡片 ⟲ → `#/workbench?reuse=<taskId>` → 工作台读出后回填（两视图零共享 React 状态；离开工作台重置标记 → 同一条可重复复用）。**剪辑入口**跳 `#/edit?task=<taskId>`（B9 填）。冒烟新增 **[6c] 视频库**断言组：搜索空态（固化的破坏性验证）/「失败」筛选与 API 现算对账 / 时间正序 DOM 与 API 对账 / **详情抽屉「复用参数」把提示词完整回填到工作台**（AC4 硬证据）。门禁：lint 0 / type 0 / 前端 96 / 后端 307 / 视觉自检 / UI 冒烟。
      - **B5 操作日志视图化已完成（2026-09-23）**：`components/LogPanel.tsx` → `views/LogsView.tsx`（**组件主体一行未改**：状态 / 过滤 / 分页 / 删除 / LogRow 全部复用；只去掉弹层背板、换成页面头，并把"关闭"换成 **导出 JSON** —— 排错时把日志交给别人的正道，冒烟断言**真实触发下载**）。壳侧新增红点统计（`errorLogCount`：挂载时拉一次 `/api/logs?limit=100` 统计 `errorCode` 条数，**刻意不轮询**；收起态退化为纯圆点，用 `text-indent` 而非零字号）。**F6 静态检查本轮拦下两次**：KPI 硬编码字号（→ 补 `--fs-metric`）、以及"把示例写法写进注释"也被文本匹配命中（→ 改措辞）。冒烟 [7] 段适配页面形态，并新增"**没有失败请求时不伪造红点**"（可判定断言，不写成恒真的 `>= 0`）。门禁：lint 0 / type 0 / 前端 96 / 后端 307 / 视觉自检 / UI 冒烟。
      - **B6 界面级动效体系已完成（2026-09-23）**：7 项全部落功能位 —— ① 侧栏收展过渡（**唯一**的布局属性过渡（width）：内容必须重排，且 reduced-motion 下同样归零）② 视图切换 fade+slide（复用 `navigation-enter`）③ 卡片 40ms 级联（`--stagger` 由视图按索引注入，封顶 12 —— 延迟不随列表长度增长）④ 生成中呼吸微光晕（`CenterPanel` 的 `data-status` + `breathe-glow`，纯 opacity）⑤ `star-gather` **提级到播放器中央**（两层结构：外层定位/放大用 transform、内层只管动画；`key=taskId` 保证可重播）⑥ 卡片 hover 浮起 2px + 金描边 ⑦ 骨架屏（伪元素 transform 扫光，不用 `background-position`）。新增 3 个 keyframes **显式登记**进 `visual-selfcheck.mjs`（8 → 11）。
      - **冒烟新增 [7b] 组：reduced-motion 双 context 对照** —— 同一产物在 reduce 档动画被压到 `1e-05s`、normal 档 `0.26s`（**证明断言不是恒真的**）。⚠️ 实测教训：不能拿 `'0.01ms'` 做字符串比对（Chromium 序列化成 `1e-05s`），要解析成秒再比数量级；同理 CSSOM 会把属性选择器的单引号规范成双引号。
      - **破坏性验证命中，并当场揪出自检的一个真缺陷**：摘掉 `breathe-glow` 的挂接 → 自检报"keyframe 孤置"（期望行为）；但**第一次跑时它没报** —— 因为 `visual-selfcheck.mjs` 按纯文本匹配，**注释里的 `animation: …` 被当成了真实挂接**（漏检方向，比误报危险）。已修：判定前剥块注释且**保留行号**，同时消除了"注释里写示例被误判为硬编码"的误报。
      - **B7 移动端响应式已完成（2026-09-23）**：≤768px 四处退化 —— ① 侧栏 → 汉堡唤出的 **overlay 抽屉**（`position: fixed` + `translateX(-100%)` → `0`，带遮罩、点导航项自动收起；**移动端不存在 56px 图标栏这回事**，要么全出要么全隐）；② 工作台三栏 → 纵向堆叠（DOM 顺序即控制区在前）；③ 画廊 / 九宫格 / KPI → 单列；④ 详情抽屉 → 全屏。顶栏新增汉堡按钮（宽屏 `display: none`）。冒烟新增 **[7c] 390×844 档**（9 条断言，含"三栏左对齐 + y 递增"的**堆叠几何**与"点导航后抽屉自动收起"）—— **Step 6-AC7 的两档 viewport 至此齐备**。门禁：lint 0 / type 0 / 前端 96 / 后端 307 / 视觉自检 / UI 冒烟（含 1440×900 与 390×844 两档）。
      - **B8 提示词配方库已完成（2026-09-23）**：`packages/shared/src/recipes.ts`（`RecipeCardSchema` + **20 张卡**，运镜 / 光线 / 氛围 / 节奏 **各 5**；**文本全部自写**，只借鉴 video-shotcraft 的**字段结构** —— 其许可证经 2026-09-23 实测核对为 **Apache-2.0**（仓库根有 License，README 正文未提及），已登记 `UPSTREAM.md` 第 11 条）+ `views/RecipesView.tsx`（第 5 个一级视图：分类 chips + 搜索 + 卡片网格）。**两个入口按 CONTRACT §11-1 钉死口径**：①「插入骨架」= **逐字追加到提示词末尾**（`lib/recipeInsert.ts` 纯函数：空框直接写入、**刻意不替换**——覆盖用户已写内容属数据丢失）；②「仅作扩写上下文」= 只记 id、不动提示词。两者都走 `#/workbench?recipe=<id>[&insert=no]`。后端 `routes/enhance.ts` 消费 `recipeId`：命中把**整张卡**交给执行者、**未知 id → 400 `PROMPT_REJECTED` 且一次上游都不调**；`providers/llm.ts` 注入 system prompt（骨架 + **逐条**已知坑），**用户原文仍原样作为 user message**。契约同步：§3 的 `recipeId` 与 §11-1 摘掉【规划】标记（§11-2 剪辑台留给 B9）。
      - **B8 测试**：前端 7 条（数据完整性：≥20 / 四类各 ≥5 / id 唯一且格式稳定 / schema 全过 / 骨架非空；插入行为：空框直写、非空追加不覆盖、重复插入逐字重复）；后端 5 条（路由三层 + **直接断言发往上游的请求体**含骨架与每一条坑、且不带配方时不出现配方段落）；冒烟新增 **[6d]**（20 张 / 分类筛选 5 vs 20 / **插入骨架逐字落地**——断言写法也修了一处时序坑：hash 变化是同步的而 React 重渲染是异步的，必须等条件成立再读 textarea）。门禁：lint 0 / type 0 / 前端 103 / 后端 312 / 视觉自检 / UI 冒烟。
      - ⚠️ **本轮门禁抓到一条 flaky 并如实登记**：第一次全量跑时 `step2` 的防线 2 用例偶发失败（详见 §9 台账 **B34**），重跑即绿——已判断为测试写法脆弱，非产品缺陷。
      - **B9 轻剪辑台 MVP 已完成（2026-09-23，含契约收尾）**：契约 —— `packages/shared/src/edit.ts`（`EditOperation` 判别联合 6 种操作 + `EditScript` 上限 8 步）、`TaskProgress.origin?`（`{kind:'edit', sourceTaskId, script}`，由 `tasks.edit_script` 列**派生**，一列两用）与 `extractedAssetIds?`；**§5 的 `POST /api/edits` 与 §11 标题的【规划】标记已摘除**。**顺带补登记错误码 `INVALID_REQUEST`** —— V2.2 的 §11-2 引用过它却漏进 §6 字典，**契约测试的双向校验当场拦下**（"实现里的 INVALID_REQUEST 未写入 CONTRACT §6" 与 "CONTRACT §6 的 INVALID_REQUEST 未在实现映射表中" 两条），两头补齐才放行。
      - B9 后端：`routes/edits.ts`（三类校验：形状 / 引用完整性 / 值关系；入队走 `local` 轨 = 本地互斥 1、**不走防线 5 冷却**）+ `pipeline/editExecutor.ts`（按 EDL 顺序执行 + 中间产物 `outputs/.tmp/<taskId>/` 成败皆清）+ `dispatcher` 的 **`kind:'edit'` 分派**（不进 provider 路径，`runEditJob` 钩子全权负责执行与终态）+ `db.ts` 两列迁移（`edit_script` / `extracted_asset_ids`）+ 全局 `setErrorHandler`（**Fastify 默认校验错误体不符合 `ErrorResponseSchema`，序列化失败会把 400 升级成 500** —— 实测踩到）。
      - **concat 与 xfade 的口径（实现时钉死）**：`concat` 只**登记**待并入片段，接缝由紧随其后的 `xfade` 决定（真转场）；没有 xfade 就退化为**流拷贝直拼**。"转场必须紧跟在拼接之后"是**显式规则**（违反则如实报错，不静默跳过）。契约里 `concat.taskIds` 的 `min(2)` 同步收紧为 **`min(1)`**（原值让"源片 + 另一条"这件事无法表达）。
      - B9 前端：`views/EditView.tsx`（独立视图 `#/edit?task=<id>`：操作序列编辑器 + 源片/产物预览 + **本片剪辑历史**）+ 视频库卡片与抽屉的**"剪辑自 xxx"徽标与 EDL 列表**（B4 留的位在这里填上）+ `api.ts` 的 `submitEdit`。
      - **AC6 证据**：① 后端集成测试**真 ffmpeg** 跑 `trim(0→3) → concat(另一段 5s) → xfade(fade 0.5s)`，产物 ffprobe **7.5s ±0.2s**（3+5−0.5）、视频与音轨齐备；② 抽帧落 `outputs/assets/` 并写回 `extractedAssetIds`；③ 破坏性验证命中三条 —— `endSec ≤ startSec` → **400**（不是 500）、抽帧超片长 → **如实报错且不产空文件**、源片/素材缺失 → **404 且不落空产物**；④ **零上游调用**：executor 与路由**不 import 任何 provider、不碰凭据**（测试里有一条**源码级结构断言**盯着）；⑤ 冒烟 [6e] 真跑一次剪辑：产物可播、抽帧落账 1 个、`/media` **206**。
      - ⚠️ **实现期抓到两个真缺陷（都值得记）**：① **剪辑找不到源片** —— executor 起初拼 `<taskId>.mp4`，而 provider 落盘用的是**它自己的上游 id**，两者并不相同；修法是走任务记录的 `outputVideoUrl`（集成测试的种子文件名起初"恰好一致"，替身过于理想 → 已改成文件名与 taskId **故意不同**）；② **冒烟的等待条件太弱** —— 提交后任务**立刻**以 `queued` 出现在历史里，"存在一条 edit 任务"会立即为真，于是断言在调度器领取之前就跑完了；改为等**页面上的产物播放器出现**（组件自己的轮询结果），并取**最新**一条而非第一条。
      - 门禁：lint 0 / type 0 / 前端 103 / 后端 321 / 契约（13 码双向一致） / 视觉自检 / UI 冒烟。

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
| D28 | **硬规则 2 的适用范围收窄为"有持久副作用的任务型上游"**：无副作用的调用（如文本扩写）超时归 `UPSTREAM_ERROR`（retryable），不归 `UNCERTAIN_RESULT` | 硬规则 2 原文"上游无响应 / 超时一律归 UNCERTAIN_RESULT"是为付费任务设计的；照搬到 LLM 会让"扩写失败"变成"需人工核对可能的费用"，属语义污染，并会让 `uncertain` 失去高警示等级的含义 | 2026-09-22 |
| D32 | **操作日志的噪声纪律**：只记**写操作**与**失败请求**；`/media/*`、`/api/health`、`/api/logs*` 与**成功的读请求**一律不记 | 任务进度与日志页自身都是 2~3s 轮询：把读操作也记下来，半天就能把"操作日志"变成"轮询日志"，真正的动作被埋掉 —— 那等于这个功能不存在。日志页不记自己尤其关键（否则自我增殖） | 2026-09-23 |
| D33 | **V9 信息架构：可伸收侧栏 + 顶栏精简为「品牌 + 服务在线状态」**；凭据设置保留抽屉（从侧栏底部项唤出），操作日志从弹层升级为一级视图；移动端侧栏退化为 overlay 抽屉 | 用户拍板（参考即梦的可伸收侧栏与可灵的队列/资产管理）；「服务在线」是全局健康信号，收进任何抽屉都会失去"一眼可见"的意义；抽屉适合"随时要用但不常驻"的凭据 | 2026-09-23 |
| D34 | **自写 hash 路由**（约 40 行 hook + 数据化的视图注册表），**不引入 react-router**；迁移触发条件记台账 B28（出现嵌套路由或 loader 数据约定需求时再迁，视图注册表原样翻译） | 四个一级视图用 react-router 是杀鸡用牛刀（+60KB 且违背 D4 的"零全家桶"）；hash 天然刷新不丢、不上行服务端；把路由表做成数据是"将来换库只换一层"的唯一廉价前提 | 2026-09-23 |
| D35 | **界面级动效体系**（7 项：侧栏收展 / 视图切换 / 卡片级联 / 生成中呼吸+微光晕 / star-gather 提级 / hover 浮起 / 骨架 shimmer），**全部 transform/opacity + `prefers-reduced-motion` 归零**（冒烟断言） | 用户实测感知"只有 logo 在转"——批次 2 的 8 个 keyframes 太克制、触达率低；动效预算只给 transform/opacity 是为了 60fps 与移动端，reduced-motion 归零是可访问性底线（沿用 AC5 的既有口径） | 2026-09-23 |
| D36 | **提示词配方库 = `packages/shared` 静态数据 + 双入口**：主入口「插入骨架到提示词」（透明可见），次入口「✨ 扩写带 `recipeId` 作为风格上下文」（契约 §3）；首批 ≥20 张（运镜/光线/氛围/节奏），行业维暂不做（台账 B30） | 借鉴 video-shotcraft 的镜头配方卡的**结构**（用途/时长/参数/已知坑），内容自写（它是 Remotion 参数导向，我们是生成提示词导向）；只做骨架对小白不友好，只做扩写则配方变黑盒（违背"不静默"），同一份数据两个入口两全 | 2026-09-23 |
| D37 | **轻剪辑台 MVP = 时间轴上的确定性操作**（trim / concat / xfade / 音量 / 变速 / 抽帧），本地 ffmpeg 执行，EDL（编辑决策清单）落 SQLite；**「剪映草稿导出」明确砍掉**（不入台账） | 生成式 MP4 拆帧只是位图，做不了语义编辑（"把灯换个形状"只能重新生成）；剪辑台的价值在时间轴操作与抽帧闭环。剪映导出砍掉的原因：草稿格式无官方文档、版本升级即破坏兼容、转场库不对应需降级映射——维护成本持续而收益对当前用户群不明 | 2026-09-23 |
| D38 | **抽帧 → 生成 的闭环是一等产品动作**：剪辑台/播放器里抽出的帧可直接落为参考资产，作为下一次 I2V/FL2V 的首帧/尾帧 | "想改内容"的唯一正确路径是重新生成（用抽帧锁形），这把剪辑台与生成工作台接成闭环，而不是两个孤岛功能 | 2026-09-23 |

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
9. **部署形态与三条硬要求（V8.3：原一次性施工手册 §9 的存档，此后以此节为准）**
   - **形态**：**单 Node 进程**同时托管 `/api/*`、`/media/*`（`outputs/` 的 Range 静态服务）与前端产物（SPA fallback）；**反向代理只做 TLS 终止、登录、20MB 请求体放行与凭据形态转换** —— 不引入 nginx 的配置复杂度。两个容器：`app`（不映射宿主端口，必须经代理访问）与 `caddy`。
   - **部署者只需提供三项**：服务器地址、对外端口、Basic 登录密码（外加可选的服务端兜底 `VOLCANO_API_KEY`）。**其余全部由仓库自带默认值**（`scripts/deploy.mjs` 负责校验与推导 `TLS_MODE` / `PUBLIC_BASE_URL` / `CORS_ORIGINS` / `DEPLOY_SNI` / Basic Auth 哈希）。
   - **反代必须处理的三件事**（漏任一项都会出问题，细节在各配置文件注释里）：
     1. **请求体上限 ≥ 20MB**（nginx 默认 1M）→ 否则参考图上传被**静默拦掉**；
     2. **不得压缩媒体响应**（Caddy 侧表现为"不写 `encode`"）→ 否则 **206 Range 被破坏**，播放器拖不动进度；
     3. **真实 IP 透传**（`X-Forwarded-For` + 后端 `TRUST_PROXY=1`）→ 否则防线 5 的 IP 冷却退化成**全局锁**（所有人互相误伤）。
   - **镜像要求**：运行层装 ffmpeg（来源/版本/许可证登记在 `UPSTREAM.md`）；`.env` / `data/` / `outputs/` **不入镜像、不入 git**（用卷挂载）；生产必填 `PUBLIC_API_TOKEN`。
   - **两个"仓库改了但线上没变"的坑**（都实测踩过）：① 目标服务器**访问不了 github.com**，代码只能由 CI/本机 scp 推过去，**不能让它 `git pull`**；② **挂载进容器的配置文件（如 `Caddyfile.*`）内容变化不会让进程重读** —— `docker compose up -d` 不会重载 Caddy，已由 `scripts/deploy.mjs` 里的 `caddy reload` 兜住。
   - **`assets/` 的匿名可读是**有意为之**：云端参考图模式要让**上游**去抓 `<PUBLIC_BASE_URL>/media/assets/<文件>`，因此该子目录豁免站点登录（成片与封面仍在登录之后）。代价与替代方案见 §9-B27。
   - **`PUBLIC_BASE_URL` / `CORS_ORIGINS` 必须在 compose 的 `environment:` 里显式透传**：`env_file` 只搬运 `.env.deploy` 里的值（模板里是**空值**），而 `deploy.mjs` 推导出来的值只存在于 compose 的**变量替换上下文** —— 不写进 `environment:` 就永远进不了容器（2026-09-23 实测：线上 `PUBLIC_BASE_URL` 为空 → 资产地址退化成 data URL → 图片能用、**V2V 必失败**）。

---

## 8. 成本与风险

| 项 | 数字 | 标记 |
|---|---|---|
| 本地 H3 出片耗时 | 480x832 / 124 帧：Tier 2（16GB）实测 Disk Offload 单步耗时约 8~14 分钟，50 步全量生成约需 7~10 小时；不可用于实时交互，仅适合离线批处理 | 【已验证实测】详见 gen_drama.log |
| 云端 Seedance 耗时 | **提交→终态 86.5s**（`doubao-seedance-2-0-mini-260615` / T2V / 720p / 5s；其中排队与生成合计，轮询在 2s 内首次拿到 `queued`） | **【已验证实测】**2026-09-23，`scripts/smoke-seedance-paid.mjs` |
| 云端 Seedance 耗时（I2V） | **提交→终态 124.7s**（同一模型 / 720p / 5s，首帧图输入） | **【已验证实测】**2026-09-23，同一脚本 `--i2v` |
| 云端 Seedance 耗时（FL2V） | **提交→终态 100.4s**（同一模型 / 720p / 5s，首尾帧双输入） | **【已验证实测】**2026-09-23，`--i2v A --last B` |
| V2V 的参数级探测 | **不产生成片费用**：形态不合法时上游在**参数校验阶段**就 400（2 秒内终态），不会开始生成 | **【已验证实测】**2026-09-23：3 次探测均 400；另一次经产品路径的 V2V 也在此阶段失败 |
| 云端 Seedance 耗时（V2V） | **提交→终态 116.7s**（同一模型 / 720p / 5s，**参考视频**输入；线上实例实测） | **【已验证实测】**2026-09-23 |
| 云端 Seedance 耗时（Step 4 复验 · T2V） | **提交→终态 89.0s**（同一模型 / 720p / 5s；提示词含直角双引号对白，成片音轨 mean -15.8dB、无 ≥0.3s 静音段） | **【已验证实测】**2026-09-23，见 [walkthrough.md](walkthrough.md) §1-1 |
| 云端 Seedance 耗时（Step 4 复验 · I2V） | **提交→终态 62.3s**（同一模型 / 720p / 5s；输入 831×479 → 清洗落盘 800×448；成片首帧与输入图 PSNR 40.22dB） | **【已验证实测】**2026-09-23，见 [walkthrough.md](walkthrough.md) §1-2 |
| 上游 I2V 输入图隐私检测 | **含拟真人脸 → 400 + 8.1s 终态**（`InputImageSensitiveContentDetected.PrivacyInformation`）；落在**参数校验阶段、未开始生成**（无成片费用） | **【已验证实测】**2026-09-23，见 [walkthrough.md](walkthrough.md) §1-3a |
| 云端 Seedance 单次成本 | **约 1~2.5 元 / 条（5s @720p）【估算】**：按上游计费口径 `token = (输入时长+输出时长) × 宽 × 高 × 帧率 ÷ 1024` = 5×1280×720×24÷1024 ≈ **108,000 token**；mini 档第三方价目 $3.24/M（输入不含视频）→ ≈ $0.35。**实际扣费以方舟控制台账单为准**（未核对我方账单） | **【待验证】**金额待账单核对；**计算口径与耗时口径已实测** |

**风险登记**：
- R1：DiffSynth-Studio / H3 权重版本漂移 → 锁版本号并记录于 UPSTREAM.md；
- R2：Seedance API 变更 → Provider 接口隔离，变更只动 `VolcanoSeedanceProvider`；
- R3：画廊磁盘膨胀 → 防线 3（LRU + 一键删除）已在设计内；
- R4：素材站配额（Pexels 200 次/小时）被流水线反复消耗 → CI 一律走 OI-2 `fixture-local`，仅手动回归用例允许联网走 OI-1。

### 施工期避坑清单（原一次性施工手册 §2 / §12 的存档，2026-09-23 迁入）

> 这些是"不知道就会白跑几小时"的坑。手册已归档删除，此表成为**唯一位置**。

| # | 坑 | 现状 |
|---|---|---|
| 1 | **本地 H3 全量出片 7~10 小时/条** → 任何验收 / e2e / 调试一律用 Seedance 云端轨或 OI-2 夹具；用本地轨验收 = 把验收变成一周级阻塞 | 仍适用（§8 有实测） |
| 2 | **`packages/shared` 必须先 build**：backend / frontend 消费 `dist` 而非 `src`；改契约不 build 会**安静地跑旧契约**（症状：改了字段名、行为不变） | 仍适用（CI 已固化这一步） |
| 3 | **反代后 `trustProxy` 未开** → 所有请求同 IP，防线 5 的冷却退化成全局锁（症状："别人提交过，我就被限流了"） | 已在 compose 里固定 `TRUST_PROXY=1` |
| 4 | **幂等 / 不重复提交的断言必须计数**（上游调用次数 = 1），不能只看返回同一个 taskId | 已固化为测试断言 |
| 5 | **"已清理"类断言要用"目录不存在"**，不能只看日志打印 | 已固化为测试断言 |
| 6 | **ffmpeg 依赖必须"缺失即明确报错"**，否则 CI 上表现为神秘的 `ENOENT` | 已实现（`lib/ffmpeg.ts` 中文指引） |
| 7 | **`.tmp/` 是 gitignore 的**：施工产物（日志 / 临时脚本 / 真机冒烟输出）放 `.tmp/`，不要混进 `docs/` | 仍适用 |
| 8 | **Windows 下 `better-sqlite3` / sharp 可能需要 build tools**；装不上要记录，不许静默换实现 | 仍适用（本机 Node 24 + 预编译包已可用） |
| 9 | **跨源资源会被生产 CSP 拦掉**（2026-09-22 实测：外链 Google Fonts 导致线上字体从未生效）→ 字体 / 样式 / 脚本一律自托管；静态自检与 UI 冒烟各守一层 | 已实现（见台账 B19） |
| 10 | **`deploy/` 与 `scripts/` 里的配置改完必须走 CD**：仓库改 ≠ 线上生效。2026-09-23 实测：挂载的 Caddyfile 内容变化**不会**被 `docker compose up -d` 重载 → 已在 `scripts/deploy.mjs` 里补 `caddy reload` | 已修复（同批次的真实踩点） |
| 11 | **ffmpeg / ffprobe 走系统安装**（不是 npm 依赖）：本地 `winget install Gyan.FFmpeg` 或官网解压加 PATH；CI 用 `apt-get install -y ffmpeg`；镜像内 `apt-get install -y ffmpeg`。**仓库与镜像都不内置二进制** | 已固化（`ci.yml` + `Dockerfile`），登记在 `UPSTREAM.md` |
| 12 | **缺依赖必须中文报错并显式失败**（不许崩栈）：provider 与脚本启动时探测 ffmpeg，缺失则打印安装指引 | 已实现（`lib/ffmpeg.ts`） |
| 13 | **目录与卷约定**：`data/`（SQLite）、`outputs/`（成片）、`outputs/assets/`（参考资产）、`outputs/thumbs/`（封面）、`outputs/.tmp/`（中间产物）；全部在 `.gitignore` 内，容器里经卷挂载（镜像重建不丢任务库与成片） | 已固化（`compose.yaml` + `store/db.ts`） |

---

## 9. 待优化台账（backlog · 唯一权威位置）

> 本节的项**不在 Step 2 ~ Step 5 的实施范围内**；它们是本次架构决策中**主动降级 / 延后**的项与已识别但暂不处理的问题，逐项登记「何时必须做」，避免遗忘或临时拍脑袋。**本表是全项目唯一台账**（原施工手册 §13 只是它的指针，手册已归档删除）。
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
| B26 | ~~历史成片没有"播放/预览"入口~~ → **已修复**（V8.3 批次 7：点封面即载入中栏播放，`App.handlePreview` 复用现有轮询的终态渲染，零额外上游请求；见 §5） | 用户报障（"其它人跑的历史成片我无法预览"） | — |
| B27 | **`assets/` 匿名可读的进一步收敛**（V8.3 批次 7 的代价）：当前靠"随机 UUID + 不公开"保护。可选的更强方案：① 给资产 URL 加**短时效签名**（`?exp=&sig=`，服务端校验）；② 上游取图走**服务端中转**（我方代抓，但上游要能拉我们的流）；③ 云轨一律用 data URL（请求体 ×1.33，且未经上游验证大图是否接受） | 批次 7 的安全取舍 | 当部署场景不能接受"知道 URL 即可读"时（个人/信任场景可一直用现状） |
| B28 | **迁 react-router**（替换自写 hash 路由）：视图注册表已数据化，迁移只换解析层 | §6-D34 | 出现**嵌套路由**（如 `#/library/:taskId/edit`）或需要 loader 数据约定 / 路由级代码分割时 |
| B29 | **剪辑台增强**：更多转场类型与时长档位、逐段滤镜（亮度/对比度/饱和）、字幕轨（drawtext）、音频轨替换、剪辑模板 | §6-D37 / Step 6-AC6 | MVP 三件套（trim/concat/xfade）上线后有人真的用时 |
| B30 | **配方库加"行业"维**（电商/短剧/产品广告）与配方数量扩充 | §6-D36 | 首批配方上线后按使用反馈再定（避免无人用先膨胀） |
| B31 | **图片生成入口**（可灵式"图片生成"一级能力位）：上游其实支持文生图，但我们当前只做视频 | 用户 2026-09-23 的讨论记录 | 产品明确要扩到图片生成时；届时它应有独立的能力位与计价口径，不蹭视频轨的契约 |
| B32 | **I2V / FL2V 真人输入的体验收敛**：上游会对输入图做隐私检测（含拟真人脸 → 400 `InputImageSensitiveContentDetected.PrivacyInformation`），当前姿态是**如实透传上游报文 + `terminal`**（归类正确、无静默降级）。候选改进：① 前端对"疑似真人照片"给前置提示（本项目无本地人脸检测能力，只能做文案引导）；② 把这一类上游拒绝映射成更可读的中文说明 + 建议动作（换非真人素材 / 改用 T2V / 用生成图而非实拍） | 2026-09-23 Step 4 验收的真实发现（[walkthrough.md](walkthrough.md) §1-3a） | 真人素材成为常见路径时，或出现第二次用户报障时（在此之前保持"如实透传"） |
| B33 | **host 本地轨的形态（一个 provider 还是两个可选后端）**：`LocalH3Provider` 至今未实现（选本地引擎如实返回 `PROVIDER_UNAVAILABLE`，见 §4 Step 2 与 GUIDE §三）。**用户 2026-09-23 决策：先搁置，待换机后再议**。届时要定的是"本地引擎"到底指什么 —— 本机已有 ComfyUI，而配置自检（`COMFYUI_BASE_URL` / `H3_WORKDIR`）**本来就同时认这两种**，所以"可选后端"在配置层已有一半基础；但两者的能力位与档位语义（Tier、时长上限、是否原生音频 / 双引号台词）并不相同，须先定契约再实现 | 用户 2026-09-23 决策（换机后再探）；现状见 §4 Step 2 / GUIDE §三 | 换机后由用户主动提出时。**在此之前不得用"标【待验证】的猜测实现"去占位**（没有 H3 环境就无法实测） |
| B34 | **`step2.integration.test.ts` 的"服务重启后任务可恢复"（防线 2）用例时序敏感**：2026-09-23 跑 V9 · B8 门禁时实测失败一次（`expected 'failed' to be 'succeeded'`，同轮耗时从 ~50s 涨到 215s），**单独与该文件下一轮全量均通过**。判断：桩 provider 的完成时机与"重启"步骤赛跑（机器负载高时任务尚未到终态就被重启 → 启动调解按防线 2 如实归 `failed`）。**不是产品缺陷**（防线 2 的行为恰恰是正确的），而是**测试写法的脆弱点** | 2026-09-23 实测观察（V9 · B8 门禁） | 该用例在 CI 上再失败一次时（届时改成"先轮询到终态、再重启"的确定性写法） |
