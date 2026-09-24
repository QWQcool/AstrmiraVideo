/**
 * 剪辑台多轨模型 —— **已按 P4 契约迁移提升到 `packages/shared/src/editProject.ts`**
 * （CONTRACT §11-2；前后端共用同一份 schema：服务端用它校验 `POST /api/edits/renders` 上传的工程 JSON）。
 *
 * 这里保留一个转发出口，是为了不动 P1~P3 建立的几十处 `from './model'` 引用；
 * 新代码可以直接从 `@astrmira/shared` 导入。
 */
export * from '@astrmira/shared';
