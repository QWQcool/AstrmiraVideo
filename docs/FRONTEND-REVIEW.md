# 前端框架与适配性复盘（2026-10-10）

> **本文的唯一职责**：回答三个问题 —— **① 我们用什么技术做的？② 天生有移动端适配能力吗？
> ③ 有没有必要换成"成熟框架"？** 结论与决策记录在 [PLAN §6-D46 / D47](PLAN.md)（本文只给判断与证据）。
>
> 定语：**这是一次"体检"，不是一次改版**。体检结论若显示"该动刀"，另立 Step 与 AC（本文只登记待办编号）。

---

## 一、结论速览（先看这三句）

| 问题 | 结论 |
|---|---|
| 用什么框架？ | **不是 Ajax/jQuery**，也**不是"全家桶"**：前端是 **React 19 + Vite 6 + TypeScript** 的 SPA，网络层是**原生 `fetch`**（"Ajax" 是一种技术手法，不是一个框架；本项目的实现是 fetch + zod 校验）；后端是 **Fastify 5 + Node 22 + better-sqlite3**；两端共用 `packages/shared` 的 zod 契约。路由与状态是**自研轻量件**（hash 路由 + `useSyncExternalStore`），样式是**手写全局 CSS**。 |
| 天生移动端适配？ | **有底子、没做完**。`viewport` 标准可缩放、断点/流式栅格/抽屉式侧栏都在，**浏览态"勉强能看"**；但**剪辑台时间轴、血缘画布、日志表格**在 375px 下溢出或被隐藏，拖拽上传与 hover 操作在触屏失效 → **"手机能看能点，不能剪片"**（如实定位，见 D47）。 |
| 要换成熟框架吗？ | **不换**（D46）。理由与"什么条件下才该换"见 §五 —— 关键点是：当前痛点的根因**不是框架**（是产品形态与交互密度），换框架能买到的东西（路由/表单/样式体系）**本仓已经用 500 行自研件+约定覆盖**，而搬迁成本是"全部视图 + 剪辑台 + 冒烟断言"级别的。 |

---

## 二、技术选型现状（逐层点名，含证据）

### 2.1 前端：React 19 SPA，刻意"零全家桶"

| 层 | 现状 | 说明与证据 |
|---|---|---|
| 视图 | React **19** + Vite **6** + TS | `frontend/package.json` |
| 路由 | **自研 hash 路由**（`#/create`、`#/edit?task=x`），未用 react-router | `frontend/src/lib/router.ts`（`parseHash` / `navigate` / `useHashRoute`）；视图表在 `frontend/src/views/registry.ts` |
| 状态 | **自研两层**：壳级 `Context`（`lib/shell.ts`）+ 剪辑台 `useSyncExternalStore`（`edit/store.ts`），未用 redux/zustand/jotai | 全仓 grep 只命中"为什么不引 zustand"的注释 |
| 网络 | **唯一入口** `frontend/src/lib/api.ts`，原生 `fetch`，响应**一律过 shared 的 zod schema** | 未用 axios / react-query |
| 样式 | **手写全局 CSS**（6 个文件，`tokens.css` 定变量 + 主题 `data-theme`），未用 Tailwind / CSS-in-JS | `frontend/src/styles/*.css`；`workbench.css` 单文件 50KB |
| 能力级依赖 | **Remotion**（浏览器端合成/导出，剪辑台的形态由它决定）、**@xyflow/react**（血缘画布）、**zod** | `frontend/package.json` |
| 入口 | `main.tsx` 极薄：`StrictMode` + `<App/>`；**全仓无 ErrorBoundary**（如实登记，见 §六-①） | `frontend/src/main.tsx` |

### 2.2 后端：单体 Fastify + 四个守护进程

`backend/src/index.ts` 的 `buildApp()` 是唯一装配点：插件 → 路由（15 个域）→ 四个后台守护进程
（任务调度器 / 容量淘汰器 / Webhook 投递 / 日志保留）→ `onClose` 按"先停表再关库"顺序收尾。
存储是 **better-sqlite3 手写 SQL**（无 ORM），迁移是**手写增量列迁移**（`store/db.ts` 的
`COLUMN_MIGRATIONS` + `POST_MIGRATION_INDEXES`）。生产形态是**单进程**同时托管
`/api/*` + `/media/*` + 前端产物，前面一个 Caddy 做 TLS 与登录（`Dockerfile` / `deploy/`）。

### 2.3 共享契约：一套 schema 两边用

