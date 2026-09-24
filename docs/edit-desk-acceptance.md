# 剪辑台改版（B34）验收记录

> **只放证据，不放状态**（状态见 [PLAN.md](PLAN.md) §5 进度日志）。
> 本文记录 **V9 剪辑台改版（台账 B34，P1~P5）** 的逐条验收证据：命令、输出摘录、判定。
> 标记约定沿用全仓：**【已验证】**实测确认 / **【待验证】**未经实测 / **【规划】**尚不存在。

---

## 0. 交付物与提交

| 切片 | 内容 | 提交 |
|---|---|---|
| P0 | Remotion 可行性原型（可复跑源码 + 实测报告） | `df9687b` 等（改版前已入库） |
| P1 | 多轨数据模型 + `@remotion/player` 预览 + 单轨时间轴 UI | `f6e608d` |
| P2 | 浏览器端导出（`@remotion/web-renderer`）+ 遥测补丁 + CSP `worker-src` | `bd12b42` |
| P3 | 四轨（镜头/转场/字幕/音效）+ schema 属性面板 + 草稿持久化 | `fc40ba6` |
| P4 | 契约迁移（CONTRACT V2.5）+ 渲染产物入库 + 抽帧 → I2V 闭环 | `e980be5` |
| P5 | 文档同步与验收（本文 + PLAN / GUIDE / README） | 见 PLAN §5 |

**架构一句话**：剪辑台从「ffmpeg EDL（顺序操作序列）」改为「**Remotion 多轨时间轴**」——
预览与导出**共用同一套 TSX composition**（`frontend/src/edit/Composition.tsx`），
渲染在**用户浏览器**完成（WebCodecs 硬件编码），**服务器零 CPU**。

---

## 1. 门禁终态（P5 收尾时实测）

| 门禁 | 结果 | 命令 |
|---|---|---|
| lint | **0 error / 0 warning** | `pnpm lint` |
| type | **0 error**（shared build + backend tsc + frontend tsc） | `pnpm type` |
| 契约层 | **11 passed**（CONTRACT §5 全部路由 + §6 错误码双向比对） | `pnpm test:contract` |
| 后端（含覆盖率门限） | **38 文件 / 335 用例 passed** | `pnpm test:coverage` |
| 前端（vitest + 视觉自检） | **162 passed** + 视觉自检全项通过 | `pnpm test:frontend` |
| 构建 | 通过（`PlayerStage` 与 `exporter` 均为**懒加载 chunk**，主包不含 Remotion） | `pnpm build` |
| UI 冒烟（生产形态） | **全绿**（含 [6f] 导出 / [6g] 多轨 / [6h] 入库与抽帧） | `pnpm smoke:ui` |

> 冒烟必须在 `pnpm build` **之后**跑：它不自己构建，跑的是 `frontend/dist`
> （本改版期间踩过一次"改了代码但冒烟跑旧产物"，症状是新增按钮找不到）。

---

## 2. AC 逐条证据

### AC1 · 多轨数据模型（CONTRACT §11-2，前后端同源）

- 模型落在 `packages/shared/src/editProject.ts`（zod schema + 纯函数；前端 `frontend/src/edit/model.ts` 仅为转发出口），
  服务端 `POST /api/edits/renders` **直接用同一个 `EditProjectSchema`** 校验上传的工程 JSON。
- 证据：`backend/src/routes/editRenders.test.ts` 的「工程结构不合法 → 400」用例（`{version:1,fps:30}`）；
  以及「`origin.project` 原样往返」用例（入库后 `GET /api/tasks/:id` 读回的工程与上传的 `toEqual`）。

### AC2 · 多轨时间轴（拖动 / 裁剪 / 选中 / 防重叠 / 转场语义）

- 纯函数单测（`frontend/src/edit/model.test.ts`，38 项）逐条钉住：
  - **同轨防重叠**（磁吸撞墙）：移动不越过邻居尾帧、空隙放不下时原地不动、右裁不越过下一段首帧、左裁先撞邻居；
  - **转场**：添加后后继片段左移 d（`150 → 135`）、总时长缩短 d、上限钳制（`d=9999 → 60`）、
    **破坏相邻性的编辑移除转场并还原布局**（移动到 200 后 B 在 200；裁剪之后 B 回到 150；删除 A 后 B 回到 150）、
    同接缝重复添加 = 替换（不叠加）、改时长 = 移除+重加且后继左移量同步变化。
