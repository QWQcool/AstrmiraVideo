# 本地算力部署资料（MiniMax H3 · FLUX.3 Klein · 多实例调度）

> 建立：2026-10-16 ｜ 用途：**租到显卡服务器后照着做**的部署手册（不依赖会话记忆）
> 相关：`CONTRACT §19`（ComfyUI 对接）· `§20`（运行时自检）· `SETUP-NOTES.md`（本机 3080 的 ComfyUI 环境）

---

## 一、选型结论（先说结果）

| 问题 | 结论 |
|---|---|
| 租几台？ | **1 台即可**。H3 的**实用基线是 24GB 显存**，一块 **5090（32GB）** 就够跑 768p/15s/带音频 |
| 多台有什么用？ | **只提升吞吐**（同时跑多条），不会让单条更好。加第二台的成本在我们这边 = **改一行 JSON** |
| 工作流放哪？ | **放租来的服务器上**（那是"算力"）；**我们的站点留在现有服务器（43.228.79.210）当门面 + 调度 + 数据** —— 这正是现有 `host-comfyui` 的形态，**代码不用改方向** |
| 现有服务器要 GPU 吗？ | **不需要**。它只做站点 / 任务表 / 产物存储 / 剪辑与交付，算力全在租来的机器上 |
| 文生图要单独租一台吗？ | **不用**。FLUX.3 Klein 的 FP8 版只有 5.6GB 体积、8GB 卡可跑 → **本机 3080 现在就能测**；将来 5090 也能并跑（同一张卡上行，显存互斥要排队） |

**一句话**：**算力外挂、站点留在原地**。`COMFYUI_SERVERS_FILE` 里写租来那台的地址即可。

---

## 二、MiniMax H3（视频 + 音频）

### 2.1 它能做什么 / 到什么程度

| 项 | 值 |
|---|---|
| 任务 | **t2v · i2v · 首尾帧 · 多参考（图 + 视频 + 音频）· 原生音频** |
| 画质 | **768p / 24fps / 最长 ~15 秒 / 32kHz 立体声** |
| **2K** | ❌ **拿不到**（`H3-Regenerate-2K` 未开源，只在 MiniMax 托管 API） |
| 语言 | 11 种（含中文） |
| 宽高比 | 21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16 |
| 架构 | 33.1B dense omni transformer（13B AdaLN 分支）+ **Qwen3-VL-32B 文本编码器** |

### 2.2 权重清单（ComfyUI 官方最小集，**4 个文件**）

放法：三个 `models` 子目录（与 WAN 的放法完全一样 —— 这也是我们说"模板驱动、换模型不改代码"的原因）。

| 文件 | 目标目录 | 体积 |
|---|---|---|
| `minimax_h3_{fl2va\|ref2va}_pruned_int8_convrot.safetensors` | `models/diffusion_models/` | ~21GB（每个；**只装你要用的那个**） |
| `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | `models/text_encoders/` | 15.69GB |
| `minimax_h3_video_vae_fp16.safetensors` | `models/vae/` | 5.21GB |
| `minimax_h3_audio_vae_fp32.safetensors` | `models/vae/` | 0.61GB |

- **最小磁盘 ≈ 42.5GB**（4 文件）／非剪枝 INT8 ≈ 67GB／bf16 ≈ 124GB
- 两个 diffusion 检查点对应不同任务：**FL2VA**（t2v / i2v / 首尾帧）、**Ref2VA**（多参考：图 + 视频 + 音频）
- 来源：HF `MiniMaxAI/MiniMax-H3`；ComfyUI 官方分发 `Comfy-Org/MiniMax-H3`

### 2.3 显存与硬件

| GPU 档 | 可行性（社区 + ComfyUI 团队口径） |
|---|---|
| 12GB | 有条件（pruned INT8 + NVFP4 + 分层 offload + 大内存 + 快盘），**速度与稳定性无保证** |
| **24GB（4090）** | **现实基线**：pruned INT8 + NVFP4 + 分层 offload 可跑通 |
| **32GB（5090）** | 比基线宽裕，offload 压力小 → **我们的目标机型** |
| 48GB / 80GB | 更从容 / bf16 全量 |

- 系统内存建议 **64GB+**（分层 offload 吃内存）
- **本机 3080（10GB）低于 12GB 门槛 → 不要在它上面下 H3**（42.5GB 下载 + 大概率跑不动）
- 官方**没有**发布显存要求表；上表是社区/ComfyUI 实测口径
- **租卡先核对型号与显存**：`RTX 4080` 官方只有 **16GB**，写成 "4080 32GB" 的只可能是**魔改卡或云厂商定制件**。拿到机器第一件事跑 `nvidia-smi --query-gpu=name,memory.total --format=csv`，把真实显存记下来再选权重档（16GB → INT8 剪枝 + offload；24GB+ → 走基线档）。显存数字只信 `nvidia-smi`，不信商品页。



### 2.4 部署步骤（租到机器后照做）

0. **先跑一条只读体检**：`pnpm gpu:day-one --base http://127.0.0.1:8188 --dir /`
   —— 它只读不写，一次说清：真实显存（不信商品页）、内存/磁盘余量、ComfyUI 版本带不带 H3 节点、
   权重缺哪几个（给到具体目录）、sidecar 样例是否可解析。退出码 0 = 关键项齐 / 1 = 有缺口（逐条列）/ 2 = 还没装 ComfyUI。
1. **装 ComfyUI**（Linux 用官方 repo + venv；Windows 用 portable）。版本 ≥ 0.36（H3 模板随 ComfyUI 内置）
2. **下权重**（三选一：HF / ModelScope / ComfyUI 官方分发），按 §2.2 放进三个目录
   - 下载务必**可断点续传**（42GB 级别，网络抖动会白跑）
3. **打开模板**：ComfyUI → **工作流 → 浏览模板 → 视频 → 搜 "MiniMax H3"**
   - 常见报错 `缺少 qwen3vl_32b_minimax_h3_nvfp4_awq` = 文本编码器没放对目录（见 §2.2）
   - 2026-10-29 已核实：本机 ComfyUI 0.36.0 的模板包里**已经带 H3 全套**（`video_minimax_h3_{t2v,i2v,r2v,multiframe_reference,i2v_continuation,fun_controlnet_union}` + 9 个 `api_minimax_h3_*`），不用另外找
