# 上游参考与复刻台账（UPSTREAM）

> 本文记录本项目参考、复刻及直接引用的优质开源项目与组件，方便团队追溯实现来源与快速借鉴。

---

## 核心参考与复刻清单

| # | 项目 | 用途与复刻范围 | 参考链接 |
|---|---|---|---|
| 1 | **DiffSynth-Studio** | 本地 MiniMax H3 NF4 推理调用封装、Disk Offload 显存配置、Windows 段错误规避逻辑 | [ModelScope/DiffSynth-Studio](https://github.com/modelscope/DiffSynth-Studio) |
| 2 | **MiniMax H3** | 官方提示词工程规范、双引号台词音频合成语法、FL2V 处理器配置 | [MiniMax-AI/MiniMax-H3](https://github.com/MiniMax-AI/MiniMax-H3) |
| 3 | **Volcano ModelArk SDK** | 火山方舟（Seedance）异步生成任务提交、轮询与成片下载参考 | [火山方舟 API 文档](https://www.volcengine.com/) |
| 4 | **ComfyUI-VideoHelperSuite** | 视频帧预处理、32 倍数智能补边与居中裁切算法 (Smart Pad/Crop) | [ComfyUI-VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite) |
| 5 | **React Flow / @xyflow/react** | 交互节点与画布组件（用于后续进阶流程视图） | [xyflow/xyflow](https://github.com/xyflow/xyflow) |
| 6 | **WebLockShot** | 视频播放器组件、重试/退避策略 (`retry.ts`)、本地文件存储管理 | 自有参考项目 |
| 7 | **AI-SVWF** | 任务队列状态机、事件流设计、视频生成参数归一化 | 自有参考项目 |
| 8 | **Pexels API** | 可选实现项 OI-1 的主素材数据源：检索参数、多档尺寸与时长字段；要求先下载到自有服务器、禁止永久 hotlink。⚠️ `orientation = landscape\|portrait\|square`，与 Pixabay 枚举不通用，适配层必须显式映射 | [Pexels API](https://www.pexels.com/api/) |
| 9 | **Pixabay API** | 可选实现项 OI-1 的备用素材数据源（官方宣称不限次；视频库偏空镜与动态背景）。⚠️ 视频端点为横向/纵向类枚举，且另有 `video_type`（Pexels 侧对应 `size`），参数集与 Pexels 非一一对应 | [Pixabay API](https://pixabay.com/api/docs/) |
| 11 | **video-shotcraft** | 提示词配方库的**卡片结构借鉴**（"用途 / 建议时长 / 参数 / 已知坑"这种字段组织方式）。⚠️ **只借鉴结构、不抄内容**：它的 157 张卡是 Remotion 参数导向（TSX 组件 + 缓动时序 + 动态样片），我们的配方是**生成提示词骨架**导向（`skeleton` 是要粘进提示词框的中文文本、`pitfalls` 是生成经验），两者内容不通用 —— 因此 `packages/shared/src/recipes.ts` 的 20 张卡**文本全部自写**。<br>**剪辑台动效借鉴（B34 · P3，2026-09-24）**：字幕动效预设「逐词入场」（`wordSlide`：y 位移 + blur + opacity 三通道同步收敛的逐词 reveal）与「打字机」（`typewriter`）的**技法**来自其 `demos/typography/blur-slide` 与 `demos/typography/typewriter-moves`（逐帧确定性、归一化进度驱动的写法）；实现按我们的字幕场景重写（`frontend/src/edit/Composition.tsx`），**未复制其 `_fixtures` 框架**（DesignStage / Motion 工具链不引入）。时间轴交互模式（pointer 事件 + 吸附 + 裁剪手柄）亦参考其 `workbench/src/timeline/` | [Vincentwei1021/video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft)（**Apache-2.0**；2026-09-23 实测核对：仓库根有 License 文件与侧栏标识，README 正文未提及许可证） |
| 12 | **seedance-prompt-skill** | 配方库扩充（20→40 张）的**词库维度借鉴**：运镜 / 角度 / 节奏 / 焦点 / 光影 / 色调的**分类覆盖**（即"配方应该覆盖哪些维度"），以及**平台级坑清单**（Seedance 2.0 不支持写实真人脸部素材 —— 与我们踩到的上游隐私检测一致）。⚠️ 它是**即梦平台**（字节 C 端）的提示词规范，我们用**火山方舟 API**：`@图片1` 引用语法、视频延长 / 编辑 / 音频输入等即梦特有能力**不通用**，因此只借鉴**通用的运镜 / 风格词汇与分类维度**，每张卡的 `skeleton` / `pitfalls` **文本全部自写** | [songguoxs/seedance-prompt-skill](https://github.com/songguoxs/seedance-prompt-skill)（**MIT**；2026-09-24 核对：单文件 `SKILL.md`，词库在其"镜头语言词汇库 / 风格词汇库"两节） |
| 10 | **Astrmira（视觉语言）** | UI 视觉方向参考（深墨蓝 + 微光金的设计语言；`docs/assets/01~03` 三张概念图为其风格参照）。**已获作者许可**参考其设计风格；本项目与其站点无隶属关系，但不作"未授权参考"声明 | [Astrmira](https://www.astrmira.com/) |
| 13 | **Remotion**（剪辑台渲染引擎，**SDK 引入**） | **V9 剪辑台改版（台账 B34）的渲染引擎**：`@remotion/player`（预览）+ `@remotion/web-renderer`（浏览器端导出）+ `@remotion/media`（`<Video>` 组件）。**用法与 shotcraft 一致 = 纯 SDK 引入**（npm 依赖），不 fork、不复制框架源码；shotcraft 的 `demos/` 动效是**建立在 Remotion SDK 之上的 .tsx 业务组件**，可 copy 进我们的 composition 使用（其仓库 Apache-2.0）。<br>**⚠️ 一处源码级改动（用户 2026-09-24 明确决策，须随项目生命周期维护）**：用 pnpm `patchedDependencies` 把 `@remotion/web-renderer` 的 `sendUsageEvent` 短路为 no-op —— **移除浏览器导出时的遥测**（该遥测即使不设 licenseKey 也会把**终端用户的 IP 与站点域名** POST 到 `remotion.pro` 做许可审计；本项目测试环境对这类外发敏感）。**合规边界与补救路径**：① 我们属 Remotion 免费资格（≤3 人小团队、不商业化）；② 删遥测的版本**仅自用、不公开分发**；③ **本项目开源时须加回遥测**（删补丁即还原）；④ **商业化时须申请 Remotion 商业许可证**。改动点与还原方法见 `experiments/remotion-proto/REPORT.md` §五-c。<br>**✅ 正式落地（2026-09-24，B34 · P2）**：补丁文件 = `patches/@remotion__web-renderer@4.0.484.patch`（`pnpm-workspace.yaml` 的 `patchedDependencies` 注册，安装期自动生效）；**守卫断言** = `frontend/src/edit/webRendererPatch.test.ts`（版本升级 / 锁文件变化导致补丁静默失效时该测试变红——表现不会报错，只会让终端用户 IP 又外发，所以必须机器盯）；**还原 = 删 `patches/` 该文件 + `pnpm-workspace.yaml` 的 `patchedDependencies` 两行**。 | [remotion-dev/remotion](https://github.com/remotion-dev/remotion)（**Remotion License**，source-available 非 OSI：个人 / ≤3 人营利组织 / 非营利免费，>3 人营利公司需购 Company License；2026-09-24 核对 LICENSE.md 与 docs/telemetry） |

| 14 | **seedance-chain** | **链式接龙 + 批量分镜的参考实现**（2026-10-09 侦察；B 端样片/多镜头编排的方法论来源）：① **尾帧自动作为下一段首帧**的接龙（我们已有 D38 抽帧闭环的"手动一半"——抽帧 → I2V；它把这一步自动化）；② **多镜头批量提交**（一次编剧、批量出片）。⚠️ **只借这两条方法论**：它跑 Seedance **1.5 Pro**、并提到"API 相比网页端审核更少"——后半句**明确不借鉴**（我们如实透传上游审核，不做规避）；③ 它的"半自动导演"形态与我们 L3（多镜头编排）同题，可作为 L3 设计时对照。**未引用任何代码** | [PCPrincipal67/seedance-chain](https://github.com/PCPrincipal67/seedance-chain)（许可证**待核对**） |
| 15 | **ComfyUI 官方 Seedance 2.0 工作流**（FLF2V 首尾帧 / 多帧拼接） | **FLF2V 的"正统做法"参照**（2026-10-09 侦察）：① `ByteDance2FirstLastFrameNode`（首帧 + 尾帧 → 合成中间运动）被官方描述为**减少身份漂移 / 闪烁 / 构图偏移**的手段 —— 印证我们 FL2V 路线（Step 2-AC2 已实测）；② **多帧拼接**（两关键帧之间生成过渡、再 `ImageBatch`/`CreateVideo` 组装）是"分镜之间缝合"的工程手法，直接可用于 B56 样片的**镜头接龙**与 L3 的分镜编排。⚠️ 形态差异：Comfy 节点图 = **模型推理图**（可执行），我们的画布 = **血缘只读图**（不可执行）——只借"关键帧驱动 + 链式拼接"的方法论与参数经验（如 Seedance 2.0 支持 4~15s 时长区间【待我方实测核对】）。**未引用任何代码/工作流 JSON** | [comfy.org 工作流：Seedance2.0 首尾帧](https://comfy.org/zh/workflows/api_seedance2_0_flf2v-dc1311a65bc4) / [多帧拼接](https://comfy.org/zh/workflows/d833dc5abe59-d833dc5abe59)（ComfyUI 本体为 GPL-3.0，**工作流 JSON 的再分发条款待核对**） |
| 16 | **OpenMontage** | **"生产线 = 管线 + 工具 + 技能库"的产品形态参考**（2026-10-09 侦察）：自称开源 agentic 视频生产系统（12 条生产管线 / 100+ 工具 / 700+ agent 技能）。与本项目的关系：我们的**配方库（40 张卡）+ 技能 chips + 画布**是同一思想的轻量版；它可作为**B 端"批量管线"**（B49/B54）设计时对照"管线该怎么切分"。⚠️ 仅作**形态**参考，不引代码、不引提示词内容 | [calesthio/OpenMontage](https://github.com/calesthio/OpenMontage)（许可证**待核对**） |
| 17 | **Open WebUI** | **私有部署 UX 参考**（2026-10-09 侦察，服务 B52）：面向企业的**离线自托管** AI 平台形态 —— 首启引导、模型/凭据配置页、完全离线运行、单机多用户。我们的 `serve:local` / `deploy/` 要长成"客户能自助装"的形态时，**照它的信息架构抄体验**（不引代码） | [open-webui/open-webui](https://github.com/open-webui/open-webui)（**BSD-3-Clause**，2026-10-09 按其仓库首页标注；仅作 UX 参考） |
| 18 | **GitKraken Self-Hosted** | **"私有部署的许可与更新模型"的商业表达参考**（2026-10-09 侦察，服务 B52）：其官方表述"Self-Hosted 与 Serverless **功能集相同**，差别只在部署与许可模型"——这正是"一家客户一套私有部署"（D42）要讲清楚的三件事：**许可（谁有权用/几台机器）、更新通道（怎么升级/回滚）、功能对等（私有版不阉割）**。⚠️ 非开源，**只借商业模型表述**，不涉任何代码或资源 | [GitKraken Self-Hosted 文档](https://help.gitkraken.com/gitkraken-desktop/self-hosted/)（专有软件，仅文档参考） |

---

## 二进制 / 外部程序依赖（随镜像分发）

> 这些不是"参考的源码项目"，而是**随产物 / 镜像一起分发的外部程序与二进制资源**（如字体）。
> 因为分发物里**包含**它们，许可证影响必须逐项登记（部署任务见 PLAN §4 Step 5）。

| 工具 | 引入方式 | 版本 | 许可证 | 影响与说明 |
|---|---|---|---|---|
| `ffmpeg` / `ffprobe` | ① 生产镜像运行层 `apt-get install -y ffmpeg`（Debian bookworm，走镜像站）；② 开发机自行安装；③ CI runner `apt-get install -y ffmpeg`（ubuntu-latest） | ① 生产镜像 **`5.1.9-0+deb12u1`**【已验证实测】（2026-09-22 容器内 `ffmpeg -version` + `dpkg -s ffmpeg`；`ffprobe` 同版本，`dpkg` 版本串 `7:5.1.9-0+deb12u1`）；② 开发机 **`n8.1.2-50-g1a748fe2cd-20260831`**【已验证实测】（winget `Gyan.FFmpeg`）；③ CI **`6.1.1-3ubuntu5`**【已验证实测】（2026-09-22 的 CI 日志，`ffprobe` 同版本） | **GPL**：三个构建的 `configuration` 行都启用了 `--enable-gpl`（含 `libx264` 等 GPL 组件，而本项目合成命令固定用 `-c:v libx264`）——**三处均已实测确认**（生产镜像的配置行随该次实测一并核对） | 调用方式为**子进程**（`backend/src/lib/ffmpeg.ts` 用 `execFile`），不链接、不修改其源码。但镜像内**包含** GPL 二进制，再分发时需一并满足 GPL 的源码提供义务（Debian 侧源码获取见 <https://sources.debian.org/>；以 Debian / FFmpeg 官方许可说明为准）。 |
| `Cinzel`（woff2，latin + latin-ext 子集，字重 500） | 前端静态资源 `frontend/public/fonts/cinzel-*.woff2`，**随产物与镜像分发**（不是外链 CDN） | **v26**（2026-09-22 取自 google/fonts 的 `ofl/cinzel`，两个子集合计约 23KB）【已验证实测：随产物分发，且在 `NODE_ENV=production` 的 CSP 下正常加载（UI 冒烟 `scripts/smoke-ui.mjs`）】 | **SIL OFL 1.1**（允许再分发，**要求随字体附许可证文本**） | 用途：`--serif-caps`（全大写 eyebrow 标签）。许可证文本已随资源分发（`frontend/public/fonts/OFL.txt`）。**这类资源必须自托管**：生产 CSP 是 `style-src 'self'` / `font-src 'self'`，任何跨源字体/样式都会被浏览器拦掉（2026-09-22 实测踩过：外链 `fonts.googleapis.com` 自上线起就没生效，见 PLAN §5 的 B9 条目 ⑤）。 |
| `sharp` + 随包分发的 **libvips** | 后端运行时依赖（`backend/package.json` → 平台包 `@img/sharp-<platform>`，生产镜像内即为 `@img/sharp-linux-x64`） | **sharp 0.35.4 / libvips 8.18.6**【已验证实测：本机 `sharp.versions` 读数；生产为同族预编译包，标【待验证】】 | **Apache-2.0 AND LGPL-3.0-or-later**（平台包 `package.json` 原文；Apache 覆盖 sharp 代码，**LGPL 覆盖随包分发的 libvips**） | 用途：防线 4 图像清洗网关（`pipeline/imageSanitize.ts`）。调用方式是 **Node 原生绑定**（不是子进程），故镜像内**包含 LGPL 的原生库**（本机层面为 `libvips-42.dll` 约 17.8MB）——再分发时需按 LGPL 提供该库的源码获取途径与可替换性说明。**能力边界（实测）**：预编译 libvips **没有 HEVC 解码器**，`.heic` 当前走诚实拒绝（见 PLAN §5 的 S6 条目与台账 B21）；AVIF(AV1) 可用。 |

**三处各自怎么测**（避免下次再出现「文档标着待验证，而答案其实早就跑在机器上」）：

```bash
# ① 生产镜像（在部署机上执行；容器名以 docker ps 为准）
docker exec astrmiravideo-app-1 ffmpeg -version | head -1   # configuration 行也在此输出里
docker exec astrmiravideo-app-1 dpkg -s ffmpeg | grep ^Version  # Debian 打包版本（含 epoch/修订号）

# ② 开发机
ffmpeg -version | head -1

# ③ CI：`ci.yml` 的「安装 ffmpeg / ffprobe」步骤已打印 `ffmpeg -version | head -n 1`，查 run 日志即可
```

---

## 上游模型的 id 台账（云端轨）

> 模型 id **带日期后缀、随时上新**，且**可用性按账号**（方舟需先开通模型服务）。
> 所以这张表只记"我们已经在代码/文档里引用了哪些 id"以及**它们是怎么被验证的**，
> 而不是"方舟有哪些模型"（那会立刻过期）。

**验证方法（2026-09-23 实测，零费用）**：

```bash
# ① 列出该账号可见的全部模型（实测返回 135 项）
curl -s https://ark.cn-beijing.volces.com/api/v3/models -H "Authorization: Bearer $ARK_API_KEY"

# ② 判断某个模型是否**已开通可用**：空 content 探针
#    400 InvalidParameter（content 不能为空）= 模型存在且已开通
#    404 InvalidEndpointOrModel.NotFound        = 不存在或未开通
#    ⚠️ 这是"探测"不是"生成"：不会创建任务；若协议变化导致意外建任务，必须立刻 DELETE 取消
curl -s -X POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks \
  -H "Authorization: Bearer $ARK_API_KEY" -H 'content-type: application/json' \
  -d '{"model":"doubao-seedance-2-0-mini-260615","content":[]}'

# ③ 文本模型：max_tokens=1 的最小对话请求（200 = 可用）
curl -s -X POST https://ark.cn-beijing.volces.com/api/v3/chat/completions \
  -H "Authorization: Bearer $ARK_API_KEY" -H 'content-type: application/json' \
  -d '{"model":"doubao-seed-2-1-lite-260915","messages":[{"role":"user","content":"hi"}],"max_tokens":1}'
```

> 同一套逻辑已产品化为 `POST /api/providers/keys/verify`（CONTRACT §9）与凭据抽屉的「测试连接」——
> **不要在文档里写死可用性结论**，让用户点一下按钮拿到属于他账号的答案。

| 引用位置 | 值 | 验证状态 |
|---|---|---|
| `SEEDANCE_DEFAULT_MODEL`（协议层兜底） | `doubao-seedance-2-0-mini-260615` | **【已验证】开通状态 + 真实出片**（2026-09-23：T2V 5s/720p 出片成功，提交→终态 86.5s，产物 5.09s/1280×720/h264+AAC，无水印） |
| `VIDEO_MODEL_PRESETS`（抽屉下拉，6 档） | `doubao-seedance-2-0-mini-260615` / `1-0-pro-fast-251015` / `1-0-pro-250528` / `2-0-fast-260128` / `2-0-260128` / `2-5-260628` | **【已验证】**六档均通过空 content 探针（2026-09-23）；**价格说明仅为【待验证】**（官方活动页与公开报道，未经我方计费账单核对） |
| `LLM_PRESETS.volcano-ark.model`（文本轨） | `doubao-seed-2-1-lite-260915` | **【已验证】**`max_tokens:1` 返回 200（同账号另可用：`doubao-seed-2-0-mini-260215` / `deepseek-v4-flash-ga-260731` / `glm-5-3-flash-260828`） |
| 已淘汰的错值 | `doubao-seedance-video`（模板占位符，**非真实 id**） | **【已验证不可用】**404；曾导致线上故障，见 PLAN §5「V8.3 批次 6」 |
| **2026-10-09 复验（用户账号，零费用 `/models`，135 项）** | **视频族**：`doubao-seedance-2-5-260628` / `2-0-260128` / `2-0-fast-260128` / `2-0-mini-260615` / `1-5-pro-251215` / `1-0-pro-250528` / `1-0-pro-fast-251015` / `1-0-lite-t2v(与 i2v)-250428`；**图像族（本次新登记）**：`doubao-seedream-5-0-260128` / `5-0-flash-260915` / `5-0-pro-260628` / `4-5-251128` / `4-0-20260415` / `4-0-250828` / `3-0-t2i-250415`；**开源族**：`wan2-1-14b-t2v` / `-i2v` / `-flf2v-250417` | **【已验证】模型"可见"**（注意：可见 ≠ 已开通——可用性仍以空 content 探针为准，见上）；**图像族与 wan 族尚未接入本产品**（图像 = 台账 B31 / B54-③；wan 的 flf2v 与我们的 FL2V 同形，可作未来备选档）；本条同时是 B24（档位表维护）的一次事实输入 |
