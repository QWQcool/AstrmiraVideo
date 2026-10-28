import { z } from 'zod';
import { EditScriptSchema } from './edit.js';
import { EditProjectSchema } from './editProject.js';
import { providerBaseType, VideoGenerateRequestSchema } from './request.js';
import type { ProviderType, VideoGenerateRequest } from './request.js';

/**
 * 契约投影来源：docs/CONTRACT.md §4 任务进度与统一 Provider 接口 / §6 错误码字典
 */

export const TaskStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);

/**
 * V1.3：由 `retryable: boolean` 升级为三态。所有错误分支必须可归入其中之一，
 * 不允许「视情况而定」；'uncertain' 时禁止任何自动重提（PLAN §3 防线 7）。
 */
export const ErrorDispositionSchema = z.enum(['retryable', 'terminal', 'uncertain']);

/** CONTRACT §6（V1.8）：12 个错误码全量 —— 后 3 个为 V1.8 新增 */
export const ErrorCodeSchema = z.enum([
  'PROVIDER_UNAVAILABLE', // 所选引擎健康检查失败
  'GPU_BUSY', // 本地队列已有任务在执行
  'RATE_LIMITED', // 60s 防抖窗口内重复提交
  'INVALID_ASSET', // 资产格式无法清洗 / 32 倍数规整失败
  'PROMPT_REJECTED', // 提示词为空 / 超长 / 台词超长引导未确认
  'UPSTREAM_ERROR', // 上游**明确返回**错误（响应体可读）
  'UNCERTAIN_RESULT', // 已提交但无法确认结果：轮询中断 / 进程重启 / 上游超时无响应
  'TASK_NOT_FOUND', // taskId 不存在或已清理
  'DISK_FULL', // 输出目录磁盘不足
  // ── V1.8 新增（决策 PLAN §6-D23 / D24）──
  'LLM_NOT_CONFIGURED', // 扩写未配置 LLM（V2.0：请求未携带 X-LLM-Key 时 → 501；服务端不设兜底 Key）
  'KEY_INVALID', // 凭据被上游拒绝（校验路由见 PLAN §9 台账 B2）
  'KEY_MISSING', // 需要凭据的端点既未收到 X-Provider-Key，服务端也无 env 兜底 Key
  // ── V2.3 追加（V9 · B9 剪辑台落地时补齐）──
  // 说明：CONTRACT §11-2 早在 V2.2 就引用了 `INVALID_REQUEST`，但那次的错误码字典（§6）
  // **没有登记它** —— 契约内部不自洽。B9 实现时把它补进字典（详见 CONTRACT §6 / §11-2）。
  'INVALID_REQUEST', // 请求**形状合法但值/组合不合法**（如剪辑的 endSec ≤ startSec、连续两次拼接）
  // ── V2.11 追加（台账 B47 项目维度）──
  'PROJECT_NOT_FOUND',
  // V2.48（§21-8）：画布文档的修订号不匹配（另一个标签已写入 / 缺少修订号 / 已删除）。
  // 与"任务"无关，是编辑器并发保护；重试无意义，必须重载或另存。
  'DOC_CONFLICT',
]);

export const TaskErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  disposition: ErrorDispositionSchema,
});

/**
 * 任务**实际在哪台机器上跑的**（V2.27 / 台账 A1 片 A，B11）。
 *
 * ## 为什么必须有这个字段（而不是从 provider 猜）
 * "用了哪个引擎"与"算力在哪"是两件事，而且后者是**用户最关心的那件**：
 * - `cloud`：产物在部署者/用户的云端账号里生成（提示词与参考图**发到了上游**）；
 * - `host-local`：在本服务所在的那台机器上跑（数据不出这台机器）；
 * - `remote`：在部署者配置的远程 HTTP 服务上跑（V2.47；数据会发到该服务）；
 * - `client-worker`：在**访问者本机**跑（`astrmira-worker/v1` 协议，数据不出用户电脑）。
 *
 * 「数据不出域」这类承诺**只对 storage 成立是不够的** —— 云端 BYOK 下提示词仍会发到上游。
 * 所以本地轨（D49）的整个价值都建立在"这条任务到底在哪跑"能被**如实看到**上：
 * 画廊、视频库、画布都要标注它，而不是只在提交时选一次。
 */
export const ExecutedBySchema = z.enum(['cloud', 'host-local', 'remote', 'client-worker']);

/** 执行位置的**短标签**（卡片 / 节点上用的那一行；前后端唯一一份 —— 两处各写一遍必然漂移） */
export const EXECUTED_BY_LABELS: Record<z.infer<typeof ExecutedBySchema>, string> = {
  cloud: '云端',
  'host-local': '本机',
  remote: '远程服务',
  'client-worker': '你的电脑',
};

