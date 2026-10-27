import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { TaskStore } from './taskStore.js';

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

  /**
   * V2.78 修正：**必须排除 sidecar**。
   *
   * 每个上传资产旁边都有一个 `<assetId>.json` 元数据（V2.9 起），而 `startsWith('<id>.')`
   * 对 `.json` 同样成立 —— readdir 顺序一变就会把 sidecar 当成资产返回，
   * 上层拿到 `{"name":"mask.png",…}` 的 83 字节去当图片用。
   * 实测症状：局部重绘提交后 ComfyUI 报 `cannot identify image file …/xxx.png`。
   *
   * 只认 `EXT_MIME` 里的媒体扩展名；`.json`（以及 `locateAsset` 不认识的其它扩展）一律跳过。
   */
  const hit = entries.find((name) => {
    if (!name.startsWith(`${assetId}.`)) return false;
    return EXT_MIME[path.extname(name).toLowerCase()] !== undefined;
  });
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

/**
 * `task:<taskId>` 引用 → 上游可访问地址（V2.6 / 台账 B37：剪辑产物与成片可直接当 V2V 参考）。
 *
 * 与资产解析的三点不同：
 * 1. **没有 data URL 退路** —— 上游明文拒绝视频 data URL（`reference_video must be provided
 *    as a web url`），且成片体积远超 `MAX_DATA_URL_BYTES`。所以未配 `PUBLIC_BASE_URL` 时
 *    如实报 `no_public_base`，由 provider 层转成"去配公网基址"的可读错误；
 * 2. **不碰文件系统** —— 成片地址就是任务记录里的 `outputVideoUrl`（`/media/<taskId>.mp4`），
 *    直接拼公网基址；文件缺失由静态服务 404 兜住（与成片播放同一口径）；
 * 3. 判别式结果把「任务不存在 / 无成片 / 未配公网基址」分开 —— 三者的错误码与文案不同
 *    （前两者 → `TASK_NOT_FOUND`，后者 → `INVALID_ASSET` + 配置指引）。
 */
export type TaskVideoResolution =
  | { ok: true; url: string }
  | { ok: false; reason: 'not_found' | 'no_output' | 'no_public_base' };

export interface TaskVideoResolverOptions {
  /** 只用到 `get`（查询任务记录），刻意不拿整个 store */
  store: Pick<TaskStore, 'get'>;
  /** 公网基址（同 `createAssetUrlResolver` 的口径） */
  publicBaseUrl?: string;
}

export function createTaskVideoUrlResolver(
  options: TaskVideoResolverOptions,
): (taskId: string) => Promise<TaskVideoResolution> {
  const base = options.publicBaseUrl?.replace(/\/+$/, '');

  return (taskId: string): Promise<TaskVideoResolution> => {
    const record = options.store.get(taskId);
    if (record === null) return Promise.resolve({ ok: false, reason: 'not_found' });
    if (record.status !== 'succeeded') {
      return Promise.resolve({ ok: false, reason: 'no_output' });
    }
    // S9 修正（真机全链路实测暴露）：t2i 任务的产物是**图片**（outputImageUrl）——
    // i2v 首帧引用一个图片任务完全合法；只认 outputVideoUrl 会把
    // "图生视频接在文生图之后"的链路判成 no_output。
    const output = record.outputVideoUrl ?? record.outputImageUrl;
    if (output === undefined || output === '') {
      return Promise.resolve({ ok: false, reason: 'no_output' });
    }
    if (base === undefined || base === '') {
      return Promise.resolve({ ok: false, reason: 'no_public_base' });
    }
    return Promise.resolve({ ok: true, url: `${base}${output}` });
  };
}
