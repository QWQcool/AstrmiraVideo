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

---

## 二进制 / 外部程序依赖（随镜像分发）

> 这些不是"参考的源码项目"，而是**运行时会调用到的外部程序**。因为它们随镜像一起分发，
> 许可证影响必须单独登记（施工单 §9-3 第 1 条）。

| 工具 | 引入方式 | 版本 | 许可证 | 影响与说明 |
|---|---|---|---|---|
| `ffmpeg` / `ffprobe` | 生产镜像运行层 `apt-get install -y ffmpeg`（Debian bookworm）；开发机需自行安装 | 【待验证】首次构建后用 `ffmpeg -version` 回填 | **GPL**（Debian 的构建启用了 libx264 等 GPL 组件，而本项目合成命令用 `-c:v libx264`） | 调用方式为**子进程**（`backend/src/lib/ffmpeg.ts` 用 `execFile`），不链接、不修改其源码。但镜像内**包含** GPL 二进制，再分发时需一并满足 GPL 的源码提供义务（以 Debian / FFmpeg 官方许可说明为准）。**此处只陈述事实，许可证结论需人工确认。** |
