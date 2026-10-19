import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * 画布右键菜单（Step 11-S3 片 B3）。
 *
 * 只做「显示一组动作 + 点完关闭」：动作本身由视图提供（新建/粘贴/撤销/重做/复制/删除）。
 * 位置会夹进窗口内 —— 否则贴着右下角右键时，菜单有一半在屏幕外。
 */

export interface CanvasMenuAction {
  id: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onSelect(): void;
}

export type CanvasMenuItem = CanvasMenuAction | 'separator';

export interface CanvasContextMenuProps {
  /** 相对定位容器（画布）的坐标 */
  x: number;
  y: number;
  items: readonly CanvasMenuItem[];
  onClose(): void;
}

export function CanvasContextMenu({ x, y, items, onClose }: CanvasContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ x, y });

  useLayoutEffect(() => {
    const element = ref.current;
    const parent = element?.offsetParent as HTMLElement | null | undefined;
    if (element === null || parent === null || parent === undefined) return;
    const rect = element.getBoundingClientRect();
    // 菜单是相对画布容器绝对定位的：把上限换算成"容器内坐标"，否则贴右下角右键会出界
    const maxX = Math.max(0, parent.clientWidth - rect.width - 8);
    const maxY = Math.max(0, parent.clientHeight - rect.height - 8);
    setPosition((prev) => ({
      x: Math.min(prev.x, maxX),
      y: Math.min(prev.y, maxY),
    }));
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (ref.current !== null && event.target instanceof Node && ref.current.contains(event.target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="cs-menu"
      role="menu"
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) =>
        item === 'separator' ? (
          <div key={`sep-${index}`} className="cs-menu-sep" role="separator" />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={item.danger === true ? 'cs-menu-item is-danger' : 'cs-menu-item'}
            disabled={item.disabled === true}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
