/**
 * @astrmira/shared — 前后端类型与运行时校验的单一事实源（PLAN §6-D18 / D19）
 *
 * 对应关系（逐节翻译自 docs/CONTRACT.md，CONTRACT 中的 TS 代码块为文档投影）：
 * - request.ts  → §1 任务请求契约
 * - status.ts   → §2 算力状态检测契约
 * - progress.ts → §4 任务进度与统一 Provider 接口、§6 错误码字典
 * - health.ts   → §8 辅助响应类型
 * - enhance.ts  → §3 提示词扩写接口契约
 */
export * from './request.js';
export * from './status.js';
export * from './progress.js';
export * from './health.js';
export * from './enhance.js';
export * from './api.js';
