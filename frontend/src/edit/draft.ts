import { STORAGE_KEYS, browserStorage, readLocal, removeLocal, writeLocal, type StorageAccess } from '../lib/storage';
import { EditProjectSchema, pruneBrokenTransitions, type EditProject } from './model';

/**
 * 剪辑台工程草稿（B34 · P3）：按**源任务 id** 存 localStorage，刷新不丢编辑成果。
 *
 * 三条纪律（与 `lib/storage.ts` 同源）：
 * 1. 键名集中登记（`STORAGE_KEYS.editDraftPrefix`），不在组件里拼魔法字符串；
 * 2. 读写一律 try/catch —— 隐私模式 / 配额满时降级为"没有草稿"，绝不白屏；
 * 3. 读到脏数据（JSON 坏 / schema 不过）**就地清掉并返回 null**（自愈），
 *    不清的话每次进剪辑台都会重复解析同一份坏数据。
 *
 * 注意：草稿里的素材引用（`/media/*`）可能在服务端已被删除 ——
 * 那时探测/预览会如实报错（不做静默兜底），用户删掉片段或换素材即可。
 */

export function draftKey(sourceTaskId: string): string {
  return `${STORAGE_KEYS.editDraftPrefix}${sourceTaskId}`;
}

/** 读取草稿；无草稿 / 脏数据 → null（脏数据会被清除）。返回前清掉已不成立的转场（自愈） */
export function loadEditDraft(
  sourceTaskId: string,
  access: StorageAccess = browserStorage(),
): EditProject | null {
  const raw = readLocal(access, draftKey(sourceTaskId));
  if (raw === null) return null;
  try {
    const parsed = EditProjectSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      removeLocal(access, draftKey(sourceTaskId));
      return null;
    }
    return pruneBrokenTransitions(parsed.data).project;
  } catch {
    removeLocal(access, draftKey(sourceTaskId));
    return null;
  }
}

export function saveEditDraft(
  sourceTaskId: string,
  project: EditProject,
  access: StorageAccess = browserStorage(),
): void {
  try {
    writeLocal(access, draftKey(sourceTaskId), JSON.stringify(project));
  } catch {
    /* 配额满 / 隐私模式：静默降级（下次操作会再试） */
  }
}

export function clearEditDraft(
  sourceTaskId: string,
  access: StorageAccess = browserStorage(),
): void {
  removeLocal(access, draftKey(sourceTaskId));
}
