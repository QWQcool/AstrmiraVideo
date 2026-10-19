import { useCallback, useMemo, useState } from 'react';
import type { CanvasNodeSettings } from '@astrmira/shared';
import { browserStorage } from '../lib/storage';
import {
  createCreationDraft,
  readCreationDraft,
  writeCreationDraft,
  type CreationDraft,
  type CreationKind,
} from '../lib/creationDraft';

/**
 * 创作输入区的草稿钩子（Step 11-S2）。
 *
 * 只做三件事：**首次读**、**切类型**、**变更后落盘**。
 * 提示词与参数的局部状态仍留在 `CreateView`（它们是受控输入，搬进 hook 只会多一层同步）；
 * 这里负责把"用户上次停在哪"记住，刷新后能接上。
 *
 * S2 只开放 `video` / `image` 两态；`agent` 留给 S6（草稿模型本身已支持）。
 */
export interface CreationDraftHandle {
  kind: CreationKind;
  setKind(next: CreationKind): void;
  /** 首次进入时的草稿快照（用于初始化受控输入，不随后续变更刷新） */
  initial: CreationDraft;
  /** 把当前输入写回草稿（调用方在变更时触发） */
  persist(input: { prompt: string; settings: CanvasNodeSettings }): void;
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
    ({ prompt, settings }: { prompt: string; settings: CanvasNodeSettings }) => {
      if (!store) return;
      writeCreationDraft(store, {
        kind,
        prompt,
        // 素材暂不持久化：chip 里有临时预览 URL 与上传中占位，跨会话恢复需要重新按 assetId 解析。
        // 这里显式写空数组，避免旧草稿里的失效引用被当成"还在"。
        references: [],
        settings,
        updatedAt: Date.now(),
      });
    },
    [store, kind],
  );

  return { kind, setKind, initial, persist };
}
