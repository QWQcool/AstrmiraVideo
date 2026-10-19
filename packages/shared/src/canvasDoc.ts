import { z } from 'zod';
import { AspectRatioSchema, DurationSecSchema, GenerationModeSchema } from './request.js';

/**
 * 创作画布文档 `astrmira.canvas-doc/v1`（CONTRACT §21 / 台账 B78 / 决策 D60-D62）。
 *
 * ## 它与 `CanvasPlan`（§11-6）是什么关系
 * `CanvasPlan` 是"可执行编排"：节点只有 prompt/参数/坐标，执行时按依赖顺序提交。
 * `CanvasDoc` 是**编辑器文档**：节点是媒体（文本/图片/视频/音频）+ 内联草稿 + 产物批次，
 * 布局与视口一起持久化。执行仍然走既有 `POST /api/generate`，本契约**不新增路由**。
 *
 * ## 三条口径
 * 1. **单用户、无归属字段**（D60）：没有 `ownerId` / `tenantId`；一份文档属于这个部署实例。
 * 2. **不迁移旧数据**（D63）：`CanvasPlan` 与旧事实图**不转换**；`version` 只用于本契约自身的演进。
 * 3. **产物以 `assetId` 为准**（与 §7 资产契约一致）：`url` 只做展示，刷新后按 assetId 重新取；
 *    批次（`batches`）承担"这个节点生成过几轮、每轮出了什么"。
 */

/** 文档格式版本。加字段不改它；只有"旧文档读不进新代码"时才 +1 并写迁移。 */
export const CANVAS_DOC_VERSION = 1;

/** 首发节点类型（时间线/主体/导演台/文档节点明确不做，见 PLAN Step 11「明确不做」） */
export const CanvasNodeTypeSchema = z.enum(['text', 'image', 'video', 'audio']);

/** 参考素材的用途。与"参考模式"是两个维度：模式决定能不能用，用途决定喂到哪。 */
export const CanvasReferenceRoleSchema = z.enum([
  'first-frame',
  'last-frame',
  'reference-image',
  'reference-video',
  'reference-audio',
]);

/** 参考模式（互斥语义，实测自即梦；`none` = 纯文生） */
export const CanvasReferenceModeSchema = z.enum(['none', 'first-last-frame', 'omni-reference']);

/** 边的语义：`lineage` = 已发生的来源关系，`dependency` = 待执行的依赖关系。两者不能互相改写。 */
export const CanvasEdgeKindSchema = z.enum(['lineage', 'dependency']);

/** 节点内容来源：用于区分"模型生成的"与"我上传/从资产库挑的" */
export const CanvasNodeSourceSchema = z.enum(['model_generated', 'uploaded', 'from_asset']);

export const CanvasNodeCreatedFromSchema = z.enum([
  'menu',
  'double_click',
  'toolbar',
  'skill',
  'import',
]);

/** 生成参数。全部可选：空节点（还没配）必须能存盘，否则"边写边存"不成立。 */
export const CanvasNodeSettingsSchema = z.object({
  /** 能力目录里的模型标识（不是展示名） */
  modelId: z.string().min(1).optional(),
  /** 生成模式；缺省由节点类型推断（video → t2v，image → t2i） */
  mode: GenerationModeSchema.optional(),
  referenceMode: CanvasReferenceModeSchema.optional(),
  aspectRatio: AspectRatioSchema.optional(),
  resolution: z
    .object({ width: z.number().int().positive(), height: z.number().int().positive() })
    .optional(),
  durationSec: DurationSecSchema.optional(),
  /** 一次生成几张/几条；上限按能力目录，这里只做结构上限 */
  count: z.number().int().min(1).max(8).optional(),
});

export const CanvasReferenceSchema = z.object({
  /** 资产 id（§7）；不存 URL —— 临时链接会过期 */
  assetId: z.string().min(1),
  role: CanvasReferenceRoleSchema,
  /** 同一用途内的顺序（首帧/尾帧只有一个，多图参考按此排序） */
  order: z.number().int().min(0).max(64),
});