4. **跑通一条**：先用模板自带示例出一条 5 秒片，确认能在 5090 上出片并记下耗时
5. **导出成 `.api.json`**（模板 → 导出 API 格式），放进我们的模板目录
   - ⚠️ **别直接拿模板包里的文件当我们的模板**：自带的 `api_minimax_h3_*.json` 其实是**前端图格式**（`nodes` / `links`），我们的 provider 要的是**API 格式**（`{节点id: {class_type, inputs}}`）。必须在 ComfyUI 里点"导出（API）"再存盘，两者不通用
   - 导出后按本仓约定把提示词/输入换成占位符（`{{PROMPT}}` / `{{START_IMAGE}}` …），再写 sidecar 声明 `modes`（V2.39 起能力位优先读声明，H3 这种"一个模型管 t2v/i2v/首尾帧/多参考"的文件名启发式会判错）
6. **接进我们的服务**（见 §四）

### 2.5 许可（合规，别到商用才发现）

**MiniMax H3 Community License**：

- 非商业：无限制
- **商业：允许**，但需**署名（attribution）**，且组织**近 12 个月营收 < 2000 万美元**
- 营收 ≥ 2000 万美元：需与 MiniMax 另签协议

→ 上架/交付时把"署名"这条落到界面上（类似现在 `common.executedBy` 那种如实标注）。

---

## 三、FLUX.3 Image Klein（文生图 + 图像编辑 + 多图参考）

> 2026-10-15 由 Black Forest Labs 发布并开放权重。

| 项 | 值 |
|---|---|
| 参数量 | **5.6B 蒸馏版**（16 步采样、免 CFG）+ 独立的 **Qwen3-VL-4B** 文本编码器 + 配套提示词上采样器 |
| 能力 | 文生图 · **图像编辑** · **最多 10 张参考图** · **边界框布局控制** |
| 显存 | **蒸馏版 bf16 需 ~11.2GB**；**FP8 体积仅 5.6GB → 8GB 卡可跑** |
| 许可 | **FLUX Kommunity License**（仓库需"Agree and access repository"；商用条款**逐条读**） |
| 仓库 | HF `black-forest-labs/FLUX.3-Klein`（国内镜像 `ai.gitcode.com/hf_mirrors/black-forest-labs/flux-3-image-klein`） |

**我们的判断**：
- **本机 3080（10GB）现在就能测**（用 FP8/INT8 量化版）→ **不用等租卡**
- 将来 5090 上可以与 H3 共存（不同模板），但**显存互斥**：同时只能跑一个（要么排队，要么按需切换）
- **不建议为它单独租一台**：它太小了，租一台专门跑图不划算

### 3.1 MOSS-Image（5B 文生图，Apache-2.0，JSON 布局控制）

> 与 FLUX.3 Klein 是**两条并行的线**，不是替代关系；2026-10-16 由 OpenMOSS 开源，同日 ComfyUI 合并原生支持。

| 项 | 值 |
|---|---|
| 参数量 | **5B DiT**；两个 checkpoint：`Base`（预训练）/ `SFT`（精调，文字成组更紧） |
| 能力 | 文生图 · **JSON 布局提示词**（objects / 文字 / **边界框**）· 画面内直接渲染文字（含中文与手写体） |
| 许可 | **Apache-2.0**（比 FLUX Kommunity License 宽松得多） |
| 权重（Comfy-Org 重打包） | `diffusion_models/`：`moss_image_{sft,base}_bf16` 10.2GB 或 `..._int8_convrot` **5.4GB**；`text_encoders/`：`qwen3.5_9b_int8_convrot` 9.8GB 或 `qwen3.5_9b_w4a8_gptq` 7.3GB；`vae/`：**`flux2-vae.safetensors` 340MB（本机已有，FLUX.2 Klein 在用的同一个）** |
| 显存（估，社区口径） | INT8 权重合计 ≈ **15.5GB** → 24/32GB 卡舒服；16GB 需分层卸载 |
| 仓库 | HF `OpenMOSS-Team/MOSS-Image-{Base,SFT}`；ComfyUI 专用 `Comfy-Org/MOSS-Image`（魔搭有镜像） |

**为什么值得记一笔**：它的"边界框布局控制"与我们画布"指哪放哪"是同一种输入形态，将来若要"按画布坐标直出"可能比文生图再重绘更直接。**但这属于产品决策，本轮没有拍板**，这里只登记事实。

**接进来要做的（和 H3 同一处）**：能力位仍由模板声明（§五）；ComfyUI 需更新到含 MOSS-Image 支持的版本（该支持晚于当时的正式 release tag 合并），否则节点面板里根本不出现。

## 三附、音频（**可选**，2026-10-29 登记）：先问"哪一类声音缺"

音频不是一个模型能全包的，按用途分四类；**只有第 2/3/4 类需要额外装**，第 1 类 H3 自带。

| # | 用途 | 要不要装 | 候选（社区口径，许可以官方仓库为准） |
|---|---|---|---|
| 1 | **视频自带声音** | **不用装** | H3 原生输出 32kHz 立体声，随视频封装 |
| 2 | **配乐 / 音效** | 想要"本地生成"才装 | **Stable Audio 3.0**（Small 0.6B / Medium 2B 开源，Large 闭源；ComfyUI 发布当天支持；音频到 6 分钟，显存 ≤8GB 起）；`ACE-Step`（音乐向，ComfyUI 原生支持） |
| 3 | **配音 / 旁白 / 角色台词** | 要自动念稿才装 | **Qwen3-TTS 0.6B**（Apache-2.0，48kHz，约 4GB 起）；**CosyVoice 0.5B**（Apache-2.0，中文/方言强，约 8GB）；要"像某个人"→ **IndexTTS-2.5**（0.8B，B 站自定许可）或 `GPT-SoVITS`（6–8GB，老牌整包） |
| 4 | **口型同步（让镜头里的人开口）** | 做数字人才装 | **LatentSync 1.5**（字节，音频驱动的潜扩散对口型；ComfyUI 有第三方 wrapper；8GB 起，1080p 建议 16GB） |

