/**
 * 创作输入的统一键盘规则（CONTRACT D69 / S5-B1）。
 *
 * 首页与画布节点**必须**共用这一条规则，否则两个入口会教出两套肌肉记忆：
 * - Enter：换行（不提交）；
 * - Ctrl/Cmd + Enter：提交；
 * - 输入法组合中（`isComposing` / `Process`）：一律不提交；
 * - `@` 候选打开时：Enter 先选候选，Escape 关闭候选。
 *
 * 纯函数：只返回“该做什么”，不碰 DOM、不调用提交。界面负责 preventDefault。
 */
export type ComposerKeyAction = 'submit' | 'newline' | 'select-mention' | 'close-mention' | null;

export interface ComposerKeyLike {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
}

export function composerKeyAction(
  event: ComposerKeyLike,
  options: { mentionOpen: boolean },
): ComposerKeyAction {
  // 中文输入法：候选确认的 Enter 不能当提交（React 的合成事件仍可能带 isComposing）
  if (event.isComposing === true || event.key === 'Process') return null;

  if (event.key === 'Escape') {
    return options.mentionOpen ? 'close-mention' : null;
  }

  if (event.key !== 'Enter') return null;
  if (options.mentionOpen) return 'select-mention';
  if (event.ctrlKey === true || event.metaKey === true) return 'submit';
  return 'newline';
}
