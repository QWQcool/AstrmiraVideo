# NEXT SESSION PROMPT · AstrmiraVideo 接力指针

> 本文件只提供阅读与执行入口，不复制版本、测试数量、完成状态或历史待办。当前状态的唯一权威是 [PLAN §5](docs/PLAN.md#creation-experience-status)。

## 新会话阅读顺序

1. [README](README.md)：项目定位、环境与协作规范。
2. [PLAN Step 11](docs/PLAN.md#creation-experience-plan)：后续分片、代码风险依据、每片 AC、验证与停止条件。
3. [PLAN 当前基线](docs/PLAN.md#creation-experience-status)：已经实现、未验证与下一片；历史“下一步”不覆盖当前基线。
4. [CONTRACT](docs/CONTRACT.md)：类型、接口、存储、任务与幂等语义的唯一权威；改接口先改契约。
5. [创作体验设计基准](docs/CREATION-EXPERIENCE-DESIGN.md)：V1 视觉方向、§8 旧/新实现对照与目标交互规则、节点锚定输入区及观察证据。
6. [PENDING-DECISIONS](docs/PENDING-DECISIONS.md)：仍需用户决定的事项与未执行的清理记录。
7. 按需查 [GUIDE](docs/GUIDE.md)、[FRONTEND-REVIEW](docs/FRONTEND-REVIEW.md)、[N8N-REFERENCE](docs/N8N-REFERENCE.md) 及对应验收记录，不重新维护一份计划。
8. 交接审计从 [证据报告](docs/HANDOFF-AUDIT-2026-10-25.md)、[下一片 AC](docs/PLAN.md#handoff-next-slice) 与 [开放选择](docs/PENDING-DECISIONS.md#handoff-open-decisions) 继续；门禁与真模型核验只看 [PLAN §5](docs/PLAN.md#handoff-audit-status)。
9. UI 开发参照使用 [详情图 HTML](docs/design/creation-v1/development-reference.html) 与 [交互规格](docs/CREATION-EXPERIENCE-DESIGN.md)。图中新增能力及 N9/N10 方案不是实施授权；当前状态只看 [PLAN §5](docs/PLAN.md#ui-development-reference-status)。

## 继续工作

先检查本地状态并同步远端，按 PLAN §5 的“下一片”推进。先读对应 AC，再核对代码与所需环境；静态风险用独立夹具复现，不能直接当作已发生故障。保持 D59–D65 的范围决定；真实云端测试暂停、模型未配置及数据清理边界都以 PLAN / PENDING 为准。

一片完成后将证据和如实余项写回 PLAN，检查相关文档指针并按本次用户授权提交。不要从本文件或旧进度段落推断新的开发、付费调用、部署或删除授权。