/**
 * 执行位置的**完整说法**（鼠标悬停 / 详情里用）。
 * 它比标签重要：四个位置对"数据去了哪"的含义完全不同，用户有权一眼看到。
 */
export const EXECUTED_BY_TITLES: Record<z.infer<typeof ExecutedBySchema>, string> = {
  cloud: '产物在云端生成：提示词与参考图会发到上游服务商',
  'host-local': '在本服务所在机器上跑：数据不出这台机器',
  remote: '在部署者配置的远程 HTTP 服务上执行：提示词与参考素材会发到该服务',
  'client-worker': '在你的设备上执行（含浏览器端渲染的剪辑产物）：服务端不持有中间产物',
};

/**
 * 由 provider 判定执行位置（写库时的**唯一**入口）。
 *
 * 为什么按 provider 而不是按 track：track 是"调度用哪条互斥队列"（cloud 并发 / local 单卡），
 * 而执行位置是"算力在哪"—— 将来 client-worker 轨仍会在 local track 上排队，
 * 但执行位置不同。所以判定要盯着 provider 语义，而不是调度桶。
 */
export function resolveExecutedBy(provider: ProviderType): z.infer<typeof ExecutedBySchema> {
  if (provider === 'cloud-volcano-seedance') return 'cloud';
  if (provider === 'imported') return 'remote';
  if (providerBaseType(provider) === 'http-service') return 'remote';
  return 'host-local';
}

export const TaskProgressSchema = z.object({
  taskId: z.string(),
  status: TaskStatusSchema,
  progressPercent: z.number().min(0).max(100),
  currentStep: z.number().int().optional(),
  totalSteps: z.number().int().optional(),
  message: z.string().optional(),
  outputVideoUrl: z.string().optional(),
  /**
   * V2.40（台账「文生图最小闭环」）：**图片产物的地址**（同源 `/media/<taskId>.<ext>`）。
   *
   * 与 `outputVideoUrl` **至多有一个**：一次生成要么出视频、要么出图（由 `mode` 决定）。
   * 旧记录只有 video —— 缺省即"不是图片产物"，向后兼容零迁移。
   *
   * ⚠️ **这条约束刻意不写成 `superRefine`**：那会把 `TaskProgressSchema` 变成 `ZodEffects`，
   * 而它被用作 Fastify 的**响应 schema**（`routes/tasks.ts`）—— 序列化链路上不值得冒这个险。
   * 改为：**写侧保证**（provider 只填一个）+ **读侧收口**（用下面的 `taskOutput()` 读，不要各处自己 if）。
   */
  outputImageUrl: z.string().optional(),
  // V1.9：成片首帧缩略图（同源 `/media/thumbs/<taskId>.jpg`）。
  // 画廊此前用 50 个 `<video preload="metadata">` 当缩略图 —— 每个元素都要发起一次请求，
  // 50 条历史就是 50 个媒体元素同时抢带宽。抽帧成 JPEG 后画廊只加载图片。
  // 可选：抽帧失败（工具缺失 / 成片不可解码）不影响任务成功，界面回落到旧行为。
  thumbnailUrl: z.string().optional(),
  // V1.4：用户可见的非阻断告警（如「素材短于请求时长，已循环播放」「循环素材自带音轨，已静音」）。
  // 与 message 职责分离：可并存多条、不随进度刷新被覆盖、随任务记录持久化（PLAN §6-D15）。
  warnings: z.array(z.string()).optional(),
  // 完整请求快照，供画廊一键回填
  requestSnapshot: VideoGenerateRequestSchema,
  // V2.3（CONTRACT §4）：任务创建时间（epoch ms）——直接暴露 `tasks.created_at`（列与索引本就存在，零迁移）。
  // 总览"今日生成"与视频库"按时间排序"的数据源。
  createdAt: z.number().int(),
  // V2.3（CONTRACT §4）：成片字节数（成功且文件仍在磁盘上时，服务端 stat 得出）。
  // 用途：视频库"按大小排序"与详情抽屉的"文件大小"；**文件已清理时省略该字段**（不填 0）。
  outputSizeBytes: z.number().int().nonnegative().optional(),
  /**
   * V2.94（B98 片 B）：**产物实测尺寸**（成功且文件还在时，服务端 ffprobe 得出）。
   *
   * 存在的理由：`requestSnapshot.resolution` 是**要求**，不是事实 —— 上游可能按自己的档位规则
   * 出别的尺寸（云端尤其如此）。有了这一对数字，"界面承诺的尺寸"和"实际出的片"才能被对上；
   * 没有它就只能靠猜。**探不到就省略**（文件已清理 / 编码不认），不给推测值。
   */
  /**
   * V2.95（B104）：**采样预览的序号**（递增）。有值 = 现在能拉到一张预览帧；
   * 序号变了才需要重新拉（GET /api/tasks/:id/preview），否则每轮轮询都会白下一遍图。
   * **只有 ComfyUI 会推预览**（其它引擎没有这个通道 → 字段缺省，界面就不显示预览）。
   */
  previewSeq: z.number().int().positive().optional(),
  outputDimension: z
    .object({ width: z.number().int().positive(), height: z.number().int().positive() })
    .optional(),
  /**
   * V9 · B9（CONTRACT §11-2）：这条任务是不是"剪辑产物"、以及它的剪辑来源。
   *
   * **可选**：缺省即"生成产物"（老记录同理），只有剪辑任务才会写。
   * 画廊与详情抽屉据此显示"剪辑自 xxx"徽标、并列出本片的操作序列 / 工程概要。
   *
   * V2.5（B34 改版）：`edit` 分支的 `script`（旧 EDL）与 `project`（多轨工程）**均可选、至少有一个** ——
   * 旧记录只有 script，新记录只有 project，两种都要能读（向后兼容是硬要求：库里已有 B9 时代的记录）。
   */
  origin: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('generate') }),
      z
        .object({
          kind: z.literal('edit'),
          sourceTaskId: z.string(),
          script: EditScriptSchema.optional(),
          project: EditProjectSchema.optional(),
        })
        .refine((value) => value.script !== undefined || value.project !== undefined, {
          message: '剪辑来源至少要有 script（旧 EDL）或 project（多轨工程）之一',
        }),
    ])
    .optional(),
  /**
   * 抽帧产物（`extractFrame` 落下的参考资产 id，可能多个）。
   * 它们与上传达的资产同目录同规则，可直接作为下一次 I2V / FL2V 的首帧或尾帧（D38 闭环）。
   */
  extractedAssetIds: z.array(z.string()).optional(),
  /**
   * V2.27（台账 A1 片 A / B11）：**这条任务实际在哪台机器上跑的**。
   *
   * 可选是**为了兼容 V2.27 之前的任务**（那时没有这个概念）—— 界面遇到缺省时
   * **不猜**（不按 provider 反推历史任务的执行位置，因为老任务没有这个事实）。
   */
  executedBy: ExecutedBySchema.optional(),
  error: TaskErrorSchema.optional(),
});

