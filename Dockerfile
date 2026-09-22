# syntax=docker/dockerfile:1

# ═══════════════════════════════════════════════════════════════════════════
# AstrmiraVideo 生产镜像（施工单 §9-3）
#
# 形态：**单进程**。运行层只有 Fastify 一个进程，它同时提供
#   /api/*     接口
#   /media/*   成片（Range 206 的载体）
#   /*         前端产物（SPA fallback）
# 反代（Caddy）负责 HTTPS 与真实 IP 透传，见 deploy/。
#
# 两个刻意为之的选择：
# 1. 构建阶段用**非 slim** 镜像：原生模块（better-sqlite3）在没有 prebuilt 时
#    需要 python3/make/g++ 才能编译，装在构建阶段不影响运行层体积；
# 2. 运行层**单独再装一次生产依赖**：pnpm 的 node_modules 是符号链接结构，
#    跨阶段 COPY 容易断链；重装一次换来的是"镜像一定可运行"。
# ═══════════════════════════════════════════════════════════════════════════

# ─── 阶段 1：构建 ───────────────────────────────────────────────────────────
FROM node:22-bookworm AS build

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN corepack enable

WORKDIR /app

# 先只拷贝清单文件：依赖层可被缓存，改业务代码不会触发重新安装
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile

# 再拷源码并构建（顺序：shared 的类型是 backend/frontend 的输入，必须先出 dist）
COPY . .
RUN pnpm build

# ─── 阶段 2：运行 ───────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

# ffmpeg 是真实产物链路的硬依赖（探测 / 裁切 / 时长对齐）。
# 来源与许可证登记见 docs/UPSTREAM.md（施工单 §9-3 第 1 条）。
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN corepack enable

WORKDIR /app

# 生产依赖（与构建阶段保持同样的 workspace 结构，避免符号链接断链）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
RUN pnpm install --prod --frozen-lockfile

# 产物
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist frontend/dist

# 运行时数据只走卷（AC3：data / outputs 不进镜像）
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
