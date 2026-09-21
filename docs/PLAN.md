# AI 视频生成工作流水线 · 立项计划书 V6.0

> 2026-09-21 · 两项目审计 + 22 项调研 + Astrmira 设计规范实测
> 三人团队（你 / 朋友 A / 朋友 B），纯 VibeCoding · **方案已定稿，可开工**
> **V6.0 变更**：开工前三项拍板（模板降级先行 / Pexels 主素材源 / **W1 直接上星尘视觉**）· W1 前端改为与后端**并行开发** · 补充星尘在 W1 的低成本落地方式

---

## 0. 本版核心结论

| 项 | 结论 |
|---|---|
| **先做什么** | **先做素材型 L1（MPT 式一句话跑完八步）** —— 正确，且理由比预想更充分（§1） |
| **为什么** | 素材型与模型型的架构差异**只有「片段获取」一个节点**；做 L1 = 搭好 ~80% 中台 + **零成本产出真实可看的视频**（真正替代 mock）+ **多人跑测零门槛（无需 GPU / 无需付费 Key）** |
| **交互形态** | 三档交互深度（L1 一键 / L2 纵向步骤流卡片 / L3 画布）+ 检查点机制 |
| **Dify 画布** | 列入 L3（延后）；实现从 **React Flow（MIT）** 抄，**Dify 前端代码不复制、视觉不照搬**（许可边界见 §4） |
| **多人跑测** | 素材型 = 服务器直接跑（无 GPU）· 模型型 = 本地 Worker 或 BYOK |
| **开工状态** | ✅ **方案已定稿**：三项拍板（模板降级先行 / Pexels 主素材源 / **W1 直接上星尘**）→ 可按 §10.2 Day 0 → §10.3 W1 直接推进 |

---

## 1. ★ 双模式架构：一份中台，两种「片段获取」

### 1.1 关键洞察：两条流水线只差一个节点

```
公共中台（≈80% 工作量，两条线完全共用）
  brief → 脚本生成(LLM) → 分镜/段落切分 → ┃片段获取┃ → 音频(TTS) → 字幕 → 合成(ffmpeg) → 导出
                                              ↑
                                    唯一的差异点
  素材型（L1 低成本模式）：脚本关键词 → 免版权库检索(Pexels/Pixabay) → 下载片段
                           特点：免费 · 秒级 · 确定性高 · 可无脑全自动
  模型型（L2/L3 高质量模式）：提示词编译(H3 schema) → AI 生成(H3/Seedance) → 下载片段
                           特点：付费 · 分钟级 · 不确定性高 · 必须有人工检查点
```

**所以「先做素材型」不是弯路，而是性价比最高的第一步**：
1. 它把**队列 / DSL / 护栏 / 资产库 / 导出 / 前端 / 任务恢复**全部搭好并跑通
2. 它产出的是**真实可看的视频**（免版权画面 + 配音 + 字幕 + 配乐），**真替代 mock 模式**
3. 后面接模型型 = **换掉一个节点的实现**，中台零改动
4. **素材型不需要 GPU、不需要付费 Key** → 服务器上就能跑 → **多人/多测试者零门槛**（正好满足你「其他人没本地模型也能跑测」）

### 1.2 素材型流水线的八步（对齐 MPT，但换成我们的中台）

| # | 步骤 | 实现 | 成本 |
|---|---|---|---|
| 1 | 输入 brief / 关键词 | 表单 + 一键入口 | 0 |
| 2 | LLM 生成脚本（可多语言） | LLM profile（OpenAI 兼容 / 火山），无 Key 降级为模板 | ~¥0.003 |
| 3 | 脚本 → 素材关键词 | 规则 + LLM 抽取 | 0 |
| 4 | **片段获取** | Pexels / Pixabay API 检索 + 下载 + 裁剪对齐 | **0（免版权）** |
| 5 | 配音 | Edge TTS（**免费无需 Key**；WebLockShot `server/tts.mjs` + AI-SVWF `tts_service.py` 两处现成可复刻） | 0 |
| 6 | 字幕 | 先「按脚本文本直出」（确定性、零成本）；后接 Whisper 对齐 | 0 |
| 7 | 合成 | ffmpeg（WebLockShot `server/render.mjs` 已有并发互斥实现可抄） | 0 |
| 8 | 导出 | MP4 / 剪映草稿 zip（WebLockShot `src/export/jianyingDraft.ts` 现成） | 0 |