/**
 * CONTRACT §4：统一 Provider 接口（interface 用 TS 原生定义，方法签名与 CONTRACT 一致）。
 * OI（stock-local / fixture-local）必须实现完全相同的接口，不得新增专属请求字段、
 * 不得改变接口形状、不得要求调用方分支判断（详见 CONTRACT §4 与 PLAN §4「Step 2 补充」）。
 */
export interface VideoProvider {
  readonly id: ProviderType;
  readonly name: string;
  checkHealth(): Promise<{ available: boolean; reason?: string }>;
  submit(req: VideoGenerateRequest): Promise<{ taskId: string }>;
  queryStatus(taskId: string): Promise<TaskProgress>;
  cancel(taskId: string): Promise<boolean>;
}

export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type ExecutedBy = z.infer<typeof ExecutedBySchema>;
export type ErrorDisposition = z.infer<typeof ErrorDispositionSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type TaskError = z.infer<typeof TaskErrorSchema>;
export type TaskProgress = z.infer<typeof TaskProgressSchema>;

/** 一条任务的产物（V2.40）：视频 / 图片 / 还没有（未终态 · 失败 · 已被清理） */
export type TaskOutput =
  | { kind: 'video'; url: string }
  | { kind: 'image'; url: string }
  | { kind: 'none' };

/**
 * 读**这条任务的产物**（V2.40）—— 所有渲染点都该走它，别各自 `if`。
 *
 * 为什么要有这个函数：产物现在有两个字段（`outputVideoUrl` / `outputImageUrl`），
 * 而"两者至多有一个"这条约束**不在 schema 上**（见 `outputImageUrl` 的注释）。
 * 前端至少 5 处要按产物类型分支（画廊卡 / 中央视窗 / 视频库 / 画布 / 创作入口）——
 * 六处各写一遍迟早会漂移，所以把"怎么读"收口到这一处。
 *
 * **视频优先**：万一出现脏数据（两个都有），按视频读 —— 那是 V2.40 之前唯一存在过的形状。
 */
export function taskOutput(
  progress: Pick<TaskProgress, 'outputVideoUrl' | 'outputImageUrl'>,
): TaskOutput {
  const video = progress.outputVideoUrl;
  if (video !== undefined && video !== '') return { kind: 'video', url: video };
  const image = progress.outputImageUrl;
  if (image !== undefined && image !== '') return { kind: 'image', url: image };
  return { kind: 'none' };
}
