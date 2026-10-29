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
 *
 * ## 锚点（V2.99 / N9 选项①）
 * 用户拍板：多张参考里**指定一张"定妆图"作为锚点**，后续镜头引用它而不是原始照片。
 * 为什么需要：直接用用户随手拍的照片当参考，模型每次都要重新"猜"这个人的长相；
 * 先用一张图把角色定下来（正面、中性光、纯色背景），后续镜头的**主体一致性**才有稳定输入。
 *
 * 三条口径（与 `subjectId` 旧的"只做溯源"不同，这条是**会参与生成**的）：
 * 1. `anchorAssetId` 可以是普通资产（用户手动指定），也可以是 `task:<taskId>`（生成的定妆图）；
 * 2. 锚点**缺省时**回落主体第一张参考图 —— 但界面必须标出来"未出定妆图"，
 *    因为"用随手照片"和"用定妆图"的效果不一样，不能让人以为用了锚点；
 * 3. 锚点失效（资产被清理 / 任务产物被淘汰）**不静默改回原图**：节点要显示"锚点已失效"。
 */
export const SubjectAnchorSourceSchema = z.enum(['generated', 'manual']);

export const SubjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(SUBJECT_NAME_MAX),
  description: z.string().max(SUBJECT_DESCRIPTION_MAX).optional(),
  assetIds: z.array(z.string().min(1)).max(SUBJECT_MAX_ASSETS).default([]),
  /** 定妆图（锚点）：`assetId` 或 `task:<taskId>`；缺省 = 还没出定妆图 */
  anchorAssetId: z.string().min(1).optional(),
  /** 锚点由哪条任务生成（手动指定时缺省）；用于"重出定妆图"与溯源 */
  anchorTaskId: z.string().min(1).optional(),
  anchorSource: SubjectAnchorSourceSchema.optional(),
  anchorUpdatedAt: z.number().int().nonnegative().optional(),
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
    /**
     * 设/换锚点。**`null` = 清除锚点**（回到"未出定妆图"），不是"没改" ——
     * 与 `description: ''` 同一条口径：字段出现即代表意图。
     */
    anchorAssetId: z.string().min(1).nullable().optional(),
    anchorTaskId: z.string().min(1).nullable().optional(),
    anchorSource: SubjectAnchorSourceSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: '至少给一个要改的字段（name / description / assetIds / anchorAssetId）',
  })
  .refine(
    (value) => value.anchorAssetId !== undefined || value.anchorTaskId === undefined,
    { message: 'anchorTaskId 只能与 anchorAssetId 一起出现（否则不知道该锚到哪张图）' },
  );

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

/**
 * 出定妆图时用的默认提示词（V2.99 / N9）。
 *
 * 为什么写死一句：定妆图的作用是**把角色固定下来**，不是创作一张好看的画。
 * 所以要求正面、中性表情、纯色背景、均匀光 —— 这些条件让"同一张脸"在后续镜头里更容易被复现；
 * 花哨的构图与光线反而会让模型把风格当成主体的一部分。用户仍可在出图前改写它。
 */
export const SUBJECT_ANCHOR_PROMPT =
  '角色定妆照：正面、中性表情、纯色浅灰背景、均匀柔光、写实质感、半身、不出现文字与水印';

/**
 * 主体在生成时**实际用哪张图**（V2.99）。
 *
 * - `anchor` = 有定妆图，用它（这是用户拍板的目标状态）；
 * - `fallback` = 还没出定妆图，回落第一张参考 —— **界面必须标出来**，
 *   因为"用随手照片"和"用定妆图"效果不同，不能让人以为用了锚点；
 * - `null` = 这个主体一张图都没有（还不能进节点）。
 */
export function subjectReferenceOf(
  subject: Subject,
):
  | { assetId: string; kind: 'anchor' | 'fallback' }
  | null {
  if (subject.anchorAssetId !== undefined) {
    return { assetId: subject.anchorAssetId, kind: 'anchor' };
  }
  const first = subject.assetIds[0];
  return first === undefined ? null : { assetId: first, kind: 'fallback' };
}
