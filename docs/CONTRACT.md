# 数据契约与接口定义（CONTRACT）

> **状态：V2.3 · 已冻结（变更需先改本文，再改代码）**
> **V2.3 修订（2026-09-23）**：**V9 B3 的最小数据增量**（方案 A；用户 2026-09-23 在 B1 闸门确认"确认做吧"）。
>   ① **§4**：`TaskProgress` 新增 `createdAt`（epoch ms —— 直接暴露 `tasks.created_at`，**列本就存在、零迁移**）与可选 `outputSizeBytes`（成片字节数，服务端 `stat` 落盘文件得出）；
>   ② **§5**：`GET /api/history` 的响应由 `{ items }` 扩为 `{ items, storage }`，`storage` 是 `outputs/` 的**目录级聚合**（成片 / 缩略图 / 参考资产）——老数据同样准确，不依赖逐条累加；`StorageUsage` 形状见 §4 末尾。
>   为什么加：V9 总览页四卡（今日生成 / 成功率 / 队列中 / 存储占用）与视频库"按时间 / 大小排序"此前**算不出来**（history 既无时间戳也无体积）——这是 Step 6-AC2「不许出现算不出来的指标」的落地前提。
>   纪律：只暴露**已有列**、只做**只读聚合**；不新增表、不新增路由、不引入后台任务。
> **V2.2 修订（2026-09-23）**：**V9 前端改版的接口规划**（PLAN §4 Step 6，决策 D33~D38）。本节内容当时均为**【规划】**；**现状（2026-09-23 追加）**：§3 的 `recipeId` 与 §11-1 配方库已由 **V9 · B8 实现**，§5 的 `POST /api/edits` 与 §11-2 剪辑台仍为【规划】（B9）。
>   ① **§3**：`PromptEnhanceRequest` 新增可选 `recipeId`（配方库作为扩写的风格上下文）；
>   ② **§5**：路由表新增 `POST /api/edits`（轻剪辑台，本地 ffmpeg，**零上游调用**）；
>   ③ **新增 §11**「配方库与轻剪辑台」：`RecipeCard` 与 `EditScript` 的完整形状、`/api/edits` 的状态映射、剪辑产物与 EDL 的生命周期。
> **V2.1 修订（2026-09-23）**：线上故障修复（模型被服务端 env 静默覆盖 → 上游 404）+ 操作日志上线。
>   ① **§1**：`options` 的语义**收紧为白名单**并明确优先级——视频轨承认 `model` / `baseUrl` /
>      `seedanceResolution` / `seedanceWatermark`；**请求里的 `model` / `baseUrl` 优先于服务端 env**。
>      这是本次故障的根因修复：此前注册点只读 env，界面上"切模型"根本没有效果。
>   ② **§5**：新增 `POST /api/providers/keys/verify`（原【规划·B2】，现实现，见 §9）；
>      新增 `GET /api/logs` / `DELETE /api/logs/:id` / `DELETE /api/logs`（见 §10）。
>   ③ **新增 §9**（凭据与模型校验）、**§10**（操作日志）。
>   ④ 错误码字典不变（12 个码，无新增）：模型不存在仍归 `UPSTREAM_ERROR` + `terminal`，
>      只是**消息里现在会带上"实际用了哪个模型、来源在哪"**。
>   ⑤ 转发与日志的凭据纪律不变：`packages/shared/src/verify.ts` 的校验接口也**只从请求头取 Key**，
>      响应与日志中的一切上游文本先过 `security/redact.ts`。
> **V2.0 修订（2026-09-22）**：**§3 提示词扩写由【规划】转为已实现**（PLAN §6-D24 / 台账 B3，落地见 §5 的 V8.3 批次 4），并据此新增 **§2 的 `llm` 能力位**。
>   ① **§2**：`ProviderStatus` 新增 `llm` 段（`available` / `acceptsClientKey` / `reason`）。
>      口径与 `cloud` 一致：`available` 只说**服务端视角**（env 兜底 Key 是否存在），
>      前端合成实际能力 = `acceptsClientKey && 本地有 LLM Key`。
>      **纯 BYOK 下 `available` 恒为 `false`** —— 服务端刻意不设文本侧兜底 Key；
>      若前端据此把 ✨ 置灰，就会复刻 V1.6 那个「用户填了 Key 也用不了」的漏洞（§2 V1.8 的教训）。
>   ② **§3**：`LlmConfig` / `PromptEnhanceRequest.llm?` / `PromptEnhanceResponse.engine`（**必填**）与 `notice?`；
>      凭据走请求头 `X-LLM-Key`（§5「凭据传递约定」），**服务端不设兜底 Key**；
>      错误状态映射：未带 Key → **501 `LLM_NOT_CONFIGURED`**、空/超长提示词 → **400 `PROMPT_REJECTED`**、
>      上游拒绝凭据 → **401 `KEY_INVALID`**、其余上游故障（含超时）→ **502 `UPSTREAM_ERROR`**（`retryable`，见 §6 硬规则 2 的 V1.8 收窄）。
>   ③ **§5**：`POST /api/prompt/enhance` 行由"demo 版返回 501"改写为已实现的状态映射。**未新增路由**。
> **V1.9 修订（2026-09-22）**：**§4 新增 `TaskProgress.thumbnailUrl?`**（成片首帧缩略图，画廊封面）。
>   动机是可观测的性能事实：画廊此前对每条历史挂一个 `<video preload="metadata">`，
>   50 条历史 = 50 个媒体元素各发一次请求并解析 moov；被抽成 JPEG 后可懒加载、可缓存。
>   实现口径：**成功出片后**由调度器抽帧落 `outputs/thumbs/<taskId>.jpg`（宽度 480），
>   经既有 `GET /media/*` 服务（**不新增路由**）；**抽帧失败不影响任务成功**（该字段可选），
>   `DELETE /api/history/:taskId` 同时删除成片与缩略图（§7 的磁盘释放口径不变）。
> **V1.8 修订（2026-09-22）**：探针降级与 BYOK 通道定稿（D22 / D23 / D27），文本侧 LLM 配置缺口登记为 V2.0【规划】（D24），三态适用范围收窄（D28）。
>   ① **§2**：`cloud.available` 口径收窄为「服务端视角（仅 env）」；`keySource` 收窄为可选字面量 `'env'`；新增 `acceptsClientKey`（服务端是否接受 `X-Provider-Key`，恒 true，托管场景可关）；`local` 段**删除** `gpuName` / `vramFreeGB`，`tier` 改为可选且语义为「**显式配置并自检通过**的引擎档位」——本端点在 V1.8 起为**纯配置事实陈述**，不含任何自动硬件扫描。
>   ② **§3**：LLM 配置与 `engine` 字段登记为 **V2.0【规划】**；demo 版 `/api/prompt/enhance` 以 `501 LLM_NOT_CONFIGURED` 诚实落地（禁止静默降级 / 规则引擎冒充）。
>   ③ **§5**：路由表新增 `GET /media/*`（`outputs/` 的 Range 静态媒体服务）；`POST /api/providers/keys/verify` 为【规划·B2】，**尚未列入下表、也未实现**（实现时须先在本节登记，避免"修订说明说新增了、表格里没有"这类自相矛盾）。新增「**凭据传递约定**」注记段——`X-Provider-Key` / `X-LLM-Key` 仅走请求头，禁 query / URL / body；服务端**零留存**（不落库、不入日志、不回显）。
>      **补登（S2 落地时）**：`/api/generate`、`/api/tasks/:taskId`、`/cancel`、`/api/history`、`DELETE /api/history/:taskId` 的**响应形状**已随实现补入路由表，类型以 `packages/shared/src/api.ts` 为单一事实源（此前只写语义描述、无形状定义）。
>      **补登（S6 落地时，2026-09-22）**：`/api/upload` 的 `mime` / `size` 语义收紧为「**防线 4 清洗后的产物事实**」（图像会被转码 / 下采样 / 32 倍数规整）；清洗失败与 `.heic`（HEVC 编码，本构建无解码器）均归 **415 `INVALID_ASSET`**。响应形状（`UploadResponseSchema`）不变。
>   ④ **§6**：新增 `LLM_NOT_CONFIGURED` / `KEY_INVALID` / `KEY_MISSING`（均 `terminal`）；**硬规则 2 适用范围收窄**为「有持久副作用的任务型上游」，无副作用调用（文本生成）不适用（D28）。
>   ⑤ **§7**：存储表新增「BYOK Key：**服务端零留存**」一行；「中间帧 / 临时音频」行补 client 本地轨落点（【规划】，见 PLAN §6-D26）。
> **V1.7 修订（2026-09-22）**：新增 §8 `HealthResponse`，补齐 `/api/health` 的响应契约——此前路由表只写「存活探针」而无响应形状定义，`packages/shared` 契约包（PLAN §6-D18）无法为它定义 schema（原为 T2 的施工阻塞点）。
> **V1.6 修订（2026-09-22）**：`ProviderStatus.cloud` 新增 `keySource?: 'env' | 'session'`，并明确 `cloud.available` 的判定语义为「env `VOLCANO_API_KEY` **或** 会话内存中的 BYOK Key 任一存在」——修复「available 仅由 env 驱动 → 前端设置抽屉填入的 Key 无法激活云端轨」的语义漏洞（BYOK 双入口见 GUIDE §二轨道 B）；`available: true` 时 `keySource` 必填，`reason` 需能区分两种缺失/来源情形。
> **V1.5 修订（2026-09-22）**：`ProviderType` 联合类型补入 OI provider（`'stock-local' | 'fixture-local'`），修复「§4 要求 OI 实现同一 `VideoProvider` 接口、但 `id: ProviderType` 闭联合集在类型层面无法承载 OI id」的自相矛盾；OI id 为开发期校验专用，默认关闭，不得出现在产品线能力位。配套 PLAN §6-D18。
> **V1.4 修订（2026-09-22）**：`TaskProgress` 新增 `warnings?: string[]`——用户可见的**非阻断告警**通道（与进度 `message` 职责分离、可并存多条、随任务记录持久化并在画廊展示）。引入原因：可选实现项 OI-1 的「素材短于请求时长 → 循环拉伸」与「循环后音轨静音」会**同时产生两条告警**，单字段 `message` 无法承载（§4、§7）。
> 本规范是前后端接口的**唯一权威**，定义核心数据流：【文本描述 + 参考图/参考视频 → 云端API(火山Seedance) / 本地推理(MiniMax H3) → 视频产出】。
> 任何文档或代码与本文冲突时，以本文为准。
> **V1.3 修订（2026-09-22）**：① 错误码由 `retryable: boolean` 升级为三态 `ErrorDisposition`，新增 `UNCERTAIN_RESULT` 且**禁止自动重提**（§6）；② 新增幂等键与提交前 `submitting` 标记（§5、§7）；③ `VideoGenerateRequest` 新增 provider 私有参数 `options`（§1）；④ 明确可选实现项（OI）的实现边界（§4）。改动同步落 PLAN §3 防线 7 与 §4「Step 2 补充」。

