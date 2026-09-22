# AstrmiraVideo · Step 1 → Step 5 施工单（EXEC）

> **性质**：可执行的施工手册（一次到位到"公网部署 + 云端出片"）。
> **生成于**：2026-09-22 ｜ 基线 `main` @ `d33520f`（Step 1 / 1.5 已验证）
> **铁律**：契约先行——文档批（D 段）未合入前，不得动 R 段与 S 段代码。

### 单一事实源 · 文档所有权矩阵（全项目通用，违反即返工）

| 知识 | 唯一权威 | 其他文档的义务 |
|---|---|---|
| **施工步骤 / 分片 / 片内改动清单** | **本文件**（`docs/EXEC-STEP2-5.md`） | 别处只准链接，**禁止**新建第二份施工手册或分片表 |
| 接口（类型 / 路由 / 错误码 / 存储） | `docs/CONTRACT.md`（D 段后 = V1.8） | 本文件只写"改哪一节、改成什么口径"，**不复制 TS 定义** |
| 决策（why） | `docs/PLAN.md` §6（D 段后含 D22~D28） | 本文件只引用决策号（如 D23），**不复制理由与优劣分析** |
| 防线 / Step+AC / 进度 | `docs/PLAN.md` §3 / §4 / §5 | 本文件只引用 §号，**不复制正文** |
| 算力推荐档位与引擎接入 | `docs/GUIDE.md` §一 / §二 | 本文件不复制表格 |
| 上游台账 | `docs/UPSTREAM.md` | ffmpeg 登记写在这里（§9-3） |

**三条禁令**
1. 不新建 `docs/EXEC-STEP2.md` 或任何第二份施工手册；对本手册有不同意见 → **先上报，由用户决定是否改本手册**；
2. 不把 CONTRACT 的类型定义、PLAN 的防线/AC 正文复制进任何其他文件（README 协作规范 2）；
3. 进度描述只存在于 `PLAN.md` §5（README 规范 6）。

> 讨论留痕：四议题的决策理由、5 项待拍板的优劣对比、最小 demo 取舍、待优化台账，见**本机工作区** `.tmp/ARCH-DECISIONS.md`（`.tmp/` 已 gitignore，**不进仓库**）。D 段完成后其结论已全部落入 `PLAN` §6 / §7 / **§9（台账）** 与 `CONTRACT` V1.8，此后以那几处为准，本手册**不再依赖**该文件。

---

## §0 这份文件怎么用

**执行会话开场提示词（整段粘贴，本文件 §0 为唯一正本）**：

```
你是 AstrmiraVideo（c:/Users/v_chchsli/Desktop/AstrmiraVideo）的施工会话。
唯一作业指导书是 docs/EXEC-STEP2-5.md；先按顺序读（不要跳）：
README.md → docs/PLAN.md → docs/CONTRACT.md → docs/GUIDE.md → docs/EXEC-STEP2-5.md（施工单）。

严格按施工单推进，顺序不许调：
1) §4 文档批（D 段：5 份文档整批一次提交；提交前先做 D 段的破坏性验证）
2) §5 返工（R1 / R2）
3) §6 的 S1 → S7（每片一个提交，片尾按 §10 交证据）
4) §7 Step 3 → §8 Step 4 → §9 Step 5
每片完工的同一提交内回检三处进度指针（README 徽章与「快速开始」段、PLAN §5 进度日志、
NEXT_SESSION_PROMPT.md 当前指针）。版本号：PLAN → V8.2、CONTRACT → V1.8。

单一事实源规矩（违反即返工）：
- 施工步骤的唯一权威 = docs/EXEC-STEP2-5.md。不要新建 docs/EXEC-STEP2.md，
  也不要另写任何第二份施工手册 / 分片表；对分片有不同意见先向我上报，由我决定是否改本件。
- 决策的唯一权威 = PLAN §6（D22~D28 由 D 段迁入）与 CONTRACT V1.8。
- 接口唯一权威 = docs/CONTRACT.md；进度唯一权威 = docs/PLAN.md §5。
  任何知识只在它的 Owner 文档详写一次，别处只准放链接（README 协作规范 2）。
- 不要复制 CONTRACT 的类型定义或 PLAN 的防线 / AC 正文，需要时写「见 CONTRACT §x」。

铁律（施工单 §3，一条都不许省）：契约先行；探针不替访客下结论；Key 零留存
（pino redact + CORS allowedHeaders 必须就位）；不静默降级（未实现就返回明确错误码）；
不可砍清单（施工单 §11-3）全项保留。

动手前先汇报三件事，我确认后再开工：
① 你对当前基线与执行顺序的理解；
② 施工单中你发现的自相矛盾或不可执行处（先列矛盾点再给建议，不要自行选边）；
③ 你打算怎么推进 S1~S7（每片的验证方式）。

部署阶段我只会提供 3 项输入（服务器地址 / 端口 / 火山 Key，Key 可选）；
其余配置由你自带默认值（施工单 §9-1）。Step 5 前我会告诉你「有没有域名」，用以决定 HTTPS 档位。
```

**各段职责**：§1 目标 / §2 前置 / §3 铁律 / §4 文档批（先做）/ §5 返工切片 / §6 Step 2 七片施工卡 / §7 Step 3 / §8 Step 4 / §9 Step 5 部署 / §10 证据格式 / §11 提交规范 / §12 已知坑 / §13 台账指针。

---

## §1 目标与非目标

### 1-1 目标（Definition of Done，一步到位）
1. **本地**：`pnpm dev` 起前后端，能完成 T2V（含双引号台词）与 I2V 全流程；
2. **CI**：GitHub Actions 上 lint / type / contract / 真实产物四类检查全绿，且用 OI-2 夹具产出**可播 MP4**；
3. **公网**：一台服务器 + Docker，外部手机浏览器访问，**填入自己的火山 Key 即可出片**；
4. 全流程遵守七道防线，且 `UNCERTAIN_RESULT` 不发生任何自动重提（有硬断言）。

