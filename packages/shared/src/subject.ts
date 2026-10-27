import { z } from 'zod';

/**
 * 主体库（CONTRACT §21-18 / V2.86 / D-3）。
 *
 * ## 它是什么
 * "同一个人 / 同一件商品"在多张画布之间复用的**可命名实体**。它自己**不生成任何东西** ——
 * 进节点时压成一条普通参考（`assetId + role + order`）再附一个 `subjectId` 做溯源。
 *
 * ## 三条口径
 * 1. **跨画布**：不属于任何画布；删画布不删主体，删主体不删资产；
 * 2. **只是溯源**：`subjectId` 不参与生成参数、不被 provider 读取、不影响校验通过与否 ——
 *    主体的"一致性"是模型能力，契约能保证的只有"这条参考从哪来"；
 * 3. **数量有界**：单主体参考素材 ≤ 9（与画布多参考的舒适档一致；不是模型事实，见契约 §21-18-E）。
 */

/** 单个主体最多挂几张参考素材（结构上限；真实可用性仍由模型/实例决定） */
export const SUBJECT_MAX_ASSETS = 9;
/** 主体库条数上限（超过就不是"库"而是"素材堆"了，且单文件 JSON 要能整份读） */
export const SUBJECT_MAX_COUNT = 500;
export const SUBJECT_NAME_MAX = 60;
export const SUBJECT_DESCRIPTION_MAX = 500;

/**
 * 一个主体。
 *
 * `assetIds` **允许为空**：允许"先建个名字，稍后再挑图"（否则用户得先去资产库挑图才能开始命名）。
 * 空素材的主体**不能加进节点**（界面拦），但列表里正常存在 —— 这是编辑态，不是错误态。
 */
export const SubjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(SUBJECT_NAME_MAX),
  description: z.string().max(SUBJECT_DESCRIPTION_MAX).optional(),
  assetIds: z.array(z.string().min(1)).max(SUBJECT_MAX_ASSETS).default([]),
  createdAt: z.number().int().nonnegative(),
});

export const SubjectCreateSchema = z.object({
  name: z.string().trim().min(1).max(SUBJECT_NAME_MAX),
  description: z.string().trim().max(SUBJECT_DESCRIPTION_MAX).optional(),
  assetIds: z.array(z.string().min(1)).max(SUBJECT_MAX_ASSETS).default([]),
});

/**
 * 改主体。**至少给一项**（空 body 是"点错了"，不是"什么都不改"）。
 *
 * `description: ''` 与 `assetIds: []` 都是**有意义的清空**：前者清描述，后者清素材。
 * 所以这里用"字段存在与否"判断，不能靠"值非空"。
 */
export const SubjectPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(SUBJECT_NAME_MAX).optional(),
    description: z.string().trim().max(SUBJECT_DESCRIPTION_MAX).optional(),
    assetIds: z.array(z.string().min(1)).max(SUBJECT_MAX_ASSETS).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: '至少给一个要改的字段（name / description / assetIds）',
  });

export const SubjectListResponseSchema = z.object({
  subjects: z.array(SubjectSchema),
});

export const SubjectResponseSchema = z.object({
  subject: SubjectSchema,
});

export const DeleteSubjectResponseSchema = z.object({
  deleted: z.boolean(),
  subjectId: z.string(),
});

export type Subject = z.infer<typeof SubjectSchema>;
/** `z.input`：`assetIds` 有默认值，调用方可以省略它（infer 会把它算成必填） */
export type SubjectCreateInput = z.input<typeof SubjectCreateSchema>;
export type SubjectPatchInput = z.input<typeof SubjectPatchSchema>;
export type SubjectListResponse = z.infer<typeof SubjectListResponseSchema>;
export type SubjectResponse = z.infer<typeof SubjectResponseSchema>;
export type DeleteSubjectResponse = z.infer<typeof DeleteSubjectResponseSchema>;
