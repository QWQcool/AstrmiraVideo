import { useEffect, useState } from 'react';

/**
 * 自写 hash 路由（V9 · B2；决策 = PLAN §6-D34：不引入 react-router）。
 *
 * 为什么自写：四个一级视图用 react-router 是杀鸡用牛刀（+60KB 且违背 D4 的"零全家桶"）；
 * hash 天然刷新不丢、不上行服务端。视图注册表做成**数据**（`views/registry.ts`），
 * 是"将来若出现嵌套路由 / loader 约定再迁 react-router"时（台账 B28）唯一的廉价前提。
 *
 * 约定：
 * - 路径形如 `#/overview`；**查询参数跟在 `?` 后**（`#/edit?task=<id>`），由视图自己读；
 * - **不做路径参数**（`#/library/:taskId` 那种）—— 那是台账 B28 的迁移触发条件；
 * - 未知 hash **不静默重定向**：由壳落到"未知视图"兜底（B2 破坏性验证钉住）。
 */

export interface HashRoute {
  /** 完整 hash（含 query），如 `#/edit?task=abc` */
  hash: string;
  /** 不含 query 的路径部分，如 `#/edit` */
  path: string;
  /** 查询参数（`?` 之后的部分） */
  query: URLSearchParams;
}

export function parseHash(rawHash: string): HashRoute {
  const raw = rawHash.startsWith('#') ? rawHash : `#${rawHash}`;
  const qIndex = raw.indexOf('?');
  return {
    hash: raw,
    path: qIndex === -1 ? raw : raw.slice(0, qIndex),
    query: new URLSearchParams(qIndex === -1 ? '' : raw.slice(qIndex + 1)),
  };
}

/** 编程式跳转。已在该 hash 时不动（避免产生多余的历史条目）。 */
export function navigate(to: string): void {
  const target = to.startsWith('#') ? to : `#${to}`;
  if (window.location.hash === target) return;
  window.location.hash = target;
}

/** 订阅 hash 变化的 hook（hashchange 是浏览器原生事件，前进后退也会触发）。 */
export function useHashRoute(): HashRoute {
  const [route, setRoute] = useState<HashRoute>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = (): void => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}
