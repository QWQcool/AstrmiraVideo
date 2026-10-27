import { z } from 'zod';

/**
 * 契约投影来源：docs/CONTRACT.md §1 任务请求契约 `VideoGenerateRequest`
 * 本文件是类型与运行时校验的**唯一事实源**（PLAN §6-D18）；CONTRACT 中的 TS 代码块为文档投影。
 */

/**
 * 生成模式：文生视频 | 首帧图生 | 首尾帧 | 视频参考 | **文生图**。
 *
 * V2.40 新增 `t2i`（台账「文生图最小闭环」）：产物是**图片**（`TaskProgress.outputImageUrl`），
 * 不是视频。三条边界：
 * 1. **只有本地 ComfyUI 轨在模板里声明了它才可用**（能力位按模板声明判定，见 CONTRACT §19-2）——
 *    云端 Seedance 轨不做图片，提交时如实 `503 PROVIDER_UNAVAILABLE`；
 * 2. 它**不需要任何输入素材**（与 t2v 一样从提示词开始）；
 * 3. 它用的是**别的模型**（Flux 系）与**别的模板** —— 同一台 ComfyUI 里
 *    "出图"与"出视频"是**两份模板**（一个实例可以同时挂两份，按模式挑）。
 */
/**
 * 生成模式（V2.77 增补 `upscale`）。
 *
 * `upscale` 与其它模式的区别是**不需要 prompt**：它把一张已存在的图放大，
 * 输入走 `assets.firstFrameImage`（与 i2v/t2i 参考同口径），倍率走 `options.scale`。
 * 为什么单独立一个模式而不是塞进 `options`：塞进 options 时**别的 provider 会静默忽略**
 * （契约允许忽略未识别键），结果就是"用户要了超清、拿到一张原图"。独立模式才能被能力位拦。
 */
export const GenerationModeSchema = z.enum([
  't2v',
  'i2v',
  'fl2v',
  'v2v',
  't2i',
  'upscale',
  // V2.78：局部重绘（底图 + 蒙版 + 提示词；只重画蒙版内）
  'inpaint',
  // V2.79：扩图（底图 + 四边外扩像素；新区域由模型补画）
  'outpaint',
]);

/** 画面比例。1:1 仅云端可选，本地 H3 支持度【待验证】 */
export const AspectRatioSchema = z.enum(['16:9', '9:16', '1:1']);

/**
 * 执行引擎（CONTRACT §1 V1.5 修订；**V2.36 扩为"基类型 + 具名实例"**）。
 * 'stock-local' / 'fixture-local' 为开发期校验专用 provider（PLAN §4「Step 2 补充」），
 * 默认关闭、不出现在产品线能力位；前端不得为它们硬编码任何分支。
 *
 * V2.30（台账 A1 片 B / 决策 D53）：新增 **`host-comfyui`** —— 用户**自备的 ComfyUI**
 * （回环 / 内网地址，见 CONTRACT §19）。它与 `local-minimax-h3` 同属本地轨
 * （`executedBy: 'host-local'`），区别是**引擎由用户自己装、模型由用户自己放**。
 *
 * V2.36：`host-comfyui` 可以有**具名实例**（`host-comfyui:<name>`，一份服务连多台引擎）——
 * 实例名进 **id** 而不是塞进 `options`，因为任务的 `provider` 字段要能回答
 * "**这条在哪台机器上跑的**"（追溯 / 成本 / 排错都靠它）。
 */
export const PROVIDER_BASE_TYPES = [
  'cloud-volcano-seedance',
  // ⚠️ V2.37（D56）：**已撤掉**（产品面不再提供）。保留它只为**兼容**：
  // 旧前端产物与历史请求体带着这个值来，应当得到 503（人话），而不是形状校验 400。
  'local-minimax-h3',
  'host-comfyui',
  // V2.47（§22）：配置型 HTTP 任务服务；具名实例 `http-service:<name>`，地址只允许回环/内网。
  'http-service',
  'stock-local',
  'fixture-local',
  // V2.58（S7-D8）：外部作品导入历史；不参与生成调度，只用于历史展示。
  'imported',
] as const;

export const ProviderBaseTypeSchema = z.enum(PROVIDER_BASE_TYPES);
export type ProviderBaseType = z.infer<typeof ProviderBaseTypeSchema>;

/** V2.36：具名实例 id 的前缀与名字形状（名字是 id 的一部分 → 限 ASCII 标识符） */
export const COMFYUI_PROVIDER_PREFIX = 'host-comfyui:';
export const COMFYUI_SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,24}$/;

