# 部署手册（站点已上线 · 租算力服务器后一次做完）

> 基线：2026-10-22，HEAD `806c679`。  
> 本文把**已经成功的站点部署**和**所有依赖 GPU 算力服务器的开发项**放在一起，避免租到机器后靠会话记忆现场发挥。  
> 相关文档：`docs/LOCAL-GPU-DEPLOY.md`（H3 选型/权重/网络细节）、`docs/REFERENCES.md`（MOSS 实测那一段）、`deploy/comfyui-templates/README.md`（MOSS 可选模板）。

---

## 0. 一句话架构

```
用户
  │ HTTPS + Basic Auth
  ▼
现有站点服务器（`<站点服务器>`，无 GPU；地址见部署环境）
  app  (Fastify :3000)  ── 任务表 / 产物 / 剪辑 / Agent 文本规划
  caddy(:443)           ── TLS + 登录 + 反代
  │
  │ 私网 / VPN / 安全组白名单（不暴露公网）
  ▼
租来的 GPU 算力服务器（满血 MOSS：48GB+；H3 单跑 24–32GB）
  ComfyUI :8188  ── MiniMax H3（视频 + 音频）
  ComfyUI :8189  ── MOSS-Image SFT BF16（可选 t2i；官方 50 步为基线）
```

**站点不搬、不重启、不加 GPU。** 租来的机器只做推理，经 `COMFYUI_SERVERS_FILE` 接进来。

---

## 1. 当前已成功的站点部署（留档）

### 1.1 生产组成

| 组件 | 作用 |
|---|---|
| `deploy/compose.yaml` | `app` + `caddy` 两个容器 |
| `app` | 单进程 Fastify，`/api`、`/media`、前端静态产物；**不映射宿主端口** |
| `caddy` | 自动 HTTPS（IP 档自签 / 域名档 ACME）、Basic Auth、反代到 app |
| `data/` 卷 | SQLite、画布、项目、日志 |
| `outputs/` 卷 | 成片、缩略图、参考资产 |
| `.env.deploy` | **只在服务器存在**，不入镜像、不入 git |

当前线上：`https://<站点服务器>/`，`/api/health` 200。GitHub Actions 最近一次：
`verify` 4m23s，`deploy` 2m40s，成功。

### 1.2 首次部署（新服务器）

前置：Docker + Docker Compose、可访问目标端口、域名或公网 IP。

```bash
# 1) 服务器上准备目录
mkdir -p /root/astrmira && cd /root/astrmira

# 2) 从仓库根复制部署配置
cp .env.deploy.example .env.deploy
# 编辑：DEPLOY_HOST / DEPLOY_PORT / PUBLIC_API_TOKEN / BASIC_AUTH_PASSWORD
# 可选：VOLCANO_API_KEY

# 3) 启动（deploy.mjs 会推导 TLS_MODE / PUBLIC_BASE_URL / CORS / bcrypt）
node scripts/deploy.mjs
```

`deploy.mjs` 做四件事：

- 检查 `.env.deploy` 必填项与端口一致性；
- 自动推断 `TLS_MODE=ip|domain`，选择 `Caddyfile.ip` / `Caddyfile.domain`；
- 推导 `PUBLIC_BASE_URL` 与 `CORS_ORIGINS`（否则视频参考会被上游拒）；
- 生成 Basic Auth 的 bcrypt 哈希并调用 `docker compose up -d --build`。

**不要手工 `docker compose up` 代替它**：`.env.deploy` 里的空值不会自动推导，常见症状是视频参考退化成内联 data URL 或被上游拒绝。

### 1.3 CI 手动部署

`.github/workflows/ci.yml` 已暂停 push / PR 自动触发，只保留 `workflow_dispatch`。部署只在：

- `vars.ENABLE_DEPLOY == '1'`
- 手动触发且 `deploy=true`
- 分支为 `main`

时运行。`deploy` 输入默认 `false`，只验证时不会误部署。需要的仓库 Secrets：

| Secret | 用途 |
|---|---|
| `DEPLOY_HOST` | 站点地址 |
| `DEPLOY_PORT` | SSH 端口 |
| `DEPLOY_USER` | SSH 用户 |
| `SSH_PASSWORD` | SSH 密码 |

流程不是服务器 `git pull`，而是 runner 打包 → `scp` → 远端解压 → `rsync`（保留 `.env.deploy` / `data` / `outputs`）→ `node scripts/deploy.mjs`。

### 1.4 验收与回滚

