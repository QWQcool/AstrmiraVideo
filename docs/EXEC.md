# AstrmiraVideo · Step 1.5 地基整改执行手册（EXEC）

> **定位**：Step 2 开工前的地基整改，一次性手册；全部任务完工并经 PLAN §5 记录后，本文件从 README 文档地图中移除归档。
> **读者**：接手执行的 AI 助手。**先读 README 六条协作规范，再读本手册，最后读 CONTRACT.md 与 PLAN.md 对应章节。**
> **铁律**：发现本手册与 CONTRACT / PLAN 矛盾时，**停止施工，向用户上报矛盾点**，不得自行取舍。

---

## 0. 整改背景（为什么有 Step 1.5）

2026-09-22 审计结论：文档纪律与代码纪律已分叉，Step 2 的 8 条 AC（契约测试 / 幂等 / 故障注入）全部建立在未打牢的地基上。具体问题清单：

| # | 问题 | 证据 | 对应整改任务 |
|---|---|---|---|
| P0-1 | 占位探针恒真 + 硬编码显卡型号，违反 PLAN §1 架构原则与 §6-D12 | `backend/src/index.ts` `/api/providers/status` 写死 `available: true` / `gpuName: 'NVIDIA GeForce RTX 4060 Ti'` / `vramFreeGB: 16` | T1 |
| P0-2 | 假测试：断言测试内部手写字面量，删除后端服务照样绿 | `backend/src/index.test.ts` | T4 |
| P1-1 | 前后端类型三处手写（App.tsx / index.ts / CONTRACT.md），monorepo 无共享契约包 | `frontend/src/App.tsx` 手写 `ProviderStatus` interface | T2 |
| P1-2 | zod 已装零使用，D4「schema 校验一等公民」未兑现 | `backend/package.json` deps 有 zod，`src/index.ts` 无 import | T3 |
| P1-3 | 前端 inline style 硬编码色值（`#f87171` / `#34d399` / `#10141c` / `#090c12`）绕过 token 体系，8 个 keyframes 只用 2 个 | `frontend/src/App.tsx` styles 对象 | T5 |
| P1-4 | 调度器无可替换队列抽象，Step 2 若直接写死 SQLite 操作，未来多实例部署需返工 | 尚无 `queue/` 目录 | T6 |
| P1-5 | **字体方向偏离视觉参考稿**：`--serif` 指向 Cinzel（罗马碑铭体、大写主导），而参考稿（`docs/assets/01_main_workspace.jpg` 与 Astrmira 站点）的字标是**大小写混排的高对比衬线**；PLAN §7 的原始实测记录为 `Georgia,"Noto Serif","Songti SC"` | `frontend/src/styles/tokens.css` `--serif: "Cinzel", ...` + `frontend/index.html` 的 Google Fonts 链接 | T5 |
| P1-6 | **eyebrow 标签体系缺失**：参考稿最具辨识度的元素（极小字 + 极大字距 + 全大写 + 短横线段）在实现中完全不存在 | `frontend/src/App.tsx` styles 对象 | T5 |

**决策依据（已写入 PLAN §6-D18 ~ D21，施工时不得翻案）**：D18（shared 契约包）/ D19（fastify-type-provider-zod）/ D20（SQLite + JobQueue 抽象，不引 Redis）/ D21（公网最小鉴权与限流键，代码侧随 Step 2 / Step 5 落地）。

---

## 1. 任务总览与实施顺序

```
T1 占位探针去硬编码 ──► T2 shared 契约包 ──► T3 zod 路由校验 ──► T4 真实 inject 测试
                                                            └──► T5 前端 token 化（可与 T3/T4 并行）
                                                            └──► T6 JobQueue 接口骨架（可与 T3/T4 并行）
```

T2 是 T3 / T4 的前置（schema 来源）；其余可按图并行。

---

## T1 · 占位探针去硬编码（backend）

**改动文件**：`backend/src/index.ts`

**要求**：
1. `/api/providers/status` 的 `local` 一律返回 `available: false`，`reason: '本地算力探测尚未实现（Step 2 接入真实探针）'`，`tier: 0`；**禁止出现任何具体显卡型号、显存数字**；
2. `cloud.available` 按 **CONTRACT §2** 语义判定（V1.6 起）：`!!(env.VOLCANO_API_KEY || 会话内存中的 BYOK Key)`——Step 1.5 阶段会话存储尚不存在，以空 stub 代替（永远为空），但代码结构必须留出第二入口；`available: true` 时回传 `keySource: 'env' | 'session'`；未配置时 `reason: '未配置火山方舟 Key，请在前端设置抽屉或 .env 中填入'`；`defaultProvider` 固定 `'cloud-volcano-seedance'`；
3. 注释保留「占位实现，Step 2 由 statusProbe 真实探测替换」。

