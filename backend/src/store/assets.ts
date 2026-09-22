import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * 资产 id → 上游可访问地址。
 *
 * ## 为什么需要"两种模式"
 * 云端 provider 需要把参考图**交给上游**，而上游只能拿 URL（或 data URL）：
 * - `PUBLIC_BASE_URL` 已配置（Step 5 公网部署）→ 直接给 `https://<host>/media/assets/<file>`；
 * - 未配置（本地开发 / 内网）→ 退回 **data URL**（上游读不到我们的 localhost）。
 *
 * ## 两条安全约束
 * 1. `assetId` **必须**是 36 字符 UUID 形状 —— 它来自请求体，直接拼进文件名就是路径穿越漏洞；
 * 2. data URL 有体积上限：超过就**如实返回 null**（上层转 `INVALID_ASSET`），
 *    而不是塞一个几十 MB 的 base64 把请求搞崩。
 */

/** data URL 的硬上限（base64 膨胀约 4/3） */
export const MAX_DATA_URL_BYTES = 4 * 1024 * 1024;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EXT_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

export interface AssetResolverOptions {
  /** 资产目录（= `<outputs>/assets`） */
  assetsDir: string;
  /** 公网基址，如 `https://video.example.com`；未配置则走 data URL */
  publicBaseUrl?: string;
}

export function isSafeAssetId(assetId: string): boolean {
  return UUID_PATTERN.test(assetId);
}

/** 在资产目录里定位文件（扩展名由上传时的魔数嗅探决定，这里按前缀匹配） */
async function locateAsset(assetsDir: string, assetId: string): Promise<string | null> {
  if (!isSafeAssetId(assetId)) return null;

  let entries: string[];
  try {
    entries = await readdir(assetsDir);
  } catch {
    return null;
  }

  const hit = entries.find((name) => name.startsWith(`${assetId}.`));
  return hit === undefined ? null : path.join(assetsDir, hit);
}

export function createAssetUrlResolver(
  options: AssetResolverOptions,
): (assetId: string) => Promise<string | null> {
  const base = options.publicBaseUrl?.replace(/\/+$/, '');

  return async (assetId: string): Promise<string | null> => {
    const filePath = await locateAsset(options.assetsDir, assetId);
    if (filePath === null) return null;

    const fileName = path.basename(filePath);

    if (base !== undefined && base !== '') {
      // `/media/assets/...` 由既有静态服务提供（与成片同一套 Range 逻辑）
      return `${base}/media/assets/${fileName}`;
    }

    const ext = path.extname(fileName).toLowerCase();
    const mime = EXT_MIME[ext];
    if (mime === undefined) return null;

    const info = await stat(filePath);
    if (info.size > MAX_DATA_URL_BYTES) return null;

    const buffer = await readFile(filePath);
    return `data:${mime};base64,${buffer.toString('base64')}`;
  };
}
