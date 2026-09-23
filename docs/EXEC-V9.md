# AstrmiraVideo · V9 前端改版执行手册（EXEC）

> **性质**：一次性执行手册（2026-09-23 定稿），供执行会话逐片施工。
> **生命周期**：Step 6（V9）验收通过后**归档删除**，历史从 git 取回 —— 沿用 Step 1.5 `EXEC.md` 与 `EXEC-STEP2-5.md` 的惯例。
> **所有权边界（违反即返工）**：本手册只拥有"**怎么切片、每片怎么验**"。接口形状一律以 `docs/CONTRACT.md`（**V2.2**）为准、任务与 AC 以 `docs/PLAN.md` §4 Step 6 为准、决策理由以 PLAN §6（D33~D38）为准、参考图以 `docs/assets/` 为准。**不得**把契约类型或 AC 正文复制进代码注释或其它文档，引用时写「见 CONTRACT §11」「见 PLAN §4 Step 6-AC3」。

## §0 执行前必读（按顺序）

1. `README.md` —— 协作规范 1~10 与两条施工流程纪律（脱敏 / 单一事实源 / 每步带 AC / 一致性自检 / 三级标记 / 进度回检 / 契约先行 / 探针不下结论 / Key 零留存 / 不静默降级）；
2. `docs/PLAN.md` §4 Step 6（任务与 AC1~AC8）、§5 进度日志（当前指针）、§6 D33~D38；
3. `docs/CONTRACT.md` V2.2 修订说明、§3（`recipeId`）、§5 路由表（`/api/edits`）、**§11（配方库与剪辑台的完整形状）**；
4. `docs/assets/README.md` 与其中的参考图（01~03 早期概念稿 / 04~06 V9 概念稿 / 07~10 即梦·可灵·shadcn 实截图）；
5. 本手册。

**动手前先汇报**：① 你对基线与切片顺序的理解；② 你在文档间发现的矛盾（先列矛盾再请示，**不要自行选边**）；③ B1 原型稿的预览方式。

## §1 全局纪律

1. **零 API 成本红线**：V9 全程**不调用任何付费上游**（剪辑台 = 本地 ffmpeg；配方库 = 静态数据）。禁止运行 `pnpm smoke:paid`（那是另一把 Key 的事）。
2. **契约先行**：施工中发现契约要改 → **先改 CONTRACT 并上报**，获准后再改代码；版本号随改动升（V2.2 → V2.3 …）。
3. **shared 重建纪律**：改 `packages/shared/src/**` 后必须 `pnpm --filter @astrmira/shared build`，否则后端还在跑旧契约（PLAN §8 避坑第 2 条，本项目最常踩）。
4. **门禁（每片提交前必过）**：`pnpm lint && pnpm type && pnpm test:contract && pnpm test:coverage && pnpm --filter frontend test` 全绿 + `pnpm build` + `pnpm smoke:ui`（UI 冒烟跑在 `NODE_ENV=production` 产物上，生产 CSP 是真的生效的）。
5. **提交粒度**：一片一提交（conventional commits 英文摘要），不合并跨片提交；**同一提交内回检三处指针**：README「快速开始」段、PLAN §5、`NEXT_SESSION_PROMPT.md`。
6. **证据格式（每片完工必交）**：AC 逐条 → 命令 → 输出摘录 → 判定；破坏性验证：做了什么破坏 → 哪条断言失败（粘贴）→ 还原后复跑通过；不许用"应该/大概"，未实测标【待验证】。
7. **凭据纪律**：本 Step 不需要任何 Key；若临时需要线上/上游验证，**停下来上报**，不自行申请或硬编码。
8. **分支**：直接在 `main` 上按片推进。

## §2 现状文件地图（施工起点，2026-09-23 实测）

**前端**（`frontend/src/`）：
- `App.tsx` —— 单页三栏壳 + 全部状态装配（改造主战场：B2 把它拆成"壳 + 视图"）；
- `components/` —— `LeftPanel`（控制台）/ `CenterPanel`（播放器+进度）/ `RightPanel`（队列+画廊）/ `GalleryCard` / `AssetDropZone` / `ByokDrawer`（凭据抽屉，保留形态）/ `LogPanel`（操作日志，**弹层形态**，B5 把它视图化）/ `ProgressRing` / `UncertainNotice` / `Eyebrow`；
- `lib/` —— `api.ts`（含 `enhancePrompt`，V2.0 起带 `llm` 配置）/ `byok.ts`（双轨凭据）/ `assets.ts`（槽位↔模式纯函数）/ `theme.ts`（双主题）/ `storage.ts`；
- `styles/` —— `tokens.css`（**设计 token + 双主题**；原型稿必须复用它。⚠️ 原稿此处写"19 个"是陈旧数字：2026-09-23 核对实际有 60+ 个自定义属性，含派生色 / 字号 / 几何 / 缓动 / 字体栈 —— **一律以文件为准**）/ `workbench.css` / `index.css`；
- `hooks/useTaskPolling.ts` —— 2s 轮询（预览与生成共用，零额外上游请求）。

