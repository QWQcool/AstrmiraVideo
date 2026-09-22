# AstrmiraVideo · 产品与开发规划（PLAN V8.1）

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
│  ├─ 图像清洗网关 (HEIC/WebP/CMYK 转码，大图下采样)                      │
│  ├─ 短窗口防抖限流 (60s 冷却，防连点刷 Token)                           │
│  ├─ 磁盘 LRU 管理 (中间帧即时删除，画廊容量可控)                        │
│  ├─ 任务存储 (SQLite：任务状态 + 参数快照 + 画廊元数据)                 │
│  └─ 双轨调度器 (Cloud 并发队列 / Local 单卡互斥队列 Concurrency=1)     │
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

**双轨调度原则**：硬件探针（`GET /api/providers/status`）动态扫描 CPU / 内存 / GPU / 空闲显存，评级 Tier 0~3（分级矩阵见 [GUIDE.md](GUIDE.md) §一）；Tier 0 自动锁定云端并置灰本地开关，Tier 1~3 激活本地选项。**不硬编码任何具体显卡型号或本机路径。**

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
| 1 | 本地单卡排队互斥锁 | Local 队列 Concurrency = 1，防显存崩溃；后续任务进入 `queued` |
| 2 | 刷新断线不丢任务 | 任务状态落 SQLite（`data/app.db`），前端 `localStorage` 存任务 ID，刷新自动重挂载进度 |
| 3 | 磁盘空间防护 | 合成结束立即物理清理中间帧与临时音频；画廊 LRU 淘汰；前端一键删除 |
| 4 | 图像格式清洗网关 | HEIC/WebP/CMYK 自动转码，大图下采样，防爆显存 |
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

### Step 1.5：地基整改（任务与 AC 见 [EXEC.md](EXEC.md)，本处仅作索引）
- **范围**：占位探针去硬编码（T1）· `packages/shared` 契约包（T2）· zod 路由校验（T3）· 真实 inject 测试（T4）· 前端 token 化 + 字体 / eyebrow 修正（T5）· `JobQueue` 接口骨架（T6）；
- **不变量**：不实现任何 provider、不实现队列 / 幂等 / 防抖、不拆前端组件、不做 keyframes 落位（见 EXEC §3「明确不做」）；
- **前置**：本 Step 全部 AC 通过并记录于 §5 后，Step 2 方可开工。

