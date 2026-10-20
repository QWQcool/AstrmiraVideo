import { describe, expect, it } from 'vitest';
import { nextTabIndex } from './focusTrap';

describe('nextTabIndex', () => {
  it('正向 Tab 到下一个，末尾回到开头', () => {
    expect(nextTabIndex(0, 3, false)).toBe(1);
    expect(nextTabIndex(2, 3, false)).toBe(0);
  });

  it('Shift+Tab 到上一个，开头回到末尾', () => {
    expect(nextTabIndex(1, 3, true)).toBe(0);
    expect(nextTabIndex(0, 3, true)).toBe(2);
  });

  it('焦点不在列表里时从首/尾进入', () => {
    expect(nextTabIndex(-1, 3, false)).toBe(0);
    expect(nextTabIndex(-1, 3, true)).toBe(2);
  });

  it('空列表返回 -1（调用方负责不让焦点跑出去）', () => {
    expect(nextTabIndex(0, 0, false)).toBe(-1);
    expect(nextTabIndex(-1, 0, true)).toBe(-1);
  });
});