**后端**（`backend/src/`）：`routes/`（`generate` / `tasks` / `history` / `upload` / `providers` / `enhance` / `keysVerify` / `logs` / `health`）；`lib/ffmpeg.ts`（探测 + 中文报错，剪辑台复用）；`pipeline/thumbnail.ts`（抽帧，剪辑台的 extractFrame 复用其思路）；`store/db.ts`（SQLite + 列迁移机制 `COLUMN_MIGRATIONS`，`edit_script` 列走它）；`queue/dispatcher.ts`。

**契约包**（`packages/shared/src/`）：`api.ts`（请求/响应 schema）/ `progress.ts`（`TaskProgress` + 错误码）/ `enhance.ts`（`LLM_PRESETS` + 扩写 schema）/ `recipes.ts`（**B8 新增**）/ `videoModels.ts`。

**参考实现**：`scripts/smoke-ui.mjs`（UI 冒烟，B6/B7 要往里加断言）；`backend/vitest.config.ts`（覆盖率门限，新模块要补）。

## §3 切片施工卡（B1 → B10，顺序不许调）

### B1 · HTML 高保真原型稿（**人工闸门**：用户确认后才进 B2）
- **目标**：用**真实** `tokens.css` / 字体 / 双主题写静态原型（不是 AI 图），覆盖三视图：总览 / 生成工作台（侧栏收起态）/ 视频库（含详情抽屉）。
- **产出**：`docs/ui-proto/index.html`（单文件，可直接 `file://` 打开或任意静态服务预览；**不进 bundle、不被前端构建引用**）。
- **必含**：左侧栏（展开/收起两态切换按钮）、顶栏精简形态（logo + 服务状态点）、四个一级视图位（总览/生成工作台/视频库/操作日志）、侧栏底部区（凭据设置/主题切换/折叠）。
- **AC**：用户在浏览器里看过并**明确确认**；确认项含「默认视图是 `#/overview` 还是 `#/workbench`」。**用户确认前禁止进 B2。**
- **闸门结果（2026-09-23 已确认，四处拍板）**：① 配方库为**第 5 个一级视图** `#/recipes`（不做工作台内的面板）；② 剪辑台为**更彻底的独立视图** `#/edit`（源片经 hash 查询参数 `?task=<id>`，**不是**路径参数，故**不触发**台账 B28；不进侧栏，空态引导）；③ 默认视图 = `#/workbench`；④ 总览四卡按**方案 A** 落地（最小契约增量 → CONTRACT V2.3：暴露 `TaskProgress.createdAt`（`tasks.created_at` 列本就存在，零迁移）+ `outputSizeBytes`（后端 stat）+ `/api/history` 的 `storage` 目录级聚合——在 B3 内做）。
- **提交**：`docs(proto): high-fidelity V9 prototype with real tokens`（cf466dc；闸门确认后的增补改动见同一片后续提交）。

### B2 · 应用壳：侧栏 + 自写 hash 路由 + 视图注册表【已完成 2026-09-23】
> 实测：门禁全绿（lint 0 / type 0 / 前端 74 / build / UI 冒烟）；破坏性验证命中（删 `#/library` 注册项 → 落兜底非白屏，还原后冒烟全绿）。冒烟新增 **[1b] 应用壳**断言组。
- **改动**：新增 `frontend/src/lib/router.ts`（hash 解析 + `hashchange` 监听 + `navigate()`，约 40 行；**hash 查询参数（`#/edit?task=<id>`）由视图自己读**，**路径参数 `#/library/:taskId` 不做**——那是台账 B28 的迁移触发条件）；新增 `frontend/src/views/registry.ts`（**数据化**：`[{ path, title, icon, component, hidden? }]`——剪辑台 `hidden:true` 不进侧栏）；新增 `components/Sidebar.tsx`（展开 240px / 收起 56px 图标栏，状态存 `localStorage`，移动端行为在 B7）；`App.tsx` 重构为「顶栏（logo + 服务状态）+ Sidebar + 内容区按路由渲染」；现有三栏**原样**搬进 `views/WorkbenchView.tsx`；顶栏的 日志/主题/凭据 入口移到侧栏底部区。
- **AC**：PLAN §4 Step 6-AC1（五视图 + 剪辑台可切、刷新保持、前进后退可用）。
- **破坏性验证**：临时把 `#/library` 从注册表删掉 → 访问该 hash 必须落到"未知视图"兜底（不许白屏）。
- **提交**：`feat(shell): sidebar + hand-rolled hash router with a data-driven view registry`。

