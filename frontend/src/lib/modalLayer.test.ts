import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetModalLayersForTesting,
  isModalLayerOpen,
  modalLayerCount,
  pushModalLayer,
} from './modalLayer';

afterEach(() => __resetModalLayersForTesting());

describe('modalLayer', () => {
  it('push 后为打开，release 后关闭', () => {
    const release = pushModalLayer();
    expect(isModalLayerOpen()).toBe(true);
    expect(modalLayerCount()).toBe(1);
    release();
    expect(isModalLayerOpen()).toBe(false);
    expect(modalLayerCount()).toBe(0);
  });

  it('重复 release 只减一次（StrictMode 双清理不会把层数减成负）', () => {
    const release = pushModalLayer();
    release();
    release();
    expect(modalLayerCount()).toBe(0);
  });

  it('多层叠加时只有全部释放才关闭', () => {
    const first = pushModalLayer();
    const second = pushModalLayer();
    expect(modalLayerCount()).toBe(2);
    first();
    expect(isModalLayerOpen()).toBe(true);
    second();
    expect(isModalLayerOpen()).toBe(false);
  });
});
