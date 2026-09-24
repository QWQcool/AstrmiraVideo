# Remotion 逐帧渲染可行性原型 · 实测报告（2026-09-24）

> **结论先行**：**不放弃 ffmpeg，引入 Remotion 做混合架构** —— 基础剪辑（裁剪/拼接/音量/变速）留 ffmpeg，字卡/字幕轨/复杂转场/动画走 Remotion。决定性证据：**ffmpeg 的 drawtext 渲染中文全是豆腐块，Remotion 用 CSS 渲染中文清晰排版**。
>
> 本目录是这次验证的可复跑源码（`src/`），产物（`frames/` `out/` `node_modules/`）不进 git。

## 一、验证的问题

用户提出：剪辑台未来要加**字卡 / 字幕轨 / 复杂转场 / 动画**，能否放弃 ffmpeg、改用 Remotion 的"逐帧渲染"（把 MP4 抽成帧序列，用 Remotion 逐帧渲染再导出）？

## 二、实测环境与方法

- 源片：真实 T2V 成片（5.09s / 1280×720 / 24fps / h264+aac / 2.8MB）
- Remotion 链路：`ffmpeg 抽帧` → 121 张 PNG → Remotion `<Img>` 逐帧贴回 + CSS 字卡 + `<Audio>` 音轨 → `remotion render` 导出
- ffmpeg 链路：单条命令（`drawtext` 字卡 + `-c:a copy` 音轨保留）
- 机器：本机开发机（Windows，ffmpeg n8.1.2）

## 三、实测数据

| 维度 | Remotion 逐帧 | ffmpeg | 判定 |
|---|---|---|---|
| **耗时**（5s 全段+字卡+音轨） | **10.3s**（二次渲染；首次 31.6s 含 chrome-headless-shell 下载） | **1.83s** | ffmpeg 快 **5.6 倍** |
| **画质**（PSNR avg vs 源片） | 31.4 dB（两次编码） | 33.8 dB（一次编码） | ffmpeg 好 **2.4 dB** |
| **产物体积** | 3.41 MB | 1.24 MB | ffmpeg 小 2.7 倍（PNG 中间帧编码效率低） |
| **音轨保留** | ✅ AAC | ✅ copy | 平手 |
| **中文字卡** | ✅ **"雨停了，我们走吧。"清晰渲染**（CSS：居中/阴影/淡入淡出） | ❌ **"口口口"豆腐块**（容器无中文字体 + drawtext 排版极弱） | **Remotion 决定性优势** |
| **排版/动画能力** | 任意 CSS + interpolate 动画 | drawtext 单字体简单样式 | Remotion 完胜 |
| **中间存储** | 帧序列 **76.9MB**（27 倍膨胀） | 无 | ffmpeg 零开销 |
| **依赖** | Remotion 全家桶 + headless Chrome（Docker 镜像 +几百 MB） | ffmpeg（Docker 已装） | ffmpeg 轻 |

## 四、结论：混合架构（不是二选一）

```
┌─ 基础剪辑（ffmpeg，现有 EDL）────────────────┐
│  裁剪 / 拼接 / 音量 / 变速 / 抽帧             │  ← 快、画质好、轻
└──────────────────────────────────────────────┘
                  ↓ 产物 MP4
┌─ 高级效果（Remotion，新能力）────────────────┐
│  字卡 / 字幕轨 / 复杂转场 / 动画             │  ← ffmpeg 做不了（中文/排版/动画）
│  输入 = 基础剪辑产物（或源片抽帧）            │
│  渲染 = <Img> 序列 + <AbsoluteFill> 叠加层    │
└──────────────────────────────────────────────┘
```

**关键洞察**：Remotion 不是替代 ffmpeg，而是**补 ffmpeg 做不了的事**。放弃 ffmpeg 改纯 Remotion 的代价（慢 5.6 倍 + 画质损失 + 存储膨胀 + 依赖重）远大于收益；但纯 ffmpeg 又做不了中文字卡/字幕轨/复杂动画。

## 五、落地到剪辑台的注意点（若做）

1. **时间轴 UI 借鉴 shotcraft `src/timeline/`**（自研、零第三方拖拽库、Apache-2.0）—— 标尺 + 可拖块 + 属性面板，但预览用 `<video>` 而非 Remotion Player（Player 只在"高级效果"阶段介入）。
2. **Remotion 渲染是离线批处理**（CLI/编程式），不是实时预览 —— 实时预览用 `<video>` + CSS overlay 近似，导出时才走 Remotion 渲染（要在 UI 上说清"预览是近似，导出以 Remotion 为准"）。
3. **并发与成本**：Remotion 渲染吃 CPU（headless Chrome 逐帧截图），生产环境要排队（复用现有 JobQueue，`track: 'local'` 单卡互斥可复用）。
4. **Remotion 许可证**：个人与小团队免费，**公司可能需要付费许可**（见其 LICENSE）——若本项目商业化需核对。
5. **首次渲染下载 chrome-headless-shell**（~100MB）—— Docker 镜像要预装，否则首次渲染慢且依赖外网。