其它知道就行、本项目暂时用不上：整首歌/带唱（ACE-Step、YuE）、人声分离去伴奏（Demucs，做 BGM 时常用）、音频超分。

**许可（"非商用自用"要注意的三条）**：
1. "非商用"是**你的用法**，不改模型许可；上面 Apache-2.0 那几个（Qwen3-TTS / CosyVoice）最省心，商用也不用重来；
2. 少数是研究/自定许可（IndexTTS 是 B 站自定协议、H3 商用要署名、Stability 系是 Community License）——**自用没问题，卖成品前逐个读协议**；
3. 我们仓库**只登记"装什么、从哪下"**，不打包任何权重（现在也是这样：`models/` 不入库）。

**我们侧的落点（重要，别以为是"装了就自动配乐"）**：
- 剪辑台的**音效轨已经支持上传 mp3 / wav / m4a**（台账 B57，≤20MB，原样落盘）→ **最小路径 = 模型出 wav → 走现有 `/api/upload` → 进音效轨**，不改契约；
- 但**"生成音频"这个入口在本仓还不存在**：`outputVideoUrl` 之外没有音频产物类型，`音频作为生成参考`也是明确不做的边界。要做"一条龙自动配乐/自动配音"才需要新通道（契约先行）。

**结论（自用）**：现在**一个都不用急着装**。等 32GB 机器到手，按需顺序是 ① Stable Audio 3.0 Small（一个模型同时管 BGM + 音效，8GB 就能跑，把音效轨从"只能传"变成"能生成"）→ ② Qwen3-TTS 0.6B（配音）→ ③ LatentSync 1.5（要数字人才上）。

**2026-10-30 补充：三条音频路径已经各自跑通，别再混为一谈**

| 路径 | 谁在做 | 能做什么 | 不能做什么 |
|---|---|---|---|
| **H3 同期声** | 视频模型自己出（`VAEDecodeAudio` → `CreateVideo`） | 与画面**联合生成**的立体声：环境声、动作声、氛围配乐；**跟着镜头走**，天然同步 | 只随视频出（2–5 秒窗口）；**不能单独要一条 30 秒 BGM**；不能只重出声音不重出画面；音量强依赖提示词（实测 −25.4dB vs −41.5dB） |
| **Stable Audio 3 Small（本地）** | 独立音频模型 | 单独的 BGM / 音效，长度可控（实测 15–20s），可单独重做、可循环铺满整条片子 | 不知道画面内容（要靠提示词描述） |
| **MiMo-TTS（云端）/ GPT-SoVITS（本地）** | 语音合成 | 旁白 / 台词，可指定音色与情绪 | 不产生音乐与音效 |

所以我上一轮说的"音频偏轻"只针对**第 1 条**；想让片子有 30 秒配乐，得用第 2 条，不能指望 H3 一路出到底。

**小米 MiMo TTS 真机实测（2026-10-30，云端，OpenAI 兼容）**

- 端点 `POST https://api.xiaomimimo.com/v1/chat/completions`，`model: mimo-v2.5-tts`；
  `messages: [ {role:'user', content:'<情绪/风格指令>'}, {role:'assistant', content:'<要念的文本>'} ]`，
  `audio: { format:'wav', voice:'冰糖' }` → 音频在 `choices[0].message.audio.data`（base64 wav）。
- 音色：中文 `冰糖`(女) / `茉莉`(女) / `苏打`(男) / `白桦`(男)；英文 `Mia` / `Chloe` / `Milo` / `Dean`。
- 实测（三条，均 24kHz 单声道 pcm_s16le）：冰糖 6.72s 音频 **3.4s**；苏打 5.28s / **1.9s**；Mia 6.88s / **2.1s**
  → 约 **2–3.5× 实时**，音量 −19.8dB 均值（健康）。
- Key：本机用户环境变量 `MiMo_API_Key`（53 字符）；**站点服务器上没有** ——
  要走产品化必须显式放进服务器 env 或走 BYOK，且必须如实告诉用户"文本会离开本机"（这是第三方云）。

**本机还有一套离线配音（GPT-SoVITS）**：48kHz、可克隆音色、不出网；MiMo 胜在"一句话就能指定情绪"且无需 GPU。
两条都留着：要隐私/音色克隆用本地，要快速出旁白用 MiMo。

**本机实测（2026-10-29，RTX 3080 10GB，东西全在 D 盘）**：

