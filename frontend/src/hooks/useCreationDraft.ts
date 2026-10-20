import { useCallback, useMemo, useState } from 'react';
import type { CanvasNodeSettings, CanvasReference } from '@astrmira/shared';
import { browserStorage } from '../lib/storage';
import {
  clearCreationDraftBackup,
  createCreationDraft,
  readCreationDraft,
  readCreationDraftBackup,
  writeCreationDraft,
  writeCreationDraftBackup,
  type CreationDraft,
  type CreationKind,
} from '../lib/creationDraft';

/**
 * 创作输入区的草稿钩子（Step 11-S2）。
 *
 * 只做三件事：**首次读**、**切类型**、**变更后落盘**。
 * 提示词、参数与稳定引用都由 `CreateView` 提供；这里只负责把“用户上次停在哪”记住。
 * 预览 URL / File / 上传中占位**不落盘**，刷新后按 assetId / `task:` 重新解析。
 *
 * S2 只开放 `video` / `image` 两态；`agent` 留给 S6（草稿模型本身已支持）。
 */
export interface CreationDraftHandle {
  kind: CreationKind;
  setKind(next: CreationKind): void;
  /** 首次进入时的草稿快照（用于初始化受控输入，不随后续变更刷新） */
  initial: CreationDraft;
  /** 把当前输入写回草稿（调用方在变更时触发） */
  persist(input: {
    prompt: string;
    settings: CanvasNodeSettings;
    references?: readonly CanvasReference[];
  }): void;
  /** S5-B3e：覆盖前备份当前草稿 */
  backup(input: {
    prompt: string;
    settings: CanvasNodeSettings;
    references?: readonly CanvasReference[];
  }): void;
  readBackup(): CreationDraft | null;
  clearBackup(): void;
}

export function useCreationDraft(defaultKind: CreationKind = 'video'): CreationDraftHandle {
  const store = useMemo(() => browserStorage().local, []);
  const initial = useMemo(() => {
    if (!store) return createCreationDraft(defaultKind);
    const loaded = readCreationDraft(store);
    // 没有存过（或存的是空 Agent 占位）时，用调用方指定的默认类型
    return loaded.kind === 'agent' && loaded.prompt === ''
      ? createCreationDraft(defaultKind)
      : loaded;
  }, [store, defaultKind]);

  const [kind, setKind] = useState<CreationKind>(initial.kind);

  const persist = useCallback(
    ({
      prompt,
      settings,
      references,
    }: {
      prompt: string;
      settings: CanvasNodeSettings;
      references?: readonly CanvasReference[];
    }) => {
      if (!store) return;
      writeCreationDraft(store, {
        kind,
        prompt,
        // S5-B1：只持久化稳定的 assetId / task 引用与用途/顺序；
        // 预览 URL、File、上传中占位都不进草稿（跨会话会失效）。
        references: [...(references ?? [])],
        settings,
        updatedAt: Date.now(),
      });
    },
    [store, kind],
  );

  const backup = useCallback(
    ({
      prompt,
      settings,
      references,
    }: {
      prompt: string;
      settings: CanvasNodeSettings;
      references?: readonly CanvasReference[];
    }) => {
      if (!store) return;
      writeCreationDraftBackup(store, {
        kind,
        prompt,
        references: [...(references ?? [])],
        settings,
        updatedAt: Date.now(),
      });
    },
    [store, kind],
  );

  const readBackup = useCallback(
    (): CreationDraft | null => (store ? readCreationDraftBackup(store) : null),
    [store],
  );

  const clearBackup = useCallback((): void => {
    if (store) clearCreationDraftBackup(store);
  }, [store]);

  return { kind, setKind, initial, persist, backup, readBackup, clearBackup };
}