/** V2.47：配置型 HTTP 任务服务的具名实例（§22） */
export const HTTP_SERVICE_PROVIDER_PREFIX = 'http-service:';
export const HTTP_SERVICE_NAME_PATTERN = /^[A-Za-z0-9_-]{1,24}$/;

/** provider id 的**形状**是否合法（实例究竟存不存在，由服务端注册表判定 —— 未注册即 503） */
export function isProviderIdShape(value: string): boolean {
  if ((PROVIDER_BASE_TYPES as readonly string[]).includes(value)) return true;
  if (value.startsWith(COMFYUI_PROVIDER_PREFIX)) {
    return COMFYUI_SERVER_NAME_PATTERN.test(value.slice(COMFYUI_PROVIDER_PREFIX.length));
  }
  if (value.startsWith(HTTP_SERVICE_PROVIDER_PREFIX)) {
    return HTTP_SERVICE_NAME_PATTERN.test(value.slice(HTTP_SERVICE_PROVIDER_PREFIX.length));
  }
  return false;
}

/** 取基类型（`host-comfyui:office` → `host-comfyui`）；形状不合法返回 null */
export function providerBaseType(id: string): ProviderBaseType | null {
  if ((PROVIDER_BASE_TYPES as readonly string[]).includes(id)) return id as ProviderBaseType;
  if (id.startsWith(COMFYUI_PROVIDER_PREFIX)) {
    return isProviderIdShape(id) ? 'host-comfyui' : null;
  }
  if (id.startsWith(HTTP_SERVICE_PROVIDER_PREFIX)) {
    return isProviderIdShape(id) ? 'http-service' : null;
  }
  return null;
}

/** 具名实例名（`host-comfyui:office` → `office`）；默认实例 / 其它 provider / 形状不合法 → null */
export function comfyUiServerNameOf(id: string): string | null {
  if (!id.startsWith(COMFYUI_PROVIDER_PREFIX)) return null;
  const name = id.slice(COMFYUI_PROVIDER_PREFIX.length);
  return COMFYUI_SERVER_NAME_PATTERN.test(name) ? name : null;
}

/** V2.47：HTTP 服务实例名（`http-service:h3-gpu` → `h3-gpu`）；形状不合法 → null */
export function httpServiceNameOf(id: string): string | null {
  if (!id.startsWith(HTTP_SERVICE_PROVIDER_PREFIX)) return null;
  const name = id.slice(HTTP_SERVICE_PROVIDER_PREFIX.length);
  return HTTP_SERVICE_NAME_PATTERN.test(name) ? name : null;
}

/**
 * ⚠️ 形状校验只是**第一道**：它拦"拼错的 id"，拦不住"这台实例没配"。
 * 后者走既有路径（注册表返回 null → `503 PROVIDER_UNAVAILABLE`），不新增错误码。
 */
export const ProviderTypeSchema = z
  .string()
  .min(1)
  .refine(isProviderIdShape, {
    message:
      'provider 形状不合法：应为已知档位，或 host-comfyui:<name> / http-service:<name>（name 限 [A-Za-z0-9_-]{1,24}）',
  });

/** 成片时长上限 10s（公网部署防线，PLAN §7-3） */
export const DurationSecSchema = z.number().int().positive().max(10);

/**
 * V2.6（台账 B37）：`assets.referenceVideo` 引用一条已出片任务的前缀 ——
 * 值为 `task:<taskId>` 时表示"用该任务（含剪辑产物）的成片当 V2V 参考"。
 * 服务端解析为 `/media/*` 公网地址；前缀是契约的一部分（CONTRACT §1），前后端共用此常量。
 */
export const TASK_REF_PREFIX = 'task:';

/** 解析 `task:<taskId>` 引用；非该形态返回 null */
export function parseTaskRef(value: string): string | null {
  if (!value.startsWith(TASK_REF_PREFIX)) return null;
  const taskId = value.slice(TASK_REF_PREFIX.length);
  return taskId === '' ? null : taskId;
}

/**
 * 参考用途（V2.76：与画布 `CanvasReferenceRoleSchema` **同一份枚举**，单一事实源）。
 *
 * 为什么提到这里：请求体 `assets.references[]` 与画布文档 `draft.references[]` 用的是同一套词，
 * 两边各写一遍枚举迟早会漂（前端能存、后端不认）。
 */