---

## 1. 任务请求契约 `VideoGenerateRequest`

```ts
export type GenerationMode = 't2v' | 'i2v' | 'fl2v' | 'v2v';
export type AspectRatio = '16:9' | '9:16' | '1:1'; // 1:1 仅云端可选，本地 H3 支持度【待验证】
// V1.5：补入 OI provider id。'stock-local' / 'fixture-local' 为开发期校验专用（PLAN §4「Step 2 补充」），
// 默认关闭、不出现在产品线能力位；前端不得为它们硬编码任何分支。
export type ProviderType =
  | 'cloud-volcano-seedance'
  | 'local-minimax-h3'
  | 'stock-local'
  | 'fixture-local';

export interface VideoGenerateRequest {
  // 核心文本描述（可配合 LLM 扩写）
  prompt: string;

  // 生成模式：文生视频 | 首帧图生 | 首尾帧 | 视频参考
  mode: GenerationMode;

  // 参考资产（服务端分配的资产 ID，见 §7 资产生命周期）
  assets?: {
    firstFrameImage?: string;     // i2v 和 fl2v 必需
    lastFrameImage?: string;      // fl2v 专用尾帧
    // v2v 风格/动作迁移参考。⚠️ 【已验证 2026-09-23】上游把视频参考当**另一种元素**处理
    // （`video_url` + 角色 `reference_video`），且**只接受公网 URL、不接受 data URL**
    // （原文：`reference_video must be provided as a web url`）。
    // 因此未配置 `PUBLIC_BASE_URL` 的部署（本地/内网）必须**在提交前**报
    // `INVALID_ASSET`（terminal）并说明去哪配，不得发一个注定 400 的请求。
    referenceVideo?: string;
  };

  // 画面规格（自动对齐为 32 的整数倍）
  aspectRatio: AspectRatio;
  resolution?: {
    width: number;
    height: number;
  };

  // 推理参数
  params?: {
    durationSec?: number;         // 默认 5s，上限 10s（公网部署防线）
    frames?: number;              // 本地 H3 默认 124 帧
    steps?: number;               // 采样步数（默认 50）
    seed?: number;                // 随机种子（-1 表示随机）
    seedLocked?: boolean;         // 是否锁定种子
  };

  // 执行引擎（无卡环境服务端强制覆写为 cloud-volcano-seedance）
  provider: ProviderType;

  // provider 私有参数。仅对声明支持该字段的 provider 生效，
  // 未识别的键必须被忽略而非报错（默认引擎不得因该字段而改变行为）。
  // 用途：承接可选实现项 OI-1（素材）/ OI-2（CI 夹具）的参数，避免污染公共字段。
  //
  // V2.1：**云端的模型与地址也走这里**（BYOK 的一部分），且**优先级高于服务端 env**：
  //   model      —— 上游模型 / 接入点 id（优先级：请求 > VOLCANO_MODEL_NAME > 协议层默认）
  //   baseUrl    —— 上游基址（优先级：请求 > VOLCANO_BASE_URL > 协议层默认）
  //   seedanceResolution / seedanceWatermark —— 云端轨的高级参数
  //   fixtureClip —— OI-2 夹具选片（开发期）
  // 背景：2026-09-23 线上故障正是"请求里的 model 无人消费、被 env 覆盖"导致的 404，
  // 因此"请求优先"这条是**契约级**要求，不是实现细节。
  options?: Record<string, unknown>;
}
```

