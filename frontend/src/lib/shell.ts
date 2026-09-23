import { createContext, useContext } from 'react';
import type { ProviderStatus } from '@astrmira/shared';
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
  /** 打开凭据抽屉（侧栏底部"凭据设置"与工作台里的入口共用同一个抽屉） */
  openByok(): void;
}

const ShellContext = createContext<ShellServices | null>(null);

export const ShellProvider = ShellContext.Provider;

/** 视图读取壳服务；不在壳里调用（比如纯函数/测试）会拿到 null —— 调用方必须显式兜底 */
export function useShell(): ShellServices {
  const services = useContext(ShellContext);
  if (services === null) {
    throw new Error('useShell 必须在 <ShellProvider> 内使用（V9 壳的视图都挂在它下面）');
  }
  return services;
}