export const ReferenceRoleSchema = z.enum([
  'first-frame',
  'last-frame',
  'reference-image',
  'reference-video',
  'reference-audio',
]);

/**
 * 一条多参考（V2.76 / B 路线）。
 *
 * `order` 是**槽位**：提示词里的 `{{image:N}}` 指的就是按 order 升序后的第 N 个。
 * `assetId` 与 `firstFrameImage` 同口径（资产 id 或 `task:<taskId>`）。
 */
export const GenerationReferenceSchema = z.object({
  assetId: z.string().min(1),
  role: ReferenceRoleSchema,
  order: z.number().int().min(0).max(63),
});

/** 多参考的结构上限（与画布 `CANVAS_MAX_REFERENCES` 同值；真实上限由能力目录决定） */
export const MAX_GENERATION_REFERENCES = 12;

/**
 * 参考资产：服务端分配的资产 ID（生命周期见 CONTRACT §7）；V2.6 起 referenceVideo 也可为 `task:<taskId>`。
 *
 * V2.76 增补 `references[]`（B 路线，多参考）——三条硬规则：
 * 1. **与首尾帧互斥**：`references` 非空时不许再给 `firstFrameImage` / `lastFrameImage`
 *    （同时给会让"哪张是首帧"变成两份真相）；
 * 2. 目前只接受 `role: 'reference-image'`：首尾帧仍走 `firstFrameImage` / `lastFrameImage`，
 *    参考视频仍走 `referenceVideo`；把 `references` 当成"万能数组"会让每种组合都要单独验；
 * 3. `order` 与 `assetId` 都不许重复（槽位冲突 / 同图重复喂）。
 */
export const GenerationAssetsSchema = z
  .object({
    firstFrameImage: z.string().optional(), // i2v 和 fl2v 必需
    lastFrameImage: z.string().optional(), // fl2v 专用尾帧
    referenceVideo: z.string().optional(), // v2v 风格/动作迁移参考（资产 ID 或 `task:<taskId>`，V2.6）
    references: z.array(GenerationReferenceSchema).max(MAX_GENERATION_REFERENCES).optional(), // V2.76 多参考
    /**
     * V2.78（局部重绘）：蒙版图资产 —— **白 = 要重画**、黑 = 保留。
     *
     * 尺寸必须与底图（`firstFrameImage`）一致（服务端不替你缩放：蒙版错位比报错更糟）。
     * 只允许出现在 `inpaint` 模式；其它模式给了它是配置错误，不是"顺便用一下"。
     */
    maskImage: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    const references = value.references ?? [];
    if (references.length === 0) return;

    if (value.firstFrameImage !== undefined || value.lastFrameImage !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['references'],
        message: 'assets.references 与 firstFrameImage / lastFrameImage 互斥：多参考模式不要再给首尾帧',
      });
    }

    const orders = new Set<number>();
    const assetIds = new Set<string>();
    for (const reference of references) {
      if (reference.role !== 'reference-image') {
        ctx.addIssue({
          code: 'custom',
          path: ['references'],
          message: `assets.references 目前只接受 role=reference-image（收到 ${reference.role}）`,
        });
      }
      if (orders.has(reference.order)) {
        ctx.addIssue({
          code: 'custom',
          path: ['references'],
          message: `assets.references 的 order 重复：${reference.order}`,
        });
      }
      orders.add(reference.order);
      if (assetIds.has(reference.assetId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['references'],
          message: `assets.references 重复引用同一素材：${reference.assetId}`,
        });
      }
      assetIds.add(reference.assetId);
    }
  });

/** 推理参数 */
export const GenerationParamsSchema = z.object({
  durationSec: DurationSecSchema.optional(), // 默认 5s
  frames: z.number().int().positive().optional(), // 本地 H3 默认 124 帧
  steps: z.number().int().positive().optional(), // 采样步数（默认 50）
  seed: z.number().int().optional(), // -1 表示随机
  seedLocked: z.boolean().optional(),
});