---

## 2. 算力状态检测契约 `ProviderStatus`

**V1.8 语义（PLAN §6-D22 / D27）**：本端点**不是硬件探针**——它只报告**本服务自身**的配置事实：env 是否提供兜底 Key、本地引擎是否被部署者**显式配置并启用**。它**不扫描硬件**、**不返回任何未经显式配置的硬件信息**，也**不替访问者判断设备能力**（不得出现「你的设备 / 你没有显卡」类文案）。Tier 0~3 已降级为「推荐配置说明」（GUIDE §一），**不参与任何自动锁定或置灰**。

```ts
export type HardwareTier = 0 | 1 | 2 | 3; // 推荐档位定义见 GUIDE.md §一

export interface ProviderStatus {
  cloud: {
    // V1.8：口径收窄为「服务端视角」——仅表示 env 兜底 Key 是否存在。
    // 前端合成实际能力：cloudEffective = cloud.available || (cloud.acceptsClientKey && hasLocalKey())
    available: boolean;
    provider: 'volcano-seedance';
    // V1.8：仅标记服务端来源；available=true 时必填。
    // 客户端持有的 Key 不在本端点表达（状态端点无凭据上下文，见 §5「凭据传递约定」）
    keySource?: 'env';
    // V1.8：服务端是否接受客户端携带的 Key（恒 true；托管场景可置 false 禁用 BYOK）
    acceptsClientKey: boolean;
    // 需能区分「服务端未配置兜底 Key」等**自身**情形；不描述访问者设备
    reason?: string;
  };
  local: {
    available: boolean;
    provider: 'minimax-h3';
    // V1.8：语义 = 部署者显式配置并自检通过的引擎档位；未配置时缺省。
    // 不再是硬件扫描结论，也不得用于"自动锁定/置灰"判定
    tier?: HardwareTier;
    // V1.8：删除 gpuName / vramFreeGB —— 面向访客的端点不得携带硬件型号与显存数字（D27）
    // reason 两类口径（文案纪律见 PLAN §3 铁律 2）：
    //  - 「本服务未配置本地引擎」（未配 env）
    //  - 「本服务未向访客开放本地轨」（EXPOSE_HOST_LOCAL_TRACK=0，默认）
    reason?: string;
  };
  llm: {
    // V2.0：文本轨（提示词扩写）能力位。口径与 cloud 相同：本字段只表示**服务端视角**。
    // 前端合成实际能力：llmEffective = acceptsClientKey && hasLocalLlmKey()
    // ⚠️ 纯 BYOK 下 available 恒为 false（服务端不设文本侧兜底 Key）——
    //    **不得**用它判断"能不能扩写"，否则会复刻 V1.6「填了 Key 也用不了」的漏洞。
    available: boolean;
    provider: 'openai-compatible';
    acceptsClientKey: boolean; // 恒 true；托管场景可置 false 禁用 BYOK
    reason?: string;           // 例：「本服务不提供文本侧兜底 Key（纯 BYOK）」
  };
  defaultProvider: ProviderType; // 初始建议值（V1.8：不再由 Tier 判定推导）
}
```

> **`EXPOSE_HOST_LOCAL_TRACK`（V1.8 新增）**：env 开关，**默认 `0`**。为 `0` 时本地轨对访客不可用（`local.available:false` + 上述第二类 `reason`）；部署者自用需显式置 `1` 并配置 `H3_WORKDIR` / `COMFYUI_BASE_URL`（白名单校验见 PLAN §7-2）。host 本地轨的 scope 与防线落点见 PLAN §6-D26。

---

## 3. 提示词扩写接口契约 `PromptEnhance`

