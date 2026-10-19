import { describe, expect, it } from 'vitest';
import type { CanvasProjectIndex, CanvasProjectRef } from '@astrmira/shared';
import {
  CANVAS_NAME_MAX,
  canvasNameTaken,
  defaultCanvasName,
  isCanvasNameValid,
  normalizeCanvasName,
  pickInitialCanvasProject,
  removeCanvasProject,
  renameCanvasProject,
  setActiveCanvasProject,
  upsertCanvasProject,
} from './canvasProjects';

function ref(projectId: string, name: string, updatedAt = 0): CanvasProjectRef {
  return { projectId, name, updatedAt, nodeCount: 1 };
}

function index(projects: CanvasProjectRef[], activeProjectId?: string): CanvasProjectIndex {
  return { version: 1, projects, ...(activeProjectId === undefined ? {} : { activeProjectId }) };
}

describe('画布项目 · 名称', () => {
  it('规范化：去首尾空白、折叠内部空白', () => {
    expect(normalizeCanvasName('  客厅  广告  ')).toBe('客厅 广告');
  });

  it('空名与超长都判为非法（超长不静默截断）', () => {
    expect(isCanvasNameValid('')).toBe(false);
    expect(isCanvasNameValid('   ')).toBe(false);
    expect(isCanvasNameValid('a'.repeat(CANVAS_NAME_MAX))).toBe(true);
    expect(isCanvasNameValid('a'.repeat(CANVAS_NAME_MAX + 1))).toBe(false);
  });

  it('重名判定大小写不敏感，且重命名时不与自己冲突', () => {
    const projects = [ref('a', 'Canvas A'), ref('b', '其它')];
    expect(canvasNameTaken('canvas a', projects)).toBe(true);
    expect(canvasNameTaken('CANVAS A', projects, 'a')).toBe(false);
    expect(canvasNameTaken('新名字', projects, 'a')).toBe(false);
  });

  it('默认名从“未命名画布”起，逐个加序号且不重名', () => {
    expect(defaultCanvasName([])).toBe('未命名画布');
    expect(defaultCanvasName([ref('a', '未命名画布')])).toBe('未命名画布 2');
    expect(
      defaultCanvasName([ref('a', '未命名画布'), ref('b', '未命名画布 2')]),
    ).toBe('未命名画布 3');
  });
});

describe('画布项目 · 索引操作', () => {
  it('upsert：同 id 覆盖不重复，并按最近修改倒序', () => {
    const before = index([ref('a', 'A', 100), ref('b', 'B', 200)]);
    const after = upsertCanvasProject(before, ref('a', 'A2', 300));
    expect(after.projects.map((p) => p.projectId)).toEqual(['a', 'b']);
    expect(after.projects[0].name).toBe('A2');
    expect(after.projects).toHaveLength(2);
  });

  it('remove：删掉 active 时一并清空 active（不擅自挑下一个）', () => {
    const before = index([ref('a', 'A'), ref('b', 'B')], 'a');
    const after = removeCanvasProject(before, 'a');
    expect(after.projects.map((p) => p.projectId)).toEqual(['b']);
    expect(after.activeProjectId).toBeUndefined();
  });

  it('setActive：可设可清', () => {
    const base = index([ref('a', 'A')]);
    expect(setActiveCanvasProject(base, 'a').activeProjectId).toBe('a');
    expect(setActiveCanvasProject(base, undefined).activeProjectId).toBeUndefined();
  });

  it('进入画布时：优先 active，其次最近修改，都没有就 null（不擅自新建）', () => {
    expect(pickInitialCanvasProject(index([ref('a', 'A', 1), ref('b', 'B', 2)], 'a'))?.projectId).toBe('a');
    expect(pickInitialCanvasProject(index([ref('a', 'A', 1), ref('b', 'B', 2)]))?.projectId).toBe('a');
    expect(pickInitialCanvasProject(index([]))).toBeNull();
    // active 指向已删除的 id → 退回最近修改
    expect(pickInitialCanvasProject(index([ref('b', 'B', 2)], 'gone'))?.projectId).toBe('b');
  });

  it('重命名：规范化并更新时间，但不动节点数/封面', () => {
    const updated = renameCanvasProject(
      { projectId: 'a', name: '旧', updatedAt: 1, nodeCount: 7, coverAssetId: 'cover' },
      '  新  名字 ',
      99,
    );
    expect(updated).toEqual({
      projectId: 'a',
      name: '新 名字',
      updatedAt: 99,
      nodeCount: 7,
      coverAssetId: 'cover',
    });
  });
});