```bash
# 健康
curl -k https://<host>/api/health
# 就绪（需 Bearer；回环免）
curl -k -H "Authorization: Bearer $PUBLIC_API_TOKEN" https://<host>/api/health/ready
```

- 登录：浏览器输入 `.env.deploy` 里的 `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD`。
- 容器：`docker ps` 应看到 app 与 caddy 均 `healthy` / `Up`。
- 回滚：保留上一版镜像 tag 或用上一份部署包重跑 `node scripts/deploy.mjs`；**数据卷不回滚**（任务/产物是用户数据）。
- 冷构建：首次或清缓存后 Docker 构建可能 6–9 分钟；手动部署 job 已放宽到 30 分钟 / 12 分钟部署步骤 / 600s 内层超时。

---

## 2. 租算力服务器后：所有 GPU 依赖项

这一节是**待租卡后一次性执行**的总清单。当前**未做**，不要当成已完成。

### 2.1 目标硬件

| 项 | 目标 |
|---|---|
| GPU | **满血 MOSS：48GB+（A6000 / L40S / 6000 Ada 级）**；只跑量化 MOSS 才考虑 32GB。H3 单跑可用 24–32GB（int8 + offload） |
| 系统内存 | **96GB+**（满血 MOSS 的 BF16 文本编码器 + H3 分层 offload 都吃内存；64GB 是底线） |
| 磁盘 | **≥200GB 空闲**（满血 MOSS 约 27.8GB + H3 约 42.5GB + 缓存/输出/临时文件） |
| 并发 | H3 与满血 MOSS **不要挤同一张 48GB 卡同时跑**；要并发就 2 张卡，或严格串行 |
| 系统 | Ubuntu 22.04/24.04，NVIDIA 驱动 + CUDA 可用 |
| 网络 | 与站点服务器同 VPC/私网，或 WireGuard/SSH 隧道；**ComfyUI 绝不暴露公网** |

**不要在本机 3080 10GB 上下 H3**：42.5GB 权重 + 低于 12GB 门槛，下载和运行都不划算。

### 2.2 总任务表（租卡后按序）

| # | 任务 | 产物/判据 |
|---|---|---|
| G1 | 安装 ComfyUI（H3 与 MOSS 都要求足够新；MOSS 需 **≥0.42**） | `python main.py --listen 127.0.0.1 --port 8188` 可访问 |
| G2 | 下载 MiniMax H3 四个权重（`fl2va` 或 `ref2va` 二选一） | `diffusion_models` / `text_encoders` / `vae` 就位；42.5GB |
| G3 | 用 ComfyUI 模板跑通 H3 5s 示例 | 出片成功，记录首片/暖跑耗时 |
| G4 | 导出 H3 的 **API 格式**模板 + sidecar（声明 modes） | `<name>.api.json` / `<name>.meta.json` |
| G5 | 安装 **满血 MOSS-Image SFT BF16**（部署目标，不是量化版） | `moss_image_sft_bf16` 9.47GB + `qwen3.5_9b_bf16` 17.98GB + `flux2-vae` 0.31GB，合计约 **27.8GB** |
| G6 | 用 8189 独立实例跑通满血 MOSS 1024×1024 | 官方 50 步 / CFG 3 为质量基线（以官方模板为准）；记录显存/耗时；8-step DMD 只作可选加速对照 |
| G7 | 站点 `.env.deploy` 增加 `COMFYUI_SERVERS_FILE`、`COMFYUI_TEMPLATE_DIR`、`EXPOSE_HOST_LOCAL_TRACK=1` | 自检能看到两个实例和各自 modes |
| G8 | compose 增加模板/实例 JSON 的只读挂载 | 容器内路径存在，不是 Docker 自动建的空目录 |
| G9 | 修 H3 能力声明：模板 sidecar 的 `modes` 优先，不再按文件名猜 | 自检如实显示 H3 的 t2v/i2v/首尾帧/参考/音频能力 |
| G10 | 明确单卡并发：H3 与 MOSS 不能同时占同一张卡 | 应用侧有排队/互斥，或运行手册明确同一时间只开一个 |
| G11 | 走应用全链路验收（能力位 → 提交 → 轮询 → 落盘 → `/media`） | `pnpm smoke:comfy:e2e` / `scripts/comfyui-acceptance.mjs` 全过 |
| G12 | 处理 H3 音频产物语义 | 音频随视频封装可播放；否则如实标记“仅视频” |
| G13 | 核对 `executedBy` 语义 | 外挂算力不应继续显示成“host-local”而不解释 |
| G14 | 更新成本/配额/清理阈值 | 本地算力不按云端金额计费，但磁盘/时长要可见 |

