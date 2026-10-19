import type { CanvasProjectIndex, CanvasProjectRef } from '@astrmira/shared';

/**
 * 多画布项目的纯逻辑（Step 11-S3 片 B1）。
 *
 * 为什么单独一层：项目列表的规则（重名、排序、删除后 active 归谁）都是**可测的判定**，
 * 混在组件里只能靠肉眼点；这里做成纯函数，组件只负责渲染与调接口。
 *
 * 三条口径：
 * 1. **重名不做**：切换器里两个同名画布认不出来（与资产项目的处理一致）；
 * 2. **排序 = 最近修改在前**；`activeProjectId` 只记"上次打开"，不参与排序；
 * 3. **删除要收尾**：删掉的若正是 active，则清空 active（不擅自挑下一个 —— 由界面决定打开哪个）。
 */

export const CANVAS_NAME_MAX = 40;

/**
 * 去掉首尾空白并折叠内部连续空白（" 客厅  广告 " → "客厅 广告"）。
 *
 * 刻意**不截断**：超长要当作校验失败让用户改，而不是静默切掉后半截。
 */
export function normalizeCanvasName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function isCanvasNameValid(name: string): boolean {
  const normalized = normalizeCanvasName(name);
  return normalized.length > 0 && normalized.length <= CANVAS_NAME_MAX;
}

/** 是否与**其它**画布重名（大小写不敏感；`selfId` 用于重命名时不与自己冲突） */
export function canvasNameTaken(
  name: string,
  projects: readonly CanvasProjectRef[],
  selfId?: string,
): boolean {
  const target = normalizeCanvasName(name).toLocaleLowerCase();
  return projects.some(
    (p) => p.projectId !== selfId && p.name.toLocaleLowerCase() === target,
  );
}

/** 新画布默认名："未命名画布"、"未命名画布 2"…（不重名） */
export function defaultCanvasName(projects: readonly CanvasProjectRef[]): string {
  const base = '未命名画布';
  const names = new Set(projects.map((p) => p.name));
  if (!names.has(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base} ${i}`;
    if (!names.has(candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
}

export function newCanvasProjectId(): string {
  // 单用户部署（D60）：id 只用于文件名与索引键，不需要服务端发号
  return globalThis.crypto?.randomUUID?.() ?? `canvas-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** 插入或更新一条摘要，并按 `updatedAt` 倒序（最近修改在前） */
export function upsertCanvasProject(
  index: CanvasProjectIndex,
  ref: CanvasProjectRef,
): CanvasProjectIndex {
  const projects = index.projects.filter((p) => p.projectId !== ref.projectId);
  projects.push(ref);
  projects.sort((a, b) => b.updatedAt - a.updatedAt);
  return { ...index, projects };
}

/** 删除一条；若删的是 active，则一并清空 active */
export function removeCanvasProject(
  index: CanvasProjectIndex,
  projectId: string,
): CanvasProjectIndex {
  const next: CanvasProjectIndex = {
    ...index,
    projects: index.projects.filter((p) => p.projectId !== projectId),
  };
  if (next.activeProjectId === projectId) delete next.activeProjectId;
  return next;
}

export function setActiveCanvasProject(
  index: CanvasProjectIndex,
  projectId: string | undefined,
): CanvasProjectIndex {
  const next: CanvasProjectIndex = { ...index };
  if (projectId === undefined) delete next.activeProjectId;
  else next.activeProjectId = projectId;
  return next;
}

/**
 * 进入画布页时打开哪个项目：
 * - `activeProjectId` 仍然存在 → 它；
 * - 否则最近修改的那个；
 * - 一个都没有 → `null`（界面显示"新建画布"空态，不擅自创建）。
 */
export function pickInitialCanvasProject(index: CanvasProjectIndex): CanvasProjectRef | null {
  const active = index.projects.find((p) => p.projectId === index.activeProjectId);
  if (active !== undefined) return active;
  return index.projects[0] ?? null;
}

/** 重命名后的摘要（保留节点数与封面，只改名字与时间） */
export function renameCanvasProject(
  ref: CanvasProjectRef,
  name: string,
  now: number = Date.now(),
): CanvasProjectRef {
  return { ...ref, name: normalizeCanvasName(name), updatedAt: now };
}
