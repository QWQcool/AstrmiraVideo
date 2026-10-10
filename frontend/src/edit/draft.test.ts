import { describe, expect, it } from 'vitest';
import { EDIT_PROJECT_VERSION, migrateEditProject } from '@astrmira/shared';
import type { StorageLike } from '../lib/storage';
import {
  DRAFT_HISTORY_LIMIT,
  clearEditDraft,
  clearEditDraftHistory,
  draftHistoryKey,
  draftKey,
  listEditDraftHistory,
  loadEditDraft,
  pushEditDraftHistory,
  saveEditDraft,
} from './draft';
import {
  addTransition,
  addVideoClip,
  createProjectFromSource,
  moveClip,
  type EditProject,
} from './model';

/** 内存 Storage 桩（与 lib/storage 的 StorageLike 同形） */
function memoryStorage(initial: Record<string, string> = {}): StorageLike & { dump: () => Record<string, string> } {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    dump: () => Object.fromEntries(store),
  };
}

const makeSource = () => ({ taskId: 'task-draft', url: '/media/d.mp4', durationFrames: 150 });

describe('工程草稿（P3）', () => {
  it('存→取 roundtrip：工程一字不差（含转场）', () => {
    const storage = memoryStorage();
    const project = createProjectFromSource(makeSource());
    const { project: two } = addVideoClip(project, {
      taskId: 'b',
      url: '/media/b.mp4',
      durationFrames: 90,
    });
    const withTransition = addTransition(two, two.tracks[0]!.clips[0]!.id, 'wipeleft', 12);
    if (!withTransition.ok) throw new Error('前置转场失败');

    saveEditDraft('task-draft', withTransition.project, { local: storage });
    const loaded = loadEditDraft('task-draft', { local: storage });
    expect(loaded.problem).toBeNull();
    expect(loaded.project).toEqual(withTransition.project);
  });

  it('没有草稿 → project 为 null 且**没有问题**（空白不是错误）', () => {
    expect(loadEditDraft('task-draft', { local: memoryStorage() })).toEqual({
      project: null,
      problem: null,
      notes: [],
    });
  });

  it('坏 JSON → 给出原因且**保留原文**（V2.21 改口径：静默删除是数据丢失）', () => {
    const storage = memoryStorage({ [draftKey('task-draft')]: '{ 这不是 JSON' });
    const loaded = loadEditDraft('task-draft', { local: storage });
    expect(loaded.project).toBeNull();
    expect(loaded.problem).toContain('不是有效的 JSON');
    // ⭐ 与旧口径的分界：原文**还在**（用户还有救回来的机会）
    expect(storage.dump()[draftKey('task-draft')]).toBe('{ 这不是 JSON');
  });

  it('schema 不过（字段缺失）→ 给出原因、保留原文，且**不返回半成品**', () => {
    const broken = JSON.stringify({
      version: 1,
      fps: 30,
      width: 1280,
      height: 720,
      tracks: [
        {
          id: 't',
          kind: 'caption',
          clips: [{ kind: 'caption', id: 'c1', startFrame: 0, durationFrames: 30, text: '旧数据' }],
        },
      ],
    });
    const storage = memoryStorage({ [draftKey('task-draft')]: broken });
    const loaded = loadEditDraft('task-draft', { local: storage });
    expect(loaded.project).toBeNull();
    expect(loaded.problem).not.toBeNull();
    expect(storage.dump()[draftKey('task-draft')]).toBe(broken);
  });

  it('草稿里已不成立的转场被自愈清理（片段被移走）', () => {
    const storage = memoryStorage();
    const project = createProjectFromSource(makeSource());
    const { project: two, clipId: bId } = addVideoClip(project, {
      taskId: 'b',
      url: '/media/b.mp4',
      durationFrames: 90,
    });
    const added = addTransition(two, two.tracks[0]!.clips[0]!.id, 'fade', 15);
    if (!added.ok) throw new Error('前置转场失败');
    // 手动制造"转场还在、B 被移走"的破损草稿
    const broken: EditProject = {
      ...added.project,
      tracks: added.project.tracks.map((track) =>
        track.clips.some((clip) => clip.id === bId)
          ? { ...track, clips: track.clips.map((clip) => (clip.id === bId ? { ...clip, startFrame: 200 } : clip)) }
          : track,
      ),
    };
    saveEditDraft('task-draft', broken, { local: storage });
    const loaded = loadEditDraft('task-draft', { local: storage }).project!;
    const transitionTrack = loaded.tracks.find((track) => track.kind === 'transition')!;
    expect(transitionTrack.clips).toHaveLength(0);
    // 且 B 的位置得到还原（不是原样的 200）
    expect(
      loaded.tracks.find((track) => track.kind === 'video')!.clips.find((clip) => clip.id === bId)!
        .startFrame,
    ).not.toBe(200);
    // 这也顺带钉住：自愈走的正是 removeTransitionInternal 的还原路径
    const moved = moveClip(added.project, bId, 200);
    expect(
      moved.tracks.find((track) => track.kind === 'video')!.clips.find((clip) => clip.id === bId)!
        .startFrame,
    ).toBe(200);
  });

  it('清除草稿后读回 null', () => {
    const storage = memoryStorage();
    saveEditDraft('task-draft', createProjectFromSource(makeSource()), { local: storage });
    clearEditDraft('task-draft', { local: storage });
    expect(loadEditDraft('task-draft', { local: storage }).project).toBeNull();
  });
});

