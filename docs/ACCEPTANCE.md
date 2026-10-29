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
| `pnpm smoke:image --seed <照片>` | 同上（`--asset <id>` 亦可） | 超清 2× / 蒙版重绘（内外 PSNR）/ 扩图（几何 + 核心区 + 新区域标准差）**看像素** |
| `pnpm smoke:face --anchor … --images … --negatives …` | Python venv + InsightFace 模型（见 `scripts/face-similarity/README.md`） | 人脸身份相似度**分布**；没给对照图时只输出"未标定"，给误判时退出码 1 |
| `pnpm smoke:paid` | 火山 Seedance Key（**真金白银**） | 云端轨端到端：提交 / 轮询 / 成片 / 206 Range |

## 三、换机器 / 上机第一天的只读体检

| 命令 | 证明什么 |
|---|---|
| `pnpm gpu:day-one --base http://127.0.0.1:8188 --dir /` | 真实显存（不信商品页）、内存与磁盘余量、ComfyUI 带不带 H3 节点、权重缺哪几个（给目录）、sidecar 样例可解析。**只读**：不下载不改配置；退出码 0=齐 / 1=有缺口 / 2=还没装 ComfyUI |

## 四、本地模型可用性（一次性摸底，结果记在 `LOCAL-GPU-DEPLOY.md`）

- 视频：Wan2.2 TI2V-5B（本机 3080 10GB，VAEDecodeTiled + fp8 是硬要求）
- 图像：FLUX.2 Klein（`diffusion_models/flux-2-klein-4b`）
- 音频：Stable Audio 3 Small（`small_music` / `small_sfx` 各 2.1GB）+ 本机 GPT-SoVITS（`:8000/infer_single`）
- 这些**不是**本仓的生成能力：仓库里没有音频产物类型，"音频作为生成参考"是明确不做的边界。

## 五、记录约定

- 证据落 `.tmp/<片>/`（gitignored），结论与数字回填 `PLAN.md` 的台账行；
- 失败不覆盖：同一件事第二次跑挂了，两次都留着；
- 数字必须能复跑：写进文档的每个数，都对应一条可以再执行的命令。