### B3 · 总览页【已完成 2026-09-23】
> 含**契约 V2.3** 最小增量（createdAt / outputSizeBytes / storage）+ 心跳载荷收窄为 `TaskProgressUpdate`。实测：冒烟 [6b] 四卡对账全绿；破坏性验证（UTC 日界）命中；门禁 lint 0 / type 0 / 前端 86 / 后端 307 / 视觉自检 / UI 冒烟。
- **改动**：`views/OverviewView.tsx`；数据全部来自既有 `GET /api/history` 与 `GET /api/logs`（前端聚合：今日生成数、成功率、队列中、存储占用），**不新增后端路由、不造成本指标**（PLAN §6-D33 注记）。
- **细节**：存储占用卡带「去清理」→ `navigate('#/library')` 并带上"按大小排序"的状态；最近成片九宫格点卡片 → `#/library` 对应详情；最近操作 feed → `#/logs`。
- **AC**：Step 6-AC2（四卡数字可与原始 API 逐一对账；空态文案）。
- **测试**：聚合逻辑是纯函数（`lib/overviewStats.ts`），单测覆盖"空列表 / 全失败 / 进行中"三态。
- **提交**：`feat(overview): dashboard view aggregating existing history and logs APIs`。

### B4 · 视频库升级【已完成 2026-09-23】
> 实测：过滤/排序纯函数 10 条单测；冒烟 [6c] 对账全绿（搜索空态 / 筛选对账 / 时间正序对账 / 复用参数完整回填）；门禁 lint 0 / type 0 / 前端 96 / 后端 307 / 视觉自检 / UI 冒烟。跨视图回填走 `#/workbench?reuse=<taskId>`（零共享状态）。
- **改动**：`views/LibraryView.tsx`（现 `RightPanel`/`GalleryCard` 的画廊部分迁入）；工具条（搜索=提示词模糊 / 筛选=状态+模式 / 排序=时间+大小）；**详情抽屉**（完整参数快照 + 复用参数/下载/删除；`origin.kind==='edit'` 时显示"剪辑自 xxx"徽标与 EDL 历史位——B9 才填数据，本批先留位）；卡片上预留 ✂ 入口位（B9 才接线，本批不显示）。
- **AC**：Step 6-AC4。
- **破坏性验证**：搜索词改成「不存在词」→ 必须出现空态而非全部卡片。
- **提交**：`feat(library): search/filter/sort toolbar and a detail drawer`。

### B5 · 操作日志视图化
- **改动**：`components/LogPanel.tsx` → `views/LogsView.tsx`（组件主体复用，去掉弹层背板，加页面头）；顶栏原入口删除；有错误条数时侧栏项带红点（复用现有逻辑）。
- **AC**：过滤/分页/导出/删除在视图形态下全部可用；日志页自己的轮询**不产生日志**（噪声纪律，CONTRACT §10）。
- **提交**：`feat(logs): promote the operation log from overlay to a first-class view`。

### B6 · 界面级动效体系（PLAN §6-D35）
- **改动**：`styles/workbench.css` + 各视图；7 项全部落功能位：侧栏收展过渡 / 视图切换 fade+slide / 卡片 40ms 级联入场 / 生成中呼吸+播放器微光晕 / `star-gather` 提级到播放器中央可重播 / 卡片 hover 2px 浮起+金描边 / 加载 shimmer 骨架。
- **纪律**：只用 transform/opacity；`prefers-reduced-motion: reduce` 下**全部归零**；keyframes 零孤置。
- **AC**：Step 6-AC3；UI 冒烟新增 reduced-motion 断言。
- **破坏性验证**：删任一 keyframes 的挂接 → 冒烟红。
- **提交**：`feat(motion): interface-level motion system with reduced-motion zeroing`。

### B7 · 移动端响应式
- **改动**：≤768px：侧栏 → 汉堡唤出的 overlay 抽屉；工作台三栏 → 纵向堆叠（控制区在前）；画廊网格 1 列；详情抽屉 → 全屏。
- **AC**：Step 6-AC7；UI 冒烟加 390×844 档断言。
- **提交**：`feat(mobile): responsive shell with overlay drawer sidebar`。

