import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../store/db.js';
import { TaskStore } from '../store/taskStore.js';
import { startStorageEvictor, runStorageEvict, type StorageEvictOutcome } from './storageEvict.js';

/**
 * 容量淘汰的策略矩阵（V2.8 / 台账 B22；口径 = CONTRACT §7）。
 *
 * 五条最要紧的行为：
 * 1. **未超阈值什么都不做**（不删文件、后续不写日志）；
 * 2. **从最旧的开始淘汰到目标水位**，且**保留任务记录**（画廊显示"成片已清理"、血缘不断裂）；
 * 3. **被 `task:` 引用的成片不淘汰**（否则"参数一键回填"再提交会 404）；
 * 4. **文件本就不在**的候选不算"淘汰"（freed 不为它记账，也不进 evicted 列表）；
 * 5. 装配层：`onEvict` 只在实际删了文件时回调；`drain()` 停表并等在飞的一轮。
 */

const MB = 1024 * 1024;

interface Harness {
  outputsDir: string;
  store: TaskStore;
  dispose: () => Promise<void>;
}

async function setup(): Promise<Harness> {
  const base = await mkdtemp(path.join(tmpdir(), 'astrmira-evict-'));
  const outputsDir = path.join(base, 'outputs');
  await mkdir(outputsDir, { recursive: true });
  const db = openDatabase(path.join(base, 'app.db'));
  const store = new TaskStore(db);
  return {
    outputsDir,
    store,
    // ⚠️ 必须先 `db.close()` 再删目录：SQLite 在 WAL 模式下握着 `app.db-wal`，
    // Windows 上文件锁会让 `rm` 一直 EBUSY（重试到超时）——实测踩点。
    dispose: async () => {
      db.close();
      await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

/** 播一条"已成功且有成片"的任务，并真的写一个 mp4 文件 */
async function seedVideo(
  harness: Harness,
  taskId: string,
  createdAt: number,
  sizeBytes = MB,
  extra: { referenceVideo?: string } = {},
): Promise<void> {
  harness.store.insert({
    taskId,
    track: 'cloud',
    provider: 'fixture-local',
    status: 'succeeded',
    progressPercent: 100,
    requestSnapshot: {
      prompt: taskId,
      mode: 't2v',
      aspectRatio: '16:9',
      provider: 'fixture-local',
      ...(extra.referenceVideo === undefined
        ? {}
        : { assets: { referenceVideo: extra.referenceVideo }, mode: 'v2v' }),
    },
    warnings: [],
    submitting: false,
    outputVideoUrl: `/media/${taskId}.mp4`,
    createdAt,
  });
  await writeFile(path.join(harness.outputsDir, `${taskId}.mp4`), Buffer.alloc(sizeBytes));
}

async function exists(file: string): Promise<boolean> {
  try {
    const info = await stat(file);
    return info.isFile();
  } catch {
    return false;
  }
}

describe('runStorageEvict · 策略', () => {
  it('未超阈值 → null（不删文件、不产生任何副作用）', async () => {
    const harness = await setup();
    try {
      await seedVideo(harness, 'old-1', 1);
      await seedVideo(harness, 'old-2', 2);

      const outcome = await runStorageEvict({
        outputsDir: harness.outputsDir,
        store: harness.store,
        maxBytes: 100 * MB,
        targetRatio: 0.8,
      });

      expect(outcome).toBeNull();
      expect(await exists(path.join(harness.outputsDir, 'old-1.mp4'))).toBe(true);
      expect(await exists(path.join(harness.outputsDir, 'old-2.mp4'))).toBe(true);
    } finally {
      await harness.dispose();
    }
  });

  it('超阈值 → 从最旧的淘汰到目标水位；任务记录保留（历史与血缘不断裂）', async () => {
    const harness = await setup();
    try {
      for (let index = 1; index <= 5; index += 1) {
        await seedVideo(harness, `old-${index}`, index);
      }

      // 5MB 总量、阈值 3MB、目标 80% = 2.4MB → 必须释放 ≥2.6MB → 删最旧的 3 条
      const outcome = await runStorageEvict({
        outputsDir: harness.outputsDir,
        store: harness.store,
        maxBytes: 3 * MB,
        targetRatio: 0.8,
      });

      expect(outcome).not.toBeNull();
      expect(outcome?.evictedTaskIds).toEqual(['old-1', 'old-2', 'old-3']);
      expect(outcome?.freedBytes).toBe(3 * MB);
      expect(outcome?.afterBytes).toBe(2 * MB);
      expect(outcome?.skippedReferenced).toBe(0);

      expect(await exists(path.join(harness.outputsDir, 'old-1.mp4'))).toBe(false);
      expect(await exists(path.join(harness.outputsDir, 'old-4.mp4'))).toBe(true);
      // 关键：文件没了，**记录还在**（画廊显示"成片已清理"、血缘画布显示 ghost）
      expect(harness.store.get('old-1')).not.toBeNull();
    } finally {
      await harness.dispose();
    }
  });

  it('保护规则：被 task: 引用的成片跳过淘汰（并如实计数）', async () => {
    const harness = await setup();
    try {
      for (let index = 1; index <= 5; index += 1) {
        await seedVideo(harness, `old-${index}`, index);
      }
      // 最新的一条任务把最旧的 old-1 当参考 —— old-1 必须被保护
      await seedVideo(harness, 'ref-user', 99, 0, { referenceVideo: 'task:old-1' });

      const outcome = await runStorageEvict({
        outputsDir: harness.outputsDir,
        store: harness.store,
        maxBytes: 3 * MB,
        targetRatio: 0.8,
      });

      expect(outcome?.skippedReferenced).toBe(1);
      expect(outcome?.evictedTaskIds).not.toContain('old-1');
      expect(outcome?.evictedTaskIds).toEqual(['old-2', 'old-3', 'old-4']);
      expect(await exists(path.join(harness.outputsDir, 'old-1.mp4'))).toBe(true);
    } finally {
      await harness.dispose();
    }
  });

  it('文件本就不在的候选：不算淘汰（freed 不记账、不进 evicted 列表）', async () => {
    const harness = await setup();
    try {
      await seedVideo(harness, 'gone-1', 1);
      await rm(path.join(harness.outputsDir, 'gone-1.mp4'), { force: true }); // 事前就没文件
      for (let index = 2; index <= 4; index += 1) {
        await seedVideo(harness, `old-${index}`, index);
      }

      // 阈值 2MB（真实占用 3MB）→ 目标 1.6MB：gone-1 不贡献释放量，只能靠 old-2/old-3
      const outcome = await runStorageEvict({
        outputsDir: harness.outputsDir,
        store: harness.store,
        maxBytes: 2 * MB,
        targetRatio: 0.8,
      });

      expect(outcome?.evictedTaskIds).toEqual(['old-2', 'old-3']);
      expect(outcome?.evictedTaskIds).not.toContain('gone-1');
      expect(outcome?.freedBytes).toBe(2 * MB);
    } finally {
      await harness.dispose();
    }
  });
});

describe('startStorageEvictor · 装配行为', () => {
  it('启动即跑一轮；onEvict 只在实际删文件时回调；drain 停表并收尾', async () => {
    const harness = await setup();
    try {
      for (let index = 1; index <= 4; index += 1) {
        await seedVideo(harness, `old-${index}`, index);
      }

      const seen: StorageEvictOutcome[] = [];
      const evictor = startStorageEvictor({
        outputsDir: harness.outputsDir,
        store: harness.store,
        maxBytes: 2 * MB,
        targetRatio: 0.8,
        intervalMs: 60_000, // 只为"启动即跑一次"，不依赖定时器
        onEvict: (outcome) => seen.push(outcome),
      });

      await evictor.drain();

      expect(seen).toHaveLength(1);
      expect(seen[0]?.freedBytes).toBeGreaterThan(0);
      // 已降到阈值以下 → 再跑一轮是 null（也不可能误报"又淘汰了"）
      expect(await evictor.runOnce()).toBeNull();
    } finally {
      await harness.dispose();
    }
  });
});
