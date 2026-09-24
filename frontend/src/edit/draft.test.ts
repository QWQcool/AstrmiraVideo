import { describe, expect, it } from 'vitest';
import type { StorageLike } from '../lib/storage';
import { clearEditDraft, draftKey, loadEditDraft, saveEditDraft } from './draft';
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
    expect(loaded).toEqual(withTransition.project);
  });

  it('没有草稿 → null（不凭空造工程）', () => {
    expect(loadEditDraft('task-draft', { local: memoryStorage() })).toBeNull();
  });

  it('坏 JSON → null 且就地清除（自愈，不反复解析同一份坏数据）', () => {
    const storage = memoryStorage({ [draftKey('task-draft')]: '{ 这不是 JSON' });
    expect(loadEditDraft('task-draft', { local: storage })).toBeNull();
    expect(storage.dump()[draftKey('task-draft')]).toBeUndefined();
  });

  it('schema 不过（例如旧版本字段缺失）→ null 且清除', () => {
    const broken = JSON.stringify({
      version: 1,
      fps: 30,
      width: 1280,
      height: 720,
      tracks: [{ id: 't', kind: 'caption', clips: [{ kind: 'caption', id: 'c1', startFrame: 0, durationFrames: 30, text: '旧数据' }] }],
    });
    const storage = memoryStorage({ [draftKey('task-draft')]: broken });
    expect(loadEditDraft('task-draft', { local: storage })).toBeNull();
    expect(storage.dump()[draftKey('task-draft')]).toBeUndefined();
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
    const loaded = loadEditDraft('task-draft', { local: storage })!;
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
    expect(loadEditDraft('task-draft', { local: storage })).toBeNull();
  });
});
