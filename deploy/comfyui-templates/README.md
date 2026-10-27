# 可选 MOSS-Image t2i 模板

这是 **可选** 模板，不是默认 t2i，也不会自动替换 FLUX.2 Klein。

## 生产用满血版（推荐）

`moss-image-t2i-full.api.json` / `.meta.json`：

- ComfyUI **>= 0.42**（需要 `moss_image` 原生节点与 `CLIPLoader type=moss_image`）；
- `diffusion_models/moss_image_sft_bf16.safetensors`（9.47GB）
- `text_encoders/qwen3.5_9b_bf16.safetensors`（17.98GB）
- `vae/flux2-vae.safetensors`（0.31GB）
- 合计约 **27.8GB 权重**，建议 **48GB+ 显存**；32GB 只能靠 offload，不能算满血体验；
- 官方 **50 步 / CFG 3** 为质量基线；`euler/simple` 需按现场官方模板复核；
- 8-step DMD 只是可选加速 LoRA，不是满血基线。

## 本地评估用 8-step DMD（不要当生产默认）

`moss-image-t2i.api.json` / `.meta.json` 是 10GB 3080 上的评估模板，使用：

- `moss_image_sft_int8_convrot` + `qwen3.5_9b_w4a8_gptq` + `flux2-vae_small`
- `moss_image_sft_8steps_dmd` 社区 LoRA
- 8 步 / CFG 1

它用于评估文字/版式可行性，**不作为算力服务器的生产部署**。

## 启用

推荐用**独立 ComfyUI 实例**，只把模板目录指到本目录：

```bash
COMFYUI_BASE_URL=http://127.0.0.1:8189
COMFYUI_TEMPLATE_DIR=/path/to/deploy/comfyui-templates
```

> `COMFYUI_TEMPLATE_DIR` 会替换内置模板清单。不要把本目录指向同时需要 Wan/FLUX.2 的实例；需要多模型时，把对应模板都放进去并各自写 `.meta.json`。

## 不承诺

- 它不是默认模型，不做自动回退；
- 满血 BF16 的 50 步耗时/显存需要在租到的 48GB+ 机器上实测；
- 中文文字/版式明显强于当前 FLUX.2 Klein，但仍是生成模型，文字不保证逐字正确。

## experiments/ 子目录：未接线的实验模板

`experiments/flux2-klein-t2i-ref2.*` 是 **P1-1 双参考图实验**用的模板：两张图各走
`LoadImage → VAEEncode → ReferenceLatent`，两条 ReferenceLatent 串联。

- **放在子目录 = 不会被模板扫描加载**（`readdirSync(dir).filter(endsWith('.api.json'))` 只认第一层），
  所以它**不会**被误当成生产 t2i 模板挑中；
- 为什么不能直接接线：provider 目前只上传一张参考图（`{{START_IMAGE_NAME}}`），
  第二张的占位符 `{{REFERENCE_IMAGE_NAME}}` 没人填 —— 直接挂上去就是"有按钮没能力"；
- 手工跑对照实验用 `node scripts/multiref-experiment.mjs`（固定 seed，A / A+B / A+B2 三组）。

`experiments/upscale-4x.api.json` 是 **P2-1 智能超清**的候选工作流
（`LoadImage → UpscaleModelLoader → ImageUpscaleWithModel → SaveImage`）。

- 实测（RTX 3080 10GB，`4x-UltraSharp.pth` 64MB）：1024×576 → 4096×2304，**7.1 秒**；
- **暂未接线**：`GenerationMode` 里还没有 `upscale`，所以这份模板没有 sidecar（声明里的
  `modes` 只能是既有枚举），且模型名写死为 `4x-UltraSharp.pth`；
- 接线时要做的三件事：① 契约加 `upscale` 模式（或等价的操作语义）②模板把模型名换成占位符并声明能力
  ③画布节点加"超清 2x/4x"入口。