### Step 2：双轨 Provider 与核心调度
- **实施顺序（已定）**：`OI-2 夹具 provider` → 公共链路（存储 / 画廊 / 206 / 磁盘 / 幂等键）→ `Seedance`（AC2，真金白银）→ `OI-1 素材`。理由：公共链路是所有 provider 的共同地基；OI-2 是唯一「无 Key、无网、无 GPU、零成本、结果确定」的 provider，而 AC4（重启恢复）与 AC7（不确定不重提）需要**反复制造故障**，只有用夹具 provider 才能不花钱地反复跑。
- **任务**：`pipeline/smartCrop.ts`（32 倍数居中裁切）；`providers/VolcanoSeedanceProvider.ts`（提交+轮询+下载）；`providers/LocalH3Provider.ts`（子进程调度+互斥锁）；`providers/registry.ts`（provider 唯一注册点）；`providers/statusProbe.ts`（**真实算力探测**，替换 Step 1 占位实现）；**三态错误码与幂等键**（CONTRACT V1.3 §5 / §6）；**开发期故障注入层**（见下方「Step 2 补充」）；**CI 三件套（lint / type / test）**；**防线 5 防抖限流（`IP + Key 指纹` 复合键，冷却状态落 SQLite）**；**`/api/upload` 上传加固（≤20MB × ≤4 个、魔数嗅探、类型白名单、路径不含用户输入）**；**公网最小鉴权中间件骨架（回环免鉴权，细则 §7-4）**；路由挂载 `/api/generate`、`/api/tasks/:taskId`、`/api/providers/status`、`/api/prompt/enhance`、`/api/upload`、`/api/history`；SQLite 任务存储。
- **AC1**：契约层测试全绿（`pnpm test:contract`，覆盖 CONTRACT.md 全部路由与错误码，含三态 `disposition` 穷举）。
- **AC2**：Seedance 真实冒烟出片 1 次，记录实际耗时与费用，回填 §8 成本表（消除【待验证】标记）。
- **AC3**：本地并发提交 2 个任务，第 2 个任务状态为 `queued`，无第二个推理进程被拉起。
- **AC4**：服务重启后，进行中的任务能从 SQLite 恢复状态，前端刷新可重挂载。
- **AC5**：可选实现项 OI-2（`fixture-local`）产出真实可播 MP4，`ffprobe` 校验通过，全程零外网依赖、零配额消耗；见下方「Step 2 补充」。
- **AC6**：`/api/providers/status` 由真实探测驱动——无 GPU / 引擎未实现时必须返回 `available: false` + `reason`，**任何情况下不得返回硬编码型号**；Step 1 的占位实现同步移除。
- **AC7**：注入 `uncertain` 故障后任务归 `UNCERTAIN_RESULT`，**不发生任何自动重提**（硬断言：上游调用次数 = 1）；同一幂等键重复提交返回同一 `taskId`。
- **AC8**：CI 三件套就位，`pnpm test` 同时覆盖契约层与真实产物层（AC1 + AC5）。
- **AC9**：防线 5 落地——60s 冷却按「来源 IP + BYOK Key 指纹」复合计数；冷却状态落 SQLite，**服务重启后窗口不丢失**（断言：重启前后同一键提交仍被拒且返回 `RATE_LIMITED`）。
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
- **AC1**：T2V（含双引号台词人声）与 I2V（含 32 倍数裁切）各跑通 1 次完整链路。
- **AC2**：HEIC / WebP / 超大图各上传 1 次，清洗网关无报错、输出合规。
- **AC3**：项目级 DoD 达成——后端契约测试全绿 + 上述两条 e2e 全绿。
- **AC4**：CI 以 OI-2（`fixture-local`）跑通端到端并产出可播 MP4；OI-1（`stock-local`）手动回归 1 次。
- **产出**：`walkthrough.md` 验收记录【规划】。

### Step 5：公网部署与交付
- **任务**：`Dockerfile` + `docker-compose.yml`；反向代理 + HTTP 206；部署至 `DEPLOY_HOST`（值在本地 `.env`，勿写入文档）。
- **AC1**：外部手机浏览器访问公网地址，无卡环境下默认云端轨出片成功。
- **AC2**：探针返回 `local.available: false`，前端本地开关置灰并展示说明。
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

**截至 2026-09-22 · 当前指针：Step 1.5 地基整改中（[EXEC.md](EXEC.md)），完成后 Step 2 开工**

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
- [x] 文档/代码纪律分叉整改【文档侧已完成】：README 过期标记修正 + 新增协作规范 6（进度回检）、CONTRACT 升 V1.5（`ProviderType` 补 OI id）、§7 安全补鉴权/限流键/上传加固、§6 新增 D18~D21、立项 [EXEC.md](EXEC.md) 整改手册；
- [x] 文档收口【文档侧已完成】：PLAN 升 V8.1（版本标签与正文统一）、§4 补 Step 1.5 索引、Step 2 补防线 5 / 上传加固 / 鉴权中间件的任务与 AC9~AC10、Step 3 承接 keyframes 与索引号等视觉收口（AC5~AC7）、CONTRACT 升 V1.7（§8 补 `HealthResponse`）、EXEC 修编号与 AC 可执行性并把字体 / eyebrow 并入 T5（P1-5 / P1-6）；
- [ ] **Step 1.5 地基整改【规划】**：占位探针去硬编码、shared 契约包、zod 路由校验、真实 inject 测试、队列抽象接口、前端 token 化——任务与 AC 见 [EXEC.md](EXEC.md)（决策依据 §6-D18 ~ D21）；
- [ ] Step 2 ~ Step 5：见 §4。

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