## 五-b、补测：`<OffthreadVideo>` 路径（**正确的接入方式**，2026-09-24 追加）

第三节测的是"抽帧→PNG 序列→逐帧贴回"（**重路径**）。但 Remotion 有 `<OffthreadVideo>` 可**直接嵌入 MP4**（不抽帧）——这才是剪辑台该用的方式。补测：

| 维度 | 抽帧路径（`Video.tsx`） | **OffthreadVideo 路径（`VideoOffthread.tsx`）** |
|---|---|---|
| 中间存储 | PNG 序列 **76.9MB**（27 倍膨胀） | **零**（不抽帧） |
| 渲染耗时 | 121 帧 10.3s（85ms/帧） | 72 帧 9.4s（**130ms/帧**，内部仍逐帧解码 MP4） |
| 裁剪 | 手动控制帧序号 | `startFrom`/`endAt` 组件属性（实测裁剪 1-4s 正确） |
| 中文字卡 | ✅ 清晰 | ✅ 清晰（同一套 CSS） |
| 音轨 | 需手动 `<Audio>` 嵌入提取的 AAC | 源片音轨随视频自带（或用 `<Audio>` 覆盖） |

**结论修正**：剪辑台接入 Remotion 应走 `<OffthreadVideo>`（不抽帧）。**注意**：OffthreadVideo **不省渲染时间**（内部仍要逐帧解码 + Chrome 渲染，~130ms/帧），它省的是**存储与抽帧步骤**。外推耗时：5s@24fps≈16s，30s@30fps≈2min —— 导出应是**异步任务**（复用 JobQueue），不能让用户在界面干等。

## 五-c、P0 实测：`@remotion/web-renderer` 浏览器端导出（**最优路径**，2026-09-24）

在 Playwright 真实浏览器里跑通 `renderMediaOnWeb`（WebCodecs 硬件编码 + Mediabunny 封装，**全程浏览器、服务器零 CPU**）：

| 验证点 | 结果 |
|---|---|
| 纯字幕 composition（无视频轨） | ✅ 72 帧 → MP4（h264+aac，0.16MB），**0.3s**；中文字幕清晰渲染 |
| **读成片 + 裁剪 + 中文字幕** | ✅ input.mp4 裁剪 1~4s（`<Video trimBefore=24 trimAfter=96>`）+ 字幕 → 3.008s/1280×720/h264+aac，**1.0s / 0.46MB** |
| 逐帧确定性 | ✅ 字幕在 1.5s 处精确显示（帧驱动，非实时录制，无掉帧漂移） |
| 音轨 | ✅ 源片 AAC 随 `<Video>` 自带 |

**两个实测踩到的坑**：
1. web-renderer **不支持 `<OffthreadVideo>`**，要改用 `@remotion/media` 的 `<Video>`（`trimBefore`/`trimAfter` 是**帧数**）。
2. `<Video src>` 在 web-renderer 内部渲染上下文里**用绝对 URL + CORS**（相对路径 / `staticFile` 的 origin 不确定）。

**遥测实测**：`licenseKey: null` 也发出 `POST https://www.remotion.pro/api/track/register-usage-point`（**1 次**，含 host=域名）。**patch 验证**：短路 `sendUsageEvent`（dist/esm/index.mjs 第 1340 行，5 个调用点全是 fire-and-forget、返回值不被用）→ **遥测请求归零**，导出照常（0.46MB/1.0s）、渲染零影响。正式引入主项目时用 pnpm `patchedDependencies` 落地为可逆补丁。

**性能排序（72 帧 / 3s 视频）**：web-renderer 浏览器导出 **1.0s** < ffmpeg 服务端 1.83s < Remotion 服务端 OffthreadVideo 9.4s。web-renderer 最快（WebCodecs 硬件加速），且**把 CPU 成本完全转嫁用户浏览器**。

## 六、复跑方式

```bash
cd experiments/remotion-proto
pnpm install --ignore-workspace          # 独立依赖（不在主 workspace）
# 准备源片：把任一 mp4 命名为 input.mp4 放本目录
ffmpeg -i input.mp4 -qscale:v 2 public/frames/%04d.png   # 抽帧
ffmpeg -i input.mp4 -vn -c:a copy public/audio.aac        # 提音轨
pnpm exec remotion render src/index.ts Proto out/proto.mp4
```

> 帧数与 fps 在 `src/Root.tsx`（`TOTAL_FRAMES` / `FPS`）按源片改。

### web-renderer 浏览器导出（P0，推荐路径）

```bash
cd experiments/remotion-proto
pnpm install --ignore-workspace
pnpm exec esbuild web-export.tsx --bundle --outfile=public/web-export.js --jsx=automatic --format=esm --target=chrome100
node serve-and-verify.mjs        # 起静态服务 + Playwright 真实浏览器跑导出
# 产物在 out/web-export-result.mp4；脚本会打印遥测请求数（验证 patch 前后）
```