### 1-2 非目标（明确不做，已转台账：决策书 §11-5）
- 用户本机 worker / 浏览器直连本地引擎（B1）；
- `keys/verify`、`local/verify` 两条路由（B2 / B4）；
- LLM 扩写真实实现 —— **`/api/prompt/enhance` 以诚实 `501 LLM_NOT_CONFIGURED` 落地，前端 ✨ 置灰**（B3）；
- OI-1 `stock-local` 素材 provider（B7）；
- SSE 实时推送（B10）、复合限流键（B8，**上线前**必做）。

### 1-3 最终形态（决定 §9 的部署结构）
**单 Node 进程**：Fastify 同时提供 `/api/*` 与前端静态产物（`@fastify/static` 已在依赖中，Step 1 装而未用，本次启用）+ `outputs/` 的 Range 静态服务；**反向代理只做 TLS 终止与 20MB 请求体放行**。不引入 nginx 配置复杂度。

---

## §2 一次性前置（P0，先做完再动代码）

| # | 事项 | 做法 | 验证方式 |
|---|---|---|---|
| P0-1 | 依赖安装 | 根目录 `pnpm install`；新增依赖见 §2-1 | `pnpm build` 成功 |
| P0-2 | **ffmpeg / ffprobe**（决策书 P4） | 本地与 CI 走**系统安装**；Windows：`winget install Gyan.FFmpeg` 或官网解压加 PATH；CI（ubuntu）用 `apt-get install -y ffmpeg` | `ffmpeg -version` + `ffprobe -version` 均可用 |
| P0-3 | 缺依赖时的**中文友好报错** | provider / 脚本启动时探测 ffmpeg，缺失则打印安装指引并**显式失败**，不许崩栈 | 临时改名 ffmpeg 可执行文件，确认报错文案 |
| P0-4 | `shared` 构建纪律 | `packages/shared` 为 `tsc` 直出 `dist`，backend/frontend 消费的是 **dist 而非 src** | **改 `packages/shared/src/**` 后必须 `pnpm --filter @astrmira/shared build`**，否则后端仍跑旧契约（本项目最容易踩的坑之一） |
| P0-5 | 目录与卷 | `data/`（SQLite）、`outputs/`（成片）、`outputs/assets/`、`outputs/.tmp/`；已全部在 `.gitignore` 内 | `git status` 干净 |

### 2-1 需要新增的依赖（一次性列清）

| 包 | 目标包 | 理由 |
|---|---|---|
| `better-sqlite3` | backend | PLAN §6-D5 任务存储；Node 22 有预编译，Windows 若缺 build tools 需 VS Build Tools |
| `@fastify/multipart` | backend | `/api/upload` 上传（fastify 5 对应 v9） |
| `file-type` | backend | 魔数嗅探（§7-6 要求不信任 `Content-Type`） |
| `sharp` | backend | 图像清洗网关（防线 4：WebP/CMYK→sRGB、大图下采样、32 倍数规整）。**HEIC 解码能力已实测**（2026-09-22，`sharp` 0.35.4 / libvips 8.18.6）：HEIF 容器可用（AVIF 通过）但**预编译版缺 HEVC 解码器** → `.heic` 走**诚实拒绝**（415 + 转格式指引）；结论与证据见 PLAN §5 的 S6 条目、台账 B21 |
| `oxlint` | 根 devDeps | CI 三件套的 lint（零配置、单二进制、CI 秒级；避免为 demo 铺 eslint 全家桶） |
| — | frontend | **零新增**：React 19 + `fetch` 足够（Step 3 不引入路由/状态库） |

> 新增依赖必须**同步登记**到本表下方"实测版本"栏（安装后回填），并在提交信息里写明。

---

## §3 铁律（违反即返工）

1. **契约先行**：`docs/CONTRACT.md` 未冻结前不写实现代码；
2. **探针不替访客下结论**：`/api/providers/status` 不得返回任何未经显式配置的硬件信息，不得硬编码型号；`reason` 文案不得出现"你的设备/你没有显卡"这类判断；
3. **Key 零留存**：`X-Provider-Key` 不落库、不入日志、不回显；pino `redact` + CORS `allowedHeaders` 必须就位（漏任意一项，云端轨在真实浏览器上直接不可用或明文泄露）；
4. **不静默降级**：能力未实现就返回明确错误码（如 `LLM_NOT_CONFIGURED`），不许假装可用、不许规则引擎冒充 AI；
5. **不可砍清单**（决策书 §11-3）：三态错误码 + 幂等键 + `submitting` + 限流机制 + 上传加固 + 最小鉴权 + 中间帧清理 + LRU + 206，一项都不能省；
6. **三级标记**：未实测的数字标【待验证】，尚不存在的文件标【规划】；
7. **脱敏**：IP / 绝对路径 / 凭证只进本地 `.env`，文档一律占位符；
8. **进度回检**：Step 状态变更时，**同一提交内**回检三处指针（README 徽章与"快速开始"段、PLAN §5 进度日志、`NEXT_SESSION_PROMPT.md` 的当前指针段）。

---

## §4 D 段 · 文档批（**第一步，整批一次提交**）

> 一次性改完 5 份文档再提交（文档间交叉引用，拆提交会产生中间不一致态）。提交信息：`docs: land Step 2 architecture decisions (probe demotion, client-held BYOK, LLM deferral)`。

