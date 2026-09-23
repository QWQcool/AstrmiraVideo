import type { ComponentType } from 'react';
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
export type ViewIconKey = 'grid' | 'wand' | 'film' | 'cards' | 'list' | 'scissors';

export interface ViewDef {
  /** hash 路径（不含查询参数），如 `#/overview` */
  path: string;
  /** 侧栏与页面头显示的中文名 */
  title: string;
  /** 全大写英文副标（eyebrow） */
  eyebrow: string;
  icon: ViewIconKey;
  component: ComponentType;
  hidden?: boolean;
  preferRail?: boolean;
}

/** 默认视图（2026-09-23 用户在 B1 闸门拍板）：工具型应用落地即干活，不每次多点一次 */
export const DEFAULT_VIEW = '#/workbench';

export const VIEW_REGISTRY: readonly ViewDef[] = [
  { path: '#/overview', title: '总览', eyebrow: 'Overview', icon: 'grid', component: OverviewView },
  { path: '#/workbench', title: '生成工作台', eyebrow: 'Workbench', icon: 'wand', component: WorkbenchView, preferRail: true },
  { path: '#/library', title: '视频库', eyebrow: 'Library', icon: 'film', component: LibraryView },
  { path: '#/recipes', title: '配方库', eyebrow: 'Recipe Library', icon: 'cards', component: RecipesView },
  { path: '#/logs', title: '操作日志', eyebrow: 'Logs', icon: 'list', component: LogsView },
  { path: '#/edit', title: '剪辑台', eyebrow: 'Editing Desk', icon: 'scissors', component: EditView, hidden: true, preferRail: true },
];

/** 按路径查视图；查不到 = 未知视图（壳落兜底，不静默重定向） */
export function matchView(path: string): ViewDef | undefined {
  return VIEW_REGISTRY.find((view) => view.path === path);
}

/** 侧栏要渲染的视图（隐藏项不进侧栏，但仍是合法路由） */
export const NAV_VIEWS: readonly ViewDef[] = VIEW_REGISTRY.filter((view) => view.hidden !== true);
