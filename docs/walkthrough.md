# AstrmiraVideo · Step 4 端到端验收记录（walkthrough）

> **状态：已完成（2026-09-23）**。本文件是 PLAN §4 **Step 4** 的指定产出：只回答「AC 逐条怎么验的、命令是什么、输出是什么、判定如何」。
> **进度权威仍是 [PLAN.md](PLAN.md) §5**（本文件不重复状态描述，只说证据）；接口口径以 [CONTRACT.md](CONTRACT.md) 为准。
> 脱敏：凭证零出现；本机绝对路径以 `<repo>` / `<tmp>` 占位；命令中的站点与主机名一律 `<占位符>`。

---

## 0. 验收环境（引用时必须带上）

| 项 | 值 |
|---|---|
| 验收日期 | 2026-09-23 |
| 后端形态 | `NODE_ENV=production` 单进程（`backend/dist/index.js`，生产形态 + Bearer 鉴权），本地端口随机 |
| 云端轨 | 火山方舟 Seedance · 模型 `doubao-seedance-2-0-mini-260615`（省钱档）· 端点 `https://ark.cn-beijing.volces.com/api/v3` |
| 凭据通道 | **`X-Provider-Key` 请求头**（AC2 硬要求；本地后端刻意不设 `VOLCANO_API_KEY` / `VOLCANO_MODEL_NAME`） |
| 工具链 | Node v24.14.0 · pnpm 10.30.3 · ffmpeg/ffprobe **n8.1.2**（登记见 UPSTREAM.md） |
| 冒烟工具 | `scripts/smoke-seedance-paid.mjs`（`pnpm smoke:paid`，需显式 `--confirm-spend`） |

---

## 1. AC1 · 真实云端轨跑通 T2V 与 I2V

> AC1 原文：T2V（含双引号台词人声）与 I2V（含 32 倍数裁切）各跑通 1 次完整链路，**必须用真实云端轨**。

### 1-1 T2V（提示词含直角双引号对白）

**命令**

```bash
node scripts/smoke-seedance-paid.mjs --confirm-spend \
  --prompt-file <tmp>/prompt-t2v-dialogue.txt \
  --key-file <tmp>/ark-key.txt
```

提示词含对白：`…轻声说："雨停了，我们走吧。"`（**直角双引号**）。

**输出摘录**

```
HTTP 200 {"taskId":"4c715591-bff4-4c3c-8a9b-ffed654cf8ca"}
=== 终态：succeeded（提交→终态 89.0s）===
成片落盘：✓ 4c715591-bff4-4c3c-8a9b-ffed654cf8ca.mp4（2.80 MB）
/media 片段请求：HTTP 206（期望 206）content-range=bytes 0-1023/2940833
{ "durationSec": "5.09", "video": "h264 1280x720 24/1", "audio": "aac 2ch 32000Hz" }
封面抽帧：✓
```

**音轨的客观检测**（本记录不做"内容层"断言，只给可复现的数字）：

```
ffmpeg -i <成片> -af volumedetect  -f null -   → mean_volume: -15.8 dB / max_volume: -1.3 dB
ffmpeg -i <成片> -af silencedetect=noise=-40dB:d=0.3 -f null -  → 无 ≥0.3s 的静音段
```

**判定**：✓ 通过。
**如实澄清（必须连同结论一起引用）**：

1. 成片**自带音轨**（上游生成，非我们合成）且音轨有实际能量、全片无长静音段——但**"是否念出了那句台词"属内容层判断，本记录不断言**（自动化手段证实不了），成片留档在 `<tmp>/paid-smoke/` 供人工试听。
2. **"双引号触发对白"是本地 MiniMax H3 的能力**（GUIDE §三-1）；host 本地轨 `LocalH3Provider` 尚未实现（PLAN §5 的 Step 2 剩余项），因此**该能力不在本轮验收范围内**，不得据此认为"已在云端验证台词人声"。

### 1-2 I2V（输入图故意用**非** 32 倍数尺寸）

**输入**：`831×479` JPEG（由上一支成片抽帧后缩放得到；**故意选非 32 倍数**，以让"清洗 → 32 倍数规整"这一环真的被走到）。

**命令**

```bash
node scripts/smoke-seedance-paid.mjs --confirm-spend \
  --i2v <tmp>/i2v-input-still-831x479.jpg \
  --prompt-file <tmp>/prompt-i2v.txt \
  --key-file <tmp>/ark-key.txt
```

**输出摘录**

```
上传 i2v-input-still-831x479.jpg（0.01 MB）→ HTTP 200 {"assets":[{"assetId":"ebb218ce-…","kind":"image","mime":"image/jpeg","size":11664}]}
HTTP 200 {"taskId":"73124540-154d-4510-b71a-5ac418a88181"}
=== 终态：succeeded（提交→终态 62.3s）===
成片落盘：✓ 73124540-154d-4510-b71a-5ac418a88181.mp4（2.81 MB）
/media 片段请求：HTTP 206（期望 206）content-range=bytes 0-1023/2950319
{ "durationSec": "5.09", "video": "h264 1280x720 24/1", "audio": "aac 2ch 32000Hz" }
封面抽帧：✓
```

