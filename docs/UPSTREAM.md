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
| 10 | **Astrmira（视觉语言）** | UI 视觉方向参考（深墨蓝 + 微光金的设计语言；`docs/assets/01~03` 三张概念图为其风格参照）。**已获作者许可**参考其设计风格；本项目与其站点无隶属关系，但不作"未授权参考"声明 | [Astrmira](https://www.astrmira.com/) |

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
