import { useEffect, useRef } from 'react';
import { FOCUSABLE_SELECTOR, nextTabIndex } from './focusTrap';
import { pushModalLayer } from './modalLayer';

/**
 * 弹窗焦点约束（S5-B4d）：打开时把焦点移入，Tab/Shift+Tab 在层内循环，Esc 关闭，
 * 关闭后回焦到触发元素；同时 push 一层 modalLayer，让背景画布暂停全局快捷键。
 *
 * 不是"自动聚焦到第一个输入框"那种猜测：优先第一个可聚焦控件（通常是关闭按钮），
 * 用户可以立刻 Tab 到表单；需要首字段自动聚焦的弹窗自己保留 autoFocus。
 */
export function useDialogFocus<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onClose: () => void,
) {
  const containerRef = useRef<T | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (container === null) return;

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const release = pushModalLayer();

    const focusables = (): HTMLElement[] =>
      [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (element) =>
          element.offsetParent !== null &&
          element.getAttribute('aria-hidden') !== 'true' &&
          element.getAttribute('tabindex') !== '-1',
      );

    const raf = requestAnimationFrame(() => {
      const first = focusables()[0];
      (first ?? container).focus();
    });

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next = nextTabIndex(current, items.length, event.shiftKey);
      event.preventDefault();
      items[next]?.focus();
    };

    container.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      container.removeEventListener('keydown', onKeyDown);
      release();
      if (previous !== null && previous.isConnected) previous.focus();
    };
  }, [open]);

  return containerRef;
}
