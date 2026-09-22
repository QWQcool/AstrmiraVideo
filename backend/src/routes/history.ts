import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ErrorResponseSchema, HistoryResponseSchema, OperationResultSchema } from '@astrmira/shared';
import { THUMBNAIL_DIR_NAME } from '../pipeline/thumbnail.js';
import { resolveOutputsDir } from '../server/staticOutputs.js';
import { toTaskProgress, type TaskStore } from '../store/taskStore.js';

/**
 * 历史画廊（CONTRACT §5 + §7）：
 * - `GET /api/history` 返回最近任务（含完整参数快照，供一键回填）；
 * - `DELETE /api/history/:taskId` 删除单条并**释放磁盘**（成片物理删除）。
 */

const TaskIdParamsSchema = z.object({ taskId: z.string() });

/** 快照里被引用的参考资产 id（首帧 / 尾帧 / 参考视频三格） */
function referencedAssetIds(snapshot: { assets?: Record<string, string | undefined> }): string[] {
  const assets = snapshot.assets;
  if (assets === undefined) return [];

  return [assets['firstFrameImage'], assets['lastFrameImage'], assets['referenceVideo']].filter(
    (value): value is string => typeof value === 'string' && value !== '',
  );
}

/**
 * 删除某个资产的落盘文件。
 *
 * 为什么不直接拼 `<assetId>.jpg`：扩展名由**防线 4 的清洗结果**决定
 * （不透明图 → jpg、带透明通道 → png），这里又拿不到当时的 mime，
 * 所以按 `<assetId>.` 前缀在目录里匹配 —— 比猜一个扩展名可靠。
 */
async function removeAssetFiles(assetsDir: string, assetId: string): Promise<void> {
  let entries: string[];

  try {
    entries = await readdir(assetsDir);
  } catch {
    return; // 目录不存在 = 没有资产要清
  }

  const targets = entries.filter((name) => name === assetId || name.startsWith(`${assetId}.`));
  await Promise.all(
    targets.map((name) => rm(path.join(assetsDir, name), { force: true }).catch(() => undefined)),
  );
}

export interface HistoryRoutesDeps {
  store: TaskStore;
  /** 删除成片时的 outputs 根目录（默认 `OUTPUT_DIR` / `outputs`） */
  outputsDir?: string;
}

export const createHistoryRoutes =
  (deps: HistoryRoutesDeps): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/api/history',
      {
        schema: { response: { 200: HistoryResponseSchema } },
      },
      async () => ({
        items: deps.store.listRecent(50).map(toTaskProgress),
      }),
    );

    app.delete(
      '/api/history/:taskId',
      {
        schema: {
          params: TaskIdParamsSchema,
          response: { 200: OperationResultSchema, 404: ErrorResponseSchema },
        },
      },
      async (request, reply) => {
        const record = deps.store.get(request.params.taskId);
        if (record === null) {
          return reply.code(404).send({
            code: 'TASK_NOT_FOUND',
            message: `任务不存在或已清理：${request.params.taskId}`,
            disposition: 'terminal',
          });
        }

        deps.store.delete(record.taskId);

        const outputsDir = deps.outputsDir ?? resolveOutputsDir();

        // 释放磁盘：成片文件按 basename 删除（路径只含服务端随机 ID，不含用户输入）
        if (record.outputVideoUrl !== undefined && record.outputVideoUrl !== '') {
          const file = path.join(outputsDir, path.basename(record.outputVideoUrl));
          await rm(file, { force: true }).catch(() => undefined);
        }

        // 缩略图（V1.9）一并删：它不认识任何用户输入，文件名就是 taskId
        await rm(path.join(outputsDir, THUMBNAIL_DIR_NAME, `${record.taskId}.jpg`), {
          force: true,
        }).catch(() => undefined);

        // 参考资产一并清理（CONTRACT §7）——但**只清理没有被其它任务引用的**：
        // 「参数一键回填」会让同一条资产被多条任务复用，无脑删除会毁掉别的任务的参考图。
        for (const assetId of referencedAssetIds(record.requestSnapshot)) {
          if (deps.store.countTasksReferencingAsset(assetId, record.taskId) > 0) continue;
          await removeAssetFiles(path.join(outputsDir, 'assets'), assetId);
        }

        return { ok: true, taskId: record.taskId };
      },
    );
  };
