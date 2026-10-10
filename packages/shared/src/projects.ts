import { z } from 'zod';

/**
 * 项目维度（CONTRACT §12；台账 B47，D42 收窄后的形态）。
 *
 * ## 为什么是"项目"而不是"租户"
 * 交付形态 = **一家客户一套私有部署**（PLAN §6-D42）：没有跨租户隔离，也没有 tenant_id。
 * 需要隔离的单位是**一个客户内部的多条片子/产品线** —— 那就是项目。
 *
 * ## 三条口径
 * 1. **默认项目永远存在**（`DEFAULT_PROJECT_ID = 'default'`）：老数据的归属、以及
 *    "调用方没传 projectId"时的落点。因此**老客户端与老测试的行为完全不变**（零迁移成本）；
 * 2. **缺失 = 默认项目**：任务表 `project_id` 为 NULL（V2.11 之前建的行）与资产 sidecar
 *    没有 `projectId`（V2.11 之前上传的）都按默认项目算 —— 这是**如实**的归属，
 *    不是"猜一个"；
 * 3. **角色（管理员/创作者/查看者）不在本版**：用户 2026-10-10 明确"先不做"。
 *    没有用户身份系统就做角色只是假门禁（违反"不假装可用"），故登记为独立待办。
 */

/**
 * 项目 id 的允许形状（**只用于校验与显示，不参与任何路径构造**）。
 * 默认项目用固定字面量 `default`，用户新建的项目用 UUID —— 两者都落在本表达式内。
 */
export const ProjectIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

export const DEFAULT_PROJECT_ID = 'default';

/** 项目名上限（够写"2026 双十一 · 主推片"这种量级，又不至于撑爆侧栏） */
export const PROJECT_NAME_MAX_CHARS = 60;

export const ProjectNameSchema = z.string().trim().min(1).max(PROJECT_NAME_MAX_CHARS);

/**
 * `GET /api/projects` 的条目（CONTRACT §5 / §12）。
 *
 * 带**用量**（`taskCount` / `assetCount`）是刻意的：B 端要能回答"这个项目占了多少"，
 * 否则"项目级配额"无从谈起。计的是**任务条数**与**资产个数**（不是字节 —— 字节口径
 * 要等 B48 成本台账统一，避免两处各算一套）。
 */
export const ProjectEntrySchema = z.object({
  projectId: z.string(),
  name: z.string(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  /** 默认项目（不可删除）—— 界面据此禁用删除按钮而不是"点了才报错" */
  isDefault: z.boolean(),
  taskCount: z.number().int().nonnegative(),
  assetCount: z.number().int().nonnegative(),
});

/** `GET /api/projects` 的 200 响应（默认项目永远在列表里，且排在最前） */
export const ProjectListResponseSchema = z.object({
  projects: z.array(ProjectEntrySchema),
});

/** `POST /api/projects`、`PATCH /api/projects/:projectId` 的 200 响应 */
export const ProjectResponseSchema = z.object({
  project: ProjectEntrySchema,
});

/** `POST /api/projects` 的请求体 */
export const CreateProjectRequestSchema = z.object({
  name: ProjectNameSchema,
});

/** `PATCH /api/projects/:projectId` 的请求体（当前只支持改名） */
export const UpdateProjectRequestSchema = CreateProjectRequestSchema;

/** `DELETE /api/projects/:projectId` 的 200 响应 */
export const DeleteProjectResponseSchema = z.object({
  deleted: z.boolean(),
  projectId: z.string(),
});

export type ProjectEntry = z.infer<typeof ProjectEntrySchema>;
export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;
export type ProjectResponse = z.infer<typeof ProjectResponseSchema>;
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequestSchema>;
export type DeleteProjectResponse = z.infer<typeof DeleteProjectResponseSchema>;

/** 把"缺省"统一收敛成默认项目 id（服务端与前端共用同一处判断） */
export function normalizeProjectId(raw: string | undefined | null): string {
  if (raw === undefined || raw === null) return DEFAULT_PROJECT_ID;
  const trimmed = raw.trim();
  return trimmed === '' ? DEFAULT_PROJECT_ID : trimmed;
}

/** 给定项目是否可删除（默认项目不可；用量非零不可 —— 前端用它禁用按钮，服务端仍会再判一次） */
export function projectIsDeletable(project: { isDefault: boolean; taskCount: number; assetCount: number }): boolean {
  return !project.isDefault && project.taskCount === 0 && project.assetCount === 0;
}
