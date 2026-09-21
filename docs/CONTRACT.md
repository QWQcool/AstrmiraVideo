# 数据契约（待冻结）

> **状态：草稿 · 未冻结**
> 按项目原则「契约先行」——本文件冻结后才开始写实现；冻结后任何改动需走评审。

## 为什么需要这份文档

流水线的每个环节都依赖同一组数据结构。如果契约不先定下来：
- 三条线（素材模式 / 模型模式 / 未来的画布视图）会各自发明自己的字段；
- 上游供应商一变更就会引发连锁修改；
- 无法写契约测试，回归全靠人肉。

## 待冻结清单

### 1. 流水线定义（DSL）`JobDefinition`

```ts
type CheckpointMode = 'none' | 'confirm'

interface StageDef {
  id: string               // 'script' | 'keywords' | 'footage' | 'tts' | 'subtitle' | 'compose' | ...
  type: StageType          // 决定由哪个实现执行
  params: Record<string, unknown>
  checkpoint: CheckpointMode
}

interface JobDefinition {
  version: 1
  stages: StageDef[]
  output: { ratio: '9:16' | '16:9' | '1:1'; resolution: string }
}
```

> **要求**：同一份 DSL 必须能被「一键执行器」「纵向步骤视图」「未来的画布视图」三种消费者共同读取。

### 2. 任务状态机 `JobStatus`

```
CREATED → QUEUED → RUNNING → (SUCCEEDED | FAILED | CANCELED)
                     ↑
                 PAUSED（命中 checkpoint，等待用户动作）
```

- 每个 stage 亦有独立状态，支持「只重跑这一步」。
- 状态迁移必须落 `job_events`（事件流），可重放、可断点恢复。

### 3. 画面获取契约 `FootageProvider`

素材模式与模型模式**共用同一接口**，只是实现不同：

```ts
interface FootageRequest {
  scriptSegment: string
  keywords: string[]
  durationSec: number
  ratio: string
  referenceImages?: string[]   // 模型模式可用
  seed?: number
}

interface FootageProvider {
  id: string                    // 'stock-pexels' | 'ark-seedance' | 'jimeng' | 'minimax' | 'comfyui'
  capabilities: ProviderCapabilities
  estimateCost(req: FootageRequest): CostEstimate
  submit(req: FootageRequest): Promise<{ providerTaskId: string }>
  poll(providerTaskId: string): Promise<ProviderTaskState>
  fetch(providerTaskId: string): Promise<ArtifactRef>
  classifyError(err: unknown): CanonicalErrorCode
}
```

`ProviderTaskState` 必须能区分三种结局：**可重试** / **终态失败** / **不确定（需人工核对，禁止自动重提）**。

### 4. 提示词契约 `ShotSpec` → 供应商提示词

- `ShotSpec`：与供应商无关的结构化描述（主体 / 场景 / 动作 / 镜头 / 光线 / 风格 / 音频 / 对白 / 负面）
- 编译产物：按目标供应商适配（默认对齐 MiniMax H3 官方 schema）
- 每次编译结果**版本化入库**，与任务关联，可回溯、可回滚

### 5. API 路由（草案）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/jobs/oneclick` | 一键创建并执行（素材模式） |
| POST | `/api/jobs` | 按自定义 DSL 创建 |
| GET | `/api/jobs/:id` | 任务详情（含各 stage 状态） |
| GET | `/api/jobs/:id/events` | SSE 事件流（进度推送） |
| POST | `/api/jobs/:id/stages/:stageId/rerun` | 只重跑某一步 |
| POST | `/api/jobs/:id/resume` | 命中检查点后继续 |
| GET | `/api/providers` | 供应商能力矩阵与价格 |
| GET/POST | `/api/credentials` | 用户自带 Key（BYOK）管理 |

### 6. 错误码规范

- 统一中文可读消息表，**不透传原始 JSON 给前端**
- 每个错误码标明：`retryable` / `terminal` / `uncertain`

---

## 冻结流程

1. 三方评审本文件（含字段级讨论）
2. 补契约测试 + fixtures（形状钉死）
3. 标记为「**已冻结 v1**」并记录日期与 hash
4. 实现开始；改动 → PR + 评审
