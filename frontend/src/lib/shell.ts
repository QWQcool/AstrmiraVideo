import { createContext, useContext } from 'react';
import type { ProjectEntry, ProviderStatus } from '@astrmira/shared';
import type { ByokConfig } from './byok';

/**
 * 壳服务（V9 · B2）：壳（App）持有、视图消费的**跨视图**依赖。
 *
 * 为什么用 Context 而不是 props：视图注册表是**数据化**的（`component` 是无 props 的组件，
 * 这是"将来迁 react-router 时只换一层"的前提），而工作台仍需要 `byok` / `providerStatus` /
 * 打开凭据抽屉 —— 用 Context 提供，注册表与视图组件都保持纯净。
 * （PLAN §6-D4 的"零全家桶"是说不引状态库；`createContext` 是 React 自带的。）
 */
export interface ShellServices {
  byok: ByokConfig;
  byokPersist: boolean;
  providerStatus: ProviderStatus | null;
  /** V2.51：自检后重新拉 `/status`，让最近一次自检的 modes 进入引擎列表 */
  refreshProviderStatus(): void;
  /** 打开凭据抽屉（侧栏底部"凭据设置"与工作台里的入口共用同一个抽屉） */
  openByok(): void;

  // ── 项目维度（V2.11 / 台账 B47；CONTRACT §12）──────────────────────────────
  /**
   * 当前项目（缺省 = 默认项目）。**所有**列表与提交都带它：
   * 视图只读这一个值，不再各自记一份（否则"界面显示 A、请求发 B"迟早发生）。
   */
  projectId: string;
  /** 项目清单（含用量）；接口失败时为最后一次成功的列表（可能为空） */
  projects: ProjectEntry[];
  /** 切换项目：写 localStorage + 广播（视图的 useEffect 依赖它重新拉数据） */
  setActiveProject(projectId: string): void;
  /** 新建 / 改名 / 删除之后刷新清单（并保证"当前项目"仍指向存在的那个） */
  refreshProjects(): void;
  /** 最近一次项目操作失败的原因（就地显示，**不用原生对话框** —— 项目红线） */
  projectError: string | null;
  reportProjectError(message: string | null): void;
}

const ShellContext = createContext<ShellServices | null>(null);

export const ShellProvider = ShellContext.Provider;

/** 视图读取壳服务；不在壳里调用（比如纯函数/测试）会拿到 null —— 调用方必须显式兜底 */
export function useShell(): ShellServices {
  const services = useContext(ShellContext);
  if (services === null) {
    // 这是**开发者不变式**（hook 用错地方），不是界面文案 —— 与 `console.*` 同一类：
  // 它只会出现在开发期的报错里；翻成界面语言不会帮到任何人，反而让 grep 变难。
  // i18n-exempt: 开发者不变式（hook 使用错误，理由见上两行）
  throw new Error('useShell 必须在 <ShellProvider> 内使用（V9 壳的视图都挂在它下面）');
  }
  return services;
}