**→ 整条素材型流水线的边际成本 ≈ ¥0**，只有步骤 2 的 LLM 调用有几分钱开销。

### 1.3 必须明确的三件事（避免验收扯皮）

1. **验收标准是「流程跑通」，不是「成片质量」**。素材型产出的是「免版权画面拼贴 + 配音 + 字幕」，与「AI 生成电影感画面」观感差距巨大。一阶段验收看：全链路是否自动跑完、产物是否完整可播、错误是否可读、重跑是否准确。
2. **新增依赖**：免版权素材库 API（免费注册，有速率限制——**具体额度以官方文档为准**）、ffmpeg、Edge TTS。注意素材库的**人物肖像与品牌标识限制**（有搜索结果显示部分素材存在此类限制，选材要做过滤）。
3. **合规标注**：素材型产物**不得声明为「AI 生成视频」**（它是素材拼贴），应在导出物/界面如实标注来源。

---

## 2. 三档交互深度 + 纵向步骤流卡片 + 检查点机制（已入册）

### 2.1 三档交互深度（共用一份 JSON DSL）

```
L1 一键全自动     填 brief → 跑完 → 出片          = 预设 DSL · 免编辑执行
L2 分步可介入     每步可见可改 · 可重跑 · 可中断    = DSL 的「纵向步骤视图」★ V1 主体
L3 可视化编排     节点画布 + 节点即表单            = DSL 的「横向画布视图」（延后）
```

**L1 不是额外功能**，而是「预设 DSL 跑一遍」；**L3 不是 V2 才有的东西**，而是同一份 DSL 的另一个视图。所以**先把 DSL 定对**，三档都能长出来。

### 2.2 V1 主体界面：纵向步骤流卡片

```
┌ [1] Brief & 参考图        ✓ 可编辑 · 可重跑 ┐
├ [2] 脚本 / 提示词         ✓ ★检查点：停下确认 ┤   ← MPT 的流程清晰
├ [3] 片段获取（素材/模型）  ✓ 目标与预算 ¥0/¥14.9 ┤   ← 我们的护栏
├ [4] 音频 & 字幕           ▓▓▓░░ 62%         ┤   ← 每卡片 = 一个「节点」
├ [5] 合成                 ⏳ 进行中            ┤
└ [6] 产出                 QA 87 分 · 可重跑此步 ┘
```

**设计价值**：卡片流本质就是「**纵向节点流 + 节点即表单**」——同时拿到 MPT 的流程清晰度与 Dify 的核心交互模型，实现成本只是画布的零头。未来换横向画布是**渐进增强**（同 DSL 换视图），不是重构。

### 2.3 检查点机制（checkpoint）—— 素材型/模型型不同策略

| 检查点 | 素材型（免费） | 模型型（付费） |
|---|---|---|
| 脚本/提示词生成后 | 默认不停（可开） | **默认停下确认**（最便宜的修改点） |
| 片段获取前 | 不停 | **必停 + 显示成本预估 + 二次确认** |
| 生成完成后 | 不停 | 停：QA 评分 + 选变体 |
| 出母版前 | 不适用 | 停：本地抽卡 → 云端母版确认 |

**实现方式**：抄 MPT 的 `--stop-at <stage>` 思路 —— DSL 每个 stage 声明 `checkpoint: none | confirm`，执行器到此暂停并等待用户动作（继续 / 修改参数后继续 / 中止）。

### 2.4 从两个项目各抄什么（具体清单）

**从 MPT 抄（MIT，可放心复刻代码；语言无关的资产可直接扒）**
1. **参数优先级分层**：显式参数 > UI 保存值 > 内置默认 → 我们的 DSL 覆盖链（项目级 > 用户级 > 默认）
2. **每环节三态**：自动 / 上传自备 / 关闭 → 提示词（LLM / 手写 / 模板库）、参考图（上传 / 资产库 / 无）、音频（AI 原生 / TTS / 无）
3. **`--stop-at`** → 检查点机制
4. **试听/预览（不消耗生成）** → 提示词预览 + 成本预估
5. **批量清单**：JSON/JSONL、上限、**单条失败不阻断**、统一汇总
6. **任务历史 + 配置导入导出**
7. **素材关键词提取的提示词模板**（可直接拿来改）

