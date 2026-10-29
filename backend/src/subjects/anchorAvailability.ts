import { existsSync } from 'node:fs';
import path from 'node:path';

import type { TaskStore } from '../store/taskStore.js';
import { resolveOutputFilePath } from '../server/storageUsage.js';

/**
 * 主体锚点（定妆图）**现在还能不能用**（V2.100 / B103 片 B）。
 *
 * ## 为什么需要它
 * 锚点只存了一个引用：`task:<taskId>`（生成出来的定妆图）或普通资产 id。
 * 而产物会被容量淘汰、任务会被清理、资产会被删 —— 引用本身**永远不会报错**，
 * 它只会在生成时变成一个读不到的文件。用户看到的会是"上游报错"或"图不对"，
 * 而不是"你的定妆图没了"。这个函数就是把那句话提前说出来。
 *
 * ## 三条口径
 * 1. **不猜**：查不到就返回 `false`（明确失效），而不是"也许还行"；
 * 2. **只读不写**：这是读时派生的事实，**不入库** —— 入库会变成需要维护的陈旧状态；
 * 3. **没有锚点返回 `undefined`**：与"有锚点但失效（`false`）"必须能分开，
 *    前者是"还没出定妆图"，后者是"出过但现在没了"，处置方式不同。
 */
export interface AnchorProbe {
  /** 按 id 取任务（不存在返回 null） */
  taskById(taskId: string): { status: string; outputImageUrl?: string } | null;
  /** 产物目录（解析 `task:` 类锚点的文件路径） */
  outputsDir: string;
  /** 资产文件是否存在（默认扫 `assets/<id>.<ext>`） */
  assetFileExists?(assetId: string): boolean;
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;

function defaultAssetExists(outputsDir: string, assetId: string): boolean {
  return IMAGE_EXTENSIONS.some((ext) => existsSync(path.join(outputsDir, 'assets', `${assetId}.${ext}`)));
}

/**
 * `undefined` = 没设锚点；`true` = 可用；`false` = 失效（产物/资产已不在）。
 */
export function anchorAvailability(
  anchorAssetId: string | undefined,
  probe: AnchorProbe,
): boolean | undefined {
  if (anchorAssetId === undefined || anchorAssetId === '') return undefined;

  if (anchorAssetId.startsWith('task:')) {
    const taskId = anchorAssetId.slice('task:'.length);
    if (taskId === '') return false;
    const task = probe.taskById(taskId);
    if (task === null || task.status !== 'succeeded' || task.outputImageUrl === undefined) return false;
    return existsSync(resolveOutputFilePath(probe.outputsDir, task.outputImageUrl));
  }

  const exists = probe.assetFileExists ?? ((id: string) => defaultAssetExists(probe.outputsDir, id));
  return exists(anchorAssetId);
}

/** 给一组主体加上 `anchorAvailable`（路由层用；不含锚点的主体保持原样） */
export function withAnchorAvailability<T extends { anchorAssetId?: string }>(
  subject: T,
  probe: AnchorProbe,
): T & { anchorAvailable?: boolean } {
  const available = anchorAvailability(subject.anchorAssetId, probe);
  if (available === undefined) return subject;
  return { ...subject, anchorAvailable: available };
}

/** 从任务存储构造默认探针（路由层省事） */
export function taskProbe(store: TaskStore, outputsDir: string): AnchorProbe {
  return {
    taskById: (taskId) => {
      const record = store.get(taskId);
      if (record === null) return null;
      return {
        status: record.status,
        ...(record.outputImageUrl === undefined ? {} : { outputImageUrl: record.outputImageUrl }),
      };
    },
    outputsDir,
  };
}