- **TTS 不用装**：本机早就有 GPT-SoVITS 特化包（`D:\TTS\GSVI\GPT-SoVITS-1007-cu124`，自带 Python/PyTorch/cu124，3 个音色：爱丽丝 中/日、白子 中文）。起 API：`D:\TTS\start-gsvi-api.bat`（`runtime\python.exe gsvi.py -p 8000`），接口 `POST http://127.0.0.1:8000/infer_single`，请求体 `{version:'v4', model_name:'蔚蓝档案-中文-爱丽丝', prompt_text_lang:'中文', emotion:'默认', text, text_lang:'中文'}` → 返回 `{"msg":"合成成功","audio_url":"http://0.0.0.0:8000/outputs/<hash>.wav"}`（把 `0.0.0.0` 换成 `127.0.0.1` 再 GET 就是 wav）。实测：2.56s 中文（热 4s / 首 22s，首含模型加载）、12.28s 长句 **14.4s**（≈1.17× 实时）、跨语种（日语模型念中文）3.52s 音频 7s；产物 **48kHz 单声道 pcm_s16le**，均值 −19.8 ~ −21.5dB（不是静音）。
- **Stable Audio 3 Small 已装好，且不用升级 ComfyUI**：本机 ComfyUI **v0.36.0 已内置** SA3 模板与节点链 —— `CheckpointLoaderSimple` → `CLIPLoader(type='stable_audio')` → `CLIPTextEncode` ×2 → `EmptyLatentAudio(seconds,batch_size)` → `KSampler(steps=8, cfg=1, sampler='lcm', scheduler='simple')` → `VAEDecodeAudio` → `SaveAudio`。
- 权重（`hf-mirror` + `Comfy-Org/stable-audio-3`）：`stable_audio_3_small_music` **2.1GB**、`stable_audio_3_small_sfx` **2.1GB**、文本编码器 `t5gemma_b_b_ul2` **1.1GB**（→ `models/checkpoints` 与 `models/text_encoders`）。**Small 分 music / sfx 两个 checkpoint，不是同一个**。
- 实测：20s 配乐首次 **121.1s**（含加载）→ 热态 15s 只要 **2.3s**；切到 sfx 模型首次 **21.1s**；产物 **44.1kHz 立体声 FLAC**（20.06s / −23.8dB 均值），出片速度 ≈ 6.5× 实时。
- 本机小工具：`D:\ComfyUI\audio-tools\sa3-cli.mjs`（可 `--ckpt/--prompt/--seconds/--out`）+ `run-sa3-demo.bat`；样本在 `D:\TTS\audio-out\`。
- **新装一律放 D 盘**（C 盘只留系统与 IDE）：模型进 `D:\ComfyUI\...\models`，Python 环境进 `D:\TTS\...`，不要再用仓库里的 `.tmp`（`.tmp/facesim-venv` 那 850MB 是早先装的，可以随时挪走）。

---

## 四、接进我们的服务（现有代码，**不需要改方向**）

### 4.1 环境变量

| env | 用途 |
|---|---|
| `COMFYUI_BASE_URL` | **默认实例**（单台时只用这个）：如 `http://127.0.0.1:8188`；租的机器上就是 `http://<内网IP>:8188` |
| `COMFYUI_SERVERS_FILE` | **多台实例**的 JSON：`[{ name, label?, url, template?, 档位… }]` → 每台得到 `host-comfyui:<name>` |
| `COMFYUI_TEMPLATE` | 模板名（不含扩展名），如 `minimax-h3-t2v` |
| `COMFYUI_TEMPLATE_DIR` | 你自己的模板目录（运行时读 `<name>.api.json`） |

⚠️ 两条纪律（代码里已实现，别绕过）：
1. **白名单逐实例**：地址不合规的那一台只是**它自己**不可用（`available:false` + 人话原因），不影响其它；
2. **配了模板但读不出来 → 抛错**，**不回落内置**（回落会让人以为自己的模板生效了，实际跑的还是内置那张）。

### 4.2 网络拓扑与安全（**这一步最容易出事**）

```
        ┌───────────────────────────┐         ┌────────────────────────┐
用户 ──▶│ 我们的服务（43.228.79.210）│ ──HTTP─▶│ 租的 GPU 机（5090）      │
        │ 站点 · 任务表 · 产物 · 剪辑 │         │ ComfyUI :8188 + H3 权重  │
        └───────────────────────────┘         └────────────────────────┘
```

- **ComfyUI 自身没有任何鉴权** → **绝不能暴露公网**。三选一：
  1. 两台机器**同一内网/VPC**（最优）；
  2. 云安全组**只放行我们服务器的 IP**；
  3. 走加密隧道（WireGuard / SSH 端口转发）。
- 我们服务的**地址白名单**（`isAllowedEngineUrl`）要把租来那台的地址/网段配进去，否则自检会如实报"地址不合规"。
- 产物回传：ComfyUI 产物落在**它自己的 output 目录**，我们的服务要能 `GET /view` 取到（同内网即可）；我们的 `ComfyOutputSubdir` 前缀机制保证**不与别的项目混目录**。

### 4.3 验收（**用现成脚本，别手点**）

```bash
# ① 直连 ComfyUI：这台机器行不行、参数对不对、要多久
node scripts/comfyui-acceptance.mjs probe
node scripts/comfyui-acceptance.mjs t2v --width 1280 --height 720 --frames 33
node scripts/comfyui-acceptance.mjs i2v --image <参考图路径>

# ② 走我们自己的服务：整条链对不对（能力位 → 提交 → 状态 → 落盘 → executedBy）
pnpm smoke:comfy:e2e
```

判据（缺一不可）：
- 自检结论里**带模型名、模板名、支持哪些模式**（不是一句空泛的"可用"）
- 任务终态 `succeeded`，产物 `/media` 可读（HTTP 206）、**h264**、视频库可见
- `executedBy` 如实为 **`host-local`**

---

## 五、落地 H3 时**必须改的代码**（如实登记，别到现场才发现）

`backend/src/providers/comfyui/comfyuiProtocol.ts` 的 `comfyCapabilities()` 现在是**按文件名猜**模式：

```ts
if (unetName.includes('ti2v')) { modes.push('t2v', 'i2v'); }
else if (unetName.includes('i2v')) { modes.push('i2v'); … }
else { modes.push('t2v'); … 需要确认 }
unavailableReasons.push('fl2v / v2v 需要另外的模型（FLF2V / VACE 系列），本机未安装');
```

对 H3 这套会**判错**（H3 一个模型就支持 t2v/i2v/首尾帧/多参考/音频，文件名里既没有 `ti2v` 也不含 `i2v`），而且最后那句是**写死的**。

**改法（与"模板驱动"一致）**：让**模板自己声明能力** —— `.api.json` 的 sidecar 里写 `modes`（这个模板能做哪些模式）+ 期望的模型文件名匹配，`comfyCapabilities` 改为读声明、缺声明才回落文件名启发式。这样换模型/换工作流**继续不改代码**。

> **2026-10-29 更新：这条已经落地了（V2.39），现场**不需要改代码**。**
> - `comfyCapabilities()` 已支持"声明优先"（`parseTemplateDeclaration` + `resolveDeclaredModes`），并且有 H3 风格的回归测试（文件名不含 `ti2v`/`i2v` 也能判对）；
> - **sidecar 样例已备好**：`docs/templates/minimax-h3-t2v.meta.json`（与导出的 `<name>.api.json` 同名放进模板目录即可），并有单测钉住它"声明的模式都在本仓已接线集合里"；
> - ⚠️ **但 H3 的首尾帧 / 多参考今天用不上**：`COMFY_WIRED_MODES` 只有 `t2v / i2v / t2i / upscale / inpaint / outpaint`，`fl2v` / `v2v` 是**没接输入通道**（CONTRACT §19-8）。声明里写 `fl2v` 会被**如实剔除**并在自检里写原因，不会假装可用。所以现场看到"H3 只给出 t2v / i2v"是**正确行为**，不是配错了。

