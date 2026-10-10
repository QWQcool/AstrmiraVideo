import { describe, expect, it } from 'vitest';
import type { ProjectEntry } from '@astrmira/shared';
import {
  DEFAULT_PROJECT_ID,
  canDeleteProject,
  describeProject,
  findActiveProject,
  readActiveProjectId,
  resolveActiveProjectId,
  writeActiveProjectId,
} from './projects';
import type { StorageAccess } from './storage';

/**
 * 「当前项目」的记忆与收敛（V2.11 / 台账 B47）。
 *
 * 这一层的每一条都对应一个**真实会发生的场景**：没存过（首访）、脏值（手改存储 / 半迁移）、
 * 项目被删（切换后回到默认）、接口失败（清单为空，**不许**改用户的项目）。
 */

function memoryStorage(seed: Record<string, string> = {}): StorageAccess {
  const map = new Map(Object.entries(seed));
  return {
    local: {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, value);
      },
      removeItem: (key) => {
        map.delete(key);
      },
    },
  };
}

function project(over: Partial<ProjectEntry> & { projectId: string }): ProjectEntry {
  return {
    name: '项目',
    createdAt: 1,
    updatedAt: 1,
    isDefault: false,
    taskCount: 0,
    assetCount: 0,
    ...over,
  };
}

describe('当前项目的读取口径（缺省 = 默认项目）', () => {
  it('没存过 → 默认项目（首访）', () => {
    expect(readActiveProjectId(memoryStorage())).toBe(DEFAULT_PROJECT_ID);
  });

  it('脏值（空白串）→ 默认项目（与后端"省略 = 默认项目"同口径）', () => {
    expect(readActiveProjectId(memoryStorage({ 'astrmira.activeProjectId': '   ' }))).toBe(
      DEFAULT_PROJECT_ID,
    );
  });

  it('写入后能读回（trim 后）', () => {
    const storage = memoryStorage();
    writeActiveProjectId(storage, 'proj-a');
    expect(readActiveProjectId(storage)).toBe('proj-a');
  });
});

describe('把记忆收敛成清单里真实存在的项目', () => {
  const list = [project({ projectId: 'default', isDefault: true }), project({ projectId: 'proj-a' })];

  it('命中 → 原样返回（不打扰用户）', () => {
    expect(resolveActiveProjectId(list, 'proj-a')).toBe('proj-a');
  });

  it('不在清单里（项目被删 / 换了部署）→ 回落默认项目', () => {
    expect(resolveActiveProjectId(list, 'gone')).toBe(DEFAULT_PROJECT_ID);
  });

  it('清单为空（接口失败）→ **保持原值**（一次网络抖动不该改用户的项目）', () => {
    expect(resolveActiveProjectId([], 'proj-a')).toBe('proj-a');
  });
});

describe('界面侧的可删除判定（与后端同一套规则）', () => {
  it('默认项目不可删', () => {
    expect(canDeleteProject(project({ projectId: 'default', isDefault: true }))).toBe(false);
  });

  it('非空项目不可删（有任务或有素材都算）', () => {
    expect(canDeleteProject(project({ projectId: 'p', taskCount: 3 }))).toBe(false);
    expect(canDeleteProject(project({ projectId: 'p', assetCount: 1 }))).toBe(false);
  });

  it('空项目可删', () => {
    expect(canDeleteProject(project({ projectId: 'p' }))).toBe(true);
  });
});

describe('显示名', () => {
  it('带用量（"这个项目占了多少"一眼可见）', () => {
    expect(describeProject(project({ projectId: 'p', name: '双十一', taskCount: 4, assetCount: 7 }))).toBe(
      '双十一（4 片 · 7 素材）',
    );
  });

  it('找不到当前项目 → null（界面显示"未知项目"，而不是编一个名字）', () => {
    expect(findActiveProject([], 'proj-a')).toBeNull();
    expect(findActiveProject([project({ projectId: 'proj-a', name: 'A' })], 'proj-a')?.name).toBe('A');
  });
});
