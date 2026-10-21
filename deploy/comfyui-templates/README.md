# 可选 MOSS-Image t2i 模板

这是 **可选** 模板，不是默认 t2i，也不会自动替换 FLUX.2 Klein。

## 适用条件

- ComfyUI **>= 0.42**（需要 `moss_image` 原生节点与 `CLIPLoader type=moss_image`）；
- `diffusion_models/moss_image_sft_int8_convrot.safetensors`
- `text_encoders/qwen3.5_9b_w4a8_gptq.safetensors`
- `vae/flux2-vae_small.safetensors`
- `loras/moss_image_sft_8steps_dmd.safetensors`（社区 8-step DMD，Apache-2.0）

## 启用

推荐用**独立 ComfyUI 实例**，只把模板目录指到本目录：

```bash
COMFYUI_BASE_URL=http://127.0.0.1:8189
COMFYUI_TEMPLATE_DIR=/path/to/deploy/comfyui-templates
```

> `COMFYUI_TEMPLATE_DIR` 会替换内置模板清单。不要把本目录指向同时需要 Wan/FLUX.2 的实例；需要多模型时，把三份模板都放进去并各自写 `.meta.json`。

10GB 卡请加 `--lowvram`；实测 1024×1024、8 步、LoRA=1.0 可跑，但显存余量很小。更推荐部署到 16GB+ 的算力服务器。

模板里的 LoRA 文件名是固定的 `moss_image_sft_8steps_dmd.safetensors`；如改名，请同步改 `.api.json`。DMD 参数 **8 步 / CFG 1** 写死在模板里，不要按普通 MOSS 的 50 步 / CFG 3 跑。

## 不承诺

- 它不是默认模型，不做自动回退；
- 10GB 卡首次加载约 2.5 分钟；
- 中文文字/版式明显强于当前 FLUX.2 Klein，但仍是生成模型，文字不保证逐字正确。
