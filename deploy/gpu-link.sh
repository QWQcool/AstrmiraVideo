#!/bin/bash
# 站点的"本地轨"接入一条命令（V2.101 / 2026-10-30）：把远端 GPU 上只监听回环的 ComfyUI
# 通过 SSH 隧道接到站点容器能访问的地址，并做成 systemd 常驻服务。
#
# 为什么要有它：这套东西 2026-10-30 是手工跑通的（生成密钥 → 装公钥 → 写 unit → 探活），
# 换机器时靠记忆重敲必然漏步；漏掉的一步通常是"绑 0.0.0.0"（那就把无鉴权的 ComfyUI 挂到公网了）。
#
# 在**站点服务器**上运行（它需要有 ssh 客户端与 docker）：
#   scp deploy/gpu-link.sh root@<site>:/root/ && ssh root@<site> 'bash /root/gpu-link.sh --gpu-host <gpu> --gpu-port <port>'
#
# 首次需要把公钥装到 GPU 机器上：加 --copy-id（会交互式问一次 GPU 的密码，只此一次）。
# 之后再跑同一命令是**幂等**的：已有密钥/服务就只做探活与重启。
set -eu

GPU_HOST=''
GPU_PORT=''
GPU_USER='root'
LOCAL_PORT=18188
BIND=''
APP_CONTAINER='astrmiravideo-app-1'
TUNNEL_KEY=/root/.ssh/astrmira_gpu
UNIT=/etc/systemd/system/astrmira-comfyui-tunnel.service
COPY_ID=0

while [ $# -gt 0 ]; do
  case "$1" in
    --gpu-host) GPU_HOST="$2"; shift 2 ;;
    --gpu-port) GPU_PORT="$2"; shift 2 ;;
    --gpu-user) GPU_USER="$2"; shift 2 ;;
    --local-port) LOCAL_PORT="$2"; shift 2 ;;
    --bind) BIND="$2"; shift 2 ;;
    --app-container) APP_CONTAINER="$2"; shift 2 ;;
    --copy-id) COPY_ID=1; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

if [ -z "$GPU_HOST" ] || [ -z "$GPU_PORT" ]; then
  echo "✗ 需要 --gpu-host 与 --gpu-port（例：--gpu-host connect.westc.seetacloud.com --gpu-port 19225）" >&2
  exit 2
fi

command -v ssh >/dev/null || { echo "✗ 这台机器没有 ssh 客户端" >&2; exit 2; }

# ① 绑定地址：默认取 docker 网关（容器能到、公网到不了）。
#    绝不默认 0.0.0.0 —— ComfyUI 无鉴权，那就是把生图/生视频接口挂到公网。
if [ -z "$BIND" ]; then
  NET=$(docker inspect "$APP_CONTAINER" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' 2>/dev/null || true)
  if [ -n "$NET" ]; then
    GW=$(docker network inspect "$NET" --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}' 2>/dev/null || true)
  fi
  BIND="${GW:-172.17.0.1}:$LOCAL_PORT"
  [ -n "$GW" ] || echo "· 没探到应用容器的网络网关，退回 docker 默认网关 $BIND"
fi
echo "① 绑定地址：$BIND（容器可达、公网不可达）"

# ② 专用密钥（不要复用运维自己的 key：这条隧道只干一件事）
if [ ! -f "$TUNNEL_KEY" ]; then
  ssh-keygen -t ed25519 -N '' -C "astrmira-$(hostname)-to-gpu" -f "$TUNNEL_KEY" >/dev/null
  echo "② 已生成专用密钥：$TUNNEL_KEY"
else
  echo "② 复用已有密钥：$TUNNEL_KEY"
fi
chmod 600 "$TUNNEL_KEY"

# ③ 公钥到位（幂等探测；失败时给两条出路，而不是静默继续）
if ssh -i "$TUNNEL_KEY" -p "$GPU_PORT" -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
      -o ConnectTimeout=15 "$GPU_USER@$GPU_HOST" 'echo ok' >/dev/null 2>&1; then
  echo "③ 密钥登录已可用"
elif [ "$COPY_ID" -eq 1 ]; then
  echo "③ 装公钥（会问一次 GPU 密码）…"
  ssh-copy-id -i "$TUNNEL_KEY.pub" -p "$GPU_PORT" "$GPU_USER@$GPU_HOST"
else
  cat >&2 <<EOF
✗ ③ 密钥还没被 GPU 机器接受。二选一：
    a) 重跑并加 --copy-id（交互式装一次公钥）；
    b) 手工把下面这行追加到 GPU 的 ~/.ssh/authorized_keys：
       $(cat "$TUNNEL_KEY.pub")
EOF
  exit 1
fi

# ④ systemd 常驻（Restart=always：GPU 重启/网络抖动后自己回来）
cat > "$UNIT" <<EOF
[Unit]
Description=AstrmiraVideo site -> GPU ComfyUI tunnel ($BIND -> $GPU_HOST:$GPU_PORT)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/ssh -N \\
  -i $TUNNEL_KEY -p $GPU_PORT \\
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \\
  -o StrictHostKeyChecking=accept-new \\
  -L $BIND:127.0.0.1:8188 $GPU_USER@$GPU_HOST
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now astrmira-comfyui-tunnel.service >/dev/null 2>&1 || true
systemctl restart astrmira-comfyui-tunnel.service
sleep 5
echo "④ 服务：$(systemctl is-active astrmira-comfyui-tunnel.service)（NRestarts=$(systemctl show -p NRestarts --value astrmira-comfyui-tunnel.service)）"

# ⑤ 两头探活：宿主机 + 应用容器（容器的判定才是真的，毕竟请求从它发出）
code=$(curl -s -m 8 -o /dev/null -w '%{http_code}' "http://$BIND/system_stats" || true)
echo "⑤ 宿主机探活：HTTP $code"
if docker inspect "$APP_CONTAINER" >/dev/null 2>&1; then
  docker exec "$APP_CONTAINER" node -e "
fetch('http://$BIND/system_stats', { signal: AbortSignal.timeout(8000) })
  .then(r => r.text())
  .then(t => console.log('   容器探活：OK', t.slice(0, 60)))
  .catch(e => { console.log('   容器探活：ERR', e.message); process.exit(1); });
" || { echo "✗ 容器连不上隧道 —— 检查绑定地址是否是该容器的网关" >&2; exit 1; }
else
  echo "· 没找到容器 $APP_CONTAINER，跳过容器探活"
fi

cat <<EOF

✓ 隧道就绪。把下面几行加进站点的 .env.deploy（改完重启容器生效）：
   EXPOSE_HOST_LOCAL_TRACK=1
   COMFYUI_BASE_URL=http://$BIND
   COMFYUI_TEMPLATE_DIR=/app/comfyui-templates
   COMFYUI_TEMPLATE=<模板名，例如 minimax-h3-t2v>

  模板目录由 compose 挂载（deploy/comfyui-templates → /app/comfyui-templates）。

  ⚠️ 重启容器**必须带 --env-file**：compose 里的 PUBLIC_BASE_URL / CORS_ORIGINS 是变量替换，
     不带 env 文件就是空值（症状：资产地址退化成内联 data URL、视频参考被上游拒）。
     cd /root/astrmira && docker compose --env-file .env.deploy -f deploy/compose.yaml up -d app
EOF