**从 Dify 抄（只抄「交互模式」，不抄代码）**
1. **Workflow vs Chatflow 的区分** → 我们的双入口：`一键创作`（Workflow）+ `对话引导`（Chatflow，「几句描述 + 参考图」天然对话式）
2. **节点即表单**（点节点 → 右侧面板变表单）
3. **变量引用**（上游输出作为下游输入）→ DSL 数据流
4. **单节点试运行 + 运行历史** → 「只重跑这一步」
5. **版本控制 + Snippets** → 预设/Skill 库

---

## 3. 多人跑测的三条零门槛路径（满足你的需求 2）

| 路径 | 谁用 | 需要什么 | 成本 |
|---|---|---|---|
| **素材型 L1**（服务器直跑） | **任何人**（零门槛，最终验收前的跑测主力） | 只需浏览器 | **≈¥0** |
| **模型型 + BYOK** | 没本地模型的测试者 | 自带视频 API Key | 用户自付 |
| **模型型 + 本地 Worker** | 有 GPU 的成员（3080 / 4060Ti） | 启动本地 Worker | ¥0（电费） |

**这就是「初期简化、验证流程跑通」的最佳落地**：素材型让人人可测，模型型由你们自己验证。

---

## 4. Dify 的许可边界（已核对 LICENSE 原文）

Dify 使用的是 **modified Apache License 2.0**（修改版 Apache 2.0）。逐条核对后的准确边界如下：

| 条款 | 原文要点 | 对我们的适用性 |
|---|---|---|
| **Multi-tenant service** | "Unless explicitly authorized by Dify in writing, you may not use the Dify source code to operate a **multi-tenant environment**."（一个 tenant = 一个 workspace） | ✅ **已放弃多租户服务 → 不触发** |
| **LOGO / copyright** | "In the process of using Dify's **frontend**, you may not remove or modify the LOGO or copyright information... **This restriction is inapplicable to uses of Dify that do not involve its frontend.**"（「frontend」定义 = 源码的 `web/` 目录，或 Docker 的 `web` 镜像） | ⚠️ **只要不复用它的 `web/` 前端代码就不适用** → 结论：**抄后端逻辑可以，抄前端代码不行**（否则得挂着 Dify 的 LOGO 与版权，产品不可接受） |
| **★ 外观专利** | "**The interactive design of this product is protected by appearance patent.**" | ⚠️ **不要照搬它的 UI 视觉与布局**。学交互**逻辑**可以，视觉必须做出自己的样子——我们的 Astrimira 星尘风天然规避 |
| **Apache 2.0 兜底** | 未覆盖部分遵循 Apache 2.0 | 若复用了非前端代码，需在 `NOTICE`/`UPSTREAM.md` 保留版权声明 |

**结论**：你「能抄代码实现」的目标可以达成，而且有一条**更干净的路**：画布能力从 **React Flow（MIT，无任何附加条款）** 抄——Dify 自己也建立在它之上。Dify 的正确用法是「**读它的实现理解模式 + 自己重写**」，前端代码不复制、视觉不照搬。

### 4.2 工程现实
- Dify 前端是 **Next.js 几十万行** + React Flow + 变量系统 + 调试器 + 版本发布；我们只需要其中约 1% 的模式（节点即表单 + 变量引用 + 单节点调试）。
- 抄进来的**维护成本远高于自研**（每次上游破坏性变更都要跟着改），且我们拿不到它的内部支持——**大项目不会帮我们 debug 我们的集成**。

### 4.3 正确做法
| 抄什么 | 从哪抄 | 许可 |
|---|---|---|
| 画布交互、节点、连线、MiniMap、缩放 | **React Flow / @xyflow/react** 官方示例（examples 仓库有大量可直接复制的实现） | **MIT** ✅ |
| 「节点即表单」的交互模式 | Dify 的**产品行为**（看它的用法，自己实现） | 模式不受版权保护 |
| 变量引用 / 单节点调试 / 版本发布 | 同上，学模式 | — |
| 素材型流水线结构、配置优先级、批量清单格式 | **MoneyPrinterTurbo** | **MIT** ✅ |
| 护栏三态、状态机、任务事件、QA 规则 | **AI-SVWF**（你们自己的项目） | 自有 |

**结论**：**「抄小库（MIT）+ 学大产品」比「抄大产品」更现实**；而且 React Flow 这类小库的 issue 响应速度远快于 Dify，你想要的「出问题能提 PR」在小库上才真正成立。