| # | 文件 | 逐处改动 |
|---|---|---|
| D-1 | `docs/PLAN.md` | ① §1 架构图末行 → 「双轨调度器（cloud 并发 / host-local 互斥 Concurrency=1）；client-local 轨为旁路，服务端不调度」；§1 末段「硬件探针…Tier 0 自动锁定云端并置灰本地开关」→ 改写为「探针只报告本服务的本地引擎配置状态，**不替访问者判断设备能力**；本地轨由部署者显式配置启用」。② §3 防线 1 / 防线 3 补两条 scope 的落点（决策书 §1-1 表）。③ §4 Step 2 任务行：`statusProbe.ts` → 「本地引擎**配置自检**（非硬件扫描）」；`LocalH3Provider.ts` 标 `(host scope)`；新增任务「凭据中间件（`X-Provider-Key`）+ redact + CORS allowedHeaders」「`packages/shared` 同步」「`pnpm test:contract` 脚本」；`/api/prompt/enhance` → 「**demo 版以 501 `LLM_NOT_CONFIGURED` 落地，实现见台账 B3**」。④ **AC6 改写**：「不得返回任何未经显式配置的硬件信息；未配置时 `available:false` + `reason`；任何情况下不得返回硬编码型号」。⑤ **AC9 改写**：「60s 冷却按来源 IP 计数（复合键见 §7-5 的 Step 5 时点）；冷却落 SQLite，服务重启后窗口不丢失」。⑥ Step 5 AC2 改写：「前端展示推荐配置说明，本地开关不置灰；选择未启用的本地轨提交时返回 `PROVIDER_UNAVAILABLE`」。⑦ §6 追加 **D22~D28**（照决策书 §5 表抄，D24 标注【规划】态）。⑧ §7-1 改写（Key 客户端持有、过手不留存；**同步修正 D3 的措辞**「Key 不出服务端」→「不落盘、不落日志、不回传明文」）。⑨ §7-4 补「回环免鉴权白名单**: 仅 `/api/health`**」。⑩ §7-5 补时点；⑪ §7-3 补一句「公网部署不向访客开放 host 本地轨（env 默认关闭）」。⑫ §5 进度日志追加 Step 2 开工条目，并在该条目内写明「施工手册：`docs/EXEC-STEP2-5.md`（**全仓唯一施工权威**，Step 5 验收后归档删除）」——让未来会话从 Owner 文档就能找到唯一施工入口，避免再建第二份手册。⑬ 版本号 → **V8.2** + 修订说明块（注明新增 §9）。⑭ **新增 §9「待优化台账」**（B1~B15，含「何时必须做」列；`B8` 必须标注「**上线前必须做**」）——台账的唯一权威落在这里，此后 `EXEC-STEP2-5.md` §13 只引用不复制。 |
| D-2 | `docs/CONTRACT.md` | 升 **V1.8**，只动四条：① **§2**：`cloud.keySource` 收窄为可选字面量 `'env'`；`cloud.available` 口径改为「env `VOLCANO_API_KEY` 存在」；新增 `cloud.acceptsClientKey: boolean`（恒 true）；`local` **删除 `gpuName`/`vramFreeGB`**；`local.tier` 改可选（语义=引擎自检结果）；`local.reason` 区分「本服务未配置/未启用本地引擎」两类；补 `EXPOSE_HOST_LOCAL_TRACK` 说明。② **§5**：新增「凭据传递约定」注记段（`X-Provider-Key` 仅走请求头，禁 query/URL/body；服务端零留存；`Idempotency-Key` 同步登记）；`/api/prompt/enhance` 行补「demo 版返回 501 `LLM_NOT_CONFIGURED`；LLM 配置契约见 V2.0【规划】」。③ **§6**：新增 `LLM_NOT_CONFIGURED`、`KEY_INVALID`、`KEY_MISSING`（均 `terminal`）；**硬规则 2 适用范围收窄**为「有持久副作用的任务型上游」（无副作用调用不适用）。④ **§7**：新增一行「BYOK Key｜服务端零留存（无此数据）｜仅存在于单次请求的内存上下文」；「中间帧」行补 client 轨落点【规划】。⑤ 顶部补 V1.8 修订说明块（照决策书 §6 抄）。 |
| D-3 | `docs/GUIDE.md` | ① §一 表头「算力分级」→「推荐档位（配置建议，**非探测结论**）」，末列「推荐姿态」→「建议」，删除"自动锁定 / 置灰"表述；表头加一行「本文为唯一详写处，前端展示文案为其投影，改则同步」。② §二 轨道 B 第 3 条改写为「Key 存于**你的浏览器**，随请求头发送；服务端只在转发瞬间过手，不落盘、不写日志、不回显。默认 `sessionStorage`；选 `localStorage` 表示接受明文存储风险」。③ §六 Q3 改写为「探针只报告本服务的本地引擎配置状态，**不会替你判断设备能力**；是否使用本地模型由你决定（推荐配置见 §一）」。④ §六新增一问「Key 会不会被服务端记录？——不会留存，但转发必经服务端内存，第三方托管请自行评估信任边界」。⑤ §六新增一问「公网部署为什么看不到本地轨？——本服务默认不向访客开放本地轨」。 |
| D-4 | `README.md` | ① :12 电梯陈述「系统按硬件探测结果自动路由」→「按推荐配置与你的选择路由」；② :26 快速开始段去掉"自动锁定云端 / 自动激活本地轨"，改为"填入自己的火山 Key 即可出片；本地轨由部署者显式启用"；③ 徽章 status 改「Step 2 进行中」；④ 进度指针仍只链接 PLAN §5。 |
| D-5 | `.env.example` | 新增：`EXPOSE_HOST_LOCAL_TRACK=0`、`TRUST_PROXY=0`、`OUTPUT_DIR=`（默认 `outputs`）、`DATA_DIR=`（默认 `data`）；注释标注 `VOLCANO_API_KEY` 可为空（BYOK 走浏览器）；新增 `LLM_*` 四项**但标注【规划·B3 未实现】**（避免误以为可用）。 |