### 2.3 两个 ComfyUI 实例

一台 GPU 机器可以跑两个 ComfyUI 进程，但**共用同一张卡**：

```bash
# H3（端口 8188）
python main.py --listen 127.0.0.1 --port 8188

# MOSS（端口 8189，需要 >=0.42；满血 BF16 建议 48GB+，不要加 --lowvram）
python main.py --listen 127.0.0.1 --port 8189
```

> H3 与 MOSS 能否共用同一个 ComfyUI 版本，取决于 H3 模板在 0.42 上是否可用。  
> 如果 H3 模板依赖旧版：**升级前先在独立目录验证**，不要动生产实例。必要时用两个独立 ComfyUI 目录/venv。

### 2.4 站点侧配置示例

模板目录（容器内路径）：

```text
/root/astrmira/comfyui-templates/
  minimax-h3-ref2va.api.json
  minimax-h3-ref2va.meta.json
  moss-image-t2i-full.api.json
  moss-image-t2i-full.meta.json
```

`comfyui-servers.json`：

```json
[
  {
    "name": "h3",
    "label": "MiniMax H3 32GB",
    "url": "http://10.0.0.12:8188",
    "template": "minimax-h3-ref2va"
  },
  {
    "name": "moss",
    "label": "MOSS-Image SFT BF16",
    "url": "http://10.0.0.12:8189",
    "template": "moss-image-t2i-full"
  }
]
```

站点 `.env.deploy` 追加：

```dotenv
EXPOSE_HOST_LOCAL_TRACK=1
COMFYUI_SERVERS_FILE=/app/comfyui-servers.json
COMFYUI_TEMPLATE_DIR=/app/comfyui-templates
```

> `COMFYUI_SERVERS_FILE` 的字段只有 `name/label/url/template` 和档位覆盖；**没有 per-instance templateDir**。  
> 两个模板都放进同一个 `COMFYUI_TEMPLATE_DIR`，由每个实例的 `template` 选择。  
> 地址必须过 `isAllowedEngineUrl`：只允许回环 / RFC1918 私网；公网 GPU 机请走 VPN/隧道。

`deploy/compose.yaml` 还需要只读挂载（当前没有，必须补）：

```yaml
volumes:
  - ../data:/app/data
  - ../outputs:/app/outputs
  - ../comfyui-templates:/app/comfyui-templates:ro
  - ../comfyui-servers.json:/app/comfyui-servers.json:ro
```

### 2.5 租卡后必须改的代码（不要到现场才发现）

1. **H3 能力声明**
   - 现在 `comfyCapabilities()` 按 unet 文件名猜 `t2v/i2v`，H3 文件名不含这些标记；
   - 改成读模板 sidecar 的 `modes`，缺声明才回落文件名启发式；
   - 参考 `docs/LOCAL-GPU-DEPLOY.md` §五。

2. **单卡并发**
   - H3 与 MOSS 两个 provider 同时提交会争同一张卡；
   - 当前没有跨 provider 的 GPU 锁；
   - 方案 A：应用侧增加“同机 GPU 资源组”排队；方案 B：运行手册规定同一时间只启用一个实例。**先选一个，不要假设不会撞。**

3. **H3 音频**
   - 当前任务只落一个 `outputVideoUrl`；H3 音频需确认随视频封装、浏览器可播放；
   - 如果封装不兼容，界面必须如实说“视频已出、音频未接”，不能假装完整。

4. **`executedBy` 语义**
   - `host-comfyui` 现在映射为 `host-local`；
   - 如果算力机是外挂服务器，界面应说明“本地”指“本部署的算力机”，而不是访问者电脑；避免把远程算力说成用户本机。

5. **MOSS 的默认与回退**
   - **部署目标改为满血 BF16，不再用 int8/w4a8 量化版作为生产模型**；
   - 满血 BF16 约 27.8GB 权重，48GB+ 才是舒适区；32GB 只能靠 offload，不能叫“满血体验”；
   - 8-step DMD 是**可选加速 LoRA**，不是满血基线；默认先按官方 50 步 / CFG 3 验收，再决定是否提供“快速模式”；
   - MOSS 仍是**可选 t2i**，不自动替代 FLUX.2 Klein；技能/引擎选择要显式；模型缺失时如实不可用，不静默回落；
   - 10GB 3080 的量化实测只作为**评估证据**，不作为生产部署推荐。

### 2.6 验收命令

