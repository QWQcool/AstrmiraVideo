# 前端参考图库（docs/assets）

> 用途：**上手指南用图** + 少量历史参考图。这里的图**不是设计稿的唯一真相** ——
> 交互规格在 [CREATION-EXPERIENCE-DESIGN.md](../CREATION-EXPERIENCE-DESIGN.md)，
> 差距审计在 [JIMENG-REFERENCE.md](../JIMENG-REFERENCE.md)。
> 口径：截图是**证据**，不修图、不摆拍 —— 界面什么样就截什么样。

## ⭐ 上手指南用图（`howto/`，V2.112 起）

> 生成方式：`pnpm build && pnpm docs:shots`（= `tests/browser/howto-shots.mjs`，隔离实例 + 夹具数据 + 真浏览器）。
> **改了界面就重跑这个脚本，不要手截** —— 过期截图会教人点一个不存在的按钮。

| 文件 | 内容 |
|---|---|
| `howto/01_create.png` | 创作入口 `#/create`（一句话 + `@` 素材 + 参数条） |
| `howto/02_canvas.png` | 画布 `#/canvas`（三个节点 + 顶栏「⚠ N 项待核对」徽章） |
| `howto/03_edit_timeline.png` | 剪辑台 `#/edit`（多轨时间轴 + 右侧「③ 声音」面板） |
| `howto/04_audio_panel.png` | 声音面板整块（模式 / 台词 / 音色 / 情绪 / 隐私与许可） |

## 引擎与工作流示意（GUIDE §一 / §三 用图）

| 文件 | 内容 |
|---|---|
| `02_hardware_and_engine_modal.jpg` | 硬件/引擎配置弹层（档位建议的界面投影） |
| `03_prompt_and_video_workflow.jpg` | 提示词扩写 + 32 倍数裁切的工作流示意 |

> ⚠️ 这两张是 **2026-09 的概念稿**（界面英文、且画了本项目不存在的上游名）。
> 它们只用来示意"能力位在哪里看、工作流长什么样"，**不代表当前界面**。
> 当前界面的真实样子看上面的 `howto/`。

## 真实界面截图（`ui/`，2026-10-10，历史记录）

> 生成方式：`node scripts/capture-docs-shots.mjs`（生产形态 + 夹具数据 + 真浏览器，**任何人可复现**）。
> ⚠️ 这批图停在 2026-10-10：之后界面改过多轮（侧栏九项、画布、声音面板都不在里面）。
> **它们不再更新**，保留只为追溯当时的形态。要看现状请用 `howto/`。

| 文件 | 内容（当时的形态） |
|---|---|
| `ui/desktop-01-create.png` | 创作入口 `#/create` |
| `ui/desktop-02-workbench.png` | 专业工作台 `#/workbench` |
| `ui/desktop-03-overview.png` | 总览 `#/overview` |
| `ui/desktop-04-library.png` | 视频库 `#/library` |
| `ui/desktop-05-edit.png` | 剪辑台 `#/edit?task=…` |
| `ui/desktop-06-canvas.png` | 血缘画布（旧只读形态） |
| `ui/desktop-07-logs.png` | 操作日志 `#/logs` |
| `ui/mobile-0{1,2,3}-*.png` | 手机 390×844：创作 / 工作台 / 视频库（**浏览可用、剪辑不可用**） |

## 实验与评测图（不进文档正文，只作证据）

| 目录 | 内容 |
|---|---|
| `moss-image-eval/` | MOSS 文生图的对照（含中文海报的错字样本） |
| `multiref-2026-10-27/` | 多参考（r2v）那次压力测试的产物组 |

## 已删除：11 张概念稿（2026-11-02 瘦身，约 4.6MB）

删的是**只在图库索引里登记、正文一处都没引用**的历史概念稿。删掉不心疼的理由：
它们的用途是"当时布局该怎么摆"，而那些决定已经落进文档正文了。

| 删除 | 原用途 | 决定现在记在哪 |
|---|---|---|
| `01_main_workspace.jpg` | 主工作台三栏概念稿 | [CREATION-EXPERIENCE-DESIGN.md](../CREATION-EXPERIENCE-DESIGN.md) §3 页面与视觉规范 |
| `04~06_mockup_*.jpg` | V9 改版的三个方案（总览 / 工作台 / 视频库） | 已实现的形态以 `howto/` 实截为准 |
| `07_ref_kling_shell.jpg` | 可灵外壳（图标栏信息密度） | [JIMENG-REFERENCE.md](../JIMENG-REFERENCE.md) |
| `08_ref_jimeng_hero.jpg` / `09_ref_jimeng_sample_mode.jpg` | 即梦首页与"样片模式" | 同上（观察结论都写成了文字） |
| `10_ref_shadcn_sidebar.jpg` | 可收展侧栏的成熟变体 | [CREATION-EXPERIENCE-DESIGN.md](../CREATION-EXPERIENCE-DESIGN.md) §4 交互规则 |
| `11~13_mockup_create_*.png` | Step 8「造梦盒」概念稿（首屏 / `@` 弹层 / 提交后） | 该入口已上线，实截在 `howto/01_create.png` |

> 这条纪律与"一个知识点只有一个所有者"一致：**文档正文写决定，图只负责证明界面长什么样**。
> 概念稿一旦被实现，它的价值就转移到了实现与实截上。