---

## 5. 更新后的排期（W1 即有真实视频产出）

| 周 | 目标 | 验收 |
|---|---|---|
| **W1** | 契约冻结 + 骨架 + **素材型 L1 全链路打通**（脚本 → 素材 → TTS → 字幕 → ffmpeg 合成 → 导出）+ 一键入口 + **星尘视觉前端（前后端并行）** | **输入一句话 → 服务器跑出一条真实可播的短视频，成本 ¥0**；界面符合 Astrmira token |
| **W2** | 纵向步骤流卡片 + 检查点机制 + 队列/重启恢复 + **LLM 选材打分** + 进阶动效（滚动揭示） | 每步可见可改可重跑；断点可继续 |
| **W3** | **模型型片段获取节点**：提示词管线（H3 schema 主干 + AI-SVWF 积木）+ 云端 provider **逐家直连**（Seedance / 即梦 / MiniMax / ComfyUI）+ 护栏 + BYOK | 云端各跑通 1 次；3 并发只过 2；BYOK 可用 |
| **W4** | 部署（国内云 + Docker + TLS + 共享口令）+ 监控告警 + 备案 | 内网成员可访问跑测 |
| **W5** | **本地算力落地**（Pull Worker + ComfyUI + 模型选型：H3 4bit+ClipProj vs Wan 2.2） | 本地出片；Worker 断线重连 |
| **W6** | QA 两级（LLM 评 → 人工校准）+ 资产库/一致性 + 剪映草稿导出 + 文档 + 真实验收 | 全链路；RUNBOOK |

> **W1 最大的价值**：产品闭环从第一周就成立（**真实视频 + 真实界面**），此后每个能力都是在「能跑的闭环」上增量，而不是等到后期才第一次看到成品。

---

## 6. 技术栈与前端（结论不变，压缩保留）

- **后端 Node + TypeScript**：核心工作是「编排 + HTTP 调用 + 状态管理」，瓶颈在外部 API 与 GPU；TS 在「与现有可复刻代码语言重合、AI 辅助效率、前后端契约共享、部署简单」四项全胜。Python 只作外部模型服务（ComfyUI/SGLang 独立进程），**Rust 不用**（除非日后单独做转码微服务）。
- **前端**：React 19 + Vite + TS；主界面骨架参考 **InvokeAI**（28k★：左参数/中预览/底队列/右画廊），产品流程参考 **MoneyPrinterTurbo**（125k★），视觉交互参考 **Lobe Chat**（83k★）+ **Open WebUI**（153k★），V3 画布参考 **Dify**（157k★）+ **n8n**（206k★）。

---

## 7. Astrmira 设计规范（实测，可复刻）

**实现特征**：Astro 静态站 + **纯 CSS 动效 + Canvas 粒子，无 GSAP/Three/Framer**；全页仅 3 个常驻动画 —— **慢（6s/18s/42s）+ 克制（位移 4–7px、±2°~7°）** 是高级感的来源。

```css
--bg:#090c12  --panel:#10141c  --panel2:#121822
--text:#eeeae1   /* 暖米白，非纯白 */
--muted:#9ba5b6  --faint:#7d889b
--line:#b3c3db29 /* 蓝灰 + 16% alpha 微光描边 */
--gold:#d6b881   --blue:#91b9d5
--action-fill:#e7dfd1  --action-hover:#f2ece2
--radius-control:8px  --radius-surface:18px
--ease-ui:cubic-bezier(.22,.61,.36,1)
--serif:Georgia,"Noto Serif","Songti SC",serif   /* 标题用衬线 */
--sans:Arial,"PingFang SC","Microsoft YaHei",sans-serif
```
**排版**：H1 实测 serif · 189.44px · 字距 **-14.208px**（超大 + 负字距 + 衬线标题 vs 无衬线正文 = 碑文感）。