**AC1**：检索 `backend/src` 内 `geforce` / `4060` / `vramFreeGB: 16` **零命中**（工具无关：`rg`、`Select-String` 均可；**本项目在 Windows + PowerShell 环境下没有 `grep`**）。
**AC2**：无 `.env` 时 `GET /api/providers/status` 返回 `cloud.available: false` + `local.available: false`，且两者均带 `reason`；配置 env Key 后 `cloud.available: true` 且 `keySource: 'env'`。
**验证**：`curl http://localhost:3000/api/providers/status` 人工核对 + AC1 的 grep。

---

## T2 · shared 契约包（类型单一事实源，D18）

**新建**：`packages/shared/`（pnpm workspace 第三包）

**要求**：
1. `pnpm-workspace.yaml` 的 packages 增加 `packages/*`；
2. `packages/shared/package.json`：`"name": "@astrmira/shared"`，`"type": "module"`，`exports` 指向**构建产物**（`"types": "./dist/index.d.ts"`，`"default": "./dist/index.js"`），`scripts.build: "tsc"`（shared 自带 tsconfig，`outDir: dist`）；**禁止引 tsup/rollup**——tsc 直出不算 bundler；
   ⚠️ **为什么必须出 dist 而不是直接导出 `./src/index.ts`**：backend 的生产形态是 `tsc` + `node dist/index.js`，`tsc` 不会把 node_modules（workspace 软链）里的 `.ts` 源码编译进 dist（rootDir 冲突直接报错）。直出源码只在 `tsx watch` 下能跑，`pnpm build` 当天就挂——T2 的 AC 与根 DoD 都过不了；
3. 根 `package.json` 的 `build` 改为构建顺序前置：`pnpm --filter @astrmira/shared build && pnpm --filter backend build && pnpm --filter frontend build`；
4. `packages/shared/src/` 内按 CONTRACT.md **逐节翻译为 zod schema**，schema 即唯一事实源，类型一律 `z.infer` 导出：
   - `request.ts`：`GenerationModeSchema` / `AspectRatioSchema` / `ProviderTypeSchema`（**含 OI 两个 id，见 CONTRACT §1，V1.5 起**）/ `VideoGenerateRequestSchema`；
   - `status.ts`：`HardwareTierSchema` / `ProviderStatusSchema`（**含 `cloud.keySource`，见 CONTRACT §2，V1.6 起**）；
   - `progress.ts`：`ErrorDispositionSchema` / `ErrorCodeSchema`（9 个码全量）/ `TaskProgressSchema` / `VideoProvider` interface（interface 用 TS 原生，方法签名与 CONTRACT §4 一致）；
   - `health.ts`：`HealthResponseSchema`（形状见 **CONTRACT §8，V1.7 新增**）；
   - `enhance.ts`：`PromptEnhanceRequestSchema` / `PromptEnhanceResponseSchema`；
   - `index.ts` 统一 re-export；
5. `backend/package.json` 与 `frontend/package.json` 的 dependencies 增加 `"@astrmira/shared": "workspace:*"`；
6. `frontend/src/App.tsx` **删除手写的 `BackendHealth` / `ProviderStatus` interface**，改为 `import type { ProviderStatus, HealthResponse } from '@astrmira/shared'`（两者均已在 CONTRACT §2 / §8 定义，**无需再改契约**）；
7. 后端 `/api/health`、`/api/providers/status` 返回前用对应 schema `.parse()` 一次（T3 落地后改为 response schema 序列化，此处是过渡）。

**AC1**：`pnpm install` 后前后端 `tsc --noEmit` 均通过，且 `frontend/src/App.tsx` 中不存在任何 `interface ProviderStatus` / `interface BackendHealth` 本地声明。
**AC2**：故意把 shared 中 `ProviderStatusSchema` 某字段改名，前后端 `tsc` 同时报错（验证单一事实源真正生效），随后改回。
**验证**：`pnpm build` 全绿 + AC2 的破坏性测试。

---

## T3 · zod 路由校验落地（D19）

**改动文件**：`backend/package.json`、`backend/src/index.ts`（路由拆分见下）

