/**
 * @astrmira/shared — 前后端类型与运行时校验的单一事实源（PLAN §6-D18 / D19）
 *
 * 对应关系（逐节翻译自 docs/CONTRACT.md，CONTRACT 中的 TS 代码块为文档投影）：
 * - request.ts  → §1 任务请求契约
 * - status.ts   → §2 算力状态检测契约
 * - progress.ts → §4 任务进度与统一 Provider 接口、§6 错误码字典
 * - health.ts   → §8 辅助响应类型
 * - enhance.ts  → §3 提示词扩写接口契约
 * - agent.ts    → §23 Agent 计划契约（V2.54）
 * - agentCanvas.ts → §24 只读画布 Agent（V2.55）
 * - verify.ts   → §9 凭据与模型校验接口
 * - videoModels.ts → 视频轨模型档位预设（非契约，但前后端共用一份清单）
 * - editProject.ts → §11-2 剪辑台多轨工程（B34 改版；P4 契约迁移时自前端提升至此）
 * - edit.ts     → §11-3 基础剪辑 EDL（API-only）
 * - projects.ts → §12 项目维度（V2.11 / 台账 B47）
 * - cost.ts     → §13 成本台账口径与预估模型（V2.12 / 台账 B48）
 * - deliverables.ts → §14 交付物命名、平台规格预设与归档清单（V2.13 / 台账 B49）
 * - webhooks.ts → §15 Webhook 终态回调（V2.15 / 台账 B51 片 A）
 */
export * from './request.js';
export * from './status.js';
export * from './progress.js';
export * from './health.js';
export * from './enhance.js';
export * from './api.js';
export * from './verify.js';
export * from './videoModels.js';
export * from './logs.js';
export * from './recipes.js';
export * from './templates.js';
export * from './skills.js';
export * from './agent.js';
export * from './agentCanvas.js';
export * from './historyImport.js';
export * from './storyboard.js';
export * from './creationRun.js';
export * from './editProject.js';
export * from './edit.js';
export * from './projects.js';
export * from './cost.js';
export * from './deliverables.js';
export * from './webhooks.js';
export * from './metrics.js';
export * from './canvasPlan.js';
export * from './canvasDoc.js';
export * from './subject.js';
export * from './stats.js';
export * from './canvasReferenceRules.js';
export * from './modelCapability.js';
// `canvasPlanFile`（编排文件的读/写/校验）**已搬去前端** `frontend/src/lib/canvasPlanFile.ts`
// （语言迁移第十八批）：它的消费者只有前端，而它每一句 `reason` / `migrationNote` 都是**给人看的**
// —— 共享包（纯类型 / 数据层）没法持有界面文案。**共享包 API 变更：这个导出已移除。**
export * from './workerProtocol.js';
