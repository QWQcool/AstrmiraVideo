import { LogPanel } from '../components/LogPanel';
import { navigate } from '../lib/router';
import { DEFAULT_VIEW } from './registry';

/**
 * 操作日志（V9 · B2 的最小视图化；精修在 B5）。
 *
 * D33 已把日志从"顶栏弹层"升级为一级视图。本片（B2）只把它**装进视图**：
 * `LogPanel` 组件主体一行不改，用 `.view-logs` 的派生 CSS 把弹层背板收编为普通块
 * （`position: fixed` → `static`），"关闭"按钮变成"回到工作台"。
 * B5 再做页面级的排版精修（去掉弹层语义、页面头、红点逻辑等）。
 */
export function LogsView() {
  return (
    <div className="view-logs">
      <LogPanel onClose={() => navigate(DEFAULT_VIEW)} />
    </div>
  );
}