**8 个 keyframes（原值）**：
```css
@keyframes star-gather{0%{opacity:0;transform:scale(1.15) rotate(-8deg)}16%{opacity:1}65%{opacity:1}100%{opacity:0;transform:scale(.04) rotate(14deg)}}
@keyframes mira-breathe{0%,100%{opacity:.9;transform:scale(.98) rotate(-2deg)}50%{opacity:1;transform:scale(1.04) rotate(2deg)}}
@keyframes mira-orbit-turn{100%{transform:rotate(360deg)}}
@keyframes origin-orbit-sway{0%,100%{transform:rotate(-7deg)}50%{transform:rotate(7deg)}}
@keyframes flow{100%{stroke-dashoffset:-140px}}
@keyframes motion-bootstrap{0%,65%{opacity:0}100%{opacity:1}}
@keyframes navigation-enter{0%{opacity:0;transform:translateY(-6px)}100%{opacity:1;transform:translateY(0)}}
@keyframes language-appear{0%{opacity:0;transform:translateY(-4px)}100%{opacity:1;transform:translateY(0)}}
```

**双层视觉**：展示区（`#090c12` + 粒子 + 星芒金/冰蓝呼吸）／表单区（`#0b0f1a` + 实线边框 + 无入场动画 + 对比度 ≥4.5:1）。**必须尊重 `prefers-reduced-motion`**。

截图与探测脚本：`WebLockShot/.tmp/astrmira/`（hero.png / full.png / probe.js）

---

## 8. 护栏 / 成本 / 合规（更新）

### 8.1 护栏
窗口限流 60s ≤2 次（按用户维度）· in-flight ≤2 · 内容指纹幂等 · **不确定性不自动重提** · 三态计费风险 · 成本预估 + 二次确认 · 熔断默认关。
（素材型路径**完全不触发**云端付费护栏，是"免费安全区"。）

### 8.2 成本
| 项 | 成本 |
|---|---|
| 素材型全链路 | **≈¥0**（仅 LLM 脚本生成几分钱） |
| 模型型 15 秒 720P 云端 | ¥14.9（2.0 mini）/ ¥45（2.5）/ ¥74（1080p 2.0 增强） |
| 模型型本地（W5 后） | ¥0（电费） |
| 开发期首月 | **≈¥120–400** |
| 月度基建 | 服务器 2C4G ¥60–120 + 对象存储 ¥10–25 ≈ **¥80–150/月** |

### 8.3 合规红线（B 主责）
1. **H3 商用界面必须显著标注 "MiniMax H3"**（现在做，成本为零）
2. H3 年收入 >2000 万美元需授权；产出/权重不得训练非 H3 模型
3. **Dify 代码不得复制使用**（多租户 SaaS 禁令 + LOGO 禁令）→ 只学模式
4. ComfyUI GPL-3.0 → 只 HTTP 调用；Vidia FSL-1.1 → 只学架构
5. 素材库素材：注意**人物肖像与品牌标识限制**；素材型产物**不得标注为「AI 生成」**
6. BYOK 用户 Key：内存优先 + 加密存储 + 日志脱敏 + 永不回显
7. 备案个人；**付费开放前**再评估主体变更 + AUP/审核/算法备案

---

## 9. 决策台账（本轮更新）

**已定**
- 不接 OFox / MuAPI（拒绝中间商加价）→ 逐家直连
- 剪映草稿导出**要做**（拿来主义，见 §10.9）
- 字幕：先「脚本直出 + TTS 时长推算时间轴」（零成本、确定性）；Whisper 对齐后置
- 选材质量：**做 LLM 打分选材**（对候选片段按脚本语义打分再下载，几分钱换明显观感提升）→ 排入 W2
- 复刻代码时：抄 React Flow（MIT）而非 Dify 前端；Dify 只读模式不抄代码

**待定**
1. **本地模型选型**（W5 前定）：H3 4bit+ClipProj（带音频、慢）vs Wan 2.2（快、无音频）
2. **对话引导入口（Chatflow）**：V1 是否要有——我的建议是 **V1 只做「表单 + 一键」**，对话入口放 W2 之后（它需要多轮状态管理，会拖慢竖切）

---

## 10. 开工步骤（可执行）

### 10.1 总原则：竖切优先（vertical slice）

**先把「一句话 → MP4」这条竖切用最粗糙的实现跑通，再逐层加固。**
W1 的目标**不是**做好素材型流水线，而是**让闭环先成立**——此后每加一个能力，都是在能跑的闭环上增量。

### 10.2 阶段 0 · Day 0（半天，开工当天）