其它待核：
- 帧数对齐 `4n+1` 是 **Wan 的时序要求**，H3 未必（要对齐到它的模板要求）；
- H3 的**音频轨**在我们侧还没有落点（产物目前是单个 `outputVideoUrl`；音频随视频封装即可，但要确认封装格式与浏览器兼容）。

---

## 六、预算与选型建议

| 阶段 | 配置 | 用途 |
|---|---|---|
| 现在 | 本机 3080 10GB + ComfyUI | 验**管线**（WAN 2.2 5B 480p）+ 测**文生图**（FLUX.3 Klein FP8） |
| 下一步 | **1×RTX 5090 32GB**（按量或包月） | **H3 768p/15s/带音频**；也是 FLUX.3 Klein 的加速位 |
| 需要吞吐时 | + 第 2 台 | 加一行 JSON；若做了自动路由则自动分流（见 §七） |

**不建议**：H100/多卡（我们用的是 24GB 就能跑的量化版，多卡的钱买不到画质）；为文生图单独租机器。

---

## 七、多台调度（要写代码的那部分）

现状：**多实例已就绪，自动路由缺位**（现在由用户在"执行引擎"下拉里手选）。

三条路，按成本从低到高：

1. **接现成的负载均衡器**：`BrockChen/comfyui_lb` —— 多后端注册、自动选空闲、队列、健康检查、**API 完全兼容 ComfyUI**（我们**零改代码**，把 `COMFYUI_BASE_URL` 指向它即可）。**先用它验多台**。
2. **在我们服务里做最小路由**：按"档位 + 可用性 + 队列长度"选实例（我们已有多实例配置与逐台自检，缺的只是选择函数）。
3. 完整队列（优先级、重投、夜间批量）：等真有吞吐压力再做。

配套要一起做的：
- **每实例队列**（单卡互斥，多台才有并行）
- **失败重投**（A 台挂了转 B 台）
- 每实例的**并发/显存感知**

---

## 八、许可与合规清单（部署前逐条确认）

- [ ] H3：商业使用需**署名**，且营收 < 2000 万美元（超额另签）
- [ ] FLUX.3 Klein：读 **FLUX Kommunity License** 全文（HF 仓库需同意条款）
- [ ] 上游模型输出用于商用内容时的**二次分发**条款
- [ ] ComfyUI 及插件（Manager / GGUF 等）各自的许可
- [ ] ComfyUI **不暴露公网**（无鉴权）


## 附：本机 Wan 真机测试记录（V8.34 / V8.35）

下述为 RTX 3080 与 Wan 的历史结果，不代表当前 AutoDL 的 H3 或 MOSS 性能。

