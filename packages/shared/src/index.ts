/**
 * @astrmira/shared — 前后端类型与运行时校验的单一事实源（PLAN §6-D18 / D19）
 *
 * 对应关系（逐节翻译自 docs/CONTRACT.md，CONTRACT 中的 TS 代码块为文档投影）：
 * - request.ts  → §1 任务请求契约
 * - status.ts   → §2 算力状态检测契约
 * - progress.ts → §4 任务进度与统一 Provider 接口、§6 错误码字典
 * - health.ts   → §8 辅助响应类型
 * - enhance.ts  → §3 提示词扩写接口契约
 * - verify.ts   → §9 凭据与模型校验接口
 * - videoModels.ts → 视频轨模型档位预设（非契约，但前后端共用一份清单）
 * - editProject.ts → §11-2 剪辑台多轨工程（B34 改版；P4 契约迁移时自前端提升至此）
 * - edit.ts     → §11-3 基础剪辑 EDL（API-only）
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
export * from './editProject.js';
export * from './edit.js';
