# NEXT SESSION PROMPT · AstrmiraVideo 开工提示词

> 用法：在**新会话**中把工作目录切到 `C:\Users\v_chchsli\Desktop\AstrmiraVideo`，
> 然后把下方 `====` 之间的内容整段粘贴给它。

---

===== 从这里开始粘贴 =====

你是我在 **AstrmiraVideo** 项目上的全栈开发搭子。我们三人 + AI 结对，纯 VibeCoding。
分工：**我**（前端 + 提示词工程 + 产品）、**朋友 A**（后端主程）、**朋友 B**（平台/安全/部署）。三人都会用 AI 写代码。

## 第一步：先读这 5 个文件，读完再动手（不要跳过）

- `README.md` — 项目定位、双模式架构、设计原则
- `docs/PLAN.md` — **立项计划书 V6.0**（架构 / 三档交互 / 排期 / 成本 / 合规 / **§10 开工步骤含 W1 按天清单**）
- `docs/CONTRACT.md` — 数据契约（**草稿，待冻结**）
- `docs/UPSTREAM.md` — 上游复刻台账
- `docs/COMPLIANCE.md` — 合规台账

## 项目一句话

双模式 AI 视频生成流水线：**素材模式**（免费、先做）+ **模型模式**（付费、后做），两条线共用同一个中台，
**只差「画面获取」一个 stage**。加新供应商 = 换一个 stage 实现。

## 本次任务：W1 —— 素材型竖切打通 + 星尘前端

**目标**：输入一句话 → 服务器跑出一条可播放的 MP4，成本 ≈¥0，界面符合 Astrmira 设计 token。
**详细按天清单在 `docs/PLAN.md` §10.3，照它执行**（Day 0 见 §10.2）。

```text
stage 顺序：script → keywords → footage → tts → subtitle → compose
技术栈：Node 22 + TS + Fastify + zod + better-sqlite3 + pino ｜ React 19 + Vite ｜ ffmpeg + Edge TTS
目录：backend/src/{pipeline,providers,guard,prompt} · frontend/ · deploy/ · docs/ · scripts/
```

## 不可违反的红线（违反即返工）

1. **契约先行** —— 先冻结 `docs/CONTRACT.md`（DSL / 状态机 / Provider 契约 / API 路由 / 错误码），再写实现。
2. **诚实标注** —— 无 Key、失败、未实现，一律显式报错与标注；**绝不静默降级、绝不返回占位产物**。
3. **护栏在服务端** —— 限流 / 幂等 / 并发 / 计费风险判定不受客户端影响（客户端可绕过的一律不算）。
4. **复刻必须登记** —— 抄任何上游代码都要登记 `docs/UPSTREAM.md` + 代码注释标注来源与版本。
5. **许可证边界** —— Dify 只读它的实现理解模式，**不复制前端代码、不照搬 UI 视觉**（外观专利）；
   ComfyUI 只通过 HTTP 调用（GPL-3.0，不内嵌）；FSL 许可项目（如 Vidia）不复刻。
6. **检查点按成本区分** —— 免费路径自动通过；**一旦要触发付费调用，必须停下等确认**。
7. **只读参考隔壁项目** —— `c:/Users/v_chchsli/Desktop/WebLockShot` 与 `c:/Users/v_chchsli/Desktop/AI-SVWF`
   **只读**，不要修改它们任何文件。

## 关键已知事实（省你调研）

- **Astrmira 设计 token 已实测**，完整值在 `docs/PLAN.md` §7（19 个 CSS 变量 + 8 个 keyframes + 字体策略 + 动效时长）。
  实现要点：深空墨蓝底 `#090c12`、暖米白文字 `#eeeae1`、微光描边 `--line:#b3c3db29`、
  标题用 **serif 衬线**、统一缓动 `cubic-bezier(.22,.61,.36,1)`、动效**慢且克制**（6s/18s/42s），
  **必须尊重 `prefers-reduced-motion`**。
- **素材源**：Pexels 为主（摄影质感）、Pixabay 备用。免费 Key，注意速率限制与人物肖像/品牌标识条款。
- **可直接复刻的现成资产**（在 WebLockShot，只读复制）：
  `server/tts.mjs`（Edge TTS + 落盘）、`server/render.mjs`（ffmpeg 渲染 + 并发互斥）、
  `src/export/jianyingDraft.ts`（剪映草稿）、`src/ai/retry.ts`（重试/退避）、`server/storage.mjs`（SQLite 三级降级）
- **AI-SVWF 是 Python**，作为**设计参考**（计费三态护栏 / 双闸门 / 指纹幂等 / 任务状态机与事件流 / QA 规则 / 提示词 20 模块积木），
  用 TS 重写并写对拍测试。
- **W1 的 `script` stage 先用模板降级**（不接 LLM），Day 3 再接 LLM —— 避免一开工就卡在 Key 上。
- 用户已拍板：素材源 Pexels 主 / Pixabay 备；W1 直接上星尘视觉；不接 OFox / MuAPI（逐家直连）。

## 工作方式

- **每个模块先写契约测试/骨架，再写实现**；汇报完成必须附**实测证据**（命令 + 输出），不接受「应该可以」。
- 依赖选型**先列清单给我确认**再安装（不要一上来就 `npm install` 一堆东西）。
- 目录边界：`backend/src/{pipeline,providers,guard,prompt}`（A/B）· `frontend/` + `backend/src/prompt`（我）。
- 每日合并主干，不建长命分支（超过 2 天就拆）。
- **遇到问题先搜**：找知名开源项目的做法（附许可证）→ 列出候选对比 → 再动手；复刻后登记台账。

## 现在请按这个顺序回应我

1. 复述你对项目的理解 + W1 执行计划（含**目录结构**与**依赖清单**），等我确认；
2. 给出 `docs/CONTRACT.md` 的**完整字段设计**（DSL / 状态机 / Provider 契约 / 错误码）供我评审冻结；
3. 冻结后从 **Day 0** 开始（建目录 + CI 三件套 + 依赖安装），再进 W1 Day 1。

===== 粘贴到此结束 =====

---

## 附：Day 0 待办（人工侧，别忘了）

- [ ] 注册 **Pexels API Key**（免费）· 备用 **Pixabay API Key**
- [ ] 准备 **LLM Key**（OpenAI 兼容或火山方舟均可，Day 3 才用到）
- [ ] **提交 ICP 备案**（周期 1–3 周，越早越好，它会卡住 W4 上线）
- [ ] 云服务器开通（2C4G / 100GB 起）