> **修订说明（V8.35，2026-10-13）**
> **A1 片 B · 真机验收第二轮 = 性能矩阵 + 验收脚本固化**（仍**不落契约**；台账 A1 片 B）：
> 新增 **`scripts/comfyui-acceptance.mjs`**（`pnpm smoke:comfy`）—— 真机验收工具，三种模式
> `probe` / `t2v` / `i2v`（`i2v` 会真的走 `POST /upload/image` 上传首帧，provider 的 i2v 路径正是这样）。
> 三条纪律写在文件头：**模型名从 `/object_info` 动态挑**（不硬编码 —— D53 是"模型由用户决定"）、
> **只用真机有的节点**（缺 `VAEDecodeTiled`/`Wan22ImageToVideoLatent` 就直接失败，不悄悄换回整段解码）、
> **耗时如实报**（总耗时 + ComfyUI 侧耗时，两者之差即排队时间）。
>
> **实测性能矩阵**（RTX 3080 10GB，Wan2.2 TI2V-5B，20 步 / cfg 5 / uni_pc / simple / shift 8 / `VAEDecodeTiled`）：
>
> | 场景 | 权重精度 | 尺寸 | 帧数 | ComfyUI 耗时 | 产物 |
> |---|---|---|---|---|---|
> | T2V **首次**（含 9.3GB 模型加载） | fp16 | 480×272 | 33（1.4s） | **753s（12:33）** | 124 KB |
> | T2V **首次** | fp8_e4m3fn | 480×272 | 33 | **119s** | 140.9 KB |
> | T2V 复跑（模型驻留） | fp8_e4m3fn | 480×272 | 33 | **13.8s** | 140.9 KB |
> | I2V（模型驻留） | fp8_e4m3fn | 480×272 | 33 | **17.1s** | 192.8 KB |
> | T2V（模型驻留） | fp8_e4m3fn | 832×480 | 81（3.4s） | **98.2s** | 502.3 KB |
>
> 三条结论（都对产品有直接影响）：
> 1. **`weight_dtype='fp8_e4m3fn'` 是默认档，不是优化项** —— 同一条工作流 fp16→fp8 从 **12:33 降到 119s（6.3×）**，
>    因为 9.3GB 的 fp16 权重在 10GB 显存里根本放不下（会在显存/内存间反复换出）。
> 2. **首次出片慢主要是"加载模型"**：同一个 480×272×33 任务，首次 119s vs 复跑 **13.8s** ——
>    所以界面上"本地轨很慢"的预期要按**首片 / 后续**两档说，不能只报一个数。
> 3. **代价随"面积 × 帧数"走**：832×480×81（3.4s、480p）≈ 98s，即 **约 30 s/秒视频**（480p 档）；
>    480×272 档约 **10 s/秒视频**。5 秒视频在 480p 档 ≈ 2.5 分钟 —— 这就是本地轨的真实速度。
>
> **如实登记能力边界**（同一台机器、同一套模型下**不成立**的两件事）：
> - **本地轨目前只有 `t2v` 与 `i2v`**：这台机器上 `UNETLoader` 的候选只有一个 `wan2.2_ti2v_5B_fp16`（TI2V 模型 = 文/图生视频二合一），
>   **`fl2v`（首尾帧）与 `v2v`（视频参考）需要另外的模型**（FLF2V / VACE 系列，本机**未下载**）。
>   所以 provider 的能力位要照实写：**有这个模型才亮这个模式**，而不是"节点存在就算支持"。
> - **取消只能靠重启**（第一轮结论，V8.34）：`/interrupt` 会让任务重启、`queue {delete}` 只清 pending。
>
> **脚本产出**（`.tmp/comfyui-acceptance/`，已用 `ffprobe` 复核）：三条产物 = h264 / 24fps /
> 480×272×33（1.375s）/ 480×272×33 / **832×480×81（3.375s）**。
> **下一步** = 契约 §19（模板 + 占位符 + 取消语义 + 产物路径）+ `ComfyUiProvider` + 假 ComfyUI 协议测试 + registry 注册。
>
> **修订说明（V8.34，2026-10-13）**
> **A1 片 B · 真机验收第一轮（探测 + 首次出片）完成** —— 本轮**不落契约**（provider 与契约在下一轮定稿），
> 先把"这台机器到底行不行、要多少时间"**实测出来**（这些数字后面每一处都要用）：
> ① **本机 ComfyUI 实测就绪**：`D:\ComfyUI\ComfyUI_windows_portable`（官方便携版 **0.36.0**，Python 3.13.14 / PyTorch 2.13.0+cu130）、
>    **Wan2.2 TI2V-5B 三件套齐全**（`wan2.2_ti2v_5B_fp16` 9.31GB / `umt5_xxl_fp8_e4m3fn_scaled` 6.27GB / `wan2.2_vae` 1.31GB）、
>    RTX 3080 **10GB**（空闲 9.5GB）、`/object_info` 共 **958** 个节点、其中 **44** 个名字带 `wan`（含 `Wan22ImageToVideoLatent`）。
> ② **API 格式模板的参数全部实测正确**：按官方模板 `video_wan2_2_5B_ti2v.json`
>    （20 步 / cfg 5 / **uni_pc** / **simple** / **shift 8** / fps 24 / 121 帧 / 1280×704）手写的 API 工作流
>    **提交被受理**（`POST /prompt` 返回 prompt_id），并**真出片**：
>    `480×272 × 33 帧 @24fps` → **h264 / 1.375s / 124KB**；产物在 `/history` 的
>    `outputs["<保存节点>"].images[]`（含 `filename` + `subfolder` + `type`，另有 `animated:[true]`）。
> ③ ⚠️ **10GB 卡上的三条硬结论（全是实测，不是推断）**：
>    - **`VAEDecode`（整段解码）在 10GB 上不可用**：704×480×49 那次采样只用 3:24，但 VAE 解码
>      **14.5 分钟仍未完成**（进程 RAM 20.9GB、CPU 满载 —— 权重被换出到内存后**在 CPU 上解码**）。**必须用 `VAEDecodeTiled`**（本次约 1 分钟）。
>    - **真正的瓶颈是显存 thrash**：`480×272 × 33 帧`（**仅 1.4 秒视频**）总耗时 **12 分 33 秒**，
>      其中采样 20 步占 **11:35（34.8 s/步）** —— fp16 权重 9.5GB + 文本编码器 6.3GB 在 10GB 显存上反复换出换入。
>      **优化方向已明确**（下一轮实测）：`UNETLoader.weight_dtype='fp8_e4m3fn'`（9.3GB → 约 4.9GB）/ 启动加 `--lowvram` /
>      GGUF 量化（`ComfyUI-GGUF` 插件已装，但 `UnetLoaderGGUF` 节点**当前未生效**，待查）。
>      **对产品的意义**：本地轨的"耗时预期"必须如实告诉用户（"1.4 秒视频要 12 分钟"这种量级不能藏）。
>    - **`POST /interrupt` 不会取消任务**（它打断当前执行后**任务会重启**，实测采样从 0 重来）；
>      `POST /queue {delete:[id]}` **只对 pending 生效**。**真要取消只能重启服务** ——
>      这条直接决定 provider 的"取消"语义怎么写（不能假装支持取消）。
> ④ 附带事实：该 ComfyUI 的 `output/` 目录**与别的项目共用**（里面躺着 WebLockShot 的历史产物）——
>    AstrmiraVideo 的产物必须落在自己的 `subfolder`（本轮用 `astrmira/`），否则两个项目的素材会混在一起。
> ⑤ 另一条环境事实：**`ComfyUI` 当前由本轮启动并保持运行**（`127.0.0.1:8188`，日志在 `.tmp/comfyui-out2.log`），
>    它是**用户自己的服务** —— 不需要时由用户（或经用户同意）关闭，不由代码擅自停。
>

---

## 附二：AutoDL 首日实测（2026-10-30，真机数字）

**机器**：`RTX 4080` / **32760 MiB**（`nvidia-smi` 实数，不是商品页）/ 驱动 580.105.08 /
容器内存 72 GiB / 数据盘 `/root/autodl-tmp` 250 GB（用 93 GB）/ ComfyUI **0.43.0**（**1018** 节点，`--listen 127.0.0.1 --port 8188`）。

**权重（`download-models.log` 末尾 `ALL VERIFIED`，无 `.partial`）**

| 用途 | 文件 | 体积 |
|---|---|---|
| H3 扩散 | `diffusion_models/minimax_h3_fl2va_pruned_int8_convrot` | 20 GB |
| H3 文本编码器 | `text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq` | 15 GB |
| H3 视频 VAE | `vae/minimax_h3_video_vae_fp16` | 4.9 GB |
| H3 音频 VAE | `vae/minimax_h3_audio_vae_fp32` | 578 MB |
| MOSS 扩散 | `diffusion_models/moss_image_sft_bf16` | 9.5 GB |
| MOSS 文本编码器 | `text_encoders/qwen3.5_9b_bf16` | 18 GB |
| MOSS VAE | `vae/flux2-vae`（与 FLUX.2 共用） | 321 MB |