> **V2.0 状态：已实现**（PLAN §6-D24 / 台账 B3，落地见 PLAN §5「V8.3 批次 4」）。
> **纯 BYOK**：凭据走请求头 `X-LLM-Key`，**服务端不设文本侧兜底 Key** ——
> 没带 Key 就是 **`501` + `LLM_NOT_CONFIGURED`**（"没配"的诚实回答），**不得**用任何"规则引擎"冒充 AI（静默降级红线，PLAN §3 铁律 4）。
> **`engine` 是必填字段**：它是"是否静默降级"在测试层面**唯一可证伪**的标记；本实现只可能返回 `'llm'`。

```ts
/** 文本端点配置（请求体可选；缺省回落到 LLM_PRESETS 的第一项） */
export interface LlmConfig {
  preset?: string;   // LLM_PRESETS 的 id，或 'custom'（自定义，无默认值，必须填 baseUrl + model）
  baseUrl?: string;  // 覆盖预设地址（自建代理 / 兼容端点）
  model?: string;    // 覆盖预设模型名
}

export interface PromptEnhanceRequest {
  originalPrompt: string;
  style?: 'cinematic' | 'anime' | 'commercial' | 'realistic';
  mode?: GenerationMode;
  llm?: LlmConfig;   // V2.0：**凭据绝不在此字段**
  recipeId?: string; // V2.2【规划】→ **V9 · B8 已实现**：配方 id（见 §11-1）；服务端把该卡的 `skeleton + pitfalls` 注入 system prompt；**未知 id → 400 PROMPT_REJECTED**（不静默按普通扩写跑）
}

export interface PromptEnhanceResponse {
  enhancedPrompt: string;
  cameraMovementSuggested?: string;
  lightingSuggested?: string;
  engine: 'llm' | 'rules';  // V2.0 必填；本服务只返回 'llm'
  notice?: string;          // 例：「上游返回的不是 JSON，已按纯文本采用」
}
```

**状态映射（本路由的唯一权威口径）**：

| 情形 | HTTP | code | disposition |
|---|---|---|---|
| 请求头无 `X-LLM-Key`（或仅空白） | `501` | `LLM_NOT_CONFIGURED` | `terminal` |
| `originalPrompt` 为空 / 超 `MAX_PROMPT_CHARS`（2000，与 `/api/generate` 共用常量） | `400` | `PROMPT_REJECTED` | `terminal` |
| 自定义预设未填全 `baseUrl` / `model`，或地址非法 | `501` | `LLM_NOT_CONFIGURED` | `terminal` |
| 上游 `401` / `403` | `401` | `KEY_INVALID` | `terminal` |
| 上游其它非 2xx / 超时 / 网络异常 / 空内容 | `502` | `UPSTREAM_ERROR` | `retryable` |

> **为什么超时不是 `UNCERTAIN_RESULT`**：§6 硬规则 2 的适用范围（V1.8 收窄）是
> **有持久副作用的任务型上游**。文本扩写没有副作用、重试不会重复计费，
> 因此按 PLAN §6-D28 归 `UPSTREAM_ERROR`（可重试）。
> **响应与日志中不得出现 Key 明文**：上游错误体常回显 Key，服务端在拼装消息前必须擦除（§5）。

---

## 4. 任务进度与统一 Provider 接口