export const CanvasNodeDraftSchema = z.object({
  kind: CanvasNodeTypeSchema,
  /** 纯文本提示词。行内 `@` 引用将来如果需要富文本，另加 `parts`，不改这里 */
  prompt: z.string(),
  settings: CanvasNodeSettingsSchema,
  references: z.array(CanvasReferenceSchema),
  updatedAt: z.number().optional(),
});

export const CanvasOutputSchema = z.object({
  assetId: z.string().min(1),
  kind: z.enum(['image', 'video', 'audio', 'text']),
  /** 只做展示；刷新后按 assetId 重新取 */
  url: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSec: z.number().positive().optional(),
});

export const CanvasBatchStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

/** 一轮生成 = 一个批次。批次不合并、不覆盖：失败的批次也留着，原位重试才说得清。 */
export const CanvasNodeBatchSchema = z.object({
  id: z.string().min(1),
  /** 服务端任务 id；为空表示"还没提交成功" */
  taskId: z.string().min(1).optional(),
  createdAt: z.number(),
  status: CanvasBatchStatusSchema,
  outputs: z.array(CanvasOutputSchema),
  /** 失败原因（错误码 + 可读文案）；成功时省略 */
  failure: z
    .object({
      code: z.string().min(1),
      message: z.string(),
    })
    .optional(),
});

export const CanvasDocNodeSchema = z.object({
  id: z.string().min(1),
  type: CanvasNodeTypeSchema,
  /** 画布坐标与尺寸：持久化（与事实图节点相反——那里位置是会话级的） */
  layout: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  data: z.object({
    title: z.string().optional(),
    source: CanvasNodeSourceSchema,
    draft: CanvasNodeDraftSchema,
    batches: z.array(CanvasNodeBatchSchema),
    tags: z.array(z.string()),
  }),
  meta: z
    .object({
      createdAt: z.number().optional(),
      createdFrom: CanvasNodeCreatedFromSchema.optional(),
    })
    .optional(),
});

export const CanvasDocEdgeSchema = z.object({
  id: z.string().min(1),
  /** 数据流方向：`from` 的产物喂给 `to` */
  from: z.string().min(1),
  to: z.string().min(1),
  kind: CanvasEdgeKindSchema,
  /** 这条边喂的是哪种用途（与 draft.references 的 role 对齐） */
  role: CanvasReferenceRoleSchema.optional(),
});

export const CanvasViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number().min(0.1).max(4),
});

export const CanvasDocSchema = z.object({
  version: z.literal(CANVAS_DOC_VERSION),
  projectId: z.string().min(1),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  viewport: CanvasViewportSchema,
  nodes: z.array(CanvasDocNodeSchema),
  edges: z.array(CanvasDocEdgeSchema),
});

/** 画布项目索引条目（多画布列表用；D60）。文档本体另外按 projectId 存。 */
export const CanvasProjectRefSchema = z.object({
  projectId: z.string().min(1),
  name: z.string(),
  updatedAt: z.number(),
  nodeCount: z.number().int().nonnegative(),
  /** 列表封面用哪张产物（可选；没有就显示占位） */
  coverAssetId: z.string().optional(),
});

export const CanvasProjectIndexSchema = z.object({
  version: z.literal(CANVAS_DOC_VERSION),
  projects: z.array(CanvasProjectRefSchema),
  /** 上次打开的项目；列表为空时省略 */
  activeProjectId: z.string().optional(),
});

