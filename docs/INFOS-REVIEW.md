# infOS / Pictoria 源码复核与可借鉴清单

> 复核对象：`https://github.com/YoKONCy/infOS`，本地 `C:\Users\v_chchsli\Desktop\infOS`。
> 本地与 `upstream/main` 一致：`4fa1424`（v0.9.4 后的发布/CI 修复）；`9afeb1e` 是 v0.9.4 的功能发布提交。
> 许可证：Apache-2.0。本文只记录**设计与可借鉴点**；若直接复制代码，按 Apache-2.0 在 NOTICE 记来源。
> 本轮只读源码，没有运行 infOS 的构建/测试。

## 1. 结论摘要

1. **Pictoria 是 infOS 的“画布 + 工作流”子应用**，核心不是画布本身，而是三件事：
   - **声明式外部服务** `ServiceProfile`：一个 JSON 描述 submit/poll/cancel/outputs/timeout/幂等；
   - **提交回执 + 不确定态**：`SubmissionJournal` + `uncertain` 节点状态 + `TaskRecovery` 弹层；
   - **Step/Workflow 的 schema、绑定、版本与发布**：技能/Agent 计划的现成结构参考。
2. **源码里没有内置 H3/MiniMax 视频模型**。内置视频模型是 Wan 2.6 / Grok Video 3 / Veo 3.1；`DEVELOPMENT.md` 明确写“尚无模型下载安装或 GPU 进程管理”。
   你们测通 H3 的路径大概率是 **`service.save` 自定义服务指向算力服务器**（或本地未提交的适配），不是 infOS 内置 H3 档。
3. 这与 D67 一致：**算力服务器跑模型 + HTTP 任务接口，应用只做提交/轮询/取产物**。本轮先落地一个**配置型 HTTP 任务服务**，把 submit → poll → output → cancel 用 mock 打通；H3 的真实工作流等拿到服务器协议后再填配置。

## 2. Pictoria 关键实现（源码位置）

| 能力 | 位置 | 做法 |
|---|---|---|
| 服务描述 | `packages/apps/pictoria/src/domain.ts:139-196` | `baseUrl`、认证、`submit`（path/body/bodyFormat/fields/taskIdField/outputs）、`poll`（stateField/success/failed）、`cancel`、`timeoutMs`、`recoveryWindowMs`、`idempotencyHeader/window` |
| 字段映射/请求 | `packages/apps/pictoria/src/serviceClient.ts:28-55,459-...` | 点路径 `field/assign`；`value/text/data_url/file` 四种格式；multipart；origin 固定；认证与普通 header 分离 |
| 提交回执 | `packages/apps/pictoria/src/submissionJournal.ts:6-62` | `prepared/sending/received/rejected` + payload fingerprint + 凭据 hash；发送前写回执；结果不明不自动重发 |
| 执行/恢复 | `packages/apps/pictoria/src/execution.ts:27-167,221-276,352-559` | 节点 `pending/running/submitted/saving/completed/failed/uncertain/cancelled/skipped`；退避、恢复窗口、持久化失败暂停、取消诚实 |
| 恢复 UI | `client/src/components/TaskRecovery.vue:58-95,163-185` | 待核验节点；填远程任务 ID 或勾选“已核验，需要重新提交（可能再次计费）”；两者都空时禁用 |
| 步骤/工作流 | `src/domain.ts:6-109`、`src/workflows.ts:58-129`、`src/workflowValidation.ts:205-230` | Step 三种实现（service/llm/workflow）、Workflow 节点绑定 stepRevision、typed input/output、循环/必填校验、发布 |
| 参考素材条 | `client/src/components/ReferenceInput.vue:89-160` | 序号、前移/后移、移除、数量上限、素材库选择器 |
| 资源库 | `src/library.ts:7-19,44-90` | prompt / materials / artworks；`final`、`favorite`、`tags`、`runId/stepId/model/inputs` 溯源 |
| 单 Agent 工具 | `src/manifest.ts:84-104` | 只投影一个 `pictoria` 工具；操作 `catalog/run/get/list/cancel/resume/canvas`；能力门控 |

## 3. 本轮直接落地的“通用 HTTP 任务服务”

### 3.1 范围（刻意最小）

- **只做后端 provider + 配置文件 + `/status`**；不做服务编辑器 UI、不做资产删除、不做协作。
- 支持的协议：`POST/GET submit → taskId → GET/POST poll → outputs`，也支持**同步**（submit 直接返回产物）。
- 支持 `image` / `video` 产物（写 `/media/<file>`），不支持独立音频/多产物。
- 认证：`tokenEnv` 指向环境变量；JSON 里**不落 token**。
- 地址：沿用 `isAllowedEngineUrl`（回环 / RFC1918）；公网算力服务器走 VPN/Tailscale 或后续单独加白名单，不直接放开。
- 幂等：配置 `idempotencyHeader` 时把服务端 taskId 作为幂等键发给上游；不回执/自动重发（回执/uncertain 留给 S4-R2）。