```bash
# 直连算力机（在能访问它的机器上）
node scripts/comfyui-acceptance.mjs probe
node scripts/comfyui-acceptance.mjs t2v --width 1280 --height 720 --frames 33
node scripts/comfyui-acceptance.mjs i2v --image <参考图路径>

# 走应用完整链路
pnpm smoke:comfy:e2e
```

判据：

- 自检显示**实例名、模板名、实际 modes**，不是一句“可用”；
- H3 任务真出片，`/media` 可读，`ffprobe` 为 h264；
- MOSS t2i 任务真出图，图片可打开；没有把图当视频；
- 单卡不会同时跑 H3 + MOSS 到 OOM；
- 失败时有可执行原因，不是“HTTP 404”。

### 2.7 回滚

- 先关站点本地轨开关：`EXPOSE_HOST_LOCAL_TRACK=0`，重启 app；
- 站点仍可用云端（若配置）；不影响已存在任务/产物；
- ComfyUI 机器保留权重，换端口/换模板后再接；
- 不要删除站点 `data/` / `outputs/`。

---

## 3. 不需要算力服务器的并行项

### 3.1 DeepSeek 真实规划（已用本机 key 实测）

本机 `DEEPSEEK_API_KEY` 存在。2026-10-22 通过本地 `POST /api/agent/plan` 实测：

| 用例 | 结果 |
|---|---|
| 雨夜霓虹慢推镜头 | **200**，`deepseek-chat`，1094 prompt + 396 completion tokens；选中 `mood-rainy-night` + `camera-push-in-slow` |
| 中文海报 | **502**；模型输出 `aspectRatio:"3:4"`（契约只允许 16:9/9:16/1:1），且 `note` 用了 `prompt/reason` 而不是 `text` |

说明：**真实文本链路是通的**，但计划器 prompt 需要收紧：

- 在 system prompt 中写清每种 step 的**完整字段示例**（`note` 只有 `text`，没有 `prompt/reason`）；
- 明确 `aspectRatio` 只允许三档、`resolutionTier` 只允许 480p/720p/1080p；
- 对“中文海报”这类没有 t2i 技能的意图，明确选 `note`/`warnings` 或拒绝，不要硬套视频技能；
- 修完后用同一组 prompt 重测，并把 200/400/502 的语义钉在测试里。

这不需要 GPU，可以作为 **S7-A** 立即做。

### 3.2 移动端/长文本

- `env(safe-area-inset-bottom)`：底部 composer、抽屉、任务卡；
- 素材名/标题/节点名 `min-width:0` + `overflow-wrap:anywhere`；
- 预览层 `max-height:90dvh` + `overscroll-behavior:contain`；
- 不做底部 4-tab 导航（IA 改动单独开片）。

### 3.3 Agent 深化（不依赖 GPU）

- 计划卡 step 级编辑/删除/排序；
- 计划落到画布节点（`create-node`，只草稿不提交）；
- 同一执行意图的幂等已在 S6-B3 完成；
- 真实 DeepSeek 计划质量回归。

### 3.4 长期 backlog

- B1 本机 worker 结果回传归档 + 真机验证（等目标机器/模型）；
- B38 独立音效素材（无真实诉求）；
- B39 legacy EDL 与浏览器导出收敛；
- B44 更大规模画布增量布局（当前规模不需要）。

---

## 4. 租卡后一次性执行顺序（建议）

1. 开通 GPU 机器，确认驱动/CUDA/磁盘/内存；
2. 安装 ComfyUI，先只跑 H3，导出 API 模板；
3. 同一机器加 8189 MOSS 实例（或独立目录），跑通 1024；
4. 站点增加模板/实例 JSON 挂载与环境变量；
5. 修 H3 能力声明、单卡并发、音频/executedBy 语义；
6. 自检 → 直连验收 → `smoke:comfy:e2e`；
7. 先小流量/单实例启用，观察 OOM、队列、磁盘；
8. 再决定是否把 MOSS 设为可选 t2i 的默认推荐（仍不自动替代 FLUX.2）。

---

## 5. 明确未做 / 不要写成已完成

- 当前租卡部署**未执行**；本文是施工手册。
- H3 的真实出片/音频/多参考**未在本仓库当前环境验收**。
- MOSS 只在 10GB 3080 上实测过 512/1024；未在 5090/24GB+ 上复测。
- H3 与 MOSS 的跨 provider 并发锁**未实现**。
- `executedBy` 的外挂语义**待修**。
- DeepSeek 海报计划目前 **502**，prompt 收紧后需重测。
- 站点生产环境仍以现有 `<站点服务器>` 为准；算力机接入前，本地默认仍是 FLUX.2 Klein。
