# 数据契约与接口定义（CONTRACT）

> **状态：V1.2 · 已冻结（变更需先改本文，再改代码）**
> 本规范是前后端接口的**唯一权威**，定义核心数据流：【文本描述 + 参考图/参考视频 → 云端API(火山Seedance) / 本地推理(MiniMax H3) → 视频产出】。
> 任何文档或代码与本文冲突时，以本文为准。

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
    retryable: boolean;
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

**通信方式**：MVP 使用轮询（`GET /api/tasks/:taskId`，建议 2s 间隔）；SSE 实时推送为【规划】，Step 4 后评估（决策记录 PLAN §6-D7）。

---

## 6. 错误码字典 `ErrorCode`

| code | 触发场景 | retryable |
| :--- | :--- | :--- |
| `PROVIDER_UNAVAILABLE` | 所选引擎健康检查失败（如无卡选本地） | 否（换引擎） |
| `GPU_BUSY` | 本地队列已有任务在执行 | 是（自动排队，无需重试） |
| `RATE_LIMITED` | 60s 防抖窗口内重复提交 | 是（等待冷却） |
| `INVALID_ASSET` | 资产格式无法清洗 / 32 倍数规整失败 | 否 |
| `PROMPT_REJECTED` | 提示词为空 / 超长 / 台词超长引导未确认 | 否 |
| `UPSTREAM_ERROR` | 云端 API 或本地推理进程报错 | 视 message 而定 |
| `TASK_NOT_FOUND` | taskId 不存在或已清理 | 否 |
| `DISK_FULL` | 输出目录磁盘不足 | 否（清理后重试） |

---

## 7. 存储与资产生命周期（PLAN §6-D5 的落地细则）

| 数据 | 存储 | 生命周期 |
| :--- | :--- | :--- |
| 任务状态 + 参数快照 + 画廊元数据 | SQLite（`data/app.db`，better-sqlite3） | 持久，服务重启可恢复 |
| 成片 MP4 | `outputs/`（已入 .gitignore） | 画廊 LRU 淘汰 + 前端一键删除 |
| 上传的参考资产 | `outputs/assets/<assetId>` | 关联任务删除时一并清理 |
| 中间帧 / 临时音频 | `outputs/.tmp/<taskId>/` | 合成结束立即物理删除（防线 3） |
| 前端任务 ID 锚点 | 浏览器 `localStorage` | 刷新后凭 ID 向服务端重挂载进度 |
