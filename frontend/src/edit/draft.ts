import {
  STORAGE_KEYS,
  browserStorage,
  readLocal,
  removeLocal,
  writeLocal,
  type StorageAccess,
} from '../lib/storage';
import { migrateEditProject, pruneBrokenTransitions, type EditProject } from './model';

/**
 * 剪辑台工程草稿与**版本历史**（B34 · P3 起；V2.21 / 台账 B66 扩了版本化与历史）。
 *
 * ## 三条纪律（与 `lib/storage.ts` 同源）
 * 1. 键名集中登记（`STORAGE_KEYS`），不在组件里拼魔法字符串；
 * 2. 读写一律 try/catch —— 隐私模式 / 配额满时降级为"没有草稿"，绝不白屏；
 * 3. **不静默丢数据**（V2.21 改口径）：读到读不出来的草稿时 **保留原文**并给出原因。
 *    原先的做法是"就地删掉并返回 null"（自愈），但那是**数据丢失** ——
 *    用户看到的是"我的剪辑怎么没了"，而且再也没机会救回来。
 *    现在的口径：**留着原文 + 在界面上如实说明**（每次进剪辑台都会说，直到用户自己清掉）。
 *
 * 注意：草稿里的素材引用（`/media/*`）可能在服务端已被删除 ——
 * 那时探测/预览会如实报错（不做静默兜底），用户删掉片段或换素材即可。
 */

/** 读草稿的结果：`problem` 非 null 即"读不出来"（原文**仍在** localStorage 里） */
export interface DraftLoad {
  project: EditProject | null;
  problem: string | null;
  /** 迁移过程做了什么（如"文件没有版本号，按 v1 处理"）—— 界面上如实展示 */
  notes: string[];
}

export function draftKey(sourceTaskId: string): string {
  return `${STORAGE_KEYS.editDraftPrefix}${sourceTaskId}`;
}

export function draftHistoryKey(sourceTaskId: string): string {
  return `${STORAGE_KEYS.editDraftHistoryPrefix}${sourceTaskId}`;
}

/**
 * 读草稿：无草稿 → `{ project: null, problem: null }`；读不出来 → `{ project: null, problem: '原因' }`
 * （**不删原文**）。读成功后再清掉已不成立的转场（`pruneBrokenTransitions` 自愈）。
 */
export function loadEditDraft(
  sourceTaskId: string,
  access: StorageAccess = browserStorage(),
): DraftLoad {
  const raw = readLocal(access, draftKey(sourceTaskId));
  if (raw === null) return { project: null, problem: null, notes: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      project: null,
      problem: '草稿不是有效的 JSON（可能是手改过或写入中断）',
      notes: [],
    };
  }

  const migrated = migrateEditProject(parsed);
  if (!migrated.ok) return { project: null, problem: migrated.reason, notes: [] };

  return {
    project: pruneBrokenTransitions(migrated.project).project,
    problem: null,
    notes: migrated.notes,
  };
}

/** 保存草稿（同时按最小间隔推一份历史快照 —— 见 `pushEditDraftHistory`） */
export function saveEditDraft(
  sourceTaskId: string,
  project: EditProject,
  access: StorageAccess = browserStorage(),
): void {
  try {
    writeLocal(access, draftKey(sourceTaskId), JSON.stringify(project));
  } catch {
    /* 配额满 / 隐私模式：静默降级（下次操作会再试） */
    return; // 写都写不进去，历史也不必再试
  }
  pushEditDraftHistory(sourceTaskId, project, {}, access);
}

/** 清掉草稿（**历史保留**：用户想回头还能从历史里恢复） */
export function clearEditDraft(
  sourceTaskId: string,
  access: StorageAccess = browserStorage(),
): void {
  removeLocal(access, draftKey(sourceTaskId));
}

// ── 版本历史（V2.21 / 台账 B66）──────────────────────────────────────────────

/** 保留多少份快照：够"回到半小时前/上周那版"，又不至于把 localStorage 塞满 */
export const DRAFT_HISTORY_LIMIT = 8;
/** 自动快照的最小间隔：剪辑时每 500ms 防抖就会存一次，不设间隔会瞬间刷满历史 */
export const DRAFT_HISTORY_MIN_INTERVAL_MS = 5 * 60 * 1000;

export interface DraftSnapshot {
  savedAt: number;
  project: EditProject;
}

interface RawSnapshot {
  savedAt: number;
  project: unknown;
}

function readHistoryRaw(sourceTaskId: string, access: StorageAccess): RawSnapshot[] {
  const raw = readLocal(access, draftHistoryKey(sourceTaskId));
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RawSnapshot =>
        typeof item === 'object' && item !== null && typeof (item as RawSnapshot).savedAt === 'number',
    );
  } catch {
    return [];
  }
}

function writeHistoryRaw(sourceTaskId: string, snapshots: RawSnapshot[], access: StorageAccess): void {
  try {
    writeLocal(access, draftHistoryKey(sourceTaskId), JSON.stringify(snapshots));
  } catch {
    /* 配额满：历史是**尽力而为**的功能，写不进去就算了（不能因此让编辑器报错） */
  }
}

/**
 * 读历史：逐份过迁移函数（**老快照也要能打开** —— 与草稿同一条纪律），
 * 读不出来的那份**跳过并计数**（不阻塞其余快照），由界面如实说明。
 */
export function listEditDraftHistory(
  sourceTaskId: string,
  access: StorageAccess = browserStorage(),
): { snapshots: DraftSnapshot[]; broken: number } {
  const snapshots: DraftSnapshot[] = [];
  let broken = 0;

  for (const item of readHistoryRaw(sourceTaskId, access)) {
    const migrated = migrateEditProject(item.project);
    if (!migrated.ok) {
      broken += 1;
      continue;
    }
    snapshots.push({ savedAt: item.savedAt, project: migrated.project });
  }

  return { snapshots: snapshots.sort((a, b) => b.savedAt - a.savedAt), broken };
}

/**
 * 推一份快照。**返回是否真的存了**（调用方/测试据此判断）：
 * - 与最新一份**完全相同** → 跳过（防"每 500ms 存一份一模一样的"）；
 * - 距最新一份不到 `minIntervalMs` 且未 `force` → 跳过（自动快照的节流）；
 * - `force: true` 用于**用户点「存一个版本」**与**恢复之前**的保底（这两处必须是显式动作）。
 */
export function pushEditDraftHistory(
  sourceTaskId: string,
  project: EditProject,
  options: {
    now?: number;
    force?: boolean;
    minIntervalMs?: number;
    limit?: number;
  } = {},
  access: StorageAccess = browserStorage(),
): boolean {
  const now = options.now ?? Date.now();
  const minIntervalMs = options.minIntervalMs ?? DRAFT_HISTORY_MIN_INTERVAL_MS;
  const limit = options.limit ?? DRAFT_HISTORY_LIMIT;

  const existing = readHistoryRaw(sourceTaskId, access);
  const newest = existing[0];

  if (newest !== undefined) {
    if (JSON.stringify(newest.project) === JSON.stringify(project)) return false;
    if (options.force !== true && now - newest.savedAt < minIntervalMs) return false;
  }

  const next: RawSnapshot[] = [{ savedAt: now, project }, ...existing].slice(0, limit);
  writeHistoryRaw(sourceTaskId, next, access);
  return true;
}

export function clearEditDraftHistory(
  sourceTaskId: string,
  access: StorageAccess = browserStorage(),
): void {
  removeLocal(access, draftHistoryKey(sourceTaskId));
}
