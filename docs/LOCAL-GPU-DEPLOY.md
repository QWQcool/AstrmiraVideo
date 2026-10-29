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
