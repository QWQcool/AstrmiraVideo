# syntax=docker/dockerfile:1

# ═══════════════════════════════════════════════════════════════════════════
# AstrmiraVideo 生产镜像（PLAN §7-9）
#
# 形态：**单进程**。运行层只有 Fastify 一个进程，它同时提供
#   /api/*     接口
#   /media/*   成片（Range 206 的载体）
#   /*         前端产物（SPA fallback）
# 反代（Caddy）负责 HTTPS 与真实 IP 透传，见 deploy/。
#
# 两个实测得出的关键约束：
# 1. **better-sqlite3 必须现场编译**：本仓库锁定的 node 22.23 没有对应的 prebuilt
#    （构建日志里能看到 node-gyp 在下载 node headers），所以任何要跑 `pnpm install` 的
#    阶段都**必须有 python3 + make + g++**。用 slim 镜像直接装生产依赖会失败。
# 2. **apt 必须换源**：deb.debian.org 在部署网络下只有 ~60KB/s，
#    ffmpeg 那 134MB 的依赖会变成 37 分钟。换镜像站后是分钟级。
# ═══════════════════════════════════════════════════════════════════════════

# ─── 阶段 1：构建 ───────────────────────────────────────────────────────────
# 用非 slim：它自带编译工具链，满足约束 1
FROM node:22-bookworm AS build

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN corepack enable

WORKDIR /app

# 先只拷贝清单文件：依赖层可被缓存，改业务代码不会触发重新安装
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# ⚠️ `patches/` 必须在 `pnpm install` **之前**拷贝：pnpm-workspace.yaml 里声明了
# patchedDependencies（@remotion/web-renderer 的遥测短路补丁），安装时 pnpm 要读取补丁文件
# 计算哈希并应用。漏拷的症状是 install 直接 exit 254，栈里只看到 `readNormalizedFile` 读文件失败
# ——2026-10-08 的 CD 就死在这里（B34 P2 之后首次真正跑到部署）。
COPY patches patches/
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile

# 再拷源码并构建（顺序：shared 的类型是 backend/frontend 的输入，必须先出 dist）
COPY . .
RUN pnpm build

# ─── 阶段 2：运行 ───────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN corepack enable

# 换 apt 源 + 装 ffmpeg（真实产物链路的硬依赖：探测 / 裁切 / 时长对齐）
# 来源与许可证登记见 docs/UPSTREAM.md（`docs/UPSTREAM.md` 的 ffmpeg 登记）。
# 若部署到海外，把 mirrors.aliyun.com 换回 deb.debian.org 即可。
RUN set -eux; \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' \
      /etc/apt/sources.list /etc/apt/sources.list.d/*.sources 2>/dev/null || true; \
    apt-get update; \
    apt-get install -y --no-install-recommends ffmpeg; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 生产依赖（与构建阶段保持同样的 workspace 结构，避免 pnpm 符号链接断链）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# 同构建阶段：patchedDependencies 的补丁文件要在 install 之前就位（否则 exit 254）
COPY patches patches/
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/

# 约束 1 的落地：临时装工具链完成 better-sqlite3 编译，装完**立刻卸掉** ——
# 生产镜像里不该留着编译器与 python（少一份攻击面，也少几百 MB）。
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends python3 make g++; \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' \
      /etc/apt/sources.list /etc/apt/sources.list.d/*.sources 2>/dev/null || true; \
    pnpm install --prod --frozen-lockfile; \
    apt-get purge -y python3 make g++; \
    rm -rf /var/lib/apt/lists/* /root/.cache/node-gyp

# 产物
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist frontend/dist

# 运行时数据只走卷（AC3：data / outputs 不进镜像）
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATA_DIR=/app/data
ENV OUTPUT_DIR=/app/outputs

EXPOSE 3000
VOLUME ["/app/data", "/app/outputs"]

# 健康检查用容器自带的 Node，不额外装 curl（少一个攻击面）
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/dist/index.js"]
