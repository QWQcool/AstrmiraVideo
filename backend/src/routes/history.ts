import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ErrorResponseSchema,
  HistoryResponseSchema,
  OperationResultSchema,
  normalizeProjectId,
} from '@astrmira/shared';
import { THUMBNAIL_DIR_NAME } from '../pipeline/thumbnail.js';
import { resolveOutputsDir } from '../server/staticOutputs.js';
import { readStorageUsage, withOutputFileFacts } from '../server/storageUsage.js';
import { toTaskProgress, type TaskStore } from '../store/taskStore.js';

/**
 * 历史画廊（CONTRACT §5 + §7）：
 * - `GET /api/history` 返回最近任务（含完整参数快照，供一键回填）；
 * - `DELETE /api/history/:taskId` 删除单条并**释放磁盘**（成片物理删除）。
 */

const TaskIdParamsSchema = z.object({ taskId: z.string() });

/**
 * `GET /api/history` 的可选查询参数（V9 修复：剪辑产物默认不进历史成片）。
 * - 缺省：只返回**生成产物**；
 * - `?kind=edit&source=<taskId>`：返回某源片的剪辑产物（剪辑台的「本片剪辑历史」用它）；
 * - `?kind=edit`（V2.6 / B37，不带 `source`）：返回**全部**剪辑产物（剪辑台素材候选用）。
 */
const HistoryQuerySchema = z.object({
  kind: z.literal('edit').optional(),
  source: z.string().optional(),
  /**
   * V2.11（台账 B47）：只返回该项目的任务。**省略 = 默认项目**（不是"全部项目"）——
   * 这样 V2.11 之前的客户端（与既有测试）行为完全不变，而"跨项目看全部"不是一个
   * 需要出现在界面上的能力（界面的心智模型是"我在哪个项目里"）。
   */
  project: z.string().optional(),
  /**
   * V2.25（台账 B44）：分页。`limit` 省略 = 50（与 V2.25 之前完全一致）；
   * **超出 1~200 直接 400**（不静默 clamp —— 画布只会传 50，超范围说明客户端有 bug，静默截断会藏住它）。
   */
  limit: z.coerce.number().int().min(1).max(200).optional(),
  /**
   * V2.25：游标 —— 只返回 `created_at < before` 的任务（epoch ms）。
   * 与排序键（`created_at DESC`）同源，"加载更早"逐页向过去推进。
   */
  before: z.coerce.number().int().nonnegative().optional(),
  /**
   * V2.43（Step 11-S3）：来源过滤。
   * - 缺省 / `create`：**排除画布产物**（画布结果只在画布里看得到，与实测产品一致）；
   * - `canvas`：只看画布产物（画布内回查用）。
   */
  origin: z.enum(['create', 'canvas']).optional(),
});

/** V2.25：`limit` 省略时的条数（= V2.25 之前写死的 50 —— 老调用方行为不变） */
const DEFAULT_HISTORY_LIMIT = 50;

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
        schema: { querystring: HistoryQuerySchema, response: { 200: HistoryResponseSchema } },
      },
      async (request) => {
        const outputsDir = deps.outputsDir ?? resolveOutputsDir();
        // V9 修复：`?kind=edit` 查剪辑产物（剪辑台用）；缺省只返回生成产物。
        // V2.6（B37）：`source` 可选 —— 不带时返回全部剪辑产物（素材候选 / L2 画布用）。
        const { kind, source, before } = request.query;
        // V2.11（B47）：项目过滤 —— 省略即默认项目（见 HistoryQuerySchema 的注释）
        const projectId = normalizeProjectId(request.query.project);
        // V2.25（B44）：分页 —— **多查一条**探测 hasMore，然后截断。
        // 为什么不另做 COUNT：多查一条的成本是 O(1)（LIMIT 上的第 limit+1 行），
        // 而 COUNT 会全表扫描一次（大库里它比这一页本身还贵）。
        const limit = request.query.limit ?? DEFAULT_HISTORY_LIMIT;
        const probe = limit + 1;
        const page = (
          kind === 'edit'
            ? deps.store.listRecent(probe, {
                kind: 'edit',
                projectId,
                ...(source === undefined ? {} : { sourceTaskId: source }),
                ...(before === undefined ? {} : { before }),
              })
            : deps.store.listRecent(probe, {
                projectId,
                ...(before === undefined ? {} : { before }),
                ...(request.query.origin === undefined ? {} : { origin: request.query.origin }),
              })
        ).map(toTaskProgress);
        const hasMore = page.length > limit;
        const records = hasMore ? page.slice(0, limit) : page;

        // V2.3（CONTRACT §4/§5）：逐条补落盘事实（体积 / V2.8 起"文件不存在即省略直链"）
        // + 目录级聚合（扫 outputs/）。两者都是**只读**，并发跑；
        // 任何一项失败都在 storageUsage 内部降级，不让接口 500。
        const [items, storage] = await Promise.all([
          Promise.all(records.map((record) => withOutputFileFacts(record, outputsDir))),
          readStorageUsage(outputsDir),
        ]);

        return { items, storage, hasMore };
      },
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

        // 释放磁盘：产物文件按 basename 删除（路径只含服务端随机 ID，不含用户输入）
        // V2.40：产物可能是**视频或图片**，两条都删（否则删掉图片任务后磁盘不释放）
        for (const url of [record.outputVideoUrl, record.outputImageUrl]) {
          if (url === undefined || url === '') continue;
          await rm(path.join(outputsDir, path.basename(url)), { force: true }).catch(() => undefined);
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