| # | 动作 | 谁 |
|---|---|---|
| 1 | 建仓库 `video-pipeline`（`backend/ frontend/ deploy/ docs/ scripts/`）+ `.gitignore` | 你 |
| 2 | Node 22 + pnpm + TS strict + oxlint + vitest + GitHub Actions 三件套（lint/type/test） | A |
| 3 | `docs/CONTRACT.md`（空模板待填）/ `docs/UPSTREAM.md`（复刻台账）/ `docs/COMPLIANCE.md`（合规台账） | B |
| 4 | 账号准备：Pexels API Key（免费）、Pixabay API Key、LLM Key（火山/OpenAI） | 你 |
| 5 | 云服务器开通 + **提交 ICP 备案**（周期 1–3 周，务必 Day 0 就交） | B |

### 10.3 阶段 1 · W1 —— 竖切打通（一句话 → 一条真视频）

| Day | 任务 | 谁 | 交付 |
|---|---|---|---|
| 1–2 | 后端骨架（Fastify + zod + better-sqlite3 + pino）；**DSL v0**（stage 列表 + params + checkpoint）；任务表/状态机/事件表（设计抄 AI-SVWF）；单进程队列 worker | A | 能建 job、能跑 stage、能追事件 |
| 1–2 | **设计 token 落地**：把 §7 的 19 个 CSS 变量写成 `tokens.css`（含字体栈/圆角/缓动/间距）+ 前端骨架（Vite + React 19 + TS） | 你 | 设计系统就绪 |
| 2–3 | **展示区星尘**：单层粒子 Canvas + 星芒 `star-gather`（一次性 + `↺` 重播）+ 关键词跑马灯（`✧` 分隔）；**高对比表单区**：实线卡片 + 无入场动画 + 对比度达标 | 你 | 首屏 + 表单骨架（先对 mock 数据） |
| 2–3 | stage `script`（**先模板降级**，Day 3 再接 LLM）→ stage `keywords`（规则抽取 + LLM 优化） | A | 一句话 → 脚本 + 素材关键词 |
| 3–4 | stage `footage`（Pexels 搜索 → 选片 → 下载 → 裁剪对齐时长） | A | 可用片段集合 |
| 4 | stage `tts`（复刻 WebLockShot `server/tts.mjs`）+ stage `subtitle`（脚本直出 + 时长推算时间轴） | A | 音轨 + 字幕数据 |
| 4–5 | stage `compose`（复刻 `server/render.mjs` 的并发互斥思路：ffmpeg 拼接 + 音轨 + 淡入淡出） | A | **MP4 产物** |
| 5 | 前端接真实 API：`POST /api/jobs/oneclick` + SSE 进度 + 结果卡片（`<video>` + 下载） | 你 | 浏览器端到端可跑 |
| 6 | 部署（Docker + Caddy TLS + 内网访问） | B | 成员可访问 |
| 7 | 端到端验收 + **视觉走查**（对比度 / 动效 / `prefers-reduced-motion`）+ 补 CONTRACT.md | 全员 | **W1 验收通过** |

**W1 验收标准**：
1. 服务器上输入一句话 → 3–5 分钟内产出可播放的 MP4，成本 ≈¥0，多人可同时跑；
2. 界面符合 Astrmira token（展示区星尘 + 表单区高对比），axe 对比度检查通过，`prefers-reduced-motion` 生效。

**星尘为什么能在 W1 落地**：设计 token 已**实测拿到**（§7 的 19 个 CSS 变量 + 8 个 keyframes），核心工作只是「一份 `tokens.css` + 一个单层粒子 Canvas 组件 + 卡片组件」——不需要设计探索、不需要试色。
**W1 只做静态层与 hover 层**，滚动揭示等进阶动效放 W2。

**W1 明确不做**：LLM 选材打分 · 断点恢复 · 批量清单 · 检查点 · 模型型生成 · 进阶滚动动效

### 10.4 阶段 2 · W2 —— 从「能跑」到「好用」
1. 纵向步骤流卡片（每 stage 一卡片 + 折叠 + 独立重跑）
2. 检查点机制（`checkpoint: none|confirm` + 继续/改参后继续/中止）
3. 断点恢复（重启扫描未完成任务并续跑）
4. **LLM 选材打分**（候选片段按脚本语义排序）
5. 批量清单（JSON/JSONL，单条失败不阻断，统一汇总）
6. 任务历史 + 配置导入导出
7. 星尘视觉上身（展示区星尘 + 表单区高对比）

