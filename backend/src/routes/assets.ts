import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileTypeFromFile } from 'file-type';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AssetListResponseSchema } from '@astrmira/shared';
import type { AssetListEntry } from '@astrmira/shared';
import { resolveOutputsDir } from '../server/staticOutputs.js';
import { isSafeAssetId } from '../store/assets.js';

/**
 * `GET /api/assets`（CONTRACT §5 / V2.7；台账 B41 的契约支撑）——**资产库清单（只读）**。
 *
 * 为什么需要它：`@` 提及素材弹层要列出"以前上传过的图/视频"，而资产 ID 此前只存在于
 * 上传响应与任务快照里；没有枚举能力就只有一个空弹层。
 *
 * 三条口径（与 CONTRACT §5 逐字对应）：
 * 1. **只读**：不改任何生命周期与清理规则（§7 的删除/保护规则原样）；
 * 2. **事实来自落盘**：`mime` 用**魔数嗅探**（含抽帧产物——它与上传资产同目录同规则）、
 *    `size` / `createdAt` 用 `stat`，不信任文件名后缀；
 * 3. **空目录 → 200 + 空数组**，不是 404（"从未上传过"不是错误）。
 *
 * 性能取舍：每次请求做一次目录扫描（stat + 嗅探只读文件头，不读全文件）。
 * 资产量级到千级之前不值得加缓存；届时参照 `server/storageUsage.ts` 的 5s 缓存套路。
 */

/** 单次返回的资产上限（新在前）——弹层不需要全量，也避免超大目录把响应喂爆 */
export const MAX_LISTED_ASSETS = 200;

export interface AssetRoutesDeps {
  /** assets 根目录（默认 `OUTPUT_DIR` / `outputs`）；测试注入临时目录用 */
  outputsDir?: string;
}

export const createAssetRoutes =
  (deps: AssetRoutesDeps = {}): FastifyPluginAsyncZod =>
  async (app) => {
    const outputsDir = deps.outputsDir ?? resolveOutputsDir();

    app.get(
      '/api/assets',
      { schema: { response: { 200: AssetListResponseSchema } } },
      async () => {
        const assetsDir = path.join(outputsDir, 'assets');

        let names: string[];
        try {
          names = await readdir(assetsDir);
        } catch {
          return { assets: [] }; // 目录不存在 = 从未上传过（契约：200 + 空数组）
        }

        const entries: AssetListEntry[] = [];
        for (const name of names) {
          // 文件名必须是 `<assetId>.<ext>` 且 assetId 为 UUID 形状 —— 与 /api/upload 的落盘命名同规，
          // 不符者（人为丢进来的杂文件）一律跳过，不让它们进列表
          const dot = name.lastIndexOf('.');
          if (dot <= 0) continue;
          const assetId = name.slice(0, dot);
          if (!isSafeAssetId(assetId)) continue;

          const filePath = path.join(assetsDir, name);
          try {
            const info = await stat(filePath);
            if (!info.isFile()) continue;

            // 魔数嗅探只读文件头；未知类型 / 既非图也非视频者跳过
            const sniffed = await fileTypeFromFile(filePath);
            if (sniffed === undefined) continue;
            const kind = sniffed.mime.startsWith('image/')
              ? ('image' as const)
              : sniffed.mime.startsWith('video/')
                ? ('video' as const)
                : null;
            if (kind === null) continue;

            entries.push({
              assetId,
              kind,
              mime: sniffed.mime,
              size: info.size,
              url: `/media/assets/${name}`,
              createdAt: Math.round(info.mtimeMs),
            });
          } catch {
            // 扫描期间文件被删（与 DELETE /api/history/:taskId 的清理并发）：跳过即可
            continue;
          }
        }

        entries.sort((a, b) => b.createdAt - a.createdAt);
        return { assets: entries.slice(0, MAX_LISTED_ASSETS) };
      },
    );
  };