**清洗链路的两处落盘取证**（以**落盘产物**为准，不看响应自证）：

```
# ① 上传的资产落到 outputs/assets/ 后，尺寸已被规整为 32 倍数
ffprobe <assets>/<uploaded-asset>.jpg  → 800,448        （源图 831×479）
# ② 成片首帧与输入图的一致性（PSNR，同尺寸缩放后）
ffmpeg -i <输入图> -i <成片 0.1s 帧> -lavfi "[0:v]scale=320:180[a];[1:v]scale=320:180[b];[a][b]psnr" -f null -
  → PSNR y:39.57 u:39.76 v:41.61 average:40.22 dB
```

**判定**：✓ 通过。40 dB 级别 PSNR 证明成片**确实以输入首帧为起点**；`831×479 → 800×448` 证明 32 倍数规整在真实 HTTP 链路上生效。

### 1-3 本轮顺带实证的三条边界（非 AC 要求，但都是真实发生的）

**(a) 上游会对 I2V 输入图做隐私检测，含拟真人脸会被拒（真实踩到）**

第一次 I2V 用的是 T2V 成片首帧（画面里有拟真人物）：

```
=== 终态：failed（提交→终态 8.1s）===
HTTP 400【InputImageSensitiveContentDetected.PrivacyInformation】：
  The request failed because the input image 'content[1]' may contain real person.
disposition: terminal
```

- **归类正确**：上游明确返回错误 → `UPSTREAM_ERROR`（terminal），**没有**误归 `UNCERTAIN_RESULT`（本次并未开始生成：400 落在参数校验阶段，8.1s 终态）；
- **产品含义**：用户拿真人照片（或含拟真人物的生成图）做首帧/尾帧会被上游拒绝。当前姿态是**如实透传上游报文 + terminal**；更友好文案与前置于提示属台账（见 PLAN §9-B32）。

**(b) 防线 5 冷却（60s）在真实链路上生效**

第二次 I2V 提交时距上一次提交仅 23s：

```
HTTP 429 {"code":"RATE_LIMITED","message":"提交过于频繁：请在 37s 后重试","disposition":"retryable"}
```

**判定**：✓ 冷却是"IP + BYOK Key 指纹"复合键、跨进程重启不丢（AC9 已有自动化断言）——本次是它在**真实付费路径**上的一次自然复现。

**(c) "请求 > env > 内置默认"的模型优先级在真机上成立**

两次请求快照均为：

```
"options": { "model": "doubao-seedance-2-0-mini-260615",
             "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",
             "seedanceWatermark": false }
```

本地后端**刻意没有**设 `VOLCANO_MODEL_NAME` / `VOLCANO_API_KEY`，因此这同时证明"凭据与模型都来自请求"（AC2 硬要求的通道形态）。

---

## 2. AC2 · 上传清洗网关的输出合规（以落盘产物为准）

> AC2 原文：WebP / 超大图各上传 1 次，清洗网关**输出合规**（sRGB、32 倍数、长边 ≤ 2048、透明通道保留）——**断言以落盘产物为准**（ffprobe / sharp 元数据复核），**不看响应字段自证**；HEIC 按实测能力走"诚实拒绝"。

**先说现状与缺口（如实）**：S6 落地时，WebP / 超大图只有**单元级**覆盖（直接调 `sanitizeImage`）；走 `/api/upload` 的集成测试只覆盖了 64×64 PNG 一条。因此本轮把 AC2 点名的输入类型**固化为集成测试**（可复跑），而不是只留一次手工记录。

**新增的可复跑证据**：`backend/src/routes/upload.sanitize.integration.test.ts`（6 用例，全部走真实 multipart HTTP → `/api/upload` → 落盘 → **对磁盘文件做 sharp 元数据断言**）

| 用例 | 输入 | 落盘断言（读磁盘，不信响应） |
|---|---|---|
| WebP → JPEG | 320×256 WebP | `format=jpeg`、`space=srgb`、尺寸原样、`响应.size == 磁盘字节数` |
| 超大图 | 3000×2000 PNG | `width=2048`（= `MAX_LONG_EDGE`）、`height=1344`、两者 32 倍数 |
| 非 32 倍数 | 831×479 PNG | `800×448` |
| 透明通道 | 512×512 带 alpha PNG | 落盘 `.png`、`hasAlpha=true` |
| HEIC（HEVC） | 最小 ftyp 容器头 | **415 `INVALID_ASSET`** + 文案含「HEIC」与「JPEG 转格式」指引 + **不落盘半成品** |
| EXIF 剥离 | 带 EXIF 的 JPEG | 落盘产物 `exif` / `icc` 均为 `undefined` |