**破坏性验证（D 段必做）**：改完 CONTRACT 后，`packages/shared` 尚未同步 → `pnpm --filter backend test` 应当**失败**（证明契约确实在约束代码）。把这条失败记录进证据，随后在 R1 修好。

---

## §5 R 段 · 契约同步返工（**第二步，一个提交**）

> 提交信息：`refactor: sync shared contract to V1.8 (probe demotion + client-held BYOK)`。

### R1 status 链路
| 文件 | 改动 |
|---|---|
| `packages/shared/src/status.ts` | 按 CONTRACT §2 V1.8 同步：`keySource` → `z.literal('env').optional()`；新增 `acceptsClientKey: z.boolean()`；删 `gpuName`/`vramFreeGB`；`tier` 改 `.optional()` |
| `packages/shared/src/index.ts` | 若新增 `localRuntime.ts` 则导出（**demo 版可不建**，见决策书 P5 降级） |
| `backend/src/routes/providers.ts` | 删 `sessionKeyStore` 与 `resolveCloudKeySource()`；`buildProviderStatus()` 改读「引擎自检缓存」（R3 前先返回未配置态）；`cloud.acceptsClientKey: true` |
| `frontend/src/App.tsx` | :39-41 回退逻辑重写（`local.available===false` → 保持 `'cloud'`，**本地按钮不置灰**）；删 :74-78 的 `gpuBadge`（依赖已删除的 `local.gpuName`） |
| `backend/src/index.test.ts` | `local` 键集合断言改 `['available','provider','reason']`；`cloud` 键集合改 `['acceptsClientKey','available','provider']`（有 reason 时再加）；`index.test.ts:56` 的 `keySource` 断言改「false 时 undefined」；**`reason` 精确文案断言改为正则取反断言**：响应全文不得匹配 `/(RTX|GTX|A100|H100|[0-9]+ ?GB)/i` |

**验收**：`pnpm --filter @astrmira/shared build && pnpm test` 全绿；`GET /api/providers/status` 响应键集合与 CONTRACT §2 完全一致。

### R2 凭据通道
| 文件 | 改动 |
|---|---|
| `backend/src/index.ts` | ① CORS `allowedHeaders: ['content-type','x-provider-key','idempotency-key','authorization']`（**当前未配置 → 浏览器自定义头会被预检拦下**）；② pino `redact: ['req.headers["x-provider-key"]','req.headers.authorization']`（配置在 logger 构造处，含生产分支）；③ `trustProxy` 由 `TRUST_PROXY=1` 控制（反代后 `req.ip` 正确性，关系到防线 5 是否退化成全局锁） |
| `backend/src/security/credential.ts`（新增） | `resolveProviderKey(req)`：仅从请求头取；`maskKey(k)` → `sk-****abcd`；**禁止**把 Key 存入模块级变量 |
| `backend/src/security/credential.test.ts`（新增） | 断言：日志与错误响应中**不得出现 Key 前 8 位明文**；`maskKey` 输出形状正确 |

**验收 + 破坏性验证**：手工发一次带 `X-Provider-Key` 的请求 → 响应与日志中检索该 Key 前 8 位，**零命中**；去掉 redact 配置后该断言必须失败（证明断言有效）。

---

## §6 Step 2 七片施工卡

> 顺序：**S1 → S2 → S3 → S4 → S5 → S6 → S7**（S7 的 CI 骨架可在 S1 后先建，但"全绿"判定放最后）。
> 每片一个提交，片尾给 AC 逐条证据（§10 格式）。

### S1 · OI-2 `fixture-local` 夹具 provider（AC5）

**改动文件**
- `scripts/make-fixture-clips.mjs`（新增）：用 ffmpeg 现场合成 9 条边界片，**二进制不入库**（`tests/fixtures/clips/` 进 `.gitignore`，只提交脚本）
- `backend/src/lib/ffmpeg.ts`（新增）：`execFile` 封装 + **ffmpeg/ffprobe 缺失时的中文指引报错**（P0-3）
- `backend/src/pipeline/smartCrop.ts`（新增）：两个纯函数——`snapTo32(w,h)`（规整到 32 倍数）与 `cropToAspect(w,h,aspect)`（居中裁切）
- `backend/src/providers/registry.ts`（新增，**唯一注册点**）：`getProvider(id)` + 能力位列表；默认关闭项由 env 控制
- `backend/src/providers/fixture/FixtureLocalProvider.ts`（新增）：实现 `VideoProvider` 四方法；时长对齐（长→裁切 / 短→循环 + 告警 / 循环时音轨静音 + 第二条告警）
- `backend/src/pipeline/smartCrop.test.ts`、`backend/src/providers/fixture/*.test.ts`（新增）

**9 条边界用例（PLAN §4 表，一条不少）**：基线 720p 横屏 5s+音轨 / 竖屏 9:16 / 短于请求（0.5s vs 5s）/ 短于请求且带音轨 / 长于请求（30s vs 5s）/ 无音轨（`-an`）/ 32 倍数不规整（831×479）/ 极短单帧（`-frames:v 1`）/ 损坏文件（截断 moov）

**AC5**：产出真实可播 MP4，`ffprobe` 校验通过（宽高/时长/音轨齐全），**全程零外网依赖、零配额消耗**。
**破坏性验证**：注释掉"循环拉伸"分支的告警写入 → 对应用例必须失败；`smartCrop` 断言里把 32 倍数检查改成 `>0` → 不规整用例必须失败。

### S2 · 公共链路（AC4 / AC3 / AC7 幂等半边）