```ts
export interface TaskProgress {
  taskId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progressPercent: number;        // 0 ~ 100
  currentStep?: number;
  totalSteps?: number;
  message?: string;
  outputVideoUrl?: string;        // 成功后的视频访问直链
  thumbnailUrl?: string;          // V1.9：成片首帧缩略图（同源 `/media/thumbs/<taskId>.jpg`），画廊封面用
                                  // 可选：抽帧失败 / 旧记录缺该字段时界面回落为 `<video preload="metadata">`
  warnings?: string[];            // 用户可见的非阻断告警（如"素材短于请求时长，已循环播放"、"循环素材自带音轨，已静音"）
                                  // 与 message（进度描述）职责分离：可并存多条、不随进度刷新被覆盖、随任务记录持久化
  requestSnapshot: VideoGenerateRequest; // 完整请求快照，供画廊一键回填
  createdAt: number;               // V2.3：任务创建时间（epoch ms）——总览"今日生成"与视频库"按时间排序"的数据源
                                   // 直接暴露 `tasks.created_at`（该列与索引本就存在，零迁移）
  outputSizeBytes?: number;        // V2.3：成片字节数（成功且文件仍在磁盘上时，服务端 stat 得出）
                                   // 用途：视频库"按大小排序"、详情抽屉的"文件大小"；
                                   // 文件已被清理时**省略该字段**（不填 0 —— 0 会被读成"空文件"）
  error?: {
    code: ErrorCode;              // 见 §6 错误码字典
    message: string;
    disposition: ErrorDisposition; // 见 §6；'uncertain' 时禁止任何自动重提
  };
}

export interface VideoProvider {
  readonly id: ProviderType;
  readonly name: string;
  checkHealth(): Promise<{ available: boolean; reason?: string }>;
  submit(req: VideoGenerateRequest): Promise<{ taskId: string }>;
  queryStatus(taskId: string): Promise<TaskProgress>;
  cancel(taskId: string): Promise<boolean>;
}

/**
 * V2.3：`GET /api/history` 响应里的**输出目录聚合**（不是逐条累加——老数据同样准确）。
 * 对账口径：与 `du -sb outputs/` 一致（成片 + 缩略图 + 参考资产）。
 * 实现：`backend/src/server/storageUsage.ts`（只读扫描，可选 5s 缓存）。
 */
export interface StorageUsage {
  totalBytes: number;   // 三项之和
  videoBytes: number;   // 成片（`outputs/*.mp4`）
  videoCount: number;
  thumbBytes: number;   // 缩略图（`outputs/thumbs/*.jpg`）
  assetBytes: number;   // 参考资产（`outputs/assets/*`）
  assetCount: number;
}
```

> **可选实现项（OI）的实现边界**：`stock-local`（素材）与 `fixture-local`（CI 夹具）**必须实现与上面完全相同的接口**，不得新增专属请求字段、不得改变接口形状、不得要求调用方分支判断；其私有参数一律走 `options`。注册点为 `providers/registry.ts`，默认关闭（env `ENABLE_STOCK_PROVIDER`），能力位由 `GET /api/providers/status` 下发——前端不得硬编码具体 provider。详见 PLAN §4「Step 2 补充」。

---

## 5. 前后端 REST API 路由（唯一路由权威）

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| `GET` | `/api/health` | 存活探针（响应形状见 §8；**任何来源**均免鉴权，见 PLAN §7-4） |
| `GET` | `/api/providers/status` | **本服务本地引擎配置状态**（V1.8：纯配置事实陈述，非硬件探测；**旧名 `/api/system/probe` 已废弃**） |
| `GET` | `/media/*` | **V1.8 新增**：`outputs/` 静态媒体服务（成片直链，播放器与下载的 **206 Range** 载体）；路径只含服务端生成的随机 ID，不含任何用户输入 |
| `POST` | `/api/generate` | 创建视频生成任务（凭据经 `X-Provider-Key`，见下方注记段）。**200 → `{ taskId }`**（幂等：同一 `Idempotency-Key` 或缺省指纹重复提交返回同一 `taskId`）；提示词为空或超过 2000 字符 → **400 `PROMPT_REJECTED`**（terminal）；引擎未实现 / 未启用 → **503 `PROVIDER_UNAVAILABLE`**；60s 防抖限流 → 429 |
| `GET` | `/api/tasks/:taskId` | 轮询任务状态与结果。**200 → `TaskProgress`（§4）**；不存在或已清理 → **404 `TASK_NOT_FOUND`** |
| `POST` | `/api/tasks/:taskId/cancel` | 取消任务（仅 `queued` / `running` 可取消；已在终态 → `{ ok: false }`）。**200 → `{ ok, taskId }`**。语义是**尽力而为**：服务端把任务置 `cancelled`（此后调度器**不再推进**、也不会被 heartbeat 覆盖），并**通知上游停止**；上游是否真的停止、是否已产生费用，本服务无法代上游保证 —— 前端文案必须如实说明并指向服务商后台核对 |
| `POST` | `/api/prompt/enhance` | 提示词扩写助手（**V2.0 已实现**，凭据经 `X-LLM-Key`，见下方注记段）。**200 → `PromptEnhanceResponse`（§3，含必填 `engine`）**；无 Key → **501 `LLM_NOT_CONFIGURED`**；空 / 超长提示词 → **400 `PROMPT_REJECTED`**；上游拒绝凭据 → **401 `KEY_INVALID`**；其余上游故障（含超时）→ **502 `UPSTREAM_ERROR`**。状态映射的完整口径见 §3 |
| `POST` | `/api/upload` | 上传参考图/视频（multipart，≤20MB × ≤4，**按魔数嗅探判定类型**、不信任 `Content-Type`）：**200 → `{ assets: [{ assetId, kind, mime, size }] }`**——**图像须过防线 4 清洗网关**，返回的 `mime` / `size` 因此是**清洗后的产物事实**（HEIC/WebP → JPEG、带透明通道保 PNG；视频原样落盘），不是客户端声明的类型；超体积 / 超数量 → **413**；白名单外 / 伪造类型 / **清洗失败**（含 `.heic` 的 HEVC 编码——按实测能力诚实拒绝）→ **415 `INVALID_ASSET`**（细则见 PLAN §7-6 与 §5 的 S6 条目） |
| `GET` | `/api/history` | 历史视频列表（含完整参数快照用于回填）。**200 → `{ items: TaskProgress[], storage: StorageUsage }`**（`items` 最近 50 条；**V2.3 起**每条含 `createdAt` / `outputSizeBytes?`，响应另带 `storage` 目录级聚合，形状见 §4 末尾） |
| `DELETE` | `/api/history/:taskId` | 删除单条历史并**释放磁盘**。**200 → `{ ok, taskId }`**；不存在 → 404 `TASK_NOT_FOUND` |
| `POST` | `/api/providers/keys/verify` | **V2.1 新增（原【规划·B2】）**：凭据与模型校验，**零费用**。请求头按轨取（视频 `X-Provider-Key` / 文本 `X-LLM-Key`）；**200 → `KeyVerifyResponse`（§9）**；未带 Key → **501 `KEY_MISSING`**；凭据被上游拒绝 → **401 `KEY_INVALID`**；上游不可达 → **502 `UPSTREAM_ERROR`** |
| `GET` | `/api/logs` | **V2.1 新增**：操作日志查询（筛选 + 分页，见 §10）。**200 → `{ items, total }`** |
| `DELETE` | `/api/logs/:id` | **V2.1 新增**：删单条日志。**200 → `{ ok, deleted }`**（删除不存在的条目**不是错误**：DELETE 幂等，`deleted: 0`） |
| `DELETE` | `/api/logs` | **V2.1 新增**：按当前筛选清空日志（不带筛选即全清）。**200 → `{ ok, deleted }`** |
| `POST` | `/api/edits` | **V2.2【V9 规划】**：轻剪辑台（本地 ffmpeg，**零上游调用**）。**200 → `{ taskId }`**（复用 §4 的 `GET /api/tasks/:taskId` 轮询与画廊）；操作序列非法 → **400 `INVALID_REQUEST`**；源任务不存在或无成 → **404 `TASK_NOT_FOUND`**。完整契约见 §11 |

**幂等键与「即将提交」标记（V1.3 新增）**：
- `POST /api/generate` 必须接受幂等键（请求头 `Idempotency-Key`；缺省时服务端按 `provider + 请求指纹` 生成）。同一幂等键重复提交返回**同一 `taskId`**，不得产生第二次上游调用。
- 服务端在**真正向上游提交之前**先落库一条 `submitting` 标记，提交成功后写回上游 `taskId`。进程重启或网络中断后，凭该标记即可判定「到底提交出去没有」。
- 这是 §6 `UNCERTAIN_RESULT` 与 PLAN §3 防线 7 能够落地的**前提**：没有 `submitting` 标记，就无法区分「没提交」与「提交了但不知道结果」。

**凭据传递约定（V1.8 新增，决策 PLAN §6-D23）**：
- **唯一载体是请求头**：视频轨 `X-Provider-Key`、文本轨 `X-LLM-Key`（**V2.0 起已启用**，两条轨的 Key **相互独立**，前端可一键复用但服务端始终分别读取）。**禁止**出现在 query、URL path、body 或 cookie 中。
- **服务端零留存**：只用不存——不落 SQLite、不写日志（pino `redact` 必须覆盖相应请求头）、不回显明文；错误响应也必须保证不含 Key 片段。日志或响应中出现 Key 明文 = **发布级缺陷**。
- **状态端点不表达客户端凭据**：`GET /api/providers/status` 无凭据上下文，其 `cloud.available` 只表示 env 兜底 Key 是否存在；"前端是否持有 Key"由前端自行合成（§2 的 `acceptsClientKey` + 本地存储）。
- **写入 / 清除无服务端路由**：Key 存于浏览器，清除即清本地存储。凭据校验路由（`keys/verify`）已于 **V2.1 实现**（见 §9）；本地引擎运行时自检（`local/verify`）**仍未实现**，属 PLAN §9 台账 **B4**；实现时必须先在本节登记。
- `Idempotency-Key` 与上述两个凭据头一样，必须在 CORS `allowedHeaders` 中显式放行，否则浏览器预检直接失败（本地 curl 通、浏览器必失败）。
- **访问鉴权（V1.8 补充口径，细则见 PLAN §7-4）**：公网部署时，除「**回环来源**（127.0.0.1 / ::1）的全部请求」与「**任何来源**的 `/api/health`」两层免鉴权外，**其余全部路径**（含 `/api/*`、`/media/*` 与前端产物 `/`）一律要求 `Authorization: Bearer <PUBLIC_API_TOKEN>`——钩子是全局 `onRequest`，线上由 Caddy 把站点登录凭据换成 Bearer。鉴权未通过返回 **401**。

**通信方式**：MVP 使用轮询（`GET /api/tasks/:taskId`，建议 2s 间隔）；SSE 实时推送为【规划】，Step 4 后评估（决策记录 PLAN §6-D7）。

---

## 6. 错误码字典 `ErrorCode` 与三态处置 `ErrorDisposition`

```ts
// V1.3：由 retryable: boolean 升级为三态。所有错误分支必须可归入其中之一，不允许"视情况而定"。
export type ErrorDisposition =
  | 'retryable'   // 可安全自动重试：重试不会产生副作用
  | 'terminal'    // 终态失败：重试无意义，需用户改参数或换引擎
  | 'uncertain';  // 不确定：已可能产生上游副作用，禁止自动重提，必须人工核对
```

| code | 触发场景 | disposition |
| :--- | :--- | :--- |
| `PROVIDER_UNAVAILABLE` | 所选引擎健康检查失败（如无卡选本地） | `terminal`（换引擎） |
| `GPU_BUSY` | 本地队列已有任务在执行 | `retryable`（自动排队，无需手动重试） |
| `RATE_LIMITED` | 60s 防抖窗口内重复提交 | `retryable`（等待冷却） |
| `INVALID_ASSET` | 资产格式无法清洗 / 32 倍数规整失败 | `terminal` |
| `PROMPT_REJECTED` | 提示词为空 / 超长 / 台词超长引导未确认 | `terminal` |
| `UPSTREAM_ERROR` | 上游**明确返回**错误（4xx/5xx 响应体可读） | `retryable`（有限次退避后转 `terminal`） |
| `UNCERTAIN_RESULT` | 已提交但无法确认结果：轮询中断 / 进程重启 / 上游超时无响应 | **`uncertain`（禁止自动重提）** |
| `TASK_NOT_FOUND` | taskId 不存在或已清理 | `terminal` |
| `DISK_FULL` | 输出目录磁盘不足 | `terminal`（清理后手动重试） |
| `LLM_NOT_CONFIGURED` | 扩写未配置 LLM（V2.0 起：请求未携带 `X-LLM-Key`，或自定义端点没配全 → `/api/prompt/enhance` 返回 `501`；服务端**不设**文本侧兜底 Key，见 §3） | `terminal` |
| `KEY_INVALID` | 凭据被上游拒绝（真实调用与 `POST /api/providers/keys/verify` 两处产生，见 §9） | `terminal` |
| `KEY_MISSING` | 需要凭据的端点既未收到 `X-Provider-Key`，服务端也无 env 兜底 Key（也用于访问令牌缺失） | `terminal` |

**V1.3 三条硬规则**：

1. **`uncertain` 是唯一必须人工核对的分支**。任何自动重试都可能造成上游**重复计费**。前端必须提示「**可能已产生费用，请到服务商后台核对后手动处理**」，并提供「标记为已核对 / 放弃任务」动作（Step 3 落地）。
2. **适用范围（V1.8 收窄，决策 PLAN §6-D28）**：本规则仅适用于**有持久副作用的任务型上游**（视频生成、素材下载）。对**无副作用调用**（文本生成 / LLM 扩写等，重试不产生重复计费）**不适用**——此类调用的超时 / 断连一律归 `UPSTREAM_ERROR`（`retryable`），不得归 `UNCERTAIN_RESULT`。
   在适用范围内：**上游无响应 / 超时一律归 `UNCERTAIN_RESULT`，不得归入 `UPSTREAM_ERROR`**；后者仅用于上游**明确返回**错误响应的场景——这条区分是三态护栏能否生效的关键。
3. 三态与 PLAN §3 **防线 7（付费不确定性不自动重提）**配套，二者改动必须同时进行。

---

## 7. 存储与资产生命周期（PLAN §6-D5 的落地细则）

| 数据 | 存储 | 生命周期 |
| :--- | :--- | :--- |
| 任务状态 + 参数快照 + 画廊元数据 | SQLite（`data/app.db`，better-sqlite3） | 持久，服务重启可恢复 |
| 幂等键 → taskId 映射 | SQLite（同上） | 持久；同一键重复提交返回同一任务（§5） |
| 任务告警 `warnings[]` | SQLite（同上） | 随任务记录持久化，画廊 / 结果卡展示（V1.4 §4）；**仅写服务端日志不算告警** |
| `submitting` 提交标记 | SQLite（同上） | 提交前写入、成功后写回上游 taskId；重启后据此判定是否已提交（§5，防线 7 前提） |
| 成片 MP4 | `outputs/`（已入 .gitignore） | **前端一键删除释放磁盘**（`DELETE /api/history/:taskId`）；容量淘汰（LRU）**暂缓**，见 PLAN §9-B22 |
| 成片缩略图（V1.9） | `outputs/thumbs/<taskId>.jpg` | 成功出片后由调度器抽首帧生成（宽度 480，`/media/thumbs/...` 直链）；**尽力而为**：抽帧失败只记日志，任务仍为 `succeeded`；随任务删除一并物理删除 |
| 上传的参考资产 | `outputs/assets/<assetId>.<jpg\|png>` | 关联任务删除时一并清理（`DELETE /api/history/:taskId`）；**保护规则**：若该 `assetId` 仍被其它任务引用（「参数一键回填」会复用资产），则只删任务、保留资产 —— 否则会毁掉另一条任务的参考图。扩展名由防线 4 的清洗结果决定，因此按 `<assetId>.` 前缀匹配删除 |
| 中间帧 / 临时音频 | host 轨：`outputs/.tmp/<taskId>/`；client 轨（【规划】，PLAN §6-D26）：落在用户机器、由 worker 清理 | 合成结束立即物理删除（防线 3）；client 轨须回报 `tmpCleaned` 并写入 `warnings[]`，服务端无法强制验证该事实 |
| **BYOK Key（`X-Provider-Key` / `X-LLM-Key`）** | **服务端零留存（无此数据）** | V1.8：仅存在于单次请求的内存上下文；不落库、不入日志、不回显（见 §5「凭据传递约定」）；env 兜底值由部署者自管 |
| 前端任务 ID 锚点 | 浏览器 `localStorage` | 刷新后凭 ID 向服务端重挂载进度 |

---

## 8. 辅助响应类型 `HealthResponse`

```ts
// V1.7：/api/health 的响应形状。此前路由表仅写「存活探针」而无响应契约，
// shared 契约包（PLAN §6-D18）无法为它定义 schema——本节补齐该缺口。
export interface HealthResponse {
  status: 'ok';
  name: string;        // 服务标识，如 'AstrmiraVideo Backend'
  version: string;     // 服务版本号
  timestamp: string;   // ISO 8601
}
```

> 该类型同样以 `packages/shared` 的 zod schema 为唯一事实源（`HealthResponseSchema`），本节代码块为文档投影。

---

## 9. 凭据与模型校验 `POST /api/providers/keys/verify`（V2.1 新增）

**它解决什么**：2026-09-23 的线上故障里，用户是**花了一次真实提交**才拿到"模型不存在"（上游 404）。
"Key 行不行 / 模型在不在 / 有没有开通"这三件事本可以在提交之前零成本回答。

```ts
export type KeyVerifyTrack = 'video' | 'text';

export interface KeyVerifyRequest {
  track: KeyVerifyTrack;
  model?: string;    // 待校验的模型 / 接入点 id（缺省时只校验凭据本身）
  baseUrl?: string;  // 覆盖端点（自建代理 / 兼容端点）
  preset?: string;   // 文本轨预设 id（与 LLM_PRESETS 同一套）
}

export interface KeyVerifyResponse {
  keyValid: boolean;
  totalModels: number | null;    // 上游 /models 返回的模型总数；端点不提供时为 null
  modelListed: boolean | null;   // 是否出现在该清单里（存在 ≠ 已开通）
  modelAvailable: boolean | null; // **能不能用**：true 可用 / false 不存在或未开通 / null 未探测
  message: string;               // 一句话结论（成功与失败都必须能直接照做）
}
```

**两条探测路径（都要求"零费用"，这是硬约束）**：

| 轨 | 探测 | 判据 |
| :--- | :--- | :--- |
| 视频 | ① `GET {baseUrl}/models`；② `POST {baseUrl}/contents/generations/tasks` 带**空 `content`** | ② 返回 **400**（参数校验先失败）= 模型存在且已开通；**404** = 不存在/未开通。**不会创建任务** |
| 文本 | `POST {baseUrl}/chat/completions` 带 `max_tokens: 1` | **200** = 可用（费用近乎 0）；**404** = 模型未开通 |

> **安全网（必须保留）**：视频轨的探测请求在协议未来变化时**有可能真的创建任务**。
> 实现里对此的处理是：一旦响应里出现任务 id，**立刻 `DELETE` 取消**，并把
> 「意外创建了任务 X，已立刻取消；请到控制台确认无残留计费」写进 `message` —— 不许静默留下一个计费任务。

**凭据与红线**：与两条轨的实际调用完全一致 —— 只从请求头取（`X-Provider-Key` / `X-LLM-Key`），
不回落 query / body；响应中的一切上游文本先过 `security/redact.ts`。

---

## 10. 操作日志（V2.1 新增）

**定位**：开发者排错用的"**谁、何时、对什么、做了什么、结果如何**"。
与另外两处严格分工 —— pino/stdout 给运维看技术细节，`tasks` 表给用户看单任务结果，本表给开发者看操作序列。

**权限（用户 2026-09-23 拍板）**：**全员可见，不加额外权限**；公网仍由 Caddy 登录 + `PUBLIC_API_TOKEN` 两层保护（PLAN §7-4）。

**写入规则（噪声纪律，见 `backend/src/server/requestLog.ts`）**：

- **记**：所有 `/api/*` 的**写**请求（POST / PUT / PATCH / DELETE）与**任何失败**的请求（`status >= 400`，含读操作失败）；
- **不记**：`/media/*`（一次播放几十条 Range）、`/api/health`（探活）、`/api/logs*`（日志页自身轮询，否则自我增殖）、`OPTIONS` 预检、以及**成功**的读请求（任务进度每 2s 轮询一次，记下来会把日志淹掉）。

**字段**：

```ts
export interface EventLogEntry {
  id: number;
  ts: number;                 // 毫秒时间戳（前端按本机时区渲染）
  requestId?: string;         // 服务端请求 id；同时回写在响应头 x-request-id，报错截图可直接搜
  ip?: string;                // **明文**（用户拍板；仅存服务端 SQLite，随服务端备份一起走）
  method: string;
  path: string;
  action?: string;            // 语义动作 id（清单见 packages/shared/src/logs.ts 的 LOG_ACTIONS）
  statusCode?: number;
  durationMs?: number;
  taskId?: string;
  provider?: string;
  errorCode?: string;
  disposition?: string;
  userAgent?: string;
  body?: string;              // 截断后的请求体（JSON 原文；multipart 只记大小与类型摘要）
  detail?: Record<string, unknown>; // 白名单诊断字段：本次模型、上游 request id、上游报文截断
}
```

**存储与生命周期**：落 `data/app.db` 的 `event_log` 表（`ts` 倒序索引）。

- **全量保留，由用户手动删除**（用户拍板）；接口提供单条删除与按筛选清空；
- **代价如实登记**：长期使用会持续增长（无自动淘汰），见 PLAN §9 台账 **B23**；
- **凭据永不入库**：请求体与上游文本写入前一律过 `security/redact.ts`。

---

## 11. 配方库与轻剪辑台（V2.2 新增；**§11-1 配方库 = V9 · B8 已实现**、§11-2 剪辑台 = 【规划·B9】——后者实现前不得当作事实引用）

> 背景与决策：PLAN §4 Step 6、§6-D36（配方库双入口）/ D37（剪辑台 MVP、剪映导出砍掉）/ D38（抽帧→生成闭环）。
> **零 API 成本红线**：本节的一切都是本地 ffmpeg 或静态数据，**不产生任何上游调用**。

### 11-1 配方卡 `RecipeCard`（静态数据，放 `packages/shared/src/recipes.ts`）

配方是**数据，不是路由**：随前端 bundle 下发，前端直接读，**不设 `/api/recipes`**（要筛选用前端本地过滤；若日后要服务端筛选/自定义配方再加路由，并先改本节）。

```ts
export const RecipeCategorySchema = z.enum(['camera', 'lighting', 'mood', 'rhythm']); // 运镜/光线/氛围/节奏

export const RecipeCardSchema = z.object({
  id: string,                    // 'camera-push-in-slow' 之类，稳定、不可复用旧 id
  title: string,                 // 展示名（中文）
  category: RecipeCategorySchema,
  modes: GenerationMode[],       // 适用模式（如 ['t2v','i2v']）
  durationHint?: string,         // 建议时长文案，如 '5s 以内'
  skeleton: string,              // 「插入骨架」落到提示词框的文本（**逐字**，单测钉住）
  paramsHint?: {                 // 参数建议（只是建议，不强制改表单）
    aspectRatio?: AspectRatio;
    resolutionTier?: '480p' | '720p' | '1080p';
  };
  pitfalls?: string[],           // 已知坑（如实写，例如"该运镜在 5s 内容易走不完"）
});
```

- **双入口**（B8 实现时把口径钉死）：① 插入骨架 = 把 `skeleton` **原样追加**到提示词框**末尾**（框为空则直接写入；**刻意不做替换** —— 覆盖用户已写的主体描述属数据丢失，比"插不进去"更糟）；② ✨ 扩写 = 请求带 `recipeId`，服务端把该卡的 `skeleton + pitfalls` 注入 system prompt（§3），**用户原文仍原样作为 user message**。
- **诚实标记**：配方是"经验骨架"，**不得**在 UI 上承诺"用了就出大片"；`pitfalls` 为空时不得编造。

### 11-2 剪辑操作 `EditScript` 与 `POST /api/edits`

```ts
// 编辑决策清单（EDL）：对**已有成片**的时间轴操作序列，按顺序应用
export const EditOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('trim'),    startSec: z.number().min(0), endSec: z.number().min(0) }),
  z.object({ type: z.literal('concat'),  taskIds: z.array(z.string()).min(2) }),      // 与源片依次拼接
  z.object({ type: z.literal('xfade'),   transition: z.enum(['fade','wipeleft','slideright']), durationSec: z.number().min(0.1).max(2) }),
  z.object({ type: z.literal('volume'),  gain: z.number().min(0).max(2) }),           // 0 = 静音
  z.object({ type: z.literal('speed'),   factor: z.number().min(0.25).max(4) }),
  z.object({ type: z.literal('extractFrame'), atSec: z.number().min(0) }),            // 抽帧 → 落为参考资产（D38 闭环）
]);

export interface EditScript {
  sourceTaskId: string;                 // 源成片（必须 succeeded 且有成片文件）
  operations: EditOperation[];          // 1..8 个，按序执行
}

// POST /api/edits  请求体 = EditScript；响应 = { taskId }（**复用** §4 轮询，不新增进度路由）
```

**语义与约束**：
- 剪辑产物是一条**新的 `taskId`**，`TaskProgress` 增加 `origin: { kind: 'generate' } | { kind: 'edit', sourceTaskId: string, script: EditScript }`（§4/§7 同步）；画廊卡片据此显示"剪辑自 xxx"徽标。
- 执行器是**本地 ffmpeg**（复用 `lib/ffmpeg.ts` 的探测与中文报错），**并发 = 1**（与本地轨同一把互斥锁），无上游调用、无凭据需求、**不走防线 5 的 60s 冷却**（它防的是付费上游，本地 CPU 不在其列）。
- `extractFrame` 的产物落到 `outputs/assets/`（与上传资产同目录同规则），返回在任务的 `origin` 之外另记 `extractedAssetIds: string[]`；其余操作产物为 `outputs/<taskId>.mp4`（**重编码**，因为 trim/xfade 后帧边界与时间戳必须重建）。
- **失败归类**：输入非法 → `400 INVALID_REQUEST`；源任务不存在/无成 → `404 TASK_NOT_FOUND`；ffmpeg 不存在 → `503 PROVIDER_UNAVAILABLE`（如实说"本服务未装 ffmpeg"）；执行失败 → `500 UPSTREAM_ERROR` 语义无歧义故用 `retryable`。**没有 `uncertain`**：本地操作没有"不知道结果"的状态。

**生命周期**：剪辑产物与原片同规则（`outputs/`、画廊可见、删除即物理删除）；**EDL 随任务落库**（`tasks.edit_script` 列，JSON），删任务连 EDL 一起删；"本片剪辑历史" = 查 `origin.sourceTaskId = 本片` 的全部任务。