**已跑通的实测**

| 模型 | 输入 | 结果 |
|---|---|---|
| **MOSS-Image**（先前会话） | 512×512 / 50 步 / euler+simple | **30.0s**，225 KB PNG |
| **H3** | 608×352 / 56 帧（2.33s）/ 20 步 `res_multistep` | **78.2s**（采样 3.06 s/it，含首次加载 20G+15G），184 KB |
| **H3** | 864×480 / 124 帧（5.17s）/ 20 步 | **317.7s**（采样 **14.65 s/it**），875 KB |

**产物事实（`ffprobe`）**：`h264` / 24fps / 对应尺寸 + **`aac` 32 kHz 立体声**（H3 原生音频）——
但音量偏轻：两条的均值 −50.7 dB / −46.8 dB（不是静音，只是小），是否与提示词/参考有关待再测。

**三条新事实（对代码有直接影响）**

1. **H3 的帧数是 `17n+5` 对齐**（官方模板 #132 的表达式 `max(5, round(a*24)) + (5 - max(5, round(a*24)) % 17) % 17`），
   而本仓 `alignFrames()` 是 Wan 的 `4n+1` —— **接站点前必须按模板声明改**，否则长度不合规。
2. **H3 走 `SamplerCustomAdvanced`**（`BasicGuider` + `KSamplerSelect("res_multistep")` + `BasicScheduler("simple")`），
   不是 `KSampler`：没有 `cfg` 这个概念，别把 Wan 的参数硬套过来。
3. **模板自带引用的是 `minimax_h3_video_vae_int8_convrot`**，我们下的是 **fp16**：用模板时必须把文件名改成实际的，
   否则 VAELoader 直接报"没有这个文件"。

**接进站点的模板**：`deploy/comfyui-templates/minimax-h3-t2v.api.json` + `.meta.json`
（按上面真实接线写的：`UNETLoader → CLIPLoader(minimax) → MiniMaxH3ImageToVideo → BasicGuider/KSamplerSelect/BasicScheduler/SamplerCustomAdvanced → VAEDecode + VAEDecodeAudio → CreateVideo → SaveVideo`）。

**未做 / 待办**：`ref2va`（多参考）权重没下；`fl2v` / `r2v` 本仓未接输入通道。

### 附二·1 端到端（**走产品路由**，2026-10-30 验证）

- **隧道**：站点 `43.228.79.210` 用专用密钥 `~/.ssh/astrmira_gpu` 反连 GPU，
  `ssh -N -L 172.18.0.1:18188:127.0.0.1:8188`，**绑在 docker 网关而不是 0.0.0.0**（ComfyUI 无鉴权，不能暴露公网）；
  容器内实测能读到 `comfyui_version 0.43.0`。
- **本机验证**（先不动生产）：本地后端 `COMFYUI_BASE_URL=http://127.0.0.1:<隧道>` +
  `COMFYUI_TEMPLATE_DIR=deploy/comfyui-templates` + `COMFYUI_TEMPLATE=minimax-h3-t2v`，
  走 `POST /api/generate`（t2v，`durationSec=2`）：
  `POST /api/generate → 轮询（进度来自 ComfyUI websocket：5%→100%）→ succeeded`，
  产物 **832×480 / 56 帧 / 2.33s / h264 + AAC 32kHz 立体声**（434 KB）。
- **56 帧就是 `17n+5` 的证明**：2 秒 @24fps = 48 → 声明式对齐后提交 **56**（Wan 的 `4n+1` 会给 49）。
- 过程中真机抓到一个模板机制的洞并已修：`_dropWhenMissing` 丢掉的节点，**下游指向它的输入没被一起删**，
  ComfyUI 直接拒收（`Exception when validating inner node: '6'`）。`renderWorkflow` 现在会把这类输入一并删除。
- **还没做**：站点容器侧的 env（`COMFYUI_BASE_URL` / `COMFYUI_TEMPLATE_DIR`）与模板目录挂载，
  以及一次正式部署 —— 这些会改生产配置，等确认后一次做。

### 附二·2 生产已接通（2026-10-30，`c0c7e14` 部署后）

- 站点 `.env.deploy` 增：`EXPOSE_HOST_LOCAL_TRACK=1`、`COMFYUI_BASE_URL=http://172.18.0.1:18188`、
  `COMFYUI_TEMPLATE_DIR=/app/comfyui-templates`、`COMFYUI_TEMPLATE=minimax-h3-t2v`；
  `deploy/compose.yaml` 把宿主 `deploy/comfyui-templates` 只读挂进容器（模板是数据，不重建镜像）。
- 隧道进 systemd（`astrmira-comfyui-tunnel.service`，`Restart=always`），绑 `172.18.0.1:18188`；
  旧的临时 nohup 已清掉，端口归服务持有。
- **生产实测**：容器内 `POST /api/generate`（t2v / `durationSec=2`）→ 进度走 ComfyUI websocket（0/30/55/80/100%）
  → `succeeded` → `/media/0eef8e07-….mp4`；取回 `ffprobe`：**832×480 / 56 帧 / 2.33s / h264 + AAC 32kHz 立体声 / 343 KB**。
  56 帧再次确认 `17n+5` 在**生产**生效（Wan 的 `4n+1` 会给 49）。
- 能力位自检（容器内）：`available=true`，`modes=["t2v","i2v","t2i","upscale"]`，
  依据是模板声明（`minimax-h3-t2v` → `minimax_h3_fl2va_pruned_int8_convrot`）。

### 附二·3 i2v 生产复验 + 一个只在生产暴露的 bug（2026-10-30，`5725c4a`）

- **i2v 首次在生产失败**：`UNCERTAIN_RESULT: 执行中断且无法确认上游结果：fetch failed`，
  app 日志里的真因是 `fetch failed: unable to get local issuer certificate`
  —— `uploadReferenceImage` 拿 `PUBLIC_BASE_URL`（IP 档 Caddy 的**自签证书**）去下载**自己的** `/media/*`，
  Node 直接拒。**图根本没离开本机**，不该绕公网。