### 3.2 配置形状（`HTTP_SERVICES_FILE`）

```json
[
  {
    "name": "h3-gpu",
    "label": "H3 算力服务器",
    "baseUrl": "http://10.0.0.12:9000",
    "modes": ["t2v", "i2v"],
    "tokenEnv": "H3_GPU_TOKEN",
    "authHeader": "Authorization",
    "authPrefix": "Bearer ",
    "submit": {
      "path": "/v1/jobs",
      "method": "POST",
      "body": { "model": "minimax-h3" },
      "fields": {
        "prompt": { "from": "prompt", "format": "text" },
        "aspect_ratio": { "from": "aspectRatio" },
        "duration": { "from": "durationSec" },
        "first_frame": { "from": "assets.firstFrameImage", "format": "data_url" }
      },
      "taskIdField": "id"
    },
    "poll": {
      "path": "/v1/jobs/{id}",
      "stateField": "status",
      "success": ["succeeded"],
      "failed": ["failed", "cancelled"]
    },
    "cancel": { "path": "/v1/jobs/{id}/cancel", "method": "POST" },
    "outputs": {
      "video": { "path": "result.video_url", "kind": "video" }
    },
    "idempotencyHeader": "Idempotency-Key",
    "timeoutMs": 1800000,
    "requestTimeoutMs": 60000
  }
]
```

- `modes` 决定 `/status` 与前端引擎过滤；未声明的模式在提交时如实拒绝。
- `fields.from` 支持：`prompt`、`mode`、`aspectRatio`、`width`、`height`、`durationSec`、`frames`、`steps`、`seed`、`assets.firstFrameImage`、`assets.lastFrameImage`、`assets.referenceVideo`。
- `format`：`value`（原值）、`text`（字符串）、`data_url`（下载为 data URL）、`file`（multipart）。
- `outputs.kind` 只接受 `image` / `video`；`path` 为空表示整个响应体就是媒体字节。

### 3.3 与 AstrmiraVideo 现有契约的差异

- 新增 provider 基类型 `http-service`，具名实例 `http-service:<name>`；
- `/status` 新增 `httpServices` 段（id/label/modes/available/reason，不下发地址与 token）；
- `executedBy` 新增 `remote`（“远程服务”），队列仍走 `cloud` 并发桶（`TrackId` 不改）；
- 不新增错误码：复用 `PROVIDER_UNAVAILABLE / KEY_MISSING / KEY_INVALID / UPSTREAM_ERROR / UNCERTAIN_RESULT / TASK_NOT_FOUND`；
- 契约版本 **V2.47**；S4-R1b 的 revision/409 顺延为 **V2.48**（尚未实施）。

## 4. 后续可借鉴（不本轮做）

| 时点 | 借鉴点 | 落点 |
|---|---|---|
| **S4-R2（P0）** | `SubmissionJournal` 的 `prepared/sending/received/rejected` + `uncertain` + `TaskRecovery` 交互 | 提交回执表、批次“待核验”、填远程 ID/确认重试；不自动新建任务 |
| **S4-R2（P0）** | 退避/恢复窗口/取消诚实 | 只对安全请求重试；取消未确认时如实说明 |
| **S6-A（P1）** | Step/Workflow/binding/publish/校验 | 技能 = 版本化 step/workflow；应用只填草稿；Agent 计划用同一套校验 |
| **S6-B（P1）** | 单工具 + 操作枚举 + 能力门控 | 一个画布工具，不暴露一堆私有工具 |
| **S5-B1（P1）** | `ReferenceInput` 的编号/排序/上限/选择器 | 首帧/尾帧/参考视频的可见顺序；不扩“全能参考” |
| **S5-A/B3（P2）** | `final`、参数溯源、prompt/material/output 分库 | “最终稿”与参数来源；不扩成三类库 |

## 5. 不照搬

- Electron / NodeHost / ApplicationLease / 每应用 SQLite：我们是单进程后端，不需要。
- 500 轮 ReAct、终端托管、社交/NapCat、Vue 组件：与视频创作无关。
- 把画布改成通用 DAG 执行器：Pictoria 的工作流编辑器是它的产品核心；我们的画布是媒体编辑 + 生成任务。
- 通用 service 层在没有真实端点前继续膨胀（服务编辑器、模型市场、GPU 进程管理）——本轮只做配置与调用。

## 6. 来源与许可

- infOS：Apache-2.0；复核基线 `4fa1424`。
- 本仓若直接复制/改写其代码，按 Apache-2.0 在 `NOTICE` 保留来源与许可证指针；只在概念层借鉴的部分在实现注释里指回本节。