**改动文件**
- `backend/src/store/db.ts`（新增）：better-sqlite3 打开 + 建表迁移（任务表 / 幂等键表 / 冷却表，为 S4 预留）
- `backend/src/store/taskStore.ts`（新增）：任务 CRUD + `requestSnapshot` + `warnings[]` 持久化
- `backend/src/queue/SqliteJobQueue.ts`（新增）：实现既有接口 `backend/src/queue/JobQueue.ts`（`submit/claim/heartbeat/complete/fail/requeue/markUncertain`）；`claim` 必须**显式排除** uncertain/terminal（防线 7）
- `backend/src/routes/generate.ts`、`tasks.ts`、`history.ts`（新增）：`/api/generate`（幂等键：头缺省时按 `provider + 请求指纹` 生成；同键返回**同一 taskId** 且**不产生第二次上游调用**）、`/api/tasks/:taskId`、`/cancel`、`/history`、`DELETE /api/history/:taskId`
- `backend/src/pipeline/cleanup.ts`（新增）：`outputs/.tmp/<taskId>/` 合成结束后**立即物理删除**（防线 3）
- `backend/src/server/staticOutputs.ts`（新增）：`@fastify/static` 挂 `outputs/`（206 载体）
- 对应单测（新增）

**AC3**：本地轨并发提交 2 个任务 → 第 2 个为 `queued`，**无第二个推理进程被拉起**
**AC4**：服务重启后进行中任务从 SQLite 恢复；前端刷新可重挂载
**验证要点**
- 206：`curl -H "Range: bytes=0-1023" <成片直链>` → `206` + `content-range`（`@fastify/static` 基于 `send`，原生支持 Range，但**必须实测**，因为部署时反代压缩会破坏它，见 §12）
- 幂等：同 `Idempotency-Key` 发两次 → 同一 taskId，上游调用计数 = 1
- 清理：任务成功后断言 `outputs/.tmp/<taskId>/` **不存在**
**破坏性验证**：把 `claim` 里排除 uncertain 的条件删掉 → uncertain 用例必须失败（这是防线 7 的硬护栏，必须有断言钉住）。

### S3 · 三态错误码 + 故障注入层（AC7 uncertain 半边）

**改动文件**
- `backend/src/errors.ts`（新增）：`ErrorCode → ErrorDisposition` **穷举映射表**（12 个 code 全部覆盖，含 V1.8 新增的 `LLM_NOT_CONFIGURED`/`KEY_INVALID`/`KEY_MISSING`）+ 统一错误响应构造
- `backend/src/providers/withFaultInjection.ts`（新增）：薄包装 `withFaultInjection(provider, plan)`，**仅 `FAULT_INJECT=1` 且非生产环境挂载**，否则启动直接拒绝
- 7 项注入：`delay:ms` / `rate_limit` / `upstream_5xx` / `stream_cut@40%` / `disk_full` / `slow_progress` / `uncertain`

**AC7**：注入 `uncertain` 后任务归 `UNCERTAIN_RESULT` 且**上游调用次数硬断言 = 1**（该断言是防线 7 不被日后静默改回自动重试的唯一保障）
**验证要点**：每个注入项至少 1 条自动化断言；`UPSTREAM_ERROR` 与 `UNCERTAIN_RESULT` 的分界必须可测（上游明确返回 4xx/5xx → `UPSTREAM_ERROR`；超时/中断 → `UNCERTAIN_RESULT`）

### S4 · 防线 5 限流 + `/api/upload` 加固 + 鉴权骨架（AC9 / AC10）

**改动文件**
- `backend/src/security/rateLimit.ts`（新增）：`rateLimitKey({ ip, keyFingerprint? })`（**签名预留 `keyFingerprint`，demo 传 `undefined`**）；60s 冷却；冷却状态**落 SQLite**（重启不丢窗口）；`rate_limit` 返回 `RATE_LIMITED`
- `backend/src/routes/upload.ts`（新增）：≤20MB × ≤4、**魔数嗅探**（`file-type`，不信任 `Content-Type`）、白名单 `jpg/png/webp/heic/mp4/mov`、产物路径**只含服务端随机 ID**
- `backend/src/security/auth.ts`（新增）：Bearer 校验 + **回环免鉴权**；白名单**仅 `/api/health`**
- `backend/src/index.ts`：挂载安全响应头（`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`）

**AC9**：60s 冷却按 IP 计数；**重启前后同一 IP 提交仍被拒且返回 `RATE_LIMITED`**
**AC10**：单文件 >20MB / 总数 >4 被拒；伪造 `Content-Type` 被魔数识破；白名单外类型被拒；产物路径不含任何用户输入片段
**破坏性验证**：把魔数嗅探换成读 `Content-Type` → 伪造类型用例必须失败；把冷却表从 SQLite 换成内存 Map → 重启用例必须失败。

### S5 · Seedance 真实 provider + status 配置自检 + 真实冒烟（AC2 / AC6）

**改动文件**
- `backend/src/providers/VolcanoSeedanceProvider.ts`（新增）：提交 + 轮询 + **流式下载**（Node 22 全局 `fetch`）；Key **只从请求上下文取**（`resolveProviderKey`），**绝不读模块级缓存**
- `backend/src/providers/statusProbe.ts`（新增）：**启动时**读 env（`H3_WORKDIR` / `COMFYUI_BASE_URL`）做一次轻量自检（白名单校验：仅回环 / RFC1918 / 本机路径）→ 写内存缓存 → `GET /api/providers/status` 读取（**到达路径 = 配 env + 重启**，运行时路由属台账 B4）；接 `EXPOSE_HOST_LOCAL_TRACK`（默认 `0`）
- `backend/src/routes/providers.ts`：接自检缓存 + 开关判定

