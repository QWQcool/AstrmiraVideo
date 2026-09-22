# 数据契约与接口定义（CONTRACT）

> **状态：V1.8 · 已冻结（变更需先改本文，再改代码）**
> **V1.8 修订（2026-09-22）**：探针降级与 BYOK 通道定稿（D22 / D23 / D27），文本侧 LLM 配置缺口登记为 V2.0【规划】（D24），三态适用范围收窄（D28）。
>   ① **§2**：`cloud.available` 口径收窄为「服务端视角（仅 env）」；`keySource` 收窄为可选字面量 `'env'`；新增 `acceptsClientKey`（服务端是否接受 `X-Provider-Key`，恒 true，托管场景可关）；`local` 段**删除** `gpuName` / `vramFreeGB`，`tier` 改为可选且语义为「**显式配置并自检通过**的引擎档位」——本端点在 V1.8 起为**纯配置事实陈述**，不含任何自动硬件扫描。
>   ② **§3**：LLM 配置与 `engine` 字段登记为 **V2.0【规划】**；demo 版 `/api/prompt/enhance` 以 `501 LLM_NOT_CONFIGURED` 诚实落地（禁止静默降级 / 规则引擎冒充）。
>   ③ **§5**：路由表新增 `GET /media/*`（`outputs/` 的 Range 静态媒体服务）与 `POST /api/providers/keys/verify`（【规划·B2】）；新增「**凭据传递约定**」注记段——`X-Provider-Key` / `X-LLM-Key` 仅走请求头，禁 query / URL / body；服务端**零留存**（不落库、不入日志、不回显）。
>      **补登（S2 落地时）**：`/api/generate`、`/api/tasks/:taskId`、`/cancel`、`/api/history`、`DELETE /api/history/:taskId` 的**响应形状**已随实现补入路由表，类型以 `packages/shared/src/api.ts` 为单一事实源（此前只写语义描述、无形状定义）。
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
    referenceVideo?: string;      // v2v 风格/动作迁移参考
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
  defaultProvider: ProviderType; // 初始建议值（V1.8：不再由 Tier 判定推导）
}
```

> **`EXPOSE_HOST_LOCAL_TRACK`（V1.8 新增）**：env 开关，**默认 `0`**。为 `0` 时本地轨对访客不可用（`local.available:false` + 上述第二类 `reason`）；部署者自用需显式置 `1` 并配置 `H3_WORKDIR` / `COMFYUI_BASE_URL`（白名单校验见 PLAN §7-2）。host 本地轨的 scope 与防线落点见 PLAN §6-D26。

---

## 3. 提示词扩写接口契约 `PromptEnhance`

> **V1.8 状态：demo 版未实现（PLAN §9 台账 B3）**。本路由当前以 **`501` + `LLM_NOT_CONFIGURED`** 诚实落地（前端 ✨ 置灰），**不得**用任何"规则引擎"冒充 AI（静默降级红线，PLAN §3 铁律 4）。
> **V2.0【规划】**：新增 `LlmConfig`、`PromptEnhanceRequest.llm?`、`PromptEnhanceResponse.engine: 'llm' | 'rules'`（必填）与 `notice?`；凭据走请求头 `X-LLM-Key`（见 §5「凭据传递约定」）。决策依据见 PLAN §6-D24。

```ts
export interface PromptEnhanceRequest {
  originalPrompt: string;
  style?: 'cinematic' | 'anime' | 'commercial' | 'realistic';
  mode?: GenerationMode;
}

export interface PromptEnhanceResponse {
  enhancedPrompt: string;
  cameraMovementSuggested?: string;
  lightingSuggested?: string;
}
```

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
  warnings?: string[];            // 用户可见的非阻断告警（如"素材短于请求时长，已循环播放"、"循环素材自带音轨，已静音"）
                                  // 与 message（进度描述）职责分离：可并存多条、不随进度刷新被覆盖、随任务记录持久化
  requestSnapshot: VideoGenerateRequest; // 完整请求快照，供画廊一键回填
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
```

> **可选实现项（OI）的实现边界**：`stock-local`（素材）与 `fixture-local`（CI 夹具）**必须实现与上面完全相同的接口**，不得新增专属请求字段、不得改变接口形状、不得要求调用方分支判断；其私有参数一律走 `options`。注册点为 `providers/registry.ts`，默认关闭（env `ENABLE_STOCK_PROVIDER`），能力位由 `GET /api/providers/status` 下发——前端不得硬编码具体 provider。详见 PLAN §4「Step 2 补充」。

---