export const VideoGenerateRequestSchema = z.object({
  prompt: z.string(),
  mode: GenerationModeSchema,
  assets: GenerationAssetsSchema.optional(),
  // 画面规格（自动对齐为 32 的整数倍）
  aspectRatio: AspectRatioSchema,
  resolution: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
  params: GenerationParamsSchema.optional(),
  provider: ProviderTypeSchema,
  // provider 私有参数：仅对声明支持该字段的 provider 生效；
  // 未识别的键必须被忽略而非报错（默认引擎不得因该字段而改变行为）。
  options: z.record(z.string(), z.unknown()).optional(),
  /**
   * **我们的元数据，不透传给上游**（V2.11 / 台账 B47）：任务归属的项目。
   *
   * 为什么放在请求体而不是请求头：它与请求是**同一个决策的组成部分**（在哪个项目里出片），
   * 且要让幂等指纹把它算进去 —— 否则"同一个提示词在两个项目各提交一次"会被幂等去重成
   * 同一条任务（用户会在项目 B 里看不到自己刚提交的东西）。
   *
   * 缺省 = 默认项目（`DEFAULT_PROJECT_ID`），因此老客户端行为不变。
   */
  projectId: z.string().optional(),
  /**
   * V2.43（Step 11-S3）：这条任务是从哪来的。
   *
   * `create`（缺省）= 创作页/对话；`canvas` = 画布节点提交。
   * 为什么要区分：实测产品的**画布产物不进“生成历史”**（它只在画布里看得到），
   * 生成历史只收创作/对话产物。没有这个字段，服务端无法在分页/搜索时正确过滤 ——
   * 界面层再怎么藏，翻页也会把它翻出来。
   */
  origin: z.enum(['create', 'canvas']).optional(),
  /** 画布来源时建议带上，便于按项目回查（与 `projectId` 是两个维度：项目是资产归属，画布是工作区） */
  canvasProjectId: z.string().min(1).optional(),
}).superRefine((value, ctx) => {
  /**
   * V2.78：`inpaint` 的必需项与排他项。
   *
   * 为什么放在请求层而不是 assets 层：assets 不知道 `mode`，
   * 而"没有蒙版的重绘"和"带了蒙版的文生图"都必须在**入口**就拒掉 ——
   * 让它们走到 provider 再失败，用户看到的会是一句上游报错。
   */
  const mask = value.assets?.maskImage;
  if (value.mode === 'inpaint') {
    if (value.assets?.firstFrameImage === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['assets', 'firstFrameImage'],
        message: 'inpaint 需要底图：assets.firstFrameImage',
      });
    }
    if (mask === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['assets', 'maskImage'],
        message: 'inpaint 需要蒙版：assets.maskImage（白=重绘区）',
      });
    }
    if (value.resolution === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['resolution'],
        message: 'inpaint 需要 resolution：蒙版必须与底图同尺寸，服务端不替你缩放',
      });
    }
  } else if (mask !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['assets', 'maskImage'],
      message: `assets.maskImage 只用于 inpaint（当前 mode=${value.mode}）`,
    });
  }

  /**
   * V2.79：`outpaint` 需要底图 + 原始尺寸。
   *
   * 不要求蒙版（那由服务端按 `options.expand` 生成）；但**必须**知道底图真实宽高，
   * 否则算不出"外扩之后画布多大"，也就无法对齐 8 的整数倍。
   */
  if (value.mode === 'outpaint') {
    if (value.assets?.firstFrameImage === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['assets', 'firstFrameImage'],
        message: 'outpaint 需要底图：assets.firstFrameImage',
      });
    }
    if (value.resolution === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['resolution'],
        message: 'outpaint 需要 resolution：底图真实宽高（服务端据此算外扩后的画布）',
      });
    }
  }
});

export type GenerationMode = z.infer<typeof GenerationModeSchema>;
export type AspectRatio = z.infer<typeof AspectRatioSchema>;
/**
 * ⚠️ 它**故意是 `string`**（不是"基类型 | 实例后缀"的模板字面量联合）：
 * ① 请求体经 zod 校验后的推断类型本就是 `string`（形状由 `ProviderTypeSchema.refine` 管），
 *    两者不一致会让**每一个**读取 `request.provider` 的地方都要写断言 —— 而它们没有任何新信息；
 * ② 真正需要"表要补全"的地方（引擎标签、轨道判定、能力位分支）用 **`ProviderBaseType`** 那个枚举，
 *    那里才有编译期穷举保护。
 * 形状校验入口：`isProviderIdShape`（写入请求时）；实例是否存在：服务端注册表（运行时）。
 */
export type ProviderType = string;
export type GenerationAssets = z.infer<typeof GenerationAssetsSchema>;
export type GenerationParams = z.infer<typeof GenerationParamsSchema>;
export type VideoGenerateRequest = z.infer<typeof VideoGenerateRequestSchema>;