- 冒烟 `[6g]`（真实浏览器）：`＋字幕` 落在字幕轨、面板改文本 → 时间轴标签随动、
  `＋转场` 后继片段左移 15 帧（70 → 55）、面板改 20 帧 → 后继再左移 5 帧（净 20）。

### AC3 · 预览即所得（同一套 composition + 浏览器端导出）

- 预览 = `@remotion/player`（`PlayerStage`，React.lazy 懒加载）；导出 = `@remotion/web-renderer`
  （`exporter.ts`，点按钮时才动态 import）。两者传入**同一个 `EditComposition`**。
- **导出时长 = 内容精确结束帧**（`exportDurationFrames`，不含预览的 1s 编辑余量）：单测 3 项 + 冒烟实测
  `2.347s vs 2.333s`、多轨工程 `3.669s vs 3.667s`（容差 0.2s）。
- 冒烟 `[6f]` 用**真实浏览器导出 + Playwright 下载 + ffprobe** 断言产物事实：
  含视频流（h264 1280×704）、`r_frame_rate = 30/1`、时长与工程内容一致、**音轨与源片一致**、
  中点帧亮度标准差 55.5（纯色为 0）= 画面非空白。

### AC4 · 遥测短路（合规边界见 UPSTREAM #13）

- `patches/@remotion__web-renderer@4.0.484.patch` + `pnpm-workspace.yaml` 的 `patchedDependencies`；
  `frontend/src/edit/webRendererPatch.test.ts` 是**守卫**（补丁静默失效即变红 —— 那种失效不会报错，只会让终端用户 IP 外发）。
- 实测：补丁生效后 `sendUsageEvent` 为 no-op（源码级断言），导出照常成功（[6f]/[6g] 两次导出均通过）。

### AC5 · 渲染产物入库（CONTRACT §5 / §11-2）

- `POST /api/edits/renders` 四道校验，6 项测试逐条覆盖：**必填字段**（400）、**工程 JSON 合法**（400）、
  **工程 schema**（400）、**源任务存在且成功出片**（404）、**魔数必须 MP4**（415，伪造 Content-Type 无效）、
  **>20MB**（413，与反代请求体上限同口径）。
- 落盘事实断言：`outputs/<taskId>.mp4` 存在、封面 `outputs/thumbs/<taskId>.jpg` 生成、
  `?kind=edit&source=` 能查到、**默认历史不含剪辑产物**（V9 拍板口径保持）。
- 两代剪辑产物**并存可读**：`origin.script`（旧 EDL）与 `origin.project`（新工程）都是合法记录。
- 冒烟 `[6h]`：入库后 206 Range、工程 4 个片段、封面存在。

### AC6 · 抽帧 → I2V 闭环（PLAN §6-D38）

- 抽帧走 `renderStillOnWeb`（**与预览同一构图**，因此字幕/转场都在图里）→ 既有 `POST /api/upload` 落成资产 →
  `#/workbench?frameAsset=<id>&frameExt=<png|jpg>`。
- `WorkbenchView` 的两个 hash 参数**严格校验**（assetId 必须 UUID 形状、ext 只接受 png/jpg）后才拼预览 URL。
- 冒烟 `[6h]` 实测：抽帧上传得到资产 → 首帧槽出现同源预览 → 模式切到「图生视频」→ 资产可读（19216 字节）。

### AC7 · 草稿持久化（刷新不丢）

- `frontend/src/edit/draft.ts`：按源片存 localStorage；读到脏数据**就地清除并返回 null**（自愈）；
  落盘 = 500ms 防抖 + **pagehide/beforeunload 同步 flush**（"刚编辑完就刷新"这一笔不丢 —— 冒烟抓出的真缺陷，见 §3）。
- 单测 6 项（roundtrip 含转场 / 无草稿 / 坏 JSON / schema 不过 / 破损转场自愈 / 清除）；
  冒烟 `[6g]`：刷新后字幕与转场都还在。

### AC8 · 零上游调用 / 零服务器渲染成本

