import { z } from 'zod';

/**
 * 轻剪辑台的编辑决策清单（CONTRACT §11-2；V9 · B9）。
 *
 * 定位（PLAN §6-D37）：**时间轴上的确定性操作**，对**已有成片**执行，产物是一条新任务。
 * **全程零上游调用**——它跑的是本地 ffmpeg，不花钱、不占冷却；这也是它能随手试的原因。
 *
 * 三条形状约定：
 * 1. 操作是**判别联合**（`type` 字段），因此"给 trim 传 gain"这类错误在**契约层**就被拒；
 * 2. 顺序即语义：按数组顺序依次施加（trim → concat → xfade → …）；
 * 3. 数量上限 8（`EditScriptSchema`）——够表达"剪一下、拼一段、加个转场"，又不至于变成剪辑软件。
 */

export const EditTransitionSchema = z.enum(['fade', 'wipeleft', 'slideright']);
export type EditTransition = z.infer<typeof EditTransitionSchema>;

export const EditOperationSchema = z.discriminatedUnion('type', [
  /** 裁剪区间（秒）；`endSec` 必须大于 `startSec`（路由层会给出 400，而不是让 ffmpeg 报错） */
  z.object({ type: z.literal('trim'), startSec: z.number().min(0), endSec: z.number().min(0) }),
  /**
   * 把 `taskIds` 里的成片**依次拼到当前时间轴之后**（每个 id 都是"要并入的片段"，
   * **不含**当前时间轴自身 —— 源片由 `EditScript.sourceTaskId` 给出）。
   *
   * ⚠️ 口径在 B9 实现时收紧过一次：V2.2 的规划写的是 `min(2)`，那会让"把源片与另一条拼接"
   * 这件事无法表达（源片不在这个数组里）。现在 `min(1)`：至少要有一段可拼。
   */
  z.object({ type: z.literal('concat'), taskIds: z.array(z.string()).min(1) }),
  /** 转场（作用在相邻两段之间） */
  z.object({
    type: z.literal('xfade'),
    transition: EditTransitionSchema,
    durationSec: z.number().min(0.1).max(2),
  }),
  /** 音量（0 = 静音） */
  z.object({ type: z.literal('volume'), gain: z.number().min(0).max(2) }),
  /** 变速（音频随之用 atempo 对齐） */
  z.object({ type: z.literal('speed'), factor: z.number().min(0.25).max(4) }),
  /** 抽帧 → 落为参考资产（D38 闭环：可直接拿去做下一次 I2V / FL2V 的首帧或尾帧） */
  z.object({ type: z.literal('extractFrame'), atSec: z.number().min(0) }),
]);

export type EditOperation = z.infer<typeof EditOperationSchema>;

export const MAX_EDIT_OPERATIONS = 8;

export const EditScriptSchema = z.object({
  /** 源成片（必须 `succeeded` 且有成片文件） */
  sourceTaskId: z.string(),
  /** 按序执行，1..8 条 */
  operations: z.array(EditOperationSchema).min(1).max(MAX_EDIT_OPERATIONS),
});

export type EditScript = z.infer<typeof EditScriptSchema>;

/**
 * 操作类型 → **显示名**：已搬去前端字典（语言迁移第十六批 · 跨包决策）。
 *
 * 原先这里有一张中文表（`EDIT_OPERATION_LABELS`）。搬走的判据是**"这句话给谁看"**：
 * 这些名字**只有前端在用**（后端只存 `operation.type` 的 id，中文从没进过库），
 * 而中文表**没法双语** —— 英文界面下它们只能显示中文。
 *
 * 现在：文案在前端 `dict/edit.ts`（`edit.op.*`）；**键表**在前端 `edit/model.ts`
 * （`Record<EditOperation['type'], MessageKey>`）—— 那个 `Record` 的类型带来一条
 * 编译期保证：**将来这里新增一个操作类型、前端忘了加键，会直接编译不过**。
 * 共享包这边只留 id（`EditOperation['type']` 本身）。
 */