**命令**

```bash
pnpm --filter backend exec vitest run src/routes/upload.sanitize.integration.test.ts
```

**输出摘录**

```
✓ 6 passed (6)  ·  Test Files 1 passed (1)
```

**真实上传链路的一次独立取证**（付费冒烟里的上传，与本测试互证）：

```
上传 i2v-input-still-831x479.jpg（0.01 MB）→ HTTP 200 {"mime":"image/jpeg","size":11664}
ffprobe <该资产落盘文件> → 800,448
```

**破坏性验证**（钉住"下采样目标"这条断言）：

- 破坏：把 `MAX_LONG_EDGE` 由 `2048` 临时改为 `1024`；
- 命中：`AssertionError: expected 672 to be 1344`（超大图用例精确变红）；
- 还原后复跑：`6 passed`。

**HEIC（真实 HEVC 样本）的结论沿用 S6 的实测**：预编译 libvips 无 HEVC 解码器 → 415 + 转格式指引（PLAN §5 的 S6 条目记录了真实样本的实测报文）；本文件的集成用例钉的是"**白名单内但解码失败 ≠ 静默放行**"这条路径。

**判定**：✓ 通过（AC2 的全部输出合规项均有落盘级断言）。

---

## 3. AC3 · 项目级 DoD

> AC3 原文：后端契约测试全绿 + 上述两条 e2e 全绿。

| 门禁 | 命令 | 结果 |
|---|---|---|
| 契约层 | `pnpm test:contract` | **11 passed**（1 file） |
| 真实 TCP e2e（OI-2 夹具） | `pnpm test:e2e` | **1 passed**（提交 → 轮询 → `/media` 206 → ffprobe 可播 → 画廊 → 删除释放磁盘） |
| 静态门禁 | `pnpm lint && pnpm type` | lint **0 warning / 0 error**（107 files）；tsc 三包 **0 error** |
| 全量后端测试 + 覆盖率门限 | `pnpm test:coverage` | **32 文件 / 307 用例全绿**（基线为 31 / 301，本片 +6）；覆盖率总 **90.89%**（语句），文件级门限全过 |
| 前端测试 | `pnpm test:frontend` | **5 文件 / 74 用例全绿** |
| 生产形态 UI 冒烟 | `pnpm smoke:ui`（须先 `pnpm build`） | 通过（三栏 + 连通 + 抽屉 + 参数/主题 + 素材槽与封面 + 操作日志 + 控制台零 error） |

**判定**：✓ 通过。

---

## 4. AC4 · CI 端到端（OI-2 夹具；OI-1 不参与验收）

- 载体：`backend/src/e2e/fixturePipeline.e2e.test.ts`（**真实 TCP**：`listen` + `fetch`，不依赖外网与凭据）。
- 本轮复跑：`1 passed`（1173 ms 级），产出可播 MP4 并 `ffprobe` 校验通过。
- **OI-1 `stock-local`（素材 provider）已按非目标跳过**（PLAN §9-B7），**不参与验收**——如实记录，不含糊带过。

**判定**：✓ 通过。

---

## 5. 遗留与如实说明（不得省略）

1. **`failed` / `cancelled` / `canceled` / `expired` 四个上游状态枚举仍无真实样本**：本轮未构造（它们的自动化断言已由假上游覆盖，真实样本需要一次真实失败或取消，见 PLAN §4 Step 2-AC2 的"仍未实测"条目）。
2. **费用只能估算**：本轮共 3 次对上游的提交（1 次被隐私检测拒绝 + 2 次成功出片）。金额以方舟控制台账单为准（PLAN §8 成本表与台账 B24 已同步该口径）。
3. **本轮未打线上实例**：批次 5 的 V2V 线上验证已留档；Step 4 的两条 AC 使用本地后端 + 真实云端上游（走产品路径 + `X-Provider-Key`），与 Step 2-AC2 同一口径。
4. **音轨内容不做断言**（见 §1-1 的澄清）。
5. 本文件**不含**任何凭证与主机名；冒烟产物（成片 / 日志）留在 `<tmp>/` 目录，未入库。

---

## 6. 验收后的状态变更（同一提交内回检）

- PLAN §5：Step 4 由「阻塞：需一把可用 Key」→ **已完成**（证据即本文件）；
- PLAN §4 Step 4：AC1 / AC2 的现状描述按本轮结果更新，产出指向本文件；
- PLAN §8 成本表：回填本轮 T2V / I2V 的耗时实测；
- PLAN §9 台账：新增 **B32**（I2V 真人输入的前置提示与更友好文案）；
- README「快速开始」段与 NEXT_SESSION_PROMPT 指针段同步（只链接 PLAN §5）。