**AC6**：未显式配置 → `local.available:false` + `reason`；**任何情况下不得返回硬编码型号**；`EXPOSE_HOST_LOCAL_TRACK=0` 时 `reason` 必须是「本服务未向访客开放本地轨」（**不得出现"你的设备"类判断**）
**AC2**：Seedance 真实冒烟出片 1 次，记录**实际耗时与费用**，回填 `PLAN §8` 成本表两行【待验证】→【已验证实测】
**硬要求**：冒烟**必须走 `X-Provider-Key` 通道**（不得用 env Key 绕开），否则等于没验证议题 3 的成果
**破坏性验证**：把 `reason` 临时改成含型号的文案 → R1 的正则取反断言必须失败。

### S6 · 图像清洗网关（防线 4 + AC5 另一半）

**改动文件**
- `backend/src/pipeline/imageSanitize.ts`（新增，`sharp`）：HEIC/WebP/CMYK → sRGB 统一、超大图下采样、EXIF 方向矫正
- 接入 `/api/upload`；与 `smartCrop` 共用尺寸规则

**关键口径（易做错，必须按此）**：**上传阶段不知道目标画幅** → 上传只做「清洗 + 下采样 + 规整到 32 倍数（保原纵横比）」；**按 `aspectRatio` 的居中裁切发生在生成时**（两段都走 `smartCrop` 的同一组纯函数）。
**HEIC**：`sharp` prebuilt 的 HEIF 解码能力**已实测**（2026-09-22）——HEIF **容器**可用（AV1/AVIF 通过），但预编译版**没有 HEVC 解码器**，`.heic`（iPhone 默认格式）当前走**诚实拒绝** `INVALID_ASSET` + 转格式指引（不许静默失败）；结论与证据见 PLAN §5 的 S6 条目，让其真正可用的候选路径见台账 B21。
**AC1 / 破坏性验证**：HEIC / WebP / 超大图各上传 1 次，输出合规；把下采样阈值改大 → 超大图用例必须失败。

### S7 · 契约层测试 + CI 三件套（AC1 / AC8）

**改动文件**
- `backend/src/contract.test.ts`（新增）：覆盖 CONTRACT **全部路由**与**全部 12 个错误码**（含 `disposition` 穷举断言）
- 根 `package.json` 新增脚本：`test:contract`、`lint`（oxlint）、`type`（三个包 `tsc --noEmit`）
- `.github/workflows/ci.yml`（**新建，仓库当前无 `.github/`**）：job 顺序 = `pnpm install` → `apt-get install -y ffmpeg` → `shared build` → `lint` → `type` → `test:contract` → `test`（含真实产物层）

**AC1**：契约层测试全绿，覆盖全部路由与错误码穷举
**AC8**：CI 就位，`pnpm test` **同时覆盖契约层与真实产物层**（AC1 + AC5）
**验证要点**：故意破坏一处（如从错误码表删掉 `UNCERTAIN_RESULT`）→ CI 必须红；恢复后绿。

---

## §7 Step 3 · 前端 Astrmira 工作台（AC1~AC7）

> 提交信息：`feat: land Astrmira workbench (3-column console, BYOK drawer, gallery reuse)`。**不引入路由库 / 状态库 / 组件库**（PLAN §6-D4）。

| 区域 | 要求 | 对应 AC |
|---|---|---|
| 左栏 | Prompt（字数安全指示）+ ✨ 扩写（**未配置 LLM Key 时不可用、配置后可用**；纯 BYOK、服务端不设兜底 Key，见台账 B3）+ 参考图拖拽槽（带目标画幅裁切预览）+ 画幅 16:9 / 9:16 / 1:1 + Seed 锁 + 引擎切换 + BYOK 抽屉 | AC1 |
| 中栏 | 播放器（`<video>` 直连 `outputs` 直链，浏览器原生 Range）+ 进度环 + 百分比 + MP4 下载 + **生成按钮 60s 冷却置灰** | AC1 / AC4 |
| 右栏 | 任务队列（实时状态）+ 画廊（缩略图）+ 【复用参数】+ 单片删除 | AC3 |
| 进度 | 轮询 `GET /api/tasks/:taskId`，**2s 间隔**；`localStorage` 存 taskId，刷新后向服务端**重挂载** | AC2 |
| UNCERTAIN | 展示「**可能已产生费用，请到服务商后台核对后手动处理**」+ 「标记已核对 / 放弃任务」动作；**不得提供任何一键重跑入口** | AC7 |
| 视觉 | 8 个 keyframes **全部落到功能位**（生成中 `mira-breathe` 替代 spinner / 完成 `star-gather` 可重播 / logo `mira-orbit-turn` 等），且 `prefers-reduced-motion: reduce` 下**全部降级为无动效**；卡片 3 位索引号；空态与页脚低对比字标水印 | AC5 |
| 排版 | 分区标题 / 面板标题 / 卡片统一走 eyebrow 体系（`--fs-eyebrow` / `--track-caps` / `--serif-caps`），**零新增硬编码字号字距** | AC6 |

**BYOK 抽屉（议题 3 的前端一半）**
- 三字段：服务端地址（预设火山方舟已填）/ Key / 模型名；
- 存储：默认 `sessionStorage`；切 `localStorage` 必须显式勾选并展示「**明文存储、仅限个人信任设备**」警示；
- 提交时从存储取值放入请求头 `X-Provider-Key`；**永不放进 URL / body**；
- 清除 = 清本地存储（无服务端路由，符合契约）；
- **HTTPS 守卫**：`location.protocol !== 'https:'` 且 host 非 localhost 时，**禁用 Key 输入**并提示「公网明文环境禁止填写密钥，请使用 HTTPS」（§9-2 的红线前置）。

**破坏性验证**：临时把 8 个 keyframes 中任一从功能位移除 → 视觉自检必须失败；在 `prefers-reduced-motion` 下截图确认无动效。

---

## §8 Step 4 · 端到端验收与体验打磨（AC1~AC4）

