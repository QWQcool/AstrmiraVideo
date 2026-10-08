import type { ReactNode } from 'react';
import { useShell } from '../lib/shell';
import { THEME_LABELS, THEME_PREFS, type ThemePref } from '../lib/theme';
import { NAV_VIEWS, type ViewIconKey } from '../views/registry';

/**
 * 左侧栏（V9 · B2；决策 = PLAN §6-D33）。
 *
 * 两态：展开 240px（图标 + 文字）/ 收起 56px（纯图标栏，rail 态靠 `title` 提示）。
 * 底部区固定放三样「随时要用但不常驻」的东西（D33）：凭据设置（唤抽屉）、主题切换、折叠按钮。
 *
 * 导航项来自**视图注册表**（`NAV_VIEWS` = 注册表过滤 `hidden`），不在这里手写清单 ——
 * 加一个视图 = 在注册表加一行，侧栏自动跟上。
 *
 * 日志红点（B5）：`errorLogCount > 0` 时在「操作日志」项上显示条数；收起态退化成**纯圆点**
 * （56px 里塞不下数字，且不写字号就没有硬编码问题）。
 */

const ICONS: Record<ViewIconKey, ReactNode> = {
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.4" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.4" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.4" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.4" />
    </>
  ),
  wand: <path d="M5 19 19 5M15.5 4.5l1 1M19.5 8.5l1 1M4.5 14.5l1 1" />,
  // 画布（B42）：两个节点 + 一条派生线 —— 血缘的最小示意
  graph: (
    <>
      <circle cx="6.5" cy="7" r="2.6" />
      <circle cx="17.5" cy="17" r="2.6" />
      <path d="M8.6 8.6l6.8 6.8" />
    </>
  ),
  // 创作（B41）：四角星 + 一颗小星尘 —— "一句话点亮一颗星"的意象
  spark: (
    <>
      <path d="M12 3.5l1.9 4.6 4.6 1.9-4.6 1.9-1.9 4.6-1.9-4.6-4.6-1.9 4.6-1.9z" />
      <path d="M18.6 15.4l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z" />
    </>
  ),
  film: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.2" />
      <path d="M7.5 4.5v15M16.5 4.5v15M3 12h18" />
    </>
  ),
  cards: (
    <>
      <rect x="3.5" y="5" width="10" height="14" rx="2" />
      <path d="M16 7.5h4.5v9H16" />
    </>
  ),
  list: <path d="M4 6.5h16M4 12h16M4 17.5h10" />,
  scissors: (
    <>
      <circle cx="6" cy="6.5" r="2.6" />
      <circle cx="6" cy="17.5" r="2.6" />
      <path d="M20 4 8.1 13.1M20 20 8.1 10.9" />
    </>
  ),
};

const KEY_ICON = (
  <>
    <circle cx="8.5" cy="12" r="4.2" />
    <path d="M12.7 12H21M18.4 12v3M15.6 12v2.2" />
  </>
);
const SUN_ICON = (
  <>
    <circle cx="12" cy="12" r="4.4" />
    <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6" />
  </>
);
const RAIL_ICON = <path d="M14.5 6.5 9 12l5.5 5.5" />;

export interface SidebarProps {
  /** 当前 hash 路径（不含查询参数） */
  currentPath: string;
  /** true = 收起为 56px 图标栏 */
  rail: boolean;
  onToggleRail(): void;
  themePref: ThemePref;
  onThemeChange(pref: ThemePref): void;
  /** 「操作日志」的红点条数（壳统计；0 = 不显示） */
  errorLogCount?: number;
  /**
   * 移动端（≤768px）：侧栏退化为**汉堡唤出的 overlay 抽屉**（V9 · B7）。
   * 桌面端这个值不参与渲染 —— 样式表里 `[data-mobile-open]` 只在窄屏生效。
   */
  mobileOpen?: boolean;
  /** 点了导航项之后的通知（移动端用来关掉抽屉） */
  onNavigate?: () => void;
}

function SideIcon({ children }: { children: ReactNode }) {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      {children}
    </svg>
  );
}

export function Sidebar({
  currentPath,
  rail,
  onToggleRail,
  themePref,
  onThemeChange,
  errorLogCount = 0,
  mobileOpen = false,
  onNavigate,
}: SidebarProps) {
  const { openByok } = useShell();

  return (
    <aside
      className="sidebar"
      data-rail={rail ? '1' : '0'}
      data-mobile-open={mobileOpen ? '1' : '0'}
    >
      <nav className="sidebar-nav" aria-label="一级视图">
        {NAV_VIEWS.map((view) => {
          const active = currentPath === view.path;
          const badge = view.path === '#/logs' && errorLogCount > 0 ? errorLogCount : null;
          return (
            <a
              key={view.path}
              href={view.path}
              className="nav-item"
              aria-current={active ? 'page' : undefined}
              // 收起态没有文字，用 title 给悬停提示（rail 态的可达性）
              title={rail ? view.title : undefined}
              onClick={onNavigate}
            >
              <SideIcon>{ICONS[view.icon]}</SideIcon>
              <span className="nav-label">{view.title}</span>
              {badge === null ? null : (
                <span className="nav-badge" title={`有 ${badge} 条失败请求`}>
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </a>
          );
        })}
      </nav>

      <div className="sidebar-spacer" />

      <div className="sidebar-foot">
        <button type="button" className="side-row" onClick={openByok} title={rail ? '凭据设置' : undefined}>
          <SideIcon>{KEY_ICON}</SideIcon>
          <span className="side-foot-label">凭据设置</span>
        </button>

        {/* 主题分段控件：收起态下 56px 放不下三个文字按钮，整行隐藏（展开后再切） */}
        <div className="side-row side-row--theme">
          <SideIcon>{SUN_ICON}</SideIcon>
          <span className="side-foot-label">主题</span>
          <span className="seg" role="group" aria-label="主题">
            {THEME_PREFS.map((pref) => (
              <button
                key={pref}
                type="button"
                aria-pressed={themePref === pref}
                onClick={() => onThemeChange(pref)}
              >
                {THEME_LABELS[pref]}
              </button>
            ))}
          </span>
        </div>

        <button
          type="button"
          className="side-row rail-toggle"
          onClick={onToggleRail}
          aria-expanded={!rail}
          title={rail ? '展开侧栏' : '收起侧栏'}
        >
          <SideIcon>{RAIL_ICON}</SideIcon>
          <span className="side-foot-label">{rail ? '展开侧栏' : '收起侧栏'}</span>
        </button>
      </div>
    </aside>
  );
}