export type CanvasNodeType = z.infer<typeof CanvasNodeTypeSchema>;
export type CanvasReferenceRole = z.infer<typeof CanvasReferenceRoleSchema>;
export type CanvasReferenceMode = z.infer<typeof CanvasReferenceModeSchema>;
export type CanvasEdgeKind = z.infer<typeof CanvasEdgeKindSchema>;
export type CanvasNodeSource = z.infer<typeof CanvasNodeSourceSchema>;
export type CanvasNodeSettings = z.infer<typeof CanvasNodeSettingsSchema>;
export type CanvasReference = z.infer<typeof CanvasReferenceSchema>;
export type CanvasNodeDraft = z.infer<typeof CanvasNodeDraftSchema>;
export type CanvasOutput = z.infer<typeof CanvasOutputSchema>;
export type CanvasNodeBatch = z.infer<typeof CanvasNodeBatchSchema>;
export type CanvasDocNode = z.infer<typeof CanvasDocNodeSchema>;
export type CanvasDocEdge = z.infer<typeof CanvasDocEdgeSchema>;
export type CanvasViewport = z.infer<typeof CanvasViewportSchema>;
export type CanvasDoc = z.infer<typeof CanvasDocSchema>;
export type CanvasProjectRef = z.infer<typeof CanvasProjectRefSchema>;
export type CanvasProjectIndex = z.infer<typeof CanvasProjectIndexSchema>;

/** 各类节点的默认尺寸（新建节点时用；与 V1 设计稿的媒体卡比例一致） */
export const CANVAS_NODE_DEFAULT_SIZE: Record<CanvasNodeType, { width: number; height: number }> = {
  text: { width: 320, height: 160 },
  image: { width: 320, height: 320 },
  video: { width: 420, height: 300 },
  audio: { width: 360, height: 140 },
};

export function emptyCanvasNodeDraft(kind: CanvasNodeType): CanvasNodeDraft {
  return { kind, prompt: '', settings: {}, references: [] };
}

export interface CreateCanvasNodeInput {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  title?: string;
  source?: CanvasNodeSource;
  createdFrom?: z.infer<typeof CanvasNodeCreatedFromSchema>;
  now?: number;
}

/** 新建节点的唯一工厂：保证 `batches` / `tags` 不会漏写（它们是 schema 必填字段） */
export function createCanvasNode(input: CreateCanvasNodeInput): CanvasDocNode {
  const size = CANVAS_NODE_DEFAULT_SIZE[input.type];
  const now = input.now ?? Date.now();
  return {
    id: input.id,
    type: input.type,
    layout: { x: input.x, y: input.y, width: size.width, height: size.height },
    data: {
      title: input.title,
      source: input.source ?? 'uploaded',
      draft: emptyCanvasNodeDraft(input.type),
      batches: [],
      tags: [],
    },
    meta: { createdAt: now, createdFrom: input.createdFrom },
  };
}

export function createEmptyCanvasDoc(
  projectId: string,
  name: string,
  now: number = Date.now(),
): CanvasDoc {
  return {
    version: CANVAS_DOC_VERSION,
    projectId,
    name,
    createdAt: now,
    updatedAt: now,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
  };
}

export function createEmptyCanvasProjectIndex(): CanvasProjectIndex {
  return { version: CANVAS_DOC_VERSION, projects: [] };
}

/**
 * 悬空边：`from` / `to` 指向不存在的节点。
 *
 * **不在 schema 里做 `superRefine`**：加载旧文档时先要能读进来，再决定"修复还是提示"；
 * 直接让整份文档解析失败会把用户卡在打不开的画布上。
 */
export function canvasDocDanglingEdges(doc: CanvasDoc): string[] {
  const ids = new Set(doc.nodes.map((n) => n.id));
  return doc.edges.filter((e) => !ids.has(e.from) || !ids.has(e.to)).map((e) => e.id);
}

/** 列表/封面用的摘要（不解析整份文档也能算） */
export function canvasDocSummary(doc: CanvasDoc): CanvasProjectRef {
  const firstImage = doc.nodes
    .flatMap((n) => n.data.batches.flatMap((b) => b.outputs))
    .find((o) => o.kind === 'image');
  return {
    projectId: doc.projectId,
    name: doc.name,
    updatedAt: doc.updatedAt,
    nodeCount: doc.nodes.length,
    coverAssetId: firstImage?.assetId,
  };
}