**要求**：
1. 引入 `fastify-type-provider-zod`，`fastify.withTypeProvider<ZodTypeProvider>()`；⚠️ **该库的 major 版本与 Fastify 大版本绑定**——安装后必须确认其 peer 声明支持 **Fastify 5**（本项目 `fastify ^5.2.1`），勿被默认 latest 带到面向 Fastify 4 的分支；
2. `/api/health` 与 `/api/providers/status` 挂 `schema: { response: { 200: ... } }`，schema 来自 `@astrmira/shared`；
3. 路由拆分为 `backend/src/routes/health.ts`、`backend/src/routes/providers.ts`，`index.ts` 只留装配（register + listen），为 Step 2 的 6 条新路由建立目录惯例；
4. CORS `origin: true` 收紧为读 `process.env.CORS_ORIGINS`（逗号分隔，默认 `http://localhost:5173`）——PLAN §7-6 的第一步。

**AC1**：`GET /api/providers/status` 返回体被 response schema 序列化；临时把 handler 返回一个 schema 外字段，响应中该字段被剥离或报错（验证序列化生效），随后恢复。
**AC2**：`pnpm --filter backend build` 通过；未配置 `CORS_ORIGINS` 时仅允许 `http://localhost:5173` 来源。
**AC3**：`backend/package.json` 中 `fastify-type-provider-zod` 的版本经确认支持 Fastify 5（构建 + inject 测试通过即为证）。
**验证**：curl + 破坏性测试 + 构建。

---

## T4 · 真实 inject 测试（替换假测试）

**改动文件**：`backend/src/index.test.ts`（重写）、`backend/src/index.ts`（导出 app 工厂）

**要求**：
1. `index.ts` 拆出 `buildApp(): Promise<FastifyInstance>`（register 全部插件与路由但不 listen），`listen` 仅在直接运行时执行（`import.meta.url` 判定或拆 `server.ts` 入口，二选一，保持 `tsx watch` 可用）；
2. 测试改用 `app.inject()`：
   - `GET /api/health` → 200 且 body 通过 `HealthResponseSchema.parse()`；
   - `GET /api/providers/status` → 200 且 body 通过 `ProviderStatusSchema.parse()`，且 `local.available === false`、body 中不含 `GeForce` 字样（防 T1 回退的回归断言）；
3. 删除原「断言手写字面量」的假测试。

**AC1**：`pnpm test` 全绿；把 `index.ts` 中 health 路由注释掉，测试变红（验证测试真实命中路由），随后恢复。
**AC2**：测试不依赖任何监听端口（`inject` 不起服务）。
**验证**：`pnpm --filter backend test` + AC1 破坏性测试。

---

## T5 · 前端 token 化（消灭 inline 硬编码色）

**改动文件**：`frontend/src/styles/tokens.css`、`frontend/src/App.tsx`、`frontend/index.html`

**要求**：
1. `tokens.css` 补语义 token：`--success: #34d399`、`--danger: #f87171`、`--on-action: #090c12`（`--action-fill` 上的文字色）、`--on-segment: #10141c`、`--canvas: #05070a`（播放器底）；
2. `App.tsx` styles 对象中所有硬编码十六进制色值替换为 `var(--*)`；
3. **字体修正（P1-5，并入本任务）**：
   - `--serif` 去掉 Cinzel，改为**大小写混排的高对比衬线**，起手值与 PLAN §7 原始实测记录一致：`Georgia, "Noto Serif SC", "Songti SC", serif`；
   - 新增 `--serif-caps: "Cinzel", serif`——**Cinzel 仅用于全大写 eyebrow 标签**（碑体在全大写场景下才合适）；
   - `frontend/index.html` 的 Google Fonts 链接相应调整：Cinzel 若仅 eyebrow 使用，只保留所需字重；
4. **eyebrow 标签体系（P1-6，并入本任务）**：`tokens.css` 新增 `--fs-eyebrow: 11px`、`--track-caps: 0.18em`；`App.tsx` 中现有的品牌标签 / 分区 / 状态文案改用 eyebrow 样式（全大写 + 极小字 + 大字母间距，字号与字距取自 token，不硬编码）；
5. **边界**：**不拆组件、不新增区块、不加功能**——组件拆分、keyframes 落位、卡片索引号、水印均属 Step 3 范围（PLAN §4 Step 3 已承接）；
6. **【连带修复，唯一例外】**：`selectedEngine` 为 `'local'` 但探针返回 `local.available: false` 时回退 `'cloud'`——T1 改完后该分支成为真实可达路径，不修则按钮置灰但状态卡在 local。除本项外**不加任何功能**。

**AC1**：`frontend/src/App.tsx` 中检索 `#[0-9a-fA-F]{3,8}` **零命中**（`tokens.css` / `index.css` 除外；工具无关，`rg` / `Select-String` 均可）。
**AC2**：T1 完成后无 GPU 环境下，本地引擎按钮置灰且 `selectedEngine` 不为 `'local'`。
**AC3**：`--serif` 不再指向 Cinzel；`tokens.css` 中 `Cinzel` 仅出现于 `--serif-caps`，且 `App.tsx` 内不出现任何直接书写的字体名（一律走 token）。
**AC4**：`App.tsx` 中至少 1 处文案使用 eyebrow 样式，且字号 / 字距来自 token。
**验证**：检索 + `pnpm --filter frontend build` + 人工开箱，**与 `docs/assets/01_main_workspace.jpg` 并排目视对比一次**（字体与标签气质是本任务的验收对象）。