`packages/shared` 是**前后端共用的事实源**：Fastify 直接把它当 validator/serializer
（`backend/src/index.ts`），前端把它当响应断言（`frontend/src/lib/api.ts`）。
**这是本项目最有价值的结构性选择** —— 它让"接口漂移"这类最常见的联调事故在两侧都变成编译/运行期错误。

### 2.4 工程与防线（选型"轻"，但防线"重"）

- **单测**：后端 504 项（逐文件覆盖率门限 17 个文件）、前端 202+ 项（含静态"视觉自检"）；
- **契约测试**：`pnpm test:contract` 双向比对 CONTRACT §5 路由表与真实注册路由；
- **UI 冒烟**：`pnpm smoke:ui` 真 Chrome 跑生产形态（CSP 生效），断言界面动作 → 服务端留痕整条链；
- **CI**：lint（oxlint）→ type → 契约 → 覆盖率 → 构建 → UI 冒烟 → 截图 artifact；2026-10-22 起暂停自动触发，改为手动 `workflow_dispatch`；部署需显式 `deploy=true`。

> 一句话：**框架选型是"能省则省"，但七道防线一样没落。** 这套组合的代价要如实说：
> 没有 ORM/迁移框架，改表要人手守"改表必须走 ALTER"的纪律（`SCHEMA` 在 ALTER 之前执行，
> 索引必须放 `POST_MIGRATION_INDEXES` —— 这个坑我们真踩过）；没有 router 库，
> "深链接/回退/刷新"这类路由细节要自己写对（见 §六-②）。

---

## 三、移动端适配体检（有证据，不靠感觉）

**总判定：浏览态"勉强能看"，生产/编辑态"基本不可用"。**

### 3.1 已经有的（不是从零开始）

| 项 | 现状 |
|---|---|
| viewport | `<meta name="viewport" content="width=device-width, initial-scale=1.0">`，**可缩放**（未锁 `user-scalable`） |
| 断点 | 三档：`1180px`（三栏 → 单栏）、`768px`（抽屉式侧栏 + 单列 + 字号/间距收口）、`1800px`（大屏加宽） |
| 流式手段 | `min()/max()` 容器宽（`min(1180px, 96vw)`）、`repeat(auto-fill, minmax(300px, 1fr))` 卡片栅格、若干 `flex-wrap` |
| 触屏可用的交互 | **剪辑台片段拖动/裁边、播放头拖动已经用 Pointer Events**（`edit/TimelineClip.tsx`、`edit/Timeline.tsx`）→ 触屏本可用；上传有"点击选择文件"兜底 |
| 降级 | `prefers-reduced-motion` 有降级（`tokens.css`） |

### 3.2 卡在哪（按"手机用户会立刻撞上"排序）

| # | 问题 | 证据 | 后果 |
|---|---|---|---|
| ① | **日志表格固定六列**（合计 ≥650px） | `styles/workbench.css` 的 `.wb-log-row-main { grid-template-columns: 150px 46px 92px minmax(240px,1fr) 130px auto }` | 375px 屏必横向溢出，且全局 `overflow-x: hidden` 让它"被剪掉"而不是"可横滑" |
| ② | **血缘画布在窄屏直接 `display: none`** | `styles/canvas.css` 的 `@media (max-width: 768px) { .cv-canvas { display: none } }` | 手机上看不到画布（诚实但生硬：应该有"提示 + 横屏/桌面建议"，而不是空白） |
| ③ | **拖拽上传是 HTML5 DnD** | `views/CreateView.tsx` / `components/AssetDropZone.tsx` 的 `onDrop/dataTransfer` | 触屏拖不动（有"点击选择"兜底，但引导话术仍以拖拽为主） |
| ④ | **hover-only 操作** | `.wb-card-thumb-button:hover .wb-card-play`、`.lib-card:hover .lib-acts` | 触屏无 hover，操作入口"看不见或很淡" |
| ⑤ | **字号偏小** | `tokens.css`：`--fs-note: 11px`、`--fs-micro: 10px`（全局 50+ 处使用） | 手机上正文/标签可读性差 |
| ⑥ | **`100vh` 布局** | `index.css` / `workbench.css` / `edit.css` | 移动浏览器地址栏收放会顶掉底部（应用 `100dvh`） |
| ⑦ | **无触屏特有处理** | 全仓 0 处 `pointer: coarse` / `hover: none` / `touch-action`（仅剪辑台片段一处）/ `safe-area-inset` | 刘海屏、下拉刷新、双击缩放等边界都没处理 |
| ⑧ | 键盘快捷键无触屏替代 | `EditView.tsx`（Delete/Space）、`CreateView.tsx`（Enter/Esc） | 手机上删除片段只能点按钮（有按钮，属可接受） |

