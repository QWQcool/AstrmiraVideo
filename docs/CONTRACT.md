# 数据契约与接口定义（CONTRACT）

> **状态：V1.3 · 已冻结（变更需先改本文，再改代码）**
> 本规范是前后端接口的**唯一权威**，定义核心数据流：【文本描述 + 参考图/参考视频 → 云端API(火山Seedance) / 本地推理(MiniMax H3) → 视频产出】。
> 任何文档或代码与本文冲突时，以本文为准。
> **V1.3 修订（2026-09-22）**：① 错误码由 `retryable: boolean` 升级为三态 `ErrorDisposition`，新增 `UNCERTAIN_RESULT` 且**禁止自动重提**（§6）；② 新增幂等键与提交前 `submitting` 标记（§5、§7）；③ `VideoGenerateRequest` 新增 provider 私有参数 `options`（§1）；④ 明确可选实现项（OI）的实现边界（§4）。改动同步落 PLAN §3 防线 7 与 §4「Step 2 补充」。

---

## 1. 任务请求契约 `VideoGenerateRequest`

```ts
export type GenerationMode = 't2v' | 'i2v' | 'fl2v' | 'v2v';
export type AspectRatio = '16:9' | '9:16' | '1:1'; // 1:1 仅云端可选，本地 H3 支持度【待验证】
export type ProviderType = 'cloud-volcano-seedance' | 'local-minimax-h3';

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

服务端自动探测本地算力，向前端返回可用能力矩阵：

```ts
export type HardwareTier = 0 | 1 | 2 | 3; // 分级定义见 GUIDE.md §一

export interface ProviderStatus {
  cloud: {
    available: boolean;
    provider: 'volcano-seedance';
    reason?: string;
  };
  local: {
    available: boolean;
    provider: 'minimax-h3';
    tier: HardwareTier;
    gpuName?: string;
    vramFreeGB?: number;
    reason?: string; // 无 GPU 时提示“未检测到本地 GPU 推理环境，推荐使用云端 API”
  };
  defaultProvider: ProviderType; // Tier 0 时固定为 'cloud-volcano-seedance'
}
```

---

## 3. 提示词扩写接口契约 `PromptEnhance`

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
| `GET` | `/api/health` | 存活探针 |
| `GET` | `/api/providers/status` | 算力探测状态（Tier 0 默认锁定云端；**旧名 `/api/system/probe` 已废弃**） |
| `POST` | `/api/generate` | 创建视频生成任务，返回统一 `taskId`（受 60s 防抖限流） |
| `GET` | `/api/tasks/:taskId` | 轮询任务状态与结果 |
| `POST` | `/api/tasks/:taskId/cancel` | 取消任务（仅 `queued` / `running` 可取消） |
| `POST` | `/api/prompt/enhance` | 提示词扩写助手（轻量 LLM / 规则引擎） |
| `POST` | `/api/upload` | 上传参考图/视频，自动 32 倍数居中裁切，返回资产 ID |
| `GET` | `/api/history` | 历史视频列表（含完整参数快照用于回填） |
| `DELETE` | `/api/history/:taskId` | 删除单条历史并释放磁盘 |

**幂等键与「即将提交」标记（V1.3 新增）**：
- `POST /api/generate` 必须接受幂等键（请求头 `Idempotency-Key`；缺省时服务端按 `provider + 请求指纹` 生成）。同一幂等键重复提交返回**同一 `taskId`**，不得产生第二次上游调用。
- 服务端在**真正向上游提交之前**先落库一条 `submitting` 标记，提交成功后写回上游 `taskId`。进程重启或网络中断后，凭该标记即可判定「到底提交出去没有」。
- 这是 §6 `UNCERTAIN_RESULT` 与 PLAN §3 防线 7 能够落地的**前提**：没有 `submitting` 标记，就无法区分「没提交」与「提交了但不知道结果」。

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

**V1.3 三条硬规则**：

1. **`uncertain` 是唯一必须人工核对的分支**。任何自动重试都可能造成上游**重复计费**。前端必须提示「**可能已产生费用，请到服务商后台核对后手动处理**」，并提供「标记为已核对 / 放弃任务」动作（Step 3 落地）。
2. **上游无响应 / 超时一律归 `UNCERTAIN_RESULT`，不得归入 `UPSTREAM_ERROR`**。`UPSTREAM_ERROR` 仅用于上游明确返回错误响应的场景——这条区分是三态护栏能否生效的关键。
3. 三态与 PLAN §3 **防线 7（付费不确定性不自动重提）**配套，二者改动必须同时进行。

---

## 7. 存储与资产生命周期（PLAN §6-D5 的落地细则）

| 数据 | 存储 | 生命周期 |
| :--- | :--- | :--- |
| 任务状态 + 参数快照 + 画廊元数据 | SQLite（`data/app.db`，better-sqlite3） | 持久，服务重启可恢复 |
| 幂等键 → taskId 映射 | SQLite（同上） | 持久；同一键重复提交返回同一任务（§5） |
| `submitting` 提交标记 | SQLite（同上） | 提交前写入、成功后写回上游 taskId；重启后据此判定是否已提交（§5，防线 7 前提） |
| 成片 MP4 | `outputs/`（已入 .gitignore） | 画廊 LRU 淘汰 + 前端一键删除 |
| 上传的参考资产 | `outputs/assets/<assetId>` | 关联任务删除时一并清理 |
| 中间帧 / 临时音频 | `outputs/.tmp/<taskId>/` | 合成结束立即物理删除（防线 3） |
| 前端任务 ID 锚点 | 浏览器 `localStorage` | 刷新后凭 ID 向服务端重挂载进度 |