/**
 * V2.21（台账 B66）：**旧文件必须能被打开**。
 *
 * 这是"schema 版本化"的落点：`version: z.literal(1)` 一旦升版，没有迁移函数就
 * **所有老草稿全部读不出来**（用户看到的是"我的剪辑怎么没了"）。
 */
describe('工程迁移（B66）', () => {
  it('当前版本 → 直接通过，migratedFrom 为 null', () => {
    const project = createProjectFromSource(makeSource());
    const result = migrateEditProject(project);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migratedFrom).toBeNull();
      expect(result.notes).toEqual([]);
      expect(result.project).toEqual(project);
    }
  });

  it('没有版本号 → 按 v1 处理，**并在 notes 里如实说明**（不假装它本来就有版本）', () => {
    const { version: _dropped, ...withoutVersion } = createProjectFromSource(makeSource());
    const result = migrateEditProject(withoutVersion);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project.version).toBe(EDIT_PROJECT_VERSION);
      expect(result.notes.join(' ')).toContain('没有版本号');
    }
  });

  it('**来自更新的版本 → 明确拒绝**，且给出"请升级"的可执行提示', () => {
    const future = { ...createProjectFromSource(makeSource()), version: EDIT_PROJECT_VERSION + 1 };
    const result = migrateEditProject(future);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.futureVersion).toBe(EDIT_PROJECT_VERSION + 1);
      expect(result.reason).toContain('请升级');
    }
  });

  it('完全不是工程（顶层不是对象 / 是数组）→ 明确报错而不是抛异常', () => {
    expect(migrateEditProject(null).ok).toBe(false);
    expect(migrateEditProject([]).ok).toBe(false);
    expect(migrateEditProject('一份 JSON 字符串').ok).toBe(false);
  });
});

/**
 * V2.21（台账 B66）：草稿版本历史。
 *
 * 三条口径：**节流**（不刷满）、**去重**（与最新一份相同不重复存）、**恢复前先保底**。
 */
describe('草稿版本历史（B66）', () => {
  it('首次推入即保存；与最新一份相同 → 跳过（不重复堆）', () => {
    const storage = memoryStorage();
    const project = createProjectFromSource(makeSource());
    expect(pushEditDraftHistory('task-draft', project, { now: 1_000 }, { local: storage })).toBe(true);
    expect(pushEditDraftHistory('task-draft', project, { now: 2_000 }, { local: storage })).toBe(false);
    expect(listEditDraftHistory('task-draft', { local: storage }).snapshots).toHaveLength(1);
  });

  it('节流：间隔内跳过，`force` 时强制存（用户点「存一个版本」/恢复前保底）', () => {
    const storage = memoryStorage();
    const first = createProjectFromSource(makeSource());
    const { project: second } = addVideoClip(first, {
      taskId: 'b',
      url: '/media/b.mp4',
      durationFrames: 90,
    });

    pushEditDraftHistory('task-draft', first, { now: 1_000 }, { local: storage });
    // 内容不同但在节流窗口内 → 不存
    expect(pushEditDraftHistory('task-draft', second, { now: 2_000 }, { local: storage })).toBe(false);
    // 显式动作 → 存
    expect(
      pushEditDraftHistory('task-draft', second, { now: 2_000, force: true }, { local: storage }),
    ).toBe(true);
    expect(listEditDraftHistory('task-draft', { local: storage }).snapshots).toHaveLength(2);
  });

  it('上限：只保留最近 N 份（最旧的被挤掉）', () => {
    const storage = memoryStorage();
    const base = createProjectFromSource(makeSource());
    for (let index = 0; index < DRAFT_HISTORY_LIMIT + 3; index += 1) {
      const { project } = addVideoClip(base, {
        taskId: `t${index}`,
        url: `/media/${index}.mp4`,
        durationFrames: 30,
      });
      pushEditDraftHistory('task-draft', project, { now: 1_000 + index * 10_000, force: true }, { local: storage });
    }
    const { snapshots } = listEditDraftHistory('task-draft', { local: storage });
    expect(snapshots).toHaveLength(DRAFT_HISTORY_LIMIT);
    // 最新在前
    expect(snapshots[0]!.savedAt).toBeGreaterThan(snapshots[snapshots.length - 1]!.savedAt);
  });

  it('历史里的**坏快照被跳过并计数**（老快照过迁移函数；不假装历史完整）', () => {
    const storage = memoryStorage({
      [draftHistoryKey('task-draft')]: JSON.stringify([
        { savedAt: 3_000, project: { version: 999, fps: 30, width: 1280, height: 720, tracks: [] } },
        { savedAt: 2_000, project: createProjectFromSource(makeSource()) },
        { savedAt: 1_000, project: 'not an object' },
      ]),
    });
    const { snapshots, broken } = listEditDraftHistory('task-draft', { local: storage });
    expect(snapshots).toHaveLength(1);
    expect(broken).toBe(2);
  });

  it('清空历史**不动当前草稿**（历史是可再生的，草稿不是）', () => {
    const storage = memoryStorage();
    const project = createProjectFromSource(makeSource());
    saveEditDraft('task-draft', project, { local: storage });
    pushEditDraftHistory('task-draft', project, { force: true }, { local: storage });

    clearEditDraftHistory('task-draft', { local: storage });
    expect(listEditDraftHistory('task-draft', { local: storage }).snapshots).toEqual([]);
    expect(loadEditDraft('task-draft', { local: storage }).project).toEqual(project);
  });
});
