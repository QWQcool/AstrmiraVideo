import type { ComponentType } from 'react';
import type { MessageKey } from '../lib/i18n';
import { CanvasStudioView } from './CanvasStudioView';
import { LegacyLineageView } from './LegacyLineageView';
import { CostsView } from './CostsView';
import { CreateView } from './CreateView';
import { EditView } from './EditView';
import { LibraryView } from './LibraryView';
import { LogsView } from './LogsView';
import { OverviewView } from './OverviewView';
import { RecipesView } from './RecipesView';
import { WorkbenchView } from './WorkbenchView';

/**
 * 视图注册表（V9 · B2；决策 = PLAN §6-D34）。
 *
 * 它是**数据**，不是 JSX —— 这是整条链路里最关键的一个约定：
 * 将来若出现嵌套路由（`#/library/:taskId/edit`）或需要 loader 数据约定，
 * 迁 react-router 时**只翻译这张表**，视图组件一行不改（台账 B28 的迁移触发条件）。
 *
 * 字段约定：
 * - `hidden: true` = 是一级视图但**不进侧栏**（剪辑台：需要源片上下文才有意义）；
 * - `preferRail: true` = 进入该视图时侧栏**默认收起**（工作台 / 剪辑台这类"要空间"的视图）；
 *   用户手动切换过侧栏后，本字段不再干预（见 App 的 railTouched）。
 */
export type ViewIconKey =
  | 'grid'
  | 'wand'
  | 'spark'
  | 'film'
  | 'cards'
  | 'list'
  | 'scissors'
  | 'graph'
  /** V2.12（B48）：成本台账 —— 铜钱/账本意象 */
  | 'coins';

export interface ViewDef {
  /** hash 路径（不含查询参数），如 `#/overview` */
  path: string;
  /**
   * 侧栏与页面头显示的**文案键**（V2.38：外壳文案已进字典）。
   *
   * 为什么注册表存键而不是文案：它是**数据**（本文件顶部那条约定），
   * 而"显示成什么语言"是渲染那一刻的事 —— 存文案会让注册表绑死一种语言，
   * 语言一切换就得重建整张表。渲染处 `t(view.titleKey)`。
   */
  titleKey: MessageKey;
  /** 全大写英文副标（eyebrow）—— 它是**设计元素**（固定英文），不进字典 */
  eyebrow: string;
  icon: ViewIconKey;
  component: ComponentType;
  hidden?: boolean;
  preferRail?: boolean;
}

/**
 * 默认视图 = `#/create`（one-for-all 创作入口；PLAN §6-D39，2026-10-08 立项的 B41）。
 * 取代 2026-09-23 拍板的 `#/workbench`：工具型应用落地即干活 —— 现在"干活"的起点是
 * 一句话输入框，专业三栏退为 `#/workbench`（能力与证据链原样保留）。
 */
export const DEFAULT_VIEW = '#/create';

export const VIEW_REGISTRY: readonly ViewDef[] = [
  { path: '#/create', titleKey: 'shell.nav.create', eyebrow: 'Create', icon: 'spark', component: CreateView, preferRail: true },
  // D62（2026-10-19）：专业工作台**下线**——入口不再出现在侧栏，路由保留一个版本周期便于回退。
  { path: '#/workbench', titleKey: 'shell.nav.workbench', eyebrow: 'Workbench', icon: 'wand', component: WorkbenchView, hidden: true, preferRail: true },
  { path: '#/overview', titleKey: 'shell.nav.overview', eyebrow: 'Overview', icon: 'grid', component: OverviewView },
  { path: '#/library', titleKey: 'shell.nav.library', eyebrow: 'Library', icon: 'film', component: LibraryView },
  // S3-B2：`#/canvas` 换成创作画布（多画布文档 + 媒体节点）。
  // S3-B4：来源边已做进新画布 → 旧只读血缘图**下线**；`#/lineage` 只留一个可读的说明页
  // （旧书签不会掉进"未知视图"），代码保留一个版本周期后再清理。
  { path: '#/canvas', titleKey: 'shell.nav.canvas', eyebrow: 'Canvas', icon: 'graph', component: CanvasStudioView },
  { path: '#/lineage', titleKey: 'shell.nav.canvas', eyebrow: 'Lineage', icon: 'graph', component: LegacyLineageView, hidden: true },
  // V2.12（台账 B48）：成本台账 —— D62（2026-10-19）**下线**：不做支付/积分，成本只保留"估算"，
  // 入口从侧栏移除；路由保留一个版本周期（旧链接不直接 404）。
  { path: '#/costs', titleKey: 'shell.nav.costs', eyebrow: 'Cost Ledger', icon: 'coins', component: CostsView, hidden: true },
  { path: '#/recipes', titleKey: 'shell.nav.recipes', eyebrow: 'Recipe Library', icon: 'cards', component: RecipesView },
  { path: '#/logs', titleKey: 'shell.nav.logs', eyebrow: 'Logs', icon: 'list', component: LogsView },
  { path: '#/edit', titleKey: 'shell.nav.edit', eyebrow: 'Editing Desk', icon: 'scissors', component: EditView, hidden: true, preferRail: true },
];

/** 按路径查视图；查不到 = 未知视图（壳落兜底，不静默重定向） */
export function matchView(path: string): ViewDef | undefined {
  return VIEW_REGISTRY.find((view) => view.path === path);
}

/** 侧栏要渲染的视图（隐藏项不进侧栏，但仍是合法路由） */
export const NAV_VIEWS: readonly ViewDef[] = VIEW_REGISTRY.filter((view) => view.hidden !== true);
