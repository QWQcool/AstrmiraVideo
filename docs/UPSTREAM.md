# 上游复刻台账

> 原则：**借鉴模式不受限；复刻代码必须登记来源、版本与许可证。**
> 复刻前先读对方 `LICENSE`；复刻后在代码注释中标注来源与版本/commit。
> 若缺陷源自上游实现 → 反向提 issue + 最小复现（同时在本表登记链接）。

## 登记表

| # | 上游项目 | 版本 / commit | 许可证 | 复刻范围 | 上游 issue |
|---|---|---|---|---|---|
| 1 | [React Flow](https://github.com/xyflow/xyflow) | TBD | **MIT** | 未来画布视图的节点/连线/MiniMap（优先直接依赖，其次抄 examples） | — |
| 2 | [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) | TBD | **MIT** | 配置优先级模型、批量清单格式、`--stop-at` 检查点思路（**学结构为主**） | — |
| 3 | [rate-limiter-flexible](https://github.com/animir/node-rate-limiter-flexible) | TBD | MIT（待核实） | 滑动窗口限流（直接依赖） | — |
| 4 | [Langfuse](https://github.com/langfuse/langfuse) | TBD | MIT | 提示词版本模型 `name/version/label`（学模型，或自托管） | — |
| 5 | [promptfoo](https://github.com/promptfoo/promptfoo) | TBD | MIT（待核实） | 提示词回归测试的 YAML 断言思路 | — |
| 6 | [pyJianYingDraft](https://github.com/GuanYixuan/pyJianYingDraft) | TBD | **待核实** | 剪映草稿高级效果（转场/花字/气泡）的 `draft_content.json` 结构 | — |
| 7 | [Dify](https://github.com/langgenius/dify) | — | modified Apache-2.0 | **仅阅读实现理解模式，不复制代码、不照搬视觉**（外观专利与前端 LOGO 条款见 `COMPLIANCE.md`） | — |
| 8 | [ComfyUI](https://github.com/comfyanonymous/ComfyUI) | TBD | GPL-3.0（待核实） | **不作为代码来源**，仅通过 HTTP 调用其服务 | — |
| 9 | [MiniMax H3](https://github.com/MiniMax-AI/MiniMax-H3) | TBD | MiniMax H3 社区许可 | 提示词 schema 与官方 `h3-prompt-writing` 指南（作为提示词工程基准） | — |
| 10 | WebLockShot（自有） | TBD | MIT（自有） | TTS 落盘、ffmpeg 渲染并发互斥、剪映草稿主实现、视频 provider 实现与签名、retry 策略、契约 fixtures | — |
| 11 | AI-SVWF（自有） | TBD | 自有 | 计费三态护栏、双闸门、指纹幂等、任务状态机与事件流、QA 规则、提示词积木（TS 重写 + 对拍测试） | — |

## 明确禁止的复刻

| 项目 | 原因 |
|---|---|
| Dify `web/` 前端代码 | 许可证要求保留其 LOGO 与版权信息；且其交互设计受**外观专利**保护 |
| 任何 FSL 许可项目（如 Vidia-Open-Studio） | 限制竞争性使用，2 年后才转 Apache-2.0 |
| 将 ComfyUI 代码内嵌进本仓库分发 | GPL-3.0 传染风险 → 仅作为外部服务调用 |

## 待办

- [ ] 逐项核实「待核实」的许可证（指派：平台/安全负责人）
- [ ] 每项复刻完成后补齐版本/commit 与代码内来源注释
- [ ] 建立「上游引发的缺陷」记录：本仓库 issue ↔ 上游 issue 双向链接