### 3.3 若要做手机端，代价最低的前 5 项（已登记为台账 **B60**）

1. 日志行 ≤768 改单列（或给横向滚动容器）——**纯 CSS，30 分钟**；
2. 补 `@media (hover: none)` 让 hover-only 操作常显 + `-webkit-tap-highlight-color`；
3. ≤768 重定义 10~11px 档字号为 ≥12px；
4. `100vh` → `100dvh`（3 处）；
5. 画布窄屏给"提示 + 桌面/横屏建议"而不是空白。

> 这 5 项做完，手机端是**合格的"查看 + 轻操作"终端**（看片、审片、下载、改参数），
> **仍然不是剪辑终端** —— 时间轴 + 画布 + 双栏检查器在 390px 上做不出专业手感，
> 这是产品形态决定的，不是 CSS 能解决的（D47）。

---

## 四、这套选型的真实成本（如实说，不粉饰）

**买到的**：零框架锁定的心智负担、依赖树极小（前端直接依赖 6 个）、CSP 干净（无外链字体/无 CDN）、
单进程部署简单（一个容器 + 一个卷）、契约单一事实源。

**付出的**（都是正在付的账，不是"可能的"）：

| 账 | 表现 | 已经怎么缓解 |
|---|---|---|
| 没有 router 库 | 深链接/回退/刷新/`?query` 都要自己写对；`#/edit?task=` 这类参数解析散在视图里 | 收口在 `lib/router.ts` + `views/registry.ts`，有单测 |
| 没有状态库 | 跨视图共享要靠 Context + 手动订阅 | 壳级状态收在 `lib/shell.ts`（一个 Context 解决）；剪辑台用 `useSyncExternalStore` |
| 没有 UI 组件库 | 每个控件手写（含 popover、抽屉、toast、时间轴） | 设计 token + 组件目录约定；但**无 ErrorBoundary**、无统一 focus trap |
| 没有 ORM/迁移框架 | 改表靠纪律（`SCHEMA` 先于 ALTER、索引单独一步） | 有"改表必走 ALTER"的成文经验 + 集成测试覆盖 |
| 手写 CSS 无作用域 | 类名靠前缀约定（`wb-`/`ed-`/`cr-`/`cv-`），靠 50KB 单文件承载 | 按域分文件；但**重排一次布局要通读 CSS** |

---

## 五、要不要换成"成熟框架"？（结论：不换，并写明"什么条件下才换"）

### 5.1 逐项回答"换个框架能买到什么"

| 候选 | 想解决的问题 | 换的成本 | 判断 |
|---|---|---|---|
| **react-router**（或 TanStack Router） | 深链接、嵌套路由、代码分割的规范性 | 低-中（视图注册表 + 全部导航点；冒烟断言里 `location.hash` 相关要改） | **可选，非必要**。当前 hash 路由已覆盖"五个一级视图 + 剪辑台带参"，痛感不足；**若将来要"分享某条片子的深链接给客户/做 SEO/做多级嵌套"**，再换（台账 B28 已登记） |
| **zustand / jotai** | 跨视图状态 | 中（要拆现有 Context 与 store） | **不需要**。壳级状态只有一个 Context，剪辑台已有可用的 store 抽象 |
| **Tailwind / shadcn/ui** | 视觉一致性与开发速度 | **高**（50KB 手写 CSS 与 6 个视图全量重排；且会引入新的构建与 CSP 面） | **不做**。现有 token + 主题体系已能支撑独特视觉（对齐 `frontend-design` 的取向）；Tailwind 会显著改变产物体积与样式排查方式 |
| **Next.js / Nuxt（SSR 全栈框架）** | SEO、首屏、服务端渲染 | **极高**（部署形态从"单进程 + Caddy"变成 Node server + 构建链；本项目是**私有化内网工具 + 登录墙**，SEO 无收益） | **不做** |
| **Vue / Svelte 重写** | 无 | **极高**（全部视图 + 剪辑台 + 画布 + 全部前端测试） | **不做**（纯亏） |
| **组件库（Ant Design 等）** | 表单/表格/日期选择器 | 中-高（与现有视觉体系冲突；且我们要的是"工作台"不是"后台管理表格"） | **不做**；若将来 B 端要做"项目管理/审批"这类**表格密集**界面，再评估"局部引入" |

### 5.2 可判定的"该换"条件（写下来，避免以后拍脑袋）

只有同时满足**两条以上**才值得考虑搬迁，且必须另立 Step + AC：