## 5. 前后端 REST API 路由（唯一路由权威）

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| `GET` | `/api/health` | 存活探针（响应形状见 §8；**任何来源**均免鉴权，见 PLAN §7-4） |
| `GET` | `/api/providers/status` | **本服务本地引擎配置状态**（V1.8：纯配置事实陈述，非硬件探测；**旧名 `/api/system/probe` 已废弃**） |
| `GET` | `/media/*` | **V1.8 新增**：`outputs/` 静态媒体服务（成片直链，播放器与下载的 **206 Range** 载体）；路径只含服务端生成的随机 ID，不含任何用户输入 |
| `POST` | `/api/generate` | 创建视频生成任务（凭据经 `X-Provider-Key`，见下方注记段）。**200 → `{ taskId }`**（幂等：同一 `Idempotency-Key` 或缺省指纹重复提交返回同一 `taskId`）；引擎未实现 / 未启用 → **503 `PROVIDER_UNAVAILABLE`**；60s 防抖限流属 S4 |
| `GET` | `/api/tasks/:taskId` | 轮询任务状态与结果。**200 → `TaskProgress`（§4）**；不存在或已清理 → **404 `TASK_NOT_FOUND`** |
| `POST` | `/api/tasks/:taskId/cancel` | 取消任务（仅 `queued` / `running` 可取消）。**200 → `{ ok, taskId }`** |
| `POST` | `/api/prompt/enhance` | 提示词扩写助手 —— **demo 版返回 `501` + `LLM_NOT_CONFIGURED`**（前端 ✨ 置灰）；完整实现见 §3 的 V2.0【规划】 |
| `POST` | `/api/upload` | 上传参考图/视频，自动 32 倍数居中裁切，返回资产 ID（加固细则见 PLAN §7-6） |
| `GET` | `/api/history` | 历史视频列表（含完整参数快照用于回填）。**200 → `{ items: TaskProgress[] }`**（最近 50 条） |
| `DELETE` | `/api/history/:taskId` | 删除单条历史并**释放磁盘**。**200 → `{ ok, taskId }`**；不存在 → 404 `TASK_NOT_FOUND` |

**幂等键与「即将提交」标记（V1.3 新增）**：
- `POST /api/generate` 必须接受幂等键（请求头 `Idempotency-Key`；缺省时服务端按 `provider + 请求指纹` 生成）。同一幂等键重复提交返回**同一 `taskId`**，不得产生第二次上游调用。
- 服务端在**真正向上游提交之前**先落库一条 `submitting` 标记，提交成功后写回上游 `taskId`。进程重启或网络中断后，凭该标记即可判定「到底提交出去没有」。
- 这是 §6 `UNCERTAIN_RESULT` 与 PLAN §3 防线 7 能够落地的**前提**：没有 `submitting` 标记，就无法区分「没提交」与「提交了但不知道结果」。

**凭据传递约定（V1.8 新增，决策 PLAN §6-D23）**：
- **唯一载体是请求头**：视频轨 `X-Provider-Key`、文本轨 `X-LLM-Key`（后者随 V2.0 启用）。**禁止**出现在 query、URL path、body 或 cookie 中。
- **服务端零留存**：只用不存——不落 SQLite、不写日志（pino `redact` 必须覆盖相应请求头）、不回显明文；错误响应也必须保证不含 Key 片段。日志或响应中出现 Key 明文 = **发布级缺陷**。
- **状态端点不表达客户端凭据**：`GET /api/providers/status` 无凭据上下文，其 `cloud.available` 只表示 env 兜底 Key 是否存在；"前端是否持有 Key"由前端自行合成（§2 的 `acceptsClientKey` + 本地存储）。
- **写入 / 清除无服务端路由**：Key 存于浏览器，清除即清本地存储。凭据校验路由（`keys/verify`）与本地引擎运行时自检（`local/verify`）**均未实现**，属 PLAN §9 台账 **B2 / B4**；实现时必须先在本节登记。
- `Idempotency-Key` 与上述两个凭据头一样，必须在 CORS `allowedHeaders` 中显式放行，否则浏览器预检直接失败（本地 curl 通、浏览器必失败）。

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
| `LLM_NOT_CONFIGURED` | 扩写未配置 LLM（demo 版恒返回，`/api/prompt/enhance` → `501`） | `terminal` |
| `KEY_INVALID` | 凭据被上游拒绝（首次真实调用时产生；校验路由见 PLAN §9 台账 B2） | `terminal` |
| `KEY_MISSING` | 需要凭据的端点既未收到 `X-Provider-Key`，服务端也无 env 兜底 Key | `terminal` |

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
| 成片 MP4 | `outputs/`（已入 .gitignore） | 画廊 LRU 淘汰 + 前端一键删除 |
| 上传的参考资产 | `outputs/assets/<assetId>` | 关联任务删除时一并清理 |
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
