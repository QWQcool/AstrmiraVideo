#!/usr/bin/env python3
"""把 Stable Audio 3 Small 三件套装进一台 ComfyUI 的模型目录（V2.107）。

## 为什么要有这个脚本
配乐引擎要的是**一台装了 Stable Audio 权重的 ComfyUI**。它和视频轨那台通常不是同一台
（视频轨只有 `diffusion_models`，`models/checkpoints` 往往是空的）。换机器时最费时间的
不是下载，而是"下完不知道对不对" —— 所以这里**边下边按 LFS 的 sha256 校验**。

## 做法（与仓库既有的 `download-models.py` 同一条路子）
1. 从 `hf-mirror.com` 的 API 取**文件清单 + 每个文件的 sha256（LFS oid）+ 字节数**；
2. 从 `modelscope.cn` 下载（国内快），支持 `--continue-at` 断点续传；
3. 下完比对 sha256 与字节数，通过才 `rename` 成正式文件名；失败就留 `.partial` 下次续。

## 用法
```bash
python3 scripts/sa3-download.py                       # 默认 ComfyUI = /root/autodl-tmp/astrmira/ComfyUI
python3 scripts/sa3-download.py --comfyui /path/to/ComfyUI
python3 scripts/sa3-download.py --skip-sfx            # 只要配乐，不要音效
```
装完 ComfyUI **不用重启**：`/object_info` 每次请求都会重扫目录，新文件立刻出现在
`CheckpointLoaderSimple.ckpt_name` 候选里（实测）。

退出码：0 全部就绪（含"本来就有"）；1 下载/校验失败；2 参数或环境问题。
"""

import argparse
import hashlib
import os
import subprocess
import sys
from pathlib import Path

REPO = 'stable-audio-3'
MUSIC = 'checkpoints/stable_audio_3_small_music.safetensors'
SFX = 'checkpoints/stable_audio_3_small_sfx.safetensors'
CLIP = 'text_encoders/t5gemma_b_b_ul2.safetensors'

DEFAULT_COMFYUI = '/root/autodl-tmp/astrmira/ComfyUI'


def fetch_manifest():
    """HF 镜像的目录 API：拿到 path -> {size, lfs.oid}"""
    import json
    import urllib.request

    url = f'https://hf-mirror.com/api/models/Comfy-Org/{REPO}/tree/main?recursive=true&expand=true'
    with urllib.request.urlopen(url, timeout=30) as response:
        entries = json.load(response)
    return {entry['path']: entry for entry in entries if 'path' in entry}


def sha256_of(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def ensure(entry_name, manifest, models_root):
    if entry_name not in manifest:
        print(f'MISSING IN REPO {entry_name}', flush=True)
        return False

    entry = manifest[entry_name]
    size = entry['size']
    expected = entry['lfs']['oid']
    dest = models_root / entry_name
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = Path(f'{dest}.partial')

    if dest.exists() and dest.stat().st_size == size:
        print(f'EXISTS   {entry_name} ({size} bytes)', flush=True)
        return True

    url = f'https://www.modelscope.cn/models/Comfy-Org/{REPO}/resolve/master/{entry_name}'
    print(f'DOWNLOAD {entry_name} ({size} bytes)', flush=True)
    code = subprocess.run([
        'curl', '--fail', '--location', '--retry', '4', '--retry-delay', '5',
        '--connect-timeout', '30', '--continue-at', '-', '--output', str(part), url,
    ]).returncode
    if code != 0:
        print(f'FAILED   {entry_name} (curl {code})', flush=True)
        return False
    if part.stat().st_size != size:
        print(f'FAILED   {entry_name} (got {part.stat().st_size}, want {size})', flush=True)
        return False

    print(f'VERIFY   {entry_name} …', flush=True)
    if sha256_of(part) != expected:
        print(f'MISMATCH {entry_name} (sha256)', flush=True)
        part.unlink(missing_ok=True)
        return False

    os.replace(part, dest)
    print(f'VERIFIED {entry_name}', flush=True)
    return True


def main():
    parser = argparse.ArgumentParser(description='下载 Stable Audio 3 Small 三件套')
    parser.add_argument('--comfyui', default=DEFAULT_COMFYUI, help='ComfyUI 根目录')
    parser.add_argument('--skip-sfx', action='store_true', help='只要配乐，不要音效')
    args = parser.parse_args()

    models_root = Path(args.comfyui) / 'models'
    if not models_root.is_dir():
        print(f'✗ 不是 ComfyUI 目录（找不到 {models_root}）', flush=True)
        return 2

    try:
        manifest = fetch_manifest()
    except Exception as error:  # noqa: BLE001 — 网络错误原样报给用户
        print(f'✗ 取不到文件清单：{error}', flush=True)
        return 2

    targets = [MUSIC, CLIP] if args.skip_sfx else [MUSIC, SFX, CLIP]
    ok = all(ensure(name, manifest, models_root) for name in targets)
    print('\n✓ 全部就绪' if ok else '\n✗ 有文件没下完/校验不过', flush=True)
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
