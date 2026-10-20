/**
 * 模态层计数（S5-B4d）。
 *
 * 为什么需要它：画布的全局 Delete / Ctrl+Z / paste 监听在 window 上，
 * 只看 `event.target` 的 DOM 祖先无法判断"上面是否浮着一个抽屉/预览/资产选择器"——
 * 焦点落在弹窗的按钮上时，Delete 仍会落到画布逻辑上。
 *
 * 这里只维护一个进程内计数，并在 <html> 上打 `data-modal-open`：
 * 组件 push/pop，画布/剪辑台的全局键处理在入口处问 `isModalLayerOpen()`。
 * 不引入 Context，是为了让任何组件（包括不在 ShellProvider 下的浮层）都能用。
 */
let openLayers = 0;

function syncDataset(): void {
  if (typeof document === 'undefined') return;
  if (openLayers > 0) document.documentElement.dataset.modalOpen = '1';
  else delete document.documentElement.dataset.modalOpen;
}

/** 打开一层模态；返回幂等的释放函数（重复调用只减一次） */
export function pushModalLayer(): () => void {
  openLayers += 1;
  syncDataset();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    openLayers = Math.max(0, openLayers - 1);
    syncDataset();
  };
}

export function isModalLayerOpen(): boolean {
  return openLayers > 0;
}

export function modalLayerCount(): number {
  return openLayers;
}

/** ⚠️ 仅供测试：清空计数（组件卸载后不应残留） */
export function __resetModalLayersForTesting(): void {
  openLayers = 0;
  syncDataset();
}
