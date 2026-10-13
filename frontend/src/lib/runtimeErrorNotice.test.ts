import { describe, expect, it } from 'vitest';
import { installRuntimeErrorNotice } from './runtimeErrorNotice';

/**
 * B61 · 片 B 的**能测的那一半**。
 *
 * DOM 那半（建节点 / 绑关闭按钮）没有 jsdom 可测 —— 这正是决策 D52（不引入 jsdom）的
 * 已知代价，补偿是：DOM 那半写成了薄壳，行为断言放在**真实浏览器**的 UI 冒烟里
 * （`scripts/smoke-ui.mjs` 的 [7f] 段真抛一个错、真点关闭）。
 *
 * 这里钉的是另一件更要紧的事：**在没有浏览器的环境里 import 它不会炸**。
 * vitest 就跑在 node 环境（`environment: 'node'`），任何"顺手 import 一下"的工具
 * 都会走到这里；一个裸 `window.addEventListener` 会让整个测试文件挂掉。
 */
describe('installRuntimeErrorNotice：无浏览器环境降级', () => {
  it('node 环境（无 window）→ 返回空实现，不抛错', () => {
    expect(typeof window).toBe('undefined');
    const handle = installRuntimeErrorNotice();
    expect(handle.shown()).toBe(0);
    expect(() => handle.report('script', new Error('x'))).not.toThrow();
    expect(() => handle.dispose()).not.toThrow();
  });

  it('空实现的三个方法可以反复调用（调用方不必判空，也不必管顺序）', () => {
    const handle = installRuntimeErrorNotice();
    handle.dispose();
    handle.dispose();
    expect(handle.shown()).toBe(0);
  });
});
