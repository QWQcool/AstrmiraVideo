# AstrmiraVideo

> **从一句 brief 到可交付成片 —— 双模式 AI 视频生成工作流水线**
> *From one brief to a deliverable cut — a dual-mode AI video production pipeline.*

[![Status](https://img.shields.io/badge/status-early%20development-orange)](#路线图)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Backend](https://img.shields.io/badge/backend-Node%20%2B%20TypeScript-3178c6)](#技术栈)
[![Frontend](https://img.shields.io/badge/frontend-React%2019%20%2B%20Vite-61dafb)](#技术栈)

> ⚠️ **项目处于早期开发阶段**，接口与数据结构尚未稳定。路线图见 [docs/PLAN.md](docs/PLAN.md)。

---

## 这是什么

AstrmiraVideo 是一个**面向创作团队**的 AI 视频生成工作台：用户给出几句话的 brief 和参考图，系统自动完成**脚本 → 画面 → 配音 → 字幕 → 合成 → 交付**的全链路，并支持在任意环节介入修改。

它不追求「一键出片」的黑盒，而是把流水线的每一步都**可见、可改、可重跑**。

## 两种模式：为什么这么设计

AI 视频生成有两条成本结构完全不同的路径。我们没有二选一，而是让它们**共用同一个中台**：

```
公共中台（两条线完全共用 ≈80%）
  brief → 脚本(LLM) → 分镜切分 → ┃画面获取┃ → 音频 → 字幕 → 合成 → 交付
                                    ↑ 唯一差异点
  ① 素材模式（低成本）    关键词 → 免版权素材库检索 → 下载片段
                          免费 · 秒级 · 确定性高 · 可全自动
  ② 模型模式（高质量）    提示词编译 → AI 视频生成 → 下载片段
                          按量计费 · 分钟级 · 需人工检查点
```

**这意味着**：接入一个新的视频生成供应商，只需要替换「画面获取」这一个节点的实现，其余部分零改动。

| 模式 | 成本量级 | 是否需要 GPU | 适用 |
|---|---|---|---|
| 素材模式 | ≈ ¥0 | 否（服务器即可） | 快速验证、批量出片、低成本内容 |
| 模型模式 · 云端 API | ¥15–75 / 15 秒 720P | 否 | 正式交付 |
| 模型模式 · 本地算力 | ¥0（电费） | 是（≥10GB 显存） | 免费抽卡迭代 |

## 架构

```
┌──────────────────────── 前端 · 表单式工作台 ─────────────────────────┐
│  一键创作 · 纵向步骤流卡片（每步可见可改可重跑）· 结果画廊 · 检查点   │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ REST + SSE
┌───────────────────────────────┴──── 后端 · Node + TypeScript ───────┐
│  guard     窗口限流 · 指纹幂等 · 并发上限 · 三态计费 · 成本预估       │
│  prompt    提示词管线（理解 → 编译 → 按供应商适配）+ 版本化           │
│  pipeline  持久化队列 · worker · 轮询退避 · 断点恢复 · 状态机        │
│  providers 统一契约：[素材库 | Seedance | 即梦 | MiniMax | ComfyUI]  │
│  llm       OpenAI 兼容 / Responses 双风格 · 多 profile               │
│  qa        技术质量（抽帧/黑帧/静音）+ LLM 评审 + 人工校准            │
│  media     下载归档 · 去音轨 · 拼接 · 字幕 · TTS · 剪映草稿导出       │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
        ┌───────────────────────┴────────────────────────┐
        │ 云端：编排服务器（无 GPU）+ 对象存储              │
        │ 本地：Pull 模式 Worker（主动拉任务，不开公网端口）│
        └────────────────────────────────────────────────┘
```

## 路线图

| 阶段 | 目标 | 状态 |
|---|---|---|
| **W1** | 素材模式全链路打通：一句话 → 可播放 MP4（成本 ≈¥0）+ 工作台界面 | 🚧 即将开始 |
| **W2** | 步骤流卡片 · 检查点机制 · 断点恢复 · 素材智能选材 | ⏳ |
| **W3** | 模型模式接入（多供应商）+ 护栏 · 用户自带 Key（BYOK） | ⏳ |
| **W4** | 部署与鉴权 · 监控告警 | ⏳ |
| **W5** | 本地算力（Pull Worker + ComfyUI / 开源视频模型） | ⏳ |
| **W6** | QA 两级评分 · 一致性资产库 · 剪映草稿导出 | ⏳ |

完整规划（含排期、分工、成本、合规）见 **[docs/PLAN.md](docs/PLAN.md)**。

## 核心设计原则

1. **竖切优先** —— 先用最粗糙的实现把「一句话 → 成片」打通，再逐层加固。
2. **诚实标注** —— 无 Key、失败、未实现功能一律显式报错与标注，**绝不静默降级或返回占位产物**。
3. **检查点按成本区分** —— 免费路径自动通过；一旦触发付费调用，**必须停下确认**。
4. **护栏在服务端** —— 限流、幂等、并发、计费风险判定全部落在服务端，客户端不可绕过。
5. **契约先行** —— 先冻结数据契约与状态机，再写实现；改动走评审。
6. **复刻可追溯** —— 参考或复刻开源实现时登记来源与许可证（[docs/UPSTREAM.md](docs/UPSTREAM.md)）。

## 技术栈

- **后端**：Node.js 22 · TypeScript · Fastify · zod · better-sqlite3 · pino
- **前端**：React 19 · Vite · TypeScript
- **媒体**：FFmpeg（拼接/抽帧/探测）· Edge TTS（免 Key）· 剪映草稿导出
- **存储**：SQLite（任务事实库）+ 对象存储（产物）
- **部署**：Docker Compose · Caddy（自动 TLS）

## 快速开始

> 🚧 尚未可运行 —— 第一版（W1）完成后这里会补上完整的本地启动步骤。

```bash
# 计划中的形态（暂不可用）
git clone https://github.com/QWQcool/AstrmiraVideo.git
cd AstrmiraVideo
pnpm install
pnpm dev
```

## 文档

| 文档 | 内容 |
|---|---|
| [docs/PLAN.md](docs/PLAN.md) | 立项计划书：架构、排期、实现点、成本、合规 |
| [docs/CONTRACT.md](docs/CONTRACT.md) | 数据契约与状态机（待冻结） |
| [docs/UPSTREAM.md](docs/UPSTREAM.md) | 上游复刻台账（来源 / 版本 / 许可证） |
| [docs/COMPLIANCE.md](docs/COMPLIANCE.md) | 合规台账（模型许可、标注义务） |

## 设计参考与致谢

本项目的架构与交互借鉴了以下优秀开源项目（**仅借鉴模式；代码复刻情况逐项登记于 `docs/UPSTREAM.md`**）：

- [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo)（MIT）—— 一句话自动流水线的产品形态与配置优先级设计
- [InvokeAI](https://github.com/invoke-ai/InvokeAI) —— 创作工作台布局范式
- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) —— 生成引擎层（通过 HTTP 调用）
- [React Flow](https://reactflow.dev/)（MIT）—— 未来的可视化编排视图
- [Dify](https://github.com/langgenius/dify) / [n8n](https://github.com/n8n-io/n8n) —— 「节点即表单」的交互范式参考（**不复制其前端代码**）

视觉语言参考 [Astrmira（幻梦星芒）](https://www.astrmira.com/) 的公开设计规范。**本项目与该站点无隶属或合作关系**，仅在设计语言上致敬。

## 许可

[MIT](LICENSE)

> 注意：本项目调用的第三方模型与素材库有各自的许可条款（例如部分开源视频模型对使用地区与商业收入有要求），使用前请阅读 [docs/COMPLIANCE.md](docs/COMPLIANCE.md)。