### B8 · 提示词配方库（CONTRACT §11-1 / PLAN §6-D36）
- **改动**：`packages/shared/src/recipes.ts`（`RecipeCardSchema` + **首批 ≥20 张**，运镜/光线/氛围/节奏 各 ≥5；文本自写，可借鉴 video-shotcraft 的卡片**结构**，不抄内容；UPSTREAM.md 登记其 Apache-2.0 与"仅借鉴结构"）；前端 `components/RecipePicker.tsx`（默认收起，按分类浏览，「插入骨架」把 `skeleton` **原样**插入提示词框）；后端 `routes/enhance.ts` 消费 `recipeId`（未知 id → 400 `PROMPT_REJECTED`；命中则把 `skeleton + pitfalls` 注入 system prompt）。
- **AC**：Step 6-AC5。
- **测试**：数据完整性单测（id 唯一 / 骨架非空 / schema 全过）；插入行为单测；enhance 的 `recipeId` 分支测试（注入文本含配方要点 / 未知 id 400）。
- **提交**：`feat(recipes): prompt recipe library with skeleton insert and enhance context`。

### B9 · 轻剪辑台 MVP（CONTRACT §11-2 / PLAN §6-D37、D38）
- **形态（闸门已定 2026-09-23）**：**独立视图 `#/edit`**，源片经 hash 查询参数 `?task=<id>` 传入；**不进侧栏**；`#/edit` 无 task 时显示空态引导（"去视频库选一条成片"）。视频库卡片与详情抽屉的 ✂ 入口跳转到这里。
- **改动（后端）**：`packages/shared` 增 `EditScript`/`EditOperation` schema（**先改契约包并重建**）；`backend/src/routes/edits.ts`（`POST /api/edits`，挂 zod schema）；`backend/src/pipeline/editExecutor.ts`（ffmpeg 按 operations 顺序执行：trim→`concat`→`xfade`→`volume`→`speed`，`extractFrame` 产物落 `outputs/assets/`）；`store/db.ts` 加 `edit_script` 列（**走既有 `COLUMN_MIGRATIONS` 机制**，不许只改 CREATE TABLE）；`TaskProgress` 增 `origin` 与 `extractedAssetIds?`；剪辑任务复用现有队列（**本地互斥 1**）与 `GET /api/tasks/:taskId` 轮询。
- **改动（前端）**：视频库卡片 ✂ 入口 → 详情抽屉内「剪辑」面板（操作序列编辑器：裁剪区间 / 追加拼接片 / 转场 / 音量 / 变速 / 抽帧时间点）；EDL 历史列表。
- **AC**：Step 6-AC6（含**硬断言：全程零上游调用**——云轨 fetch 桩调用数 = 0）。
- **破坏性验证**：① 把 `edit_script` 列迁移删掉 → db 测试红；② `endSec ≤ startSec` → 必须 400 而非 500；③ 抽帧时间点超片长 → 如实报错不产空文件。
- **契约收尾（同一片内）**：路由注册后，摘掉 CONTRACT §5 该行与 §11 标题的【规划】标记 —— 契约测试只约束**未标规划**的行（`contract.test.ts` 的解析器按行跳过含「规划」的行），忘摘标记等于"实现了但契约还说没实现"。
- **提交**：`feat(editing): local ffmpeg editing desk MVP with EDL persistence`。

### B10 · 收尾：文档 + 全量验收
- **改动**：`docs/GUIDE.md` 界面导览改写（四视图 + 配方库 + 剪辑台）；README 快速开始段；PLAN §5 回检 Step 6 全部 AC；UPSTREAM.md 登记（shotcraft 结构借鉴）。
- **AC**：Step 6-AC1~AC8 逐条证据；门禁全绿；用户线上验收。
- **提交**：`docs: V9 acceptance — evidence for Step 6 AC1..AC8`。
- **验收后**：**本手册归档删除**（`git rm`），PLAN §5 记一笔。

## §4 已知坑（与 V9 直接相关；完整清单在 PLAN §8）

1. 改 `packages/shared/src/**` 后必须重建（`pnpm --filter @astrmira/shared build`），否则后端跑旧契约；
2. UI 冒烟跑在生产产物上：**先 `pnpm build` 再 `pnpm smoke:ui`**，且生产 CSP 真生效（原型稿若引外部资源会被 CSP 拦——原型稿只许用本地 `tokens.css`）；
3. `db.ts` 加列必须走 `COLUMN_MIGRATIONS`（`CREATE TABLE IF NOT EXISTS` 不会给已有库补列，线上库是老的）；
4. 动效只许 transform/opacity；改布局属性（width/height/top/left）会掉帧且 reduced-motion 断言会红；
5. 侧栏状态存 `localStorage` 的键名要进 `lib/storage.ts` 的 `STORAGE_KEYS`（与既有键同管理，不散落）。

## §5 矛盾上报

发现契约 / 计划 / 本手册之间或它们与代码矛盾时：**停下来上报，列出矛盾点与两个候选解法，由用户拍板**。先例：V8.3 批次 5 的 V2V 修复中，`PUBLIC_BASE_URL` 没进容器这个缺陷就是"线上验证与文档假设矛盾"暴露出来的 —— 矛盾是情报，不是障碍。
