import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from './db.js';
import { TaskStore, toTaskProgress, type TaskRecord } from './taskStore.js';

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
  // V2.40：图片产物（`t2i`）—— 它只有 outputImageUrl，没有 outputVideoUrl
  seed({ taskId: 'gen-img', outputImageUrl: '/media/gen-img.png' });
  // V2.43：画布产物的任务（origin=canvas），用来钉“不进生成历史”
  seed({
    taskId: 'canvas-a',
    outputImageUrl: '/media/canvas-a.png',
    requestSnapshot: { ...SNAPSHOT, origin: 'canvas', canvasProjectId: 'proj-1' },
  });
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

/**
 * V2.40：图片产物（`t2i`）的**往返**。
 *
 * 为什么单独钉：真机验收时抓到的第一个缺陷正是"**出图成功了，接口里却看不到产物地址**" ——
 * 写侧（provider → 队列 → 库）改了，读路径（`toTaskProgress`）漏了一行，单测全绿也发现不了。
 */
describe('图片产物（V2.40）', () => {
  it('insert → get → toTaskProgress：`outputImageUrl` 一路不丢，且**不写** outputVideoUrl', () => {
    const record = store.get('gen-img');
    expect(record?.outputImageUrl).toBe('/media/gen-img.png');
    expect(record?.outputVideoUrl).toBeUndefined();

    const progress = toTaskProgress(record as TaskRecord);
    expect(progress.outputImageUrl).toBe('/media/gen-img.png');
    expect(progress.outputVideoUrl).toBeUndefined();
  });

  it('`listOldestWithOutput` 也认图片产物（否则图片占的盘永远不回收）', () => {
    const ids = store.listOldestWithOutput(50).map((item) => item.taskId);
    expect(ids).toContain('gen-img');
  });
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

/**
 * V2.43（Step 11-S3）：画布产物不进“生成历史”。
 *
 * 实测产品的边界是：对话/创作生成的产物进生成历史，**画布节点的产物只在画布里看得到**。
 * 这条在 SQL 层过滤（而不是界面层藏），否则分页/搜索一翻就漏。
 */
describe('listRecent · 来源过滤（V2.43）', () => {
  it('默认与 create：都排除画布产物', () => {
    const byDefault = store.listRecent(50).map((r) => r.taskId);
    const byCreate = store.listRecent(50, { origin: 'create' }).map((r) => r.taskId);
    expect(byDefault).not.toContain('canvas-a');
    expect(byCreate).not.toContain('canvas-a');
    expect(byDefault).toContain('gen-a');
  });

  it('origin=canvas：只回画布产物，且老记录（无 origin）不被误伤', () => {
    const ids = store.listRecent(50, { origin: 'canvas' }).map((r) => r.taskId);
    expect(ids).toEqual(['canvas-a']);
    // 没有 origin 字段的老任务按 create 处理
    expect(ids).not.toContain('gen-a');
  });
});

/**
 * V2.90（D-8）：观测页的行集。
 *
 * 为什么补这组：`/api/stats/summary` 的**路由层**测试用的是假 store，所以真实 SQL
 * （`from` / `to` 两个可选条件 + `json_extract(error,'$.code')` + `limit`）一直没被执行过，
 * 覆盖率门限在 CI 上直接红（2026-10-29 实测：taskStore.ts 行 91.91% < 95%、函数 95.65% < 100%）。
 * 这里补的是**真实库上的四档查询**，不是给数字凑数：口径错了，观测页的 p50/p95 与失败码分布会一起错。
 */
describe('listStatRows · 运行观测的行集（V2.90）', () => {
  it('无 from/to：全量返回、按 createdAt 倒序，errorCode 从 JSON 里取（无错误时为 null）', () => {
    seed({
      taskId: 'stat-fail',
      status: 'failed',
      error: { code: 'INVALID_REQUEST', message: '参数不对', disposition: 'terminal' },
    });

    const rows = store.listStatRows({ limit: 200 });
    expect(rows.length).toBeGreaterThanOrEqual(7);

    // 倒序：统计按时间窗口聚合，顺序错了 p50/p95 的分桶会跟着错
    const times = rows.map((row) => row.createdAt);
    expect([...times].sort((left, right) => right - left)).toEqual(times);

    const failed = rows.find((row) => row.errorCode === 'INVALID_REQUEST');
    expect(failed).toBeDefined();
    expect(failed?.status).toBe('failed');

    const succeeded = rows.find((row) => row.status === 'succeeded');
    expect(succeeded?.errorCode).toBeNull();
    expect(succeeded?.provider).toBe('fixture-local');
  });

  it('from / to 是**闭区间**，各自可单独使用；越界返回空', () => {
    const all = store.listStatRows({ limit: 200 });
    const createdAt = all.map((row) => row.createdAt);
    const min = Math.min(...createdAt);
    const max = Math.max(...createdAt);

    expect(store.listStatRows({ from: min, to: max, limit: 200 })).toHaveLength(all.length);
    expect(store.listStatRows({ from: max + 1, limit: 200 })).toEqual([]);
    expect(store.listStatRows({ to: min - 1, limit: 200 })).toEqual([]);
  });

  it('limit 真的截断（观测页只取窗口内的样本，不拉全表）', () => {
    const rows = store.listStatRows({ limit: 2 });
    expect(rows).toHaveLength(2);
  });
});
