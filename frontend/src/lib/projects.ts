import { DEFAULT_PROJECT_ID } from '@astrmira/shared';
import type { ProjectEntry } from '@astrmira/shared';
import { projectIsDeletable } from '@astrmira/shared';
import { getLanguage, translate } from './i18n';
import { STORAGE_KEYS, readLocal, writeLocal, type StorageAccess } from './storage';

/**
 * 「当前项目」的**记忆与收敛**（V2.11 / 台账 B47，契约 §12）。
 *
 * 三条纪律：
 * 1. **缺省 = 默认项目**：读取时脏值 / 空串 / 没存过，一律回落 `default` ——
 *    与后端"省略 = 默认项目"同一口径（两处不一致会出现"界面显示 A、请求发的是默认项目"的错位）；
 * 2. **记住的 id 必须在列表里真实存在**：项目被删掉、换了部署、存储被手改，都收敛回默认项目；
 *    但**列表为空（接口失败）时保持原值** —— 不能因为一次网络抖动就把用户的项目改掉；
 * 3. 这一层是**纯函数 + 注入存储**，所以可单测（见 `projects.test.ts`）。
 */

export { DEFAULT_PROJECT_ID, projectIsDeletable };

/** 读当前项目 id（缺省 = 默认项目） */
export function readActiveProjectId(storage: StorageAccess): string {
  const raw = readLocal(storage, STORAGE_KEYS.activeProjectId);
  if (raw === null) return DEFAULT_PROJECT_ID;
  const trimmed = raw.trim();
  return trimmed === '' ? DEFAULT_PROJECT_ID : trimmed;
}

export function writeActiveProjectId(storage: StorageAccess, projectId: string): void {
  writeLocal(storage, STORAGE_KEYS.activeProjectId, projectId);
}

/** 把"记住的项目"收敛成列表里真实存在的那个（见文件头第 2 条） */
export function resolveActiveProjectId(projects: ProjectEntry[], remembered: string): string {
  if (projects.length === 0) return remembered;
  if (projects.some((project) => project.projectId === remembered)) return remembered;
  return DEFAULT_PROJECT_ID;
}

/** 当前项目条目；找不到返回 null（界面据此显示"项目已失效"，而不是编一个名字） */
export function findActiveProject(
  projects: ProjectEntry[],
  projectId: string,
): ProjectEntry | null {
  return projects.find((project) => project.projectId === projectId) ?? null;
}

/**
 * 项目可删除吗 —— 与后端**同一套规则**（默认项目 / 非空项目不可删）。
 * 界面用它禁用按钮（而不是"点了才报错"），服务端仍会独立再判一次（前端禁用不是安全边界）。
 */
export function canDeleteProject(project: ProjectEntry): boolean {
  return projectIsDeletable(project);
}

/** 切换器里的显示名：项目名 + 用量（用量让"这个项目占了多少"一眼可见） */
export function describeProject(project: ProjectEntry): string {
  return translate(getLanguage(), 'shell.project.item', {
    name: project.name,
    tasks: project.taskCount,
    assets: project.assetCount,
  });
}