---

## 7. 安全与合规（吸收原 COMPLIANCE.md，唯一详写处）

1. **密钥管理**：火山 Key 由服务端环境变量或会话内存持有，绝不回传前端明文、绝不入日志；日志中 Token 强制掩码（如 `sk-****abcd`）；前端保存后只回显掩码；服务端内存中的 Key 在进程退出 / 会话过期时主动置空。
2. **本地模型边界**：MiniMax H3 全程本地离线，图像与音频不出本机；ComfyUI 仅限回环或受控局域网——服务端对 `H3_WORKDIR` / `COMFYUI_BASE_URL` 做白名单校验（仅回环地址 / RFC1918 内网 / 本机路径），拒绝任意外部地址，防 SSRF 与任意命令面暴露。
3. **公网部署形态**：默认路由云端轨，不开放任何本地 Shell 执行面；单任务时长上限 5~10s，防任务堆叠。
4. **公网最小鉴权（V8.1 新增，Step 5 前必须落地）**：公网部署时所有 `/api/*`（除 `/api/health`）要求 `Authorization: Bearer <PUBLIC_API_TOKEN>`（值在 `.env`）；本地回环（127.0.0.1 / ::1）请求免鉴权，保证单机开发零摩擦。无鉴权公网裸奔视为验收不通过。
5. **限流键定义（V8.1 新增）**：防线 5 的 60s 防抖按「来源 IP + BYOK Key 指纹（Key SHA-256 前 8 位；无 Key 时仅用 IP）」复合计数；本地部署无 Key 场景退化为 IP 单键。防抖状态存 SQLite，重启不丢失冷却窗口。
6. **上传与静态面加固（V8.1 新增）**：`/api/upload` 限制单文件 ≤ 20MB、总数 ≤ 4，MIME 以魔数嗅探为准（不信任 Content-Type 头），白名单：jpg/png/webp/heic/mp4/mov；`outputs/` 直链路径只含服务端生成的随机 ID，禁止任何用户输入拼入文件路径（防路径穿越）；CORS 由 `origin: true` 收紧为 `.env` 白名单（`CORS_ORIGINS`，本地开发默认 `http://localhost:5173`）；安全响应头（`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`）统一挂载。
7. **文档卫生**：IP / 绝对路径 / 凭证永不入 md（占位符化），真实值只存本地 `.env`；`.env`、`data/`、`outputs/`、媒体文件已入 `.gitignore`。
8. **视觉版权**：Astrmira 视觉语言仅作参考，本项目与其站点无任何隶属关系（见 README 免责）。

---

## 8. 成本与风险

| 项 | 数字 | 标记 |
|---|---|---|
| 本地 H3 出片耗时 | 480x832 / 124 帧：Tier 2（16GB）实测 Disk Offload 单步耗时约 8~14 分钟，50 步全量生成约需 7~10 小时；不可用于实时交互，仅适合离线批处理 | 【已验证实测】详见 gen_drama.log |
| 云端 Seedance 耗时 | 约 30 秒~1 分钟 | 【待验证】Step 2-AC2 回填 |
| 云端 Seedance 单次成本 | 待冒烟后按官方计费回填 | 【待验证】 |

**风险登记**：
- R1：DiffSynth-Studio / H3 权重版本漂移 → 锁版本号并记录于 UPSTREAM.md；
- R2：Seedance API 变更 → Provider 接口隔离，变更只动 `VolcanoSeedanceProvider`；
- R3：画廊磁盘膨胀 → 防线 3（LRU + 一键删除）已在设计内；
- R4：素材站配额（Pexels 200 次/小时）被流水线反复消耗 → CI 一律走 OI-2 `fixture-local`，仅手动回归用例允许联网走 OI-1。
