import { describe, expect, it } from 'vitest';
import { composerKeyAction } from './composerKeys';

describe('创作输入键盘规则（D69）', () => {
  it('Enter 换行，Ctrl/Cmd+Enter 提交', () => {
    expect(composerKeyAction({ key: 'Enter' }, { mentionOpen: false })).toBe('newline');
    expect(composerKeyAction({ key: 'Enter', shiftKey: true }, { mentionOpen: false })).toBe(
      'newline',
    );
    expect(composerKeyAction({ key: 'Enter', ctrlKey: true }, { mentionOpen: false })).toBe(
      'submit',
    );
    expect(composerKeyAction({ key: 'Enter', metaKey: true }, { mentionOpen: false })).toBe(
      'submit',
    );
  });

  it('输入法组合期间不提交、不换行判定', () => {
    expect(composerKeyAction({ key: 'Enter', isComposing: true }, { mentionOpen: false })).toBe(
      null,
    );
    expect(composerKeyAction({ key: 'Process' }, { mentionOpen: false })).toBe(null);
    expect(
      composerKeyAction({ key: 'Enter', ctrlKey: true, isComposing: true }, { mentionOpen: false }),
    ).toBe(null);
  });

  it('@ 候选优先：Enter 选候选，Escape 关闭', () => {
    expect(composerKeyAction({ key: 'Enter' }, { mentionOpen: true })).toBe('select-mention');
    expect(composerKeyAction({ key: 'Enter', ctrlKey: true }, { mentionOpen: true })).toBe(
      'select-mention',
    );
    expect(composerKeyAction({ key: 'Escape' }, { mentionOpen: true })).toBe('close-mention');
    expect(composerKeyAction({ key: 'Escape' }, { mentionOpen: false })).toBe(null);
  });

  it('普通字符不拦截', () => {
    expect(composerKeyAction({ key: 'a' }, { mentionOpen: false })).toBe(null);
  });
});