| AC | 内容 | 验证方式 |
|---|---|---|
| AC1 | T2V（含双引号台词人声）+ I2V（含 32 倍数裁切）各跑通 1 次完整链路 | **用 Seedance 云端轨**（本地轨全量出片 7~10h，不做验收，见 §12-1） |
| AC2 | HEIC / WebP / 超大图各上传 1 次，清洗网关无报错、输出合规 | 上传后查 `outputs/assets/` 的实际规格 |
| AC3 | DoD：后端契约测试全绿 + 上述两条 e2e 全绿 | `pnpm test:contract` + 两条 e2e 录屏/截图 |
| AC4 | CI 以 OI-2 跑通端到端并产出可播 MP4；OI-1 手动回归 | OI-1 已跳过 → **在验收记录中写明"OI-1 属台账 B7，未参与验收"**（不许含糊带过） |
| 产出 | `docs/walkthrough.md` 验收记录 | 含命令、输出摘要、截图路径 |

---

## §9 Step 5 · 部署（用户只需提供 3 个输入）

### 9-1 用户需要提供的输入（**仅此三项**，其余全部由施工方自带默认值）

| 输入 | 占位符 | 用途 |
|---|---|---|
| 服务器地址 | `<DEPLOY_HOST>` | 反代与访问入口（IP 或域名） |
| 端口 | `<DEPLOY_PORT>` | 对外 HTTPS 端口（建议 443；若已被占用则用其他端口） |
| 火山方舟 API Key | `<VOLCANO_API_KEY>` | **可选**：服务端兜底 Key。不提供也能跑（BYOK 走浏览器）；提供则 `cloud.available` 在服务端即为 true |

> 密钥获取链接见 `docs/GUIDE.md` §二 轨道 B（火山引擎控制台 → 火山方舟 → 开通视频生成 → 生成 API Key）。**该链接只写在 GUIDE，不复制到别处**。
> 服务器需要预装：Docker + Docker Compose（其余依赖由镜像自带）。

### 9-2 HTTPS 是硬前置（三条可选路径，按你手上有什么选）

| 情形 | 方案 | 说明 |
|---|---|---|
| **有域名**（推荐） | Caddy 反代 + 自动 Let's Encrypt | 配置文件 3 行，证书自动续期；**首选** |
| 只有 IP | Caddy/nginx **自签证书** | 浏览器会有证书告警、需手工信任；仍比明文强（Key 经请求头传输，明文 HTTP = 公开） |
| 纯 HTTP 内网/回环 | 允许 | 仅限内网使用；**公网纯 HTTP 必须由前端守卫禁止填写 Key**（§7） |

### 9-3 交付物与配置要点

**新增文件**：`Dockerfile`（多阶段：build shared → build backend → build frontend → 运行层装 ffmpeg）、`deploy/compose.yaml`、`deploy/Caddyfile`、`scripts/deploy.mjs`（读 `.env.deploy` 生成/校验并 `compose up -d`）

**镜像要求**
1. 运行层 `apt-get install -y ffmpeg`（**Step 5 内必须登记 `docs/UPSTREAM.md`**：来源/版本/许可证 —— 决策书 §8-2 的前置实测【待验证：默认构建为 GPL，需确认后如实标注】）；
2. `.env`、`data/`、`outputs/` **不入镜像**、不入 git（AC3）；用卷挂载 `data/` 与 `outputs/`；
3. 单进程形态：后端同时托管 `frontend/dist`（SPA fallback）+ `/api/*` + `/media/*`（= `outputs/` 的 Range 静态服务）；
4. 生产必填 `PUBLIC_API_TOKEN`（公网最小鉴权，回环免鉴权）。

**反向代理必须处理的三件事（漏任一项都会出问题）**
| 项 | 配置 | 不做的后果 |
|---|---|---|
| 请求体上限 | `client_max_body_size` ≥ **20M**（nginx 默认 1M） | 参考图上传被**静默拦掉**（客户端只看到失败） |
| 关闭对媒体响应的压缩 | nginx：`gzip off;`（或 `gzip_types` 排除 video/mp4）；Caddy：默认不压缩非文本，确认 `encode` 不含 mp4 | **206 Range 被破坏**，播放器无法拖动/无法断点续播 |
| 真实 IP 透传 | `X-Forwarded-For` + 后端 `TRUST_PROXY=1` | 防线 5 的 IP 冷却退化成**全局锁**（所有人互相误伤） |

### 9-4 部署验收（AC1~AC3）
- **AC1**：外部手机浏览器访问 `<DEPLOY_HOST>:<DEPLOY_PORT>`，在无卡环境（本地轨关闭）下**用自己的 Key** 完成一次 T2V 出片成功；
- **AC2**：探针返回 `local.available:false`，前端展示**推荐配置说明**，本地开关**不置灰**；选择本地轨提交 → `PROVIDER_UNAVAILABLE`（terminal）；
- **AC3**：`.env` / SQLite / `outputs` 均不入镜像、不入 git；`git status` 干净、镜像内 `find / -name "*.env"` 查不到真实凭证。

---

## §10 证据格式（每片完工必交，照 Step 1.5 的方式）

```
【S<n> 验收证据】
AC 逐条：AC-x → 命令 → 输出摘要（关键行原样粘贴）→ 判定（通过/不通过）
破坏性验证：做了什么破坏 → 哪条断言失败（粘贴失败输出）→ 还原后复跑通过
反例抽样：随机挑 1 条断言做"防恒真"抽查（证明它不是恒真断言）
遗留与偏差：与施工单不一致处，逐条说明原因
```

**三条硬要求**：① 不许用"应该/大概"描述结果；② 未实测的数字必须标【待验证】；③ 变更了方向性结论必须全仓检索关键词同步文档（README 协作规范 4）。

---

## §11 提交与流水线规范

