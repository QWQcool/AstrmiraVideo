import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/**
 * 前端产物托管（PLAN §7-9「单进程形态」）。
 *
 * 生产形态只有**一个进程**：Caddy 反代 → 这个 Fastify 同时提供
 * `/api/*`（接口）、`/media/*`（成片 Range）与 `frontend/dist`（SPA）。
 * 好处是没有第二个需要同步的部署单元，也就不存在"前端版本与后端版本对不上"这类经典事故。
 *
 * 三个容易踩的点：
 * 1. **必须先注册 API 路由再注册本模块**：`setNotFoundHandler` 是全局的，
 *    顺序反了会把 `/api/...` 的 404 变成 index.html —— 前端拿 HTML 当 JSON 解析，
 *    报出来的错和真实原因毫无关系（"响应不符合契约"而不是"接口不存在"）；
 * 2. fallback 只对 `GET / HEAD` 生效，且**显式排除** `/api/` 与 `/media/`
 *    （否则一个拼错的媒体地址会返回 200 + HTML，比 404 难查十倍）；
 * 3. **产物不存在时必须安静跳过**：本地只跑后端（`pnpm dev`，前端走 vite）是常态，
 *    这里如果抛错，整个服务起不来。
 */

export function resolveFrontendDist(): string {
  const override = process.env.FRONTEND_DIST;
  if (typeof override === 'string' && override.trim() !== '') return override.trim();

  // src/server → backend → repo root（dist 下层级一致）
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../frontend/dist');
}

export interface SpaRegistration {
  /** 是否真的挂载了（产物不存在时为 false） */
  mounted: boolean;
  distDir: string;
}

export async function registerSpa(
  app: FastifyInstance,
  distDir: string = resolveFrontendDist(),
): Promise<SpaRegistration> {
  const indexPath = path.join(distDir, 'index.html');

  if (!existsSync(indexPath)) {
    return { mounted: false, distDir };
  }

  await app.register(fastifyStatic, {
    root: distDir,
    prefix: '/',
    // 不提供目录列表；真实文件（/assets/xxx.js）由本插件直接命中
    index: ['index.html'],
    // 这里必须装饰 `reply.sendFile`（fallback 要用）；/media 那侧已设为 false，不冲突
    decorateReply: true,
  });

  app.setNotFoundHandler((request, reply) => {
    const url = request.url;

    // 保持 Fastify 的默认 404 形状：它一眼就能看出是"路由不存在"，
    // 而契约里的错误码（如 TASK_NOT_FOUND）都有别的明确含义，不该被借用。
    const notFound = {
      statusCode: 404,
      error: 'Not Found',
      message: `Route ${request.method}:${url} not found`,
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return reply.code(404).send(notFound);
    }

    // 接口与媒体路径绝不回退到 HTML：它们的 404 必须是 404
    // （否则一个拼错的媒体地址会返回 200 + HTML，比 404 难查十倍）
    if (url.startsWith('/api/') || url.startsWith('/api?') || url.startsWith('/media/')) {
      return reply.code(404).send(notFound);
    }

    // SPA 客户端路由：任何其它 GET 都交给前端自己决定渲染什么
    return reply.sendFile('index.html');
  });

  app.log.info({ distDir }, '已挂载前端产物（单进程形态）');
  return { mounted: true, distDir };
}