### 10.5 阶段 3 · W3 —— 模型型接入
1. DSL 的 `footage` 增加第二种实现（模型型），其余 stage 零改动 ← **这是双模式架构的验证点**
2. 提示词管线（H3 官方 schema 主干 + AI-SVWF 积木去商品化）
3. provider 抽象 + 适配器（Seedance / 即梦 / MiniMax / ComfyUI / mock）
4. 护栏全量（窗口限流 60s≤2 / 指纹幂等 / 并发 ≤2 / 不确定性不重提 / 三态计费 / 成本预估）
5. BYOK（内存优先 + 加密存储 + 日志脱敏 + 永不回显）
6. 检查点差异化（付费路径必停 + 二次确认）

### 10.6 阶段 4 · W4 —— 部署与账号
共享口令 + 邀请码鉴权 · `/metrics` + 阈值告警 · 备份与恢复演练 · 对象存储接入（产物直传）

### 10.7 阶段 5 · W5 —— 本地算力
Pull Worker（主动长轮询，不开公网端口）· ComfyUI 接入（LTX/Wan 抽卡）· H3 部署（4bit+ClipProj 或 8bit）· 模型选型拍板

### 10.8 阶段 6 · W6 —— QA 与交付
L1 技术质量（ffprobe / 黑帧 / 静帧 / 音轨）· L2 LLM 评审 + 前 50 条人工校准 · 一致性资产库（角色/场景/风格 + 全局种子）· 剪映草稿导出 · RUNBOOK 文档

### 10.9 拿来主义清单（直接复刻，省最多时间）

| 复刻什么 | 从哪 | 许可 |
|---|---|---|
| TTS（Edge TTS + 落盘） | WebLockShot `server/tts.mjs` | 自有 |
| ffmpeg 渲染（并发互斥 + 忙时 429） | WebLockShot `server/render.mjs` | 自有 |
| **剪映草稿** | 主干：WebLockShot `src/export/jianyingDraft.ts`（TS，语言一致）；补高级效果（转场/花字/气泡）：**pyJianYingDraft**（`GuanYixuan/pyJianYingDraft`，Python，可读其草稿结构）/ JianYingApi | 自有 + **需核实第三方 LICENSE** |
| 视频 provider 实现 | WebLockShot `src/media/providers/*`（jimeng/kling/comfyui…）+ `src/media/auth/jimengAuth.ts`（即梦 AK/SK 签名） | 自有 |
| provider 契约测试 fixtures | WebLockShot `test/fixtures/*` + `src/media/__tests__/providerContract.test.ts` | 自有 |
| 重试/退避/Retry-After | WebLockShot `src/ai/retry.ts` | 自有 |
| 护栏三态 / 状态机 / 任务事件 / QA 规则 | AI-SVWF `core/{database,quota,qa_engine,repair_engine}.py` | 自有（TS 重写 + 对拍测试） |
| SQLite 三级降级 | WebLockShot `server/storage.mjs` | 自有 |
| 提示词积木（20 模块去商品化） | AI-SVWF `core/modules.py` + `core/prompt_builder.py` | 自有 |
| a11y 对比度扫描 | WebLockShot `scripts/a11y-canvas.mjs` | 自有 |
| 素材型配置优先级 / 批量清单 / `--stop-at` 模式 | MoneyPrinterTurbo（学结构，语言不同） | MIT |
| 画布（L3，延后） | **React Flow 官方 examples** | MIT |

### 10.10 开工前已拍板（三项，2026-09-21）

1. ✅ **W1 先不接 LLM**：Day 1–2 用**模板降级**跑通全链路，Day 3 再接 LLM —— 避免被 Key 调不通卡住进度。
2. ✅ **素材源**：**Pexels 为主**（摄影质感）、**Pixabay 备用**。
3. ✅ **W1 直接上星尘视觉**（不做裸表单）→ 因此前端改为**与后端并行开发**：
   - Day 1–2：设计 token 落地（`tokens.css`）+ 前端骨架
   - Day 2–3：展示区星尘（粒子 Canvas + 星芒 + 跑马灯）+ 高对比表单区（先对 mock 数据）
   - Day 5：对接真实 API（一键 + SSE 进度 + 结果卡）
   - 可落地的前提：token 已实测（§7），W1 只做静态与 hover 层，进阶动效顺延 W2

> **开工令**：三项已定，可按 §10.2（Day 0）→ §10.3（W1 按天）直接推进。