- 修法：`ComfyUiProvider` 把 `/media/*` 的地址改写到**内部基址**（默认 `http://127.0.0.1:PORT`，
  可用 `COMFYUI_MEDIA_ORIGIN` 覆盖），`data:` URL 与其他域名原样不动。
  本地用「故意把 `PUBLIC_BASE_URL` 设成不可达域名」验证过：i2v 照样出片。
- **修后生产实测**（首帧 = 定妆图 512×512）：
  `POST /api/generate`（i2v / 2 秒）→ `succeeded`，产物 **832×480 / 56 帧 / 2.33s / h264 + AAC 32kHz 立体声**；
  **首帧与种子图 SSIM = 0.968**（真的从那张图开始，不是退化成 t2v）。
- **音频音量终于有对照了**：同一台机器、同一模板，
  提示词里**明确要声音**（wind / footsteps）时 i2v 均值 **−25.4 dB**（max −10.6），
  而没提声音的 t2v 是 **−41.5 / −46.8 dB** → **"偏轻"主要是没要求声音，不是模型缺陷**；
  界面上若要"有声音"，提示词里得写清楚。

### 附二·3b 首尾帧 `fl2v` 真机验收（2026-10-30，契约 V2.104）

- **先查能力，再写代码**：`GET /object_info/MiniMaxH3ImageToVideo` →
  `required = clip / vae / prompt / width / height / length`，`optional = first_frame / last_frame`。
  也就是说**模型的输入口本来就有尾帧**，缺的只是我们这一侧把它塞进去。
- **模板怎么接**（`deploy/comfyui-templates/minimax-h3-t2v.api.json`）：
  新增节点 **16** = `LoadImage{ image: "{{LAST_IMAGE_NAME}}" }` + `_dropWhenMissing`;
  主节点 5 加 `last_frame: "{{LAST_IMAGE}}"`（占位符整值替换成 `["16", 0]`）。
  没给尾帧时**键被删、节点 16 也被删**，同一份模板退回 i2v。
- **一个隐患顺手修掉**：连接目标原先是写死的 `['56', 0]`（内置 Wan 模板的 LoadImage 节点号）。
  换成用户模板（H3 首帧是 6、尾帧是 16）后它会指向不存在的节点。现在按
  "哪个 LoadImage 用了这个占位符"反查（`loadImageNodeIdFor`）。
- **验收命令**（可复跑）：

```bash
# 本地先建一条隧道到 GPU 机的 8188（ComfyUI 只监听回环）
python .tmp/ssh-forward.py <gpu-host> <ssh-port> root 18188 8188 &
pnpm build     # ⚠️ 脚本读 backend/dist —— 只跑 tsc --noEmit 会用旧代码，见下面的坑
pnpm smoke:fl2v -- --base http://127.0.0.1:18188 \
  --first .tmp/e2e/b103-anchor-scene1.png --last .tmp/e2e/b103-anchor-scene2.png
```

- **实测（608×352 × 124 帧 = 17n+5，20 步）**：
  出片 **173.0s**（模型已热；同参数**冷态** 294.7s），产物 **5.17s / 124 帧 / 带 AAC 音轨**；
  接线自检 = 2 个 `LoadImage` 且 `last_frame → ["16",0] → b103-anchor-scene2.png`。
- **归属判据用相对 SSIM**（尾帧是模型生成的中间态，绝对值本来就低）：

| 量 | 图A（首帧目标） | 图B（尾帧目标） |
|---|---|---|
| 视频**首帧** | **0.9706** | 0.1108 |
| 视频**尾帧** | 0.1475 | **0.2631** |

  两个排序都成立 → **两张图都被吃进去了**。这里**不设绝对阈值**：
  0.2631 看着不高，但它是"生成出来的中间态 vs 目标图"，与 B103 片 C 人脸相似度那次
  「单阈值不可用、只看相对」是同一条纪律。
- ⚠️ **踩到的坑（值得写下来）**：第一次跑出来"首帧很准、尾帧完全不像"，差点判成"模型不吃尾帧"——
  实际是**跑的是旧的 `backend/dist`**（改了 `comfyuiProtocol.ts` 却只跑了 `tsc --noEmit`，
  没 `build`），装配出来的工作流里根本没有节点 16。现在脚本第一步就打印
  "N 个 LoadImage，last_frame = …"，就是为了让这种"代码没生效"当场可见。

### 附二·4 换机器时的接入（`deploy/gpu-link.sh`，一条命令）

今天这套（生成密钥 → 装公钥 → 写 systemd → 探活）已固化成脚本，在**站点服务器**上跑：

```bash
scp deploy/gpu-link.sh root@<site>:/root/
ssh root@<site> 'bash /root/gpu-link.sh --gpu-host <gpu> --gpu-port <port> --copy-id'   # 首次：装公钥（问一次 GPU 密码）
ssh root@<site> 'bash /root/gpu-link.sh --gpu-host <gpu> --gpu-port <port>'             # 之后：幂等，只重启+探活
```

它做的五件事，顺序固定：① 绑定地址默认取**应用容器的 docker 网关**（绝不 0.0.0.0 —— ComfyUI 无鉴权）；
② 专用密钥 `~/.ssh/astrmira_gpu`；③ 密钥登录探测（失败时打印要追加的 authorized_keys 行，不静默继续）；
④ 写 `astrmira-comfyui-tunnel.service`（`Restart=always`）并重启；⑤ **宿主机 + 应用容器两头探活**
（容器能连才算通），最后打印该写进 `.env.deploy` 的那几行。

2026-10-30 在线上实跑（幂等路径）：绑定 `172.18.0.1:18188`、密钥复用、服务 `active`（NRestarts=0）、
宿主机 HTTP 200、容器探活 OK。

**界面上也已加耗时预期**（`canvas.studio.etaLocal`）：本地轨的节点参数条会按"分辨率 × 时长"给出
"约 N 分钟（按真机实测）· 首次再加 1–2 分钟加载模型" —— 系数取自 864×480×124 帧 = 293s 采样
（5.7e-6 秒/(像素·帧)，含约 8% 解码开销）。不给预期的话，用户会把"5 秒片要 5 分钟"当成卡死。