---

## T6 · JobQueue 接口骨架（D20，只立契约不写实现）

**新建**：`backend/src/queue/JobQueue.ts`

**要求**：
1. 定义接口（注释引用 PLAN §6-D20 与 CONTRACT §7）：

```ts
// 队列抽象：当前由 SQLite 实现承载（Step 2），
// 多实例公网部署时可替换为 BullMQ 适配器，调度器不得感知差异。
export interface JobQueue {
  submit(job: QueueJob): Promise<{ taskId: string }>;          // 幂等键去重由实现保证
  claim(track: 'cloud' | 'local'): Promise<QueueJob | null>;   // 原子领取；local 轨 Concurrency=1；
                                                                // 必须显式排除 uncertain / terminal 态任务
  heartbeat(taskId: string, progress: TaskProgress): Promise<void>;
  complete(taskId: string, output: { videoUrl: string }): Promise<void>;
  fail(taskId: string, error: TaskProgress['error']): Promise<void>;

  // 仅允许「尚未提交上游」的任务回队列重跑——凭 CONTRACT §5 submitting 标记判定：
  // 无上游 taskId 才可 requeue。已提交但结果不明的任务禁止走此路径（防线 7）。
  requeue(taskId: string): Promise<void>;

  // 已提交上游但结果不明（轮询中断 / 进程重启 / 上游超时）→ 归 UNCERTAIN_RESULT，
  // 终态待人工核对；任何自动领取/重跑路径不得消费此状态（PLAN §3 防线 7 / CONTRACT §6）。
  markUncertain(taskId: string, error: TaskProgress['error']): Promise<void>;
}
```

> ⚠️ **为什么拆两支（防线 7 的接口层落地）**：若只有笼统的 `requeue`，进程重启后「running 但无心跳」的任务会被无差别回队列——对云端轨而言，一个已提交 Seedance、正在计费的任务会被自动重跑 = **重复扣费**。`submitting` 标记（CONTRACT §5）就是区分「没提交」与「提交了但不知道结果」的判据：前者可安全 requeue，后者只能 markUncertain 走人工核对。

2. `QueueJob` 类型引用 `@astrmira/shared` 的 `VideoGenerateRequest`；
3. **本任务只交接口 + JSDoc**，SQLite 实现属 Step 2 公共链路，禁止提前实现。

**AC1**：`pnpm --filter backend build` 通过；接口文件不含任何 `better-sqlite3` import。
**AC2**：接口含 `requeue` 与 `markUncertain` **两个独立方法**，且 `requeue` 的 JSDoc 明确「仅限未提交上游（凭 submitting 标记判定）」、`claim` 明确排除 uncertain / terminal 态——防止防线 7 在接口层被静默绕开。
**验证**：构建 + 人工 review 接口是否覆盖 CONTRACT §5 全部任务生命周期。

---

## 2. 完工验收（DoD）

1. T1~T6 全部 AC 通过；
2. `pnpm install && pnpm build && pnpm test` 一次通过；
3. **文档同步（协作规范 4 / 6，必须同 commit）**：
   - PLAN §5 进度日志：Step 1.5 标记完成，当前指针改「Step 2 待开工」；
   - README 徽章改回 Step 2 待开工、快速开始段去掉 EXEC 提示、文档地图移除本文件行；
   - NEXT_SESSION_PROMPT 当前指针改 Step 2；
   - 若施工中对 CONTRACT 有任何字段级改动：先改 CONTRACT（升版本号 + 修订说明），再改代码，并在 PLAN §5 记录；
4. 全仓检索 `geforce` / `4060` / 本机用户名 / 绝对路径，零命中（脱敏红线回检）。

## 3. 明确不做（防止范围蔓延）

- 不实现任何 provider（OI-1 / OI-2 / Seedance / H3）——Step 2 范围；
- 不实现 SQLite 队列、幂等键、防抖限流——Step 2 范围；
- 不拆前端组件、不做 SSE、不引状态管理库——Step 3 / Step 4 范围；
- 不做 keyframes 落位、卡片索引号、空态与页脚水印——**Step 3 范围**（PLAN §4 Step 3 已承接，本手册只做字体与 eyebrow 的基础层）；
- 不引入 Redis / BullMQ / Postgres——D20 已定，多实例部署前不议。
