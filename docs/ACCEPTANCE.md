# 验收命令清单（ACCEPTANCE）

> 一张表回答"要证明什么，跑哪条命令"。判据写在每个脚本自己的头注释里；这里只做索引。
> 铁律：**"没测"不等于"通过"** —— 跑不了的（缺 GPU / 缺模型 / 缺凭据）都是**退出码 2 或明确报错**，不要用"跑过了"糊过去。

## 一、每次改代码都要过的（零外网、零 GPU、零费用）

| 命令 | 证明什么 |
|---|---|
| `pnpm lint` | 静态检查 0 error（`--deny-warnings`） |
| `pnpm type` | 三个包 `tsc --noEmit` 全过 |
| `pnpm test:contract` | 契约层：路由 / 错误码 / 三态 `disposition` 与 CONTRACT.md 一致 |
| `pnpm test` | 后端 + 前端单测 |
| `pnpm build` | 三包构建产物；**`smoke:ui` 跑的是 dist，不 build 会拿旧包跑出假结论** |
| `pnpm smoke:ui` | 前端真实浏览器：三栏 / 首屏连通 / 抽屉 / 素材槽与画廊封面 / 中英双语 / 控制台零 error（约 10 分钟） |
| `pnpm test:browser:agent` `test:browser:runs` `test:browser:media` `test:browser:edges` | 会话详情、创作会话、血缘画布等真实浏览器行为 |
| `pnpm test:browser:audio` | **剪辑台音效轨**：加进去的 BGM 真的进了导出成片（1000Hz 窄带 ≥ 对照带 +6dB），且源片音轨仍在（2026-10-29 新增） |

## 二、要 GPU / 本地模型才跑得了的（真机验收，不进 CI）

| 命令 | 前置 | 证明什么 |
|---|---|---|
| `pnpm smoke:comfy -- probe` | 本机 ComfyUI（`COMFYUI_BASE_URL`） | 节点清单、模型与实际出片能力（t2v / i2v） |
| `pnpm smoke:comfy:e2e` | 同上 + `EXPOSE_HOST_LOCAL_TRACK=1` | **走产品路由**的全链路：能力位 → 提交 → 轮询 → 落盘 → `/media` |
| `pnpm smoke:audio` | MiMo Key（或 `--narration`）+ 本机 ComfyUI 带 Stable Audio（或 `--bgm`）+ `pnpm build` | **声音分层**：真实 TTS 旁白 + 真实音乐模型配乐 → `POST /api/upload` → 剪辑台音效轨叠加 → 浏览器导出两次（只差配乐）→ ffprobe + 窄带频谱证明**两层各自可归因**（旁白 1kHz 高出对照带 ≥6dB；人声结束后配乐比静音高 ≥10dB；人声期间 100Hz 高 ≥3dB）。证据 `.tmp/e2e/phase1-audio-layers.json` |
| `pnpm smoke:audio:panel` | 同上 | **一条龙（V2.103）**：剪辑台「声音」面板里写台词/配乐描述 → `POST /api/audio` → 任务轮询 → **自动落到音效轨**（0 帧、裁到片长、带淡入淡出，配乐与配音各占一条轨）→ 导出两次（只差配乐）→ ffprobe + 频谱归因（100Hz 比"只有旁白"高 ≥3dB；旁白 1kHz 高出对照带 ≥6dB）。顺带断言界面上的**隐私标注**（配音=第三方云 / 配乐=本机）。证据 `.tmp/e2e/phase2-audio-panel.json` |
| `pnpm smoke:audio:prod -- --base <部署地址> [--token <PUBLIC_API_TOKEN>]` | 部署上两个引擎都配好 | **部署是否接通**（V2.106）：`GET /api/audio/engines` 两条都 `available` → `POST /api/audio` 配音/配乐各跑一条 → 轮询终态 → 下载产物 ffprobe（配音 24kHz 单声道且非静音；配乐 44.1kHz 立体声且**时长等于请求值**——这条同时钉住 V2.105 的幂等修复）。**它不证明"两层混进成片"**：混音在浏览器里，那条由 `smoke:audio:panel` 负责 |
| `pnpm smoke:image --seed <照片>` | 同上（`--asset <id>` 亦可） | 超清 2× / 蒙版重绘（内外 PSNR）/ 扩图（几何 + 核心区 + 新区域标准差）**看像素** |
| `pnpm smoke:fl2v -- --base <ComfyUI> --first <首帧.png> --last <尾帧.png>` | H3 权重 + `deploy/comfyui-templates/minimax-h3-t2v.*` + `pnpm build` | **首尾帧接线（V2.104）**：用仓库自己的 `buildComfyWorkflow` 装配 → 两个 `LoadImage` 且 `last_frame` 指向尾帧节点 → 上游接受 → **相对 SSIM 归属**（首帧更像图A、尾帧更像图B；尾帧是模型生成的中间态，绝对相似度本来就低，别拿阈值卡）。证据 `.tmp/e2e/fl2v-acceptance.json` |
| `pnpm smoke:face --anchor … --images … --negatives …` | Python venv + InsightFace 模型（见 `scripts/face-similarity/README.md`） | 人脸身份相似度**分布**；没给对照图时只输出"未标定"，给误判时退出码 1 |
| `pnpm smoke:paid` | 火山 Seedance Key（**真金白银**） | 云端轨端到端：提交 / 轮询 / 成片 / 206 Range |

## 三、换机器 / 上机第一天的只读体检

| 命令 | 证明什么 |
|---|---|
| `pnpm gpu:day-one --base http://127.0.0.1:8188 --dir /` | 真实显存（不信商品页）、内存与磁盘余量、ComfyUI 带不带 H3 节点、权重缺哪几个（给目录）、sidecar 样例可解析。**只读**：不下载不改配置；退出码 0=齐 / 1=有缺口 / 2=还没装 ComfyUI |

## 四、本地模型可用性（一次性摸底，结果记在 `LOCAL-GPU-DEPLOY.md`）

- 视频：Wan2.2 TI2V-5B（本机 3080 10GB，VAEDecodeTiled + fp8 是硬要求）
- 图像：FLUX.2 Klein（`diffusion_models/flux-2-klein-4b`）
- 音频：Stable Audio 3 Small（`small_music` / `small_sfx` 各 2.1GB）+ 本机 GPT-SoVITS（`:8000/infer_single`）+ 云端 MiMo-TTS
- **2026-10-30 更新**：音频**已经成为**「能进成片的素材」—— `pnpm smoke:audio` 证明模型出的 wav 经
  `POST /api/upload` → 剪辑台音效轨 → 浏览器导出，两层声音各自可归因（见上表）。
  仍未做的是**"音频作为生成参考"**（拿一段 wav 去驱动视频模型）—— 那条边界**不变**。

## 五、记录约定

- 证据落 `.tmp/<片>/`（gitignored），结论与数字回填 `PLAN.md` 的台账行；
- 失败不覆盖：同一件事第二次跑挂了，两次都留着；
- 数字必须能复跑：写进文档的每个数，都对应一条可以再执行的命令。
