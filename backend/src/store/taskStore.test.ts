import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from './db.js';
import { TaskStore, type TaskRecord } from './taskStore.js';

/**
 * `listRecent` 的三档查询口径（CONTRACT §5 / V2.4 / V2.6）。
 *
 * 为什么值得钉住：剪辑产物"默认不进历史、但可查可删"是 V2.4 的修复口径；
 * V2.6（B37）又给 `kind=edit` 加了"不带 source = 全部剪辑产物"的分支（素材候选 / L2 画布用）。
 * 三档口径错任何一档，症状都是"剪辑产物漏出画廊"或"候选列表漏片"，且只在界面层才看得见。
 */

let dir: string;
let store: TaskStore;

const SNAPSHOT = {
  prompt: '源片',
  mode: 't2v' as const,
  aspectRatio: '16:9' as const,
  provider: 'fixture-local' as const,
};

function seed(partial: Partial<TaskRecord> & { taskId: string }): void {
  store.insert({
    track: 'cloud',
    provider: 'fixture-local',
    status: 'succeeded',
    progressPercent: 100,
    requestSnapshot: SNAPSHOT,
    warnings: [],
    submitting: false,
    ...partial,
  });
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'astrmira-taskstore-'));
  store = new TaskStore(openDatabase(path.join(dir, 'app.db')));

  // 两条生成产物 + 两代剪辑产物（旧 EDL / 新工程），源片各一、其中一条同源自 'gen-a'
  seed({ taskId: 'gen-a', outputVideoUrl: '/media/gen-a.mp4' });
  seed({ taskId: 'gen-b', outputVideoUrl: '/media/gen-b.mp4' });
  seed({
    taskId: 'edit-legacy',
    outputVideoUrl: '/media/edit-legacy.mp4',
    editScript: { sourceTaskId: 'gen-a', operations: [{ type: 'trim', startSec: 0, endSec: 1 }] },
  });
  seed({
    taskId: 'edit-project',
    outputVideoUrl: '/media/edit-project.mp4',
    editOrigin: {
      sourceTaskId: 'gen-b',
      project: { version: 1, fps: 30, width: 1280, height: 720, tracks: [] },
    },
  });
});

afterAll(async () => {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    /* 临时目录残留无碍 */
  }
});

describe('listRecent · 三档口径', () => {
  it('默认：只回生成产物（两代剪辑产物都不得混进来）', () => {
    const ids = store.listRecent(50).map((record) => record.taskId);
    expect(ids).toContain('gen-a');
    expect(ids).toContain('gen-b');
    expect(ids).not.toContain('edit-legacy');
    expect(ids).not.toContain('edit-project');
  });

  it('kind=edit + source：只回该源片的剪辑产物', () => {
    const ids = store
      .listRecent(50, { kind: 'edit', sourceTaskId: 'gen-a' })
      .map((record) => record.taskId);
    expect(ids).toEqual(['edit-legacy']);
  });

  it('kind=edit 不带 source（V2.6 / B37）：回全部剪辑产物（两代都算），不含生成产物', () => {
    const ids = store.listRecent(50, { kind: 'edit' }).map((record) => record.taskId);
    expect(ids).toContain('edit-legacy');
    expect(ids).toContain('edit-project');
    expect(ids).not.toContain('gen-a');
    expect(ids).not.toContain('gen-b');
  });
});