1. 出现**必须 SSR / 必须 SEO** 的需求（例如对外营销站要复用同一套界面）；
2. 路由/深链接成为**客户投诉点**（例如客户要"把某条片子的审片页直接发给同事"）；
3. 手写 CSS 导致**同类视觉缺陷反复出现**（同一类对齐/间距问题在 3 个以上视图重复发生）；
4. 团队人数增长到"新人不读 CSS 约定就写不对"（当前是单人 + AI 会话，约定成本为零）。

**当前这四条一条都不成立** → **不换**（D46）。

---

## 六、体检顺手发现的"真问题"（与框架无关，单独登记）

| # | 问题 | 影响 | 处置 |
|---|---|---|---|
| ① | **全仓无 ErrorBoundary** | 任一视图渲染抛错 → 整页白屏（当前靠单测 + 冒烟覆盖，但没有"兜底展示 + 上报 requestId"的最后一层） | 登记台账 **B61**（低成本，建议与 B60 同批） |
| ② | `main.tsx` 无全局加载/错误边界，`Suspense` 只在剪辑台懒加载处 | 同上（懒加载失败时没有友好降级） | 并入 B61 |
| ③ | `overflow-x: hidden` 掩盖了真实溢出 | 溢出**不会**报错，只会被剪掉（日志页那条就是） | B60-① 修根因；B61 可加"窄屏无横向溢出"的自动化断言（与 B15 同族） |
| ④ | 手写 CSS 单文件 50KB | 改一处布局需要通读；容易撞名 | 维持（D46）；若触碰 3 次以上再考虑按域拆分 |

---

## 七、项目结构（一屏看懂）

```
AstrmiraVideo/
├── backend/src/          Fastify 单体：routes(15 域) / store(SQLite) / providers(上游)
│                         queue(队列+双轨调度) / pipeline(防线 3-4 与剪辑执行)
│                         security(鉴权·凭据·限流·脱敏) / webhook(终态回调)
│                         ops(备份恢复 CLI + 服务锁) / observability(运维快照)
├── frontend/src/         React SPA：views(一级视图) / components / edit(Remotion 剪辑台)
│                         canvas(血缘画布) / lib(路由·api·凭据·项目·交付包) / styles(手写 CSS)
├── packages/shared/      **前后端共用的 zod 契约**（接口 / 错误码 / 剪辑工程 / 成本 / 命名…）
├── deploy/               compose + Caddyfile（域名档 / IP 档）——两容器：app + caddy
├── docs/                 PLAN(规划·唯一权威) / CONTRACT(接口) / GUIDE(上手) / 本文 等
├── scripts/              冒烟 / 本地验收服务 / 夹具 / 部署 / **文档截图** / 基准
├── tests/fixtures/       夹具片段（gitignored，由脚本现场合成）
└── Dockerfile            单进程镜像（Node 22 + ffmpeg）
```

> 详细职责以 §二 与 `docs/PLAN.md` §3 架构段为准；**本文不重复维护结构图**（单一事实源）。

---

## 八、本次体检产出的动作项

| 编号 | 内容 | 状态 |
|---|---|---|
| **B59** | README 配图换成**真实截图**（`scripts/capture-docs-shots.mjs`，可复现） | **本次完成** |
| **B60** | 移动端 5 项低成本收口（日志单列 / hover 兜底 / 字号下限 / `dvh` / 画布提示） | **已完成 2026-10-10**（实做 4 项；画布提示此前已有；证据 = PLAN §5「B60」） |
| **B61** | 全局 ErrorBoundary + 懒加载失败降级 + "窄屏无横向溢出"断言 | **片 A 已完成 2026-10-10**（两层兜底 + 懒加载 error 分支；片 B 与窄屏溢出断言待 N2）；证据 = PLAN §5「B61 · 片 A」 |
| **D46 / D47** | 框架不换 / 移动端定位为"浏览态" | 已在 PLAN §6 记录 |

---

## 附：复现本报告的体检方法（别人可以自己验）

```bash
pnpm build
node scripts/capture-docs-shots.mjs            # 真机截图（桌面 1440×900 + 手机 390×844）
pnpm smoke:ui                                  # 真实浏览器断言（含 CSP、控制台零 error）

# 响应式与触屏证据（命令行即可复现本文清单）
rg -n "@media"            frontend/src/styles
rg -n "onDrop|onDragOver|draggable" frontend/src
rg -n "hover"             frontend/src/styles | head
rg -n "pointer: coarse|hover: none|touch-action|dvh|safe-area" frontend/src
```
