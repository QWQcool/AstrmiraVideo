import { mkdirSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/**
 * `outputs/` 的静态媒体服务（CONTRACT §5：`GET /media/*`）。
 *
 * 它是 **206 Range 的载体**：播放器拖动进度、断点续播都依赖它。
 * `@fastify/static` 底层是 `send`，原生支持 Range —— 但仍必须实测
 * （反向代理压缩会破坏 Range，见施工单 §9-3）。
 */
export function resolveOutputsDir(): string {
  const override = process.env.OUTPUT_DIR;
  return typeof override === 'string' && override.trim() !== ''
    ? override.trim()
    : path.join(process.cwd(), 'outputs');
}

export async function registerStaticOutputs(
  app: FastifyInstance,
  root: string = resolveOutputsDir(),
): Promise<void> {
  mkdirSync(root, { recursive: true });

  await app.register(fastifyStatic, {
    root,
    prefix: '/media/',
    index: false,
    // 不装饰 reply：避免与其它插件的 sendFile 冲突
    decorateReply: false,
  });
}
