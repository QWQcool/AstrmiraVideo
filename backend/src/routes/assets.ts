import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { fileTypeFromFile } from 'file-type';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AssetListResponseSchema, normalizeProjectId } from '@astrmira/shared';
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

/**
 * 单次返回的资产上限（新在前）。
 *
 * V2.85（D-6）：200 → **1000**。200 在"迁移一个项目"的量级下会直接看不全
 * （《故乡》那次 34 个没事，但千级素材就会漏）；1000 条响应约几百 KB，仍可接受。
 * 超过时响应带 `truncated: true` + `total`，界面要说出来，而不是让用户以为素材丢了。
 */
export const MAX_LISTED_ASSETS = 1000;

export interface AssetRoutesDeps {
  /** assets 根目录（默认 `OUTPUT_DIR` / `outputs`）；测试注入临时目录用 */
  outputsDir?: string;
}

/** sidecar（`<assetId>.json`）里我们认得的部分 */
export interface AssetSidecar {
  name?: string;
  kind?: 'image' | 'video' | 'audio';
  /** V2.11（台账 B47）：资产归属的项目（缺失 = 默认项目） */
  projectId?: string;
}

/**
 * 读 sidecar（V2.9 的 `name` + V2.10 的 `kind`）。
 *
 * sidecar = `<assetId>.json`（由 `/api/upload` 写，见 CONTRACT §5 / §7）。
 * 三种情况一律返回空对象（**不猜、不填占位**）：文件不存在（抽帧产物 / 老资产）、
 * JSON 坏掉、字段不是期望的形状。
 */
async function readAssetSidecar(assetsDir: string, assetId: string): Promise<AssetSidecar> {
  try {
    const raw = await readFile(path.join(assetsDir, `${assetId}.json`), 'utf8');
    const parsed = JSON.parse(raw) as { name?: unknown; kind?: unknown; projectId?: unknown };
    const meta: AssetSidecar = {};
    if (typeof parsed.name === 'string' && parsed.name !== '') meta.name = parsed.name;
    if (parsed.kind === 'image' || parsed.kind === 'video' || parsed.kind === 'audio') {
      meta.kind = parsed.kind;
    }
    // V2.11：项目 id 也走"认得才收"——sidecar 是本地文件，被人为改坏时不猜、不填占位
    if (typeof parsed.projectId === 'string' && parsed.projectId !== '') {
      meta.projectId = parsed.projectId;
    }
    return meta;
  } catch {
    return {};
  }
}

/**
 * 按项目统计资产个数（V2.11 / 台账 B47）。
 *
 * 口径与 `GET /api/assets` **逐条一致**：没有 sidecar（或 sidecar 里没有 projectId）的资产
 * 算**默认项目**。项目列表的 `assetCount` 与资产列表的过滤因此不会互相打脸。
 *
 * 代价是一次目录扫描 + 每个资产读一个几十字节的 sidecar —— 与 `/api/assets` 同级，
 * 在"资产上千"之前不值得加缓存（届时参照 `server/storageUsage.ts` 的 5s 缓存套路）。
 */
export async function countAssetsByProject(outputsDir: string): Promise<Map<string, number>> {
  const assetsDir = path.join(outputsDir, 'assets');
  const counts = new Map<string, number>();

  let names: string[];
  try {
    names = await readdir(assetsDir);
  } catch {
    return counts; // 目录不存在 = 没有资产
  }

  const seen = new Set<string>();
  for (const name of names) {
    const dot = name.lastIndexOf('.');
    if (dot <= 0) continue;
    const assetId = name.slice(0, dot);
    if (!isSafeAssetId(assetId) || seen.has(assetId)) continue;
    // sidecar 自己也要被跳过（`<assetId>.json` 与媒体文件同前缀，靠扩展名区分）
    if (name.slice(dot + 1).toLowerCase() === 'json') continue;
    seen.add(assetId);

    const sidecar = await readAssetSidecar(assetsDir, assetId);
    const projectId = normalizeProjectId(sidecar.projectId);
    counts.set(projectId, (counts.get(projectId) ?? 0) + 1);
  }

  return counts;
}

/**
 * 资产类别的**唯一判定处**（V2.10 / 台账 B57）：
 * sidecar 的 `kind` 优先（上传时已由 ffprobe 算准，免去逐文件探测），
 * 缺失时按**容器 mime**兜底（`audio/*` → audio、`video/*` → video、`image/*` → image），
 * 三者都不是 → `null`（调用方跳过该文件）。
 *
 * ⚠️ 兜底**不猜**：老资产与抽帧产物走这条，其中"纯音频 mp4"会被兜底判为 video（如实边界，
 * 因为不重新探测就无法区分；见 CONTRACT §5）。
 */
export function resolveAssetKind(
  sidecarKind: AssetSidecar['kind'],
  mime: string,
): 'image' | 'video' | 'audio' | null {
  if (sidecarKind !== undefined) return sidecarKind;
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return null;
}

export const createAssetRoutes =
  (deps: AssetRoutesDeps = {}): FastifyPluginAsyncZod =>
  async (app) => {
    const outputsDir = deps.outputsDir ?? resolveOutputsDir();

    app.get(
      '/api/assets',
      {
        schema: {
          // V2.11（B47）：`?project=<id>` 只列该项目的资产；**省略 = 默认项目**
          querystring: z.object({ project: z.string().optional() }),
          response: { 200: AssetListResponseSchema },
        },
      },
      async (request) => {
        const assetsDir = path.join(outputsDir, 'assets');
        const projectFilter = normalizeProjectId(request.query.project);

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

            // 魔数嗅探只读文件头；未知类型（含 sidecar 的 `.json`）一律跳过
            const sniffed = await fileTypeFromFile(filePath);
            if (sniffed === undefined) continue;

            // V2.10：kind 以 sidecar 为准（上传时已算准），缺失才按容器兜底
            const sidecar = await readAssetSidecar(assetsDir, assetId);
            const kind = resolveAssetKind(sidecar.kind, sniffed.mime);
            if (kind === null) continue;

            // V2.11（B47）：归属项目 —— sidecar 缺省即默认项目
            const projectId = normalizeProjectId(sidecar.projectId);
            if (projectId !== projectFilter) continue;

            entries.push({
              assetId,
              kind,
              mime: sniffed.mime,
              size: info.size,
              url: `/media/assets/${name}`,
              createdAt: Math.round(info.mtimeMs),
              projectId,
              ...(sidecar.name === undefined ? {} : { name: sidecar.name }),
            });
          } catch {
            // 扫描期间文件被删（与 DELETE /api/history/:taskId 的清理并发）：跳过即可
            continue;
          }
        }

        entries.sort((a, b) => b.createdAt - a.createdAt);
        // V2.85：截断要**说出来**（`truncated` + `total`），不让用户以为素材丢了
        return {
          assets: entries.slice(0, MAX_LISTED_ASSETS),
          truncated: entries.length > MAX_LISTED_ASSETS,
          total: entries.length,
        };
      },
    );
  };
