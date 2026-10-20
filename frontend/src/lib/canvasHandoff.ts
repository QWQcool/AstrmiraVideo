import type { CanvasNodeType } from '@astrmira/shared';

/**
 * 「去画布编辑」的一次性交接（Step 11-S4）。
 *
 * 为什么不用 URL query：任务 id / 媒体 URL / 标题都要带过去，塞进 hash 会把地址栏弄得很脏，
 * 而且刷新后还会重复执行"放入画布"。用 sessionStorage 的一次性键：写入 → 跳 `#/canvas` →
 * 画布读走并删除；重复点击最多多一个节点（画布端按 `task:` 资产去重）。
 *
 * 纯函数 + Storage 注入：Node 里可以单测，浏览器里默认 sessionStorage。
 */

export interface CanvasResultHandoff {
  taskId: string;
  kind: Extract<CanvasNodeType, 'image' | 'video' | 'audio'>;
  /** 同源媒体相对路径（`/media/...`）；不接受外部地址 */
  url: string;
  title: string;
}

const KEY = 'astrmira.canvas.result_handoff';

export function parseCanvasResultHandoff(raw: string | null): CanvasResultHandoff | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    const taskId = record.taskId;
    const kind = record.kind;
    const url = record.url;
    const title = record.title;
    if (typeof taskId !== 'string' || taskId.trim() === '') return null;
    if (kind !== 'image' && kind !== 'video' && kind !== 'audio') return null;
    if (typeof url !== 'string' || !url.startsWith('/')) return null;
    if (typeof title !== 'string') return null;
    return { taskId, kind, url, title };
  } catch {
    return null;
  }
}

export function setCanvasResultHandoff(
  value: CanvasResultHandoff,
  storage: Pick<Storage, 'setItem'> = sessionStorage,
): boolean {
  try {
    storage.setItem(KEY, JSON.stringify(value));
    return true;
  } catch {
    // 隐私模式 / 配额满：调用方必须给提示并停在原页，不能假装交接成功
    return false;
  }
}

/** 交接**成功落盘到画布文档之后**才清除；保存失败时保留，下次还能再试 */
export function clearCanvasResultHandoff(
  storage: Pick<Storage, 'removeItem'> = sessionStorage,
): void {
  try {
    storage.removeItem(KEY);
  } catch {
    // 清除失败不影响保存结果；下次读取按 assetId 去重
  }
}

export function peekCanvasResultHandoff(
  storage: Pick<Storage, 'getItem'> = sessionStorage,
): CanvasResultHandoff | null {
  try {
    return parseCanvasResultHandoff(storage.getItem(KEY));
  } catch {
    return null;
  }
}

export function takeCanvasResultHandoff(
  storage: Pick<Storage, 'getItem' | 'removeItem'> = sessionStorage,
): CanvasResultHandoff | null {
  const value = peekCanvasResultHandoff(storage);
  if (value !== null) {
    try {
      storage.removeItem(KEY);
    } catch {
      // 删除失败也不影响本次消费（下次再读会重复，画布端按 assetId 去重）
    }
  }
  return value;
}

/** 交接 → 画布资产（`task:` 引用；不复制文件） */
export function resultHandoffAsset(value: CanvasResultHandoff): {
  assetId: string;
  kind: CanvasResultHandoff['kind'];
  url: string;
  name: string;
} {
  return { assetId: `task:${value.taskId}`, kind: value.kind, url: value.url, name: value.title };
}
