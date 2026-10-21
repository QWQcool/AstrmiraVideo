# MOSS-Image 8-step DMD / 量化版评估（2026-10-21）

> 结论：**可以跑通，文字/海报能力明显强于当前 FLUX.2 Klein；但不建议现在替换默认 t2i。**
> 作为可选 t2i 模板保留，优先部署到 16GB+ 的算力服务器；10GB 卡需 `--lowvram`，显存余量很小。

## 1. 实测环境

| 项 | 值 |
|---|---|
| GPU | RTX 3080 10GB（驱动 591.74） |
| 旧 ComfyUI | v0.36.0（生产实例，保持不动） |
| MOSS 测试实例 | **ComfyUI 0.42.0** 隔离副本，端口 8189 |
| 启动参数 | `--lowvram` |
| 模型 | `moss_image_sft_int8_convrot` + `qwen3.5_9b_w4a8_gptq` + `flux2-vae_small` + 社区 8-step DMD LoRA |
| 采样 | **8 步 / CFG 1 / euler / simple / LoRA 1.0** |

隔离方式：最新 ComfyUI 代码 + `moss-site` 新版前端/kitchen 包，用独立 launcher 启动；**没有升级或改动旧 v0.36.0**。测完已停止 8189，旧 8188 已恢复。

## 2. 权重与体积

| 文件 | 体积 |
|---|---:|
| `moss_image_sft_int8_convrot.safetensors` | 5.04 GB |
| `qwen3.5_9b_w4a8_gptq.safetensors` | 6.84 GB |
| `flux2-vae_small.safetensors` | 0.23 GB |
| `moss_image_sft_8steps_dmd.safetensors` | 1.11 GB |
| 合计（磁盘） | ~13.2 GB |

来源：
- `Comfy-Org/MOSS-Image`（官方 ComfyUI 打包，Apache-2.0）
- `lodestones/MOSS-Image-SFT-8-steps-dmd`（社区 DMD LoRA，Apache-2.0）

## 3. 结果

### 3.1 纯画面（雨夜霓虹橘猫）

![MOSS 1024×1024 雨夜霓虹橘猫](assets/moss-image-eval/moss-cat.jpg)

- 512×512 首次：**151s**（含模型加载/编译；8 步采样约 10 it/s）；
- 1024×1024 暖跑：**6s**；
- 1024 文件 1.29 MB；
- 观察显存：**9.55 GB / 10.24 GB**，空闲约 1.1 GB。

### 3.2 中文海报（同提示词对照）

MOSS-Image：

![MOSS 中文海报](assets/moss-image-eval/moss-poster-text.jpg)

当前 FLUX.2 Klein 4B（4 步，同提示词、1024）：

![FLUX.2 Klein 中文海报](assets/moss-image-eval/flux2-poster.jpg)

差异很直接：

- MOSS 主标题「雨夜霓虹」、副标题「2026 城市影像展」**都基本正确**；装饰性小字仍有错字。
- FLUX.2 Klein 的主标题已经错了（生成出近形字），副标题更明显。
- 这不是“MOSS 一定更好”的普遍结论，而是**中文文字/版式场景**上 MOSS 的明确优势。
- MOSS 10.2 中文海报暖跑约 **56s**（文本编码/编译开销高于纯画面）；FLUX.2 对照首次加载 + 4 步约 **111s**。

## 4. 与当前本地模型对比

| 维度 | MOSS-Image SFT int8 + w4a8 + 8-step DMD | FLUX.2 Klein 4B（当前默认） |
|---|---|---|
| 中文文字/排版 | **强**（主副标题基本正确） | 弱（近形字/错字） |
| 纯画面速度 | 暖跑 1024 约 6s | 4 步，暖跑也快 |
| 首次加载 | ~2.5 分钟（10GB 低显存 + 动态 offload） | 较轻，加载更快 |
| 显存 | 观察 9.55GB，余量 ~1.1GB | 4B 模型，余量更大 |
| 权重磁盘 | ~13.2GB | ~?（现有 flux 4B 文件） |
| 部署门槛 | ComfyUI >=0.42 + 新前端/kitchen 包 | 现有 v0.36 即可 |
| 适合 | 海报、带字排版、中文文字、布局 | 通用快速出图、日常迭代 |

**不是替代关系**：MOSS 更适合“带字/版式”场景，FLUX.2 更适合默认快速出图。两者都保留，按技能/用户选择切换。

## 5. 建议

1. **默认仍用 FLUX.2 Klein**，不自动切 MOSS；MOSS 作为可选 t2i 模板/独立引擎。
2. 部署到算力服务器时，优先 **16GB+ 显存**；10GB 卡需 `--lowvram`，且不要与视频模型同时占卡。
3. 可选模板已放在 `deploy/comfyui-templates/moss-image-t2i.*`；用独立 ComfyUI 实例 + `COMFYUI_TEMPLATE_DIR` 启用，具体见同目录 README。
4. 8-step DMD LoRA 是社区蒸馏，不是官方 50 步质量承诺；文字/版式仍需人工复核。
5. 本次只验证了普通 prompt 和一张中文海报；**layout JSON/bbox 尚未实测**，不作为已支持能力。

## 6. 复现命令（隔离实例）

```bash
# 模型目录
ComfyUI/models/diffusion_models/moss_image_sft_int8_convrot.safetensors
ComfyUI/models/text_encoders/qwen3.5_9b_w4a8_gptq.safetensors
ComfyUI/models/vae/flux2-vae_small.safetensors
ComfyUI/models/loras/moss_image_sft_8steps_dmd.safetensors

# 最新 ComfyUI，独立端口
python main.py --listen 127.0.0.1 --port 8189 --lowvram
```

模板使用 `KSampler` 8 步、cfg 1、euler/simple；LoRA 强度 1.0。详细节点见 `deploy/comfyui-templates/moss-image-t2i.api.json`。

## 7. 未验/边界

- 没有官方速度/显存 benchmark，以上是本机观察值；
- 没有 FID/CLIP/人工偏好等定量评测；
- 只测了一张中文海报，文字仍有装饰性错字；
- layout JSON（bbox）没有实测；
- 8-step DMD 为社区版本，后续换 LoRA/权重需重测；
- 10GB 卡首次加载慢、显存余量小，不适合作为默认高并发服务。