- 导出与抽帧全程在浏览器（WebCodecs），服务端只接收上传的产物；
  `routes/editRenders.ts` 结构上就不 import 任何 provider / 凭据模块。
- legacy EDL（`POST /api/edits`，本地 ffmpeg）保留为 **API-only** 能力，仍由 `editExecutor` 测试与
  冒烟 [6e] 的 API 级断言覆盖（UI 入口按用户拍板撤掉）。

---

## 3. 过程中抓到并修掉的真缺陷（都值一条记录）

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| 1 | 生产形态下 Player 刷 16 条 console error，冒烟"控制台零 error"失败 | `numberOfSharedAudioTags` 预创建的共享 audio 标签加载静音占位 data-URI mp3，headless Chromium 解码失败 | 置 `numberOfSharedAudioTags={0}`（本阶段没有多路 Audio 场景） |
| 2 | 生产 CSP 拦掉 web-renderer 的 blob worker（导出仍成功，长任务失去保活） | `worker-src` 缺省回落 `script-src 'self'`，blob: worker 被拦 | CSP 增 `worker-src 'self' blob:` + `securityHeaders.test.ts` 两项断言（附实测理由） |
| 3 | 冒烟"clip 可裁剪"恒失败（60→60），手工复现却正常 | ① 冒烟用 `boundingBox()` 的**过期快照**算右缘手柄坐标，落在 clip 本体上把裁剪变成拖动；② 原始 `mouse.*` 不走 Playwright 的 actionability 稳定等待 | 坐标改为**双 rAF 等几何稳定 + `getBoundingClientRect` 同步读取**；诊断注释留在冒烟里 |
| 4 | 草稿在"刚编辑完立刻刷新"时丢最后一笔 | 500ms 防抖未落盘，且**硬导航不走 React cleanup** | 增 `pagehide` / `beforeunload` 同步 flush |
| 5 | 转场"改时长"后属性面板失焦 | 「移除 + 重加」生成了新 clip id | 重加后把 id 改回原值 |
| 6 | 同轨 clip 重叠（画面两路叠加，剪辑语义坏） | P1 初版没做防重叠约束 | `neighborBounds` 磁吸撞墙 + 4 项单测 |
| 7 | P1 的 `trimClip` 无视 prune 结果 | 重构时漏改一处 `mapClip(project, …)` | 改为 `mapClip(clean, …)`（P3 转场测试当场抓出） |

---

## 4. 如实说明（能力边界与遗留）

- **像素级"预览 = 导出"没有自动化断言**：两者的同一性由"同一套 composition + 同一 `durationInFrames`"在**结构上**保证；
  冒烟只断言产物的客观事实（时长/帧率/音轨/非空白）。真正的像素比对要与播放器截图对拍 —— 登记台账 **B35**。
- **转场只作用于同轨相邻的两个视频片段**（fade / wipeleft / slideright；上限 = min(60 帧, fps×2, 两端时长-1)）；
  不支持跨轨转场、三段叠加、转场曲线参数。
- **入库体积上限 20MB**（与反代请求体上限同口径）：更长的工程只能"下载到本机、不入库"。
  要放宽得同时改反代与路由 —— 登记台账 **B36**。
- **剪辑产物不能直接作为其它工程的素材**：素材候选列表仍只含生成产物（`?kind=edit` 的产物不出现在候选里）。
  想"把 A 片剪出的成片拼进 B 片"目前要先走一次生成/上传，属真实缺口 —— 登记台账 **B37**。
- **服务端只校验工程 schema、不做语义校验**（例如 clip 引用的 taskId 是否真的存在）：
  工程是**前端编辑态**的真相，服务端归档时信任它；被篡改的工程只会让**下次打开时**预览/导出报错（如实报错，不静默）。
- **音频轨只能取视频文件的音轨**（`/api/upload` 白名单不含 mp3/wav）：独立音效素材需先进"参考视频"槽再复用 —— 登记台账 **B38**。
- legacy EDL 的 `POST /api/edits` 与浏览器端导出是**两条并存路径**（前者 API-only）：语义重叠但不冲突，
  是否收敛到一条由"是否有人真的用 EDL API"决定（**B39**）。