1. **提交粒度**：D 段（1 个）→ R 段（1 个）→ S1…S7（每片 1 个）→ Step 3 / 4 / 5 各自 1 个；**不合并跨片提交**；
2. **消息风格**（沿用仓库现状：conventional commits + 英文摘要）：`feat:` / `fix:` / `refactor:` / `docs:` / `chore:`；
3. **分支**：直接在 `main` 上按片推进（单人项目、每片可独立回退）；如需并行验证可开 `feat/step2-s<n>` 然后快进合并；
4. **进度回检**：每片完工的**同一提交内**更新三处指针（README 徽章 + 「快速开始」段、PLAN §5 进度日志、`NEXT_SESSION_PROMPT.md` 当前指针）；
5. **版本号**：`PLAN` → V8.2；`CONTRACT` → V1.8；两处都带修订说明块；
6. **提交前自检**：`pnpm lint && pnpm type && pnpm test:contract && pnpm test:coverage` 全绿 + `pnpm build` 成功 + `pnpm smoke:ui` 通过（UI 冒烟需要先 `pnpm build`；它跑在 `NODE_ENV=production` 上，因此**生产 CSP 是真的生效的**）。

---

## §12 已知坑（**省掉你会白跑几小时**）

1. **本地 H3 全量出片 7~10 小时/条**（PLAN §8 已实测）→ **任何验收、e2e、调试一律用 Seedance 云端轨或 OI-2 夹具**。用本地轨做 Step 4 验收 = 把验收变成一周级阻塞。
2. **`packages/shared` 必须先 build**：backend/frontend 消费 `dist`，不是 `src`。改契约后不 build，后端会**安静地跑旧契约**（症状：改了字段名，接口行为不变）。
3. **CORS 未配 `allowedHeaders`** → 浏览器发 `X-Provider-Key` 会先被 OPTIONS 预检拦下（症状：本地 curl 通、浏览器永远失败）。这是当前仓库的真实缺陷，R2 必改。
4. **反代 `client_max_body_size` 与 gzip** → 见 §9-3 表（上传静默失败 / Range 被破坏）。
5. **`trustProxy` 未开** → 反代后所有请求同 IP，冷却变全局锁。
6. **幂等键与"是否真的没重复提交"**：所有"不重复调用上游"的断言必须**计数**（上游调用次数 = 1），不能只看返回同一个 taskId。
7. **中间帧清理断言要用"目录不存在"**，不能只看日志打印了"已清理"（日志不是事实）。
8. **ffmpeg 依赖**：脚本与 provider 都要"缺失即明确报错"，否则 CI 上表现为神秘的 `ENOENT`。
9. **HEIC**：`sharp` 的 HEIF 支持需实测；不许假装成功。
10. **`.tmp/` 是 gitignore 的**：施工过程产物（日志、临时脚本）放 `.tmp/`，不要混进 `docs/`。
11. **别在 `docs/` 之外新增状态描述**：进度只存在于 PLAN §5（README 规范 6）。
12. **Windows 下 better-sqlite3 / sharp 可能需要 build tools**，若装不上先记录再决定（不要静默换实现）。
13. **跨源资源会被生产 CSP 拦掉**（2026-09-22 实测）：`index.html` 曾外链 `fonts.googleapis.com`，而生产 CSP 是 `style-src 'self'` / `font-src 'self'` → 线上字体**从上线起就没生效**，本地开发却"看着正常"（开发环境按设计不开 CSP）。规则：**字体 / 样式 / 脚本一律自托管**（现做法：`frontend/public/fonts/` + `tokens.css` 的 `@font-face`，OFL 许可证文本随资源分发），静态自检 `visual-selfcheck.mjs` 第 ⑧ 条与 UI 冒烟 `scripts/smoke-ui.mjs` 各守一层。

---

## §13 台账指针（不在本次范围，别顺手做）

`B1` 用户本机 worker（S7）｜`B2` keys/verify 路由｜`B3` LLM 扩写（**纯 BYOK：服务端不设兜底 Key；做之前 ✨ 保持"未配置不可用"**）｜`B4` local/verify 运行时自检 + 设置抽屉「测试连接」｜`B6` Tier 文案单一事实源（**文案第二次修改前必须收口**）｜`B7` OI-1 素材 provider｜**`B8` 复合限流键（上线前必须做：NAT 共享出口下 IP 单键会互相误伤）——已落地**｜`B10` SSE｜`B11/B12/B14` 与 B1 同步｜`B13` Tier 数值实测｜`B15` CSP + 零 innerHTML 断言（Step 5 内落地）｜`B21` 让 `.heic` 真正可用｜`B22` 画廊容量淘汰（**暂缓**：初期存储需求不大）。

> 完整台账（含每项「何时必须做」）的**权威位置 = `PLAN.md` §9**（由 D 段迁入）。D 段合入前暂存于本机 `.tmp/ARCH-DECISIONS.md` §11-5（`.tmp/` 已 gitignore，不进仓库）。

---

## 附 · 合并说明（已合并，禁止再建第二份）

- 本文件**已合并** Step 2 分片表（早期草案中的 S1~S7 分法与阻塞判定）与 Step 1→5 全流程施工要求，是**全仓唯一的施工手册**；
- `docs/EXEC-STEP2.md`（另一会话的原计划文件名）**不再创建**；若已存在，应删除并把仍有效的内容并入本文件 §6（并入前先上报）；
- 本文件与 `PLAN.md` / `CONTRACT.md` / `GUIDE.md` 的分工见开头「文档所有权矩阵」：本文件只拥有**施工步骤**，接口看 CONTRACT、决策与 AC 看 PLAN、档位看 GUIDE；
- **生命周期**：Step 5 完工并验收后，本手册按项目既有做法（Step 1.5 的 EXEC.md 先例）**归档删除**，历史从 git 取回——它是一次性施工手册，不是长期仓库资产。
